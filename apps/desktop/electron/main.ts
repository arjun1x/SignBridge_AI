import { app, BrowserWindow, desktopCapturer, ipcMain, net, protocol, session } from 'electron'
import { existsSync, statSync } from 'fs'
import { join, normalize } from 'path'
import { pathToFileURL } from 'url'
import { Channels, CaptionEvent } from './ipc/channels'
import { getStoredProfile, loadOAuthConfig, signInWithGoogle, signOut } from './auth/googleAuth'
import { findSttModel, findTtsModel, SttManager } from './stt/sttManager'
import { createMainWindow } from './windows/mainWindow'
import { createOverlayWindow } from './windows/overlayWindow'

const resourcesDir = app.isPackaged
  ? process.resourcesPath
  : join(app.getAppPath(), 'resources')

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

function broadcast(ev: CaptionEvent): void {
  for (const win of [mainWindow, overlayWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send(Channels.captionsEvent, ev)
  }
}

const stt = new SttManager(broadcast)

// Packaged builds serve the renderer over app:// instead of file:// so we can
// attach COOP/COEP headers (cross-origin isolation -> SharedArrayBuffer ->
// onnxruntime-web WASM threads) and so absolute asset paths (/models/...,
// /ort/..., /mediapipe/...) resolve. Must be registered before app ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
])

// Packaged renderer CSP (the dev server needs inline scripts/websockets for
// HMR, so it is applied to app:// only). Mirrors apps/web/static/_headers:
// wasm needs 'wasm-unsafe-eval', the recognition worker and Piper playback use
// blob: URLs, React sets inline style attributes.
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "connect-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

// The renderer only ever loads its own bundle. Anything else (a link in a
// caption, a dragged-in file, window.open) is refused rather than rendered
// with the app's privileges.
function isOwnUrl(url: string): boolean {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return url.startsWith('app://bundle/') || Boolean(devUrl && url.startsWith(devUrl))
}

function lockDownNavigation(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
}

function registerAppProtocol(): void {
  const rendererRoot = join(__dirname, '../renderer')
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    const target = normalize(join(rendererRoot, pathname === '/' ? '/index.html' : pathname))
    if (!target.startsWith(rendererRoot)) {
      return new Response('forbidden', { status: 403 })
    }
    // A missing file must be an ordinary 404, not a thrown net::ERR_FILE_NOT_FOUND:
    // the renderer probes for optional assets (e.g. newer model versions) and
    // expects a non-ok response it can fall through from.
    if (!existsSync(target) || !statSync(target).isFile()) {
      return new Response('not found', { status: 404 })
    }
    const res = await net.fetch(pathToFileURL(target).toString())
    const headers = new Headers(res.headers)
    headers.set('Cross-Origin-Opener-Policy', 'same-origin')
    headers.set('Cross-Origin-Embedder-Policy', 'require-corp')
    headers.set('X-Content-Type-Options', 'nosniff')
    if (target.endsWith('.html')) headers.set('Content-Security-Policy', RENDERER_CSP)
    return new Response(res.body, { status: res.status, headers })
  })
}

app.whenReady().then(() => {
  if (app.isPackaged) registerAppProtocol()
  // Auto-approve getDisplayMedia with WASAPI loopback audio (all system audio).
  // The renderer immediately drops the video track — we only want the sound.
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' })
      })
    },
    { useSystemPicker: false }
  )

  // Only the permissions the app actually uses: camera (sign recognition),
  // microphone probing / output-device labels (call setup), system-audio
  // capture (captions) and output-device selection (voice into the call).
  // Everything else (notifications, geolocation, MIDI, clipboard, ...) is denied.
  const allowedPermissions = new Set(['media', 'display-capture', 'speaker-selection'])
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(allowedPermissions.has(permission) && isOwnUrl(webContents.getURL()))
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission, origin) => {
    return allowedPermissions.has(permission) && (webContents ? isOwnUrl(webContents.getURL()) : isOwnUrl(origin))
  })

  mainWindow = createMainWindow()
  overlayWindow = createOverlayWindow()
  lockDownNavigation(mainWindow)
  lockDownNavigation(overlayWindow)

  // Load the routable TTS voice (Piper via sherpa) if it's been downloaded.
  const ttsModelDir = findTtsModel(resourcesDir)
  if (ttsModelDir) stt.initTts(ttsModelDir)

  mainWindow.on('closed', () => {
    mainWindow = null
    overlayWindow?.close()
  })
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  ipcMain.handle(Channels.captionsStatus, () => {
    const model = findSttModel(resourcesDir)
    return { modelFound: model !== null, modelDir: model?.dir ?? null, running: stt.running }
  })

  ipcMain.handle(Channels.captionsStart, (event) => {
    const model = findSttModel(resourcesDir)
    if (!model) {
      return {
        ok: false,
        error: 'STT model not found. Run "npm run download:stt" from the repo root, then try again.'
      }
    }
    stt.startStt(model)
    stt.connectPcm(event.sender)
    overlayWindow?.showInactive()
    return { ok: true }
  })

  ipcMain.handle(Channels.captionsStop, () => {
    stt.stopStt()
    return { ok: true }
  })

  ipcMain.handle('tts:status', () => ({
    modelFound: findTtsModel(resourcesDir) !== null,
    ready: stt.ttsAvailable
  }))

  ipcMain.handle('tts:speak', async (_event, text: string, speed?: number) => {
    let audio
    try {
      audio = await stt.speak(text, speed)
    } catch (err) {
      throw new Error(`SPEAK-REJECTED: ${String(err)}`)
    }
    return { samples: audio.samples, sampleRate: audio.sampleRate }
  })

  ipcMain.on(Channels.overlaySetInteractive, (_event, interactive: boolean) => {
    overlayWindow?.setIgnoreMouseEvents(!interactive, { forward: true })
  })

  ipcMain.handle('auth:get', () => getStoredProfile())

  ipcMain.handle('auth:signIn', async () => {
    const config = loadOAuthConfig(resourcesDir)
    if (!config) {
      return {
        ok: false,
        error:
          'Google sign-in is not configured. Create a (free) OAuth "Desktop app" client at ' +
          'console.cloud.google.com → Credentials, then save resources/google-oauth.json with ' +
          '{"clientId": "...", "clientSecret": "..."} and restart. Or continue as guest.'
      }
    }
    try {
      const profile = await signInWithGoogle(config)
      return { ok: true, profile }
    } catch (err) {
      return { ok: false, error: String(err) }
    }
  })

  ipcMain.handle('auth:signOut', () => {
    signOut()
    return { ok: true }
  })
})

app.on('window-all-closed', () => {
  stt.shutdown()
  app.quit()
})
