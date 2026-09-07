"""Train, calibrate, test and export a compact fingerspelling MLP.
No training data or pretrained weights are bundled with the source repository.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset, WeightedRandomSampler

from signbridge_ml.fingerspell_features import FEATURE_DIM
from signbridge_ml.fingerspell_data import make_splits, classification_metrics

ROOT = Path(__file__).resolve().parents[2]


class FingerspellMlp(nn.Module):
    def __init__(self, num_classes: int, width: int = 128):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(FEATURE_DIM, width), nn.GELU(), nn.Dropout(0.15),
                                 nn.Linear(width, width), nn.GELU(), nn.Dropout(0.15), nn.Linear(width, num_classes))

    def forward(self, x):
        return self.net(x)


def augment_hands(x):
    """Small rotations/noise; keep the wrist origin and size normalization."""
    pts = x.reshape(-1, 21, 3).clone()
    angle = torch.randn(len(x), device=x.device) * 0.07
    c, s = angle.cos()[:, None], angle.sin()[:, None]
    px, py = pts[:, :, 0].clone(), pts[:, :, 1].clone()
    pts[:, :, 0], pts[:, :, 1] = c * px - s * py, s * px + c * py
    pts += torch.randn_like(pts) * 0.006
    pts -= pts[:, :1, :].clone()
    pts /= pts[:, 9, :].norm(dim=-1).clamp_min(1e-6)[:, None, None]
    return pts.reshape(-1, FEATURE_DIM)


@torch.inference_mode()
def predict(model, x, device, batch=1024):
    model.eval()
    return np.concatenate([model(x[i:i+batch].to(device)).float().cpu().numpy() for i in range(0, len(x), batch)])


def calibrate(logits, labels):
    """Select a temperature on validation only; never tune on held-out test."""
    best = (float('inf'), 1.0)
    for t in np.geomspace(0.5, 5, 61):
        z = logits.astype(np.float64) / t
        z -= z.max(axis=1, keepdims=True)
        nll = float(np.mean(np.log(np.exp(z).sum(axis=1)) - z[np.arange(len(z)), labels]))
        best = min(best, (nll, float(t)))
    return best[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'ml/data/fingerspell')
    parser.add_argument('--out-dir', type=Path, default=ROOT / 'models')
    parser.add_argument('--checkpoint-dir', type=Path, default=ROOT / 'ml/checkpoints/fingerspell_v2')
    parser.add_argument('--name', default='fingerspell_v2')
    parser.add_argument('--epochs', type=int, default=80)
    parser.add_argument('--batch-size', type=int, default=512)
    parser.add_argument('--width', type=int, default=128)
    parser.add_argument('--patience', type=int, default=12)
    parser.add_argument('--seed', type=int, default=0)
    parser.add_argument('--lr', type=float, default=0.001)
    parser.add_argument('--init-checkpoint', type=Path, help='Compatible state_dict; fresh optimizer for fine-tuning')
    parser.add_argument('--allow-ungrouped', action='store_true', help='Development split only; cannot establish webcam/signer generalization')
    args = parser.parse_args()
    if not args.name.startswith('fingerspell_v') or not args.name.removeprefix('fingerspell_v').isdigit():
        parser.error('--name must be fingerspell_vN')
    if min(args.epochs, args.batch_size, args.width, args.patience) < 1 or args.lr <= 0:
        parser.error('Training dimensions, epochs, patience and learning rate must be positive')
    if not (args.data_dir / 'features.npy').exists():
        parser.error('No real landmark data found. Run fingerspell_extract first; see ml/README.md.')
    torch.manual_seed(args.seed); np.random.seed(args.seed)
    features = np.load(args.data_dir / 'features.npy', allow_pickle=False)
    labels = np.load(args.data_dir / 'labels.npy', allow_pickle=False)
    classes_path = args.data_dir / 'class_names.json'
    if not classes_path.exists():
        classes_path = ROOT / 'shared/labels_fingerspell.json'
    classes = json.loads(classes_path.read_text())
    if (features.ndim != 2 or features.shape[1] != FEATURE_DIM or not np.isfinite(features).all()
            or labels.shape != (len(features),) or not np.issubdtype(labels.dtype, np.integer)):
        raise ValueError('Expected finite features (N,63) and integer labels (N,)')
    if labels.min() < 0 or labels.max() >= len(classes) or len(set(classes)) != len(classes):
        raise ValueError('Invalid label map or indices')
    counts = np.bincount(labels, minlength=len(classes))
    if np.any(counts < 5):
        raise ValueError(f'Every class requires at least 5 samples: {dict(zip(classes, counts.tolist()))}')
    group_path = args.data_dir / 'groups.npy'
    groups = np.load(group_path, allow_pickle=False) if group_path.exists() else None
    (train, val, test), split_kind = make_splits(labels, groups, args.seed, args.allow_ungrouped)
    print(f'{len(features)} real samples | train={len(train)} val={len(val)} test={len(test)} | {split_kind}')
    if groups is None:
        print('WARNING: image-level development split is not a webcam or unseen-signer accuracy estimate.')
    args.checkpoint_dir.mkdir(parents=True, exist_ok=True)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    split_record = {'kind': split_kind, 'seed': args.seed, 'train': train.tolist(), 'val': val.tolist(), 'test': test.tolist(),
                    'features_sha256': sha(args.data_dir / 'features.npy'), 'labels_sha256': sha(args.data_dir / 'labels.npy'),
                    'groups_sha256': sha(group_path) if group_path.exists() else None}
    (args.checkpoint_dir / 'split.json').write_text(json.dumps(split_record, indent=2))
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    amp = device == 'cuda' and torch.cuda.is_bf16_supported()
    if device == 'cuda': torch.set_float32_matmul_precision('high')
    x = torch.from_numpy(features.astype(np.float32)); y = torch.from_numpy(labels.astype(np.int64))
    train_counts = np.bincount(labels[train], minlength=len(classes))
    sampler = WeightedRandomSampler(torch.as_tensor(1.0 / np.maximum(1, train_counts[labels[train]])), len(train), replacement=True)
    loader = DataLoader(TensorDataset(x[train], y[train]), batch_size=args.batch_size, sampler=sampler,
                        num_workers=0, pin_memory=device == 'cuda')
    model = FingerspellMlp(len(classes), args.width).to(device)
    if args.init_checkpoint:
        previous_labels = args.init_checkpoint.parent / 'class_names.json'
        if not previous_labels.exists() or json.loads(previous_labels.read_text()) != classes:
            raise ValueError('Fine-tuning requires a matching class_names.json beside the source checkpoint')
        model.load_state_dict(torch.load(args.init_checkpoint, map_location=device, weights_only=True))
    (args.checkpoint_dir / 'class_names.json').write_text(json.dumps(classes, indent=2))
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.001)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, args.epochs)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.03)
    best, stale, history = -1.0, 0, []
    start_time = time.perf_counter()
    for epoch in range(args.epochs):
        model.train(); loss_sum = torch.zeros((), device=device)
        for xb, yb in loader:
            xb, yb = xb.to(device, non_blocking=True), yb.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.autocast(device, dtype=torch.bfloat16, enabled=amp):
                loss = loss_fn(model(augment_hands(xb)), yb)
            loss.backward(); nn.utils.clip_grad_norm_(model.parameters(), 1.0); optimizer.step()
            loss_sum += loss.detach() * len(xb)
        scheduler.step()
        metrics = classification_metrics(predict(model, x[val], device), labels[val], classes)
        history.append({'epoch': epoch+1, 'loss': loss_sum.item()/len(train), 'val_accuracy': metrics['accuracy'], 'val_macro_f1': metrics['macro_f1']})
        print(f"epoch {epoch+1}: loss={history[-1]['loss']:.4f} val_acc={metrics['accuracy']:.4f} macro_f1={metrics['macro_f1']:.4f}")
        if metrics['macro_f1'] > best:
            best, stale = metrics['macro_f1'], 0
            torch.save({k: v.detach().cpu().clone() for k,v in model.state_dict().items()}, args.checkpoint_dir / 'best.pt')
        else: stale += 1
        if stale >= args.patience: break
    training_seconds = time.perf_counter() - start_time
    model.load_state_dict(torch.load(args.checkpoint_dir / 'best.pt', map_location=device, weights_only=True))
    val_logits = predict(model, x[val], device)
    temperature = calibrate(val_logits, labels[val])
    val_metrics = classification_metrics(val_logits, labels[val], classes, temperature)
    test_metrics = classification_metrics(predict(model, x[test], device), labels[test], classes, temperature)
    model.cpu().eval()
    onnx_path = args.out_dir / f'{args.name}.onnx'
    import onnxruntime as ort
    torch.onnx.export(model, (torch.zeros(1, FEATURE_DIM),), str(onnx_path), opset_version=17,
                      input_names=['features'], output_names=['logits'], dynamo=False)
    session = ort.InferenceSession(str(onnx_path), providers=['CPUExecutionProvider'])
    max_diff = 0.0
    with torch.inference_mode():
        for row in x[test[:32]]:
            actual = session.run(None, {'features': row.numpy()[None]})[0]
            expected = model(row[None]).numpy()
            max_diff = max(max_diff, float(np.abs(actual-expected).max()))
    if max_diff >= 1e-4: raise RuntimeError(f'ONNX parity failed: {max_diff}')
    # A classifier-only CPU benchmark, NOT camera-to-text or Windows latency.
    durations = []
    sample = x[test[0]].numpy()[None]
    for _ in range(20): session.run(None, {'features': sample})
    for _ in range(100):
        t = time.perf_counter(); session.run(None, {'features': sample}); durations.append((time.perf_counter()-t)*1000)
    labels_file = args.out_dir / f'{args.name}.labels.json'
    labels_file.write_text(json.dumps(classes, indent=2), encoding='utf-8', newline='\n')
    meta = {'onnx_file': onnx_path.name, 'labels_file': labels_file.name, 'labels_sha256': sha(labels_file),
            'fingerspell_spec_sha256': sha(ROOT/'shared/fingerspell_spec.json'), 'num_classes': len(classes),
            'feature_dim': FEATURE_DIM, 'val_acc': val_metrics['accuracy'], 'temperature': temperature,
            'test_acc': test_metrics['accuracy'], 'test_macro_f1': test_metrics['macro_f1'],
            'split_kind': split_kind, 'unsupported_motion_letters': ['J','Z'],
            'parameter_count': sum(p.numel() for p in model.parameters()), 'onnx_pytorch_max_diff': max_diff}
    (args.out_dir / f'{args.name}.meta.json').write_text(json.dumps(meta, indent=2))
    report = {'config': {k:str(v) if isinstance(v,Path) else v for k,v in vars(args).items()},
              'data': split_record, 'validation': val_metrics, 'test': test_metrics, 'history': history,
              'temperature': temperature, 'training_seconds': training_seconds,
              'classifier_cpu_ms': {'p50':float(np.percentile(durations,50)), 'p95':float(np.percentile(durations,95))},
              'limitations': ['Not a continuous-ASL translation model', 'J/Z require a temporal model',
                              'Frame confidence/accuracy is not word accuracy', 'Benchmark excludes camera/tracking/commit delay']}
    (args.checkpoint_dir / 'report.json').write_text(json.dumps(report, indent=2))
    print(f"Exported {onnx_path}; test accuracy={test_metrics['accuracy']:.4f}; review report.json before syncing")


if __name__ == '__main__':
    main()
