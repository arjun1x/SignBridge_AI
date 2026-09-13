// Google sign-in for a local-first desktop app: OAuth 2.0 authorization-code
// flow with PKCE and a loopback redirect (Google's recommended flow for
// installed apps). The system browser handles credentials — the app never
// sees the password. The resulting profile (name/email/avatar) personalizes
// the app; there is no SignBridge backend, so nothing is gated on it.
//
// Requires a (free) OAuth Client ID: Google Cloud Console -> Credentials ->
// Create OAuth client ID -> type "Desktop app". Put it in
// resources/google-oauth.json: { "clientId": "...", "clientSecret": "..." }
// (Google issues desktop clients a secret that is explicitly not treated as
// confidential.)
import { app, shell } from 'electron'
import { createHash, randomBytes } from 'crypto'
import { createServer } from 'http'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AddressInfo } from 'net'

export interface GoogleProfile {
  name: string
  email: string
  /** data: URI — fetched server-side because the COEP-isolated renderer
   * cannot load cross-origin images without CORP headers. */
  avatar: string | null
}

const profilePath = (): string => join(app.getPath('userData'), 'profile.json')

export function getStoredProfile(): GoogleProfile | null {
  try {
    return JSON.parse(readFileSync(profilePath(), 'utf8'))
  } catch {
    return null
  }
}

export function signOut(): void {
  if (existsSync(profilePath())) rmSync(profilePath())
}

interface OAuthConfig {
  clientId: string
  clientSecret?: string
}

export function loadOAuthConfig(resourcesDir: string): OAuthConfig | null {
  if (process.env.SIGNBRIDGE_GOOGLE_CLIENT_ID) {
    return {
      clientId: process.env.SIGNBRIDGE_GOOGLE_CLIENT_ID,
      clientSecret: process.env.SIGNBRIDGE_GOOGLE_CLIENT_SECRET
    }
  }
  const configPath = join(resourcesDir, 'google-oauth.json')
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
    return cfg.clientId ? cfg : null
  } catch {
    return null
  }
}

const b64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// Fixed preferred port so the redirect URI is deterministic: "Web application"
// OAuth clients (unlike "Desktop app" ones) only accept pre-registered
// redirect URIs, so users register http://127.0.0.1:51739/callback once.
// Falls back to a random port if taken (fine for Desktop-type clients).
const PREFERRED_PORT = 51739

export async function signInWithGoogle(config: OAuthConfig): Promise<GoogleProfile> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  // Anti-CSRF: the loopback callback is reachable by any local process, so a
  // redirect that does not echo our state is ignored rather than exchanged.
  const state = b64url(randomBytes(16))

  // Loopback server receives the redirect.
  const { code, redirectUri } = await new Promise<{ code: string; redirectUri: string }>(
    (resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (!url.pathname.startsWith('/callback')) {
          res.writeHead(404).end()
          return
        }
        if (url.searchParams.get('state') !== state) {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('invalid state')
          return
        }
        const authCode = url.searchParams.get('code')
        const error = url.searchParams.get('error')
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(
          '<body style="font-family:sans-serif;background:#0a0d14;color:#eef1f6;display:grid;place-items:center;height:100vh;margin:0">' +
            `<div style="text-align:center"><h2>${authCode ? 'Signed in to SignBridge' : 'Sign-in failed'}</h2>` +
            '<p>You can close this tab and return to the app.</p></div>'
        )
        clearTimeout(timer)
        server.close()
        if (authCode) resolve({ code: authCode, redirectUri: uri })
        else reject(new Error(error ?? 'no authorization code returned'))
      })
      let uri = ''
      const timer = setTimeout(() => {
        server.close()
        reject(new Error('Sign-in timed out (3 minutes) — browser window closed?'))
      }, 180_000)
      server.once('error', () => {
        // preferred port taken — retry on a random one ('listening' fires again)
        server.listen(0, '127.0.0.1')
      })
      server.on('listening', () => {
        const port = (server.address() as AddressInfo).port
        uri = `http://127.0.0.1:${port}/callback`
        const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        auth.searchParams.set('client_id', config.clientId)
        auth.searchParams.set('redirect_uri', uri)
        auth.searchParams.set('response_type', 'code')
        auth.searchParams.set('scope', 'openid email profile')
        auth.searchParams.set('code_challenge', challenge)
        auth.searchParams.set('code_challenge_method', 'S256')
        auth.searchParams.set('state', state)
        shell.openExternal(auth.toString())
      })
      server.listen(PREFERRED_PORT, '127.0.0.1')
    }
  )

  const tokenBody = new URLSearchParams({
    client_id: config.clientId,
    code,
    code_verifier: verifier,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri
  })
  if (config.clientSecret) tokenBody.set('client_secret', config.clientSecret)

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody
  })
  if (!tokenRes.ok) {
    throw new Error(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string }

  const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` }
  })
  if (!userRes.ok) throw new Error(`userinfo failed: ${userRes.status}`)
  const info = (await userRes.json()) as { name?: string; email?: string; picture?: string }

  let avatar: string | null = null
  if (info.picture) {
    try {
      const imgRes = await fetch(info.picture)
      const type = imgRes.headers.get('content-type') ?? 'image/jpeg'
      avatar = `data:${type};base64,${Buffer.from(await imgRes.arrayBuffer()).toString('base64')}`
    } catch {
      avatar = null
    }
  }

  const profile: GoogleProfile = {
    name: info.name ?? info.email ?? 'Google user',
    email: info.email ?? '',
    avatar
  }
  writeFileSync(profilePath(), JSON.stringify(profile))
  return profile
}
