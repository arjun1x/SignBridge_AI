// Landmark -> model-input feature extraction.
//
// This MUST implement shared/feature_spec.json identically to
// ml/signbridge_ml/features.py. Do not change the math here without
// mirroring the change there and re-running the parity fixture test in
// ml/tests/test_feature_parity.py.
import spec from '../../../../shared/feature_spec.json'

export interface LandmarkFrame {
  leftHand: Float32Array // 21*3 flat (x,y,z), NaN for undetected
  rightHand: Float32Array // 21*3
  pose: Float32Array // 33*3
  face: Float32Array // 468*3 (or more; only first 468 are ever indexed)
}

const LEFT_HAND_IDX = Array.from({ length: 21 }, (_, i) => i)
const RIGHT_HAND_IDX = Array.from({ length: 21 }, (_, i) => i)
const POSE_IDX: number[] = spec.landmark_subset.pose
const LIPS_IDX: number[] = spec.landmark_subset.lips
export const FRAME_FEATURE_DIM: number = spec.frame_feature_dim

const SHOULDER_L = 11
const SHOULDER_R = 12
const NOSE = 0

function xy(points: Float32Array, stride: number, index: number): [number, number] {
  const base = index * stride
  return [points[base], points[base + 1]]
}

function writeNormalizedBlock(
  out: Float32Array,
  outOffset: number,
  points: Float32Array,
  stride: number,
  indices: number[],
  cx: number,
  cy: number,
  scale: number
): void {
  for (let i = 0; i < indices.length; i++) {
    const [px, py] = xy(points, stride, indices[i])
    let nx = (px - cx) / scale
    let ny = (py - cy) / scale
    if (Number.isNaN(nx)) nx = 0
    if (Number.isNaN(ny)) ny = 0
    out[outOffset + i * 2] = nx
    out[outOffset + i * 2 + 1] = ny
  }
}

function presence(points: Float32Array, stride: number, wristIndex = 0): number {
  return Number.isNaN(points[wristIndex * stride]) ? 0 : 1
}

// pose/face landmarks may be stored as (x,y,z) or (x,y,z,visibility) — stride is
// the number of channels per point so callers stay agnostic to which.
export function extractFrameFeatures(
  frame: LandmarkFrame,
  poseStride = 3,
  handStride = 3,
  faceStride = 3
): Float32Array {
  const out = new Float32Array(FRAME_FEATURE_DIM)

  const [slx, sly] = xy(frame.pose, poseStride, SHOULDER_L)
  const [srx, sry] = xy(frame.pose, poseStride, SHOULDER_R)

  let cx: number, cy: number, scale: number
  if (!Number.isNaN(slx) && !Number.isNaN(sly) && !Number.isNaN(srx) && !Number.isNaN(sry)) {
    cx = (slx + srx) / 2
    cy = (sly + sry) / 2
    const d = Math.hypot(slx - srx, sly - sry)
    scale = d > 1e-6 ? d : 1
  } else {
    const [nx, ny] = xy(frame.pose, poseStride, NOSE)
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) {
      cx = nx
      cy = ny
    } else {
      cx = 0
      cy = 0
    }
    scale = 1
  }

  let offset = 0
  writeNormalizedBlock(out, offset, frame.leftHand, handStride, LEFT_HAND_IDX, cx, cy, scale)
  offset += LEFT_HAND_IDX.length * 2
  writeNormalizedBlock(out, offset, frame.rightHand, handStride, RIGHT_HAND_IDX, cx, cy, scale)
  offset += RIGHT_HAND_IDX.length * 2
  writeNormalizedBlock(out, offset, frame.pose, poseStride, POSE_IDX, cx, cy, scale)
  offset += POSE_IDX.length * 2
  writeNormalizedBlock(out, offset, frame.face, faceStride, LIPS_IDX, cx, cy, scale)
  offset += LIPS_IDX.length * 2

  out[offset] = presence(frame.leftHand, handStride)
  out[offset + 1] = presence(frame.rightHand, handStride)

  return out
}
