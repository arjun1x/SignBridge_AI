import * as ort from 'onnxruntime-web/webgpu'
import signSpec from '../../../../shared/feature_spec.json?raw'
import handSpec from '../../../../shared/fingerspell_spec.json?raw'
import legacyLabels from '../../../../shared/labels_fingerspell.json'
import { createLandmarker, type Detector } from '../vision/landmarker'
import { extractFrameFeatures, FRAME_FEATURE_DIM } from '../vision/features'
import { normalizeHand } from '../vision/fingerspellFeatures'
import { SignGate } from './gating'
import { FrameWindow } from './frameWindow'
import type { Prediction, SignMode, WorkerReply, WorkerRequest } from './protocol'

ort.env.wasm.wasmPaths = {
  mjs: new URL('/ort/ort-wasm-simd-threaded.jsep.mjs', self.location.href).href,
  wasm: new URL('/ort/ort-wasm-simd-threaded.jsep.wasm', self.location.href).href
}
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(2, navigator.hardwareConcurrency || 1) : 1
let session: ort.InferenceSession | null = null
let detector: Detector | null = null
let mode: SignMode = 'fingerspell'
let labels: string[] = []
let temperature = 1
let busy = false
let previousHand: 'leftHand' | 'rightHand' | null = null
let lastInfer = -Infinity
let noHandsSince: number | null = null
const windowBuffer = new FrameWindow(64, FRAME_FEATURE_DIM)
const gate = new SignGate()
const post = (msg: WorkerReply): void => self.postMessage(msg)

async function sha(text: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
    .map((x) => x.toString(16).padStart(2, '0')).join('')
}
async function fetchText(url: string): Promise<string> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Missing model asset: ${url} (${r.status})`)
  return r.text()
}
async function load(msg: Extract<WorkerRequest, { type: 'load' }>): Promise<void> {
  mode = msg.mode
  const [metaRaw, labelsRaw] = await Promise.all([fetchText(`${msg.base}.meta.json`), fetchText(msg.labelsUrl)])
  const meta = JSON.parse(metaRaw)
  labels = JSON.parse(labelsRaw)
  if (!Array.isArray(labels) || labels.length !== meta.num_classes || new Set(labels).size !== labels.length ||
      labels.some((x) => typeof x !== 'string')) throw new Error('Model label map is invalid')
  if (typeof meta.val_acc !== 'number' || !Number.isFinite(meta.val_acc) || meta.val_acc < 0 || meta.val_acc > 1 || /dummy/i.test(msg.base)) throw new Error('Untrained demo models cannot translate signs')
  const expectedDim = mode === 'fingerspell' ? 63 : FRAME_FEATURE_DIM
  const key = mode === 'fingerspell' ? 'fingerspell_spec_sha256' : 'feature_spec_sha256'
  if (meta.feature_dim !== expectedDim || (mode === 'signs' && meta.window_frames !== 64) ||
      meta[key] !== await sha(mode === 'fingerspell' ? handSpec : signSpec)) throw new Error('Model feature contract does not match this app')
  if (meta.labels_sha256) {
    if (meta.labels_sha256 !== await sha(labelsRaw)) throw new Error('Model label checksum mismatch')
  } else if (mode !== 'fingerspell' || JSON.stringify(labels) !== JSON.stringify(legacyLabels)) {
    throw new Error('Model is missing its label checksum; re-export it')
  }
  temperature = meta.temperature ?? 1
  if (!Number.isFinite(temperature) || temperature <= 0) throw new Error('Invalid calibration temperature')
  let backend = 'WASM'
  if (mode === 'signs') {
    try { session = await ort.InferenceSession.create(`${msg.base}.onnx`, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); backend = 'WebGPU' }
    catch { session = await ort.InferenceSession.create(`${msg.base}.onnx`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }) }
  } else {
    // Tiny MLP: avoid GPU scheduling overhead. Benchmark on the target device.
    session = await ort.InferenceSession.create(`${msg.base}.onnx`, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
  }
  detector = await createLandmarker(mode)
  // Warm-up is never displayed or spoken. The tracker is warmed too: its first
  // GPU inference compiles shaders (measured ~8 s for holistic on an RTX 5060),
  // which would otherwise land after "Camera on" and trip the main thread's
  // stalled-frame watchdog. Timestamp 0 precedes every real capture time.
  const canvas = new OffscreenCanvas(640, 480)
  canvas.getContext('2d')!.fillRect(0, 0, 640, 480) // a context is required before a bitmap can be produced
  const blank = canvas.transferToImageBitmap()
  try { detector.detect(blank, 0) } finally { blank.close() }
  await infer(new Float32Array(mode === 'fingerspell' ? 63 : 64 * FRAME_FEATURE_DIM),
    mode === 'signs' ? new Uint8Array(64).fill(1) : undefined)
  post({ type: 'ready', model: { name: msg.base.split('/').pop()!, valAcc: meta.val_acc, testMode: false, mode },
    backend: `${detector.backend} tracking / ${backend} classifier` })
}
async function infer(features: Float32Array, mask?: Uint8Array): Promise<Float32Array> {
  const feeds: Record<string, ort.Tensor> = { features: new ort.Tensor('float32', features,
    mode === 'fingerspell' ? [1, 63] : [1, 64, FRAME_FEATURE_DIM]) }
  if (mask) feeds.mask = new ort.Tensor('bool', mask, [1, 64])
  let outputs: ort.InferenceSession.ReturnType | undefined
  try {
    outputs = await session!.run(feeds)
    const logits = outputs.logits.data as Float32Array
    if (logits.length !== labels.length || !logits.every(Number.isFinite)) throw new Error('Model returned invalid scores')
    return Float32Array.from(logits)
  } finally {
    Object.values(feeds).forEach((t) => t.dispose())
    if (outputs) Object.values(outputs).forEach((t) => t.dispose())
  }
}
function rank(logits: Float32Array, ts: number): Prediction {
  const max = Math.max(...logits)
  const scores = Array.from(logits, (v) => Math.exp((v - max) / temperature))
  const sum = scores.reduce((a, b) => a + b, 0)
  const ranked = scores.map((v, i) => ({ label: labels[i], prob: v / sum })).sort((a, b) => b.prob - a.prob)
  return { ...ranked[0], margin: ranked[0].prob - (ranked[1]?.prob ?? 0), alternatives: ranked.slice(0, 3), ts }
}
self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data
  if (busy) { if (msg.type === 'frame') msg.bitmap.close(); return }
  busy = true
  try {
    if (msg.type === 'load') { await load(msg); return }
    if (!detector || !session) throw new Error('Recognition is not ready')
    const t0 = performance.now()
    const frame = detector.detect(msg.bitmap, msg.capturedAt)
    const landmarkMs = performance.now() - t0
    const hands = [frame.leftHand, frame.rightHand].filter((h) => h.every(Number.isFinite))
    const handsPresent = hands.length > 0
    let prediction: Prediction | undefined
    let inferenceMs = 0
    let motionEnergy = 0
    let isResting = false
    if (!handsPresent) {
      noHandsSince ??= msg.capturedAt
      if (msg.capturedAt - noHandsSince >= 350) { windowBuffer.reset(); gate.reset(); previousHand = null }
    } else noHandsSince = null
    if (mode === 'fingerspell' && handsPresent) {
      const present = (key: 'leftHand' | 'rightHand') => frame[key].every(Number.isFinite)
      const key = previousHand && present(previousHand) ? previousHand : present('rightHand') ? 'rightHand' : 'leftHand'
      previousHand = key
      const hand = normalizeHand(frame[key], key === 'leftHand')
      const t1 = performance.now()
      prediction = rank(await infer(hand), msg.capturedAt)
      inferenceMs = performance.now() - t1
    } else if (mode === 'signs') {
      const features = extractFrameFeatures(frame)
      const g = gate.update(features, msg.capturedAt)
      motionEnergy = g.motionEnergy; isResting = g.isResting
      windowBuffer.push(features)
      if (handsPresent && msg.capturedAt - lastInfer >= 125) {
        lastInfer = msg.capturedAt
        const input = windowBuffer.snapshot()
        const t1 = performance.now()
        prediction = rank(await infer(input.features, input.mask), msg.capturedAt)
        inferenceMs = performance.now() - t1
      }
    }
    post({ type: 'frame', capturedAt: msg.capturedAt, hands: hands.map((h) => Array.from(h)),
      handsPresent, prediction, landmarkMs, inferenceMs, motionEnergy, isResting })
  } catch (err) { post({ type: 'error', message: String(err), fatal: true }) }
  finally { if (msg.type === 'frame') msg.bitmap.close(); busy = false }
}
