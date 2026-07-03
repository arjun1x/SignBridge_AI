// Wraps MediaPipe HolisticLandmarker: webcam frames in, LandmarkFrame out
// (see features.ts). WasmFileset is built explicitly rather than via
// FilesetResolver.forVisionTasks() so asset loading is pinned to our local
// public/mediapipe/ files (never a CDN) instead of an undocumented
// CDN-relative naming convention.
import { HolisticLandmarker, HolisticLandmarkerResult } from '@mediapipe/tasks-vision'
import type { LandmarkFrame } from './features'

const MODEL_URL = '/mediapipe/holistic_landmarker.task'
const WASM_LOADER_URL = '/mediapipe/vision_wasm_internal.js'
const WASM_BINARY_URL = '/mediapipe/vision_wasm_internal.wasm'

let landmarker: HolisticLandmarker | null = null

export async function initLandmarker(): Promise<void> {
  if (landmarker) return
  landmarker = await HolisticLandmarker.createFromOptions(
    { wasmLoaderPath: WASM_LOADER_URL, wasmBinaryPath: WASM_BINARY_URL },
    {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      minFaceDetectionConfidence: 0.5,
      minHandLandmarksConfidence: 0.5,
      minPoseDetectionConfidence: 0.5
    }
  )
}

function toFlatXYZ(landmarks: { x: number; y: number; z: number }[] | undefined, count: number): Float32Array {
  const out = new Float32Array(count * 3).fill(NaN)
  if (!landmarks) return out
  for (let i = 0; i < landmarks.length && i < count; i++) {
    out[i * 3] = landmarks[i].x
    out[i * 3 + 1] = landmarks[i].y
    out[i * 3 + 2] = landmarks[i].z
  }
  return out
}

// The first detected instance only (index 0) — sign recognition assumes a
// single signer in frame.
export function toLandmarkFrame(result: HolisticLandmarkerResult): LandmarkFrame {
  return {
    leftHand: toFlatXYZ(result.leftHandLandmarks[0], 21),
    rightHand: toFlatXYZ(result.rightHandLandmarks[0], 21),
    pose: toFlatXYZ(result.poseLandmarks[0], 33),
    // Only the first 468 points are ever indexed (see shared/feature_spec.json);
    // slicing here keeps the flat buffer's per-point stride uniform even if
    // this model build emits extra iris points beyond 468.
    face: toFlatXYZ(result.faceLandmarks[0]?.slice(0, 468), 468)
  }
}

export function detectFrame(video: HTMLVideoElement, timestampMs: number): LandmarkFrame | null {
  if (!landmarker) return null
  const result = landmarker.detectForVideo(video, timestampMs)
  return toLandmarkFrame(result)
}

export function closeLandmarker(): void {
  landmarker?.close()
  landmarker = null
}
