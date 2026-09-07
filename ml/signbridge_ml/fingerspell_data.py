"""Auditable splits for image/landmark data. No synthetic signer identities."""
import numpy as np


def make_splits(labels, groups=None, seed=0, allow_ungrouped=False):
    labels = np.asarray(labels)
    rng = np.random.default_rng(seed)
    if len(labels) < 15:
        raise ValueError('At least 15 real samples are required')
    if groups is None:
        if not allow_ungrouped:
            raise ValueError('No groups.npy: provide real signer/session groups, or explicitly pass --allow-ungrouped for a development-only split')
        # Stratify by label. Clearly reported as NOT signer-independent.
        splits = [[], [], []]
        for label in np.unique(labels):
            ids = rng.permutation(np.flatnonzero(labels == label))
            if len(ids) < 5:
                raise ValueError(f'Class {label} needs at least 5 samples')
            n = max(1, int(len(ids) * 0.15))
            for out, part in zip(splits, (ids[2*n:], ids[:n], ids[n:2*n])):
                out.extend(part.tolist())
        return tuple(np.array(s, dtype=np.int64) for s in splits), 'stratified-image-development-only'
    groups = np.asarray(groups).astype(str)
    if len(groups) != len(labels) or np.any(np.char.strip(groups) == ''):
        raise ValueError('Every row must have a nonempty signer/session group')
    unique = np.unique(groups)
    if len(unique) < 7:
        raise ValueError('Provide at least 7 independent groups (prefer signer IDs) for train/validation/test')
    unique = rng.permutation(unique)
    n = max(1, round(len(unique) * 0.15))
    tests, vals = unique[:n], unique[n:2*n]
    test = np.flatnonzero(np.isin(groups, tests))
    val = np.flatnonzero(np.isin(groups, vals))
    train = np.flatnonzero(~np.isin(groups, np.concatenate([tests, vals])))
    for name, indices in [('train', train), ('validation', val), ('test', test)]:
        for label in np.unique(labels):
            if not np.any(labels[indices] == label):
                raise ValueError(f'Class {label} absent from {name} groups; collect more balanced groups or choose an explicit split seed')
    return (train, val, test), 'group-disjoint'


def classification_metrics(logits, truth, classes, temperature=1.0):
    logits = np.asarray(logits, dtype=np.float64) / temperature
    scores = np.exp(logits - logits.max(axis=1, keepdims=True))
    scores /= scores.sum(axis=1, keepdims=True)
    pred = scores.argmax(axis=1)
    confusion = np.zeros((len(classes), len(classes)), dtype=np.int64)
    np.add.at(confusion, (truth, pred), 1)
    tp = np.diag(confusion)
    support = confusion.sum(axis=1)
    precision = tp / np.maximum(1, confusion.sum(axis=0))
    recall = tp / np.maximum(1, support)
    f1 = 2 * precision * recall / np.maximum(1e-12, precision + recall)
    ordered = np.sort(scores, axis=1)
    accepted = (ordered[:, -1] >= 0.72) & ((ordered[:, -1] - ordered[:, -2]) >= 0.18)
    accepted &= ~np.isin(np.asarray(classes)[pred], ['J', 'Z', 'nothing'])
    return {'accuracy': float(np.mean(pred == truth)),
            'macro_f1': float(np.mean(f1[support > 0])),
            'acceptance_coverage': float(accepted.mean()),
            'accepted_accuracy': float(np.mean(pred[accepted] == truth[accepted])) if accepted.any() else None,
            'sample_count': len(truth),
            'per_class': [{'label': label, 'support': int(support[i]), 'precision': float(precision[i]),
                           'recall': float(recall[i]), 'f1': float(f1[i])} for i, label in enumerate(classes)],
            'confusion_matrix': confusion.tolist()}
