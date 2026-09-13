import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, extname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

// The browser build of SignBridge. It reuses the desktop renderer's recognition
// code (apps/desktop/src/{vision,inference,nlp,main}) and its public/ assets
// (models, MediaPipe, ONNX Runtime wasm) unchanged; only the Electron-specific
// pieces (captions host, TTS host, overlay, OAuth) are replaced in src/.
const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const staticDir = resolve(here, 'static')

// Cross-origin isolation: SharedArrayBuffer for onnxruntime-web wasm threads.
// The production host must send the same two headers (see static/_headers).
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

const MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json'
}

function renderStatic(name: string, assetOrigin: string): Buffer | string {
  const raw = readFileSync(join(staticDir, name))
  if (name !== '_headers') return raw
  return raw.toString('utf8').replaceAll('%ASSET_ORIGIN%', assetOrigin ? ` ${assetOrigin}` : '')
}

/** Vite allows one publicDir (the desktop's, for the shared runtime assets).
 * Web-only static files (hosting headers, icon, robots) live in static/ and are
 * served in dev / copied into dist here. `_headers` gets the CDN origin from
 * VITE_ASSET_BASE spliced into its CSP. */
function webStatic(assetOrigin: string): Plugin {
  return {
    name: 'signbridge-web-static',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = (req.url ?? '').split('?')[0].slice(1)
        const file = join(staticDir, name)
        if (!name || name.includes('..') || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', MIME[extname(name)] ?? 'application/octet-stream')
        res.end(renderStatic(name, assetOrigin))
      })
    },
    closeBundle() {
      const out = resolve(here, 'dist')
      mkdirSync(out, { recursive: true })
      for (const name of readdirSync(staticDir)) writeFileSync(join(out, name), renderStatic(name, assetOrigin))
    }
  }
}

/** The `/*` block of static/_headers, as the preview server should send it, so
 * `vite preview` exercises the same CSP the production host will apply. */
function productionHeaders(assetOrigin: string): Record<string, string> {
  const text = renderStatic('_headers', assetOrigin).toString()
  const lines = text.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === '/*')
  const headers: Record<string, string> = {}
  if (start < 0) return isolationHeaders
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/.test(line)) break
    const m = /^\s+([\w-]+):\s*(.+)$/.exec(line)
    if (m) headers[m[1]] = m[2]
  }
  return headers
}

/** onnxruntime-web references every wasm variant via new URL(..., import.meta.url),
 * so Rollup emits a 24 MB `.asyncify.wasm` the app never loads (the worker pins
 * wasmPaths to /ort/*.jsep.*). Drop it from the bundle. */
function dropUnusedOrtWasm(): Plugin {
  return {
    name: 'signbridge-drop-unused-ort-wasm',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) if (/ort-wasm-.*\.wasm$/.test(name)) delete bundle[name]
    }
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, 'VITE_')
  const assetBase = (env.VITE_ASSET_BASE ?? '').replace(/\/+$/, '')
  const assetOrigin = assetBase ? new URL(assetBase).origin : ''
  return {
    plugins: [react(), webStatic(assetOrigin), dropUnusedOrtWasm()],
    publicDir: resolve(repo, 'apps/desktop/src/public'),
    worker: { format: 'es' },
    // onnxruntime-web import()s its wasm glue at runtime from a computed path;
    // pre-bundling would rewrite that path (see the desktop config). MediaPipe
    // is pre-listed so dev does not discover it late (inside the worker) and
    // force a one-time full reload after the first click.
    optimizeDeps: { include: ['@mediapipe/tasks-vision', 'react', 'react-dom/client', 'three'], exclude: ['onnxruntime-web'] },
    server: { port: 5180, strictPort: true, headers: isolationHeaders, fs: { allow: [repo] } },
    preview: { port: 5181, strictPort: true, headers: productionHeaders(assetOrigin) },
    build: { outDir: 'dist', target: 'es2022', sourcemap: false, copyPublicDir: !assetBase }
  }
})
