# Model Training Report — `resnet152-local-921`

**Project:** balanced · **Type:** Training · **Status:** ✅ Completed
**Task ID:** `607fab0c3d5146c4b29972a91040d97e`
**Author:** NAVED · **Run date:** 2026-07-24
**Duration:** ~2h 23m (09:35:52 → 11:59:06 UTC) · **Iterations:** 331

---

## 1. Summary

A **ResNet‑152** binary classifier was fine‑tuned from ImageNet weights on the
`balanced` dataset. The model reached near‑perfect validation performance
(**average precision 0.9997**, **ROC‑AUC 0.9998**, **F1 0.9979**) while satisfying
the operational constraint of a **≥0.95 minimum fail recall**. Best weights were
exported to PyTorch, ONNX, and a FP16 TensorRT engine for deployment.

---

## 2. Final Metrics

### Validation (selection metric: `average_precision`)

| Metric | Value |
|---|---|
| Average precision | **0.9997** |
| ROC‑AUC | 0.9998 |
| Accuracy | 0.9979 |
| Balanced accuracy | 0.9979 |
| Precision | 0.9989 |
| Recall | 0.9968 |
| Specificity | 0.9989 |
| F1 | 0.9979 |
| Loss | 0.1246 |
| Operating threshold | 0.5150 |

### Training

| Metric | Value |
|---|---|
| Accuracy | 0.9999 |
| Loss | 0.1174 |

### Learning rate (final)

| Group | LR |
|---|---|
| Backbone | 2.17e‑05 |
| Head | 2.17e‑04 |

---

## 3. Hyperparameters

| Parameter | Value | Parameter | Value |
|---|---|---|---|
| Architecture | ResNet‑152 | Optimizer | AdamW |
| Pretrained weights | ImageNet | Backbone LR | 3e‑05 |
| Image size | 224 | Head LR | 3e‑04 |
| Epochs | 50 | Weight decay | 1e‑04 |
| Freeze epochs | 3 | Warmup epochs | 2 |
| Batch size | 8 | Min LR ratio | 0.01 |
| Gradient accumulation | 16 | Label smoothing | 0.05 |
| **Effective batch** | **128** | Dropout | 0.3 |
| AMP (mixed precision) | True | Gradient clip | 1.0 |
| Freeze BatchNorm | True | EMA decay | 0.999 |
| Augmentation | light (rot 5°) | Seed | 42 |
| Val / Test fraction | 0.15 / 0.15 | Selection metric | average_precision |
| Threshold objective | f1 | Min fail recall | 0.95 |
| Early‑stop patience | 10 | Min delta | 1e‑04 |

---

## 4. Environment

| | |
|---|---|
| ClearML | 2.1.10 |
| Entry point | `train_resnet152_campfire.py` |
| Python | 3.12.12 |
| OS | Windows 11 (26200) |
| CPU | AMD64, 20 cores, 31.6 GB RAM |
| GPU | NVIDIA RTX A1000 6 GB Laptop |
| GPU driver / CUDA | 595.95 / 13.2 |

### Resource utilization (last sample)

| GPU util | GPU mem | Power | Temp |
|---|---|---|---|
| 59.3% | 36.3% | 29.8 W | 70.9 °C |

---

## 5. Output Artifacts

| Artifact | File | Size |
|---|---|---|
| Best checkpoint | `best.pt` | 233.5 MB |
| ONNX export (opset 17) | `best.onnx` | 233.0 MB |
| TensorRT engine (FP16) | `best.engine` | 233.2 MB |
| Augmentation preview | `augmentation_preview.png` | 2.1 MB |

**Registered models:** `best` (`692ead3c9dcf46d09867419d959ca7d6`) · `last` (`c9ff3d6a559142e9b22310a72193e98a`)

---

## 6. Notes & Next Steps

- Validation metrics are extremely high (>0.997 across the board), so verify the
  held‑out **test split** to rule out any train/val leakage before promoting.
- The chosen operating threshold (0.515) meets the fail‑recall floor; re‑tune if
  the production cost of false negatives changes.
- TensorRT engine is device/driver‑specific — rebuild on the target inference GPU.
