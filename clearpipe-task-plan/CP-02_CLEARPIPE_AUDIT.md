# CP-02 — Current ClearPipe audit

**Audit date:** 2026-07-22
**Audit owner:** CP-02
**Evidence snapshots:** original assigned baseline `cc5ded3`; current WIP
`master` at `9558961` (`added clearpipe`).  This evidence commit was rebased
onto that master snapshot after the audit.

## Scope and important baseline finding

The original assigned worktree was based on `cc5ded3`.  It contained no
`/clearpipe` route, no `features/clearpipe` directory, and no ClearPipe server
service; its router fell through to the `**` 404 route for `/clearpipe`.
The current WIP is the single later `master` commit `9558961`; all findings
below audit that commit.  This branch now includes that snapshot by rebase.
Existing `/pipelines` is a separate, established controller-run viewer and is
included only where it is coupled to ClearPipe's run-status link.

This is an evidence inventory, not a graph-schema decision.  CP-05 owns
architecture decisions, CP-08 owns UX architecture, and CP-07 owns any
service-contract reconciliation.

## Exact-path route and component map

| Surface | Exact path | Current WIP behavior and dependencies | Status |
|---|---|---|---|
| Root route integration | `clearml-web/src/app/app.routes.ts` | Adds `clearpipe` under the authenticated shell, lazy-loads `clearpipeRoutes`, sets `search: false`, and uses `clearpipeEnabledGuard` (`ConfigurationService`) to return `/404` when disabled. | Real |
| Navigation/configuration | `clearml-web/src/app/layout/side-nav/side-nav.component.html`; `clearml-web/src/configuration.json`; `clearml-web/src/environments/base.ts` | Shows a ClearPipe side-nav icon unless `clearpipeEnabled === false`; defaults the flag to true. | Real, feature flag default requires release review |
| Route table | `clearml-web/src/app/features/clearpipe/clearpipe.routes.ts` | `''` → library, `new` → editor, `:taskId` → editor; both editor routes use `generalLeavingBeforeSaveAlertGuard`.  `new` correctly precedes `:taskId`. | Real |
| Definition library | `clearml-web/src/app/features/clearpipe/library/clearpipe-library.component.{ts,html,scss}` | Debounced search, active/archived toggle, loading/empty/table states, open, archive/restore, and delete dialogs.  Stores the list/search state only in the component. | Real CRUD UI |
| Editor shell/toolbar | `clearml-web/src/app/features/clearpipe/editor/clearpipe-editor.component.{ts,html,scss}` | Route loading, dirty/unload protection, save/save-as, server validation, run dialog, import/export, archive/delete, keyboard undo/redo/delete/escape, conflict reload, and a run-status link to existing `/pipelines/*/tasks/:id`. | Real orchestration; see gaps |
| Canvas | `clearml-web/src/app/features/clearpipe/editor/clearpipe-canvas.component.{ts,html,scss}` | Angular CDK palette drag/drop and free node drag; direct SVG Bézier edges; pan, wheel/button zoom, fixed “center” reset, minimap, node selection, two-click connect, and double-click edge deletion. | Functional minimal canvas |
| Inspector | `clearml-web/src/app/features/clearpipe/editor/clearpipe-config-panel.component.{ts,html,scss}` | Loads projects/tasks/datasets/models/queues/reports/endpoints/storage in parallel; presents type-specific controls and links to existing ClearML resources. | Partial; several controls do not compile to runner-supported configuration |
| Dialogs | `clearml-web/src/app/features/clearpipe/editor/clearpipe-dialogs.component.ts` | Inline name/description and queue/JSON parameter dialogs. | Real, minimal |
| Browser API adapter | `clearml-web/src/app/features/clearpipe/clearpipe-api.service.ts` | Calls authorized v2.35 endpoints through the existing `SmApiRequestsService`; resource lookups use existing ClearML APIs. | Real adapter, DTO tolerance is over-broad |
| Browser model/normalizer | `clearml-web/src/app/features/clearpipe/clearpipe.models.ts` | Defines six node types, graph DTOs, defaults, wrapper normalization, prototype-key detection, and client-side secret-like field/URL detection. | Useful baseline; canonical schema ownership is downstream |
| Browser state | `clearml-web/src/app/features/clearpipe/clearpipe-state.service.ts` | Editor-scoped Angular signals for definition, selection, connection source, dirty/loading, and 50 graph-only snapshots. | Functional minimal state |
| Server endpoint layer | `clearml-server/apiserver/services/clearpipe.py` | Authorized v2.35 create/get/list/update/validate/start/archive/delete/parse-script service over native controller tasks. | Real |
| Server request/response models | `clearml-server/apiserver/apimodels/clearpipe.py` | API models for the above endpoint requests. | Real |
| Server schema registration | `clearml-server/apiserver/schema/services/clearpipe.conf` | Registers the v2.35 endpoint names, but every request and response is merely `type: object`. | Partial contract documentation |
| Server access/persistence | `clearml-server/apiserver/bll/clearpipe/access.py`; `clearml-server/apiserver/services/clearpipe.py` | Uses task company/company-origin checks and controller tasks tagged `pipeline` and `clearpipe` in `.pipelines/<name>` projects; no new database. | Real and valuable |
| Validation | `clearml-server/apiserver/bll/clearpipe/validation.py` | Validates graph size, IDs, edge references/duplicates/cycles, secret-like values, inline-script size, resources, and queues. | Real; server is the authority |
| Script parsing | `clearml-server/apiserver/bll/clearpipe/parser.py` | AST-only parsing of Python/argparse metadata, environment names, and imports. | Real endpoint, unused by current UI |
| Compilation/runner | `clearml-server/apiserver/bll/clearpipe/compiler.py`; `clearml-server/apiserver/bll/clearpipe/controller_runner.py` | Compiles graph/revision into a self-contained ClearML controller runner.  The runner schedules children, propagates dependencies/statuses, retries/timeouts, and writes controller `Pipeline` configuration. | Real execution foundation; node adapter coverage is uneven |
| Packaging/docs | `clearml-server/docker/build/Dockerfile`; `clearml-server/docs/clearpipe.md` | Copies server source; documents no extra service/ingress/database and Agent-environment credential handling. | Preserve |
| Test wiring | `clearml-web/angular.json`; `clearml-web/src/test.ts`; `clearml-web/tsconfig.spec.json`; `clearml-web/tsconfig.clearpipe.spec.json` | Alters global test bootstrap/configuration and creates an unused ClearPipe-specific tsconfig (no Angular target selects it). | High-risk shared test integration |

## Graph dependency and state ownership

### What the WIP actually uses

* The ClearPipe canvas does **not** use React Flow, XYFlow, Cytoscape, or the
  existing `@ngneat/dag` dependency.  It uses Angular CDK
  `CdkDrag`/`CdkDropList` plus hand-drawn SVG paths.
* `clearml-web/package.json` already has `@ngneat/dag`, but it is used by the
  unrelated historical pipeline-run diagram at
  `clearml-web/src/app/webapp-common/pipelines-controller/pipeline-controller-info/pipeline-controller-info.component.ts`
  through `DagManagerUnsortedService`.  It is not a ClearPipe canvas
  dependency.
* Nodes are `{id,type,position,label,description?,config}`.  Edges are only
  `{id,source,target}`.  Positions and viewport are `{x,y}` and
  `{x,y,zoom}`.  There are no typed ports, handles, edge metadata, groups, or
  edge selection state.
* `ClearpipeStateService` is provided by the editor component, not root
  NgRx.  It owns graph edits, selected node, pending connection source, dirty
  state, and an in-memory maximum-50 snapshot history.  It rejects duplicate
  node-to-node edges and cycles locally.
* `load()` resets selection/connection/dirty/history.  `mutateGraph()` records
  only nodes and edges.  Metadata changes set dirty but do not enter history.
  `setViewport()` changes the definition directly: it neither marks dirty nor
  creates history.  No browser persistence exists; manual save is the only
  persistence path.
* The server is the source of persisted graph/revision, validation,
  authorization, resource/queue access, and compilation.  The browser
  normalizer deliberately accepts several wrappers (`definition`, `graph`,
  legacy `configuration.ClearPipe`) rather than one enforced response DTO.

### Existing adjacent pipeline state to preserve as separate

`clearml-web/src/app/webapp-common/pipelines*` and
`clearml-web/src/app/webapp-common/experiments/*` contain the legacy
pipeline-run list/viewer.  Its graph is derived from controller task
`configuration.Pipeline.value`, laid out with `@ngneat/dag`, and selected-step
state is shared in the experiments NgRx reducer.  It invokes real
`pipelines.start_pipeline`, task stop/archive, queues, logs, and task details.
Do not merge its run-observability model into ClearPipe editor state without a
CP-05 decision.

## Visible-action classification

| User action | Classification | Evidence |
|---|---|---|
| Enter `/clearpipe`, search, show archived, open/delete/archive/restore a definition | Real, subject to server availability/permissions | Library calls `get_all`, `archive`, `delete`, and existing `tasks.unarchive`. |
| New/open/save/save-as, revision conflict reload, import/export, validation | Real client flow | Editor calls ClearPipe endpoints and blocks unsafe/secret-like imports/exports/saves. |
| Add/drag/select/duplicate/delete nodes; connect/remove edges; pan/zoom/minimap; undo/redo | Functional local behavior | CDK/SVG canvas and editor-scoped signal service.  It is not a port-aware production graph engine. |
| Run a saved, clean definition | Real backend invocation | Validates, loads queues, then calls `clearpipe.start`; server creates/enqueues a native controller. |
| “Browser upload” dataset/execute/training sources | Placeholder/broken | Inspector exposes choices but does not select/upload a file or produce a supported runner artifact reference. |
| Dataset artifact source | Broken contract | UI writes `artifactName`; runner reads `artifact`. |
| Dataset URL/configured storage | Partial/broken | UI stores `uri`; runner's dataset adapter neither fetches nor returns that URI. |
| Execute repository source | Partial/broken | UI writes `repository`/`entry_point`; runner executes inline script/command behavior, not this UI DTO. |
| Training model/repository/upload sources | Partial/broken | UI offers them; runner supports cloning `taskId` and a different `gitConfig.repoUrl` shape, not UI `modelId`/`repository`/upload fields. |
| Non-ClearML versioning tools and external trackers | Placeholder/partial | UI advertises DVC, Git LFS, MLflow artifacts, custom agent commands, MLflow/W&B/Comet; runner has generic/manifest behavior, not verified integrations or credential/resource wiring. |
| Parse script | Inaccessible feature | Real `clearpipe.parse_script` endpoint and API method have no calling UI. |
| Config resource loading | Real lookup with degraded silent failure | Eight existing API lookups run in parallel; each failure becomes `[]`, so unavailable resources look identical to an empty authorized result. |
| Legacy `/pipelines` run monitoring | Real, separate | ClearPipe run banner delegates to existing controller/run viewer routes. |

## Preserve / adapt / replace / remove matrix

| Classification | Asset (exact path) | Evidence-based disposition |
|---|---|---|
| Preserve | `clearml-server/apiserver/services/clearpipe.py` | Native controller-task lifecycle, versioned endpoints, revisions, archive/delete, queue/resource authorization, and cleanup logic are valuable integration work. |
| Preserve | `clearml-server/apiserver/bll/clearpipe/access.py`, `validation.py`, `parser.py` | Tenant checks, server-side secret/resource/queue validation, size limits, and safe AST parsing are necessary boundaries. |
| Preserve | `clearml-server/apiserver/bll/clearpipe/compiler.py`, `controller_runner.py` | Existing ClearML Agent/controller execution path avoids a second scheduler/service.  Retain while validating every advertised node configuration. |
| Preserve | `clearml-web/src/app/features/clearpipe/clearpipe-api.service.ts` | One feature adapter over `SmApiRequestsService`; keep the real-service boundary rather than creating another client. |
| Preserve | `clearml-web/src/app/features/clearpipe/clearpipe.models.ts` secret/prototype helpers | Client-side early rejection complements—not replaces—the server checks and avoids exposing secret values. |
| Preserve | `clearml-web/src/app/features/clearpipe/clearpipe-state.service.ts` | Local selection, connection, dirty, and undo foundations are useful; retain behind a CP-05/CP-10 agreed graph contract. |
| Preserve | `clearml-web/src/app/features/clearpipe/editor/clearpipe-editor.component.ts` save/run/conflict/unsaved-change flow | Valuable real integrations and safety checks; adapt only after contract decisions. |
| Preserve | `clearml-web/src/app/features/clearpipe/library/clearpipe-library.component.ts` | Useful top-level list lifecycle and permission-aware actions. |
| Adapt | `clearml-web/src/app/features/clearpipe/clearpipe.models.ts` | Normalize one documented server DTO and move node/edge/port semantics to the shared schema selected by CP-05/CP-06; do not silently broaden legacy wrappers indefinitely. |
| Adapt | `clearml-web/src/app/features/clearpipe/clearpipe-state.service.ts` and `editor/clearpipe-canvas.component.ts` | Add only the state/viewport/port semantics established downstream; make dirty/history/persistence behavior coherent. |
| Adapt | `editor/clearpipe-config-panel.component.ts` plus `bll/clearpipe/controller_runner.py` | Reconcile every exposed field to a tested compiler/runner capability, or hide it until supported. |
| Adapt | `clearml-web/src/app/features/clearpipe/clearpipe-api.service.ts`; `clearml-server/apiserver/schema/services/clearpipe.conf`; `apimodels/clearpipe.py` | CP-07 should reconcile exact request/response DTOs, errors, pagination, revisions, and resource query contracts. |
| Adapt | `clearml-web/src/app/app.routes.ts`; `layout/side-nav/side-nav.component.html`; configuration files | Preserve guarded lazy route/navigation, but coordinate feature-flag defaults and ownership with CP-05/CP-08. |
| Replace | Hand-drawn fixed-size SVG edge/layout logic in `editor/clearpipe-canvas.component.ts` | It has no semantic ports, edge labels/metadata, selection, robust fit/layout, or accessibility-complete interaction.  Replacement choice belongs to CP-05/CP-08. |
| Replace | Generic `object` endpoint schema in `clearml-server/apiserver/schema/services/clearpipe.conf` | Replace with contract-accurate schema once CP-07/CP-06 settle shared types. |
| Remove | `clearml-web/tsconfig.clearpipe.spec.json` unless an Angular test target uses it | It is orphaned in the WIP; retaining two unselected test configurations creates false confidence. |
| Remove or make reachable | `ClearpipeApiService.parseScript()` | Remove dead adapter surface or wire it to the script authoring flow with tests; no production UI invokes it. |
| Remove/hide until implemented | Unsupported source/tool/tracker choices in `clearpipe-config-panel.component.html` | Do not present browser upload/external integration choices as working authoring paths before their runner contracts exist. |

## Mock, placeholder, gap, and test catalog

### Concrete mock/placeholder/gap locations

| Category | Exact location | Finding |
|---|---|---|
| Inaccessible real backend capability | `clearml-web/src/app/features/clearpipe/clearpipe-api.service.ts#parseScript`; `clearml-server/apiserver/services/clearpipe.py#parse_script` | Adapter/server endpoint exist; no UI calls it. |
| Browser upload placeholder | `clearml-web/src/app/features/clearpipe/editor/clearpipe-config-panel.component.html` | Dataset, Execute, and Training offer “Browser upload” but no file input, storage upload, artifact creation, or compiler-compatible reference. |
| Config/runner mismatch | `clearpipe-config-panel.component.html` and `clearml-server/apiserver/bll/clearpipe/controller_runner.py` | `artifactName` versus runner `artifact`; `uri` is not executed; repository/model/upload fields differ from runner inputs. |
| Unimplemented advertised ecosystems | `clearpipe-config-panel.component.html`; `clearml-server/apiserver/bll/clearpipe/controller_runner.py` | DVC/Git LFS/MLflow artifacts/custom agent command and MLflow/W&B/Comet are selectable without a demonstrated native integration contract. |
| Silent lookup failure | `clearpipe-config-panel.component.ts#safeResources` | Catches every resource API error and emits an empty option list; no user-visible failure/retry distinction. |
| Viewport state gap | `clearpipe-state.service.ts#setViewport` | Viewport changes skip dirty/history, so unsaved viewport changes are not guarded or undoable. |
| Canvas semantic/accessibility gap | `clearpipe-canvas.component.{ts,html}` | Input/output dots perform identical two-click connections; no ports/types; edge deletion requires double-click on an invisible hit path; palette uses `role=button` with Enter only. |
| Test configuration risk | `clearml-web/angular.json`; `src/test.ts`; `tsconfig.spec.json`; `tsconfig.clearpipe.spec.json` | WIP changes the global test bootstrap/styles/paths while the ClearPipe-specific tsconfig is not referenced by a test target. |
| Legacy retained test debt | `clearml-web/src/app/webapp-common/pipelines-controller/pipeline-controller-info/pipeline-dummydata.ts` | Legacy dummy graph is commented out in the viewer and not used by ClearPipe; keep it out of the ClearPipe path. |

### What tests actually assert

| Exact test path | Assertions actually covered |
|---|---|
| `clearml-web/src/app/features/clearpipe/clearpipe-api.service.spec.ts` | v2.35 URLs, selected DTO field names, response normalization, archive/delete/parse-script adapter calls. |
| `clearml-web/src/app/features/clearpipe/clearpipe-state.service.spec.ts` | Node/edge add/remove, duplicate/cycle prevention, config undo/redo, route load reset. |
| `clearml-web/src/app/features/clearpipe/clearpipe.models.spec.ts` | Secret/unsafe-key helpers and selected normalization wrapper behavior. |
| `clearml-web/src/app/features/clearpipe/clearpipe.routes.spec.ts` | Route ordering and presence of a deactivate guard. |
| `clearml-web/src/app/features/clearpipe/editor/clearpipe-canvas.component.spec.ts` | Drop coordinates at default and transformed viewport. |
| `clearml-web/src/app/features/clearpipe/editor/clearpipe-editor.component.spec.ts` | Route-change stay behavior, dismissed/failed conflict reload, import size limit, and run request lock/error. |
| `clearml-server/apiserver/tests/test_clearpipe.py` | Unit coverage for validator, compiler, parser, runner source, and access helpers (64 assertion/test-match lines in the audit scan). |
| `clearml-server/apiserver/tests/test_clearpipe_service.py` | Service API/persistence/authorization/error-path coverage (33 assertion/test-match lines in the audit scan). |
| `clearml-server/apiserver/tests/verify_clearpipe_schema.py` | Schema registration verification. |

Not covered by the browser tests: end-to-end route/feature-flag behavior,
permission-denied UX, actual server integration, resource lookup failure UX,
save/list pagination, import/export round trip, viewport dirty/history,
keyboard/focus/screen-reader interaction, responsive canvas behavior,
unsupported inspector choices, and a complete controller run through an Agent.

## Minimal migration path and downstream handoff

1. **CP-05:** use this inventory to decide whether the WIP browser model and
   CDK/SVG canvas are retained as extension points.  Explicitly assign ownership
   of the high-conflict files below; do not add a second graph/state system.
2. **CP-06 / CP-07:** establish one canonical graph and v2.35 DTO contract,
   including node configuration capability mapping, edge/port semantics,
   revision/error/pagination rules, and resource lookup authorization.  Keep
   secret validation server-authoritative.
3. **CP-08:** define the workspace/inspector/toolbar responsive and accessible
   contract.  It must either expose supported node capabilities only or label
   unavailable capabilities truthfully.
4. **CP-09:** turn the catalog gaps into contract, component, integration, and
   browser-flow tests.  Restore a targeted test configuration rather than
   relying on the orphaned tsconfig.
5. **Implementation waves:** preserve native task/controller runner and the
   existing adapter, then adapt state/canvas/configuration only against those
   decisions.  Verify a saved definition, validation failure, revision
   conflict, permission denial, archive/delete, and actual queued run before
   exposing each capability.

## High-conflict files for CP-05 assignment

| Exact path | Why it conflicts |
|---|---|
| `clearml-web/src/app/features/clearpipe/clearpipe.models.ts` | Canonical graph/DTO/default-node definitions and security helpers co-reside. |
| `clearml-web/src/app/features/clearpipe/clearpipe-state.service.ts` | Shared graph state, history, dirty, selection, viewport, and connection rules. |
| `clearml-web/src/app/features/clearpipe/editor/clearpipe-canvas.component.{ts,html,scss}` | Graph library/layout/port/canvas behavior and accessibility converge here. |
| `clearml-web/src/app/features/clearpipe/editor/clearpipe-config-panel.component.{ts,html,scss}` | Node schema, resource adapters, and UX controls converge here. |
| `clearml-web/src/app/features/clearpipe/editor/clearpipe-editor.component.{ts,html,scss}` | Route lifecycle, save/run/import/export/conflict/toolbar surfaces converge here. |
| `clearml-web/src/app/features/clearpipe/clearpipe-api.service.ts` | Browser/server DTO compatibility and resource lookup policy converge here. |
| `clearml-server/apiserver/services/clearpipe.py` | Every server lifecycle, authorization, persistence, compile, and run operation converges here. |
| `clearml-server/apiserver/bll/clearpipe/{validation.py,compiler.py,controller_runner.py}` | Schema validation and executable node semantics must change together. |
| `clearml-server/apiserver/apimodels/clearpipe.py`; `clearml-server/apiserver/schema/services/clearpipe.conf` | API contract versions/models/schema registration. |
| `clearml-web/src/app/app.routes.ts`; `clearml-web/src/app/layout/side-nav/side-nav.component.html` | Top-level route/navigation/feature-flag integration. |
| `clearml-web/angular.json`; `clearml-web/src/test.ts`; `clearml-web/tsconfig.spec.json` | Global test runtime changes can break unrelated web tests. |

## Command evidence and route exercise

| Command | Result |
|---|---|
| `git status --short --branch` in the assigned worktree | Confirmed branch `copilot/cp-02`; only the supplied untracked `clearpipe-task-plan/` packet was present before this audit. |
| `git grep -n -i clearpipe -- clearml-web/src/app clearml-server` on original `cc5ded3` baseline | No ClearPipe production route/module/service; `/clearpipe` was therefore caught by `app.routes.ts` wildcard 404 before the required rebase. |
| `git diff --name-status cc5ded3..master -- clearml-web clearml-server` and `git show master:<path>` | Identified the complete current WIP added by `9558961`, including web, server, schema, docs, and tests documented above. |
| `npm test -- --include='src/app/features/clearpipe/clearpipe-state.service.spec.ts' --watch=false` in `clearml-web` | **Blocked before test execution:** `ng` is not recognized because `clearml-web/node_modules` is absent in this isolated worktree.  No dependencies were installed for a documentation-only audit. |
| Static route exercise | Before rebase the baseline route table resolved `/clearpipe` to its wildcard 404.  After rebase, `app.routes.ts` registers the guarded, lazy-loaded WIP route.  Browser exercise remains blocked by absent web dependencies. |

## Acceptance criteria and handoff status

- [x] All WIP ClearPipe routes and major web/server modules are documented with
  exact paths.
- [x] Working, mocked/placeholder, incomplete, broken, and inaccessible
  behavior are distinguished with concrete locations.
- [x] Graph dependency, graph shape, positions, edges, selection, viewport,
  history, persistence, and server/state ownership are documented.
- [x] Useful native service, validation, compiler/runner, adapter, state, and
  lifecycle code are explicitly marked for preservation.
- [x] Preserve/adapt/replace/remove matrix, gap/test catalog, migration path,
  high-conflict list, and command evidence are supplied for CP-05, CP-08, and
  CP-09.

**Verified limitation handed to downstream gates:** WIP browser tests and route
cannot be executed in this worktree because web dependencies are not installed.
CP-09 should run the listed WIP tests and add the missing browser/server flows
before accepting production behavior.
