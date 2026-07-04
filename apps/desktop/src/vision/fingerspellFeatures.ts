// Fingerspelling feature extraction — MUST match
// ml/signbridge_ml/fingerspell_features.py (see shared/fingerspell_spec.json).
// Fixture-tested in ml/tests/test_fingerspell_parity.py.
const WRIST = 0
const MIDDLE_MCP = 9
export const FINGERSPELL_FEATURE_DIM = 63

/** hand: flat (21*stride) array of hand landmarks. Returns 63-dim normalized vector. */
export function normalizeHand(hand: Float32Array, isLeft: boolean, stride = 3): Float32Array {
  const out = new Float32Array(FINGERSPELL_FEATURE_DIM)

  const wx = hand[WRIST * stride]
  const wy = hand[WRIST * stride + 1]
  const wz = hand[WRIST * stride + 2]

  // Pass 1: mirror to right-hand canonical form, then wrist-center
  const wxCanon = isLeft ? -wx : wx
  for (let i = 0; i < 21; i++) {
    const x = isLeft ? -hand[i * stride] : hand[i * stride]
    out[i * 3] = x - wxCanon
    out[i * 3 + 1] = hand[i * stride + 1] - wy
    out[i * 3 + 2] = hand[i * stride + 2] - wz
  }

  const mx = out[MIDDLE_MCP * 3]
  const my = out[MIDDLE_MCP * 3 + 1]
  const mz = out[MIDDLE_MCP * 3 + 2]
  let scale = Math.sqrt(mx * mx + my * my + mz * mz)
  if (scale < 1e-6) scale = 1

  for (let i = 0; i < out.length; i++) out[i] /= scale
  return out
}
