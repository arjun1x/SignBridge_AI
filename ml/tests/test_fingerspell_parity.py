"""Parity fixture for the fingerspelling hand-normalization: Python and TS
implementations must agree to <1e-6 (same contract as test_feature_parity)."""
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.fingerspell_features import FEATURE_DIM, normalize_hand  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts" / "run-ts-features.mjs"
RNG = np.random.default_rng(21)


def _run_ts(items: list[dict]) -> np.ndarray:
    result = subprocess.run(
        ["node", str(RUNNER), "hand"],
        input=json.dumps(items),
        capture_output=True,
        text=True,
        cwd=str(ROOT),
        timeout=60,
    )
    if result.returncode != 0:
        raise RuntimeError(f"TS runner failed:\n{result.stderr}")
    return np.array(json.loads(result.stdout), dtype=np.float64)


def test_hand_normalization_parity():
    hands = [RNG.uniform(0, 1, size=(21, 3)) for _ in range(6)]
    flags = [i % 2 == 0 for i in range(6)]

    py = np.stack([normalize_hand(h, is_left=f) for h, f in zip(hands, flags)]).astype(np.float64)
    ts = _run_ts([{"hand": h.flatten().tolist(), "isLeft": f} for h, f in zip(hands, flags)])

    assert py.shape == ts.shape == (6, FEATURE_DIM)
    max_diff = np.max(np.abs(py - ts))
    assert max_diff < 1e-6, f"fingerspell parity broke: {max_diff}"


def test_mirror_makes_left_equal_right():
    """A left hand that is the exact mirror of a right hand must normalize to
    the same canonical feature vector."""
    right = RNG.uniform(0, 1, size=(21, 3))
    left = right.copy()
    left[:, 0] = -left[:, 0]
    a = normalize_hand(right, is_left=False)
    b = normalize_hand(left, is_left=True)
    assert np.allclose(a, b, atol=1e-6)


def test_scale_and_translation_invariance():
    hand = RNG.uniform(0, 1, size=(21, 3))
    shifted = hand * 2.5 + np.array([0.3, -0.2, 0.1])
    assert np.allclose(normalize_hand(hand, False), normalize_hand(shifted, False), atol=1e-5)
