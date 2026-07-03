import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.models.transformer import SignTransformer  # noqa: E402


def test_forward_shapes_and_masking():
    model = SignTransformer(feature_dim=184, num_classes=250, window_frames=64)
    x = torch.randn(8, 64, 184)
    mask = torch.ones(8, 64, dtype=torch.bool)
    mask[0, :10] = False  # simulate a short, start-padded sequence

    logits = model(x, mask)
    assert logits.shape == (8, 250)
    assert torch.isfinite(logits).all()


def test_forward_on_cuda_if_available():
    if not torch.cuda.is_available():
        return
    model = SignTransformer(feature_dim=184, num_classes=250, window_frames=64).cuda()
    x = torch.randn(4, 64, 184, device="cuda")
    mask = torch.ones(4, 64, dtype=torch.bool, device="cuda")
    with torch.autocast("cuda", dtype=torch.bfloat16):
        logits = model(x, mask)
    assert logits.shape == (4, 250)
    assert torch.isfinite(logits).all()
