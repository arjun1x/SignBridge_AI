"""Parity fixture: the Python and TypeScript feature extractors must produce
identical output (max abs diff < 1e-6) for the same raw landmarks.
Runs the real apps/desktop/src/vision/features.ts via scripts/run-ts-features.mjs
(esbuild-bundled) so this test fails if the two implementations ever drift.
"""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.features import extract_frame_features  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "run-ts-features.mjs"

RNG = np.random.default_rng(42)


def _random_points(n: int, missing_prob: float = 0.0) -> np.ndarray:
    pts = RNG.uniform(0.0, 1.0, size=(n, 3)).astype(np.float64)
    if missing_prob > 0:
        mask = RNG.random(n) < missing_prob
        pts[mask] = np.nan
    return pts


def _make_frame(missing_prob: float = 0.0) -> dict:
    return {
        "left_hand": _random_points(21, missing_prob),
        "right_hand": _random_points(21, missing_prob),
        "pose": _random_points(33, missing_prob),
        "face": _random_points(468, missing_prob),
    }


def _frame_to_json(frame: dict) -> dict:
    def flat(arr: np.ndarray) -> list:
        return [None if np.isnan(v) else float(v) for v in arr.flatten()]

    return {
        "leftHand": flat(frame["left_hand"]),
        "rightHand": flat(frame["right_hand"]),
        "pose": flat(frame["pose"]),
        "face": flat(frame["face"]),
    }


def _run_ts(frames: list[dict]) -> np.ndarray:
    payload = json.dumps([_frame_to_json(f) for f in frames])
    result = subprocess.run(
        ["node", str(RUNNER)],
        input=payload,
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"TS runner failed:\n{result.stderr}")
    return np.array(json.loads(result.stdout), dtype=np.float64)


@pytest.fixture(scope="module")
def frames():
    return [
        _make_frame(missing_prob=0.0),  # fully populated
        _make_frame(missing_prob=0.3),  # scattered missing landmarks
        _make_frame(missing_prob=1.0),  # everything missing (fallback paths)
    ]


def test_python_ts_parity(frames):
    py_feats = np.stack([extract_frame_features(f) for f in frames]).astype(np.float64)
    ts_feats = _run_ts(frames)

    assert py_feats.shape == ts_feats.shape
    max_diff = np.max(np.abs(py_feats - ts_feats))
    assert max_diff < 1e-6, f"Python/TS feature parity broke: max abs diff = {max_diff}"


def test_no_shoulders_falls_back_to_nose():
    frame = _make_frame(missing_prob=0.0)
    frame["pose"][11] = np.nan
    frame["pose"][12] = np.nan
    feat = extract_frame_features(frame)
    assert not np.isnan(feat).any()


def test_presence_flags_reflect_wrist_detection():
    frame = _make_frame(missing_prob=0.0)
    frame["left_hand"][0] = np.nan
    feat = extract_frame_features(frame)
    assert feat[-2] == 0.0  # left_hand_present
    assert feat[-1] == 1.0  # right_hand_present
