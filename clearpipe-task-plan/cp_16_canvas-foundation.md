---
id: CP-16
title: "Integrate the canvas engine and basic graph manipulation"
lane: "Canvas"
wave: 4
wave_name: "Parallel editor and lifecycle foundation"
complexity_points: 8
hard_dependencies: ["CP-10", "CP-15"]
parallel_wave_peers: ["CP-17", "CP-18", "CP-19"]
directly_blocks: ["CP-20", "CP-27", "CP-28", "CP-30"]
---

# CP-16: Integrate the canvas engine and basic graph manipulation

## Outcome

Render and manipulate the canonical graph through the approved existing canvas capability without creating a shadow graph model.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Canvas.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 4 — Parallel editor and lifecycle foundation.

## Requirement areas covered

- Canvas
- Node placement
- Pan/zoom/minimap
- Performance boundary

## In scope

- Adapt canonical nodes, edges, positions, selection, and viewport to the existing canvas dependency.
- Implement node rendering hooks, drag/click placement hooks, single selection, movement, deletion hooks, pan, zoom, fit, grid/dots, controls, and minimap.
- Persist approved positions/viewport through graph commands while keeping hover/drag transient.
- Implement basic edge rendering hooks without final semantic validity.
- Keep controls accessible and avoid blocking graph content.
- Establish memoization and update boundaries for larger graphs.

## Out of scope

- Connection compatibility and cycle prevention.
- Generic node design or domain forms.
- Undo/redo, copy/paste, multi-select, or auto-layout.
- A new canvas dependency unless approved.

## Deliverables

- A canvas adapter bound to CP-10 commands/selectors.
- Pan/zoom/fit/minimap/grid and placement/movement behavior.
- Library-event translation isolated at the adapter boundary.
- Component tests for empty, placement, movement, selection, and viewport controls.
- Profiling hooks for CP-30.

## Interfaces and handoff contract

- CP-17 supplies node and port renderers.
- CP-20 supplies semantic connection behavior.
- CP-27 layers history and advanced interactions over commands.

## Parallelization and sequencing

### Must run after

- CP-10
- CP-15

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-17
- CP-18
- CP-19

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-20
- CP-27
- CP-28
- CP-30

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Canvas has no independent source of truth.
- Nodes can be placed, selected, moved, and deleted through commands.
- Pan, zoom, fit, minimap, and grid work.
- Panels can collapse without harming canvas use.
- Basic updates avoid unnecessary full-editor rerenders.

## Verification

- Run canvas tests with small and representative larger fixtures.
- Move nodes, reload, and confirm stable positions.
- Inspect state to ensure transient library data is not persisted.
- Profile movement for obvious full-graph rerenders.

## Risks and guardrails

- Library event shapes can leak into domain state.
- Viewport changes must follow the approved dirty-state policy.
- Basic edge rendering must not imply semantic validity.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
