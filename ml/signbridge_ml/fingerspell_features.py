"""Fingerspelling feature extraction — MUST match
apps/desktop/src/vision/fingerspellFeatures.ts (see shared/fingerspell_spec.json).
Fixture-tested in tests/test_fingerspell_parity.py.
"""
import numpy as np

WRIST = 0
MIDDLE_MCP = 9
FEATURE_DIM = 63


def normalize_hand(landmarks: np.ndarray, is_left: bool) -> np.ndarray:
    """landmarks: (21, 3) float array. Returns (63,) float32 normalized vector."""
    pts = landmarks.astype(np.float64).copy()
    if is_left:
        pts[:, 0] = -pts[:, 0]

    pts -= pts[WRIST]
    scale = float(np.linalg.norm(pts[MIDDLE_MCP]))
    if scale < 1e-6:
        scale = 1.0
    pts /= scale

    return pts.reshape(-1).astype(np.float32)
