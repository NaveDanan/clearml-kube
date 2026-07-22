---
id: CP-02
title: "Audit the current `/clearpipe` work in progress"
lane: "Discovery"
wave: 0
wave_name: "Parallel discovery"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["CP-01", "CP-03", "CP-04"]
directly_blocks: ["CP-05", "CP-08", "CP-09"]
---

# CP-02: Audit the current `/clearpipe` work in progress

## Outcome

Create a preserve-versus-replace inventory of the current ClearPipe implementation so useful work remains intact and mocked or incomplete behavior is isolated before broad changes.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Discovery.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 0 — Parallel discovery.

## Requirement areas covered

- Current `/clearpipe` discovery
- Preserve useful work
- Technical debt

## In scope

- Locate the route, page hierarchy, canvas integration, graph state, node definitions, inspector, toolbar, styling, API usage, and tests.
- Identify the current graph dependency and how nodes, edges, positions, selection, and viewport are represented.
- Classify each visible action as real, mocked, placeholder, partial, broken, or inaccessible.
- Review state management, persistence, responsiveness, accessibility, runtime-console behavior, and technical debt.
- Identify duplicated clients, dead code, and assumptions that conflict with the current workspace.

## Out of scope

- Replacing working code during the audit.
- Selecting the final graph schema without CP-03 and CP-05.
- Implementing new node types.

## Deliverables

- An exact-path component/state map.
- A preserve/adapt/replace/remove matrix.
- A catalog of mock data, placeholders, gaps, and tests.
- A minimal migration path from the WIP state to the shared architecture.

## Interfaces and handoff contract

- Feeds CP-05, CP-08, and CP-09.
- Later UI tasks must consult this audit before creating top-level modules.
- Flag high-conflict files so ownership can be assigned at CP-05.

## Parallelization and sequencing

### Must run after

- None.

No project task is a hard prerequisite. Start immediately, in parallel with the other Wave 0 discovery tracks. Keep findings evidence-based and avoid making shared architecture decisions that belong to CP-05.

### Can run in parallel with

- CP-01
- CP-03
- CP-04

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-05
- CP-08
- CP-09

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- All ClearPipe routes and major modules are documented with exact paths.
- Working, mocked, incomplete, and broken behavior are distinguished.
- Current graph and state ownership are understood.
- Useful code is explicitly identified for preservation.

## Verification

- Exercise the current route where possible.
- Inspect current ClearPipe tests and record what they actually assert.
- Confirm every placeholder or mock has a concrete code location.

## Risks and guardrails

- WIP code may have hidden coupling to shared state.
- Incomplete UI can still contain valuable integration logic.
- Do not add a second graph library or state system without a verified gap.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
