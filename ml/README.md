# SignBridge ML — real-data training guide

No recognition weights or training datasets are included in this source delivery.
Do not use the synthetic test fixtures as ASL training data. Improvements in this
version are to runtime and training code; real-world accuracy gains remain unmeasured.

Run Python commands from `ml/`. The existing `uv` environment targets Python 3.12
and PyTorch CUDA 12.8 for the original RTX 5060 setup; keep `pyproject.toml` and `uv.lock`.

## Fingerspelling: preserve and measure your baseline

Keep the original `fingerspell_v1.onnx`, metadata, and original class order. Use the
same held-out recordings and device when comparing versions. Measure committed-word
errors, accidental repeated letters, unknown-pose false accepts, and time to a stable
letter. Image-level top-1 accuracy alone does not capture those failures.

## Extract actual image data

If the Kaggle ASL Alphabet dataset is already downloaded:

```powershell
uv run python -m signbridge_ml.fingerspell_extract --raw-dir data/raw_alphabet/asl_alphabet_train/asl_alphabet_train --out-dir data/fingerspell_v2
```

Otherwise obtain the dataset `grassknoted/asl-alphabet` through your Kaggle account.
Use only data you have permission to use; the command does not accept terms or use
credentials automatically. Extraction uses the same pinned hand model/normalization
as the app. It removes exact duplicate images, rejects conflicting duplicate labels,
skips unusable/no-hand images, and saves:

- `features.npy` (N,63), `labels.npy` (N,), `class_names.json`.
- `samples.csv` with source path, ground-truth label, optional group and image hash.
- `groups.npy` only if a genuine group manifest was supplied.

`nothing` can include detected non-signing/transition hand poses. No-hand images are
rejected before classification, so they do not become artificial zero-feature samples.
J/Z images can be retained to help reject these poses; the runtime does not auto-commit
them as motion letters.

## Prefer grouped webcam data

Collect labeled examples with actual signers and independent recording sessions,
including both hands, confusing letters (M/N/T, A/S/E, U/V/R), varied viewpoints and
lighting, and non-signing hand poses. Avoid bursts of nearly identical frames as the
only validation evidence. Near-duplicates are not removed by exact image hashing.

Prepare a CSV with this schema (paths relative to the CSV). These names illustrate
the format; they are not supplied training examples:

```csv
path,label,group
images/signer01/session1/a01.jpg,A,signer01
images/signer01/session1/b01.jpg,B,signer01
images/signer02/session1/a01.jpg,A,signer02
```

Use the SAME group for every image of a signer when measuring unseen-signer behavior.
For personal calibration, use independent session IDs and report session generalization,
not unseen-signer generalization. The trainer requires at least seven groups and all
classes represented in every split. More balanced groups are preferable to the minimum.

```powershell
uv run python -m signbridge_ml.fingerspell_extract --manifest data/webcam/manifest.csv --out-dir data/fingerspell_webcam
uv run python -m signbridge_ml.fingerspell_train --data-dir data/fingerspell_webcam --name fingerspell_v2
```

If only the original ungrouped alphabet images exist, you must explicitly allow a
**development-only** split. It is stratified by label and may leak signer/capture style:

```powershell
uv run python -m signbridge_ml.fingerspell_train --data-dir data/fingerspell_v2 --allow-ungrouped --name fingerspell_v2
```

## Model selection and export

The default MLP is 63→128→128→C (28,316 parameters for C=28, compared with 89,372
in the original 256-wide network). Parameter reduction does not prove higher speed or
accuracy. Try `--width 256` if the compact model loses useful recognition accuracy.
Train only one candidate at a time on a small GPU.

Useful controls: `--epochs 80 --batch-size 512 --patience 12 --seed 0 --lr 0.001`.
Fine-tune a compatible new checkpoint with `--init-checkpoint path/to/best.pt`; its
adjacent `class_names.json` must match the dataset, and `--width` must match its layers.
This starts a fresh optimizer; it is not an interrupted-run resume.

The trainer chooses weights by validation macro F1, fits temperature on validation
only, then evaluates test exactly once. Never select among repeated experiments by
looking at test performance; reserve fresh test recordings after validation selection.
Default artifacts:

- `ml/checkpoints/fingerspell_v2/best.pt`, `class_names.json`, `split.json`, `report.json`.
- `models/fingerspell_v2.onnx`, `.meta.json`, `.labels.json`.

Read `report.json`: per-class recall, confusion pairs, accepted-frame precision/coverage,
validation/test split IDs and hashes, calibration, and CPU classifier p50/p95. That
benchmark excludes camera acquisition, tracking, frame transfers, stabilization and
speech. The UI's timing is captured-frame processing, not complete gesture-to-speech.

To score several exported candidates (and the previous model) on ONE trainer split's
untouched test indices, with classifier-only CPU latency and parameter counts:

```powershell
uv run python -m signbridge_ml.fingerspell_compare --data-dir data/fingerspell_v2 --split checkpoints/fingerspell_v2/split.json --models ../models/fingerspell_v1.onnx ../models/fingerspell_v2.onnx
```

Only install a candidate after evaluation:

```powershell
cd ..
node scripts/sync-model-to-app.mjs fingerspell_v2
npm run dev
```

v2 is preferred when valid files are installed. Keep v1 to roll back; remove the v2
files from `apps/desktop/src/public/models/` to restore v1 selection. No dummy fallback.

## Whole signs / GISLR

The original participant-grouped preprocessing pipeline is retained. A Kaggle token
and competition access are needed to download the data (large, approximately 55 GB
as described by the original runbook). Join/accept rules yourself on Kaggle.

```powershell
uv run python -m signbridge_ml.data.download
uv run python -m signbridge_ml.data.preprocess
uv run python -m signbridge_ml.train --config configs/gislr_base.yaml
uv run python -m signbridge_ml.evaluate --checkpoint checkpoints/gislr_base/best.pt
uv run python -m signbridge_ml.export_onnx --checkpoint checkpoints/gislr_base/best.pt --out-name signs_v2
cd ..
node scripts/sync-model-to-app.mjs signs_v2
```

Augmentation now leaves padding/missing points at zero, retains binary presence flags,
and clears a hand's presence flag when dropping that hand. Training supports early
stopping and `--init-checkpoint` for compatible weights. CPU debug runs can use
`--workers 0 --epochs 2`. A separate `configs/gislr_fast.yaml` uses a smaller Transformer
for experiments; it is not asserted to beat the baseline. Its checkpoints are stored
separately in `checkpoints/gislr_fast/`. Export those only after evaluating their tradeoff.
The original GISLR pipeline has train/validation only; use an independent webcam test
set for final comparisons. It does not inherit the fingerspelling three-way split.

## Validation

```powershell
uv run pytest tests/
```

Twenty Python tests passed in the delivery environment on CPU. In particular, Python
and real bundled TypeScript feature extraction agree within the existing 1e-6 gate.
ONNX export passes the existing 1e-4 parity gate. The small complete-training fixture
is explicitly synthetic and temporary; it demonstrates code execution, not ASL learning.

Motion J/Z and fluent continuous fingerspelling require real labeled video sequences,
a temporal model and sequence/word-level evaluation. They are not solved by increasing
the epochs of this static MLP. Do not add heuristic J/Z guesses and label them trained ML.
