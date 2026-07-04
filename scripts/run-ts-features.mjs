// Bundles a vision feature module from apps/desktop with esbuild and runs it
// over inputs piped in as JSON on stdin. Used only by the ml/ parity tests
// (test_feature_parity.py, test_fingerspell_parity.py) — not part of the app
// build. Mode: `node run-ts-features.mjs [frame|hand]` (default frame).
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const mode = process.argv[2] ?? 'frame'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(
  root,
  mode === 'hand' ? 'apps/desktop/src/vision/fingerspellFeatures.ts' : 'apps/desktop/src/vision/features.ts'
)

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
const mod = await import(moduleUrl)
const { extractFrameFeatures, normalizeHand } = mod

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

let results
if (mode === 'hand') {
  // input: [{ hand: [63 coords], isLeft: bool }, ...]
  results = input.map((item) => Array.from(normalizeHand(toFloat32(item.hand), item.isLeft)))
} else {
  results = input.map((frame) => {
    const f = {
      leftHand: toFloat32(frame.leftHand),
      rightHand: toFloat32(frame.rightHand),
      pose: toFloat32(frame.pose),
      face: toFloat32(frame.face)
    }
    return Array.from(extractFrameFeatures(f))
  })
}

process.stdout.write(JSON.stringify(results))
