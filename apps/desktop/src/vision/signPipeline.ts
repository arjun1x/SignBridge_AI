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

export interface SignPipelineCallbacks {
  onStatus?: (s: SignPipelineStatus) => void
  onPrediction?: (p: { gloss: string; prob: number; ts: number }) => void
  onGlossBuffer?: (glosses: string[]) => void
  onSentence?: (sentence: string) => void
  onError?: (message: string) => void
  onReady?: () => void
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

const MODEL_BASE = '/models/signs_dummy'

export async function startSignPipeline(
  video: HTMLVideoElement,
  callbacks: SignPipelineCallbacks,
  options: SignPipelineOptions = {}
): Promise<void> {
  if (running) return
  running = true
  gate = new SignGate()
  debouncer = new GlossDebouncer(options.debounce ?? DEFAULT_DEBOUNCE)
  assembler = new SentenceAssembler(
    {
      onBufferChange: (glosses) => callbacks.onGlossBuffer?.(glosses),
      onSentence: (sentence) => callbacks.onSentence?.(sentence)
    },
    options.autoSpeak ?? true,
    options.autoSpeakAfterMs ?? 2000
  )

  try {
    await initLandmarker()

    worker = new SignWorker()
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'ready') callbacks.onReady?.()
      else if (msg.type === 'prediction') {
        callbacks.onPrediction?.(msg)
        const gloss = debouncer?.push(msg)
        if (gloss) assembler?.addGloss(gloss)
      } else if (msg.type === 'error') callbacks.onError?.(msg.message)
    }
    worker.postMessage({
      type: 'load',
      modelUrl: `${MODEL_BASE}.onnx`,
      metaUrl: `${MODEL_BASE}.meta.json`,
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
