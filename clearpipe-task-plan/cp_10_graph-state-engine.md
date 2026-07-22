---
id: CP-10
title: "Implement the graph state engine and command model"
lane: "Domain core"
wave: 3
wave_name: "Parallel foundational implementation"
complexity_points: 8
hard_dependencies: ["CP-06"]
parallel_wave_peers: ["CP-11", "CP-12", "CP-13", "CP-14", "CP-15"]
directly_blocks: ["CP-16", "CP-17", "CP-19", "CP-22", "CP-27"]
---

# CP-10: Implement the graph state engine and command model

## Outcome

Provide the single graph-domain state engine used by canvas, inspectors, persistence, validation, generation, and later history support.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Domain core.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 3 — Parallel foundational implementation.

## Requirement areas covered

- Graph state
- Commands/selectors
- Dirty tracking
- Serialization

## In scope

- Implement graph creation/loading, node and edge CRUD, configuration updates, metadata/settings, positions, and approved viewport state.
- Implement stable IDs, generated-safe names, deterministic ordering, and cleanup of dependent references.
- Implement a semantic command/transaction API suitable for batching, dirty tracking, and later history.
- Separate persisted domain state from selection, hover, drag, menus, requests, and other transient editor state.
- Expose selectors for nodes, ports, bindings, dependencies, generated inputs, selection, and dirty state.
- Integrate schema parsing and migrations.

## Out of scope

- Undo/redo, copy/paste, and multi-select behavior.
- Validation rules, network requests, or code generation.
- A second state-management library.

## Deliverables

- Production graph state module and public commands/selectors.
- A transient editor-state boundary.
- Deterministic serialization hooks and logical-equality helpers.
- Unit tests for CRUD, cleanup, dirty tracking, transactions, and migrations.
- An integration guide for UI and persistence owners.

## Interfaces and handoff contract

- CP-16 and CP-17 consume commands/selectors and must not maintain a shadow graph.
- CP-11 validates snapshots without mutation.
- CP-19 owns persistence side effects.
- Schema changes require CP-06 migration updates.

## Parallelization and sequencing

### Must run after

- CP-06

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-11
- CP-12
- CP-13
- CP-14
- CP-15

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-16
- CP-17
- CP-19
- CP-22
- CP-27

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- All graph edits flow through one command API.
- Node/port deletion cannot leave silent broken references.
- Persisted and transient state are cleanly separated.
- Dirty state changes only for meaningful persisted edits.
- Loading applies migrations and reports unsupported versions safely.

## Verification

- Run graph core tests with valid, invalid, and migrated fixtures.
- Repeat edit/serialize/load cycles and compare logical equality.
- Confirm no dependency on canvas components or production clients.

## Risks and guardrails

- Canvas event models must not leak into domain commands.
- Transient execution polling must not create dirty state.
- History metadata belongs here only as command metadata, not as a full history implementation.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
