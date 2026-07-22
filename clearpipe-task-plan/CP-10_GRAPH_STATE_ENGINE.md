# CP-10 — Graph state engine

## Authority and boundary

`GraphStoreService` in
`clearml-web/src/app/features/clearpipe/domain/graph-store.service.ts` is the
browser owner of an editable canonical `GraphV2`. It uses only CP-06 types and
codec functions. Consumers must render `graph`, `nodes`, `ports`, `bindings`,
`dependencies`, `generatedInputs`, `selectedNode`, and `dirty`; they must not
keep a canvas, inspector, or persistence copy of the graph.

The existing `ClearpipeStateService` exposes the store as `graphStore` and
`graphCommands` while the pre-v2 generic editor remains a compatibility
boundary. New v2 work must use the graph-store facade directly; generic nodes
and untyped edges are not converted to v2.

## Loading, saving, and comparison

```ts
const loaded = graphStore.load(serverDefinition);
if (loaded.status === 'ok') {
  const payload = graphStore.serialize(); // CP-06 compact canonical JSON
  // Submit the graph, not transient state, through the CP-14 adapter.
}
```

`load()` accepts either an object or the canonical JSON returned by
`serialize()`, then delegates version routing, normalization, reference checks,
and canonical parsing to `decodeGraphV2`. A v1, newer, or unknown structure is
retained as `unsupported`, is read-only, and is never silently repaired.
Malformed v2 documents populate `loadErrors` and are not editable. CP-19 calls
`markSaved(savedGraph)` only after a successful server response. `dirty` is a
comparison of CP-06 canonical serializations, so unordered equivalent values
do not create false changes.

## Commands and transactions

All persisted edits use the store's commands:

```ts
graphStore.transaction('connect task output', () => {
  graphStore.createPort(nodeId, port);
  graphStore.createBinding(binding);
});
```

Commands validate the entire candidate with CP-06 before commit and return
`GraphCommandResult`. A failed command in a transaction rolls back every edit
and restores the pre-transaction transient state. `removeNode`, `removePort`, `removeParameter`, and
`removeResource` remove their dependent bindings and related outputs/settings
before validation; callers must not manually leave dangling references.
Generated IDs and generated-safe names are allocated by create commands.

## Transient editor state

Use `selectNode`, `selectPort`, `setHoveredNode`, `setDraggingNode`,
`setActiveMenu`, `setRequestState`, and `setPolling` for editor interaction.
Those signals live in `transient`, are excluded from serialization, and cannot
make the graph dirty. Position, dimensions, and viewport are explicit
persisted visual commands and do make the document dirty when changed.
`selectedPort` resolves its node/port identity from the current canonical graph,
so a port update cannot leave inspector or submit consumers with stale data.

## Downstream handoff

* CP-11 reads `graph` snapshots and does not mutate them.
* CP-14/CP-19 serialize through this store, preserve `unsupported` raw content
  for export/details, and replace the saved baseline only after successful CAS.
* CP-16/CP-17 render selectors and issue commands; they do not retain a
  second graph or write canvas event objects into `GraphV2`.
