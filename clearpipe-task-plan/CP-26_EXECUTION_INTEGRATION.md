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
injector. Definition/revision changes and component destruction cancel
preflight and snapshot work and clear scoped state. `nodeStatuses(nodeId)`
supplies read-only status projections for inspector and node-card consumers;
runtime associations use the server compiler manifest and snapshot records,
never source-line parsing.

## Verification

- `npx tsc --noEmit -p tsconfig.clearpipe.spec.json`
- `npm run test-clearpipe -- --include src/app/features/clearpipe/testing/clearpipe-execution.spec.ts --browsers ChromeHeadless --watch=false`
- `npm run test-clearpipe -- --include src/app/features/clearpipe/testing/clearpipe-toolbar-code-preview.spec.ts --browsers ChromeHeadless --watch=false`
- `npm run test-clearpipe -- --browsers ChromeHeadless --watch=false` — 96 specs passed.
- `npx eslint src/app/features/clearpipe/editor/execution src/app/features/clearpipe/editor/clearpipe-editor.component.ts src/app/features/clearpipe/editor/clearpipe-toolbar.component.ts src/app/features/clearpipe/editor/clearpipe-toolbar.model.ts src/app/features/clearpipe/testing/clearpipe-execution.spec.ts src/app/features/clearpipe/testing/clearpipe-toolbar-code-preview.spec.ts`
- `npx ng build`
