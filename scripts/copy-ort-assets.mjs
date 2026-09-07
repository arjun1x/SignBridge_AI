// Copies renderer-side WASM runtimes from node_modules into the renderer's
// public dir, so they load locally instead of from a CDN (the renderer runs
// cross-origin isolated — see electron.vite.config.ts — and CDN loads would
// violate that isolation anyway):
//   - onnxruntime-web's .jsep variant (needed for both the WebGPU EP and its
//     wasm CPU-fallback ops)
//   - @mediapipe/tasks-vision's ES-module wasm runtime for the module worker, used
//     via an explicit WasmFileset rather than FilesetResolver.forVisionTasks
//     so we don't depend on its undocumented CDN-relative path convention.
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function copyAll(srcDir, outDir, files) {
  mkdirSync(outDir, { recursive: true })
  for (const file of files) {
    const src = join(srcDir, file)
    if (!existsSync(src)) {
      console.error(`Missing ${src} — are dependencies installed?`)
      process.exit(1)
    }
    copyFileSync(src, join(outDir, file))
  }
  console.log(`Copied ${files.length} file(s) to ${outDir}`)
}

copyAll(
  join(root, 'node_modules', 'onnxruntime-web', 'dist'),
  join(root, 'apps', 'desktop', 'src', 'public', 'ort'),
  ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']
)

copyAll(
  join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
  join(root, 'apps', 'desktop', 'src', 'public', 'mediapipe'),
  ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']
)
