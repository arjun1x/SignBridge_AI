"""Exports a randomly-initialized SignTransformer to ONNX so the app's
real-time inference pipeline (buffering, worker, debounce) can be built and
tested before real GISLR training data is available. Predictions are
garbage; this only proves the plumbing. Re-run signbridge_ml.export_onnx on
a real checkpoint once training data + a trained model exist, and it will
overwrite shared/labels_gislr.json with the real 250 signs.

Usage: uv run python -m signbridge_ml.make_dummy_model
"""
import json
from pathlib import Path

import torch
import yaml

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    labels_path = ROOT / "shared" / "labels_gislr.json"
    if not labels_path.exists():
        placeholder_labels = [f"sign_{i:03d}" for i in range(250)]
        labels_path.parent.mkdir(parents=True, exist_ok=True)
        labels_path.write_text(json.dumps(placeholder_labels, indent=2))
        print(f"Wrote placeholder labels to {labels_path} (real preprocessing will overwrite this)")
    else:
        print(f"Using existing {labels_path}")

    cfg = yaml.safe_load((ROOT / "ml" / "configs" / "gislr_base.yaml").read_text())

    from signbridge_ml.models.transformer import SignTransformer

    num_classes = len(json.loads(labels_path.read_text()))
    model = SignTransformer(
        feature_dim=cfg["data"]["feature_dim"],
        num_classes=num_classes,
        window_frames=cfg["data"]["window_frames"],
        **cfg["model"],
    )

    ckpt_dir = ROOT / "ml" / "checkpoints" / "dummy"
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), ckpt_dir / "last.pt")
    (ckpt_dir / "config.yaml").write_text(yaml.dump(cfg))
    print(f"Wrote random-init checkpoint to {ckpt_dir / 'last.pt'}")


if __name__ == "__main__":
    main()
