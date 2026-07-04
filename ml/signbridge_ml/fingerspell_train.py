"""Trains the fingerspelling letter classifier (63-dim normalized hand
landmarks -> MLP -> 28 classes), evaluates, and exports fingerspell_v1.onnx
with metadata. Small enough to train in a couple of minutes on GPU.

Usage: uv run python -m signbridge_ml.fingerspell_train
"""
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from torch import nn

from signbridge_ml.fingerspell_features import FEATURE_DIM

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "ml" / "data" / "fingerspell"

EPOCHS = 40
BATCH = 512
LR = 1e-3
NOISE_STD = 0.01  # landmark jitter augmentation, in normalized units


class FingerspellMlp(nn.Module):
    def __init__(self, num_classes: int):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(FEATURE_DIM, 256),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(256, 256),
            nn.GELU(),
            nn.Dropout(0.2),
            nn.Linear(256, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def main() -> None:
    features = np.load(DATA_DIR / "features.npy")
    labels = np.load(DATA_DIR / "labels.npy")
    classes = json.loads((ROOT / "shared" / "labels_fingerspell.json").read_text())
    num_classes = len(classes)
    print(f"{features.shape[0]} samples, {num_classes} classes")

    rng = np.random.default_rng(0)
    order = rng.permutation(len(features))
    n_val = len(features) // 10
    val_idx, train_idx = order[:n_val], order[n_val:]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    x_train = torch.from_numpy(features[train_idx]).to(device)
    y_train = torch.from_numpy(labels[train_idx]).to(device)
    x_val = torch.from_numpy(features[val_idx]).to(device)
    y_val = torch.from_numpy(labels[val_idx]).to(device)

    model = FingerspellMlp(num_classes).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=1e-4)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_acc, best_state = 0.0, None
    for epoch in range(EPOCHS):
        model.train()
        perm = torch.randperm(len(x_train), device=device)
        total_loss = 0.0
        for i in range(0, len(perm), BATCH):
            idx = perm[i : i + BATCH]
            xb = x_train[idx] + torch.randn_like(x_train[idx]) * NOISE_STD
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(xb), y_train[idx])
            loss.backward()
            optimizer.step()
            total_loss += loss.item() * len(idx)

        model.eval()
        with torch.no_grad():
            val_acc = (model(x_val).argmax(-1) == y_val).float().mean().item()
        if val_acc > best_acc:
            best_acc = val_acc
            best_state = {k: v.clone() for k, v in model.state_dict().items()}
        if (epoch + 1) % 10 == 0 or epoch == 0:
            print(f"epoch {epoch+1}/{EPOCHS} loss={total_loss/len(x_train):.4f} val_acc={val_acc:.4f}")

    print(f"best val_acc={best_acc:.4f}")
    model.load_state_dict(best_state)
    model.eval().cpu()

    models_dir = ROOT / "models"
    models_dir.mkdir(exist_ok=True)
    onnx_path = models_dir / "fingerspell_v1.onnx"
    torch.onnx.export(
        model,
        (torch.randn(1, FEATURE_DIM),),
        str(onnx_path),
        opset_version=17,
        input_names=["features"],
        output_names=["logits"],
        dynamo=False,
    )

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    max_diff = 0.0
    with torch.no_grad():
        for _ in range(10):
            x = torch.randn(1, FEATURE_DIM)
            diff = np.abs(model(x).numpy() - session.run(None, {"features": x.numpy()})[0]).max()
            max_diff = max(max_diff, float(diff))
    assert max_diff < 1e-4, f"ONNX parity failed: {max_diff}"
    print(f"ONNX parity max diff: {max_diff:.2e}")

    spec_hash = hashlib.sha256((ROOT / "shared" / "fingerspell_spec.json").read_bytes()).hexdigest()
    (models_dir / "fingerspell_v1.meta.json").write_text(
        json.dumps(
            {
                "onnx_file": "fingerspell_v1.onnx",
                "fingerspell_spec_sha256": spec_hash,
                "num_classes": num_classes,
                "feature_dim": FEATURE_DIM,
                "val_acc": best_acc,
                "onnx_pytorch_max_diff": max_diff,
            },
            indent=2,
        )
    )
    print(f"Wrote {onnx_path}")


if __name__ == "__main__":
    main()
