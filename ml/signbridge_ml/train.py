"""Trains the GISLR sign classifier. Usage: uv run python -m signbridge_ml.train
--config configs/gislr_base.yaml
"""
import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
import torch
import yaml
from torch import nn
from torch.utils.data import DataLoader

from signbridge_ml.datasets import GislrDataset
from signbridge_ml.models.transformer import SignTransformer

ROOT = Path(__file__).resolve().parents[2]


def build_loaders(cfg: dict) -> tuple[DataLoader, DataLoader, int]:
    processed_dir = ROOT / "ml" / cfg["data"]["processed_dir"]
    index_df = pd.read_csv(processed_dir / "index.csv")
    num_classes = int(index_df["label"].max()) + 1

    if not {"train", "val"}.issubset(set(index_df["split"])):
        raise ValueError("Training requires nonempty train and validation splits")

    train_ds = GislrDataset(
        processed_dir,
        index_df[index_df["split"] == "train"],
        window_frames=cfg["data"]["window_frames"],
        train=True,
        **cfg["augment"],
    )
    val_ds = GislrDataset(
        processed_dir,
        index_df[index_df["split"] == "val"],
        window_frames=cfg["data"]["window_frames"],
        train=False,
    )

    train_loader = DataLoader(
        train_ds,
        batch_size=cfg["train"]["batch_size"],
        shuffle=True,
        num_workers=cfg["train"]["num_workers"],
        drop_last=False,
        pin_memory=torch.cuda.is_available(),
        persistent_workers=cfg["train"]["num_workers"] > 0,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=cfg["train"]["batch_size"],
        shuffle=False,
        num_workers=cfg["train"]["num_workers"] // 2,
        pin_memory=torch.cuda.is_available(),
    )
    return train_loader, val_loader, num_classes


def lr_at(step: int, steps_per_epoch: int, cfg: dict) -> float:
    warmup_steps = cfg["train"]["warmup_epochs"] * steps_per_epoch
    total_steps = cfg["train"]["epochs"] * steps_per_epoch
    base_lr = cfg["train"]["lr"]
    if step < warmup_steps:
        return base_lr * (step + 1) / max(1, warmup_steps)
    progress = (step - warmup_steps) / max(1, total_steps - warmup_steps)
    return base_lr * 0.5 * (1 + math.cos(math.pi * min(progress, 1.0)))


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: str) -> float:
    model.eval()
    correct, total = 0, 0
    for feats, mask, labels in loader:
        feats, mask, labels = feats.to(device, non_blocking=True), mask.to(device, non_blocking=True), labels.to(device, non_blocking=True)
        with torch.autocast(device, dtype=torch.bfloat16, enabled=device == "cuda" and torch.cuda.is_bf16_supported()):
            logits = model(feats, mask)
        correct += (logits.argmax(dim=-1) == labels).sum().item()
        total += labels.shape[0]
    return correct / max(1, total)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="configs/gislr_base.yaml")
    parser.add_argument("--init-checkpoint", type=Path, help="Fine-tune compatible model weights; starts a fresh optimizer")
    parser.add_argument("--epochs", type=int)
    parser.add_argument("--workers", type=int)
    args = parser.parse_args()

    cfg = yaml.safe_load((ROOT / "ml" / args.config).read_text())
    if args.epochs is not None:
        cfg["train"]["epochs"] = args.epochs
    if args.workers is not None:
        cfg["train"]["num_workers"] = args.workers
    if cfg["train"]["epochs"] < 1 or cfg["train"]["num_workers"] < 0:
        raise ValueError("epochs must be positive and workers nonnegative")
    torch.manual_seed(cfg["seed"])
    np.random.seed(cfg["seed"])

    device = "cuda" if torch.cuda.is_available() else "cpu"
    train_loader, val_loader, num_classes = build_loaders(cfg)
    steps_per_epoch = len(train_loader)
    print(f"device={device} num_classes={num_classes} steps/epoch={steps_per_epoch}")

    model = SignTransformer(
        feature_dim=cfg["data"]["feature_dim"],
        num_classes=num_classes,
        window_frames=cfg["data"]["window_frames"],
        **cfg["model"],
    ).to(device)

    if args.init_checkpoint:
        model.load_state_dict(torch.load(args.init_checkpoint, map_location=device, weights_only=True))
    if device == "cuda":
        torch.set_float32_matmul_precision("high")
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=cfg["train"]["lr"], weight_decay=cfg["train"]["weight_decay"]
    )
    criterion = nn.CrossEntropyLoss(label_smoothing=cfg["train"]["label_smoothing"])

    ckpt_dir = ROOT / "ml" / cfg["output"]["checkpoint_dir"]
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    (ckpt_dir / "config.yaml").write_text(yaml.dump(cfg))

    best_val_acc = -1.0
    stale_epochs = 0
    global_step = 0
    for epoch in range(cfg["train"]["epochs"]):
        model.train()
        t0 = time.time()
        running_loss = 0.0
        for feats, mask, labels in train_loader:
            feats, mask, labels = feats.to(device, non_blocking=True), mask.to(device, non_blocking=True), labels.to(device, non_blocking=True)
            lr = lr_at(global_step, steps_per_epoch, cfg)
            for g in optimizer.param_groups:
                g["lr"] = lr

            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device, dtype=torch.bfloat16, enabled=device == "cuda" and torch.cuda.is_bf16_supported()):
                logits = model(feats, mask)
                loss = criterion(logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), cfg["train"]["grad_clip"])
            optimizer.step()

            running_loss += loss.item()
            global_step += 1

        val_acc = evaluate(model, val_loader, device)
        avg_loss = running_loss / steps_per_epoch
        dt = time.time() - t0
        print(f"epoch {epoch+1}/{cfg['train']['epochs']} loss={avg_loss:.4f} val_acc={val_acc:.4f} ({dt:.1f}s)")

        torch.save(model.state_dict(), ckpt_dir / "last.pt")
        if val_acc > best_val_acc:
            stale_epochs = 0
            best_val_acc = val_acc
            torch.save(model.state_dict(), ckpt_dir / "best.pt")
            (ckpt_dir / "best_metrics.json").write_text(
                json.dumps({"epoch": epoch + 1, "val_acc": val_acc}, indent=2)
            )

        else:
            stale_epochs += 1
        patience = cfg["train"].get("patience", 15)
        if stale_epochs >= patience:
            print(f"Early stopping after {patience} epochs without validation improvement")
            break

    print(f"Best val_acc={best_val_acc:.4f} -> {ckpt_dir / 'best.pt'}")


if __name__ == "__main__":
    main()
