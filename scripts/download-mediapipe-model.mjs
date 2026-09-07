// Local, pinned MediaPipe assets. A partial download never masquerades as a model.
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps/desktop/src/public/mediapipe')
mkdirSync(outDir, { recursive: true })
for (const name of ['hand_landmarker', 'holistic_landmarker']) {
  const out = join(outDir, `${name}.task`)
  if (existsSync(out) && statSync(out).size > 1000000) { console.log(`Present: ${name}`); continue }
  const url = `https://storage.googleapis.com/mediapipe-models/${name}/${name}/float16/1/${name}.task`
  const temp = `${out}.partial`
  try {
    console.log(`Downloading ${name}…`)
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), createWriteStream(temp))
    if (statSync(temp).size < 1000000) throw new Error('Model download is unexpectedly small')
    renameSync(temp, out)
  } catch (err) { rmSync(temp, { force: true }); throw err }
}
