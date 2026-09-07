# SignBridge AI

A local desktop signing studio for fingerspelling, supported isolated ASL signs,
spoken output, and live captions over video calls.

This updated source package introduces a responsive interface, an interactive 3D
welcome scene, a worker-based vision pipeline, and improved training tooling. Start
with [START_HERE.md](START_HERE.md) for the Claude Code handoff.

## Start on Windows

Use Node 20+ and the npm lockfile. In the project root:

```powershell
npm ci
npm run download:mediapipe
npm run download:stt
npm run download:tts
```

The MediaPipe downloader fetches both the hand-only tracker and the holistic tracker.
STT/TTS downloads are needed for desktop captions and routable neural voice output.
The `postinstall` script copies local ONNX Runtime and MediaPipe module-worker assets.

Install your existing trained recognition model(s). Keep each weight file together
with its matching metadata and labels:

```powershell
# models/fingerspell_v1.onnx and its original metadata must exist first.
node scripts/sync-model-to-app.mjs fingerspell_v1

# Optional whole-sign model; also requires shared/labels_gislr.json.
node scripts/sync-model-to-app.mjs signs_v1

npm run dev
```

The repository does not contain the recognition weights. A missing model produces an
explicit setup message. Random/untrained models are never used to generate speech.
Fingerspelling works independently of the whole-sign model once its own assets exist.

## Using the studio

- Open as a guest, then select Fingerspell or ASL signs and start the camera.
- Use even lighting and keep your hand visible. In whole-sign mode include your upper body.
- Hold a confident letter briefly to add it. For a repeated letter, briefly relax the
  pose or remove the hand. A sustained hands-away pause completes the word.
- Use Add space, Backspace, Clear, and Speak aloud. Auto-speak is optional and starts off.
- J and Z require movement: the current static classifier will not auto-commit them.
  Use the manual J/Z buttons until a trained temporal recognizer is available.
- Captions listen to system audio in the Windows desktop app. Call setup lets you
  select a voice output and test the connection. For VB-Cable, choose CABLE Input as
  SignBridge output and CABLE Output as the call app microphone.
- Recognition confidence is a model score, not a guarantee of correctness. Review words.

Google sign-in remains optional. Configure the existing desktop OAuth flow through
`apps/desktop/resources/google-oauth.json` with your own desktop OAuth client. Guest
mode needs no account. Recognition pixels and features stay local; sign-in and initial
asset downloads use the network. System captions/voice still rely on the original
Electron/sherpa integration.

## Architecture

The React renderer captures a fresh video frame only when the recognition worker is
ready. The worker receives one transferred ImageBitmap at a time, runs MediaPipe,
normalizes landmarks, and classifies with ONNX Runtime. It closes each bitmap and
returns landmarks, predictions, and timings. Old workers cannot write into a new mode.

Fingerspelling uses HandLandmarker plus a per-hand MLP. Whole signs retain the original
64-frame, 184-feature contract and use HolisticLandmarker with the Transformer. Signs
are evaluated at most every 125 ms; this does not mean a complete sign can be recognized
in 125 ms. Static letters use 85/140 ms minimum evidence holds and at least three
observations; these are tuning constants, not measured latency promises.

The 3D hand is built from Three.js geometry, loaded only for the welcome screen. It
caps rendering at about 30 fps and pixel ratio 1.5, pauses while hidden/offscreen, and
is disposed when the studio opens. Reduced-motion/static rendering and a logo fallback
are provided. No external textures or CDN requests are needed.

Feature normalization remains unchanged across Python and TypeScript. Model loading
validates spec hashes, label maps, feature dimensions, and calibration metadata.

## Training

See [ml/README.md](ml/README.md). The fingerspelling trainer now provides:

- Optional real signer/session groups, train/validation/test splits, and class coverage checks.
- Compact configurable MLP, balanced sampling, restrained landmark augmentation,
  early stopping and compatible-checkpoint fine-tuning.
- Validation-only temperature calibration, untouched test evaluation, per-class metrics,
  confusion matrix, and a clearly scoped classifier-only CPU benchmark.
- ONNX parity verification and model-specific label files/checksums.

The new training recipe has not yet been compared with your existing weights on real
data. Historical metadata records ~98.0% image-split fingerspelling accuracy and ~74.0%
GISLR validation accuracy; these are previous results, not new measurements or webcam
accuracy guarantees. The welcome screen no longer advertises them as product accuracy.

## Check the source

```powershell
npm run check
cd ml
uv run pytest tests/
```

`npm run check` runs TypeScript, runtime behavior tests, and the Electron production
build. The ML suite covers preprocessing, augmentation, Python/TypeScript parity,
model forward/export behavior, group splits, and a temporary synthetic training smoke
test. It does not establish real ASL accuracy.

## Limits and handoff

This recognizes isolated signs and deliberately held letters. Joining glosses is not
translation of ASL syntax; fluent continuous fingerspelling, coarticulation, and J/Z
motion need temporal data and a validated sequence decoder. Actual webcam results may
differ with signer, camera, framing and lighting.

[UPDATE_REPORT.md](UPDATE_REPORT.md) records changes and validation limits.
[CLAUDE_HANDOFF.md](CLAUDE_HANDOFF.md) gives merge, real-data training and target-PC checks.
The older PROJECT_REPORT.md and RESUME.md are preserved as historical documents and
must not be used as measurements of this version.
