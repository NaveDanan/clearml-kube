---
id: CP-14
title: "Implement pipeline service adapters and route integration"
lane: "Platform integration"
wave: 3
wave_name: "Parallel foundational implementation"
complexity_points: 8
hard_dependencies: ["CP-07"]
parallel_wave_peers: ["CP-10", "CP-11", "CP-12", "CP-13", "CP-15"]
directly_blocks: ["CP-18", "CP-19", "CP-21", "CP-24", "CP-26", "CP-29"]
---

# CP-14: Implement pipeline service adapters and route integration

## Outcome

Connect ClearPipe to real pipeline, permission, feature-flag, route, and status services through one reusable adapter layer.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Platform integration.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 3 — Parallel foundational implementation.

## Requirement areas covered

- Service adapters
- Routes
- Permissions
- Feature flags

## In scope

- Implement CP-07 operations by wrapping existing clients, services, hooks, and error normalization.
- Implement route parsing/building for new visual pipeline, open/edit visually, return to details, run details, and task details.
- Integrate existing guards, feature flags, authentication, authorization, and permissions.
- Implement loading, permission denied, stale version, unavailable resource, unsupported representation, and normalized errors.
- Provide adapter fakes through CP-09 and production integration tests.
- Add approved entry points from `/pipelines` without rewriting it.

## Out of scope

- Building save/open/run UI.
- Creating duplicate API clients.
- Bypassing guards or silently changing backend contracts.

## Deliverables

- Production adapters for load, create/update/version, run/status, permissions, and navigation.
- Guarded route integration and entry points.
- Normalized adapter errors and capability checks.
- Integration tests using existing services.
- A mapping from adapter functions to reused modules.

## Interfaces and handoff contract

- CP-18, CP-19, CP-21, CP-24, CP-26, and CP-29 consume this layer.
- Only this layer may import pipeline production clients for ClearPipe.
- Graph-domain code must not import platform adapters.

## Parallelization and sequencing

### Must run after

- CP-07

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-10
- CP-11
- CP-12
- CP-13
- CP-15

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-18
- CP-19
- CP-21
- CP-24
- CP-26
- CP-29

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- ClearPipe can load, check permissions, save/version, submit, and navigate through existing services.
- Feature flags and guards match current behavior.
- Errors are normalized and actionable.
- No duplicate client, database, auth path, or runtime is introduced.
- Existing `/pipelines` tests stay green.

## Verification

- Run adapter integration tests for success, permission, stale, unsupported, and failure paths.
- Exercise `/pipelines` to ClearPipe and return navigation.
- Confirm network calls use existing clients and credential systems.

## Risks and guardrails

- Route integration can regress existing pages.
- Capability gaps must surface rather than be hidden.
- Adapter state must not enter the canonical graph.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
