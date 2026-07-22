---
id: CP-04
title: "Analyze the ClearPipe functional and visual reference"
lane: "Discovery"
wave: 0
wave_name: "Parallel discovery"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["CP-01", "CP-02", "CP-03"]
directly_blocks: ["CP-05", "CP-08"]
---

# CP-04: Analyze the ClearPipe functional and visual reference

## Outcome

Produce a complete user-visible capability inventory and adaptation recommendation without copying or naming the reference implementation technologies.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Discovery.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 0 — Parallel discovery.

## Requirement areas covered

- Functional reference
- Visual direction
- Functional parity matrix

## In scope

- Inspect layout, palette, drag/drop, canvas navigation, node cards, handles, edge editing, inspector, datasets, toolbar, lifecycle actions, execution, logs, keyboard behavior, unsaved state, panels, minimap, errors, empty states, and collaboration.
- Use the screenshot to record hierarchy, density, grouping, and interaction placement.
- Map each capability to a real ClearML concept and a candidate Adopt, Adapt, Omit, or Defer decision.
- Identify behaviors that conflict with ClearML semantics, permissions, persistence, credentials, or execution.
- Cover loading, empty, disabled, error, and permission states—not just happy paths.

## Out of scope

- Mentioning or copying the reference language, framework, libraries, build tooling, state system, or canvas implementation.
- Treating pixel similarity as more important than pipeline correctness.
- Implementing features during research.

## Deliverables

- A capability inventory grouped by shell, editing, lifecycle, configuration, resources, execution, collaboration, responsiveness, and accessibility.
- Candidate parity-matrix rows with owner and rationale.
- A visual hierarchy note for CP-08.
- A list of features to reject or defer with concrete reasons.

## Interfaces and handoff contract

- Feeds CP-05 and CP-08.
- Parity decisions remain provisional until reconciled with CP-01 through CP-03.
- Final project material must remain product-focused and omit prohibited technology references.

## Parallelization and sequencing

### Must run after

- None.

No project task is a hard prerequisite. Start immediately, in parallel with the other Wave 0 discovery tracks. Keep findings evidence-based and avoid making shared architecture decisions that belong to CP-05.

### Can run in parallel with

- CP-01
- CP-02
- CP-03

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-05
- CP-08

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Every major reference capability has an observed-behavior entry.
- Each capability has a ClearML mapping or a concrete reason it cannot map.
- The analysis covers non-happy-path and keyboard/panel states.
- No prohibited implementation technology appears in deliverables.

## Verification

- Cross-check the inventory against the full reference and screenshot.
- Verify each proposed ClearML equivalent is real or mark it unresolved.
- Review deliverables for prohibited implementation-technology references.

## Risks and guardrails

- A polished reference interaction may not map to valid ClearML semantics.
- Collaboration and generic connection management must not be mocked for parity.
- Avoid pixel copying at the cost of product consistency.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
