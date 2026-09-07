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
        # Only observed coordinates are augmented. Padding is added AFTER this
        # function; the two binary hand-presence flags never receive noise.
        feats = feats.copy()
        coords = feats[:, :182].reshape(-1, 91, 2)
        observed = np.any(coords != 0.0, axis=-1)
        observed[:, :21] &= feats[:, 182:183] > 0.5
        observed[:, 21:42] &= feats[:, 183:184] > 0.5
        if self.affine_jitter_std > 0:
            angle = np.random.normal(0, self.affine_jitter_std * 3)
            scale = np.clip(1 + np.random.normal(0, self.affine_jitter_std), 0.9, 1.1)
            rotation = np.array([[np.cos(angle), -np.sin(angle)],
                                 [np.sin(angle), np.cos(angle)]], dtype=np.float32)
            coords[:] = coords @ rotation.T * scale
        if self.landmark_noise_std > 0:
            coords += np.random.normal(0, self.landmark_noise_std, coords.shape).astype(np.float32)
        coords[~observed] = 0
        if self.hand_dropout_prob > 0:
            for lo, hi, flag in [(0, 42, 182), (42, 84, 183)]:
                if np.random.random() < self.hand_dropout_prob:
                    feats[:, lo:hi] = 0.0
                    feats[:, flag] = 0.0
        return feats

    def __getitem__(self, i: int):
        row = self.rows.iloc[i]
        with np.load(self.dir / f"{row.sequence_id}.npz") as d:
            feats = d["features"].astype(np.float32)
            label = int(d["label"])

        if self.train and self.mirror_prob > 0 and np.random.random() < self.mirror_prob:
            feats = mirror_feature_sequence(feats)

        if self.train:
            feats = self._augment(feats)
        feats, mask = self._pad_or_crop(feats)

        return torch.from_numpy(feats), torch.from_numpy(mask), label
