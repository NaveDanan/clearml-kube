---
id: CP-27
title: "Implement history, clipboard, multi-select, keyboard, and layout operations"
lane: "Editor hardening"
wave: 6
wave_name: "Parallel feature completion"
complexity_points: 8
hard_dependencies: ["CP-10", "CP-16", "CP-17", "CP-19", "CP-20"]
parallel_wave_peers: ["CP-24", "CP-25", "CP-26"]
directly_blocks: ["CP-30", "CP-31"]
---

# CP-27: Implement history, clipboard, multi-select, keyboard, and layout operations

## Outcome

Complete high-frequency graph editing so users can manipulate nontrivial pipelines predictably with undoable commands, familiar shortcuts, and accessible alternatives.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Editor hardening.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 6 — Parallel feature completion.

## Requirement areas covered

- Editing
- Keyboard interaction
- Canvas requirements
- UX hardening

## In scope

- Implement undo and redo over domain-relevant graph commands, including node add/remove/move/configure and edge add/remove/reconnect.
- Implement multi-select, select all, duplicate, copy, paste, delete, and keyboard movement while preserving stable-ID rules and internal references.
- Implement fit view, auto-arrange or assisted layout, optional snap-to-grid behavior, and minimap navigation where supported by the approved canvas dependency.
- Provide contextual insertion and accessible non-drag node-add/connect flows.
- Implement shortcut scoping so commands never fire while typing in inputs, text areas, editors, searches, or dialogs.
- Add a discoverable shortcut reference and platform-appropriate key labels.
- Integrate all mutations with dirty-state and unsaved-change behavior from CP-19.

## Out of scope

- Real-time collaboration or shared command history.
- A second history/state system outside CP-10.
- Perfect automatic layout for every graph shape.
- Clipboard formats intended as the production import/export contract; CP-22 owns file interchange.

## Deliverables

- Command-history integration for all covered editor mutations.
- Clipboard and duplication utilities with reference remapping.
- Multi-selection, keyboard movement, deletion, and select-all behavior.
- Fit-view, layout, minimap, snap, and contextual insertion controls.
- Shortcut reference and comprehensive interaction tests.

## Interfaces and handoff contract

- All mutations must invoke CP-10 commands and CP-20 semantic checks rather than directly mutating canvas objects.
- Uses CP-19 dirty-state APIs and must not create independent unsaved state.
- Provides keyboard and editing primitives consumed by CP-30 accessibility hardening.

## Parallelization and sequencing

### Must run after

- CP-10
- CP-16
- CP-17
- CP-19
- CP-20

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-24
- CP-25
- CP-26

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-30
- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Undo and redo restore graph semantics as well as visual positions.
- Pasted or duplicated subgraphs receive collision-free stable IDs and preserve only valid internal bindings.
- Shortcuts are inert in editable controls and dialogs.
- Keyboard users can add, select, move, connect through an alternative flow, duplicate, and delete nodes.
- Auto-layout and fit-view do not mutate domain semantics.

## Verification

- Run command-stack unit tests and canvas interaction tests.
- Test duplicate/paste ID remapping and external-edge behavior.
- Test shortcut scoping across all editable control types and supported platforms.
- Test long undo/redo sequences and dirty-state restoration.

## Risks and guardrails

- Capturing every pointer movement can bloat history; coalesce drag operations into semantic commands.
- Clipboard payloads can retain stale IDs; validate and remap before insertion.
- Global keyboard handlers can break forms; centralize focus and editable-target checks.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
