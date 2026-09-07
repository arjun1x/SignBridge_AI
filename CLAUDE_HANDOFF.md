# Claude Code handoff

## Goal

Merge this source upgrade into Arjun's existing SignBridge_AI checkout, preserve local
assets, then run real-data training and target-PC checks. The original user requested
faster, more reliable fingerspelling/sign recognition and a striking, smooth 3D frontend.

## Ground truth

- Source repo: https://github.com/arjun1x/SignBridge_AI
- Base commit: `9be850e91ff680fffb3607d608f9cb09b1e5ecd7`
- Existing stack retained: Electron 37, React 19, electron-vite, MediaPipe, ONNX Runtime
  Web, native sherpa STT/TTS, Python/PyTorch, npm workspaces and uv.
- This is a code upgrade. There are no newly trained recognition weights in this package.
- No source was pushed, merged or deployed remotely.

## Merge

1. Inspect current `git status` and history. Work on an isolated branch; preserve newer
   edits. Read the existing `claude.md` and any current AGENTS.md instructions.
2. Read `UPDATE_REPORT.md` and review `UPDATES.patch`. The patch is against the base
   commit above; use a three-way application/merge when your checkout has diverged.
   `git apply --check path/to/UPDATES.patch` checks applicability before application.
   Do not apply it to the already-updated source folder.
3. Preserve local ignored assets: `ml/data`, `ml/checkpoints`, recognition ONNX files,
   `shared/labels_gislr.json`, native STT/TTS resources, renderer models, credentials.
   Do not replace valid existing model metadata without the corresponding weights.
4. Install with the updated npm lockfile; `npm ci` runs the asset-copy postinstall.
   Run `npm run download:mediapipe` for both trackers, then sync matching trained
   recognition weights/metadata/labels. Existing v1 assets remain supported.

## Source changes worth reviewing closely

- `src/vision/signPipeline.ts`: one instance owns startup/camera/worker lifecycle;
  requestVideoFrameCallback with duplicate-frame fallback, a bounded ImageBitmap transfer,
  epoch checks on async completion, stale-result suppression, mode restarts, clean stop.
- `src/vision/landmarker.ts`: hand-only letter mode, holistic whole-sign mode, GPU/CPU
  fallback. It requires the **ES-module** MediaPipe loader. Do not substitute the old
  UMD loader in a module worker. Reinstall ModuleFactory for cached-import fallback.
- `src/inference/signWorker.ts`: tracking + ONNX off the UI thread, CPU-first small MLP,
  WebGPU/WASM sign classifier, tensor disposal, model validation and calibration.
- `src/inference/letterCommitter.ts`: probability/margin and timed evidence; duplicate
  suppression survives a one-frame alternate label. Motion J/Z are deliberately rejected.
- `src/main`: redesigned welcome/studio; Three.js lazy scene; reduced motion; actual
  landmarks/timings; editing; optional auto-speak; Google/guest flows; existing captions
  and audio routing retained. Three.js is the only new runtime library.
- `ml/signbridge_ml`: fixed augmentation, extraction provenance, split guards, compact
  fingerspell training, early stopping, fine-tuning, validation calibration, test report.

## Already verified here

- `npm run check`: TypeScript, 12 runtime tests, production Electron/renderer build.
- Python suite: 20 tests, including real Python↔TypeScript feature parity, PyTorch↔ONNX
  parity, augmentation/split checks and one complete synthetic training/export fixture.
- Pinned hand and holistic tracker downloads completed.
- Source patch applies to the recorded baseline (see UPDATE_REPORT after packaging).

## Next: target-PC checks (not performed in the delivery environment)

1. Start the actual Windows app with existing v1 weights; validate both fingerspelling
   and sign modes, not just a web-renderer preview. Confirm MediaPipe initialization in
   the module worker on GPU and CPU fallback, both dev and packaged `app://` builds.
2. Test camera denial, late permission response after Cancel, disconnect, repeated
   start/stop, rapid mode changes and hidden/restored window. Confirm camera light turns
   off when stopped. Missing/corrupt assets should show an error, never nonsense speech.
3. Verify left/right handedness using actual camera pixels and left/right signs; the
   preview alone is mirrored. Test two hands appearing/disappearing and unknown poses.
4. Fingerspell HELLO, LETTER, BOOK and names. Check repeated-letter release, hand-held
   word boundaries, manual J/Z, space/delete, buffer edits and stale-result rejection.
5. Measure webcam processing p50/p95, processed fps and stable-letter commit latency on
   the same recordings and machine for baseline vs updated runtime. Include tracking
   cost; never describe the MLP-only benchmark as end-to-end latency. The 85/140 ms holds
   are configuration, not measured performance.
6. Test Windows loopback captions and VB-Cable routing, neural voice readiness, self-
   monitor and echo guard. The native speech engine was preserved and needs its original
   platform tests. Review the existing TTS queue/cancellation behavior during rapid speech.
7. Visually check welcome/studio at 390, 768, 1240 and 1920 px, 200% zoom, keyboard only,
   reduced motion and no WebGL. Verify the 3D scene is disposed on opening the studio.

## Then train with real data

Follow `ml/README.md`. Start with fingerspelling because the user prioritizes fingers.
Prefer existing extracted landmarks as a baseline, then add independently grouped real
webcam examples and difficult/neutral poses. Do not invent signer IDs or treat adjacent
frames as independent signers. Keep the test split untouched while tuning on validation.

Compare a compact 128-wide and original-size 256-wide model by validation metrics and
actual device latency. Keep the better candidate based on the accuracy/latency tradeoff.
Install through `sync-model-to-app.mjs` only after passing parity and held-out checks.
The new files are `fingerspell_v2` / `signs_v2`, leaving v1 available for rollback.

J/Z need a separately trained temporal model from real trajectory clips; the current
static model cannot solve them. Full continuous ASL grammar translation is a separate
research task. State these limits and measured outcomes plainly when reporting back.
