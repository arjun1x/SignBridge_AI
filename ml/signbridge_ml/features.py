"""Landmark -> model-input feature extraction.

This MUST implement shared/feature_spec.json identically to
apps/desktop/src/vision/features.ts. Do not change the math here without
mirroring the change there and re-running the parity fixture test in
ml/tests/test_feature_parity.py.
"""
import json
from pathlib import Path

import numpy as np

_SPEC_PATH = Path(__file__).resolve().parents[2] / "shared" / "feature_spec.json"
_SPEC = json.loads(_SPEC_PATH.read_text())

LEFT_HAND_IDX = list(range(21))
RIGHT_HAND_IDX = list(range(21))
POSE_IDX = _SPEC["landmark_subset"]["pose"]
LIPS_IDX = _SPEC["landmark_subset"]["lips"]
FRAME_FEATURE_DIM = _SPEC["frame_feature_dim"]

SHOULDER_L, SHOULDER_R = 11, 12
NOSE = 0


def _xy(points: np.ndarray, indices: list[int]) -> np.ndarray:
    """points: (N, >=2) array, NaN for missing landmarks. Returns (len(indices), 2)."""
    return points[indices, :2]


def _normalize_block(block: np.ndarray, center: np.ndarray, scale: float) -> np.ndarray:
    out = (block - center) / scale
    out[np.isnan(out)] = 0.0
    return out


def _presence(points: np.ndarray, wrist_idx: int = 0) -> float:
    return 0.0 if np.isnan(points[wrist_idx, 0]) else 1.0


def extract_frame_features(frame: dict) -> np.ndarray:
    """frame: {"left_hand": (21,>=2), "right_hand": (21,>=2), "pose": (33,>=2),
    "face": (468,>=2)} numpy arrays, NaN for undetected landmarks.
    Returns a (184,) float32 vector per shared/feature_spec.json.
    """
    pose = frame["pose"]
    shoulder_l, shoulder_r = pose[SHOULDER_L, :2], pose[SHOULDER_R, :2]

    if not (np.isnan(shoulder_l).any() or np.isnan(shoulder_r).any()):
        center = (shoulder_l + shoulder_r) / 2.0
        scale = float(np.linalg.norm(shoulder_l - shoulder_r))
        scale = scale if scale > 1e-6 else 1.0
    elif not np.isnan(pose[NOSE, :2]).any():
        center = pose[NOSE, :2].copy()
        scale = 1.0
    else:
        center = np.zeros(2, dtype=np.float64)
        scale = 1.0

    left_hand = _normalize_block(_xy(frame["left_hand"], LEFT_HAND_IDX), center, scale)
    right_hand = _normalize_block(_xy(frame["right_hand"], RIGHT_HAND_IDX), center, scale)
    pose_feat = _normalize_block(_xy(pose, POSE_IDX), center, scale)
    lips = _normalize_block(_xy(frame["face"], LIPS_IDX), center, scale)

    presence = np.array(
        [_presence(frame["left_hand"]), _presence(frame["right_hand"])], dtype=np.float64
    )

    feat = np.concatenate(
        [left_hand.reshape(-1), right_hand.reshape(-1), pose_feat.reshape(-1), lips.reshape(-1), presence]
    ).astype(np.float32)

    assert feat.shape[0] == FRAME_FEATURE_DIM, f"expected {FRAME_FEATURE_DIM}, got {feat.shape[0]}"
    return feat


def extract_sequence_features(frames: list[dict]) -> np.ndarray:
    """frames: list of per-frame landmark dicts. Returns (T, 184) float32."""
    return np.stack([extract_frame_features(f) for f in frames], axis=0)


# --- Mirror augmentation (training-only; no TS counterpart needed) ---

_POSE_MIRROR_SWAP = {11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23}


def mirror_frame(frame: dict) -> dict:
    """Horizontal mirror: swap left/right hand blocks, swap pose L/R pairs, negate x."""
    mirrored = {"face": frame["face"].copy()}
    mirrored["face"][:, 0] = -mirrored["face"][:, 0]

    # Swap hand identity (mirrored left hand looks like a right hand) and negate x.
    mirrored["left_hand"] = frame["right_hand"].copy()
    mirrored["left_hand"][:, 0] = -mirrored["left_hand"][:, 0]
    mirrored["right_hand"] = frame["left_hand"].copy()
    mirrored["right_hand"][:, 0] = -mirrored["right_hand"][:, 0]

    pose = frame["pose"].copy()
    pose[:, 0] = -pose[:, 0]
    swapped_pose = pose.copy()
    for a, b in _POSE_MIRROR_SWAP.items():
        swapped_pose[a] = pose[b]
    mirrored["pose"] = swapped_pose

    return mirrored
