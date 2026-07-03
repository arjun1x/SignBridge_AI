import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.datasets import mirror_feature_sequence  # noqa: E402
from signbridge_ml.features import extract_sequence_features, mirror_frame  # noqa: E402

RNG = np.random.default_rng(7)


def _random_frame() -> dict:
    return {
        "left_hand": RNG.uniform(-1, 1, size=(21, 3)),
        "right_hand": RNG.uniform(-1, 1, size=(21, 3)),
        "pose": RNG.uniform(-1, 1, size=(33, 3)),
        "face": RNG.uniform(-1, 1, size=(468, 3)),
    }


def test_mirror_is_involutive():
    feats = extract_sequence_features([_random_frame() for _ in range(5)])
    twice = mirror_feature_sequence(mirror_feature_sequence(feats))
    assert np.allclose(feats, twice, atol=1e-6)


def test_feature_space_mirror_matches_raw_landmark_mirror():
    frames = [_random_frame() for _ in range(5)]
    feats = extract_sequence_features(frames)
    mirrored_via_features = mirror_feature_sequence(feats)
    mirrored_via_raw = extract_sequence_features([mirror_frame(f) for f in frames])
    assert np.allclose(mirrored_via_features, mirrored_via_raw, atol=1e-5)
