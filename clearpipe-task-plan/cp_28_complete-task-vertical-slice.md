---
id: CP-28
title: "Integrate and prove the first complete task-backed vertical slice"
lane: "Integration gate"
wave: 7
wave_name: "Integration convergence"
complexity_points: 5
hard_dependencies: ["CP-16", "CP-18", "CP-19", "CP-20", "CP-23", "CP-24", "CP-26"]
parallel_wave_peers: ["CP-29"]
directly_blocks: ["CP-30", "CP-31", "CP-32"]
---

# CP-28: Integrate and prove the first complete task-backed vertical slice

## Outcome

Prove the architecture with one production-connected workflow that creates a two-step task-backed pipeline, validates it, generates its definition, saves and reloads it, submits it, and opens the resulting execution.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Integration gate.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 7 — Integration convergence.

## Requirement areas covered

- Complete vertical slice
- Task-based authoring
- Save/reload
- Real execution

## In scope

- Integrate the shell, task resource search, task node configuration, semantic connections, validation, generation, lifecycle, toolbar, and execution modules into one coherent path.
- Use at least two real task references and one meaningful parameter, output, or artifact binding.
- Verify graph positions, stable IDs, bindings, queue/cache settings, and metadata survive save and reload.
- Exercise the actual create/version behavior selected in CP-07 and the actual execution handoff from CP-26.
- Resolve integration defects at contract boundaries without expanding into optional hardening work.
- Add an automated integration or end-to-end test for the complete journey using the repository's established framework.

## Out of scope

- Completing every node type or advanced editor operation.
- Broad visual polish unrelated to the slice.
- Replacing real services with mock-only production behavior.
- Declaring the code-backed journey complete; that remains separately testable through CP-25 and later coverage.

## Deliverables

- A working task-backed end-to-end path in the application.
- A deterministic test fixture representing the vertical-slice graph.
- An automated create-configure-connect-validate-save-reload-run-handoff test.
- A concise integration record of any verified backend constraints discovered during the slice.

## Interfaces and handoff contract

- This is a convergence gate, not a parallel feature lane; all hard dependencies must be integrated before it closes.
- Defects found in an owning module should be fixed there, preserving contract ownership.
- Unblocks broad hardening and final release confidence but should not absorb CP-30 or CP-31 scope.

## Parallelization and sequencing

### Must run after

- CP-16
- CP-18
- CP-19
- CP-20
- CP-23
- CP-24
- CP-26

This is an integration convergence task. Begin only when every listed dependency has a mergeable contract and passing focused checks. Its purpose is to expose cross-module defects, not to create replacement implementations inside the integration layer.

### Can run in parallel with

- CP-29

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

- A user can complete the entire task-based journey without a placeholder action or manual data patch.
- Generated output accurately represents both nodes and their meaningful binding.
- Save/reload recreates the same logical graph and visual placement.
- Run uses the existing execution service and produces a navigable real execution identity.
- The automated vertical-slice test passes reliably.

## Verification

- Run the new end-to-end or integration test.
- Run focused graph, validator, generator, persistence, route, and execution tests.
- Perform one manual smoke pass using repository-supported real data/services where available.
- Confirm no new runtime-console errors during the journey.

## Risks and guardrails

- Integration may expose a backend representation gap; document and adapt rather than inventing a second persistence model.
- Flaky asynchronous status checks can undermine the gate; use established test synchronization.
- Do not weaken validation merely to make the demo path pass.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
