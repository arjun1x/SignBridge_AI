# Baseline file inventory

All 83 files tracked at base commit `9be850e91ff680fffb3607d608f9cb09b1e5ecd7` are included in the source delivery. Implementation files were read for behavior; dependency lockfiles and binary icons were inventoried/checked as assets, not audited as third-party source. Historical documentation contains earlier claims, not fresh benchmark evidence.

| File | Kind | Upgrade status |
| --- | --- | --- |
| `.gitignore` | Documentation/configuration | Preserved |
| `PROJECT_REPORT.md` | Documentation/configuration | Updated |
| `README.md` | Documentation/configuration | Updated |
| `RESUME.md` | Documentation/configuration | Updated |
| `apps/desktop/electron.vite.config.ts` | Source | Updated |
| `apps/desktop/electron/auth/googleAuth.ts` | Source | Preserved |
| `apps/desktop/electron/ipc/channels.ts` | Source | Preserved |
| `apps/desktop/electron/main.ts` | Source | Preserved |
| `apps/desktop/electron/preload.ts` | Source | Preserved |
| `apps/desktop/electron/stt/sttManager.ts` | Source | Preserved |
| `apps/desktop/electron/stt/sttProcess.ts` | Source | Preserved |
| `apps/desktop/electron/windows/mainWindow.ts` | Source | Updated |
| `apps/desktop/electron/windows/overlayWindow.ts` | Source | Preserved |
| `apps/desktop/package.json` | Documentation/configuration | Updated |
| `apps/desktop/resources/icon.ico` | Binary icon | Preserved |
| `apps/desktop/resources/icon.png` | Binary icon | Preserved |
| `apps/desktop/resources/icon.svg` | Vector icon | Preserved |
| `apps/desktop/src/capture/audioCapture.ts` | Source | Preserved |
| `apps/desktop/src/index.html` | Source | Updated |
| `apps/desktop/src/inference/debounce.ts` | Source | Preserved |
| `apps/desktop/src/inference/gating.ts` | Source | Preserved |
| `apps/desktop/src/inference/letterCommitter.ts` | Source | Updated |
| `apps/desktop/src/inference/signWorker.ts` | Source | Updated |
| `apps/desktop/src/main/AnimatedBackground.tsx` | Source | Updated |
| `apps/desktop/src/main/App.tsx` | Source | Updated |
| `apps/desktop/src/main/CallSetup.tsx` | Source | Updated |
| `apps/desktop/src/main/Logo.tsx` | Source | Updated |
| `apps/desktop/src/main/SignIn.tsx` | Source | Updated |
| `apps/desktop/src/main/SignPractice.tsx` | Source | Updated |
| `apps/desktop/src/main/main.tsx` | Source | Preserved |
| `apps/desktop/src/main/styles.css` | Source | Updated |
| `apps/desktop/src/nlp/sentenceAssembler.ts` | Source | Preserved |
| `apps/desktop/src/overlay.html` | Source | Preserved |
| `apps/desktop/src/overlay/Overlay.tsx` | Source | Preserved |
| `apps/desktop/src/overlay/main.tsx` | Source | Preserved |
| `apps/desktop/src/overlay/overlay.css` | Source | Preserved |
| `apps/desktop/src/public/pcm-worklet.js` | Source | Preserved |
| `apps/desktop/src/tts/ttsService.ts` | Source | Updated |
| `apps/desktop/src/types.d.ts` | Source | Preserved |
| `apps/desktop/src/vision/features.ts` | Source | Preserved |
| `apps/desktop/src/vision/fingerspellFeatures.ts` | Source | Preserved |
| `apps/desktop/src/vision/landmarker.ts` | Source | Updated |
| `apps/desktop/src/vision/signPipeline.ts` | Source | Updated |
| `apps/desktop/tsconfig.json` | Documentation/configuration | Preserved |
| `claude.md` | Documentation/configuration | Updated |
| `ml/README.md` | Documentation/configuration | Updated |
| `ml/configs/gislr_base.yaml` | Documentation/configuration | Preserved |
| `ml/pyproject.toml` | Documentation/configuration | Preserved |
| `ml/signbridge_ml/data/download.py` | Source | Preserved |
| `ml/signbridge_ml/data/preprocess.py` | Source | Preserved |
| `ml/signbridge_ml/datasets.py` | Source | Updated |
| `ml/signbridge_ml/evaluate.py` | Source | Preserved |
| `ml/signbridge_ml/export_onnx.py` | Source | Preserved |
| `ml/signbridge_ml/features.py` | Source | Preserved |
| `ml/signbridge_ml/fingerspell_extract.py` | Source | Updated |
| `ml/signbridge_ml/fingerspell_features.py` | Source | Preserved |
| `ml/signbridge_ml/fingerspell_train.py` | Source | Updated |
| `ml/signbridge_ml/make_dummy_model.py` | Source | Preserved |
| `ml/signbridge_ml/models/transformer.py` | Source | Preserved |
| `ml/signbridge_ml/train.py` | Source | Updated |
| `ml/tests/test_dataset.py` | Source | Preserved |
| `ml/tests/test_export_onnx.py` | Source | Preserved |
| `ml/tests/test_feature_parity.py` | Source | Preserved |
| `ml/tests/test_fingerspell_parity.py` | Source | Preserved |
| `ml/tests/test_mirror.py` | Source | Preserved |
| `ml/tests/test_model_smoke.py` | Source | Preserved |
| `ml/tests/test_preprocess.py` | Source | Preserved |
| `ml/uv.lock` | Dependency lock | Preserved |
| `models/fingerspell_v1.meta.json` | Model metadata (no weights) | Preserved |
| `models/signs_dummy.meta.json` | Model metadata (no weights) | Preserved |
| `models/signs_v1.meta.json` | Model metadata (no weights) | Preserved |
| `package-lock.json` | Dependency lock | Updated |
| `package.json` | Documentation/configuration | Updated |
| `scripts/copy-ort-assets.mjs` | Source | Updated |
| `scripts/download-mediapipe-model.mjs` | Source | Updated |
| `scripts/download-stt-model.mjs` | Source | Preserved |
| `scripts/download-tts-model.mjs` | Source | Preserved |
| `scripts/make-icon.mjs` | Source | Preserved |
| `scripts/run-ts-features.mjs` | Source | Preserved |
| `scripts/sync-model-to-app.mjs` | Source | Updated |
| `shared/feature_spec.json` | Documentation/configuration | Preserved |
| `shared/fingerspell_spec.json` | Documentation/configuration | Preserved |
| `shared/labels_fingerspell.json` | Documentation/configuration | Preserved |

New files are listed in UPDATES.patch and visible in the corresponding source directories. No ignored model binaries were available in the cloned baseline.
