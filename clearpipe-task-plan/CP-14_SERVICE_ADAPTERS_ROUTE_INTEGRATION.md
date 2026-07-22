# CP-14 — Service adapters and route integration

## Delivered boundary

`ClearpipeAdapterService` is the sole production ClearPipe platform façade.
It uses `ClearpipeApiService`, which in turn uses the authenticated
`SmApiRequestsService`; it does not create a second API client, auth path,
resource client, browser store, runner, or `/pipelines` mutation.

| Adapter operation | Reused module / service | CP-07 operation |
|---|---|---|
| `list`, `load` | `ClearpipeApiService` → `SmApiRequestsService` | `get_all`, `get_by_id` |
| `create`, `update` | same | `create`, `update` |
| `validate`, `submit` | same | `validate`, `start` |
| `archive`, `delete`, `parseScript` | same | `archive`, `delete`, `parse_script` |
| `resources` | existing `ClearpipeApiService` selectors | native lookup only; endpoint/storage fail closed |
| `authentication` | `selectCurrentUser`, `ConfigurationService` | existing authenticated session and feature configuration |
| `routeFor`, `parseRoute`, `navigate` | Angular `Router` | ClearPipe, task, resource, and pipeline handoffs |

The adapter emits an initial `loading` state and then a typed outcome. It
normalizes `denied_or_missing`, `validation_failed`, `stale_revision`,
`resource_unavailable`, `unsupported_representation`,
`execution_unavailable`, `submission_succeeded_unwatched`, and `failed`. These outcomes contain safe,
actionable messages and never mutate graph state, retry a CAS conflict, infer a
missing resource, or expose private task existence.

Server capabilities are accepted only as task-boundary authorization hints.
The adapter fails closed when capabilities are absent and removes all mutable,
run, import, export, archive, and delete capabilities for a legacy or
unsupported representation. It consumes CP-06's `decodeGraphV2` result rather
than attempting graph migration or repair.

The stable v2 server envelope also supplies `compilation` and `execution`.
When either is false (or the safe `compilation_unavailable` diagnostic is
returned), the adapter emits `execution_unavailable` and does not call
`clearpipe.start`. This keeps v2 persistence/editing available while correctly
surfacing the current generation/execution integration gate.

## Guarded routes and handoffs

`/clearpipe` keeps the existing `clearpipeEnabled` `canMatch` guard. Additive,
feature-guarded entry redirects are registered before the existing
`/pipelines` routes:

| Entry | Redirect |
|---|---|
| `/pipelines/clearpipe` | `/clearpipe` |
| `/pipelines/clearpipe/new` | `/clearpipe/new` |
| `/pipelines/clearpipe/:taskId/edit` | `/clearpipe/:taskId/edit` |

The `/clearpipe/:taskId/edit` route is explicitly ordered before
`/clearpipe/:taskId` and retains the dirty-editor guard. Existing
`/pipelines` lazy routes and controller/run behavior are unchanged.

Semantic navigation maps ClearPipe definitions to `/clearpipe`, unsupported
definitions to existing task details, and submitted run IDs to existing
`/pipelines/*/tasks/:runTaskId` details. A ClearPipe Run sends only
`clearpipe.start`; it never calls `pipelines.start_pipeline`.

## Verification

Focused tests cover real `SmApiRequestsService` endpoint construction through
the typed client, capability normalization, loading, denied, stale,
unsupported, resource-unavailable, and unwatched-submission outcomes. Route
tests assert guarded entry redirects are ordered before and do not replace the
existing `/pipelines` lazy routes.
