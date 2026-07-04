# SignBridge AI

**A real-time, two-way accessibility layer for video calls.** SignBridge runs
alongside Discord/Zoom and bridges both directions of a conversation between
a deaf signer and hearing participants:

- **Sign → Speech:** webcam → MediaPipe Holistic landmarks → a Transformer
  sign classifier (trained on 94k sequences, 250 ASL signs, 74% top-1 / 91%
  top-5) → debounced glosses → sentence assembly → a neural voice (Piper)
  spoken **into the call as your microphone** via VB-Audio Virtual Cable.
- **Speech → Captions:** Windows loopback audio → streaming Zipformer STT
  (sherpa-onnx, ~20× real-time on CPU) → live captions in a transparent,
  click-through, always-on-top overlay above the call window.

Plus **fingerspelling mode**: spell any word letter-by-letter with the ASL
alphabet (98% letter accuracy), with `space`/`delete` gestures for editing —
so vocabulary is never a hard limit.

Everything runs **locally** — no cloud APIs, no audio or video ever leaves
the machine.

## Architecture

```
┌────────────────────────── Electron ──────────────────────────┐
│  Renderer (React 19, cross-origin isolated)                  │
│   webcam → HolisticLandmarker (WASM/GPU) → feature extract   │
│   → ONNX Web Worker (onnxruntime-web WebGPU/WASM)            │
│   → gloss debounce → sentence assembly → TTS routing         │
│   loopback capture → AudioWorklet 16k PCM ─┐                 │
│                                     MessagePort (direct)     │
│  Utility process (Node)                    ▼                 │
│   sherpa-onnx streaming STT  ◄─────────────┘                 │
│   sherpa-onnx Piper TTS → PCM → renderer → setSinkId(cable)  │
│  Overlay window: transparent/click-through captions          │
└──────────────────────────────────────────────────────────────┘
        ml/ (Python, uv): GISLR download → preprocess → train
        (PyTorch cu128) → ONNX export with parity gate → app
```

The train/runtime contract lives in `shared/feature_spec.json`: the exact
landmark subset and normalization are implemented twice (Python for
training, TypeScript for the live pipeline) and **fixture-tested for
equality to 1e-6** — the TS implementation is executed via esbuild inside
the Python test suite. Exported models carry hashes of the feature spec and
label map so a drifted model refuses to load.

## Try it

```powershell
npm install                 # also copies ORT/MediaPipe wasm assets
npm run download:stt        # streaming STT model (~300 MB)
npm run download:tts        # Piper voice (~65 MB)
npm run download:mediapipe  # HolisticLandmarker (~13 MB)
npm run dev
```

Sign-recognition models: train your own with the runbook in
[`ml/README.md`](ml/README.md) (Kaggle GISLR + ASL-alphabet datasets), or
drop prebuilt `signs_v1.onnx` / `fingerspell_v1.onnx` into
`apps/desktop/src/public/models/`.

For call integration, install the free
[VB-Audio Virtual Cable](https://vb-audio.com/Cable/), then follow the
in-app **Call Integration** wizard (device pick, test voice, level meter).
Set the call app's microphone to `CABLE Output`.

## Honest limitations

- **Gloss order ≠ English grammar.** Sentences are joined recognized
  glosses ("store go me"), not translated ASL grammar. Real ASL translation
  is an open research problem; a post-hoc LLM cleanup pass is a natural
  extension.
- **250-sign vocabulary** (the GISLR label set) for whole-sign recognition;
  fingerspelling covers everything else at letter speed.
- **J and Z** involve motion; the letter classifier sees static poses, so
  they're unreliable.
- Webcam domain differs from the training distribution; accuracy in the
  wild is below the 74% validation number. Augmentation narrows the gap.

## Stack

Electron + React 19 + electron-vite · MediaPipe Tasks (Holistic + Hands) ·
onnxruntime-web (WebGPU/WASM) · sherpa-onnx (streaming Zipformer STT, Piper
TTS) · PyTorch 2.11 cu128 · trained on an RTX 5060 (Blackwell sm_120).
