# SignBridge AI — Technical Project Summary (Resume Reference)

A real-time, two-way ASL accessibility layer for video calls, built solo in ~5 weeks.
Sign language captured on webcam becomes a synthesized **voice inside Discord/Zoom**;
everything said in the call becomes **live on-screen captions**. Every model runs
**100% on-device** — no cloud APIs, no data leaves the machine.

Repo: https://github.com/arjun1x/SignBridge_AI

---

## Copy-paste resume bullets

> **SignBridge AI** — Real-time bidirectional ASL accessibility app (Electron, React, PyTorch, ONNX)
>
> - Trained a **1.2M-parameter Transformer** sign-language classifier on **94,477 landmark sequences (250 ASL signs)**, reaching **74% top-1 / 91% top-5** validation accuracy in ~40 min on a single RTX 5060 (bf16 mixed precision); deployed via ONNX Runtime Web (WebGPU/WASM) for **real-time in-app inference at 37–82 FPS**.
> - Built a **fingerspelling recognizer (98.0% validation accuracy, 28 classes)** by extracting MediaPipe hand landmarks from 42K images and training a compact MLP — enabling unlimited vocabulary by spelling words letter-by-letter with space/delete gesture editing.
> - Engineered a **train/runtime feature contract**: identical landmark normalization implemented in both Python (training) and TypeScript (inference), fixture-tested to **<1e-6 parity** by executing the real TS through esbuild inside the Python test suite; ONNX exports carry feature-spec hashes so drifted models refuse to load.
> - Shipped **live captioning at <1.5 s latency** from Windows WASAPI loopback audio using streaming Zipformer STT (sherpa-onnx) running **~22× real-time on CPU** in an isolated Electron utility process, with zero-copy PCM transport over transferred MessagePorts.
> - Routed **neural TTS (Piper, ~6× real-time)** into call apps as a virtual microphone via VB-Audio Cable + `setSinkId`, with echo-safe capture gating; integrated Google OAuth 2.0 (PKCE, loopback redirect) and packaged a Windows NSIS installer with a custom `app://` protocol preserving cross-origin isolation.

---

## Machine learning (what was built, trained, and measured)

### 1. Isolated sign recognition — Transformer sequence classifier
- **Data:** Google GISLR dataset (Kaggle) — **94,477 sequences, 250 ASL signs**, 40 GB
  of MediaPipe Holistic landmarks; preprocessed to normalized tensors with a
  **participant-grouped 90/10 split** (84,990 train / 9,487 val — no signer leakage).
- **Features:** 543 raw landmarks/frame reduced to a **184-dim vector** (42 hand pts ×2,
  9 upper-body pose pts, 40 lip pts, ×(x,y) + 2 hand-presence flags), shoulder-centered
  and shoulder-width-scaled.
- **Architecture:** linear embed → depthwise Conv1D stem → **3× pre-norm Transformer
  encoder layers** (d=192, 4 heads) → masked mean-pool → 250-way head. ~**1.2M params**.
- **Training:** 80 epochs, batch 256, AdamW + cosine schedule with warmup, label
  smoothing 0.1, **bf16 AMP on RTX 5060 (Blackwell sm_120, CUDA 12.8)** — ~22–45 s/epoch,
  full run ≈ 40 minutes.
- **Augmentation:** temporal resampling, affine jitter, landmark noise, random hand
  dropout, and **horizontal mirroring with left/right landmark identity swap**
  (verified equivalent to raw-landmark mirroring by unit test).
- **Results: 73.97% top-1, 90.83% top-5** on held-out signers. Residual confusions are
  semantically near-identical sign pairs (wake↔awake, listen↔hear, pen↔pencil).

### 2. Fingerspelling — static hand-pose classifier
- **Data built from scratch:** ran MediaPipe HandLandmarker over the 87K-image ASL
  Alphabet dataset (sampled 42K), yielding **33,033 landmark samples across 28 classes**
  (A–Z + space + delete); 85% detection yield.
- **Features:** 63-dim (21 landmarks × xyz), wrist-centered, hand-size-scaled, and
  **left/right canonicalized by mirroring** — works with either hand.
- **Model:** MLP 63→256→256→28 (~82K params), 40 epochs in under a minute on GPU.
- **Results: 98.0% validation accuracy** (re-verified at 98.05% through the exported
  ONNX). Letters commit after a 6-frame stable hold at ≥65% confidence; repeated
  letters require a pose break — standard fingerspelling UX.

### 3. Speech models (integrated + tuned, not trained)
- **STT:** sherpa-onnx **streaming Zipformer transducer** (int8 encoder/joiner) —
  measured **~22× real-time on CPU** (6.6 s audio decoded in 301 ms); endpoint-based
  caption finalization; **<1.5 s end-to-end caption latency**.
- **TTS:** **Piper (VITS)** neural voice — **~6× real-time** (2.8 s of speech in 472 ms),
  peak-normalized to 0.89 for call loudness.

### 4. ML engineering rigor
- **Dual-implementation feature parity:** the same `feature_spec.json` contract is
  implemented in Python and TypeScript; a pytest fixture bundles the *actual* app
  TypeScript with esbuild and asserts **max |Δ| < 1e-6** across random/missing-landmark
  cases, so training and inference can never silently drift.
- **Export gates:** every ONNX export asserts PyTorch↔ONNX Runtime output parity
  (**3.3e-6** measured) and embeds SHA-256 hashes of the feature spec + label map,
  which the app validates before loading a model.
- **15 unit/parity tests** across preprocessing, datasets, augmentation, model
  export, and both feature implementations.

---

## Real-time systems engineering

| Subsystem | How it works | Measured |
|---|---|---|
| Webcam → landmarks | MediaPipe Holistic (WASM/GPU) in-renderer, 64-frame sliding window, stride 8 | 37–82 FPS |
| Sign inference | ONNX Runtime Web in a **Web Worker**, WebGPU with WASM-SIMD-threads fallback (COOP/COEP cross-origin isolation) | ~8 inferences/s |
| Caption audio path | WASAPI loopback → AudioWorklet 48→16 kHz downsample → **transferred MessagePort** direct to STT process (no per-chunk IPC) | 100 ms chunks |
| STT/TTS host | sherpa-onnx native engines in an Electron **utilityProcess** — heavy native work never touches UI or renderer threads | 22×/6× real-time |
| Voice → call | PCM → WAV → `<audio>.setSinkId(VB-Cable)`; echo-guard mutes caption capture only when the voice is audible on the default output | verified 0.50 peak at CABLE Output |
| Overlay | Transparent, click-through, always-on-top caption window (`screen-saver` z-level, forwarded mouse events with hover-to-drag grip) | — |
| Auth | Google OAuth 2.0 **authorization-code + PKCE**, system browser + loopback redirect, avatar re-hosted as data URI to survive COEP | — |
| Packaging | electron-builder NSIS; custom `app://` protocol adds COOP/COEP headers and serves models in production; native DLL paths rewritten for asar | 515 MB installer |

## Stack

**ML:** PyTorch 2.11 (cu128) · ONNX / ONNX Runtime (Web + Python) · MediaPipe Tasks
(Holistic, HandLandmarker) · NumPy / pandas / PyArrow · uv · pytest
**App:** Electron 37 · React 19 · TypeScript · electron-vite · Web Workers ·
AudioWorklet · WebGPU/WASM · sherpa-onnx (Zipformer STT, Piper TTS) · electron-builder
**Infra/tooling:** npm workspaces monorepo · Kaggle API · esbuild · Google OAuth 2.0 (PKCE)

## Notable debugging war stories (interview material)

- **Silent loopback audio:** Chromium delivers silence if audio-processing constraints
  are set on a loopback capture, or if the capture's video track is stopped — and
  echo cancellation *deletes the app's own TTS from mic captures*, making a working
  loop meter read zero exactly when routing succeeded.
- **`utilityProcess` exits code 0:** `parentPort` listeners don't keep the Node event
  loop alive — the STT engine died instantly until a keep-alive interval was added.
- **Electron's memory-caged V8:** the sherpa TTS addon crashed with "External buffers
  are not allowed" — napi external ArrayBuffers are banned in Electron; fixed via the
  addon's `enableExternalBuffer: false` copy mode.
- **Train/runtime drift:** legacy Holistic (543 pts) vs Tasks-API (478-pt face) — solved
  with the landmark-subset contract + dual-implementation parity tests.
