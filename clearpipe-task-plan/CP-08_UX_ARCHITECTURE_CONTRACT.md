# CP-08 — ClearPipe UX Architecture Contract

**Status:** Approved implementation handoff for CP-15, CP-18, and CP-30
**Binding inputs:** `CP-05_ARCHITECTURE_DECISION_RECORD.md` (frozen) and
`CP-04_REFERENCE_UX.md` (interaction intent only).
**Scope:** UX/design-system/slot contract only; this file creates no production
component, route, graph, or backend contract.

## 1. Product boundary and non-negotiable rules

ClearPipe at `/clearpipe` is one authenticated authoring workspace for a
canonical v2 definition. It is not a replacement for `/pipelines`: the existing
`/pipelines` list, controller/task details, lifecycle, and observability remain
unchanged. A real ClearPipe submission hands off to that existing surface; no
parallel history, scheduler, or operations dashboard is permitted.

1. The canonical v2 graph is the sole authoring truth. Shell, canvas-library,
   selection, drawer, hover, request, history, clipboard, and polling state are
   transient projections.
2. Task/function nodes and typed bindings are the only executable visual
   concepts. A resource/dataset is a safe reference or approved binding, never
   a generic executable card. Colour is presentation only.
3. Browser code never runs a pipeline or fabricates run status. Until CP-26
   proves the approved server/Agent path, **Run** is unavailable with its real
   gate explanation.
4. Resource controls consume CP-18's authorized shared query layer; graph/forms
   do not import production clients. Empty, failed, stale, and denied differ.
5. Graphs, exports, URLs, browser persistence, generated source, and logs never
   contain secret values, credentials, browser file contents, or runtime task
   IDs. Only approved opaque safe references are shown/stored.
6. Server authorization, validation, revision checks, route guards, and feature
   flags are authoritative. A hidden/disabled control is explanatory UI only.
7. Unsupported/legacy input remains intact and read-only/unsupported; it is
   never silently dropped, converted, repaired, or shown as runnable.
8. No action is mock-only. Render a control only for a real approved capability,
   or disable it with the exact unavailable reason and no success implication.

## 2. One three-region workspace

### 2.1 Landmarks, reading order, and responsibilities

CP-15 owns
`clearml-web\src\app\features\clearpipe\editor\clearpipe-editor.component.*`.
It retains application navigation/context and
creates one full-height workspace, never a shell per authoring mode.

| Order / landmark | Region | Required behavior | Owner / extension |
|---|---|---|---|
| 1. `header` | Document identity: name, revision, dirty, permission, read-only/unsupported state and library return. | Always visible; long names truncate accessibly; identity precedes commands in DOM. | CP-15; lifecycle supplied by CP-19. |
| 2. `toolbar` | Lifecycle, validation, preview, and the single Run entry point. | Top-centre/anchored work-area surface, not a fourth column. Narrow layouts keep primary commands and labelled overflow. | CP-15 host; CP-23 toolbar/preview; CP-26 real Run hook. |
| 3. `aside` | Palette: registered capability discovery, search/filter, insertion and first-use guidance. | Independently scrollable; desktop collapse/resize; narrow drawer. It is not the primary reading target. | CP-15 region; CP-17 registry. |
| 4. `main` | Dominant graph canvas, nonvisual graph summary, visual navigation, selection and empty state. | Receives all released side-panel width; no persistence/query/shadow graph. | CP-16, consuming CP-10. |
| 5. `aside` | Inspector: selected-node configuration, metadata, diagnostics and selectors. | Independently scrollable; desktop collapse/resize; narrow modal drawer. | CP-15 region; CP-17 host; CP-18/domain forms. |
| 6. status live region | Save, validation, selection, connection, resource and submission announcements. | Does not steal focus or obscure active fields; persistent errors have focusable summaries. | Action owner; CP-30 audit. |

Default tab/reading order is identity, toolbar, palette, canvas summary/canvas
controls, inspector. Each region has a programmatic name and skip/focus entry;
an unnamed `div` is never the only region boundary.

### 2.2 Desktop panels, scroll, and persistence

* **Palette:** header/search/filter precede the catalog list; only the list
  scrolls. Collapse leaves a labelled keyboard-accessible reopen button, never
  a hover-only rail.
* **Canvas:** is the minimum-flex centre. It grows immediately when either
  panel collapses. It owns one intended scroll/pan viewport, not nested document
  scrolling. Viewport, panel, selection, and zoom changes never make a graph
  dirty.
* **Inspector:** opens for explicit selected node/document context. Heading
  names the item/type/state and includes Close. A tab list (Configuration,
  General, then registered tabs) precedes its scrollable panel. Forms/errors
  stay here, not in node cards.
* **Resize:** desktop separators are pointer *and* keyboard operable, with
  `aria-orientation`, current width/percentage, labelled increment/decrement,
  clamping, and separate collapse control. Side panels stay useful and canvas
  stays dominant.
* **Transient layout:** CP-15 may preserve an approved local preference for
  panel width/collapse and viewport only after CP-10/19 confirm it is outside
  the graph. It must tolerate missing/invalid preferences and never persist
  selection, requests, connections, history, clipboard, dirty state, or runs.

### 2.3 Stable slots

Slot extensions receive typed view state and emit intent. They do not access
sibling instances. Generic slot API changes require CP-15 review.

| Slot | Inputs / outputs | Owner and consumers | Prohibited |
|---|---|---|---|
| `workspace.palette` | Catalog/search transient state; `addRequested`, `focusCanvasRequested`. | CP-15 host, CP-17 registry, CP-27 menu alternative. | Queries, generic WIP choices, drag-only insertion. |
| `workspace.canvas` | CP-10 selectors/commands, CP-11 diagnostics, read-only, visual metadata; typed intent/selection/viewport outputs. | CP-16; CP-20/27 contribute. | Shadow graph, untyped edges, persistence, direct APIs. |
| `workspace.inspector` | Selection/diagnostic/mutation context; command intents and focus targets. | CP-17 host; CP-18/21/24/25 extensions. | Host-owned domain forms, secrets, direct clients. |
| `workspace.toolbar.primary` | Lifecycle/diagnostic eligibility and reason codes; command requests. | CP-15; CP-19/23/26 register. | Browser generation/execution or duplicate persistence. |
| `workspace.toolbar.overflow` | Low-frequency real actions and command requests. | CP-19/22/23. | Unlabelled/unsupported action or second toolbar. |
| `workspace.preview` | Server-derived no-launch source/source map and state; real copy/download/open intent. | CP-23. | Editable source or browser compiler. |
| `workspace.execution` | CP-26 preflight/submission/returned state; real handoff ID/URL. | CP-26. | Browser runner, simulated state, run dashboard. |
| `workspace.first-use` | Real capabilities/permissions; create/open/import intent. | CP-15, CP-19, CP-22. | Fake graph/template/capability. |
| `workspace.status` | Structured severity/message/target event only. | CP-15 host; all publish. | Colour-only feedback, raw server/secret payloads. |

## 3. Existing design-system reuse map

Use existing application and Angular Material conventions before adding a
primitive. Paths are exact at this approved baseline.

| Need | Reuse path / convention | ClearPipe requirement |
|---|---|---|
| Route/app context | `clearml-web\src\app\app.routes.ts`, `...\features\clearpipe\clearpipe.routes.ts`, `...\layout\side-nav\side-nav.component.html` | Preserve guarded `/clearpipe`; do not modify `/pipelines` behavior/routing. |
| Shell host | `...\features\clearpipe\editor\clearpipe-editor.component.*` | CP-15 owns the slot composition boundary. |
| Canvas/inspector seams | `...\editor\clearpipe-canvas.component.*`, `...\editor\clearpipe-config-panel.component.*` | CP-16 owns canvas; CP-17 owns generic inspector host. Existing WIP is not v2 UX. |
| Buttons/icons/menus | Angular Material `MatButtonModule`, `MatIconModule`, `MatMenuModule`; `...\shared\ui-components\panel\menu\menu.component.ts` | Visible labels for primary controls; `aria-label` for icon-only; secondary actions in menus. |
| Dialogs | Angular Material `MatDialog`; `...\overlay\confirm-dialog\confirm-dialog.component.ts`; `...\overlay\alert-dialog\alert-dialog.component.ts` | Destructive, lifecycle, and conflict flows trap focus and restore invoker focus. |
| Drawer/panel | `...\shared\ui-components\panel\drawer\drawer.component.ts` | Reuse only if it meets this keyboard/focus/motion contract; otherwise adapt at CP-15 shell boundary, not with a duplicate system. |
| Cards | `...\shared\ui-components\panel\card\card.component.ts`; `...\panel\card2\card-component2.component.ts` | CP-17 composes generic card surfaces; category colour never alone conveys execution. |
| Search | `...\shared\ui-components\inputs\search\search.component.ts` | Label it, retain clear action, and provide immediate empty-state feedback. |
| Forms/tabs | Angular Material form-field/input/select/checkbox/radio/tabs; `...\inputs\button-toggle\button-toggle.component.ts` | Labels, descriptions, required/error association; no editable form in card body. |
| Status/identity | `...\indicators\circle-status\circle-status.component.ts`; `...\components\id-badge\id-badge.component.ts` | Text/icon repeat state; expose safe immutable ID only. |
| Tooltip | `...\indicators\tooltip\tooltip.directive.ts`; `...\components\multi-line-tooltip\multi-line-tooltip.component.ts` | Supplemental only; never sole name, disabled reason, instruction, or error. |
| Feedback/loading | `...\overlay\spinner\spinner.component.ts`; `...\angular-notifier\src\components\notifier-notification.component.html`; `...\overlay\operation-error-dialog\operation-error-dialog.component.ts` | Labelled inline geometry-preserving progress preferred; one notifier path. |
| Resource patterns | `...\datasets\dataset-empty\dataset-empty.component.ts`; `...\datasets\open-datasets\open-datasets.component.html`; `...\experiments\shared\components\select-queue\select-queue.component.ts` | CP-18/21 adapt authorized concepts; no direct credential or unsupported create/download/upload action. |
| `/pipelines` handoff | `...\pipelines\pipelines-page\pipelines-page.component.html`; `...\pipelines-controller\pipeline-details\pipeline-info.component.html` | Link after a real submission; do not embed/reimplement operations UI. |
| Tokens/styles | `clearml-web\src\app\webapp-common\styles\`; existing `--color-*` tokens including `--color-surface-container-lowest`, `--color-on-surface`, `--color-outline-variant`, `--color-primary`, `--color-error`, `--color-warning` | Use semantic tokens, existing type/spacing hierarchy, and contrast in all states; no hard-coded reference palette. |

## 4. Responsive and scrolling contract

Breakpoints are behavioral; implementation may use repository-standard values
but must test each boundary.

| Width / condition | Palette | Canvas | Inspector | Toolbar/dialogs |
|---|---|---|---|---|
| Wide desktop (>=1280 CSS px) | Expanded search/categories; resizable/collapsible. | Dominant; both sides may show. | Visible after selection; resizable/collapsible. | Full labelled primary actions; secondary overflow. |
| Desktop/tablet (960–1279 px) | Condensed labels/icons only with accessible name and Add menu. | Usable after both panels clamp. | Compact width, never covers focus without explicit open. | Save/Validate/Run discoverable; keyboard overflow. |
| Narrow (<960 px) | Closed/default or user choice; modal drawer. One side drawer at a time. | Full underlying work surface and preserved selection. | Modal drawer by explicit Inspect/selection action; one drawer at a time. | Primary actions plus labelled More; no off-screen controls. |
| Small/touch (<600 px or coarse pointer) | Tap-ready drawer and Add; no hover density. | Summary/controls precede optional spatial interaction; no drag/pinch requirement. | Viewport-safe drawer with named Close. | Menus/dialogs fit; no nested modal/drawer trap. |

In all ranges, each palette, canvas, inspector, validation list, selector list,
and preview has one intentional scroll owner. Opening a drawer moves focus to
heading/first meaningful control; close returns focus to invoker. Escape closes
the topmost non-destructive overlay, cancels pending connection, or clears
selection only in that order and never while text editing. Hidden panels retain
selection/form/local graph edits. Panel/drawer layout is transient and never
validates, generates, or marks dirty.

Pointer transitions may be brief; `prefers-reduced-motion: reduce` removes
nonessential panel, drawer, node, connector, minimap, and spinner animation.
No focus, action, status, or meaning depends on motion.

## 5. Visual hierarchy and extension surfaces

### 5.1 Palette and first use

Catalog exposes only CP-17 registered v2 task/function capabilities and approved
non-executable helpers. Group by plain-language purpose; search/filter; show
concise purpose and supported/disabled state. A disabled entry names its reason
(permission, feature availability, support) and does not insert a fake node.

An empty draft is valid first use, not failure. `workspace.first-use` states that
no steps exist and Run/code generation require a valid saved graph; explains
real starts (registered task/function, permitted definition, validated
secret-free import, approved template only when provided); exposes one contextual
primary action (normally **Add step**) plus secondary real starts; and preserves
palette/keyboard Add. It never seeds generic nodes, credentials, sample runtime
IDs, or a runnable-looking graph. With no authorized capability, distinguish
empty availability, feature gate, and access denial and offer only real recovery.

### 5.2 Generic node cards and ports

CP-17 cards are compact projections, not forms/operational consoles: category
icon plus text type, accessible name, one-line purpose, concise safe
resource/execution summary, validation/real status text/icon, then
low-emphasis type/actions. No long description, logs, arbitrary controls, or
unverified execution state belongs in the card.

Selection has a high-contrast outline and programmatic selected state; colour is
supplemental. Explicit selection may open inspector, but traversal of graph
summary must not force a screen-reader user away. Ports outside card edges have
stable labels covering name, direction, accepted binding kinds, multiplicity,
connection, and error; neither colour nor left/right position is sufficient.
A connection is CP-20 typed compatibility output, not proof of generic data
transport. Invalid/dangling/type/multiplicity/cycle/unsupported state appears at
port/card and in focusable validation summary.

### 5.3 Inspector and selectors

The generic inspector host owns heading, close, tabs, scrolling, focus handoff,
and read-only treatment. Extensions own tab content only. Default tabs are
**Configuration** and **General** (safe identity/type/base reference/
permissions); every additional tab has concise label and owning packet.

CP-18 selectors show project, name, immutable ID where appropriate,
version/type/status/tags/last update context. Stable IDs remain authority.
Search, paging, refresh, retry and current result/status are accessible.
Credential/connection UI shows approved reference or management link only:
never values, secret-looking placeholders, or browser-persisted credentials.

## 6. State and disabled-reason contract

State is explicit and distinct everywhere; a failure never becomes an empty
collection.

| State | Presentation and behavior | Owner(s) |
|---|---|---|
| Route/definition loading | Preserve shell geometry and show labelled inline “Loading ClearPipe definition”; never show blank canvas as empty. Focus stays in route context. | CP-15/19 |
| Empty draft / no result | Explain absence, active search/filter if any, permitted next action, and exact Run prerequisite. Do not enable dependent action. | CP-15/17/18 |
| Resource loading/paging | Label busy list, retain confirmed selection; cancel obsolete request. Prior data is explicitly “refreshing/stale.” | CP-18 |
| Stale/failure/offline | Timestamp/stale marker or named failure, Retry/refresh; retain local edits and prior confirmed data separately. | CP-18/19/23/26 |
| Invalid/warning | Toolbar summary count plus inline field/card/port text/icon. Summary focuses exact target. Errors block Generate/Run; warnings only if CP-11 permits. | CP-11 consumers |
| Saving/validation/generation | Exact operation busy label, duplicate prevention, edits retained; completion/failure announced once. | CP-19/23 |
| Saved clean | Show server revision/clean state, never a version-history claim. | CP-19 |
| Conflict/stale revision | Preserve local edits; offer Reload latest, Compare when implemented, Save As, Keep editing; no overwrite. Dialog explains reload loss and restores focus. | CP-19 |
| Read-only | Persistent reason in identity/inspector. Values readable/selectable; mutations absent or disabled with reason. | CP-15/17/19/23/29 |
| Unsupported/legacy | “Unsupported for ClearPipe editing,” names blocker, preserves source, offers safe export/details handoff. No edit, conversion, Run, or success claim. | CP-15/19/22/29 |
| Unauthenticated/forbidden/not found/feature unavailable | Existing auth flow; distinct forbidden/not-found/gate messages without protected data; real back/library/management recovery only. | CP-14/15 |
| Missing resource/queue/connection | Name safe missing category/affected action, never secret; real select/retry/link only; block action. | CP-18/21/24/25/26 |
| Preview loading/error | Read-only server-derived no-launch source with retry; never browser output. Copy/download only when artifact exists. | CP-23 |
| Run unavailable/preflight | Exact gate/blocker beside Run and focusable summary: Agent proof, unsupported, permission, unsaved/dirty, invalid, no queue, stale or missing artifact. No simulated queue/result. | CP-23/26 |
| Submission/result | “Submitting to ClearML” prevents duplicates without optimistic success. Result names returned run/queue and real `/pipelines` handoff; `queue_watched: false` warns after success. Failure/stopped/partial uses real returned data only. | CP-26 |

Disabled controls are for presently unavailable real actions only. Each primary
disabled action has visible adjacent explanation or `aria-describedby`;
tooltip-only reasoning is forbidden. First blocker priority is: unsupported or
feature gate; permission/read-only; saved/clean prerequisite; validation;
resource/queue/configuration; in-flight/stale operation; unavailable artifact.
Omit a control whose capability does not exist. A disabled visual must not leave
a keyboard/handler path that dispatches the operation.

## 7. Keyboard, focus, announcement, and motion baseline

Every pointer flow has discoverable no-drag keyboard/menu parity:

| Intent | Required alternative |
|---|---|
| Add node | Palette **Add** per registered item; canvas command opens Add menu; CP-10/16 determines default placement without DOM/drop coordinates. |
| Graph navigation/selection | Focusable synchronized graph summary lists node/edge name, type, validation, and connection count; controls support move/select. |
| Move node | Context/menu command and documented keyboard nudge; optional approved coordinate command. |
| Connect port | Focus named source, invoke **Connect**, select compatible target from keyboard-filtered list, confirm typed binding; Escape cancels. CP-20 rejects before mutation. |
| Reconnect/delete edge | Focusable edge/summary/context action names source/target/port/kind. |
| Delete/duplicate/copy/paste/select all | CP-10/27 command/menu path, with read-only/disabled reasons; remote resource/run operations are never undoable. |
| Canvas navigation | Named zoom in/out, fit, reset, and graph summary. Pan/zoom/minimap/grid are enhancements only. |
| Panels | Labelled toggles and keyboard resize separator; Escape and focus restore rules from §4. |
| Diagnostics | Focusable summary opens needed panel/drawer, scrolls/focuses exact target, and announces once. |

Platform-aware Save, Save As, Undo/Redo, Delete, Select all, Copy/Paste,
nudge, zoom/fit, panel toggle and Escape may be implemented only outside text
inputs, textareas, selects, contenteditable, menus, and modal-form editing.
`Ctrl/Cmd+S` prevents browser save only when ClearPipe can save or exactly
explain why it cannot. Document shortcuts and do not steal browser/assistive
technology commands.

Visible high-contrast focus applies to controls, cards, ports, tabs, resize
separators and error links. Modal dialogs/drawers have name/description, trap
focus, provide close/cancel, default destructive confirmation to safe cancel,
and restore invoker focus. Deleting a node/edge moves focus to nearest remaining
summary item, canvas summary, or palette Add; never removed DOM. Async updates
never steal focus.

Provide one polite status live region and bounded assertive error region.
Deduplicate polling/loading announcements; never announce raw server data or
secrets. Announce panel state, explicit selection, node/connect changes and
rejections, validation count, save lifecycle/conflict, selector result/state,
Run blocker/submission/result, and unwatched queue warning. Respect
`prefers-reduced-motion`; no connector/node/panel/status animation conveys
meaning.

## 8. Ownership and exact file boundaries

| Packet | Owns | Must not alter |
|---|---|---|
| CP-15 | Shell, slots, panels/drawers, first-use/loading/denied/read-only/error shell and landmarks. | Graph/canvas semantics, forms, lifecycle/run implementation, `/pipelines`. |
| CP-16 | `clearpipe-canvas.component.*`, rendering/event translation, nonvisual summary. | CP-10 authority, shell, persistence/API. |
| CP-17 | Catalog/card/port/inspector registry and `clearpipe-config-panel.component.*` generic host. | Domain forms, queries, binding semantics. |
| CP-18 | Shared authorized query/selectors/resolvers and resource state UI. | Shell, graph state, credentials, feature clients. |
| CP-19 | Create/open/save/reload/CAS/dirty and conflict outcomes. | Import/export, Run, second persistence. |
| CP-20 | Typed port compatibility/connect/reconnect/delete. | Generic edges, canvas graph, duplicate validation. |
| CP-21/24/25 | Dataset/task/function typed inspector registrations. | Generic host/shell/direct APIs/unapproved types. |
| CP-22 | Import/export/leave guards. | Shell layout/arbitrary source conversion. |
| CP-23 | Toolbar contributions/read-only compiled preview. | Shell/manual source/browser generation/execution. |
| CP-26 | Real preflight/submission/returned status and `/pipelines` handoff. | Browser runner/fake status/ops dashboard. |
| CP-27 | Command-backed history/clipboard/selection/nudge/shortcuts. | Duplicate shell/graph store/interchange. |
| CP-30 | Integrated accessibility/responsive/performance audit; fixes land with owner. | Graph/backend semantics for performance. |

Planned ownership reservations (CP-08 must not create them):

| Exact path | Owner | Extension rule |
|---|---|---|
| `clearml-web\src\app\features\clearpipe\editor\clearpipe-editor.component.ts` | CP-15 | Typed slot host/layout/focus-region API only. |
| `...\editor\clearpipe-editor.component.html` / `.scss` | CP-15 | Shell landmarks/slots and tokenized/reduced-motion layout only. |
| `...\editor\clearpipe-canvas.component.*` | CP-16 | `workspace.canvas`; CP-10 selectors and intent only. |
| `...\editor\clearpipe-config-panel.component.*` | CP-17 | Generic extension host; CP-21/24/25 register typed forms only. |
| `clearml-web\src\app\features\clearpipe\clearpipe-state.service.ts` and `...\domain\graph-store.service.ts` | CP-10 | Sole graph command/selectors. |
| `...\features\clearpipe\clearpipe-api.service.ts` and `...\platform\clearpipe-adapter.service.ts` | CP-14 | Sole production transport boundary. |
| `...\features\clearpipe\domain\graph-v2.types.ts` and `...\domain\graph-v2-codec.ts` | CP-06 | Canonical client projection; no UX field/semantic additions. |

## 9. Acceptance walkthrough and traceability

| Walkthrough | Required result |
|---|---|
| Empty first use | One shell, real supported start, keyboard Add, no fake graph; Run explains prerequisite. |
| Editing | Independent panel scrolling; collapse expands canvas without lost selection/form/graph and without dirty state. |
| Invalid | Inline textual target plus focusable summary; exact blocking reason; no colour-only meaning. |
| Conflict | Local draft survives; reload/compare/save-as/keep-editing never overwrite. |
| Selector | Loading/empty/failed/stale/denied differ; paging/retry accessible; safe context only. |
| Read-only/unsupported | Explicit reason; no editable-looking mutation/lossy conversion/Run; real handoff only. |
| Submission | Before CP-26 proof Run unavailable; after proof uses real service and existing `/pipelines` handoff only. |
| Narrow/keyboard/reduced motion | One drawer, reachable toolbar, no-drag flow, focus/announcements, no motion-dependent meaning. |

This completes CP-08 acceptance criteria: §§2–4 fully specify a responsive
three-pane editor using existing conventions; §§2.3/8 make generic/domain
ownership unambiguous; §6 supplies every major state/disabled presentation; and
§7 defines keyboard alternatives and focus behavior.

## 10. Static verification

This is Markdown-only and intentionally changes no implementation artifact.
Run from `D:\Projects\clearml\.worktrees\cp-08`:

```powershell
git diff --check -- clearpipe-task-plan\CP-08_UX_ARCHITECTURE_CONTRACT.md

@'
from pathlib import Path
p = Path("clearpipe-task-plan/CP-08_UX_ARCHITECTURE_CONTRACT.md")
t = p.read_text(encoding="utf-8")
required = [
    "three-region workspace", "Existing design-system reuse map",
    "Responsive and scrolling contract", "State and disabled-reason contract",
    "Keyboard, focus, announcement, and motion baseline",
    "Ownership and exact file boundaries", "CP-15", "CP-18", "CP-30",
    "workspace.canvas", "first use", "read-only", "Conflict",
    "prefers-reduced-motion", "/pipelines", "mock-only",
]
assert not [item for item in required if item not in t]
assert r"clearml-web\src\app\features\clearpipe\editor\clearpipe-editor.component.*" in t
assert r"clearml-web\src\app\webapp-common\styles" in t
print("CP-08 UX contract completeness: OK")
'@ | py -3 -

git status --short --branch
```

No browser lint/type/test is applicable to this Markdown-only scope. CP-15,
CP-18, and CP-30 own focused implementation tests.

## 11. Handoff limitations

CP-26 remains the real v2 execution gate. CP-29 owns lossless existing-pipeline
representability. Scheduling/history, real-time collaboration/presence, direct
credentials, arbitrary providers, browser uploads as node source, local snippet
execution, and synthetic report executor remain omitted/deferred; no control may
claim them. CP-30 validates this contract in integrated behavior and fixes
accessibility/responsive defects in their owning modules.
