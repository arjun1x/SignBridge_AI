"""Converts raw GISLR parquet landmark files into normalized feature tensors.

Each sequence -> ml/data/processed/{sequence_id}.npz with:
  features: (T, 184) float32   (see shared/feature_spec.json)
  label:    int64 scalar, index into shared/labels_gislr.json

Also writes:
  ml/data/processed/index.csv       (sequence_id, label, num_frames, split)
  shared/labels_gislr.json          (index -> gloss, sorted by index)

Split is participant-grouped (90/10) so no signer appears in both train and
val — a per-frame random split would leak signer-specific appearance.
"""
import argparse
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from tqdm import tqdm

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from signbridge_ml.features import extract_sequence_features  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "ml" / "data" / "raw"
PROCESSED_DIR = ROOT / "ml" / "data" / "processed"
LABELS_PATH = ROOT / "shared" / "labels_gislr.json"

LANDMARK_TYPES = ("face", "pose", "left_hand", "right_hand")
LANDMARK_COUNTS = {"face": 468, "pose": 33, "left_hand": 21, "right_hand": 21}


def _parquet_to_frames(path: Path) -> list[dict]:
    df = pd.read_parquet(path, columns=["frame", "type", "landmark_index", "x", "y", "z"])
    frames = []
    for _, frame_df in df.groupby("frame", sort=True):
        by_type = {t: g for t, g in frame_df.groupby("type")}
        frame = {}
        for t in LANDMARK_TYPES:
            n = LANDMARK_COUNTS[t]
            arr = np.full((n, 3), np.nan, dtype=np.float64)
            if t in by_type:
                g = by_type[t]
                idx = g["landmark_index"].to_numpy()
                arr[idx, 0] = g["x"].to_numpy()
                arr[idx, 1] = g["y"].to_numpy()
                arr[idx, 2] = g["z"].to_numpy()
            frame["face" if t == "face" else t] = arr
        frames.append(frame)
    return frames


def _process_one(args: tuple[str, str, int]) -> tuple[str, int, int] | None:
    rel_path, sequence_id, label = args
    out_path = PROCESSED_DIR / f"{sequence_id}.npz"
    if out_path.exists():
        with np.load(out_path) as d:
            return sequence_id, label, int(d["features"].shape[0])
    try:
        frames = _parquet_to_frames(RAW_DIR / rel_path)
        if not frames:
            return None
        feats = extract_sequence_features(frames)
        np.savez_compressed(out_path, features=feats, label=np.int64(label))
        return sequence_id, label, feats.shape[0]
    except Exception as err:  # keep going; report failures at the end
        print(f"FAILED {sequence_id}: {err}")
        return None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="process only N sequences (debug)")
    parser.add_argument("--workers", type=int, default=6)
    parser.add_argument("--val-fraction", type=float, default=0.1)
    args = parser.parse_args()

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    train_csv = pd.read_csv(RAW_DIR / "train.csv")
    with open(RAW_DIR / "sign_to_prediction_index_map.json") as f:
        sign_to_idx: dict[str, int] = json.load(f)

    LABELS_PATH.parent.mkdir(parents=True, exist_ok=True)
    idx_to_sign = {v: k for k, v in sign_to_idx.items()}
    LABELS_PATH.write_text(json.dumps([idx_to_sign[i] for i in range(len(idx_to_sign))], indent=2))
    print(f"Wrote {LABELS_PATH} ({len(idx_to_sign)} signs)")

    train_csv["label"] = train_csv["sign"].map(sign_to_idx)
    if args.limit:
        train_csv = train_csv.sample(n=min(args.limit, len(train_csv)), random_state=0)

    participants = train_csv["participant_id"].unique()
    rng = np.random.default_rng(0)
    rng.shuffle(participants)
    n_val = max(1, int(len(participants) * args.val_fraction))
    val_participants = set(participants[:n_val])

    jobs = list(
        zip(train_csv["path"], train_csv["sequence_id"].astype(str), train_csv["label"])
    )

    rows = []
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for result in tqdm(ex.map(_process_one, jobs, chunksize=8), total=len(jobs)):
            if result is not None:
                rows.append(result)

    participant_by_seq = dict(zip(train_csv["sequence_id"].astype(str), train_csv["participant_id"]))
    index_rows = [
        {
            "sequence_id": seq_id,
            "label": label,
            "num_frames": n_frames,
            "split": "val" if participant_by_seq[seq_id] in val_participants else "train",
        }
        for seq_id, label, n_frames in rows
    ]
    index_df = pd.DataFrame(index_rows)
    index_df.to_csv(PROCESSED_DIR / "index.csv", index=False)
    print(
        f"Processed {len(index_df)}/{len(jobs)} sequences "
        f"({(index_df['split'] == 'train').sum()} train / {(index_df['split'] == 'val').sum()} val)"
    )


if __name__ == "__main__":
    main()
