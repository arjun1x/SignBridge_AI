# SignBridge AI upgrade report

Source: `arjun1x/SignBridge_AI`, commit `9be850e91ff680fffb3607d608f9cb09b1e5ecd7`.
Review/update date: 2026-09-07. Delivered as an updated source folder and a baseline patch.

## Outcome

The interface and inference/training code are updated. The app remains an Electron
project; this is not a replacement marketing website or a deployed service.

**No new recognition weights were trained on real ASL data. No increase in real-world
accuracy or speed has been measured.** The public source tree has three model metadata
files, but no ONNX files, checkpoints or training datasets. The GitHub releases API
returned an empty list. Existing weights may be present only in the owner's ignored
local folders. They must be retained/reintroduced for recognition.

## Findings and changes

| Original issue | Change | Expected effect / limit |
| --- | --- | --- |
| Fingerspelling also ran holistic face/body tracking | HandLandmarker for letter mode; holistic only for signs | Removes unnecessary tracking work; device speed still needs measurement |
| Landmark detection ran synchronously in the renderer | Move tracking and ONNX to one recognition worker | Keeps React/motion/control rendering separate from vision computation |
| Every animation tick could classify the same camera frame | Fresh-video callbacks, currentTime fallback, 30 fps capture request | Avoids artificial FPS/stability from repeated video frames |
| Async inference calls could overlap and share mutable ring data | One transferred bitmap outstanding; immutable window snapshots and close/dispose | Bounds queues and protects inference inputs |
| Six-frame letter stability changed with effective FPS | Timed evidence, minimum observations, confidence/margin checks | More predictable hold behavior; not instantaneous recognition |
| A single alternate label could unlock the previous letter | Suppression persists until a real alternative commit or sustained release | Reduces duplicate-letter flicker |
| Holding a letter still could finish its word | Word boundaries require hands-away time or an explicit space | Held letters no longer split words merely for being still |
| Missing/failed model startup could leave UI marked running | Await load/camera success, stop/cancel cleanup, isolated run/mode ownership | Clear error/idle states; late grants are stopped |
| Random dummy model could generate speech | Remove automatic dummy fallback | No synthetic/random predictions presented as ASL |
| Metadata hashes were written but not actually checked in worker | Validate specs, labels, dimensions, calibration; compatible legacy label checks | Fails explicitly on mismatched artifacts |
| Augmentation modified padding and binary presence flags | Augment observed coordinates before padding; correct dropout flags | Restores the intended train/runtime feature contract |
| Fingerspelling used random image-only split | Real group split support, opt-in development-only fallback, three partitions | Makes evaluation limits visible and prevents group overlap |
| Training/evaluation lacked calibration and class-level report | Balanced sampler, early stopping, fine-tuning, temperature, test F1/confusion | Provides tools to measure and improve; data still controls quality |
| Large letter network without a compact experiment | Configurable 128-wide MLP and separate small sign config | Lower parameter count; accuracy/latency tradeoff unmeasured |
| Small camera and one-column cards; unqualified 98%/latency marketing | New responsive studio, actual confidence/timings, spacious 3D welcome | Clearer usage and honest status |
| Decorative work competed for display resources | Lazy 3D scene, 30 fps/DPR cap, hidden/offscreen pause, disposal | Scene does not coexist with recognition in normal navigation |
| Device scan requested microphone on initial render | Request permission only for explicit scan/connection action | No surprise microphone prompt on entering the studio |

## Verification performed

| Check | Result |
| --- | --- |
| TypeScript strict typecheck | Passed |
| Electron main/preload and React/worker production build | Passed |
| Runtime behavior tests | 12 passed |
| Python ML tests | 20 passed; affected five rerun after final split refinements |
| Python/TypeScript hand and sign normalization parity | Passed existing 1e-6 gates |
| PyTorch/ONNX Transformer and MLP export parity | Passed existing 1e-4 gates |
| Complete MLP train/calibrate/test/export on small synthetic fixture | Passed; temporary fixture weights excluded |
| MediaPipe ES-module loader export | Checked; module factory can be reinstalled for fallback |
| Pinned hand and holistic model download scripts | Completed successfully |
| All Python modules parse | Passed |
| UPDATES.patch against base commit | Checked during packaging |

Validation used Linux, Node 24 and Python 3.12 with CPU PyTorch. npm dependencies were
installed with scripts skipped for environment setup, then the asset-copy script was
run explicitly. Windows users should use normal `npm ci` to install Electron/native
runtime assets. Build output is not a tested Windows installer.

## Target-PC verification (2026-09-07, Windows 11, RTX 5060, USB webcam)

Performed on the owner's machine after merging this upgrade onto branch
`upgrade/source-2026-09-07`, using the existing `fingerspell_v1` / `signs_v1` weights
and the real STT/TTS resources. Driven through the Chrome DevTools Protocol against the
running Electron app; timings are wall-clock from the UI, not model-only benchmarks.

| Check | Result |
| --- | --- |
| `npm ci`, `npm run check` (typecheck, 12 runtime tests, production build) | Passed |
| `uv run pytest tests` (20 Python tests incl. Python/TypeScript parity) | Passed |
| Spec/label SHA-256 gates against installed v1 metadata | Match; both models load |
| Dev app (`localhost`) and packaged `app://` build | Both start; `crossOriginIsolated` true |
| `app://` assets (`mediapipe/*`, `models/*`, `ort/*`, `pcm-worklet.js`) | 200 with correct MIME types (module loader served as `text/javascript`) |
| MediaPipe in the module worker | `GPU tracking / WASM classifier` in both modes; CPU fallback path not exercised (GPU succeeded) |
| Fingerspell mode (HandLandmarker) | Camera on in 2.4–2.6 s; ~15 processed fps; 6–14 ms frame processing with no hand in view |
| Whole-sign mode (HolisticLandmarker) | Camera on in ~6 s (includes tracker warm-up); 9–14 processed fps; 40–100 ms frame processing |
| Mode switch signs↔fingerspell while running | Works; old worker terminated; ~1 s to ready |
| Stop / repeated start-stop | Track `ended`, `video.srcObject` cleared, restart OK |
| Camera permission denied | Explicit `NotAllowedError` in UI, state returns to idle, no leaked stream |
| Missing model metadata (fingerspell and signs) | Explicit "model is not installed" error in ~0.4 s; the dummy model is never used |
| Manual J/Z, backspace, space, clear | Correct buffer edits; Add space disabled when no word |
| Live captions (loopback → sherpa) | SAPI test sentence transcribed exactly in transcript and overlay |
| Neural voice routing | Piper output measured on `CABLE Output` (0.30 peak vs ~0 baseline) |
| Welcome 3D scene | Mounts in ~2 s with a live WebGL context; disposed (context lost) on entering the studio |
| No WebGL | Logo fallback shown, no errors |
| `prefers-reduced-motion` | Welcome opens in `motion-off`; entrance animations disabled; scene static |
| Responsive layout at 390 px / 768 px | No horizontal overflow; grids collapse as designed |
| Keyboard | Skip link present; visible focus rings on all controls |

Fixes made during this verification (not in the delivered patch):

- `ttsService`/`CallSetup`: the engine status query raced the Piper voice load and pinned the
  session to the system voice (which cannot `setSinkId` to a call device). It now polls while
  the voice files exist, and `speak()` re-checks lazily.
- `signWorker`: the tracker is warmed with a blank frame before `ready`. Holistic's first GPU
  inference took ~8 s, which would otherwise arrive after "Camera on" and trip the 10 s
  stalled-frame watchdog on slower GPUs.
- `main.ts` `app://` handler: missing files now return 404 instead of throwing
  `net::ERR_FILE_NOT_FOUND` when the renderer probes for optional newer model versions.

Observed, not changed: recognition pauses while the window is fully occluded
(`document.hidden`), by design. Importing `onnxruntime-web/webgpu` bundles an unused 24 MB
`asyncify` wasm into `out/renderer/assets`; the runtime uses the `jsep` build from `/ort`.

## Real-data fingerspelling training (2026-09-07, target PC)

Run with the new extraction → split → train/calibrate → test → export workflow on the
owner's local Kaggle ASL-alphabet images (no signer/session IDs exist for this dataset, so
the trainer was run with `--allow-ungrouped`: a stratified **image-level development split**,
not an unseen-signer measurement).

- Extraction (`fingerspell_extract`, pinned hand model, min confidence 0.6, exact-duplicate
  removal): **61,735 samples, 28 classes** (A–Z, space, del) from 87,000 images; 25,265 images
  had no usable hand. The `nothing` class yielded no detectable hands and was dropped.
- Split (seed 0): 43,243 train / 9,246 validation / 9,246 test; the test indices were scored
  exactly once per candidate after validation selection and calibration.

| model | test acc | test macro-F1 | accepted-frame acc (coverage) | params | classifier CPU p50 |
| --- | --- | --- | --- | --- | --- |
| `fingerspell_v1` (previous, 256-wide) | 98.69% | — | — | 89,372 | 0.015 ms |
| v2 candidate, 128-wide | 98.69% | 98.54% | 99.39% (90.8%) | 28,316 | 0.015 ms |
| **v2 candidate, 256-wide → installed as `fingerspell_v2`** | **99.04%** | 98.89% | 99.45% (91.2%) | 89,372 | 0.018 ms |

All three were scored on the identical 9,246 test images
(`ml/checkpoints/fingerspell_v2/compare_v1_v2.json`). Caveats: v1 was trained on a random
subset of these same source images, so its number is an upper bound; the v2 candidates never
saw their test images. The classifier is not the latency bottleneck at any width (hand
tracking costs 6–16 ms per frame in the app), so the 256-wide model was chosen on accuracy.
Validation temperature 0.68; ONNX↔PyTorch parity 3.8e-6. Weakest letters on test: N (93.6%),
M, R — the expected static-pose confusions. These are image-split numbers only; webcam and
unseen-signer accuracy remain unmeasured until grouped recordings exist. J/Z are still
rejected at runtime and need a temporal model.

Verified in the running app after `sync-model-to-app.mjs fingerspell_v2`: the worker validates
the spec hash, label checksum and calibration temperature and reports `fingerspell_v2 · on
device`; `fingerspell_v1` remains installed for rollback (delete the v2 files from
`apps/desktop/src/public/models/`).

## Not verified here

- A real webcam, actual hands or motion; no signed benchmark footage was supplied.
- GPU/CPU MediaPipe execution in an actual Chromium/Electron camera session, including
  the packaged app protocol. The module-loader compatibility fix is checked structurally.
- Target-PC latency, throughput, model accuracy, committed word error rate or usability.
- Browser visual testing, screen reader behavior, native Windows captions/virtual cable,
  installer packaging or Google OAuth. Run the concrete checks in CLAUDE_HANDOFF.md.

## Remaining product limits

J/Z are temporal; this version rejects automatic static J/Z predictions and exposes
manual letter controls. Whole signs retain the trained 64-frame contract and isolate
supported glosses. This is not a full ASL grammar translator or fluent continuous
fingerspelling decoder. Low-confidence and near-tie rejection reduce some false commits
but cannot establish open-set recognition without representative negative data.

The existing speech engines/transport were retained. Their native lifecycle, voice queue,
output cancellation and platform behavior remain part of target-PC integration review.
The original historical report/resume metrics were not re-measured.

## Package contents

The updated project includes every tracked file from the base plus new code, tests,
training configuration, this report, a per-file inventory, START_HERE and Claude handoff.
UPDATES.patch includes modified and added source files. Node modules, builds, caches,
Git internals, credentials, training data and downloaded model binaries are excluded.
No generated synthetic weights are shipped. No remote repository was changed.
