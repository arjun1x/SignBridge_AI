> Historical reference for the original version. These metrics were not re-measured
> for this source upgrade; see [UPDATE_REPORT.md](UPDATE_REPORT.md) for current changes and limits.

# SignBridge AI — Complete Project Report

*A two-way, fully on-device ASL accessibility layer for video calls.*

**Purpose of this document:** everything you need to talk about this project in an
interview — the pitch, the architecture, both models, every measured number with its
source, the debugging stories, the trade-offs, the honest limitations, and prepared
answers to the questions you're most likely to get.

**Verification status:** metrics in this document were re-derived from the source,
checkpoints and logs on 2026-09-02. Items marked **[re-verified]** were measured in
that session by re-running the code; items marked **[logged]** come from committed
training logs, model metadata, or prior instrumentation.

---

## Table of contents

1. [Pitch — say it out loud](#1-pitch--say-it-out-loud)
2. [Architecture](#2-architecture)
3. [Direction 1 — sign → speech](#3-direction-1--sign--speech)
4. [Direction 2 — speech → captions](#4-direction-2--speech--captions)
5. [Model 1 — the sign classifier](#5-model-1--the-sign-classifier)
6. [Model 2 — fingerspelling](#6-model-2--fingerspelling)
7. [The feature contract — lead with this](#7-the-feature-contract--lead-with-this)
8. [Every number, with its source](#8-every-number-with-its-source)
9. [War stories — debugging](#9-war-stories--debugging)
10. [Why this and not that — trade-offs](#10-why-this-and-not-that--trade-offs)
11. [What it can't do](#11-what-it-cant-do)
12. [Questions you should expect](#12-questions-you-should-expect)
13. [Three corrections before you send the resume](#13-three-corrections-before-you-send-the-resume)
14. [Where it goes next](#14-where-it-goes-next)
15. [Appendix — file map](#15-appendix--file-map)

---

## 1. Pitch — say it out loud

Three lengths. Learn the 30-second one close to verbatim; the others are outlines you
fill in from the sections below.

### 30 seconds — the opener

> SignBridge is a desktop app that sits beside a video call and bridges both
> directions. On one side, my webcam watches a signer, MediaPipe pulls out body and
> hand landmarks, and a small Transformer I trained classifies the sign — that gloss
> gets spoken by a neural voice which is routed into Discord through a virtual audio
> cable, so the call hears it as a microphone. On the other side, I capture Windows
> loopback audio, run streaming speech recognition on it, and paint captions in a
> transparent always-on-top window over the call. Everything is local — no cloud, no
> audio or video leaves the machine.

### Two minutes — add the engineering

Open with the 30-second version, then:

> **"The part I'd actually want to talk about is the train/runtime contract."**
>
> The features the model trains on are computed in Python; the features the live app
> computes are in TypeScript. Two implementations of the same math is exactly how a
> model silently gets worse in production. So the landmark subset and the
> normalization live in one JSON spec, and a pytest fixture bundles the *real* app
> TypeScript with esbuild, runs it on the same random landmarks, and asserts the two
> agree to under 1e-6 — including the degenerate cases where shoulders or whole hands
> are missing. On top of that, every ONNX export gates on PyTorch↔ONNX Runtime parity
> and stamps SHA-256 hashes of the feature spec and label map into the model metadata,
> so a model trained against a different spec refuses to load.
>
> Then the runtime story: heavy native speech work runs in an Electron
> `utilityProcess`, never on the UI thread; sign inference runs in a Web Worker on
> ONNX Runtime Web with WebGPU and a WASM-threads fallback; and PCM audio goes from the
> renderer to the speech process over a transferred MessagePort rather than per-chunk
> IPC.

### The honest framing — use it early, not defensively

> "It recognizes 250 isolated signs at 74% top-1 on held-out signers, plus the full
> fingerspelling alphabet at 98%. It joins recognized glosses — it does not translate
> ASL grammar into English, which is an open research problem. I'd rather show a system
> that's honest about its boundary than one that claims translation."

---

## 2. Architecture

Two independent signal chains sharing one Electron app. Neither blocks the other, and
both can run at once during a real two-way conversation.

### Direction 1 — deaf → hearing

```
webcam (640x480, rAF)
  → MediaPipe HolisticLandmarker (GPU delegate, VIDEO mode)
  → feature extraction (543 landmarks → 184 dims, shoulder-normalized)
  → motion gate (energy < 0.015 for 400 ms = "at rest")
  → Web Worker: ONNX Transformer, 64-frame window, stride 8
  → gloss debounce (p >= 0.60, 3 consecutive windows)
  → sentence assembler (auto-speak after 2 s of rest)
  → Piper TTS (VITS) in utilityProcess, peak-normalized to 0.89
  → <audio>.setSinkId("CABLE Input")
  → VB-Audio Virtual Cable
  → call app's microphone = "CABLE Output"
```

### Direction 2 — hearing → deaf

```
Windows loopback (getDisplayMedia, audio: 'loopback' / WASAPI)
  → AudioWorklet: 48 kHz → 16 kHz mono, 100 ms chunks
  → transferred MessagePort (renderer → utility process, no per-chunk IPC)
  → sherpa-onnx streaming Zipformer transducer (int8, greedy, 2 threads)
  → endpoint detection (2.4 s / 1.2 s silence, 20 s max) → partial / final
  → transparent, click-through, always-on-top overlay window
```

### Process model — and why each boundary exists

| Process / thread | Owns | Why it's isolated |
|---|---|---|
| **main** | windows, IPC, `app://` protocol, OAuth loopback server, model discovery | Electron's single main thread — anything blocking here freezes every window. |
| **renderer (main window)** | React UI, webcam loop, MediaPipe, audio capture, TTS playback | Must stay cross-origin isolated (COOP/COEP) so `SharedArrayBuffer` exists for ORT WASM threads. |
| **Web Worker** | ONNX Runtime session, 64-frame ring buffer, softmax | Inference on the renderer thread would drop landmark frames — the sliding window is only valid if frames arrive steadily. |
| **utilityProcess** | sherpa-onnx: streaming STT recognizer + Piper TTS | Native addons decoding at ~20× real time must never touch UI or renderer threads. It also outlives a caption stop so the loaded voice isn't discarded. |
| **renderer (overlay)** | caption text only | Separate `BrowserWindow`: transparent, `focusable:false`, never steals focus from the call. |

### Repository layout

- `apps/desktop/` — Electron + React 19 + electron-vite. Main process in `electron/`,
  renderer in `src/`, two HTML entries (`index.html` main window, `overlay.html`
  caption overlay). ~3,760 lines of TS/TSX/CSS.
- `ml/` — Python training pipeline, managed with `uv`. PyTorch cu128 (RTX 5060 is
  Blackwell sm_120, older wheels fail). ~1,540 lines including tests.
- `shared/` — `feature_spec.json`, `fingerspell_spec.json`, label maps. The contract
  both sides implement.
- `models/` — exported ONNX plus `.meta.json` carrying spec hashes and measured accuracy.
- `scripts/` — model downloaders, ORT/MediaPipe asset copy, and the esbuild bridge
  the parity test shells out to.

---

## 3. Direction 1 — sign → speech

### Landmarks

MediaPipe `HolisticLandmarker` runs in `VIDEO` mode with the GPU delegate, loaded from
local `public/mediapipe/` assets rather than a CDN — the WASM fileset is constructed
explicitly so nothing in the app ever reaches the network. Output is flattened into
fixed-size `Float32Array`s with `NaN` for undetected points, and face is sliced to the
first 468 landmarks so the per-point stride stays uniform even when the model emits
iris points.

Code: `apps/desktop/src/vision/landmarker.ts`

### Features — 543 landmarks down to 184 numbers

Per frame: both hands in full (21 points each), 9 upper-body pose points (nose,
shoulders, elbows, wrists, hips), and 40 lip contour points — x and y only — plus two
hand-presence flags.

```
21 x 2 x 2 (hands,  84)
+ 9 x 2     (pose,   18)
+ 40 x 2    (lips,   80)
+ 2         (presence flags)
= 184
```

Everything is translated to the shoulder midpoint and divided by shoulder width, so the
model is invariant to where the signer sits and how far they are from the camera.
Fallbacks: if both shoulders are missing, use the nose with scale 1.0; if that's missing
too, origin with scale 1.0. Missing landmarks become `0.0` **after** normalization —
the order matters, and it is spelled out in the JSON contract for exactly that reason.

Lips are in the feature set because ASL uses non-manual markers: mouth morphemes
distinguish signs that are otherwise identical on the hands.

Code: `ml/signbridge_ml/features.py` and `apps/desktop/src/vision/features.ts`
(the two implementations held equal by the parity test — see §7).

### Segmentation — the motion gate

There is no sentence boundary in a landmark stream, so `SignGate` manufactures one. It
diffs the 84 hand columns frame to frame; when mean absolute delta stays under 0.015
(in shoulder-width units) for 400 ms, the signer is "at rest". That boundary does two
jobs:

1. It lets the same gloss be emitted twice across a pause ("MOTHER … MOTHER"), by
   clearing the debouncer's last-emitted memory.
2. After 2 seconds of rest it triggers auto-speak on whatever glosses are buffered.

Code: `apps/desktop/src/inference/gating.ts`

### Inference and debouncing

The worker holds a 64-frame ring buffer, shifts it left one frame per landmark frame,
and runs the model every 8 frames — roughly four inferences a second over overlapping
windows at 30 fps. The mask marks start-padding as invalid until 64 real frames have
been seen, matching the training-time pad mode.

Raw top-1 flickers, so `GlossDebouncer` emits a gloss only when the same class wins
**3 consecutive windows at p ≥ 0.60** and differs from the last one emitted. Inference
is skipped entirely when no hand is in frame.

Code: `apps/desktop/src/inference/signWorker.ts`, `apps/desktop/src/inference/debounce.ts`

### Voice into the call

Piper synthesizes in the utility process and returns raw PCM. The renderer wraps it in
a WAV header and plays it through an `<audio>` element — specifically because `<audio>`
supports `setSinkId` and `speechSynthesis` does not. The sink is set to *CABLE Input*;
the call app's microphone is set to *CABLE Output*; the virtual wire between them is
what makes the far side hear a voice.

Two details that only surface in a real call:

- Output is peak-normalized to **0.89**, because Piper synthesizes near 0.5 and arrives
  thin after the cable plus the call app's own processing.
- An optional quiet local monitor at 0.4 volume plays on the default device so the
  signer can hear what was said.

Code: `apps/desktop/src/tts/ttsService.ts`, `apps/desktop/src/main/CallSetup.tsx`

---

## 4. Direction 2 — speech → captions

### Capturing everything the machine plays

Windows loopback is reached through `getDisplayMedia`, with the main process
auto-approving the request as `{ audio: 'loopback' }` via
`session.setDisplayMediaRequestHandler`. That captures all system audio — the call, a
video, anything — rather than a single app.

### Downsampling

An `AudioWorklet` (`pcm-worklet.js`) downsamples 48 kHz to the 16 kHz mono the
recognizer expects and emits 100 ms chunks. A worklet, not a `ScriptProcessorNode`: it
runs on the audio render thread, so caption audio never stutters because React
re-rendered.

### Transport

The main process creates a `MessageChannelMain`, hands one port to the utility process
and the other to the renderer. PCM then flows renderer → speech process **directly**.
Ten chunks a second through `ipcRenderer` would mean ten main-process wakeups a second
forwarding buffers for no reason.

Code: `apps/desktop/electron/stt/sttManager.ts` (`connectPcm`)

### Recognition

sherpa-onnx `OnlineRecognizer`: streaming Zipformer transducer, int8 encoder and joiner
with the fp32 decoder, greedy search, 2 threads, 80-dim filterbank at 16 kHz.

Endpoint detection does the caption segmentation — 2.4 s trailing silence, or 1.2 s
after speech, or 20 s maximum utterance. On endpoint the text is emitted as a **final**
line and the stream resets; otherwise changed text is emitted as a **partial** and
rendered live.

Code: `apps/desktop/electron/stt/sttProcess.ts`

### The overlay

A second `BrowserWindow`: transparent, frameless, `alwaysOnTop` at the `'screen-saver'`
level so it sits above borderless-fullscreen call windows, `focusable:false` so it can
never steal focus mid-call, and `setIgnoreMouseEvents(true, {forward:true})` so clicks
pass through to the app underneath — except when the renderer hovers the drag grip and
asks for interactivity over IPC.

Code: `apps/desktop/electron/windows/overlayWindow.ts`

### The echo guard

The subtle one. If SignBridge's own voice plays on the default output, loopback capture
hears it and the app captions itself. So TTS publishes a speaking state and PCM is muted
while speaking — **but only when the voice is audible on the default device.** When it's
routed to VB-Cable, the sound never reaches the loopback device, so the guard is skipped
and captions keep flowing during genuine two-way use.

That conditional is the difference between a demo and something usable in a real
conversation.

---

## 5. Model 1 — the sign classifier

### Data

Google's GISLR dataset from Kaggle: **94,477 sequences across 250 isolated ASL signs**,
distributed as pre-extracted MediaPipe Holistic landmarks in parquet (~55 GB raw).
Preprocessing converts each sequence into a normalized `(T, 184)` tensor in a compressed
`.npz`, across a 6-worker process pool, resumable — it skips anything already written.

The split is **participant-grouped 90/10**: signers are shuffled and 10% held out
entirely, giving **84,990 train / 9,487 val**. A random per-sequence split would let the
model memorize signer-specific appearance and report a much prettier, meaningless
number.

Sequence length is heavily skewed — median 22 frames, mean 37.9, p95 135, max 537 —
which is why the window is fixed at 64 with masking rather than assumed uniform.

Code: `ml/signbridge_ml/data/preprocess.py`, `ml/signbridge_ml/datasets.py`

### Architecture — 975,994 parameters

- Linear embed 184 → 192.
- **Depthwise Conv1d** stem, kernel 5, added residually — cheap local temporal
  smoothing before attention, which is a good prior for hand motion.
- Sinusoidal positional encoding.
- **3 pre-norm Transformer encoder layers**, d=192, 4 heads, FFN 384, GELU, dropout 0.1.
- Masked mean-pool over real frames only, then a 250-way linear head.

Input shape is a static `(1, 64, 184)` plus a boolean mask. Fixed length is a deliberate
export decision: the runtime always feeds exactly 64 frames, so ONNX needs no dynamic
time axis and there is no way for train and inference lengths to diverge.

Code: `ml/signbridge_ml/models/transformer.py`

### Training

80 epochs, batch 256 (331 steps/epoch), AdamW at 3e-4, weight decay 0.05, cosine
schedule with 5 warmup epochs, label smoothing 0.1, gradient clipping at 1.0,
**bf16 autocast**.

Total wall clock **38.5 minutes** on one RTX 5060 — 170 s for the first epoch while the
OS page cache warms on 94k npz files, then a steady 22–26 s per epoch.

Config: `ml/configs/gislr_base.yaml`. Code: `ml/signbridge_ml/train.py`

### Augmentation

Applied in already-normalized feature space rather than re-derived from raw landmarks —
equivalent for small perturbations and far simpler:

- per-sequence affine jitter (σ = 0.01)
- per-element landmark noise (σ = 0.005)
- random whole-hand dropout (5% per hand)
- random temporal crop for sequences longer than the window
- **horizontal mirroring at p = 0.5**

Mirroring is the interesting one, because a mirrored left hand *is* a right hand. The
feature-space mirror has to swap the two hand blocks, permute the pose L/R pairs, negate
every x column, and swap the presence flags. A unit test (`ml/tests/test_mirror.py`)
asserts this feature-space mirror equals mirroring the raw landmarks and re-extracting.

Lips are x-negated without a symmetric-vertex remap — a documented approximation, since
MediaPipe's face-mesh L/R correspondence table was out of scope.

### Results

| Metric | Value | Notes |
|---|---|---|
| Top-1, held-out signers | **73.90%** | n = 9,487, fp32 re-evaluation |
| Top-5, held-out signers | **90.83%** | same run |
| Best checkpoint (epoch 72) | 73.97% | bf16 autocast eval inside the training loop |
| Random baseline | 0.40% | 250 classes |
| Final train loss | 1.696 | with label smoothing 0.1 |

The 0.07-point gap between the two accuracy figures is just fp32 versus bf16
evaluation — worth knowing so you are never caught off guard by your own two numbers.

### What it gets wrong — and why that's a good sign

The dominant errors are semantically adjacent pairs, not random confusion. That is the
model learning the right structure and then hitting the ceiling of what isolated
landmarks can disambiguate.

| True → predicted | Count |
|---|---|
| wake → awake | 36 |
| listen → hear | 32 |
| nap → sleep | 32 |
| pen → pencil | 25 |
| mouth → lips | 24 |
| look → face | 18 |
| give → gift | 16 |
| tongue → duck | 15 |
| after → room | 14 |
| chin → say | 14 |

**Use this in the interview.** "My top confusions are *wake* vs *awake* and *pen* vs
*pencil*" is a far stronger answer than a bare accuracy number — it shows you looked at
the errors, and it sets up the honest point that some of those pairs are genuinely
near-identical without surrounding context.

Code: `ml/signbridge_ml/evaluate.py`

---

## 6. Model 2 — fingerspelling

A 250-sign vocabulary can't say a name. So the second model spells: any word, letter by
letter, with `space` and `del` as editing gestures.

### The dataset didn't exist — I built it

The source is an image dataset of ASL alphabet photos (grassknoted/asl-alphabet, 87K
images). I ran MediaPipe `HandLandmarker` over a sampled subset and kept the landmarks,
producing **33,033 samples across 28 classes** (A–Z, space, del).

Images where no hand was detected were dropped. `nothing` was dropped as a class because
the app simply never classifies when no hand is in frame — a "no hand" class would be
dead weight and a source of false commits.

Code: `ml/signbridge_ml/fingerspell_extract.py`

### Features — 63 dims, either hand

21 landmarks × (x, y, z), wrist-centered, scaled by the wrist-to-middle-finger-MCP
distance. Crucially, handedness is **canonicalized**: a left hand has its x negated so
it looks like a right hand. One model, both hands, half the data requirement.

Spec: `shared/fingerspell_spec.json`.
Code: `ml/signbridge_ml/fingerspell_features.py` and
`apps/desktop/src/vision/fingerspellFeatures.ts` — also parity-tested.

### Model

MLP 63 → 256 → 256 → 28 with GELU and dropout 0.2, **89,372 parameters**, 40 epochs,
batch 512, AdamW at 1e-3, label smoothing 0.05, Gaussian landmark jitter σ = 0.01 as the
only augmentation. Trains in under a minute on GPU.

Static poses don't need a sequence model — that is the whole reason this is separate
from the sign classifier.

Code: `ml/signbridge_ml/fingerspell_train.py`

### Results and commit logic

**98.00% validation accuracy**, re-verified through the exported ONNX.

Because per-frame predictions flicker during hand transitions, `LetterCommitter` commits
a letter only after **6 consecutive frames above p = 0.65**. And a committed letter can't
recommit until the pose breaks — a different letter wins, or the hand leaves frame.
That is why "LL" is spelled by relaxing briefly between the two L's, which is the
standard interaction in fingerspelling recognizers.

Code: `apps/desktop/src/inference/letterCommitter.ts`

---

## 7. The feature contract — lead with this

If you only get to explain one piece of engineering, make it this one. It is the part
most ML portfolio projects don't have.

### The problem

The model trains on features computed by Python. It runs on features computed by
TypeScript. Two implementations of the same math **will** drift — someone reorders a
block, changes when NaN is zeroed, or normalizes before centering instead of after.
Nothing crashes. Accuracy just quietly degrades in production and nobody knows why.

### The solution, in three layers

**1. One spec.** `shared/feature_spec.json` declares the landmark subset, block order,
coordinate channels, normalization rule, missing-value rule, presence flags, window
size, stride, and pad mode. Both implementations import it for the index lists, and both
carry a header comment pointing at the other.

**2. An executable parity test.** `ml/tests/test_feature_parity.py` generates random
landmark frames — fully populated, 30% missing, and *100% missing* to exercise every
fallback — then shells out to `scripts/run-ts-features.mjs`, which bundles the actual
`apps/desktop/src/vision/features.ts` with esbuild, imports it as a data URI, runs it on
the same input, and pipes JSON back. The assertion is `max |Δ| < 1e-6`.

It tests the shipping code, not a Python transcription of it. That distinction is the
whole point.

**3. Export gates.** Every ONNX export runs 10 random inputs (half with partial masks)
through both PyTorch and ONNX Runtime and asserts parity, then writes `.meta.json` with
SHA-256 of the feature spec and the label map plus `feature_dim` and `window_frames`.
The Web Worker checks those dimensions before loading and refuses a mismatch with a
specific error.

Code: `ml/signbridge_ml/export_onnx.py`, `apps/desktop/src/inference/signWorker.ts`

### Measured

- Python ↔ TypeScript feature parity: **< 1e-6** (assertion threshold)
- ONNX ↔ PyTorch, sign model: **3.34e-6** (threshold 1e-4)
- ONNX ↔ PyTorch, fingerspell model: **6.68e-6**
- Test suite: **15 passed in 15.4 s** — feature parity, fingerspell parity, mirror
  equivalence, dataset windowing, preprocessing, model smoke, ONNX export parity

If an interviewer asks whether it still runs: yes, and you re-ran it.

---

## 8. Every number, with its source

Know which of these you can defend from a fresh run and which come from your own earlier
measurements.

| Quantity | Value | Source |
|---|---|---|
| Sign classifier top-1 (held-out signers) | 73.90% | **[re-verified]** |
| Sign classifier top-5 | 90.83% | **[re-verified]** |
| Sign classifier parameters | 975,994 | **[re-verified]** |
| Train / val sequences | 84,990 / 9,487 | **[re-verified]** |
| Total sequences · classes | 94,477 · 250 | **[re-verified]** |
| Sequence length: median / mean / p95 / max | 22 / 37.9 / 135 / 537 | **[re-verified]** |
| Total training wall clock (80 epochs) | 38.5 min | **[re-verified]** |
| Steady-state epoch time | 22–26 s | **[re-verified]** |
| Fingerspell accuracy | 98.00% | [logged] |
| Fingerspell parameters · samples | 89,372 · 33,033 | **[re-verified]** |
| ONNX↔PyTorch parity (signs / spell) | 3.34e-6 / 6.68e-6 | [logged] |
| Python↔TypeScript feature parity | < 1e-6 | **[re-verified]** |
| Test suite | 15 passed / 15.4 s | **[re-verified]** |
| Windows installer size | 492 MiB (515 MB) | **[re-verified]** |
| Bundled model weights (STT / TTS) | 321 MB / 78 MB | **[re-verified]** |
| Application source | 6,362 lines | **[re-verified]** |
| Git history | 19 commits, 2026-07-02 → 2026-07-09 | **[re-verified]** |
| Landmark pipeline throughput | 37–82 FPS | [logged] |
| Sign inferences per second | ~8/s | [logged] |
| STT speed on CPU | ~22× real time | [logged] |
| End-to-end caption latency | < 1.5 s | [logged] |
| Piper TTS speed | ~6× real time | [logged] |

### Tuning constants worth having memorized

| Constant | Value | Why that value |
|---|---|---|
| window / stride | 64 / 8 frames | ~2 s at 30 fps covers a full sign; stride 8 gives overlapping votes for the debouncer. |
| gloss debounce | p ≥ 0.60 × 3 | Three agreeing windows kill flicker without adding perceptible lag. |
| motion threshold | 0.015 | Mean abs delta on hand columns, in shoulder-width units. |
| rest duration | 400 ms | Long enough not to fire mid-sign, short enough to feel responsive. |
| auto-speak delay | 2,000 ms | A signer's natural end-of-thought pause. |
| letter commit | p ≥ 0.65 × 6 | Per-frame, so it needs more frames than the per-window gloss debounce. |
| STT endpoint rules | 2.4 / 1.2 / 20 s | Trailing silence before speech / after speech / max utterance. |
| TTS peak normalize | 0.89 | Piper lands near 0.5 — too quiet after the cable and the call app's AGC. |
| OAuth loopback port | 51739 | Fixed, so a "Web application" client can pre-register the redirect URI. |

---

## 9. War stories — debugging

These are the highest-value interview material in the whole project. Each is a real trap
with a non-obvious cause, and each has a clean punchline.

### The loopback that delivered silence — twice

**Symptom:** capture succeeds, the track exists, every sample is zero.

**Cause 1:** setting audio-processing constraints (echo cancellation, noise suppression,
AGC) on a Windows loopback capture makes Chromium hand back silence. The fix is
`audio: true` and nothing else.

**Cause 2:** the API requires a video track you don't want, so the instinct is to stop it
immediately — but audio and video share one capture session, and stopping the video
track silences the audio. The fix is to keep the video track alive and simply never
consume its frames.

### The echo canceller that hid success

The call-integration level meter reads the *CABLE Output* device to prove the loop works
end to end. It showed zero.

The default `getUserMedia` constraints enable echo cancellation, which correctly
identifies the app's own browser-played TTS as echo and **subtracts it**. The meter read
silence precisely when routing was working. Fixed by requesting a raw capture.

Worth telling because the bug's behavior was the exact inverse of the truth.

### utilityProcess exiting with code 0

The STT process died instantly, cleanly, with no error. `parentPort` listeners do not
keep the Node event loop alive in an Electron utility process — with nothing else
pending there was no work, so it exited *successfully*. Fixed with a long-interval no-op
timer as an explicit keep-alive.

### "External buffers are not allowed"

The sherpa TTS addon crashed on `generate()`. Electron's memory-caged V8 forbids N-API
external `ArrayBuffer`s, and the addon returns audio as one by default. Fixed with
`enableExternalBuffer: false` so it copies into a V8-owned buffer.

The same class of problem reappeared one hop later when passing those samples back
through `ipcMain.handle` — solved by always constructing a fresh `Float32Array` before
returning.

### MessagePort transfers that arrive as undefined

Transferring an `ArrayBuffer` across Electron's remoted renderer↔utility MessagePort
delivers `undefined` on the far side, so PCM chunks are structured-cloned instead.

There's a mirror-image case on the vision side: features are also posted *without* a
transfer list, but for a different reason — `SignGate` retains the array as
`prevFeatures` for next-frame motion diffing, and transferring would detach it. 184
floats cost nothing to clone.

### React StrictMode double-closing a port

StrictMode double-mounts effects in development. The second `message` listener adopted
the same port the first had already taken, and closed it. The port listener is now
idempotent and guards against re-adopting an identical port.

### Vite rewriting a worker's dynamic import

ONNX Runtime loads its WASM via dynamic `import()`. Vite's dev-server import analysis
intercepts same-origin relative specifiers even for files outside its module graph,
rewriting them with a `?import` suffix that 500s. Fixed by constructing fully-qualified
`new URL(..., self.location.origin).href` paths, which pass through untouched.

### Train/runtime topology drift

The GISLR data uses legacy Holistic ordering with a 468-point face; the Tasks API can
emit 478 with iris points. Same index, different landmark — silent and catastrophic.

The landmark-subset contract plus explicit slicing to `[:468]` is what makes that
impossible, and it's the concrete reason the parity infrastructure exists rather than
being architecture astronomy.

### Packaging native DLLs into asar

On Windows, sherpa's DLLs live in a platform package and must be on `PATH` before the
addon loads. In a packaged build the resolved path points inside `app.asar` — and
Windows can only load DLLs from a real filesystem. electron-builder unpacks native
modules to `app.asar.unpacked`, so the loader rewrites the path segment before
prepending it to `PATH`.

### Cross-origin isolation in a packaged app

`file://` can't carry COOP/COEP headers, and without cross-origin isolation there's no
`SharedArrayBuffer`, and without that onnxruntime-web can't use WASM threads. Packaged
builds therefore serve the renderer over a custom `app://` protocol registered as
privileged, whose handler attaches `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to every response — with a path check so
it can't escape the renderer root.

A knock-on effect: the Google avatar image is fetched in the main process and re-hosted
as a data URI, because a COEP-isolated renderer can't load a cross-origin image that
doesn't send CORP headers.

---

## 10. Why this and not that — trade-offs

Interviewers probe alternatives. Have the reason ready, and be willing to name what you
gave up.

| Decision | Reasoning | Cost accepted |
|---|---|---|
| Landmarks, not raw pixels | ~1M parameters instead of a video CNN; trains in 38 min on one consumer GPU; invariant to lighting, skin tone, clothing, background. | Loses whatever landmarks discard — subtle handshape detail, facial expression beyond lip contour. |
| Transformer over LSTM/TCN | Signs have long-range dependencies (handshape at the start, motion at the end); attention with masked pooling handles variable real length cleanly. | More parameters than a TCN at this sequence length. |
| Depthwise conv stem before attention | Local temporal smoothing is a strong prior for hand motion and costs almost nothing. | One more hyperparameter (kernel 5). |
| Fixed 64-frame window | Static ONNX shape, no dynamic axis, no possible train/runtime length mismatch. | Signs longer than ~2 s get cropped. |
| Two models, not one | Fingerspelling is a static-pose problem; signs are a sequence problem. Separate models are each far simpler, and the letter model trains in under a minute. | An explicit mode switch in the UI instead of automatic detection. |
| ONNX Runtime Web in a Worker | One trained artifact runs in the browser context with WebGPU — no Python at runtime, no server, no second inference stack to keep in sync. | WebGPU support varies; needs a WASM-threads fallback and cross-origin isolation. |
| utilityProcess for native speech | Crash isolation and no UI blocking; the process outlives a caption stop so the loaded TTS voice isn't thrown away. | Cross-process message plumbing and its serialization traps. |
| VB-Cable rather than a virtual driver | A signed kernel audio driver is a months-long, certificate-gated project. A free, widely-installed cable gets the same result today. | A manual install step, and a setup wizard to guide it. |
| Piper over the Web Speech API | Web Speech doesn't work in Electron at all, and `speechSynthesis` can't target an output device — `setSinkId` on `<audio>` can, which is the entire routing mechanism. | 65 MB of bundled voice. |
| Fully local, no cloud | The content is a private conversation, often medical or personal. Also: no network round-trip in the latency budget, and it works offline. | A 492 MiB installer, and accuracy below what a large cloud model would give. |
| Participant-grouped split | Measures generalization to a new signer, which is the only number that means anything for this product. | A visibly lower headline accuracy than a random split would report. |

---

## 11. What it can't do

State these before you're asked. Volunteering a limitation reads as engineering
maturity; being caught by one reads as overselling.

- **It doesn't translate ASL grammar.** Output is joined glosses — "store go me" — not
  English word order. ASL is a distinct language with its own syntax, spatial grammar
  and non-manual markers. Real translation is an open research problem; an LLM cleanup
  pass over the gloss sequence is the obvious next step, and I'd frame it as exactly
  that rather than as a solved thing.
- **250 signs.** The GISLR label set. Fingerspelling covers the rest at letter speed,
  which is a real mitigation but not a substitute.
- **J and Z need motion.** The letter classifier sees static poses, so those two are
  unreliable by construction. A short temporal window on the letter model would fix it.
- **Isolated signs, not continuous signing.** The motion gate segments on rest, which
  assumes deliberate pauses. Fluent continuous signing has no such pauses — that's a
  co-articulation and segmentation problem, and it's genuinely hard.
- **Domain gap.** Validation accuracy comes from the dataset's capture conditions. A
  different webcam, lighting and framing will read lower than 74%. Augmentation narrows
  the gap; it doesn't close it.
- **Windows only.** WASAPI loopback and VB-Cable are the platform-specific pieces; the
  ML side is portable.
- **No user study.** The system was tested by me. I have no data from Deaf signers,
  which is the evaluation that would actually matter — and I'd say so.

---

## 12. Questions you should expect

### "74% doesn't sound very high. Is that good?"

It's 250 classes, so chance is 0.4% — that's **185× baseline**, and top-5 is 91%. More
importantly it's measured on **held-out signers**, not held-out clips. A random split
would have reported a much higher number that told you nothing about a new user. And the
residual errors are pairs like *wake*/*awake* and *pen*/*pencil* — semantically adjacent
signs that are near-identical in landmark space. I'd rather have an honest 74% on new
signers than a flattering 90% that collapses on the first real user.

### "How would you improve accuracy?"

In order of expected value per unit of effort:

1. Add the z coordinate and hand-relative features — currently only x and y are used, so
   depth and inter-finger geometry are discarded.
2. Ensemble or self-distill — cheap, given a 38-minute training run.
3. More capacity — d=192 with 3 layers is small, and the loss was still descending at
   epoch 80.
4. Stronger temporal augmentation, since sequence lengths run from 22 to 537 frames.
5. A context prior — the confusion pairs are largely disambiguable from surrounding
   glosses, so a language model over the gloss stream would fix a real slice of them.

### "Walk me through what happens between a hand moving and a voice in the call."

Webcam frame → MediaPipe Holistic landmarks → 184-dim normalized feature vector → motion
gate updates rest state → feature pushed into a 64-frame ring buffer in a Web Worker →
every 8th frame, ONNX Runtime runs the Transformer and returns 250 logits → softmax
top-1 → debouncer requires 3 consecutive windows above 0.60 → gloss appended to the
sentence buffer → the signer rests for 2 seconds → buffer joins into a sentence → Piper
synthesizes PCM in the utility process → renderer wraps it in WAV and plays it through an
`<audio>` element with `setSinkId` pointed at CABLE Input → the call app's microphone is
CABLE Output → the far side hears a voice.

### "Why not just use a cloud API?"

Three reasons, in priority order. **Privacy** — this is someone's private conversation,
often personal or medical, and streaming it to a third party is the wrong default for an
accessibility tool. **Latency** — a network round trip per window would dominate the
budget for something that has to feel conversational. **There is no API for this** —
cloud STT exists, but sign recognition over a 250-word ASL vocabulary is the part I had
to train, so the interesting half was never available to buy.

### "How do you know training and inference compute the same features?"

This is the answer to lead with. A pytest fixture bundles the *real* app TypeScript with
esbuild, runs it on the same random landmark frames the Python implementation gets —
including 30%-missing and 100%-missing cases that exercise every fallback path — and
asserts max absolute difference under 1e-6. On top of that, ONNX exports embed SHA-256
hashes of the feature spec and label map, and the runtime validates dimensions before
loading. Drift can't happen silently; it fails a test.

### "Why a Transformer? Isn't that overkill for a 64-frame sequence?"

It's ~1M parameters and 3 layers — this is a small Transformer, not a large one. Signs
have long-range structure: the handshape that identifies a sign often appears at the
start while the disambiguating motion happens at the end, and masked self-attention
relates those directly instead of pushing them through a recurrent bottleneck. The
depthwise conv stem handles local smoothing so attention doesn't have to. And masked
mean-pooling handles variable real length naturally, which matters when sequences range
from 22 to 537 frames.

### "What was the hardest bug?"

The echo canceller, because the failure was the inverse of the truth. The
call-integration level meter reads the CABLE Output device to prove routing works; it
showed silence. Default `getUserMedia` constraints enable echo cancellation, which
correctly identified the app's own TTS as echo and subtracted it — so the meter showed
zero *exactly when the loop was working*. Every instinct said the routing was broken.
The lesson I took from it: when a measurement contradicts a system that should work,
suspect the measurement's own processing chain.

### "How would you scale this to a real product?"

- **Model:** continuous-signing segmentation instead of rest-based gating, a much larger
  vocabulary, and a gloss-to-English pass.
- **Data:** this is the real bottleneck — a consented data pipeline with Deaf signers,
  which is a partnership and ethics problem before it's an engineering one.
- **Platform:** a signed virtual audio driver to remove the VB-Cable install, plus macOS.
- **Evaluation:** word error rate on real conversations rather than isolated-sign
  accuracy, because that's the metric a user actually feels.
- **Distribution:** the installer is 492 MiB, mostly model weights — that wants
  on-demand download.

### "What would you do differently?"

Two things. I'd have written the feature-parity test *before* the second implementation
instead of after discovering the 468-vs-478 face landmark trap — it was the right fix,
arrived at reactively. And I'd have set up a proper experiment log from the start; I have
one training run's log, which was enough to ship but wouldn't be enough to justify
architecture choices to a team. I also under-invested in measuring real webcam
performance versus dataset validation accuracy, which is the gap that matters most for
the product.

### "What did you actually build versus integrate?"

Be precise here — it's a credibility question.

- **Trained by me:** the sign Transformer and the fingerspelling MLP, including building
  the dataset for the latter.
- **Written by me:** the entire preprocessing and training pipeline, the feature contract
  and its parity harness, the ONNX export gates, and all of the application — capture,
  worker inference, gating, debouncing, sentence assembly, audio routing, overlay,
  packaging.
- **Integrated, not trained:** MediaPipe for landmarks, the sherpa-onnx Zipformer for
  STT, and the Piper voice for TTS.

Training a speech model wasn't the point; getting three of them to run together in real
time on one machine was.

### "Have you tested it with Deaf users?"

No — and that's the most important thing missing. I built and evaluated it myself against
a public dataset. The evaluation that would actually matter is whether a Deaf signer can
hold a conversation with it, and I'd want that before claiming anything about usability.
It also shapes what I'd build next: I suspect fingerspelling reliability and continuous
signing would outrank raw vocabulary size, but that's a hypothesis I haven't earned the
right to assert.

---

## 13. Three corrections before you send the resume

These were re-derived from the code and checkpoints. `RESUME.md` currently overstates
them slightly — small differences, but all three are trivially checkable by anyone who
clones the repo, and being caught inflating a number costs more than the number is worth.

| Claim | Written | Actual | Suggested wording |
|---|---|---|---|
| Sign model size | 1.2M params | **975,994** | "~1M-parameter Transformer" — a better line anyway, since it's a rounder story about doing a lot with a small model. |
| Fingerspell model size | ~82K params | **89,372** | "~90K params" |
| Timeline | ~5 weeks | **8 days of commits** | See below. |

### The timeline is the one to think about

The commits are labeled "week 1" through "week 5", but the git history runs
**2026-07-02 to 2026-07-09** — 19 commits over 8 calendar days. If those weeks refer to
planned phases rather than elapsed time, "~5 weeks" will not survive an interviewer
opening the commit graph, and that's a bad moment to have.

Two clean options:

- Say **"built solo across five development phases"** and let the phases speak for
  themselves.
- Drop the duration entirely — nobody asked.

If the real elapsed time genuinely was longer, with work happening before `git init`,
say that plainly if it comes up. Either way, don't leave a number in place that the repo
contradicts.

---

## 14. Where it goes next

Have two or three of these ready. "What would you build next" is asked almost every
time, and a specific answer with a stated reason beats a wish list.

**Model**

- Add z and hand-relative geometry to the feature set — currently discarded, and cheap
  to test.
- A short temporal window on the letter model to recover J and Z.
- Continuous-signing segmentation to replace rest-based gating.
- A gloss-level language model to break the semantic confusion pairs using context.

**System**

- An LLM pass turning gloss sequences into English, clearly labeled as a rewrite rather
  than a transcription.
- On-demand model download to cut the 492 MiB installer.
- A signed virtual audio driver to remove the VB-Cable install step.
- Conversation-level evaluation — word error rate, not isolated-sign accuracy.

---

## 15. Appendix — file map

Useful if an interviewer shares their screen and asks you to navigate the repo.

### Application — `apps/desktop/`

| File | Role |
|---|---|
| `electron/main.ts` | App bootstrap, `app://` protocol with COOP/COEP, loopback auto-approval, all IPC handlers. |
| `electron/windows/overlayWindow.ts` | Transparent click-through caption window. |
| `electron/stt/sttManager.ts` | Owns the utility process; model discovery, TTS request/reply, MessagePort wiring. |
| `electron/stt/sttProcess.ts` | Runs inside `utilityProcess`: sherpa STT recognizer + Piper TTS, keep-alive, DLL path fix. |
| `electron/auth/googleAuth.ts` | OAuth 2.0 authorization-code + PKCE, loopback redirect on port 51739. |
| `src/vision/landmarker.ts` | MediaPipe Holistic wrapper, local WASM assets. |
| `src/vision/features.ts` | **TypeScript half of the feature contract.** |
| `src/vision/signPipeline.ts` | Orchestrates webcam → landmarks → gate → worker → debounce → sentence. |
| `src/inference/signWorker.ts` | ONNX Runtime session, 64-frame ring buffer, WebGPU→WASM fallback. |
| `src/inference/gating.ts` | Motion energy and rest detection. |
| `src/inference/debounce.ts` | Gloss stabilization (p ≥ 0.60 × 3). |
| `src/inference/letterCommitter.ts` | Fingerspelling commit logic (p ≥ 0.65 × 6, pose-break rule). |
| `src/nlp/sentenceAssembler.ts` | Gloss buffer, auto-speak on rest, backspace/clear. |
| `src/capture/audioCapture.ts` | Loopback capture, AudioWorklet, PCM port, echo mute. |
| `src/tts/ttsService.ts` | Piper/system engine switch, WAV wrapping, `setSinkId` routing, local monitor. |
| `src/main/CallSetup.tsx` | VB-Cable wizard: device pick, test voice, end-to-end level meter. |

### ML — `ml/`

| File | Role |
|---|---|
| `signbridge_ml/features.py` | **Python half of the feature contract.** |
| `signbridge_ml/data/preprocess.py` | Parquet → normalized npz, participant-grouped split. |
| `signbridge_ml/datasets.py` | Windowing, masking, augmentation, feature-space mirror. |
| `signbridge_ml/models/transformer.py` | The sign classifier. |
| `signbridge_ml/train.py` | Training loop, cosine schedule, bf16 autocast, checkpointing. |
| `signbridge_ml/evaluate.py` | Top-1/top-5 and the most-confused pairs. |
| `signbridge_ml/export_onnx.py` | ONNX export with parity gate and hash metadata. |
| `signbridge_ml/fingerspell_extract.py` | Builds the letter dataset from images via HandLandmarker. |
| `signbridge_ml/fingerspell_train.py` | Letter MLP training + export. |
| `tests/` | 15 tests: feature parity, fingerspell parity, mirror, dataset, preprocess, model smoke, export parity. |

### Contract — `shared/`

| File | Role |
|---|---|
| `feature_spec.json` | Landmark subset, normalization, window/stride, pad mode, mirror rule. |
| `fingerspell_spec.json` | Hand canonicalization and 63-dim normalization. |
| `labels_gislr.json` | 250 gloss labels, index-ordered. |
| `labels_fingerspell.json` | 28 letter/edit labels. |

---

*Compiled from source, checkpoints, training logs, and a live re-run of the evaluation
and test suite on 2026-09-02.*
