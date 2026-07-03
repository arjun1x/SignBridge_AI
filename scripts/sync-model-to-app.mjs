// Copies the sign-recognition ONNX model + metadata from models/ (written by
// ml/signbridge_ml/export_onnx.py) into the renderer's public dir, where the
// Web Worker fetches it from at runtime. Usage:
//   node scripts/sync-model-to-app.mjs [modelName]   (default: signs_v1)
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const name = process.argv[2] ?? 'signs_v1'
const srcDir = join(root, 'models')
const outDir = join(root, 'apps', 'desktop', 'src', 'public', 'models')

mkdirSync(outDir, { recursive: true })

for (const ext of ['.onnx', '.meta.json']) {
  const src = join(srcDir, `${name}${ext}`)
  if (!existsSync(src)) {
    console.error(`Missing ${src} — export a model first (see ml/signbridge_ml/export_onnx.py)`)
    process.exit(1)
  }
  copyFileSync(src, join(outDir, `${name}${ext}`))
}

const labelsSrc = join(root, 'shared', 'labels_gislr.json')
if (existsSync(labelsSrc)) {
  copyFileSync(labelsSrc, join(outDir, 'labels.json'))
}

console.log(`Synced ${name} -> ${outDir}`)
