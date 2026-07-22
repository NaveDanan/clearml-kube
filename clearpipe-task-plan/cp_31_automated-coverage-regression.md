---
id: CP-31
title: "Complete automated coverage and `/pipelines` regression protection"
lane: "Quality engineering"
wave: 8
wave_name: "Parallel hardening and regression coverage"
complexity_points: 8
hard_dependencies: ["CP-09", "CP-21", "CP-22", "CP-23", "CP-24", "CP-25", "CP-26", "CP-27", "CP-28", "CP-29"]
parallel_wave_peers: ["CP-30"]
directly_blocks: ["CP-32"]
---

# CP-31: Complete automated coverage and `/pipelines` regression protection

## Outcome

Turn the agreed test architecture into comprehensive, stable coverage for graph semantics, both authoring modes, lifecycle, integration, editor behavior, and unchanged `/pipelines` functionality.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Quality engineering.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 8 — Parallel hardening and regression coverage.

## Requirement areas covered

- Tests and regression coverage
- Acceptance criteria
- Golden files
- `/pipelines` regression

## In scope

- Complete graph-model, command, serialization, migration, identifier, and cycle-detection test suites.
- Complete validation coverage for ports, resources, references, queues, permissions, unsupported constructs, and preflight aggregation.
- Add deterministic task- and code-generator golden fixtures, including parameters, artifacts, multiple outputs, queues, caching, and escaping.
- Cover task, dataset, and component selectors; stale resources; pagination; permission filtering; and errors.
- Cover save/reload, import/export, update/version, existing-pipeline conversion, execution submission/status, and navigation.
- Cover canvas interactions, reconnection, undo/redo, clipboard, keyboard scoping, unsaved guards, and key empty/loading/error/read-only states.
- Add targeted regression tests around every `/pipelines` entry point or shared service changed by ClearPipe.
- Stabilize fixtures and CI behavior; remove tests that pass only because production actions are mocked away.

## Out of scope

- Replacing appropriate unit tests with a single brittle end-to-end test.
- Snapshotting unstable incidental markup.
- Claiming external-service behavior that the test environment cannot verify.
- Broad unrelated test cleanup.

## Deliverables

- Complete layered test suites and reusable graph/resource/execution fixtures.
- Golden files for all supported generated-code families.
- ClearPipe integration/end-to-end journeys for task-backed and code-backed authoring.
- Existing-pipeline supported/unsupported conversion coverage.
- Targeted `/pipelines` regression suite and CI invocation documentation.

## Interfaces and handoff contract

- Builds on the harness and fixture policy from CP-09.
- Works in parallel with CP-30 after integration, exchanging durable regression cases.
- Provides exact commands and pass/fail evidence to CP-32; failures are fixed in owning modules.

## Parallelization and sequencing

### Must run after

- CP-09
- CP-21
- CP-22
- CP-23
- CP-24
- CP-25
- CP-26
- CP-27
- CP-28
- CP-29

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-30

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-32

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Every acceptance-critical semantic has at least one focused automated test.
- Task-backed and code-backed complete journeys are covered at the appropriate integration level.
- Generated output is protected by deterministic golden fixtures.
- Changed `/pipelines` behavior and shared services have regression coverage.
- The suite is repeatable in the repository's standard CI environment without hidden local dependencies.

## Verification

- Run all added unit, integration, and end-to-end suites through established repository commands.
- Run targeted `/pipelines` regression tests.
- Run tests repeatedly where needed to detect flakiness.
- Record exact commands, environment assumptions, and results for CP-32.

## Risks and guardrails

- Overmocking can hide integration failures; preserve real adapter boundaries in integration tests.
- Golden files can become noisy; keep formatting deterministic and review semantic diffs.
- End-to-end execution may require unavailable infrastructure; distinguish repository-supported contract tests from any environment-dependent smoke test.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
