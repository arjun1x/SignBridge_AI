// Downloads the MediaPipe HolisticLandmarker .task model into
// apps/desktop/src/public/mediapipe/. Unlike the STT model (loaded via fs by
// a Node utility process), HolisticLandmarker runs in the renderer and
// fetches its model over HTTP, so it must live in the renderer's public dir,
// not electron's extraResources. Model binaries are never committed.
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const URL =
  'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/latest/holistic_landmarker.task'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps', 'desktop', 'src', 'public', 'mediapipe')
const outPath = join(outDir, 'holistic_landmarker.task')

if (existsSync(outPath)) {
  console.log(`Already present: ${outPath}`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
console.log(`Downloading ${URL} (~13 MB)`)

const res = await fetch(URL, { redirect: 'follow' })
if (!res.ok) {
  console.error(`Download failed: HTTP ${res.status}`)
  process.exit(1)
}

await pipeline(Readable.fromWeb(res.body), createWriteStream(outPath))
console.log(`Done: ${outPath}`)
