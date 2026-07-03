// Orchestrates the Direction-1 pipeline: webcam -> HolisticLandmarker ->
// feature extraction -> motion gate -> sign-recognition worker. Mirrors the
// style of capture/audioCapture.ts (module-level state, explicit
// start/stop), not a React hook, so it's easy to drive from tests/CDP too.
import { closeLandmarker, detectFrame, initLandmarker } from './landmarker'
import { extractFrameFeatures, FRAME_FEATURE_DIM } from './features'
import { SignGate } from '../inference/gating'
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
  onError?: (message: string) => void
  onReady?: () => void
}

let mediaStream: MediaStream | null = null
let worker: Worker | null = null
let gate: SignGate | null = null
let rafHandle: number | null = null
let running = false

const MODEL_BASE = '/models/signs_dummy'

export async function startSignPipeline(
  video: HTMLVideoElement,
  callbacks: SignPipelineCallbacks
): Promise<void> {
  if (running) return
  running = true
  gate = new SignGate()

  try {
    await initLandmarker()

    worker = new SignWorker()
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'ready') callbacks.onReady?.()
      else if (msg.type === 'prediction') callbacks.onPrediction?.(msg)
      else if (msg.type === 'error') callbacks.onError?.(msg.message)
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
        const frame = detectFrame(video, performance.now())
        if (frame) {
          debug.framesWithLandmarks++
          const features = extractFrameFeatures(frame)
          const g = gate!.update(features, performance.now())
          callbacks.onStatus?.({ ...g, fps })
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

export function stopSignPipeline(): void {
  running = false
  if (rafHandle !== null) cancelAnimationFrame(rafHandle)
  rafHandle = null
  mediaStream?.getTracks().forEach((t) => t.stop())
  mediaStream = null
  worker?.terminate()
  worker = null
  gate = null
  closeLandmarker()
}

export function isSignPipelineRunning(): boolean {
  return running
}

export { FRAME_FEATURE_DIM }
