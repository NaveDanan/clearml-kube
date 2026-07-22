---
id: CP-09
title: "Establish the test architecture, fixtures, and CI harness"
lane: "Quality contracts"
wave: 2
wave_name: "Parallel contract definition"
complexity_points: 5
hard_dependencies: ["CP-01", "CP-02", "CP-05"]
parallel_wave_peers: ["CP-06", "CP-07", "CP-08"]
directly_blocks: ["CP-31"]
---

# CP-09: Establish the test architecture, fixtures, and CI harness

## Outcome

Provide shared test utilities and deterministic fixtures so parallel tasks add focused coverage without incompatible mocks or unstable generated-output assertions.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Quality contracts.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 2 — Parallel contract definition.

## Requirement areas covered

- Test architecture
- Fixtures
- Golden files
- CI commands

## In scope

- Identify existing unit, component, integration, E2E, golden, accessibility, and build-test conventions.
- Create fixture builders for graph documents, nodes, ports, edges, resources, permissions, errors, execution states, and migrated versions.
- Create a service-adapter fake aligned with CP-07 using deterministic IDs, clocks, and ordering.
- Set up golden-file infrastructure for task and function generation.
- Define test tiers, ownership, naming, cleanup, and exact repository commands.
- Create an acceptance-criteria coverage matrix template for CP-31.

## Out of scope

- Writing all feature tests before implementations exist.
- Replacing the repository test framework.
- Treating mock-only tests as proof of real service integration.

## Deliverables

- Shared fixture factories and adapter fakes.
- A stable golden-output helper and update policy.
- A test-plan document for unit through E2E and `/pipelines` regression.
- A command inventory.
- At least one harness smoke test.

## Interfaces and handoff contract

- Every implementation task owns local tests using this harness or existing equivalents.
- CP-31 closes cross-cutting gaps.
- Semantic fixture changes require coordination with graph, validation, and generator owners.

## Parallelization and sequencing

### Must run after

- CP-01
- CP-02
- CP-05

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-06
- CP-07
- CP-08

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Teams can build valid/invalid graphs without hand-writing large objects.
- Permission, stale-resource, and execution scenarios are deterministic.
- Golden tests detect semantic drift without formatting noise.
- Relevant test, lint, type, and build commands are documented.

## Verification

- Run the harness smoke test and one golden assertion.
- Repeat runs to confirm determinism.
- Confirm the fake satisfies CP-07 without importing production clients.

## Risks and guardrails

- Over-mocking can hide integration defects.
- Snapshots must not replace semantic assertions.
- Do not add a second test framework.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
