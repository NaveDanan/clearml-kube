---
id: CP-05
title: "Synthesize the architecture decision record and functional parity matrix"
lane: "Architecture gate"
wave: 1
wave_name: "Architecture convergence gate"
complexity_points: 5
hard_dependencies: ["CP-01", "CP-02", "CP-03", "CP-04"]
parallel_wave_peers: []
directly_blocks: ["CP-06", "CP-07", "CP-08", "CP-09"]
---

# CP-05: Synthesize the architecture decision record and functional parity matrix

## Outcome

Resolve all discovery findings into one approved implementation contract that freezes the ClearPipe-to-`/pipelines` boundary, source of truth, generation strategy, capability decisions, and subsystem ownership.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Architecture gate.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 1 — Architecture convergence gate.

## Requirement areas covered

- Architecture decisions
- Source of truth
- Parity matrix
- Milestones

## In scope

- Reconcile current workspace architecture, ClearML semantics, WIP implementation, and reference UX using the required precedence.
- Finalize `/clearpipe` versus `/pipelines` responsibilities.
- Select the canonical authoring representation and deterministic adapter strategy.
- Finalize the function-generation model and mixed-mode policy.
- Complete the Adopt/Adapt/Omit/Defer parity matrix with owner and reason.
- Define exact paths to preserve, extend, or create, plus risks, assumptions, and milestones.

## Out of scope

- Implementing the graph schema or adapters.
- Leaving material architecture questions unresolved.
- Using the reference project as an architecture source.

## Deliverables

- A concise ADR with exact workspace paths.
- The completed functional parity matrix.
- A graph/backend/code/visual-metadata source-of-truth diagram.
- A module ownership and dependency map for CP-06 through CP-32.
- A decision log of verified limitations and non-goals.

## Interfaces and handoff contract

- CP-06 owns graph contracts, CP-07 service contracts, CP-08 UX contracts, and CP-09 test contracts.
- After this gate, parallel tasks may work against frozen interfaces.
- Later changes to source of truth, route boundary, or generation model require an ADR update and impact review.

## Parallelization and sequencing

### Must run after

- CP-01
- CP-02
- CP-03
- CP-04

This is the first deliberate convergence gate. It must begin after all four discovery packs are usable because it resolves conflicts, selects shared contracts, and prevents parallel implementation from encoding incompatible assumptions.

### Can run in parallel with

- None.

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-06
- CP-07
- CP-08
- CP-09

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- No material ambiguity remains about canonical state, persistence, versioning, execution, or route ownership.
- Every major reference capability has a decision, reason, and owner.
- Exact current-workspace paths are used.
- Supported pipeline subset and read-only fallback policy are explicit.

## Verification

- Review the ADR against all four discovery outputs.
- Verify no planned module duplicates clients, state systems, runtimes, credentials, or `/pipelines` features.
- Confirm downstream dependencies align with the approved architecture.

## Risks and guardrails

- Unresolved visual-metadata storage will force broad rework.
- A graph source of truth is preferred but must not be asserted against backend reality.
- Unsupported behavior must not be hidden behind mock UI.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
