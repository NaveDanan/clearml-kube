---
id: CP-11
title: "Implement incremental graph validation and preflight diagnostics"
lane: "Domain core"
wave: 3
wave_name: "Parallel foundational implementation"
complexity_points: 8
hard_dependencies: ["CP-06"]
parallel_wave_peers: ["CP-10", "CP-12", "CP-13", "CP-14", "CP-15"]
directly_blocks: ["CP-20", "CP-23", "CP-26"]
---

# CP-11: Implement incremental graph validation and preflight diagnostics

## Outcome

Create one reusable validation engine for structural, semantic, resource, and generation blockers, both incrementally and before save or run.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Domain core.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 3 — Parallel foundational implementation.

## Requirement areas covered

- Validation
- DAG rules
- Resource validation
- Preflight

## In scope

- Define stable diagnostic codes, severity, target, message, suggested correction, and blocking policy.
- Validate DAG structure, cycles, self-connections, duplicate names, identifiers, dangling edges, unknown ports, deleted references, and multiplicity.
- Validate required inputs/outputs, compatible ports, pipeline and step references, artifacts, and conflicting dependencies.
- Validate required node fields, queues, cache/retry settings, unsupported constructs, and mixed-mode policy.
- Provide an asynchronous resolver interface for resource existence and permissions rather than direct network calls.
- Provide incremental, full-graph, and execution-preflight APIs with deterministic ordering.

## Out of scope

- Rendering diagnostics in the UI.
- Fetching resources directly.
- Silently repairing invalid graphs.

## Deliverables

- Pure structural/semantic validation package.
- Async resource-validation orchestration contract.
- A preflight result model.
- Comprehensive rule tests.
- A diagnostic catalog suitable for user-facing help.

## Interfaces and handoff contract

- CP-20 uses the same compatibility and cycle rules.
- CP-19, CP-23, and CP-26 consume preflight results.
- CP-18 supplies resource resolvers.
- Generators may contribute diagnostics through the common issue model.

## Parallelization and sequencing

### Must run after

- CP-06

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-10
- CP-12
- CP-13
- CP-14
- CP-15

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-20
- CP-23
- CP-26

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Every required validation case has a stable code and test.
- Issues identify graph, node, field, port, or edge targets.
- Messages explain the problem and correction.
- Obvious structural errors appear before save/run.
- Deleted, inaccessible, stale, and permission-denied resources are distinct.

## Verification

- Run the full validation matrix on valid and invalid fixtures.
- Exercise cycle, self, duplicate binding, missing resource, invalid reference, and unsupported-code cases.
- Confirm validation is deterministic, side-effect free, and network-independent.

## Risks and guardrails

- Duplicated canvas/validator compatibility logic will drift.
- Async validation can flicker; pending and invalid must differ.
- Warnings should not automatically block draft saving unless policy requires it.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
