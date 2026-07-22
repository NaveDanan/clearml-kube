---
id: CP-20
title: "Implement port compatibility, semantic connections, and edge editing"
lane: "Canvas semantics"
wave: 5
wave_name: "Parallel semantic and lifecycle surfaces"
complexity_points: 5
hard_dependencies: ["CP-11", "CP-16", "CP-17"]
parallel_wave_peers: ["CP-21", "CP-22", "CP-23"]
directly_blocks: ["CP-24", "CP-25", "CP-27", "CP-28", "CP-30"]
---

# CP-20: Implement port compatibility, semantic connections, and edge editing

## Outcome

Make every visual connection represent a real ClearML binding or execution relationship, with immediate feedback and safe create, reconnect, and delete behavior.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Canvas semantics.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 5 — Parallel semantic and lifecycle surfaces.

## Requirement areas covered

- Connection UX
- Port compatibility
- Edge editing
- Cycle prevention

## In scope

- Implement a shared compatibility matrix for data, artifact, parameter, step-output, and execution-only connections.
- Highlight compatible ports and reject invalid direction, type, or multiplicity with a reason.
- Prevent self-connections, cycles, duplicates, and unknown/deleted port connections.
- Implement edge creation, selection, semantic labels, removal, reconnection, and explicit port choice when multiple ports match.
- Render connection and validation state without color-only meaning.
- Commit explicit binding semantics through graph commands.

## Out of scope

- Unverified conditional/control relationships.
- Task or function forms.
- Undo history for edge operations.

## Deliverables

- A shared compatibility API.
- Create/reconnect/delete interactions bound to commands.
- Semantic edge renderers and actionable feedback.
- Tests for compatibility, cycles, self, duplicates, multiplicity, reconnection, and deletion.
- Domain extension support for accepted binding types.

## Interfaces and handoff contract

- CP-24 and CP-25 define domain ports through the shared schema/registry.
- CP-27 adds history and keyboard integration.
- Generators consume canonical binding kinds, never rendered edge types.

## Parallelization and sequencing

### Must run after

- CP-11
- CP-16
- CP-17

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-21
- CP-22
- CP-23

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-24
- CP-25
- CP-27
- CP-28
- CP-30

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Valid semantic edges can be created, reconnected, and removed.
- Invalid directions, types, cycles, self, duplicates, and multiplicity are blocked with explanations.
- Edges identify source output, target input, and binding kind.
- Edge state survives reload and node/port lifecycle changes.

## Verification

- Run domain and component tests for every operation and rejection reason.
- Attempt cycles through both creation and reconnection.
- Reload semantic edges and confirm metadata preservation.
- Check understandability with color disabled.

## Risks and guardrails

- Duplicated validator/canvas rules will drift.
- A generic edge without a binding kind is invalid by design.
- Execution order must not be inferred from visual proximity.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
