// Where the runtime assets live: MediaPipe wasm + .task models, onnxruntime-web
// wasm, and the exported ONNX classifiers under /models. By default they sit
// next to the app on its own origin (desktop app:// protocol, dev server, or a
// static host). The public web build can move them to a separate CDN origin
// with VITE_ASSET_BASE (e.g. https://assets.example.com) when the host caps
// per-file sizes; that origin must serve CORS + Cross-Origin-Resource-Policy:
// cross-origin so the cross-origin-isolated page may load them.
// Safe under Node test bundles, where import.meta.env is undefined.
const base = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_ASSET_BASE ?? '').replace(/\/+$/, '')

export function assetUrl(path: string): string {
  if (base) return `${base}${path}`
  // Node test bundles have no `self`; a root-relative path is what they expect.
  const origin = typeof self !== 'undefined' ? self.location?.href : undefined
  return origin ? new URL(path, origin).href : path
}
