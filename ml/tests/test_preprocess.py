"""Validates the parquet -> LandmarkFrame -> features path against a
synthetic parquet in the exact GISLR schema (frame, type, landmark_index,
x, y, z; absent landmarks simply missing rows) — so preprocessing bugs
surface here, not hours into the real unattended run.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.data.preprocess import LANDMARK_COUNTS, _parquet_to_frames  # noqa: E402
from signbridge_ml.features import extract_sequence_features  # noqa: E402

RNG = np.random.default_rng(3)


def _make_gislr_parquet(path: Path, n_frames: int = 5, drop_left_hand_in_frame: int = 2) -> None:
    rows = []
    for frame in range(n_frames):
        for t, count in LANDMARK_COUNTS.items():
            if t == "left_hand" and frame == drop_left_hand_in_frame:
                continue  # GISLR encodes undetected landmarks by omitting rows
            for i in range(count):
                rows.append(
                    {
                        "frame": frame,
                        "type": t,
                        "landmark_index": i,
                        "x": float(RNG.uniform(0, 1)),
                        "y": float(RNG.uniform(0, 1)),
                        "z": float(RNG.uniform(-0.1, 0.1)),
                    }
                )
    pd.DataFrame(rows).to_parquet(path)


def test_parquet_to_frames_and_features(tmp_path):
    pq = tmp_path / "seq.parquet"
    _make_gislr_parquet(pq, n_frames=5, drop_left_hand_in_frame=2)

    frames = _parquet_to_frames(pq)
    assert len(frames) == 5
    for i, frame in enumerate(frames):
        assert frame["face"].shape == (468, 3)
        assert frame["pose"].shape == (33, 3)
        assert frame["left_hand"].shape == (21, 3)
        assert frame["right_hand"].shape == (21, 3)
        if i == 2:
            assert np.isnan(frame["left_hand"]).all()  # omitted rows -> NaN
        else:
            assert not np.isnan(frame["left_hand"]).any()

    feats = extract_sequence_features(frames)
    assert feats.shape == (5, 184)
    assert not np.isnan(feats).any()  # NaN -> 0 after normalization
    assert feats[2, -2] == 0.0  # left-hand presence flag off in dropped frame
    assert feats[3, -2] == 1.0
