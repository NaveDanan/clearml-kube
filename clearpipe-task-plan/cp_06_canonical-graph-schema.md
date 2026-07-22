---
id: CP-06
title: "Define the canonical graph schema, identifiers, bindings, and migrations"
lane: "Domain contracts"
wave: 2
wave_name: "Parallel contract definition"
complexity_points: 8
hard_dependencies: ["CP-03", "CP-05"]
parallel_wave_peers: ["CP-07", "CP-08", "CP-09"]
directly_blocks: ["CP-10", "CP-11", "CP-12", "CP-13", "CP-22"]
---

# CP-06: Define the canonical graph schema, identifiers, bindings, and migrations

## Outcome

Deliver a typed, serializable, versioned graph contract shared by task-backed and code-backed authoring, with deterministic migrations and strict separation of domain state from transient UI state.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Domain contracts.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 2 — Parallel contract definition.

## Requirement areas covered

- Canonical graph
- Ports and bindings
- Schema migration
- Persistence

## In scope

- Define pipeline metadata, settings, authoring mode, schema version, and approved visual metadata.
- Define discriminated node models for task, function/component, dataset/resource, inputs, outputs, and approved control concepts.
- Define stable node IDs, generated-safe names, positions, dimensions, resource references, configuration, and execution-only dependencies.
- Define stable ports with direction, semantic type, required/optional status, accepted bindings, multiplicity, and data/execution role.
- Define edges/bindings for data, parameters, artifacts, step outputs, and execution-only relationships.
- Define migrations, unsupported-field handling, read-only fallback metadata, and deterministic serialization.
- Exclude secrets and transient UI state.

## Out of scope

- Graph-edit commands or UI state.
- Full validation logic.
- Credential or runtime-secret persistence.

## Deliverables

- Repository-native types/schema for the current version.
- A migration registry and safe unsupported-version outcome.
- Canonical fixtures for task, function, dataset-bound, and invalid graphs.
- A schema/invariants document.
- Round-trip and determinism tests.

## Interfaces and handoff contract

- Consumed by CP-10, CP-11, CP-12, CP-13, CP-16, CP-17, CP-19, and CP-20.
- Changes after merge require migration coverage and impact review.
- The schema imports no UI or service clients.

## Parallelization and sequencing

### Must run after

- CP-03
- CP-05

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-07
- CP-08
- CP-09

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-10
- CP-11
- CP-12
- CP-13
- CP-22

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Both authoring modes share graph primitives.
- Every persisted field has purpose and migration behavior.
- Ports and edges encode real binding semantics.
- Serialization round-trips deterministically without losing supported data or positions.
- Secrets and transient UI state cannot enter the persisted graph.
- Unsupported schemas fail safely without silent data loss.

## Verification

- Validate all canonical fixtures.
- Round-trip serialize/deserialize and compare logical equality.
- Exercise successful and failed migrations, unknown node/port, and unsupported version.
- Inspect fixtures for credential-shaped data.

## Risks and guardrails

- Overly generic configuration moves correctness problems downstream.
- Persisting selection/hover creates noise and false dirty state.
- Identifier semantics must be stable before generators exist.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
