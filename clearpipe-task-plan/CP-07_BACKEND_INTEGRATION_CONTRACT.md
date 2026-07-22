# CP-07 — ClearPipe backend integration contract

**Status:** stable handoff for CP-14.
**API version:** `v2.35`
**Authority:** CP-05 ADR; CP-06 owns `ClearPipeGraphV2` contents and migrations;
CP-11 owns diagnostic codes and target paths; CP-12 owns compiler output.

## Non-negotiable boundary

ClearPipe is an authenticated extension of the existing `clearpipe.*` service.
It persists authored definitions as native `TaskType.controller` tasks tagged
`pipeline` and `clearpipe`, in `.pipelines/<name>` projects. The canonical
document is `configuration.ClearPipe`; `configuration.Pipeline` and task
source are derived monitoring/compiler artifacts.

No adapter may add a ClearPipe database, runtime, scheduler, authentication
path, secret store, pipeline client, resource client, or browser execution
path. The existing service performs task/company access checks, revision CAS,
native resource/queue validation, task cloning, and queue enqueueing.
`/pipelines` remains the established controller/run details, monitoring, and
rerun surface. It must not be rewritten or used as authoring persistence.

## Named opaque envelopes

The endpoint schemas and `apimodels.clearpipe` deliberately name, but do not
redeclare, these contracts:

| Name | Owner | CP-07 use |
|---|---|---|
| `ClearPipeGraphV2` | CP-06 | JSON transport envelope for CP-06's `GraphV2`. `GraphReadResult` / `UnsupportedGraph` decide whether it is supported, invalid, or read-only. CP-07 does not define nodes, ports, binding kinds, or migrations. |
| `ClearPipeDiagnostics` | CP-11 | Validation `issues`; treat each item as opaque and never expose secret values. |
| `ClearPipeCompilerOutput` | CP-06/CP-12 | Derived `pipeline` returned only by successful validation; it is neither editable graph state nor a start request. |

The current pre-v2 WIP graph (`schema_version: 1`) is classified as
`legacy_clearpipe_graph`. A missing or non-2 unknown version is
`unsupported_clearpipe_graph`. CP-14/CP-29 must render either classification
read-only, offer safe export/details and navigation to existing task/pipeline
views, and never drop, repair, auto-convert, edit, validate for save, or run
it. CP-14 consumes CP-06's `GraphReadResult` / `UnsupportedGraph` for the
final read-only reason and value-free diagnostics; this service envelope does
not duplicate that parser.

## Typed endpoint contract

All calls use the existing authenticated
`/api/v2.35/clearpipe.<operation>` service. Request and response properties
are registered in `schema/services/clearpipe.conf`; Python response models
enforce the outer envelope. No new endpoint is introduced.

| Operation | Request | Success response | Existing service mapping |
|---|---|---|---|
| `create` | `name`, `graph`, optional `description`, `tags`, `public` | `id`, `revision: 1`, `definition` | Create tagged controller task and configurations. This is **Save As** with a new name/identity. |
| `get_all` | `page`, `page_size`, optional search/project/tags/archive/public filters | `definitions`, `total` | Native task query. |
| `get_by_id` | `task` | `definition` | Visible tagged controller task lookup. |
| `update` | `task`, required expected `revision`, patchable name/description/graph/tags/public fields | `updated`, new `revision`, `definition` | Atomic controller-task CAS update. |
| `validate` | exactly one of `task` or `graph` | `valid`, `issues`, optional derived `pipeline` | Existing graph/resource/queue validation and compile preview. |
| `start` | `task`, optional expected `revision`, existing queue ID, JSON-safe parameter/node-queue overrides | cloned run `task`, `enqueued`, advisory `queue_watched` | Validate, clone, then enqueue through the native task/queue lifecycle. |
| `archive` | `task`, optional expected `revision` | `updated`, `revision` | Existing archive tag/CAS lifecycle. |
| `delete` | `task`, optional expected `revision`, optional `force` | `deleted` | Existing archive-first/delete lifecycle. |
| `parse_script` | `script`, optional `filename` | safe AST metadata | Existing non-executing parser only. |

`clearpipe.create` is the only save-as/create-version operation. The returned
integer is an edit/CAS revision, **not** immutable version history. Historical
versions and schedules have no backend capability and must not be implied by
the UI.

## Definition, capability, and paging envelope

Each returned `definition` supplies native identity/display fields, `revision`,
`graph`, `archived`, `public`, and two contract fields:

* `representation` is one of `clearpipe_graph_v2`,
  `legacy_clearpipe_graph`, or `unsupported_clearpipe_graph`.
* `capabilities` has `view`, `edit`, `save_as`, `version`, `run`, `import`,
  `export`, `source`, `archive`, and `delete`. These are server-derived
  task-boundary capabilities. `version` and `source` are currently false:
  neither immutable version history nor raw generated source access is
  available through this DTO.

CP-14 must use these values as the initial authorization result, then apply
the stricter representation rule above. A disabled client feature flag is
never an authorization result. A public definition is readable by permitted
other companies but mutable only by its origin company; server checks remain
authoritative even when an old client renders a stale action.

`get_all` is the only list contract. `page` is zero-based, negative pages are
clamped to zero, and `page_size` is clamped to `1..500`. `total` is the count
before paging. A short or empty page is not a replacement for a denied,
unavailable, or failed query.

## Permissions, flags, and secrets

| User outcome | Required check / behavior |
|---|---|
| View/list | Existing authenticated `clearpipe.*` endpoint plus company/public visibility. Do not disclose whether an inaccessible ID exists. |
| Edit/archive/delete | Server `can_write_definition` / origin-company ownership and CAS revision; do not rely on browser controls. |
| Save As/import | Existing authenticated `create`; CP-14 only submits a CP-06 supported document. Import is local parsing, not a new server endpoint. |
| Run | Existing readable definition, not archived, exact expected revision supplied by UI, validation/resource/queue checks, then `clearpipe.start`. A run clone is immutable execution evidence, never authoring state. |
| Export | Only a readable, supported document; scrub/reject prohibited secret-shaped material. Never export run IDs, browser state, credentials, or generated source as editable graph state. |
| Source | `capabilities.source=false`; the safe `parse_script` metadata endpoint does not grant source browsing/execution. |
| Feature off | Existing `clearpipeEnabled === false` hides the side-nav entry and `canMatch` redirects `/clearpipe` to `/404`. It does not weaken server authentication or `/pipelines`. |

The server's graph validator is the secret authority. Browser checks are
defense in depth only. Graphs, diagnostics, responses, exports, URLs, browser
storage, and parameter overrides must not contain raw passwords, tokens,
keys, credential objects, secret URLs, browser file contents, or runtime task
IDs. Opaque approved references are allowed only when CP-06/CP-11 accepts
them. Secret-bearing stored legacy data is rejected on read rather than
returned.

## Normalized CP-14 adapter outcomes

CP-14 owns the sole browser adapter and normalizes responses before feature
code sees them. It must preserve local edits on every non-success outcome.

| Adapter outcome | Server signal | Required UX/fallback |
|---|---|---|
| `loading` | request in flight | Transient adapter state only; never persist it in `ClearPipeGraphV2`. |
| `denied_or_missing` | `InvalidTaskId` for inaccessible/nonexistent controller task | Do not distinguish tenant-private existence; offer library/back navigation. |
| `validation_failed` | `ValidationError` with safe `issues` | Render CP-11 diagnostics; no raw exception/secret values. |
| `stale_revision` | `RevisionConflict`, HTTP 409/subcode 1 with expected/received revisions | Keep local graph; offer reload, compare when available, or Save As. Never retry overwrite. |
| `resource_unavailable` | validation diagnostic for inaccessible resource/queue or lookup failure | Distinguish unavailable, denied, failed, and empty selector results; retry only the query. |
| `unsupported_representation` | legacy/unknown `representation`, or future CP-06 unsupported outcome | Read-only details/export/task or pipeline navigation; no mutation, conversion, compilation, or run. |
| `submission_succeeded_unwatched` | `start.enqueued=true`, `queue_watched=false` | Show submitted run and a worker-warning; navigate to existing run details, never roll back. |
| `failed` | other normalized API/transport error | Keep local state, actionable retry where idempotent, and no fabricated run/status. |

The service currently fails closed for native resource kinds without a
company-aware resolver. Existing supported validator kinds are task, dataset,
report, model, project, and queue. Endpoint/storage/autoscaler selectors are
not validated ClearPipe resources yet and must surface unavailable/unsupported,
not an empty-success list or a second resource client.

## Navigation contract

CP-14 owns route parsing/building and is the only place that may import the
existing web/API clients. Feature/domain code passes semantic navigation
targets, not scattered literal URLs:

| Target | Existing owner | Contract |
|---|---|---|
| `clearpipe-library` | guarded `/clearpipe` route | Enter only when `clearpipeEnabled` permits it. |
| `clearpipe-new` / `clearpipe-definition` | guarded ClearPipe routes | Use CP-14 route helpers and the dirty-editor guard. |
| `definition-task-details` | existing task/project UI | Safe fallback for unsupported/legacy definitions. |
| `pipeline-details` | existing `/pipelines` controller viewer | Default post-submission/status handoff for the run task ID. |
| `resource-details` | existing resource route modules | Build from validated native selector IDs only. |

One ClearPipe Run action calls **only** `clearpipe.start`; it must not also
call `pipelines.start_pipeline`. Existing `/pipelines` rerun/delete behavior
remains untouched.

## Contract fixtures

The fixtures under `clearml-server/apiserver/tests/fixtures/clearpipe_contract`
are deliberately graph-opaque. They exercise success envelopes, CAS conflict,
safe diagnostics, unavailable-resource handling, and legacy read-only
classification without inventing CP-06 node, port, binding, or migration
semantics.

## Verified gaps handed downstream

1. CP-06 owns `GraphV2`, `GraphReadResult`, and `UnsupportedGraph`; CP-14 must
   consume those named results for final read-only reasons without copying
   parsing or migration logic into an endpoint envelope.
2. CP-11/12/13 must replace the WIP generic validation/compiler/runner before
   a v2 definition is enabled for Run. CP-26 still needs a real-Agent proof.
3. CP-18 owns paged, cancellable resource selectors and the distinction between
   empty, denied, unavailable, and failed lookups.
4. CP-14 implements this adapter, guards, feature flag integration, and route
   helpers; CP-29 proves any lossless legacy conversion. Until then legacy is
   read-only by contract.
