// Web Worker: owns the onnxruntime-web session and a sliding window of
// per-frame features. Runs off the main thread so inference never drops UI
// or landmark-extraction frames. See shared/feature_spec.json for the
// window/stride contract this buffer implements.
import * as ort from 'onnxruntime-web'
import { FRAME_FEATURE_DIM } from '../vision/features'

// Fully-qualified URLs (not root-relative paths): Vite's dev-server import
// analysis intercepts dynamic import() of same-origin relative specifiers
// even for files outside its module graph (public/ dir assets), rewriting
// them with a `?import` suffix that 500s. An absolute cross-origin-looking
// URL (even though same-origin) is passed through untouched.
ort.env.wasm.wasmPaths = {
  mjs: new URL('/ort/ort-wasm-simd-threaded.jsep.mjs', self.location.origin).href,
  wasm: new URL('/ort/ort-wasm-simd-threaded.jsep.wasm', self.location.origin).href
}

const WINDOW_FRAMES = 64
const STRIDE_FRAMES = 8

interface ModelMeta {
  onnx_file: string
  num_classes: number
  window_frames: number
  feature_dim: number
}

let session: ort.InferenceSession | null = null
let labels: string[] = []
let ring = new Float32Array(WINDOW_FRAMES * FRAME_FEATURE_DIM) // start zero-padded, per pad_mode
let framesSeenTotal = 0
let framesSinceLastInfer = 0

type WorkerMsg =
  | { type: 'load'; modelUrl: string; metaUrl: string; labelsUrl: string }
  | { type: 'frame'; features: Float32Array; hasHands: boolean }
  | { type: 'reset' }

type WorkerReply =
  | { type: 'ready' }
  | { type: 'error'; message: string }
  | { type: 'prediction'; gloss: string; prob: number; ts: number }

function post(msg: WorkerReply): void {
  ;(self as unknown as Worker).postMessage(msg)
}

function pushFrame(features: Float32Array): void {
  // Shift the ring buffer left by one frame, append the new one at the end —
  // O(window) per frame, fine at ~30fps with window=64.
  ring.copyWithin(0, FRAME_FEATURE_DIM)
  ring.set(features, (WINDOW_FRAMES - 1) * FRAME_FEATURE_DIM)
  framesSeenTotal++
  framesSinceLastInfer++
}

async function runInference(): Promise<void> {
  if (!session) return
  const mask = new Uint8Array(WINDOW_FRAMES).fill(1)
  const realFrames = Math.min(framesSeenTotal, WINDOW_FRAMES)
  for (let i = 0; i < WINDOW_FRAMES - realFrames; i++) mask[i] = 0 // start-padding, per pad_mode

  const featTensor = new ort.Tensor('float32', ring, [1, WINDOW_FRAMES, FRAME_FEATURE_DIM])
  // ORT represents bool tensors as a Uint8Array of 0/1, which `mask` already is.
  const maskTensor = new ort.Tensor('bool', mask, [1, WINDOW_FRAMES])

  const outputs = await session.run({ features: featTensor, mask: maskTensor })
  const logits = outputs.logits.data as Float32Array

  let best = 0
  for (let i = 1; i < logits.length; i++) if (logits[i] > logits[best]) best = i
  const prob = softmaxAt(logits, best)

  post({ type: 'prediction', gloss: labels[best] ?? `#${best}`, prob, ts: Date.now() })
}

function softmaxAt(logits: Float32Array, index: number): number {
  const max = Math.max(...logits)
  let sum = 0
  for (const v of logits) sum += Math.exp(v - max)
  return Math.exp(logits[index] - max) / sum
}

self.onmessage = async (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data
  try {
    if (msg.type === 'load') {
      const meta: ModelMeta = await (await fetch(msg.metaUrl)).json()
      if (meta.feature_dim !== FRAME_FEATURE_DIM || meta.window_frames !== WINDOW_FRAMES) {
        throw new Error(
          `Model/runtime mismatch: model expects feature_dim=${meta.feature_dim} window=${meta.window_frames}, ` +
            `runtime uses ${FRAME_FEATURE_DIM}/${WINDOW_FRAMES}`
        )
      }
      labels = await (await fetch(msg.labelsUrl)).json()

      try {
        session = await ort.InferenceSession.create(msg.modelUrl, { executionProviders: ['webgpu'] })
      } catch (webgpuErr) {
        try {
          session = await ort.InferenceSession.create(msg.modelUrl, { executionProviders: ['wasm'] })
        } catch (wasmErr) {
          throw new Error(
            `webgpu: ${(webgpuErr as Error)?.stack ?? webgpuErr}\n---\nwasm: ${(wasmErr as Error)?.stack ?? wasmErr}`
          )
        }
      }
      post({ type: 'ready' })
    } else if (msg.type === 'frame') {
      pushFrame(msg.features)
      if (msg.hasHands && framesSinceLastInfer >= STRIDE_FRAMES) {
        framesSinceLastInfer = 0
        await runInference()
      }
    } else if (msg.type === 'reset') {
      ring = new Float32Array(WINDOW_FRAMES * FRAME_FEATURE_DIM)
      framesSeenTotal = 0
      framesSinceLastInfer = 0
    }
  } catch (err) {
    post({ type: 'error', message: String(err) })
  }
}
