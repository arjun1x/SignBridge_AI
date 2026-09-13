# SignBridge Web

The public, browser-only build of SignBridge. Recognition (MediaPipe hand /
holistic tracking + the ONNX classifiers) runs entirely on the visitor's
device in a Web Worker; nothing is uploaded. There is no backend.

The code under `apps/desktop/src/{vision,inference,nlp}` and the studio UI
(`SignPractice.tsx`) are shared with the desktop app unchanged. Only the shell
(`src/App.tsx`), feature detection (`src/capability.ts`) and hosting files
(`static/`) are web-specific. Speech uses the browser's `speechSynthesis`.

## What works where

| Feature | Chrome / Edge (desktop, Android) | Firefox | Safari (macOS / iOS 16.4+) |
| --- | --- | --- | --- |
| Fingerspelling and ASL signs → text | yes | yes (wasm classifier) | yes (wasm classifier) |
| Spoken output | yes | yes | yes, after the first tap |
| GPU classifier (WebGPU) | yes | Firefox 141+ on Windows | Safari 26+ |
| Voice into a call (virtual cable) | desktop app only | – | – |
| Live captions of the other side | desktop app only | – | – |

Visitors whose browser lacks a hard requirement (camera API, WebAssembly,
Workers, OffscreenCanvas, WebGL, secure context) see a plain explanation
instead of a broken page. Optional gaps are listed under "what this browser
supports" and the app degrades: no WebGPU → wasm, no cross-origin isolation →
single-threaded, no speech → text only.

## Develop

```bash
npm install                 # from the repo root (npm workspaces)
npm run dev:web             # http://127.0.0.1:5180 with COOP/COEP headers
npm run typecheck:web
npm run build:web           # apps/web/dist
npm run preview -w apps/web # serves dist on :5181 with the production headers/CSP
```

## Deploy

`dist/` is a static site. Two headers are mandatory on every response or
multi-threaded inference silently degrades:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`static/_headers` (Cloudflare Pages, Netlify) and `vercel.json` (Vercel) already
carry them plus HSTS, CSP, Permissions-Policy and cache rules. Any host that
serves static files over HTTPS with custom headers works.

### File-size limits

`dist/` is about 75 MB. The largest files are the ONNX Runtime wasm (26.8 MB),
the Holistic task model (13.7 MB) and the MediaPipe wasm (11.2 MB).

- Netlify, Vercel, GitHub Pages, Firebase Hosting, S3/CloudFront: upload
  `dist/` as is.
- Cloudflare Pages caps files at 25 MiB, so the ORT wasm must live elsewhere.
  Put the `ort/`, `mediapipe/` and `models/` folders in an R2 bucket (or any
  CDN) on its own origin, then build with

  ```bash
  VITE_ASSET_BASE=https://assets.your-domain.com npm run build:web
  ```

  The build then omits those folders from `dist/`, points the workers at the
  CDN and adds that origin to the CSP. The CDN must send
  `Access-Control-Allow-Origin: https://your-domain.com` (or `*`) and
  `Cross-Origin-Resource-Policy: cross-origin` on every file, or the
  cross-origin-isolated page will refuse to load them.

### Domain checklist

1. HTTPS only (the camera API is unavailable over plain HTTP). Redirect
   `http://` and the bare/`www` variant to one canonical origin.
2. Keep the `/*` headers block intact; test with `npm run preview -w apps/web`
   and the browser console (CSP violations are reported there).
3. After deploying, open the site on a phone and a laptop, allow the camera and
   confirm "fingerspell_v2 · on device" appears in the studio.
