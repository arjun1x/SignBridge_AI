# SignBridge ML

Training pipeline for the GISLR sign classifier. Everything runs through
[uv](https://docs.astral.sh/uv/) from this directory.

## One-time setup

1. Log into kaggle.com and **join the competition** (accept rules):
   https://www.kaggle.com/competitions/asl-signs/rules
2. kaggle.com/settings → API → **Create New Token**
3. Save the downloaded `kaggle.json` to `C:\Users\<you>\.kaggle\kaggle.json`

## Training runbook

```powershell
cd ml

# 1. Download GISLR (~55 GB raw). Resumable; skips if already present.
uv run python -m signbridge_ml.data.download

# 2. Preprocess parquet -> normalized feature tensors (participant-grouped
#    90/10 train/val split). Writes ml/data/processed/ and the real
#    shared/labels_gislr.json. Use --limit 500 first for a quick smoke run.
uv run python -m signbridge_ml.data.preprocess

# 3. Train (RTX 5060: expect roughly 1-2 min/epoch at batch 256, 80 epochs).
#    Checkpoints + config land in ml/checkpoints/gislr_base/.
uv run python -m signbridge_ml.train --config configs/gislr_base.yaml

# 4. Evaluate: top-1/top-5 and most-confused sign pairs.
uv run python -m signbridge_ml.evaluate --checkpoint checkpoints/gislr_base/best.pt

# 5. Export to ONNX (with PyTorch<->ONNXRuntime parity gate) and sync into
#    the app. Then flip MODEL_BASE in apps/desktop/src/vision/signPipeline.ts
#    from signs_dummy to signs_v1 and turn OFF "test mode" in the UI.
uv run python -m signbridge_ml.export_onnx --checkpoint checkpoints/gislr_base/best.pt --out-name signs_v1
cd ..
node scripts/sync-model-to-app.mjs signs_v1
```

## Tests

```powershell
uv run pytest tests/
```

`test_feature_parity.py` runs the real `apps/desktop/src/vision/features.ts`
via esbuild and asserts it matches `signbridge_ml/features.py` to <1e-6 —
run it after ANY change to either implementation or shared/feature_spec.json.

## GPU note

The RTX 5060 is Blackwell (sm_120): torch must come from the cu128 wheel
index (pinned in pyproject.toml). If `torch.cuda.is_available()` is False or
kernels fail to load, check `uv run python -c "import torch; print(torch.version.cuda)"`.
