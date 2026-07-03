// Bundles apps/desktop/src/vision/features.ts (including its JSON import) with
// esbuild and runs extractFrameFeatures over frames piped in as JSON on stdin.
// Used only by ml/tests/test_feature_parity.py to check Python/TS parity —
// not part of the app build.
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'apps/desktop/src/vision/features.ts')

const result = await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  loader: { '.json': 'json' }
})

const code = result.outputFiles[0].text
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
const { extractFrameFeatures } = await import(moduleUrl)

function readStdin() {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk) => (data += chunk))
    process.stdin.on('end', () => resolve(data))
  })
}

// frames: [{ leftHand: [x,y,z,...]|null per-coord, rightHand, pose, face }, ...]
// null entries become NaN (JSON has no NaN literal).
function toFloat32(arr) {
  return new Float32Array(arr.map((v) => (v === null ? NaN : v)))
}

const input = JSON.parse(await readStdin())
const results = input.map((frame) => {
  const f = {
    leftHand: toFloat32(frame.leftHand),
    rightHand: toFloat32(frame.rightHand),
    pose: toFloat32(frame.pose),
    face: toFloat32(frame.face)
  }
  return Array.from(extractFrameFeatures(f))
})

process.stdout.write(JSON.stringify(results))
