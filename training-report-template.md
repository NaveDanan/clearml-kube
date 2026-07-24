# Model Training Report — `<TASK_NAME>`

**Project:** <PROJECT> · **Type:** Training · **Status:** <STATUS>
**Task ID:** `<TASK_ID>`
**Author:** <AUTHOR> · **Run date:** <YYYY-MM-DD>
**Duration:** <Hh Mm> (<START> → <END> UTC) · **Iterations:** <N>

---

## 1. Summary

A **<ARCHITECTURE>** <task type, e.g. binary classifier> was trained on the
`<DATASET>` dataset. The model reached <one-line headline result, e.g.
**F1 0.99**, **ROC‑AUC 0.99**> while satisfying <key constraint / objective>.
Best weights were exported to <formats, e.g. PyTorch / ONNX / TensorRT>.

---

## 2. Final Metrics

### Validation (selection metric: `<METRIC>`)

| Metric | Value |
|---|---|
| <Primary metric> | **<value>** |
| Accuracy | <value> |
| Precision | <value> |
| Recall | <value> |
| F1 | <value> |
| Loss | <value> |
| Operating threshold | <value> |

### Training

| Metric | Value |
|---|---|
| Accuracy | <value> |
| Loss | <value> |

### Learning rate (final)

| Group | LR |
|---|---|
| <group> | <value> |

### Training curves

> ClearML embed: hover any plot in the experiment → **Copy embed code** → paste it
> below. Or fill in the placeholders (`<TASK_ID>`, `<METRIC>`, `<VARIANT>`,
> `<COMPANY_ID>`). Use `type=scalar` for scalar series.

<!-- Loss (train vs val) -->
<iframe src="/widgets?type=scalar&objectType=task&objects=<TASK_ID>&metrics=<METRIC>&variants=<VARIANT>&company=<COMPANY_ID>" name="loss-curve" width="100%" height="400"></iframe>

<!-- Primary validation metric over iterations -->
<iframe src="/widgets?type=scalar&objectType=task&objects=<TASK_ID>&metrics=<METRIC>&variants=<VARIANT>&company=<COMPANY_ID>" name="metric-curve" width="100%" height="400"></iframe>

---

## 3. Hyperparameters

| Parameter | Value | Parameter | Value |
|---|---|---|---|
| Architecture | <value> | Optimizer | <value> |
| Pretrained weights | <value> | Learning rate | <value> |
| Image size | <value> | Weight decay | <value> |
| Epochs | <value> | Warmup epochs | <value> |
| Batch size | <value> | Scheduler | <value> |
| Gradient accumulation | <value> | Label smoothing | <value> |
| **Effective batch** | **<value>** | Dropout | <value> |
| AMP (mixed precision) | <value> | Gradient clip | <value> |
| Augmentation | <value> | Seed | <value> |
| Val / Test fraction | <value> | Selection metric | <value> |
| Early‑stop patience | <value> | Min delta | <value> |

---

## 4. Environment

| | |
|---|---|
| ClearML | <version> |
| Entry point | `<script>` |
| Python | <version> |
| OS | <os> |
| CPU | <cores / RAM> |
| GPU | <model / memory> |
| GPU driver / CUDA | <driver> / <cuda> |

### Resource utilization (last sample)

| GPU util | GPU mem | Power | Temp |
|---|---|---|---|
| <%> | <%> | <W> | <°C> |

---

## 5. Output Artifacts

| Artifact | File | Size |
|---|---|---|
| Best checkpoint | `<file>` | <size> |
| <Export format> | `<file>` | <size> |
| <Other artifact> | `<file>` | <size> |

**Registered models:** `<name>` (`<model_id>`) · `<name>` (`<model_id>`)

---

## 6. Plots & Visualizations

> Use `type=plot` for non-scalar plots (confusion matrix, PR / ROC curve,
> histograms). Paste the **Copy embed code** from ClearML, or fill the
> placeholders below.

### Confusion matrix

<!-- <iframe src="/widgets?type=plot&objectType=task&objects=<TASK_ID>&metrics=<PLOT_METRIC>&variants=<PLOT_VARIANT>&company=<COMPANY_ID>" name="confusion-matrix" width="100%" height="400"></iframe> -->
<iframe src="/widgets?type=plot&objectType=task&objects=<TASK_ID>&metrics=<PLOT_METRIC>&variants=<PLOT_VARIANT>&company=<COMPANY_ID>" name="confusion-matrix" width="100%" height="400"></iframe>

### Precision–Recall / ROC curve

<iframe src="/widgets?type=plot&objectType=task&objects=<TASK_ID>&metrics=<PLOT_METRIC>&variants=<PLOT_VARIANT>&company=<COMPANY_ID>" name="pr-roc-curve" width="100%" height="400"></iframe>

### Sample / debug image

<!-- Use type=sample to embed a logged debug image (e.g. augmentation preview) -->
<iframe src="/widgets?type=sample&objectType=task&objects=<TASK_ID>&metrics=<IMAGE_METRIC>&variants=<IMAGE_VARIANT>&company=<COMPANY_ID>" name="sample-image" width="100%" height="400"></iframe>

---

## 7. Notes & Next Steps

- <Observation / caveat about the results>
- <Threshold / deployment consideration>
- <Follow-up action or experiment>
