# Security

SignBridge has two deliverables with different exposure:

| Deliverable | Where it runs | Network surface |
| --- | --- | --- |
| Web app (`apps/web`) | Visitor's browser, static hosting | Serves files only. No backend, database, login or API. Camera frames, recognized text and speech never leave the device. |
| Desktop app (`apps/desktop`) | Windows, Electron | Local only. Optional Google sign-in via a loopback OAuth redirect. Model downloads at install time. |

## Reporting a vulnerability

Email the maintainer at the address in the repository's commit history with a
description and reproduction steps. Please do not open a public issue for
security reports. You will get an acknowledgement within a week.

## Secrets and configuration

- No API keys, tokens or passwords are committed. Configuration is documented in
  `.env.example`; `.env*` files are git-ignored.
- Google OAuth client credentials (desktop app only) come from the
  `SIGNBRIDGE_GOOGLE_CLIENT_ID` / `SIGNBRIDGE_GOOGLE_CLIENT_SECRET` environment
  variables or the git-ignored `apps/desktop/resources/google-oauth.json`.
  Because `resources/` is copied into the installer as `extraResources`, a
  client file present at packaging time ships inside the installer. This is
  acceptable for an OAuth client of type "Desktop app", which Google documents
  as non-confidential, and the sign-in flow uses PKCE plus a `state` check. Do
  not use a "Web application" client for the desktop build.
- Kaggle credentials for training live in `~/.kaggle/kaggle.json`, outside the
  repository.
- The web build contains no configuration at all; `VITE_ASSET_BASE` only
  changes where public model files are fetched from.

## Web app hardening (static site)

Delivered by `apps/web/static/_headers` (Cloudflare Pages, Netlify) and
`apps/web/vercel.json` (Vercel), and sent by `npm run preview -w apps/web`
so they are exercised locally:

- `Content-Security-Policy`: `default-src 'self'`; scripts only from the site
  plus `'wasm-unsafe-eval'` for the on-device models; workers from the site and
  `blob:`; no frames, objects, external connections or form targets.
- `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` (cross-origin isolation; also
  what makes multi-threaded wasm possible).
- `Strict-Transport-Security` with preload, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- `Permissions-Policy` limits the page to the camera and display capture;
  microphone, geolocation, payment and USB are off.
- Hashed bundles are immutable-cached; model files revalidate daily.
- The site is HTTPS-only by requirement: browsers refuse camera access on
  plain HTTP, so an HTTP fallback would be non-functional as well as insecure.

## Desktop app hardening (Electron)

- Renderer runs with `sandbox: true` and context isolation; the only bridge is
  the `window.signbridge` API defined in `electron/preload.ts`.
- Packaged pages are served over the custom `app://` protocol with a
  Content-Security-Policy equivalent to the web one, COOP/COEP,
  `X-Content-Type-Options: nosniff`, and path traversal rejected (403) before
  any file is read.
- `window.open` is denied, navigation away from the bundle is blocked, and
  `<webview>` attachment is refused, in both the main and the overlay window.
- A permission allowlist (`media`, `display-capture`, `speaker-selection`)
  applies to the app's own origin only; every other permission request is
  denied.
- Heavy native code (sherpa-onnx STT/TTS) runs in a `utilityProcess`, not in
  the renderer or main process.
- Google sign-in uses OAuth 2.0 with PKCE (S256) and a random `state` that the
  loopback callback must echo; the loopback server binds to 127.0.0.1 only and
  closes after one response or three minutes.

## Dependencies

Checked on 2026-09-13.

- `npm audit`: transitive dev-dependency advisories (`browserslist`,
  `postcss`, `nanoid`, `protobufjs`, `baseline-browser-mapping`) were fixed
  with `npm audit fix`. Two remain in `extract-zip`, reached only through the
  Electron package's install-time downloader; the fix needs an Electron major
  upgrade and is tracked, not shipped.
- `pip-audit` on `ml/uv.lock`: `torch 2.11.0` (PYSEC-2025-194, local
  `torch.jit.script` memory corruption; fixed in 2.13) and `setuptools 81`
  (PYSEC-2026-3447, sdist packaging on macOS; fixed in 83). Both are
  training-time tools that never ship to users. Upgrade torch when a cu128
  wheel for the target GPU (Blackwell sm_120) is confirmed.
- Model binaries (MediaPipe, sherpa-onnx STT/TTS) are downloaded by the
  `scripts/download-*.mjs` scripts from their upstream releases and are never
  committed.

## Re-verifying

```bash
npm ci
npm audit --omit=dev
npm run check                       # typecheck both apps, runtime tests, both builds
npm run preview -w apps/web         # then open http://127.0.0.1:5181 and check the console for CSP reports
git grep -nE "(AIza[0-9A-Za-z_-]{20,}|GOCSPX-|BEGIN (RSA|EC|OPENSSH) PRIVATE)" -- ':!package-lock.json'
cd ml && uv export --format requirements-txt --no-hashes --no-emit-project -o /tmp/req.txt \
  && sed -i 's/+cu[0-9]*//' /tmp/req.txt && uvx pip-audit -r /tmp/req.txt --no-deps
```

## Go-live checklist (public website)

1. Register the domain with a registrar that supports 2FA and registry lock;
   turn both on. Enable DNSSEC.
2. Host on a static platform over HTTPS (Cloudflare Pages, Netlify, Vercel or
   equivalent). Redirect `http://` and the non-canonical host to the canonical
   HTTPS origin. Do not enable any "HTTP fallback".
3. Confirm the response headers on the live origin match `static/_headers`
   (`curl -I https://your-domain/`). Cross-origin isolation must show
   `true` in the browser console (`crossOriginIsolated`).
4. If models are on a separate CDN origin, confirm it sends
   `Access-Control-Allow-Origin` and `Cross-Origin-Resource-Policy: cross-origin`.
5. Open the site on a phone and a laptop, allow the camera, and confirm the
   studio shows "fingerspell_v2 · on device". Try a browser without WebGPU
   (Firefox) to confirm the wasm fallback.
6. Turn on 2FA for the hosting account and the GitHub account; restrict who can
   deploy to the production branch.
7. Add a privacy statement to the site: camera frames are processed locally
   and never transmitted; no analytics are shipped by default. If analytics
   are added later, extend `connect-src` and update the statement.
8. Watch `npm audit` and GitHub Dependabot alerts; re-run the "Re-verifying"
   commands before each release.
