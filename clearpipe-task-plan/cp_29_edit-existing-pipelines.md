---
id: CP-29
title: "Support visual editing of existing pipelines with safe fallbacks"
lane: "Pipeline integration"
wave: 7
wave_name: "Integration convergence"
complexity_points: 8
hard_dependencies: ["CP-14", "CP-19", "CP-22", "CP-24", "CP-25"]
parallel_wave_peers: ["CP-28"]
directly_blocks: ["CP-30", "CP-31", "CP-32"]
---

# CP-29: Support visual editing of existing pipelines with safe fallbacks

## Outcome

Let users enter ClearPipe from `/pipelines`, edit safely representable pipelines, save according to established version semantics, and receive an explicit read-only or unsupported state for lossy conversions.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Pipeline integration.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 7 — Integration convergence.

## Requirement areas covered

- Journey C
- Integration with `/pipelines`
- Read-only fallback
- Versioning

## In scope

- Add verified `/pipelines` entry points and parameterized `/clearpipe` loading routes using CP-14 route helpers.
- Convert existing supported task-backed and code-backed representations into the canonical graph and visual metadata.
- Detect unsupported, ambiguous, mixed-style, or lossy constructs before enabling edits.
- Render read-only or unsupported states that identify each blocking construct and link back to the established details or code experience.
- Preserve existing pipeline identity, project, permissions, version metadata, and source representation rules.
- Implement update versus create-version behavior exactly as discovered and approved.
- Handle deleted/inaccessible tasks, datasets, components, and queues as stale references without fabricating replacements.
- Regression-test entry, round trip, version creation, permissions, and return navigation.

## Out of scope

- Universal code-to-canvas conversion.
- Partial graphs that appear semantically complete after behavior was dropped.
- Rewriting `/pipelines` management views.
- Silent migration or conversion of unsupported constructs.

## Deliverables

- Existing-pipeline loader and representability analyzer.
- Supported backend-to-graph adapters with round-trip fixtures.
- Read-only/unsupported UX with detailed reasons and handoff links.
- Verified update/version and return-navigation flows.
- Integration and regression tests for supported and unsupported examples.

## Interfaces and handoff contract

- Consumes CP-14 services/routes, CP-19 lifecycle rules, CP-22 migration handling, and the task/code node contracts.
- Must preserve CP-06 losslessness rules and surface conversion diagnostics through CP-11 conventions.
- Provides representability cases to CP-31 regression coverage and CP-32 limitations reporting.

## Parallelization and sequencing

### Must run after

- CP-14
- CP-19
- CP-22
- CP-24
- CP-25

This is an integration convergence task. Begin only when every listed dependency has a mergeable contract and passing focused checks. Its purpose is to expose cross-module defects, not to create replacement implementations inside the integration layer.

### Can run in parallel with

- CP-28

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-30
- CP-31
- CP-32

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- A supported existing pipeline opens as a logically equivalent graph and can be saved according to real version rules.
- An unsupported pipeline never opens as a deceptively editable partial graph.
- Every unsupported construct is named and paired with a safe next action.
- Permission-denied users receive a correct read-only or blocked experience.
- Round-trip fixtures demonstrate no loss for the declared supported subset.

## Verification

- Run adapter round-trip and representability fixtures.
- Run route-entry, permission, update/version, and return-navigation integration tests.
- Test stale and inaccessible resource references.
- Run targeted `/pipelines` regression tests for changed entry points.

## Risks and guardrails

- Existing pipeline representations may be more expressive than the graph; bias toward explicit unsupported states.
- Version semantics can differ by backend state; use CP-07 contracts rather than assumptions.
- Visual metadata may be absent on legacy pipelines; deterministic initial layout is acceptable but must not alter semantics.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
