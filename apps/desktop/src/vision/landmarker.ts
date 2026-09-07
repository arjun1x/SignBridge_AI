// Runs in the recognition worker. Letter mode never runs face/pose models.
import { HandLandmarker, HolisticLandmarker } from '@mediapipe/tasks-vision'
import type { HolisticLandmarkerResult } from '@mediapipe/tasks-vision'
import type { LandmarkFrame } from './features'
import type { SignMode } from '../inference/protocol'

function flat(points: { x: number; y: number; z: number }[] | undefined, count: number): Float32Array {
  const out = new Float32Array(count * 3).fill(NaN)
  points?.slice(0, count).forEach((p, i) => out.set([p.x, p.y, p.z], i * 3))
  return out
}
export function toLandmarkFrame(result: HolisticLandmarkerResult): LandmarkFrame {
  return { leftHand: flat(result.leftHandLandmarks[0], 21), rightHand: flat(result.rightHandLandmarks[0], 21),
    pose: flat(result.poseLandmarks[0], 33), face: flat(result.faceLandmarks[0], 468) }
}
export interface Detector { backend: string; detect(image: ImageBitmap, timestamp: number): LandmarkFrame; close(): void }
export async function createLandmarker(mode: SignMode): Promise<Detector> {
  const loaderUrl = new URL('/mediapipe/vision_wasm_module_internal.js', self.location.href).href
  const files = { wasmLoaderPath: loaderUrl,
    wasmBinaryPath: new URL('/mediapipe/vision_wasm_module_internal.wasm', self.location.href).href }
  const { default: factory } = await import(/* @vite-ignore */ loaderUrl)
  const scope = self as unknown as { ModuleFactory?: unknown; Module?: unknown }
  const path = `/mediapipe/${mode === 'fingerspell' ? 'hand' : 'holistic'}_landmarker.task`
  const failures: string[] = []
  for (const delegate of ['GPU', 'CPU'] as const) {
    try {
      // The Tasks loader clears this global after creating a graph. Reinstall
      // the exported factory on fallback; ES imports are cached by the worker.
      scope.ModuleFactory = factory
      scope.Module = undefined
      const baseOptions = { modelAssetPath: path, delegate }
      const canvas = new OffscreenCanvas(640, 480)
      if (mode === 'fingerspell') {
        const task = await HandLandmarker.createFromOptions(files, { baseOptions, canvas, runningMode: 'VIDEO',
          numHands: 2, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.6 })
        return { backend: delegate, close: () => task.close(), detect(image, ts) {
          const result = task.detectForVideo(image, ts)
          const frame: LandmarkFrame = { leftHand: flat(undefined, 21), rightHand: flat(undefined, 21),
            pose: flat(undefined, 33), face: flat(undefined, 468) }
          result.landmarks.forEach((points, i) => {
            // Same convention as the Python extractor. Preview mirroring is CSS-only.
            const key = result.handedness[i]?.[0]?.categoryName === 'Left' ? 'leftHand' : 'rightHand'
            frame[key] = flat(points, 21)
          })
          return frame
        } }
      }
      const task = await HolisticLandmarker.createFromOptions(files, { baseOptions, canvas, runningMode: 'VIDEO',
        minFaceDetectionConfidence: 0.5, minHandLandmarksConfidence: 0.6, minPoseDetectionConfidence: 0.5,
        outputFaceBlendshapes: false, outputPoseSegmentationMasks: false })
      return { backend: delegate, close: () => task.close(), detect: (image, ts) => toLandmarkFrame(task.detectForVideo(image, ts)) }
    } catch (err) { failures.push(`${delegate}: ${String(err)}`) }
  }
  throw new Error(`Hand tracking could not start. Check local MediaPipe model files. ${failures.join(' / ')}`)
}
