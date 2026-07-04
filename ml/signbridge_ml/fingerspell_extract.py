"""Extracts normalized hand-landmark features from the ASL alphabet image
dataset (grassknoted/asl-alphabet) using MediaPipe HandLandmarker, producing
ml/data/fingerspell/{features.npy, labels.npy} and shared/labels_fingerspell.json.

Classes: A-Z + space + del ('nothing' is dropped — the app never classifies
when no hand is detected). Images where no hand is found are skipped.
"""
import argparse
import json
import sys
import urllib.request
from pathlib import Path

import numpy as np
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.fingerspell_features import FEATURE_DIM, normalize_hand  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "ml" / "data" / "raw_alphabet" / "asl_alphabet_train" / "asl_alphabet_train"
OUT_DIR = ROOT / "ml" / "data" / "fingerspell"
MODEL_PATH = ROOT / "ml" / "data" / "hand_landmarker.task"
MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/latest/hand_landmarker.task"
)

CLASSES = [chr(c) for c in range(ord("A"), ord("Z") + 1)] + ["space", "del"]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--per-class", type=int, default=1500, help="images sampled per class")
    args = parser.parse_args()

    if not RAW_DIR.exists():
        print(f"Dataset not found at {RAW_DIR} — is the download finished?", file=sys.stderr)
        sys.exit(1)

    if not MODEL_PATH.exists():
        print("Downloading hand_landmarker.task...")
        MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)

    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    landmarker = vision.HandLandmarker.create_from_options(
        vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL_PATH)),
            running_mode=vision.RunningMode.IMAGE,
            num_hands=1,
            min_hand_detection_confidence=0.3,
        )
    )

    rng = np.random.default_rng(0)
    features: list[np.ndarray] = []
    labels: list[int] = []
    skipped = 0

    for label_idx, cls in enumerate(CLASSES):
        cls_dir = RAW_DIR / cls
        images = sorted(cls_dir.glob("*.jpg"))
        if len(images) > args.per_class:
            images = [images[i] for i in rng.choice(len(images), args.per_class, replace=False)]

        for img_path in tqdm(images, desc=cls, leave=False):
            image = mp.Image.create_from_file(str(img_path))
            result = landmarker.detect(image)
            if not result.hand_landmarks:
                skipped += 1
                continue
            pts = np.array([[lm.x, lm.y, lm.z] for lm in result.hand_landmarks[0]])
            is_left = result.handedness[0][0].category_name == "Left"
            features.append(normalize_hand(pts, is_left=is_left))
            labels.append(label_idx)

        print(f"{cls}: {labels.count(label_idx)} samples")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    feats = np.stack(features).astype(np.float32)
    labs = np.array(labels, dtype=np.int64)
    np.save(OUT_DIR / "features.npy", feats)
    np.save(OUT_DIR / "labels.npy", labs)
    (ROOT / "shared" / "labels_fingerspell.json").write_text(json.dumps(CLASSES, indent=2))

    assert feats.shape[1] == FEATURE_DIM
    print(f"\nDone: {feats.shape[0]} samples across {len(CLASSES)} classes ({skipped} images skipped, no hand)")


if __name__ == "__main__":
    main()
