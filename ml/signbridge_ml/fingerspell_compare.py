"""Compare exported fingerspelling ONNX models on ONE held-out test split.

Evaluates every listed model on the same test indices (from a trainer's
split.json), restricted to the classes each model knows, so an older 28-class
model and a newer 29-class model are scored on identical samples. Also reports
a classifier-only CPU latency (single sample, onnxruntime) and the parameter
count read from the ONNX initializers.

This is an image-split comparison unless the split.json says 'group-disjoint';
it is NOT a webcam or unseen-signer accuracy claim.

Usage (from ml/):
  uv run python -m signbridge_ml.fingerspell_compare \
      --data-dir data/fingerspell_v2 --split checkpoints/fingerspell_v2/split.json \
      --models ../models/fingerspell_v1.onnx ../models/fingerspell_v2.onnx
"""
import argparse
import json
import time
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort

ROOT = Path(__file__).resolve().parents[2]


def model_labels(onnx_path: Path) -> list[str]:
    meta_path = onnx_path.with_suffix('').with_suffix('.meta.json') if onnx_path.suffix == '.onnx' else None
    meta_path = onnx_path.parent / f"{onnx_path.stem}.meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        labels_file = meta.get('labels_file')
        if labels_file:
            return json.loads((onnx_path.parent / labels_file).read_text())
    return json.loads((ROOT / 'shared' / 'labels_fingerspell.json').read_text())


def param_count(onnx_path: Path) -> int:
    model = onnx.load(str(onnx_path))
    return int(sum(int(np.prod(t.dims)) for t in model.graph.initializer))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, required=True)
    parser.add_argument('--split', type=Path, required=True, help='split.json written by fingerspell_train')
    parser.add_argument('--models', type=Path, nargs='+', required=True)
    parser.add_argument('--common-only', action='store_true',
                        help='score every model only on classes shared by ALL listed models')
    args = parser.parse_args()

    features = np.load(args.data_dir / 'features.npy', allow_pickle=False).astype(np.float32)
    labels = np.load(args.data_dir / 'labels.npy', allow_pickle=False)
    classes = json.loads((args.data_dir / 'class_names.json').read_text())
    split = json.loads(args.split.read_text())
    test = np.asarray(split['test'], dtype=np.int64)

    label_sets = [set(model_labels(m)) for m in args.models]
    shared = set.intersection(*label_sets) if args.common_only else None

    results = {'split_kind': split['kind'], 'test_samples_total': int(len(test)), 'models': []}
    for path in args.models:
        names = model_labels(path)
        known = {c for c in names if c in classes}
        if shared is not None:
            known &= shared
        keep = np.array([classes[l] in known for l in labels[test]])
        idx = test[keep]
        x = features[idx]
        truth = np.array([names.index(classes[l]) for l in labels[idx]])
        session = ort.InferenceSession(str(path), providers=['CPUExecutionProvider'])
        # Exports are static batch-1 (matching the app), so score one sample at a time.
        logits = np.concatenate([session.run(None, {'features': x[i:i + 1]})[0] for i in range(len(x))])
        pred = logits.argmax(axis=1)
        per_class = {}
        for name in sorted(known):
            m = truth == names.index(name)
            if m.any():
                per_class[name] = round(float((pred[m] == truth[m]).mean()), 4)
        sample = x[:1]
        for _ in range(20):
            session.run(None, {'features': sample})
        times = []
        for _ in range(200):
            t = time.perf_counter()
            session.run(None, {'features': sample})
            times.append((time.perf_counter() - t) * 1000)
        results['models'].append({
            'model': path.name,
            'classes_in_model': len(names),
            'classes_scored': len(known),
            'test_samples_scored': int(len(idx)),
            'accuracy': round(float((pred == truth).mean()), 4),
            'worst_classes': sorted(per_class.items(), key=lambda kv: kv[1])[:5],
            'cpu_ms_p50': round(float(np.percentile(times, 50)), 4),
            'cpu_ms_p95': round(float(np.percentile(times, 95)), 4),
            'parameters': param_count(path),
        })
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    main()
