# CP-16 Canvas foundation

## Boundary

`ClearpipeCanvasComponent` reads the CP-10 `GraphStoreService` selectors and
issues only its commands. It never copies a graph, bindings, positions, or
viewport. CP-17 supplies node/port rendering through `nodeTemplate` and
`nodeDimensions`; the CP-16 fallback is only a neutral positioning anchor.

The adapter accepts client coordinates and CDK drag distance, immediately
reduces them to `Point` values, and sends only those values to CP-10. Raw CDK,
mouse, wheel, and drop objects remain on the call stack. The focused tests
assert their sentinel fields do not appear in canonical serialization.

## Update boundaries

* Node position is committed once on `cdkDragEnded`; CP-10's `draggingNodeId`
  is transient during the drag.
* Hover and single selection use CP-10 transient selectors.
* Pan and wheel use a component-local preview viewport. Pan commits on release;
  wheel commits after 120 ms. Fit, minimap navigation, and accessible controls
  commit one approved `setViewport` command.
* The component is `OnPush`; node views are keyed by stable `node.id`, and
  basic SVG bindings are derived from CP-10 bindings. No edge claims semantic
  compatibility or offers connection mutation.
* A `ResizeObserver` updates local surface dimensions only, so CP-15 panel
  collapse/resizing does not affect persisted state.

## CP-30 profiling handoff

Pass a `CanvasProfiler` through the `profiler` input to receive normalized
`placement`, `move`, `pan`, `zoom`, `fit`, and `delete` marks. Each mark
contains only node and binding counts; it contains no DOM/CDK event or graph
payload. Profile a 180-node fixture while dragging a node and panning:

1. Verify no `setNodePosition` occurs before drag end.
2. Verify a pan/wheel burst produces one viewport command at its commit point.
3. In browser performance tools, confirm the graph layer transform updates
   independently of card renderer work and the editor shell does not rerender.
4. Re-run the component's large-fixture test and inspect canonical JSON for
   event-shaped fields.

The CP-09 ClearPipe harness intentionally compiles only shared test-support
specs. CP-16 therefore keeps an editor-local test tsconfig and runs:

```text
npm exec ng -- test trains-webapp --watch=false --browsers=ChromeHeadless ^
  --ts-config=src/app/features/clearpipe/editor/tsconfig.canvas.spec.json ^
  --include=src/app/features/clearpipe/editor/clearpipe-canvas.component.spec.ts ^
  --include=src/app/features/clearpipe/editor/clearpipe-canvas.adapter.spec.ts
```
