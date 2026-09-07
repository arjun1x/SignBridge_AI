# SignBridge AI — updated project

This folder is a complete updated source tree for `arjun1x/SignBridge_AI`, based on commit
`9be850e91ff680fffb3607d608f9cb09b1e5ecd7`.

## Give it to Claude Code

Open this folder alongside your existing SignBridge checkout. Ask Claude Code:

> Read CLAUDE_HANDOFF.md and UPDATE_REPORT.md. Review UPDATES.patch against my current
> SignBridge_AI project, merge the compatible changes on a new branch, preserve my
> local models, datasets, credentials and any newer work, then follow the validation
> and real-data training steps. Do not claim improved accuracy until the new model
> has been evaluated on held-out real webcam data.

`UPDATES.patch` is the complete change set against the base commit. The source files
are already updated; do not apply the patch to this folder itself.

## What is ready

- Interactive, procedurally modeled 3D hand on the welcome screen.
- Responsive signing studio with a large mirrored camera, actual hand overlays,
  confidence, frame processing time, and word editing controls.
- Hand-only fingerspelling tracker; tracking and classification moved off the UI thread.
- Single outstanding camera frame, stable timed letter commits, and corrected start/stop behavior.
- New train/calibrate/evaluate/export workflow and corrected sign-data augmentation.
- Typecheck, production build, 12 runtime tests and 20 Python tests verified.

## What still needs your local files

**No new ASL recognition weights were trained or included.** GitHub contained metadata
but no ONNX weights, training images, extracted datasets or checkpoints. The repository
had no downloadable release assets at review time. The training smoke test used
synthetic fixtures only; those weights are not included.

Your existing ignored `models/`, `ml/data/`, `ml/checkpoints/` and desktop model folders
may already have everything needed on your PC. Preserve them when merging.

See `README.md` to start the app and `ml/README.md` to run real training. Real webcam
accuracy, latency, GPU compatibility, Windows audio routing and visual behavior need
verification on the target PC. J/Z motion recognition and full ASL grammar translation
remain unsupported; J and Z can be added manually in fingerspelling mode.
