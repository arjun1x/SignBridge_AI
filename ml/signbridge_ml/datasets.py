"""Loads preprocessed GISLR sequences (ml/data/processed/*.npz) and pads/crops
them to a fixed window matching shared/feature_spec.json (window.frames=64) —
the same length the runtime always feeds the model, so no train/inference
length mismatch and no dynamic ONNX axis is needed.
"""
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

# Feature vector layout (see shared/feature_spec.json): [0:42) left_hand,
# [42:84) right_hand, [84:102) pose (9 pts, order = feature_spec pose subset:
# nose, L-shoulder, R-shoulder, L-elbow, R-elbow, L-wrist, R-wrist, L-hip,
# R-hip), [102:182) lips, [182:184) presence flags [left, right].
_POSE_MIRROR_PERM = [0, 2, 1, 4, 3, 6, 5, 8, 7]


def mirror_feature_sequence(feats: np.ndarray) -> np.ndarray:
    """Mirror an already-extracted (T, 184) feature sequence: swap hand
    identity, swap pose L/R pairs, negate every x column, swap presence
    flags. Lips are x-negated without a symmetric-vertex remap (a small,
    accepted approximation — mouth shape still mirrors, individual contour
    point identity may be slightly off) since MediaPipe's face-mesh L/R
    vertex correspondence table is out of scope for this project.
    """
    out = feats.copy()

    left, right = feats[:, 0:42].copy(), feats[:, 42:84].copy()
    out[:, 0:42], out[:, 42:84] = right, left
    out[:, 0:42:2] *= -1
    out[:, 42:84:2] *= -1

    pose = feats[:, 84:102].reshape(-1, 9, 2)[:, _POSE_MIRROR_PERM, :].reshape(-1, 18).copy()
    pose[:, 0::2] *= -1
    out[:, 84:102] = pose

    lips = feats[:, 102:182].copy()
    lips[:, 0::2] *= -1
    out[:, 102:182] = lips

    out[:, 182], out[:, 183] = feats[:, 183].copy(), feats[:, 182].copy()
    return out


class GislrDataset(Dataset):
    def __init__(
        self,
        processed_dir: Path,
        index_df: pd.DataFrame,
        window_frames: int,
        train: bool,
        mirror_prob: float = 0.0,
        affine_jitter_std: float = 0.0,
        landmark_noise_std: float = 0.0,
        hand_dropout_prob: float = 0.0,
    ):
        self.dir = Path(processed_dir)
        self.rows = index_df.reset_index(drop=True)
        self.window = window_frames
        self.train = train
        self.mirror_prob = mirror_prob
        self.affine_jitter_std = affine_jitter_std
        self.landmark_noise_std = landmark_noise_std
        self.hand_dropout_prob = hand_dropout_prob

    def __len__(self) -> int:
        return len(self.rows)

    def _pad_or_crop(self, feats: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        t = feats.shape[0]
        w = self.window
        if t == w:
            return feats, np.ones(w, dtype=bool)
        if t > w:
            start = np.random.randint(0, t - w + 1) if self.train else (t - w) // 2
            return feats[start : start + w], np.ones(w, dtype=bool)
        # zero-pad at the start (matches feature_spec.json pad_mode)
        pad = np.zeros((w - t, feats.shape[1]), dtype=feats.dtype)
        mask = np.concatenate([np.zeros(w - t, dtype=bool), np.ones(t, dtype=bool)])
        return np.concatenate([pad, feats], axis=0), mask

    def _augment(self, feats: np.ndarray) -> np.ndarray:
        # Jitter/noise applied directly in (already-normalized) feature space
        # rather than re-deriving from raw landmarks — equivalent for small
        # perturbations and far simpler.
        if self.affine_jitter_std > 0:
            feats = feats + np.random.normal(0, self.affine_jitter_std, size=(1, feats.shape[1])).astype(
                np.float32
            )
        if self.landmark_noise_std > 0:
            feats = feats + np.random.normal(0, self.landmark_noise_std, size=feats.shape).astype(np.float32)
        if self.hand_dropout_prob > 0:
            if np.random.random() < self.hand_dropout_prob:
                feats[:, 0:42] = 0.0
            if np.random.random() < self.hand_dropout_prob:
                feats[:, 42:84] = 0.0
        return feats

    def __getitem__(self, i: int):
        row = self.rows.iloc[i]
        with np.load(self.dir / f"{row.sequence_id}.npz") as d:
            feats = d["features"].astype(np.float32)
            label = int(d["label"])

        if self.train and self.mirror_prob > 0 and np.random.random() < self.mirror_prob:
            feats = mirror_feature_sequence(feats)

        feats, mask = self._pad_or_crop(feats)
        if self.train:
            feats = self._augment(feats)

        return torch.from_numpy(feats), torch.from_numpy(mask), label
