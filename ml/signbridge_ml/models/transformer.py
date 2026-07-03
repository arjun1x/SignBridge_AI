"""Sign classifier: per-frame linear embed -> depthwise Conv1d stem (local
temporal smoothing) -> Transformer encoder -> masked mean pool -> linear head.
Fixed input length (window_frames, matches shared/feature_spec.json), which
keeps ONNX export static-shape and avoids a train/runtime length mismatch.
"""
import math

import torch
from torch import nn


class SinusoidalPositionalEncoding(nn.Module):
    def __init__(self, d_model: int, max_len: int):
        super().__init__()
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float32).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        self.register_buffer("pe", pe.unsqueeze(0), persistent=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:, : x.shape[1]]


class SignTransformer(nn.Module):
    def __init__(
        self,
        feature_dim: int,
        num_classes: int,
        window_frames: int,
        d_model: int = 192,
        n_heads: int = 4,
        n_layers: int = 3,
        ffn_dim: int = 384,
        dropout: float = 0.1,
        conv_kernel: int = 5,
    ):
        super().__init__()
        self.input_proj = nn.Linear(feature_dim, d_model)
        self.conv_stem = nn.Conv1d(
            d_model, d_model, kernel_size=conv_kernel, padding=conv_kernel // 2, groups=d_model
        )
        self.pos_enc = SinusoidalPositionalEncoding(d_model, window_frames)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_heads,
            dim_feedforward=ffn_dim,
            dropout=dropout,
            activation="gelu",
            batch_first=True,
            norm_first=True,
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)
        self.dropout = nn.Dropout(dropout)
        self.head = nn.Linear(d_model, num_classes)

    def forward(self, x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        """x: (B, T, F) float32. mask: (B, T) bool, True = real frame."""
        h = self.input_proj(x)
        h = h + self.conv_stem(h.transpose(1, 2)).transpose(1, 2)
        h = self.pos_enc(h)

        # TransformerEncoder's src_key_padding_mask expects True = ignore.
        h = self.encoder(h, src_key_padding_mask=~mask)

        mask_f = mask.unsqueeze(-1).float()
        pooled = (h * mask_f).sum(dim=1) / mask_f.sum(dim=1).clamp(min=1.0)
        return self.head(self.dropout(pooled))
