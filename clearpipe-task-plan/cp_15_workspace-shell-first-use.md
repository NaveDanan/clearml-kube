---
id: CP-15
title: "Implement the three-region workspace shell and first-use experience"
lane: "Editor shell"
wave: 3
wave_name: "Parallel foundational implementation"
complexity_points: 5
hard_dependencies: ["CP-08"]
parallel_wave_peers: ["CP-10", "CP-11", "CP-12", "CP-13", "CP-14"]
directly_blocks: ["CP-16", "CP-17", "CP-19", "CP-22", "CP-23", "CP-30"]
---

# CP-15: Implement the three-region workspace shell and first-use experience

## Outcome

Deliver the production editor shell with a dominant canvas, collapsible/resizable side panels, responsive fallbacks, and an intentional first-use state.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Editor shell.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 3 — Parallel foundational implementation.

## Requirement areas covered

- Three-pane shell
- First-use state
- Responsive panels
- Accessibility baseline

## In scope

- Implement left catalog, central canvas, right inspector, toolbar slot, code-preview slot, and optional execution slot using approved components.
- Implement independent scrolling, collapse/expand, resize where supported, and state preservation while hidden.
- Implement narrow-width drawers/overlays and toolbar overflow while keeping primary actions accessible.
- Implement route-level loading, permission-denied, read-only/unsupported, and fatal-error shells.
- Implement first-use mode selection and clear starts from tasks, code/components, approved templates, or existing pipelines.
- Establish focus regions, semantic landmarks, and reduced-motion defaults.

## Out of scope

- Canvas graph behavior.
- Generic node cards or domain forms.
- Save/run/resource logic.
- Persisting menus or drawers in graph state.

## Deliverables

- Production ClearPipe page shell.
- Collapsible/resizable panels and responsive drawer fallback.
- First-use, loading, error, permission, and read-only states.
- Extension slots for canvas, node UI, toolbar, and execution.
- Component and accessibility tests.

## Interfaces and handoff contract

- CP-16 mounts canvas, CP-17 catalog/inspector, CP-23 toolbar/code, CP-26 execution.
- Shell state is transient except explicitly approved layout/viewport metadata.
- Domain tasks use extension slots rather than editing shell internals.

## Parallelization and sequencing

### Must run after

- CP-08

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-10
- CP-11
- CP-12
- CP-13
- CP-14

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-16
- CP-17
- CP-19
- CP-22
- CP-23
- CP-30

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Canvas expands when panels collapse without losing state.
- Side regions scroll independently and are keyboard reachable.
- Constrained widths remain usable.
- The first-use state explains authoring modes and has one clear primary action.
- No separate shell exists per mode.

## Verification

- Run tests for collapse, resize, restore, focus, and narrow layouts.
- Inspect normal, single-panel, both-panel, and constrained states.
- Confirm graph domain state survives layout changes.

## Risks and guardrails

- Nested scrolling can make panels unusable.
- Panel state must not create false dirty state.
- Responsive behavior must not hide primary actions.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
