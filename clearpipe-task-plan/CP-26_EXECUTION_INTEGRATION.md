# CP-26 — execution integration

## Delivered boundary

The editor-scoped `ClearpipeExecutionService` performs server-backed run
preflight and submits only through `ClearpipeAdapterService`. It requires a
saved immutable definition revision, edit/run capability, compiler/execution
capabilities, a successful server validation, and a complete server compiler
runtime map for the current stable graph IDs. Missing compiler capability or
dedicated provenance-signing-key capability remains an actionable disabled
state; the browser never runs generated source.

After confirmed submission, the service polls the CP-14
`execution_snapshot` boundary, follows bounded node pages, and accepts
node-state updates only when run, definition, revision, digest, graph ID, and
server-assigned step identity all match. Older timestamped records cannot
replace newer records. Partial, stale, denied, and unavailable observations are
visible without fabricating node progress or completion.

The concise results strip shows only authorized task IDs, timestamps, safe
failure indication, and approved artifact/model/dataset descriptors. It hands
off to verified existing `/pipelines` and task/resource routes rather than
implementing a second operational dashboard.

## Lifecycle and selectors

Execution state is provided by `ClearpipeEditorComponent`, not the root
injector. Definition, revision, route, and component-destruction changes cancel
preflight, submission, and snapshot work and clear scoped state.
`nodeStatuses(nodeId)` supplies read-only status projections for inspector and
node-card consumers; runtime associations use the server compiler manifest and
snapshot records, never source-line parsing.

The editor marks a route runnable only after the requested definition loaded
successfully and still matches the current lifecycle identity. A failed or
superseded load cannot validate or submit the prior definition. Snapshot page
cycles use non-queueing polling and stop after a terminal controller snapshot,
scope cancellation, or three consecutive refresh failures.

Transport uncertainty retains a locally generated opaque UUIDv4 idempotency key
and exposes a visible **Reconcile run** action. Reconciliation retries the
existing typed v2 submission with that same key, so the server returns the
original result rather than creating another execution.

## Verification

- `npx tsc --noEmit -p tsconfig.clearpipe.spec.json`
- `npm run test-clearpipe -- --watch=false`
