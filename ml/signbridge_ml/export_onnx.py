"""Exports a trained checkpoint to ONNX with a static (1, 64, 184) input shape
(matches the runtime's fixed inference window, so no dynamic time axis is
needed), verifies PyTorch<->ONNXRuntime parity, and writes metadata carrying
feature-spec/label-map hashes so the app can refuse a mismatched model.

Usage: uv run python -m signbridge_ml.export_onnx --checkpoint checkpoints/gislr_base/best.pt
"""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
import yaml

from signbridge_ml.models.transformer import SignTransformer

ROOT = Path(__file__).resolve().parents[2]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", default="checkpoints/gislr_base/best.pt")
    parser.add_argument("--out-name", default="signs_v1")
    args = parser.parse_args()

    ckpt_path = ROOT / "ml" / args.checkpoint
    cfg = yaml.safe_load((ckpt_path.parent / "config.yaml").read_text())

    labels_path = ROOT / "shared" / "labels_gislr.json"
    labels = json.loads(labels_path.read_text())
    num_classes = len(labels)
    window = cfg["data"]["window_frames"]
    feature_dim = cfg["data"]["feature_dim"]

    model = SignTransformer(
        feature_dim=feature_dim, num_classes=num_classes, window_frames=window, **cfg["model"]
    )
    model.load_state_dict(torch.load(ckpt_path, map_location="cpu"))
    model.eval()

    dummy_x = torch.randn(1, window, feature_dim)
    dummy_mask = torch.ones(1, window, dtype=torch.bool)

    models_dir = ROOT / "models"
    models_dir.mkdir(exist_ok=True)
    onnx_path = models_dir / f"{args.out_name}.onnx"

    torch.onnx.export(
        model,
        (dummy_x, dummy_mask),
        str(onnx_path),
        opset_version=17,
        input_names=["features", "mask"],
        output_names=["logits"],
        dynamic_axes=None,  # static shape: runtime always sends exactly `window` frames
        dynamo=False,  # legacy TorchScript exporter: avoids the onnxscript dependency
    )

    # Parity check across several random inputs, including partial masks.
    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    max_diff = 0.0
    with torch.no_grad():
        for i in range(10):
            x = torch.randn(1, window, feature_dim)
            mask = torch.ones(1, window, dtype=torch.bool)
            if i % 2 == 0:
                mask[0, : np.random.randint(0, window // 2)] = False
            torch_out = model(x, mask).numpy()
            onnx_out = session.run(
                None, {"features": x.numpy(), "mask": mask.numpy()}
            )[0]
            max_diff = max(max_diff, float(np.abs(torch_out - onnx_out).max()))

    print(f"PyTorch<->ONNXRuntime max abs diff over 10 random inputs: {max_diff:.2e}")
    assert max_diff < 1e-4, "ONNX export parity check failed"

    best_metrics_path = ckpt_path.parent / "best_metrics.json"
    val_acc = json.loads(best_metrics_path.read_text())["val_acc"] if best_metrics_path.exists() else None

    meta = {
        "onnx_file": onnx_path.name,
        "feature_spec_sha256": _sha256(ROOT / "shared" / "feature_spec.json"),
        "labels_sha256": _sha256(labels_path),
        "num_classes": num_classes,
        "window_frames": window,
        "feature_dim": feature_dim,
        "val_acc": val_acc,
        "onnx_pytorch_max_diff": max_diff,
    }
    meta_path = models_dir / f"{args.out_name}.meta.json"
    meta_path.write_text(json.dumps(meta, indent=2))
    print(f"Wrote {onnx_path} and {meta_path}")


if __name__ == "__main__":
    main()
