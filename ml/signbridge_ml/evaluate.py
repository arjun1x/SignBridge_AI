"""Evaluates a trained checkpoint on the val split: top-1/top-5 accuracy and
the 15 most-confused sign pairs. Usage:
uv run python -m signbridge_ml.evaluate --checkpoint checkpoints/gislr_base/best.pt
"""
import argparse
import json
from collections import Counter
from pathlib import Path

import pandas as pd
import torch
import yaml
from torch.utils.data import DataLoader

from signbridge_ml.datasets import GislrDataset
from signbridge_ml.models.transformer import SignTransformer

ROOT = Path(__file__).resolve().parents[2]


@torch.no_grad()
def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default="checkpoints/gislr_base/best.pt")
    args = parser.parse_args()

    ckpt_path = ROOT / "ml" / args.checkpoint
    cfg = yaml.safe_load((ckpt_path.parent / "config.yaml").read_text())

    processed_dir = ROOT / "ml" / cfg["data"]["processed_dir"]
    index_df = pd.read_csv(processed_dir / "index.csv")
    num_classes = int(index_df["label"].max()) + 1
    labels_gloss = json.loads((ROOT / "shared" / "labels_gislr.json").read_text())

    val_ds = GislrDataset(
        processed_dir, index_df[index_df["split"] == "val"], window_frames=cfg["data"]["window_frames"], train=False
    )
    val_loader = DataLoader(val_ds, batch_size=cfg["train"]["batch_size"], shuffle=False, num_workers=4)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SignTransformer(
        feature_dim=cfg["data"]["feature_dim"],
        num_classes=num_classes,
        window_frames=cfg["data"]["window_frames"],
        **cfg["model"],
    ).to(device)
    model.load_state_dict(torch.load(ckpt_path, map_location=device))
    model.eval()

    top1, top5, total = 0, 0, 0
    confusions = Counter()
    for feats, mask, labels in val_loader:
        feats, mask, labels = feats.to(device), mask.to(device), labels.to(device)
        logits = model(feats, mask)
        top5_pred = logits.topk(5, dim=-1).indices
        top1 += (top5_pred[:, 0] == labels).sum().item()
        top5 += (top5_pred == labels.unsqueeze(1)).any(dim=1).sum().item()
        total += labels.shape[0]

        wrong = top5_pred[:, 0] != labels
        for true_l, pred_l in zip(labels[wrong].tolist(), top5_pred[wrong, 0].tolist()):
            confusions[(labels_gloss[true_l], labels_gloss[pred_l])] += 1

    print(f"n={total} top1={top1/total:.4f} top5={top5/total:.4f}")
    print("\nMost confused (true -> predicted):")
    for (true_g, pred_g), count in confusions.most_common(15):
        print(f"  {true_g!r:>20} -> {pred_g!r:<20} x{count}")


if __name__ == "__main__":
    main()
