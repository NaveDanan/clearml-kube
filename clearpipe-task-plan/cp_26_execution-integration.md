---
id: CP-26
title: "Integrate preflight, submission, live status, logs, and results handoff"
lane: "Execution"
wave: 6
wave_name: "Parallel feature completion"
complexity_points: 8
hard_dependencies: ["CP-11", "CP-12", "CP-13", "CP-14", "CP-19", "CP-23"]
parallel_wave_peers: ["CP-24", "CP-25", "CP-27"]
directly_blocks: ["CP-28", "CP-30", "CP-31"]
---

# CP-26: Integrate preflight, submission, live status, logs, and results handoff

## Outcome

Connect ClearPipe to the real ClearML pipeline execution flow, from preflight validation through submission and concise node-level feedback, while handing detailed operations to the established `/pipelines` experience.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Execution.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 6 — Parallel feature completion.

## Requirement areas covered

- Pipeline execution UX
- Execution feedback
- Run integration
- Journey D

## In scope

- Run graph, resource, permission, queue, generated-output, and save-state preflight checks before enabling submission.
- Adapt the canonical graph and generated representation to the existing execution service through CP-14; never create a browser-side runner.
- Prevent duplicate submissions and normalize submission errors using existing application conventions.
- Map backend pipeline and task states to graph nodes using stable step identities and generator source maps.
- Display submitted, queued, running, completed, failed, aborted, skipped, and cached states only where backed by real status data.
- Expose concise node logs or log links, created task IDs, outputs, artifacts, models, dataset versions, timestamps, and failure details where APIs support them.
- Provide reliable navigation to pipeline execution, run details, and task details under `/pipelines`.
- Handle refresh, polling/subscription teardown, stale runs, authorization loss, and partial backend data.

## Out of scope

- Implementing a second execution engine.
- Duplicating full run history, scheduling, retry administration, or operational dashboards from `/pipelines`.
- Simulated progress or fabricated per-node success.
- Adding unsupported retry/rerun semantics.

## Deliverables

- Preflight coordinator and run-action state machine.
- Execution submission adapter integration.
- Pipeline- and node-status mapping with source-map resolution.
- Concise results/log surface and established-route links.
- Focused submission, status-transition, error, stale-data, and navigation tests.

## Interfaces and handoff contract

- Consumes CP-11 diagnostics, CP-12/CP-13 generated output, CP-14 service adapters, CP-19 persisted identity, and CP-23 toolbar hooks.
- Publishes stable execution-state selectors for node cards, inspector, and the final vertical slice.
- Operational detail remains owned by `/pipelines`; ClearPipe provides context and a handoff link.

## Parallelization and sequencing

### Must run after

- CP-11
- CP-12
- CP-13
- CP-14
- CP-19
- CP-23

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-24
- CP-25
- CP-27

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-28
- CP-30
- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Run is disabled with an actionable explanation until all mandatory preflight checks pass.
- One user action creates exactly one execution through the existing service.
- Node states are derived from real backend records and correlate through stable step IDs.
- Submission, permission, queue, missing-resource, and runtime failures remain distinguishable.
- Users can open the resulting pipeline run and task details through verified routes.

## Verification

- Run adapter and submission integration tests with controlled service fixtures.
- Test status mappings and out-of-order updates.
- Test duplicate-click prevention, cancellation/unmount cleanup, authorization failures, and stale identifiers.
- Exercise at least one real or repository-supported end-to-end submission path when the environment permits.

## Risks and guardrails

- Backend status granularity may not support every desired visual state; expose only verified mappings.
- Polling can leak or overload services; follow existing status-refresh infrastructure.
- Step-name drift breaks correlation; source maps and canonical stable names are mandatory.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
