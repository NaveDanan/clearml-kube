# CP-20 Port Edge Semantics

## Delivered contract

`editor/edges/clearpipe-port-compatibility.ts` exports the pure
`evaluateSemanticEdge(graph, candidate, replacingBindingId?)` API. It accepts
only current canonical `GraphV2` state and `GraphBindingInput`, returning an
explicit eligibility result and accessible rejection message. It delegates
canonical endpoint, direction, accepted-kind, multiplicity, and cycle
diagnostics to the v2 codec and additionally rejects self and duplicate
bindings before a graph command is issued.

`ClearpipeSemanticEdgeController` is the CP-24/25 public handoff API:

- `create(candidate)`
- `reconnect(bindingId, candidate)`
- `remove(bindingId)`
- `connectPorts(source, target, kind, replacingBindingId?)`
- `evaluate(candidate, replacingBindingId?)`

`ClearpipeCanvasComponent` also exposes `createSemanticBinding`,
`reconnectSemanticBinding`, and `removeSemanticBinding` for registered canvas
extensions. These APIs issue only `GraphStoreService` binding commands. They
do not retain graph copies or persist interaction/render state.

## UI behavior

The fallback canvas renderer exposes explicit output and input port controls.
Users select an output, explicitly select a binding kind when necessary, then
select an input. Selected canonical edges expose accessible source-output,
target-input, and binding-kind labels, selection, deletion, and port-to-port
reconnection. Non-port endpoint bindings remain available through the typed
controller API; no conditional/control relationship is fabricated.

## Downstream use

CP-24/25 should construct canonical `GraphBindingInput` values from their
registered ports and call the controller or canvas public methods. They must
not derive compatibility from SVG paths, card layout, or visual adjacency.
