---
id: UX-01
title: "Audit the current ClearPipe UI and capture the unusable states"
lane: "Discovery"
wave: 0
wave_name: "Parallel UI evidence"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["UX-02", "UX-03", "UX-04"]
directly_blocks: ["UX-05", "UX-13"]
recommended_owner: "Product UX engineer with frontend debugging access"
---

# UX-01: Audit the current ClearPipe UI and capture the unusable states

## Outcome

Create an evidence-backed baseline of the current `/clearpipe` experience so the fleet fixes real usability failures instead of restyling blindly.

## Why this task exists

The implementation is functionally advanced but visually unusable. The team needs a shared defect inventory, reproducible screenshots, and a component map before parallel visual changes begin.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Discovery.
- **Recommended owner:** Product UX engineer with frontend debugging access.
- **Wave:** 0 — Parallel UI evidence.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Run the current application against representative real or approved fixture data.
- Capture the complete editor at the repository’s supported desktop widths, including an empty graph, a small configured graph, validation errors, and an active or completed run state.
- Walk the core journeys: open editor, find a node/resource, add it, connect it, configure it, validate, save, run, inspect status, and reopen.
- Record visual and interaction defects by severity: blocked task, high-friction task, confusing state, inconsistency, and cosmetic defect.
- Map each visible region and component to its actual repository path and owning state/service.
- Record overflow, clipping, z-index, focus, scrolling, density, contrast, spacing, motion, and pointer-target defects.
- Identify components that work and must be preserved.

## Out of scope

- Changing business logic, graph semantics, persistence, or execution.
- Implementing broad visual fixes during the audit.
- Judging the UI from source code alone without running the application.

## Owned surfaces and contracts

- Audit document and screenshot baseline only.
- A repository-path map for the editor shell, palette/library, canvas, node renderers, inspector, toolbar, overlays, and test surfaces.
- The severity rubric used by all later agents.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A before-state screenshot set with exact viewport, route, data state, and reproduction steps.
- A prioritized defect register with an owner-candidate task for every P0/P1 issue.
- A UI component and state-flow map using exact workspace paths.
- A list of working behavior that visual refactors must not regress.

## Parallelization and sequencing

### Must run after

None.

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-02](./ux_02_study-reference-node-library.md), [UX-03](./ux_03_inventory-clearml-design-system.md), [UX-04](./ux_04_define-usability-journeys.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-05](./ux_05_freeze-uiux-contract.md), [UX-13](./ux_13_visual-fixture-harness.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Every core journey has at least one reproducible baseline.
- Every P0/P1 issue names the affected component path and observable failure.
- The audit distinguishes functional defects from visual or interaction defects.
- The baseline includes empty, loading, error, validation, configured, and execution states.
- No speculative path or component name remains in the final audit.

## Verification

- Repeat each recorded reproduction once from a clean page load.
- Check browser console output and record pre-existing errors separately.
- Confirm screenshots are readable at 100% scale and named consistently.
- Cross-review the top ten defects with UX-04.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-05 consumes the defect register and component map. UX-13 consumes the screenshot states and fixture requirements.

The handoff must include changed files, fixtures added, before/after evidence, tests run, known blockers, and any contract change.

## Universal guardrails

- Preserve existing graph, validation, persistence, execution, permission, feature-flag, and route contracts.
- Use the current ClearML design system and repository conventions; do not introduce a second styling or state system.
- Treat the NJ-Labs repository as a product-behavior reference only.
- Use real ClearML resources and existing commands. No mock-only production flow or decorative unsupported node type.
- Do not store credentials or secrets in graph/UI state, exports, URLs, or browser persistence.
- Keep ordinary graph edges static; animate only meaningful transient or active execution states.
- Add or update focused tests and register deterministic visual fixtures for changed states.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- The changed surface works with representative real data or approved boundary fixtures.
- Relevant tests, linting, type/static checks, and builds for the changed scope pass.
- There is no new runtime-console error.
- No core interaction introduced or changed by this task remains a placeholder.
- Any remaining limitation is concrete, verified, and assigned to a downstream owner.
