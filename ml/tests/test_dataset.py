"""GislrDataset + one real optimization step over synthetic .npz sequences —
catches dataset/collation/masking bugs before the real overnight training run.
"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import DataLoader

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.datasets import GislrDataset  # noqa: E402
from signbridge_ml.models.transformer import SignTransformer  # noqa: E402

RNG = np.random.default_rng(11)
WINDOW = 64
FDIM = 184


def _make_processed_dir(tmp_path: Path, lengths: list[int]) -> pd.DataFrame:
    rows = []
    for i, t in enumerate(lengths):
        feats = RNG.normal(0, 1, size=(t, FDIM)).astype(np.float32)
        label = i % 5
        np.savez_compressed(tmp_path / f"seq{i}.npz", features=feats, label=np.int64(label))
        rows.append({"sequence_id": f"seq{i}", "label": label, "num_frames": t, "split": "train"})
    return pd.DataFrame(rows)


def test_pad_crop_and_mask(tmp_path):
    index = _make_processed_dir(tmp_path, lengths=[10, 64, 200])
    ds = GislrDataset(tmp_path, index, window_frames=WINDOW, train=False)

    short, short_mask, _ = ds[0]
    assert short.shape == (WINDOW, FDIM)
    assert short_mask.sum().item() == 10
    assert not short_mask[0]  # zero-padded at the START
    assert short_mask[-1]
    assert short[:54].abs().sum().item() == 0.0

    exact, exact_mask, _ = ds[1]
    assert exact.shape == (WINDOW, FDIM) and exact_mask.all()

    long, long_mask, _ = ds[2]
    assert long.shape == (WINDOW, FDIM) and long_mask.all()


def test_augmentations_dont_corrupt(tmp_path):
    index = _make_processed_dir(tmp_path, lengths=[50] * 8)
    ds = GislrDataset(
        tmp_path,
        index,
        window_frames=WINDOW,
        train=True,
        mirror_prob=1.0,
        affine_jitter_std=0.01,
        landmark_noise_std=0.005,
        hand_dropout_prob=1.0,
    )
    feats, mask, label = ds[0]
    assert feats.shape == (WINDOW, FDIM)
    assert torch.isfinite(feats).all()
    assert 0 <= label < 5
    # hand_dropout_prob=1.0 zeroes both hand blocks on the real frames
    assert feats[-1, 0:84].abs().sum().item() == 0.0


def test_one_training_step(tmp_path):
    index = _make_processed_dir(tmp_path, lengths=[30, 80, 64, 45])
    ds = GislrDataset(tmp_path, index, window_frames=WINDOW, train=True, mirror_prob=0.5)
    loader = DataLoader(ds, batch_size=4, shuffle=True)

    model = SignTransformer(feature_dim=FDIM, num_classes=5, window_frames=WINDOW, n_layers=1, d_model=64, ffn_dim=128)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-3)
    criterion = torch.nn.CrossEntropyLoss()

    feats, mask, labels = next(iter(loader))
    loss_before = criterion(model(feats, mask), labels)
    loss_before.backward()
    optimizer.step()
    optimizer.zero_grad()
    loss_after = criterion(model(feats, mask), labels)

    assert torch.isfinite(loss_before) and torch.isfinite(loss_after)
