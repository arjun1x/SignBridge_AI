"""Extract real hand landmarks with provenance, duplicate removal and optional groups.
Manifest CSV: path,label,group (use the SAME signer/session group across every letter).
"""
import argparse
import csv
import hashlib
import json
import urllib.request
from pathlib import Path

import numpy as np
from tqdm import tqdm
from signbridge_ml.fingerspell_features import normalize_hand

ROOT = Path(__file__).resolve().parents[2]
CLASSES = [chr(c) for c in range(ord('A'),ord('Z')+1)] + ['space','del','nothing']
MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw-dir', type=Path, default=ROOT/'ml/data/raw_alphabet/asl_alphabet_train/asl_alphabet_train')
    parser.add_argument('--out-dir', type=Path, default=ROOT/'ml/data/fingerspell')
    parser.add_argument('--manifest', type=Path, help='CSV with real signer/session group IDs')
    parser.add_argument('--per-class', type=int, default=3000)
    args = parser.parse_args()
    rng = np.random.default_rng(0)
    if args.manifest:
        with args.manifest.open(newline='', encoding='utf-8-sig') as f: rows = list(csv.DictReader(f))
        if not rows or any(not r.get('group','').strip() or r.get('label') not in CLASSES for r in rows):
            raise ValueError('Every manifest row requires path, known label, and nonempty group')
        rows = [{**r, 'path': str(args.manifest.parent / r['path'])} for r in rows]
    else:
        rows = []
        for label in CLASSES:
            paths = sorted(p for p in (args.raw_dir/label).glob('*') if p.suffix.lower() in {'.jpg','.jpeg','.png'})
            if len(paths) > args.per_class: paths = [paths[i] for i in rng.choice(len(paths), args.per_class, replace=False)]
            rows.extend({'path':str(p), 'label':label, 'group':''} for p in paths)
    if not rows: raise ValueError('No images found. Supply --raw-dir or --manifest.')
    model = ROOT/'ml/data/hand_landmarker.task'
    if not model.exists():
        model.parent.mkdir(parents=True, exist_ok=True)
        temp = model.with_suffix('.partial')
        try: urllib.request.urlretrieve(MODEL_URL, temp); temp.replace(model)
        finally: temp.unlink(missing_ok=True)
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision
    task = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)), running_mode=vision.RunningMode.IMAGE,
        num_hands=1, min_hand_detection_confidence=0.6, min_hand_presence_confidence=0.6))
    features, kept, seen = [], [], {}
    skipped = 0
    try:
        for row in tqdm(rows, desc='Extracting real hand landmarks'):
            digest = hashlib.sha256(Path(row['path']).read_bytes()).hexdigest()
            if digest in seen:
                if seen[digest] != row['label']: raise ValueError('Identical image has conflicting labels')
                continue
            seen[digest] = row['label']
            result = task.detect(mp.Image.create_from_file(row['path']))
            if not result.hand_landmarks: skipped += 1; continue
            points = np.array([[p.x,p.y,p.z] for p in result.hand_landmarks[0]])
            feat = normalize_hand(points, result.handedness[0][0].category_name == 'Left')
            if not np.isfinite(feat).all(): skipped += 1; continue
            features.append(feat); kept.append({**row, 'sha256':digest})
    finally: task.close()
    if not features: raise ValueError('No detectable hands in the supplied images')
    classes = [c for c in CLASSES if any(r['label']==c for r in kept)]
    args.out_dir.mkdir(parents=True, exist_ok=True)
    np.save(args.out_dir/'features.npy', np.stack(features).astype(np.float32))
    np.save(args.out_dir/'labels.npy', np.array([classes.index(r['label']) for r in kept], dtype=np.int64))
    (args.out_dir/'class_names.json').write_text(json.dumps(classes, indent=2))
    groups = args.out_dir/'groups.npy'
    if args.manifest: np.save(groups, np.array([r['group'] for r in kept], dtype=str))
    else: groups.unlink(missing_ok=True) # never accidentally reuse a previous dataset's groups
    with (args.out_dir/'samples.csv').open('w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=['path','label','group','sha256'], extrasaction='ignore')
        writer.writeheader(); writer.writerows(kept)
    print(f'{len(features)} samples, {len(classes)} classes, {skipped} images with no usable hand. No-hand frames are rejected before classification.')
    if not args.manifest: print('No signer/session IDs: only a development split is possible; collect grouped webcam examples for a valid generalization test.')


if __name__ == '__main__':
    main()
