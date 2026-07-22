# CP-04 Reference UX Analysis

**Scope and confidence.** This report is a product-focused observation of the supplied functional reference, its two supplied workspace captures, and the existing ClearML server and web application. It is a handoff to CP-05 and CP-08, not an implementation contract. Decisions are provisional until the Wave 0 findings are reconciled. “Verified” below means confirmed in the checked-in ClearML server or web source named in the mapping notes.

## Observed capability inventory

### Shell and visual structure

| Capability | Observed behavior | ClearML mapping / limitation |
|---|---|---|
| Three-region workspace | A left node palette, central dotted workspace, and right inspector occupy the full height. Both side regions can collapse and resize. | Maps to a ClearML editor route composed with the existing layout, panel, drawer, menu, form, badge, tooltip, and status conventions. No persisted editor-shell layout contract is yet verified. |
| Floating command bar | A compact, centered bar shows title, save state, document actions, run, and overflow actions without consuming either side panel. | Pipeline controller metadata and task-backed lifecycle actions map; retain ClearML navigation and permission context rather than creating an isolated workspace. |
| Clear state and selection | The title/identity and an unsaved or sharing badge are always visible; selected cards receive a strong outline and open the inspector. | Controller-task identity is real. Server project queries identify pipeline controllers by controller type and pipeline tag (`clearml-server\apiserver\services\projects.py`). |
| Dense card language | Cards use a colored category outline and icon, name, one-line description, compact key/value summary, status mark, type chip, and small actions. | Task, dataset, queue, and controller metadata can supply identity and status. Category color is presentation only; it must not invent execution meaning. |
| Empty first use | The workspace is initially blank while the palette instructs the user to add a node. | No current editor first-use flow is verified; define it in CP-15 with a template or guided task selection, not a fake runnable graph. |

### Editing and navigation

| Capability | Observed behavior | ClearML mapping / limitation |
|---|---|---|
| Palette insertion | Categorized draggable cards create a node at the drop point. Full, condensed, and icon-only palette density changes with width. | Adapt to a registry of supported task-backed and function-backed step types (CP-17). Provide an Add-step menu/button alternative; pointer drag alone is insufficient. |
| Nodes and ports | Each card has left input and right output ports. Connections are directional; self-links and same-side links are rejected. | Adapt only after CP-06/CP-20 define typed ports, artifact/parameter dependencies, and cycle validation. A visual link is not itself a valid ClearML dependency. |
| Node manipulation | Select, move, multi-select, duplicate, copy, paste, arrow-key nudge, and delete are provided; deletion also removes incident links. | Adapt for the canonical graph model. Copy must clear server identity and must not duplicate credentials, secret references beyond approved identifiers, or execution history. |
| Edge manipulation | A connection can be removed from a context action and reconnected if endpoint rules pass. | Adapt in CP-20 with port compatibility and a confirmation/validation message when reconnecting invalidates a dependency. |
| Canvas navigation | Panning, grid snapping, zoom controls, keyboard zoom, fit-to-view, an ephemeral zoom percentage, and a minimap are visible. | Adopt interaction intent in CP-16; all controls need names, keyboard access, and a nonvisual graph summary. |
| Undo and redo | Keyboard undo/redo and bounded history are exposed. | Adapt only for unsaved editor operations. Do not represent remote task, dataset, queue, or run operations as locally undoable. |

### Lifecycle and document actions

| Capability | Observed behavior | ClearML mapping / limitation |
|---|---|---|
| Create, name, rename, open, save, save-as, delete | The command bar and menu support document lifecycle actions and dialogs; saved documents display identity/state. | Adapt to pipeline-controller creation and saved graph drafts only after CP-19 defines persistence. Real controller task lifecycle must be permission-checked. |
| Import and export | A graph can be exported and imported as a document. Invalid imports display failure. | Adapt in CP-22 to a versioned, validated, secret-free graph format. Do not import arbitrary code or trust client-supplied server IDs. |
| Unsaved-change guard | New, open, import, internal navigation, browser back, and unload are guarded by Save, Save As, Don’t Save, and Cancel choices. | Adopt in CP-22 for unsaved draft edits. It must not imply an unsaved remote run can be discarded. |
| Sharing state | A private/shared indicator, member management, and collaborator avatars are surfaced. | Existing ClearML task/project permissions are the authority. A separate graph-member model has no verified server mapping; defer real-time co-editing. |

### Configuration and resources

| Capability | Observed behavior | ClearML mapping / limitation |
|---|---|---|
| Inspector | Selecting a card opens a right panel with a title, ID, close action, Configuration and General tabs, scrollable controls, label, description, and status. | Adapt to capability-specific controls. Show immutable server identity and permissions read-only; never offer arbitrary configuration as if it were a supported pipeline field. |
| Dataset selection | A configured resource can list datasets with project/name, version, file count, tags, pagination, refresh, file browsing, selection, download, version, and create actions. Loading, empty, and error states are present. | Verified ClearML web dataset and dataset-version feature surfaces exist under `clearml-web\src\app\features\datasets` and `...\webapp-common\datasets`. CP-21 must use the real resource adapter and project permissions. |
| Task or script configuration | Cards expose source, parameters, execution target, inputs, output variables, and connected-output suggestions. | Adapt to supported task-backed/function-backed semantics only. CP-03/CP-06 own the exact supported parameter, artifact, and output model. |
| Credentials and connections | The reference presents saved connection selection and, in some modes, direct credential fields. | **Reject direct credential fields.** Graph state, exports, URLs, browser persistence, generated output, and logs must contain neither credential values nor secret material. Use approved ClearML credential/session handling and opaque approved references only. |
| Generic provider/tracker/tool choices | Several alternate data, compute, versioning, and experiment services are selectable. | Omit from ClearML parity: they do not map to a ClearML-native, supportable pipeline contract and would misrepresent execution behavior. |
| Report configuration | A report card offers format and optional content sections. | Defer. ClearML reports/outputs may be linked once CP-03/CP-05 establish a truthful artifact/report contract; do not create a synthetic reporting executor. |

### Execution, status, and observability

| Capability | Observed behavior | ClearML mapping / limitation |
|---|---|---|
| Run pipeline | A prominent run action orders connected cards, displays per-card status, stops after failure, and opens a result summary. Empty graph and missing-input failures are reported. | Verified: `pipelines.start_pipeline` clones a controller task and enqueues it (`clearml-server\apiserver\services\pipelines.py`). CP-26 must invoke the real authorized service and present its returned run identity/status. |
| Queue choice | Execution is associated with a selected target in the reference. | Verified queue discovery and management endpoints: `queues.get_all`, `queues.get_all_ex`, `queues.get_by_id`, and `queues.create` (`...\services\queues.py`). Disable Run with an explained reason if no permitted queue is available. |
| Run/task state | Cards represent idle, running, completed, warning, and error states with message text and status icon. | Adapt to actual controller and child task states; no color-only state. `tasks.get_all[_ex]`, `tasks.get_by_id`, and `tasks.stop` are verified in `...\services\tasks.py`. |
| Logs and results | The inspector contains collapsible output with live indication, exit status, filter, search, empty/filter-empty states, copy/download, totals, and timestamps; a run result dialog lists each step. | Verified task-log retrieval through `events.get_task_log` (`...\services\events.py`). CP-26 should paginate/stream authorized task logs and distinguish controller log from step log. |
| Generic local execution | Some reference cards execute local paths or arbitrary snippets directly and otherwise mark unsupported cards completed/skipped. | Omit. It conflicts with ClearML’s remote task/controller and queue semantics and would create a mock-only production path. Unsupported nodes must block validation/run, not show success. |

### Collaboration

| Capability | Observed behavior | ClearML mapping / limitation |
|---|---|---|
| Presence, cursors, and edit broadcasts | Online avatars, remote cursors, membership roles, heartbeat presence, and broadcasts for node/edge/config changes are implemented in the reference. | Defer. The checked-in ClearML services verify resource/task authorization but no server-side co-editing graph protocol or conflict-resolution contract. Do not simulate collaboration for parity. |
| Access states | The reference has loading, unauthenticated redirect, denied, and not-found workspace states. | Adapt to ClearML session and server authorization; preserve a distinct unauthorized, forbidden/read-only, unavailable, and not-found presentation. |

### Responsiveness and accessibility observations

| Area | Observed behavior | Required adaptation |
|---|---|---|
| Panel responsiveness | Palette becomes condensed then icon-only below width thresholds; both side panels collapse. The inspector has a fixed large minimum width. | On narrow layouts use one drawer at a time, preserve the editor focus, and never leave the canvas below a usable width. Do not rely on the fixed inspector width. |
| Semantic alternatives | Several controls are icon-only but expose hover titles; cards and palette primarily rely on drag. | Every icon control needs an accessible name, cards/ports need programmatic labels and state, and Add/connect/reorder/delete need keyboard and menu alternatives. Hover text is supplemental only. |
| Keyboard behavior | Save, save-as, undo/redo, zoom, fit, delete, select-all, copy/paste, nudge, panel toggles, and Escape are handled when not typing in a field or dialog. A shortcut reference is available. | Keep documented platform-aware shortcuts; avoid stealing browser/assistive-technology shortcuts; announce save, validation, run, and connection changes; return focus to the invoking control after dialogs/drawers close. |
| Focus and motion | Focus moves to inspector selection; panel resizing and movement use animation; dialogs are used for lifecycle actions. | Provide visible focus, logical tab order (toolbar, palette, canvas summary, inspector), modal focus containment, reduced-motion behavior, and a no-drag graph interaction path. |
| Visual encoding | Pale blue, violet, orange, green, and pink distinguish categories; dotted canvas and slim lines recede behind cards. | Preserve hierarchy rather than pixels. Meet contrast in all states and repeat category/status in text/icon; color never conveys validation or execution state alone. |

## Candidate parity matrix

| Capability | Decision | Proposed owner | Rationale and boundary |
|---|---|---|---|
| Three-region editor shell, centered command bar, collapsible panels | **Adopt** | CP-15, CP-08 | High-value orientation model; preserve ClearML navigation and use existing components. |
| Canvas pan, zoom, fit, minimap, grid, selection | **Adapt** | CP-16 | Useful spatial interaction, but must work with the canonical graph and accessible alternative. |
| Generic card surface, category summaries, selected state | **Adapt** | CP-17 | Reuse visual hierarchy while binding only approved ClearML metadata/status. |
| Typed ports, links, reconnect, deletion | **Adapt** | CP-20 with CP-06 | Requires actual typed dependency semantics and validation, not generic diagram links. |
| Palette and node insertion | **Adapt** | CP-17 | Registry must expose only supported node capabilities and a keyboard alternative. |
| Inspector tabs and general metadata | **Adapt** | CP-17, CP-18 | Inspectors must be schema/capability driven and display server permission/read-only state. |
| Dataset browser, version selection, file view | **Adopt** | CP-21, CP-18 | Real ClearML dataset surfaces exist; use authorized queries and explicit loading/empty/error states. |
| Task-backed authoring | **Adapt** | CP-24 | Map inputs, overrides, artifacts, queues, and task identity to CP-03 semantics. |
| Function-backed authoring | **Adapt** | CP-25 | Limit to the deterministic supported subset defined by CP-03; reject unsupported serialization/side effects. |
| Save/open/save-as/delete persistence | **Adapt** | CP-19 | Separate editor draft from ClearML controller/task lifecycle and enforce authorization. |
| Import/export plus dirty guard | **Adapt** | CP-22 | Version and validate secret-free graph documents; guard local edits only. |
| Run, queue selection, status, log/result view | **Adapt** | CP-26 | Must call authorized ClearML controller/queue/task/log services; never report skipped work as success. |
| Advanced editor shortcuts, duplication, copy/paste | **Adapt** | CP-27 | Preserve usability only after identity, references, and validation behavior are safe. |
| Responsive drawers, focus, announcements, reduced motion | **Adopt** | CP-30 | Required baseline; the reference reveals the need but is not sufficient by itself. |
| Direct credential entry in nodes | **Omit** | CP-07, CP-18 | Violates the no-secret graph/export/log/browser-storage guardrail. Use approved references/session mechanisms. |
| Generic local snippet execution and arbitrary providers | **Omit** | CP-05, CP-26 | Not valid ClearML pipeline parity and risks mock-only execution. |
| Synthetic report executor | **Defer** | CP-05, CP-25 | Establish a real artifact/report capability before exposing a node. |
| Live co-editing, cursors, and independent sharing model | **Defer** | CP-05, CP-19 | No verified ClearML graph collaboration protocol or conflict-resolution contract. |

## Visual hierarchy handoff for CP-08

1. **Desktop composition:** reserve stable left resource discovery, an expansive middle work area, and contextual right configuration. Keep the command bar floating at the top-center of the work area; it is the primary lifecycle/run surface, not a fourth permanent column.
2. **Reading order:** document identity and dirty/permission state first; then command actions; then the selected graph/card; then inspector details. The palette is discovery, not the primary reading target.
3. **Card hierarchy:** header (category icon, name, one-line purpose, state), compact body (only the most useful resource/execution facts), then a low-emphasis footer (type plus actions). Ports sit outside the card edges. Do not overload cards with editable forms or verbose logs.
4. **Color and density:** use restrained category tints with text/icon labels, a neutral dotted canvas, thin neutral connectors, and a strong selected outline. At ordinary desktop width the reference supports about six readable cards; retain comparable scanability, not literal dimensions or styling.
5. **Inspector behavior:** selection reveals details without covering the selected card on desktop. On narrow screens it becomes a modal drawer; configuration actions and validation messages remain close to the affected field.
6. **Run hierarchy:** Run is the single visually strongest command. Destructive, import/export, and overflow actions are secondary. Disabled Run must state the first blocking reason and link to the relevant card/field.

## Non-happy-path contract

| State | Required presentation and behavior | Owner |
|---|---|---|
| Loading controller, resources, queues, logs | Preserve shell geometry, use labeled progress, allow cancellation only where the server operation supports it, and avoid stale selections. | CP-15, CP-18, CP-26 |
| Empty graph / no pipelines / no datasets / no queues | Explain what is absent, show the permitted next action, and do not enable Run. Dataset/queue absence must distinguish empty result from access failure. | CP-15, CP-18, CP-21, CP-26 |
| Invalid graph or unsupported node | Inline card/port error plus summary near Run; focusable error list jumps to the target. Block generate/run. Never mark unsupported work completed. | CP-06, CP-11, CP-20, CP-26 |
| Resource request failure / offline / stale response | Show retry and timestamp, retain prior confirmed selection separately from failed request data, and do not silently fall back to fabricated data. | CP-18, CP-21, CP-26 |
| Save, import, or export failure | Keep local edits intact, name the failure, offer retry, and validate import before replacing the current graph. | CP-19, CP-22 |
| Unauthorized / forbidden / read-only / not-found | Use distinct status and recovery paths. Hide or disable mutation actions with a reason; server authorization remains authoritative. | CP-07, CP-15, CP-19 |
| Missing secret/connection or unavailable worker | Explain the missing approved configuration or queue/worker condition without revealing values; block the affected action. | CP-07, CP-18, CP-26 |
| Run pending, failed, stopped, or partially complete | Show real controller and child-task identity, state, timestamps, error/message, queue, and log link. Do not offer local undo. | CP-26 |
| Concurrent edit or stale draft | Until co-editing is implemented, detect version conflict at save and offer reload, compare, or save-as; do not overwrite silently. | CP-19 |
| Narrow, keyboard-only, touch, reduced-motion | Drawer replacement, keyboard command/menu alternatives, visible focus, announced changes, and no motion-dependent meaning. | CP-30 |

## Verified ClearML mapping and concrete limitations

- **Pipeline identity and launch are real:** `clearml-server\apiserver\services\pipelines.py` implements `pipelines.start_pipeline`, cloning the selected controller task and enqueueing the resulting run. Project service code classifies pipeline children as controller tasks carrying the pipeline tag. The editor must therefore distinguish a saved graph draft, a controller definition, and an immutable run.
- **Task, queue, project, and log primitives are real:** the server implements task retrieval/lifecycle operations in `...\services\tasks.py`, queue retrieval/management in `...\services\queues.py`, project queries in `...\services\projects.py`, and paginated task-log retrieval in `...\services\events.py`. These are the source for resource selectors, launch eligibility, status, and logs after CP-07 specifies adapters and authorization.
- **Dataset UX has a real product home:** checked-in ClearML web dataset and dataset-version feature surfaces exist at `clearml-web\src\app\features\datasets`, `...\webapp-common\datasets`, and `...\webapp-common\dataset-version`. CP-21 should extend these authorized concepts rather than fabricate a parallel catalogue.
- **Concrete limitations:** the checked-in server does not verify a generic visual-graph persistence or concurrent-edit protocol; real-time cursor broadcasting, independent graph sharing roles, direct credential storage, arbitrary local execution, arbitrary external providers, and a synthetic report executor cannot be claimed as ClearML parity. They are omitted or deferred above.

## Review checklist

- Inventory cross-checked against both supplied workspace captures and the reference behavior source: **complete**.
- ClearML mappings cross-checked against checked-in server/web paths above; unsupported behavior explicitly limited: **complete**.
- Keyboard, panels, loading, empty, disabled, error, permissions, read-only, responsiveness, and accessibility included: **complete**.
- Product deliverable contains no reference implementation technology names or copied implementation: **complete**.
