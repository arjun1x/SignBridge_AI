import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import torch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from signbridge_ml.datasets import GislrDataset
from signbridge_ml.fingerspell_data import make_splits
from signbridge_ml.fingerspell_train import augment_hands, calibrate


def test_augmentation_preserves_padding_missing_hands_and_flags(tmp_path):
    features=np.zeros((10,184),dtype=np.float32)
    features[:,42:182]=.2; features[:,183]=1
    np.savez(tmp_path/'one.npz',features=features,label=0)
    ds=GislrDataset(tmp_path,pd.DataFrame([{'sequence_id':'one'}]),64,True,affine_jitter_std=.1,landmark_noise_std=.1)
    x,mask,_=ds[0]
    assert torch.count_nonzero(x[~mask])==0
    assert torch.count_nonzero(x[:,0:42])==0
    assert torch.equal(x[-10:,182],torch.zeros(10))
    assert torch.equal(x[-10:,183],torch.ones(10))


def test_group_splits_have_no_shared_signers():
    groups=np.repeat(np.arange(20),12)
    labels=np.tile(np.arange(3),80)
    (train,val,test),kind=make_splits(labels,groups)
    assert kind=='group-disjoint'
    sets=[set(groups[i]) for i in [train,val,test]]
    assert not (sets[0]&sets[1] or sets[0]&sets[2] or sets[1]&sets[2])
    assert len(set(np.concatenate([train,val,test])))==len(labels)


def test_ungrouped_requires_explicit_acknowledgement():
    with pytest.raises(ValueError,match='groups.npy'):
        make_splits(np.tile(np.arange(3),10))


def test_hand_jitter_keeps_contract():
    x=torch.randn(20,63)
    result=augment_hands(x).reshape(-1,21,3)
    assert torch.isfinite(result).all()
    assert torch.all(result[:,0,:]==0)
    assert torch.allclose(result[:,9,:].norm(dim=-1),torch.ones(20),atol=1e-5)


def test_full_fingerspell_training_export_on_synthetic_fixture(tmp_path):
    # Tests plumbing only. These synthetic weights are temporary, never shipped.
    rng=np.random.default_rng(10)
    features=rng.normal(size=(120,63)).astype(np.float32)
    labels=np.tile(np.arange(3),40)
    np.save(tmp_path/'features.npy',features);np.save(tmp_path/'labels.npy',labels)
    np.save(tmp_path/'groups.npy',np.repeat(np.arange(10),12))
    (tmp_path/'class_names.json').write_text(json.dumps(['A','B','C']))
    command=[sys.executable,'-m','signbridge_ml.fingerspell_train','--data-dir',str(tmp_path),
             '--out-dir',str(tmp_path/'models'),'--checkpoint-dir',str(tmp_path/'checkpoints'),
             '--epochs','2','--width','32']
    result=subprocess.run(command,cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True,timeout=120)
    assert result.returncode==0,result.stderr
    meta=json.loads((tmp_path/'models/fingerspell_v2.meta.json').read_text())
    report=json.loads((tmp_path/'checkpoints/report.json').read_text())
    assert meta['onnx_pytorch_max_diff']<1e-4
    assert report['data']['kind']=='group-disjoint'
    assert len(report['test']['per_class'])==3
    assert meta['labels_file']=='fingerspell_v2.labels.json'
