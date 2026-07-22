---
id: CP-01
title: "Discover the existing `/pipelines` architecture end to end"
lane: "Discovery"
wave: 0
wave_name: "Parallel discovery"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["CP-02", "CP-03", "CP-04"]
directly_blocks: ["CP-05", "CP-07", "CP-09"]
---

# CP-01: Discover the existing `/pipelines` architecture end to end

## Outcome

Produce a verified, path-specific map of the current pipeline-management implementation so ClearPipe reuses established routes, services, permissions, persistence, versioning, and execution flows.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Discovery.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 0 — Parallel discovery.

## Requirement areas covered

- Current `/pipelines` discovery
- Integration boundary
- Implementation constraints

## In scope

- Verify actual route names, parameters, guards, and feature flags for pipeline list, details, creation, editing, versions, schedules, runs, and history.
- Trace create, update, version, delete, run, rerun, scheduling, status refresh, and navigation from UI entry point through state/hooks, services, clients, request/response models, and errors.
- Document authorization checks, unavailable states, loading/empty/error behavior, and telemetry conventions.
- Inventory reusable components, hooks, selectors, route builders, status components, and tests.
- Record exact repository paths and the commands that exercise the relevant checks.

## Out of scope

- Changing `/pipelines` behavior.
- Designing the graph schema.
- Creating new API endpoints or duplicate API clients.

## Deliverables

- A discovery note with exact paths and end-to-end call-flow diagrams.
- A reuse/wrap/do-not-use table for services and UI components.
- A preliminary `/clearpipe` versus `/pipelines` responsibility boundary.
- A list of verified backend limitations and unresolved questions for CP-05.

## Interfaces and handoff contract

- Feeds CP-05 and CP-07.
- Ambiguities must be explicit; downstream tasks may not invent persistence or version semantics.
- Do not add production code except a tiny diagnostic test when needed to prove behavior.

## Parallelization and sequencing

### Must run after

- None.

No project task is a hard prerequisite. Start immediately, in parallel with the other Wave 0 discovery tracks. Keep findings evidence-based and avoid making shared architecture decisions that belong to CP-05.

### Can run in parallel with

- CP-02
- CP-03
- CP-04

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-05
- CP-07
- CP-09

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Every lifecycle action is mapped to real code and service calls.
- Route names and navigation helpers are verified rather than assumed.
- Permissions, flags, errors, loading, and empty states are documented.
- The save/version/run boundaries are clear enough for adapter design.

## Verification

- Inspect or run the narrowest existing pipeline route, service, versioning, and execution tests.
- Cross-check at least one create/save flow and one run/status flow end to end.
- Confirm every documented path exists at the reviewed revision.

## Risks and guardrails

- Documentation may be stale; source and tests are authoritative.
- Legacy paths may coexist; identify the active path.
- Do not recommend rewriting `/pipelines` merely to simplify ClearPipe.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
