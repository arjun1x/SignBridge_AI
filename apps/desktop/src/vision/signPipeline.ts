// Orchestrates the Direction-1 pipeline: webcam -> HolisticLandmarker ->
// feature extraction -> motion gate -> sign-recognition worker -> gloss
// debounce -> sentence assembly. Mirrors the style of
// capture/audioCapture.ts (module-level state, explicit start/stop), not a
// React hook, so it's easy to drive from tests/CDP too.
import { closeLandmarker, detectFrame, initLandmarker } from './landmarker'
import { extractFrameFeatures, FRAME_FEATURE_DIM } from './features'
import { SignGate } from '../inference/gating'
import { DebounceConfig, DEFAULT_DEBOUNCE, GlossDebouncer } from '../inference/debounce'
import { SentenceAssembler } from '../nlp/sentenceAssembler'
import SignWorker from '../inference/signWorker?worker'

export interface SignPipelineStatus {
  handsPresent: boolean
  motionEnergy: number
  isResting: boolean
  fps: number
}

export interface ModelInfo {
  name: string
  valAcc: number | null
  /** True when running the untrained placeholder with loosened thresholds. */
  testMode: boolean
}

export interface SignPipelineCallbacks {
  onStatus?: (s: SignPipelineStatus) => void
  onPrediction?: (p: { gloss: string; prob: number; ts: number }) => void
  onGlossBuffer?: (glosses: string[]) => void
  onSentence?: (sentence: string) => void
  onError?: (message: string) => void
  onReady?: (model: ModelInfo) => void
}

export interface SignPipelineOptions {
  debounce?: DebounceConfig
  autoSpeak?: boolean
  autoSpeakAfterMs?: number
}

let mediaStream: MediaStream | null = null
let worker: Worker | null = null
let gate: SignGate | null = null
let debouncer: GlossDebouncer | null = null
let assembler: SentenceAssembler | null = null
let rafHandle: number | null = null
let running = false

// Preference order: the real trained model if it's been exported + synced
// (scripts/sync-model-to-app.mjs signs_v1), else the untrained placeholder.
const MODEL_CANDIDATES = ['signs_v1', 'signs_dummy']

// Loose thresholds for the placeholder, whose top-1 probability hovers near
// 1/250 — the real thresholds would (correctly) never fire on it.
const TEST_MODE_DEBOUNCE: DebounceConfig = { minProb: 0.004, minConsecutive: 2 }

async function resolveModel(): Promise<{ base: string; name: string; valAcc: number | null }> {
  for (const name of MODEL_CANDIDATES) {
    const res = await fetch(`/models/${name}.meta.json`).catch(() => null)
    if (res?.ok) {
      const meta = await res.json()
      return { base: `/models/${name}`, name, valAcc: meta.val_acc ?? null }
    }
  }
  throw new Error('No sign model found in /models/ — run scripts/sync-model-to-app.mjs')
}

export async function startSignPipeline(
  video: HTMLVideoElement,
  callbacks: SignPipelineCallbacks,
  options: SignPipelineOptions = {}
): Promise<void> {
  if (running) return
  running = true
  gate = new SignGate()

  try {
    const model = await resolveModel()
    // Untrained placeholder (val_acc null) -> loose thresholds so the chain
    // can still be exercised; real model -> real thresholds.
    const testMode = model.valAcc === null
    debouncer = new GlossDebouncer(options.debounce ?? (testMode ? TEST_MODE_DEBOUNCE : DEFAULT_DEBOUNCE))
    assembler = new SentenceAssembler(
      {
        onBufferChange: (glosses) => callbacks.onGlossBuffer?.(glosses),
        onSentence: (sentence) => callbacks.onSentence?.(sentence)
      },
      options.autoSpeak ?? true,
      options.autoSpeakAfterMs ?? 2000
    )

    await initLandmarker()

    worker = new SignWorker()
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'ready') callbacks.onReady?.({ name: model.name, valAcc: model.valAcc, testMode })
      else if (msg.type === 'prediction') {
        callbacks.onPrediction?.(msg)
        const gloss = debouncer?.push(msg)
        if (gloss) assembler?.addGloss(gloss)
      } else if (msg.type === 'error') callbacks.onError?.(msg.message)
    }
    worker.postMessage({
      type: 'load',
      modelUrl: `${model.base}.onnx`,
      metaUrl: `${model.base}.meta.json`,
      labelsUrl: '/models/labels.json'
    })

    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    })
    video.srcObject = mediaStream
    await video.play()

    let frameCount = 0
    let fpsWindowStart = performance.now()
    let fps = 0

    const debug = {
      loopTicks: 0,
      framesWithLandmarks: 0,
      lastLoopError: '',
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight
    }
    ;(window as unknown as { __signDebug: typeof debug }).__signDebug = debug

    const loop = (): void => {
      if (!running) return
      debug.loopTicks++
      debug.videoWidth = video.videoWidth
      debug.videoHeight = video.videoHeight
      try {
        const now = performance.now()
        const frame = detectFrame(video, now)
        if (frame) {
          debug.framesWithLandmarks++
          const features = extractFrameFeatures(frame)
          const g = gate!.update(features, now)
          callbacks.onStatus?.({ ...g, fps })
          if (g.justEnteredRest) debouncer?.onRest()
          assembler?.updateRest(g.isResting, now)
          // No transfer list: SignGate holds onto `features` as prevFeatures for
          // next-frame motion diffing, and transferring would detach its buffer.
          // The array is tiny (184 floats), so cloning costs nothing measurable.
          worker?.postMessage({ type: 'frame', features, hasHands: g.handsPresent })
        }
      } catch (err) {
        debug.lastLoopError = String(err)
      }

      frameCount++
      const now = performance.now()
      if (now - fpsWindowStart >= 1000) {
        fps = frameCount / ((now - fpsWindowStart) / 1000)
        frameCount = 0
        fpsWindowStart = now
      }

      rafHandle = requestAnimationFrame(loop)
    }
    rafHandle = requestAnimationFrame(loop)
  } catch (err) {
    running = false
    callbacks.onError?.(String(err))
    stopSignPipeline()
  }
}

export function speakNow(): void {
  assembler?.speak()
}

export function backspaceGloss(): void {
  assembler?.backspace()
}

export function clearGlossBuffer(): void {
  assembler?.clear()
}

export function setAutoSpeak(enabled: boolean): void {
  assembler?.setAutoSpeak(enabled)
}

export function stopSignPipeline(): void {
  running = false
  if (rafHandle !== null) cancelAnimationFrame(rafHandle)
  rafHandle = null
  mediaStream?.getTracks().forEach((t) => t.stop())
  mediaStream = null
  worker?.terminate()
  worker = null
  gate = null
  debouncer = null
  assembler = null
  closeLandmarker()
}

export function isSignPipelineRunning(): boolean {
  return running
}

export { FRAME_FEATURE_DIM }
