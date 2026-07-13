# App Instances Area — Implementation Notes

Reference of how the **App Instances** panel in the Run:AI Autoscaler sidebar was
rebuilt in the static preview ([autoscaler-preview.html](autoscaler-preview.html)),
so it can be ported to the real Angular component:

- Template: `src/app/webapp-common/workers-and-queues/containers/autoscaler/autoscaler.component.html`
- Styles: `src/app/webapp-common/workers-and-queues/containers/autoscaler/autoscaler.component.scss`

Two things changed:

1. **Row look** — table-style rows (per-workload logo, name, colored status with
   duration, project link, separators) modeled on the reference table.
2. **Vertical fill** — the list grows to fill the remaining sidebar height and
   only scrolls when it overflows.

---

## 1. Row markup

Each instance row is a 2-column grid: a **logo** cell + a **body** cell, with the
row-actions absolutely positioned and revealed on hover.

```html
<div class="app-instance-row" [class.selected]="...">
  <div class="ai-logo"><!-- svg or <mat-icon> per workload type --></div>
  <div class="ai-body">
    <div class="ai-top">
      <span class="ai-name">{{ instance.name }}</span>
      <!-- status class: running (default) | pending | failed -->
      <span class="ai-status">Running <span class="ai-dur">(25m)</span></span>
    </div>
    <div class="ai-meta">
      {{ instance.type | titlecase }} ·
      <a class="ai-project" (click)="selectProject(instance.project)">{{ instance.project }}</a>
    </div>
  </div>
  <div class="ai-actions">
    <button mat-icon-button aria-label="Stop" (click)="stopInstance($event, instance)">
      <mat-icon fontSet="al" fontIcon="al-ico-abort"></mat-icon>
    </button>
    <button mat-icon-button aria-label="Delete" (click)="deleteInstance($event, instance)">
      <mat-icon fontSet="al" fontIcon="al-ico-trash"></mat-icon>
    </button>
  </div>
</div>
```

Logo per workload type (from the reference): Jupyter (Workspace), NVIDIA
(Training), PyTorch (Inference). In the real component prefer existing
`al-ico-*` glyphs or the workload-type icons already used elsewhere, e.g.:

- Workspace → `al-ico-experiment-view`
- Training  → `al-ico-queues` / GPU icon
- Inference → `al-ico-model-endpoints`

Status text is derived from `instance.status`; map `completed/succeeded` etc. to
the running/green style, `pending/queued` to warning, `failed/error` to failed.

---

## 2. Row styles

```scss
.app-instance-row {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 9px 10px 9px 12px;
  border-bottom: 1px solid var(--color-outline-variant);
  color: var(--color-on-surface);
  cursor: pointer;

  &:hover { background: var(--color-surface-container-high); }
  &.selected { background: var(--color-tint-8); }   // rgba(from primary / 8%)
}

.ai-logo { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; }

.ai-body { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ai-top  { display: flex; align-items: baseline; gap: 8px; }

.ai-name {
  flex: 1 1 auto; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 600;
}

.ai-status { flex: 0 0 auto; font-size: 12px; font-weight: 600; white-space: nowrap; color: var(--color-running); }
.ai-status.pending { color: var(--color-warning); }
.ai-status.failed  { color: var(--color-failed); }
.ai-dur { font-weight: 400; opacity: 0.85; }

.ai-meta {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 11px; font-weight: 500; color: var(--color-on-surface-variant);
}
.ai-project { color: var(--color-primary); text-decoration: none; &:hover { text-decoration: underline; } }

// Actions overlaid on the right, fade-in on hover with a gradient mask
.ai-actions {
  position: absolute; top: 50%; right: 6px; transform: translateY(-50%);
  display: flex; gap: 2px; padding-left: 24px; opacity: 0;
  background: linear-gradient(to right, transparent, var(--color-surface-container-high) 40%);
}
.app-instance-row:hover .ai-actions { opacity: 1; }
```

---

## 3. Vertical fill (fill the sidebar, scroll only on overflow)

The key is a chain of `flex` columns from the page shell down to the list, each
with `min-height: 0` so the list is the flex child that scrolls.

```scss
.provider-sidebar {                 // was a plain block
  display: flex; flex-direction: column;
  min-height: 0; overflow: hidden;
}

.sidebar-block {                    // remove fixed min-height
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column;
}

.instances-toolbar { flex: 0 0 auto; }   // toolbar stays fixed height

.sidebar-state {                    // was display:grid/place-items:center
  flex: 1 1 auto; min-height: 0;
  display: flex; flex-direction: column; gap: 8px;
}

.app-instance-list {                // remove fixed max-height
  flex: 1 1 auto; min-height: 0;
  overflow-y: auto;
}
```

To reclaim vertical space, the sidebar header spacing was compacted
(description margins/line-height and the divider `margin: 70px → 12px 0 10px`).

### Page-shell height chain (preview only)

In the preview the surrounding app shell was made viewport-bound so the columns
scroll internally instead of the whole page:

```scss
.clearml-shell   { height: 100vh; overflow: hidden; }
.clearml-main    { display: flex; flex-direction: column; }
.autoscaler-host { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.screen.active   { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.sm-entity-page-header { flex: 0 0 auto; }            // back header
.provider-dashboard    { flex: 1 1 auto; min-height: 0; }  // 2-col grid
.provider-content      { min-height: 0; overflow-y: auto; }
```

> In the real app the global chrome (`sm-side-nav`, `sm-header`) already bounds
> the routed view to the viewport, so on the Angular side only the
> `.provider-*` / `.sidebar-*` rules from this section are needed — the
> `.clearml-shell` / `.clearml-main` mock rules are preview-only.

---

## Porting checklist (App Instances)

- [x] Replace the instance-row template with the `.ai-logo/.ai-body/.ai-top/.ai-meta` markup.
- [x] Add the row/status/actions SCSS above to `autoscaler.component.scss`.
- [x] Add the flex chain: `.provider-sidebar`, `.sidebar-block`, `.sidebar-state`,
      `.app-instance-list` (remove the fixed `max-height`/`min-height`).
- [x] Confirm the routed host stretches to full height (`:host`/`.provider-dashboard` height-bound).
- [x] Map `instance.status` → `running` / `pending` / `failed` status classes (via `statusClassFor`).

---

# Submit Workload — Asset Card Redesign

The **Submit Workload** dialog's asset selectors (Environment / Compute Resource /
Data Sources) were rebuilt to a card-grid modeled on the reference `grid.html`:
3-per-row cards with an icon, a label, **section-specific multi-line meta**, a
green selected state with a corner check badge, and centered numbered pagination.

## 1. Card markup

Each `.asset-card` holds: a corner **badge** (shown only when selected), an
**icon** (inline SVG), a **name**, and section-specific **meta**.

```html
<div class="asset-card" [class.selected]="isEnvironmentSelected(resource)"
     (click)="selectEnvironment(resource)">
  <span class="asset-card-badge">
    <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
  </span>
  <span class="asset-card-icon"><!-- inline SVG, stroke="currentColor" --></span>
  <span class="asset-card-name">{{ resource.name }}</span>
  <span class="asset-card-meta"><!-- section-specific, see below --></span>
</div>
```

Icons use `stroke="currentColor"` (line icons) so they recolor with the card
state automatically (`.asset-card-icon` color → accent when `.selected`).

### Section-specific meta

| Section          | Meta content                                                                 |
|------------------|------------------------------------------------------------------------------|
| Environment      | `<b>Image:</b> {{ resource.image }}`                                         |
| Compute Resource | `GPU devices`, `GPU % (of device)`, `CPU compute (Cores)`, `CPU Memory (MB)` — one per line (`<br>`) |
| Data Sources     | `Type: {{ resource.type }}` (NFS / PVC …)                                     |

Suggested icons (inline SVG in the preview; can be swapped for `al-ico-*`):

- Environment → container/box glyph
- Compute → GPU-rack glyph (stacked rounded rects + dots)
- Data Source → NFS folder / PVC hexagon glyph

Pagination (`.asset-pagination` with `.asset-page-num` items, `.active` on the
current page) sits centered below each grid.

## 2. Card styles

```scss
.asset-cards {
  --asset-accent: #7cb305;                 // Run:AI / NVIDIA green
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}

.asset-card {
  position: relative;
  display: flex; flex-direction: column; align-items: flex-start; gap: 12px;
  min-height: 180px;
  padding: 24px 20px;
  border: 1px solid var(--color-outline-variant);
  border-radius: 6px;
  background: var(--color-surface-container-lowest);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  transition: border-color 0.15s, box-shadow 0.15s;

  &:hover { box-shadow: 0 4px 6px rgba(0,0,0,0.08); }
  &.selected { border: 2px solid var(--asset-accent); padding: 23px 19px; }  // keep size stable
}

.asset-card-badge {                        // green corner, white check, only when selected
  display: none;
  position: absolute; top: 0; right: 0;
  width: 20px; height: 20px;
  background: var(--asset-accent);
  border-top-right-radius: 5px; border-bottom-left-radius: 5px;
  align-items: center; justify-content: center;
}
.asset-card.selected .asset-card-badge { display: inline-flex; }
.asset-card-badge svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }

.asset-card-icon { display: flex; align-items: center; gap: 8px; height: 48px; color: var(--color-on-surface-variant); }
.asset-card.selected .asset-card-icon { color: var(--asset-accent); }
.asset-card-icon svg { height: 42px; width: auto; }

.asset-card-name { font-size: 16px; font-weight: 500; line-height: 1.4; color: var(--color-on-surface); }
.asset-card.selected .asset-card-name { color: var(--asset-accent); font-weight: 600; }

.asset-card-meta { font-size: 13px; line-height: 1.5; color: var(--color-on-surface-variant); word-break: break-all; }
.asset-card-meta b { font-weight: 600; color: var(--color-on-surface); }

.asset-pagination { display: flex; justify-content: center; align-items: center; gap: 8px; margin-top: 24px; }
.asset-page-num {
  padding: 4px 10px; border-radius: 4px; min-width: 12px;
  font-size: 13px; font-weight: 500; color: var(--color-on-surface-variant); cursor: pointer;
}
.asset-page-num:hover:not(.active) { color: var(--color-on-surface); background: var(--color-surface-container-high); }
.asset-page-num.active { color: #fff; background: #9e9e9e; font-weight: 600; cursor: default; }  // grey active, per reference
```

## 3. Green palette for the dialog

The whole Submit Workload dialog switches from the app's blue primary to the
green card accent by **overriding the palette variables on the dialog panel
only** — every descendant that uses `var(--color-primary)` (buttons, field focus,
accordion arrows, kicker, hovers, links) turns green, while the rest of the app
and the other dialogs keep ClearML blue:

```scss
.workload-dialog {          // in the real app: the mat-dialog panelClass 'runai-workload-dialog'
  --color-primary: #7cb305;
  --color-on-primary: #ffffff;
  --color-tint-8: rgba(124, 179, 5, 0.08);
  --color-tint-12: rgba(124, 179, 5, 0.12);
}
```

> In the real component the dialog is opened with
> `panelClass: 'runai-workload-dialog'`, so apply these variable overrides to
> that panel class (global style, since the dialog renders in an overlay outside
> the component view). The numbered pagination keeps its neutral grey active
> state (it does not use the primary color).

---

## Porting checklist (Submit Workload)

- [x] Replace each asset selector's cards with the `.asset-card` markup
      (badge + icon + name + section meta) for Environment / Compute / Data Sources.
- [x] Add the `.asset-card*` + `.asset-pagination` SCSS, including
      `--asset-accent` on `.asset-cards`.
- [x] Feed section-specific meta from the resource models
      (image / GPU+CPU spec / type).
- [x] Apply the green palette override (on the `.workload-dialog` content wrapper, which
      cascades to the whole dialog under the `runai-workload-dialog` panel).
- [x] Keep pagination active state neutral grey (not primary).

---

# Main Content — Workload Info Visualizer

The dashboard main area (previously the *App Instance / Resources and queues /
Instances* metric cards + console panels) was rebuilt into a tabbed workload
**info visualizer** modeled on the reference `runai-metrics.html`: a header block
(hexagon icon + workload name + status), tabs (**Event History / Metrics / Logs /
Details**), and metric cards with charts.

## 1. Structure

```html
<div class="workload-view">
  <header class="wl-header">
    <div class="wl-header-top">
      <div class="wl-hexagon">RUN</div>
      <div class="wl-title">{{ selectedInstance()?.name }}</div>
      <div class="wl-status">No issues found</div>   <!-- derive from status -->
      <div class="wl-info">i</div>
    </div>
    <nav class="wl-tabs">
      <button class="wl-tab" data-tab="events">Event History</button>
      <button class="wl-tab active" data-tab="metrics">Metrics</button>
      <button class="wl-tab" data-tab="logs">Logs</button>
      <button class="wl-tab" data-tab="details">Details</button>
    </nav>
  </header>

  <div class="wl-panel active" data-panel="metrics"> …metric cards… </div>
  <div class="wl-panel" data-panel="events">  …event-list… </div>
  <div class="wl-panel" data-panel="logs">    …wl-log…     </div>
  <div class="wl-panel" data-panel="details"> …details-grid… </div>
</div>
```

- The header connects to the first card of every panel: `.wl-header` has
  `border-bottom: 0` + top radius, and each panel's first card is
  `.metric-card.attached-top` (bottom radius only). A second card uses
  `.metric-card.standalone-bottom` (full radius + `margin-top`).
- In Angular, drive the tabs with a `signal` (e.g. `activeTab`) and
  `[class.active]` / `@if`, or reuse `mat-tab-group`. The preview uses a tiny
  vanilla handler that toggles `.active` on `.wl-tab` + matching `.wl-panel`.

## 2. Panels

- **Metrics** — two `.metric-card`s: *Resources utilization* (`.util-layout` =
  chart + `.stats-sidebar` "Average utilization") and *Resources allocation*
  (full-width chart). Charts are inline `<svg class="chart-svg">` with
  `.grid-line` / `.axis-text` and `.legend-container`. In the real app, feed them
  from a metrics endpoint (or reuse the existing charting lib, e.g. ng2-charts).
- **Event History** — `.event-list` of `.event-row`
  (`grid-template-columns: 12px 140px 1fr auto`): status `.event-dot`
  (`.warn` / `.fail`), time, message, reason.
- **Logs** — `.wl-log` monospace lines + a `.log-source` badge (reuses the
  existing per-instance `getWorkloadLogs` data).
- **Details** — `.details-grid` (2 cols) of `.detail-item`
  (`.detail-key` / `.detail-val`) from the workload record.

## 3. Key styles

```scss
.workload-view {
  --metrics-accent: #558b2f;   // green tab accent (from reference)
  --status-green: #2e7d32;
  --gpu-compute: #3b82f6; --gpu-memory: #a855f7;
  --cpu-compute: #22c55e; --cpu-memory: #f97316; --quota-dash: #f97316;
  display: flex; flex-direction: column;
}

.wl-header { background: var(--color-surface-container-lowest); border: 1px solid var(--color-outline-variant); border-bottom: 0; border-radius: 4px 4px 0 0; padding: 20px 24px 0; }
.wl-hexagon { width: 32px; height: 32px; background: #2563eb; clip-path: polygon(25% 5%,75% 5%,100% 50%,75% 95%,25% 95%,0 50%); display: flex; align-items: center; justify-content: center; color: #fff; font: 700 8px/1 sans-serif; }
.wl-tabs { display: flex; gap: 40px; }
.wl-tab { background: 0; border: 0; padding: 0 0 10px; text-transform: uppercase; color: var(--color-on-surface-variant); position: relative; cursor: pointer; }
.wl-tab.active { color: var(--metrics-accent); }
.wl-tab.active::after { content: ""; position: absolute; bottom: 0; left: 0; width: 100%; height: 3px; background: var(--metrics-accent); }
.wl-panel { display: none; } .wl-panel.active { display: block; }

.metric-card { background: var(--color-surface-container-lowest); border: 1px solid var(--color-outline-variant); box-shadow: 0 1px 3px rgba(0,0,0,.05); }
.metric-card.attached-top { border-radius: 0 0 4px 4px; }
.metric-card.standalone-bottom { border-radius: 4px; margin-top: 20px; }
.metric-card-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--color-outline-variant); }
.metric-card-content { padding: 20px; }
.util-layout { display: grid; grid-template-columns: 1fr 240px; gap: 20px; }
.chart-svg { width: 100%; height: 260px; overflow: visible; }
.grid-line { stroke: var(--color-outline-variant); } .axis-text { font-size: 11px; fill: var(--color-on-surface-variant); }
.stats-sidebar { border-left: 1px solid var(--color-outline-variant); padding-left: 20px; }
```

- Theme-aware: surfaces/borders/text use the app `--color-*` vars (dark mode
  works); only the metric **series** keep their semantic literal colors.
- `@media (max-width: 1100px)` collapses `.util-layout` and `.details-grid` to a
  single column and moves the stats sidebar below the chart.

## Porting checklist (Main visualizer)

- [x] Add the `.workload-view` / `.wl-*` / `.metric-card*` / chart / event / log /
      details SCSS to `autoscaler.component.scss`.
- [x] Replace the `provider-content` cards with the header + 4 tab panels.
- [x] Bind the header (name/status) and Details/Logs from the selected instance.
- [x] Back the Metrics charts with real data — the Run:ai REST API
      (`autoscaler.get_workload_info`) supplies `metrics.series` (rendered as
      normalized SVG trend lines) and `metrics.averages` (the sidebar).
- [x] Track the active tab via a signal (`activeWorkloadTab`).

## Data source (implemented)

- **All workload info is fetched from the Run:ai REST API**, not the CLI. Clicking
  an app instance dispatches `autoscalerActions.getWorkloadInfo({workloadId})`
  using the `workload_id` captured from `runai workload list -A --json`.
- The apiserver stores an `accessToken` obtained from `POST {cp_url}/api/v1/token`
  (client-credentials) at connection time (`AutoscalerSettings.runai_api_token`
  + `runai_api_token_expiry`, refreshed on expiry with a 60s skew).
- `autoscaler.get_workload_info` aggregates `GET /api/v1/workloads/{id}`,
  `/events`, `/logs?tailLines=200`, and `/metrics` (GPU/CPU utilization + memory,
  60 samples) into `{connected, workload_id, details, events, logs, metrics}`.
- The visualizer polls `getWorkloadInfo` every 5s while an instance is selected.
