---
id: CP-24
title: "Implement task-backed node authoring"
lane: "Authoring features"
wave: 6
wave_name: "Parallel feature completion"
complexity_points: 8
hard_dependencies: ["CP-12", "CP-14", "CP-17", "CP-18", "CP-20"]
parallel_wave_peers: ["CP-25", "CP-26", "CP-27"]
directly_blocks: ["CP-28", "CP-29", "CP-30", "CP-31"]
---

# CP-24: Implement task-backed node authoring

## Outcome

Allow users to search real tasks, add them as nodes, configure supported step semantics, bind parameters/artifacts/dependencies, validate, and generate accurate task pipeline output.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Authoring features.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 6 — Parallel feature completion.

## Requirement areas covered

- Task nodes
- Task search
- Parameter/artifact bindings
- Task generation

## In scope

- Register task catalog, card, inspector, and port extensions.
- Implement task search/selection with project, name, ID, type, status, tags, and updated context.
- Distinguish base task identity from runtime-created task identity.
- Implement step name, base task reference, parameter overrides, pipeline parameter bindings, upstream step/artifact bindings, execution-only parents, queue, cache, and approved retry/callback options.
- Expose typed task ports and compatible upstream suggestions.
- Integrate diagnostics and task generation.

## Out of scope

- Full save/run journey integration.
- Decorative task types without real semantics.
- Persisting runtime task IDs as base references.

## Deliverables

- Task node catalog/card/inspector/ports.
- Parameter, artifact, queue, cache, and dependency configuration.
- Stale/deleted/inaccessible task states.
- Generator integration and fixtures.
- Unit, component, and integration tests.

## Interfaces and handoff contract

- CP-28 combines this with persistence, toolbar, execution, and navigation.
- CP-26 maps runtime steps to graph IDs.
- CP-29 uses this representation for existing pipelines.
- No direct production API calls outside shared layers.

## Parallelization and sequencing

### Must run after

- CP-12
- CP-14
- CP-17
- CP-18
- CP-20

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-25
- CP-26
- CP-27

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-28
- CP-29
- CP-30
- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Users can find and add real tasks without manual IDs in the normal path.
- Two task nodes can be configured and connected semantically.
- Base and runtime identities are distinct.
- Queue, cache, overrides, and dependencies persist.
- Stale/inaccessible tasks are actionable.
- Generated output matches the graph.

## Verification

- Run tests with valid, missing, deleted, permission-denied, and stale tasks.
- Generate parameter, step-output, artifact, queue, cache, and parent fixtures.
- Exercise connection suggestions and invalid binding errors.
- Confirm runtime task IDs are not persisted as base references.

## Risks and guardrails

- Task metadata may be incomplete or stale.
- Parents and data bindings must remain distinct.
- Do not expose non-round-trippable advanced behavior.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
