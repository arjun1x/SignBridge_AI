"""Smoke-tests torch.onnx.export against our exact model shape (bool mask
input, TransformerEncoder) without touching the real shared/ artifacts —
export_onnx.py's full CLI is exercised manually once real training exists.
"""
import sys
import tempfile
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.models.transformer import SignTransformer  # noqa: E402


def test_onnx_export_parity():
    window, feature_dim, num_classes = 64, 184, 250
    model = SignTransformer(feature_dim=feature_dim, num_classes=num_classes, window_frames=window)
    model.eval()

    dummy_x = torch.randn(1, window, feature_dim)
    dummy_mask = torch.ones(1, window, dtype=torch.bool)

    with tempfile.TemporaryDirectory() as tmp:
        onnx_path = Path(tmp) / "model.onnx"
        torch.onnx.export(
            model,
            (dummy_x, dummy_mask),
            str(onnx_path),
            opset_version=17,
            input_names=["features", "mask"],
            output_names=["logits"],
            dynamic_axes=None,
            dynamo=False,  # legacy TorchScript exporter: no onnxscript dependency, well-tested for this graph
        )
        assert onnx_path.exists()

        session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        max_diff = 0.0
        with torch.no_grad():
            for i in range(5):
                x = torch.randn(1, window, feature_dim)
                mask = torch.ones(1, window, dtype=torch.bool)
                if i % 2 == 0:
                    mask[0, : np.random.randint(0, window // 2)] = False
                torch_out = model(x, mask).numpy()
                onnx_out = session.run(None, {"features": x.numpy(), "mask": mask.numpy()})[0]
                max_diff = max(max_diff, float(np.abs(torch_out - onnx_out).max()))

        assert max_diff < 1e-4, f"parity failed: max diff {max_diff}"
