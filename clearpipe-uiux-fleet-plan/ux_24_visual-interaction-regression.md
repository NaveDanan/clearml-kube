---
id: UX-24
title: "Complete automated visual and interaction regression coverage"
lane: "Quality engineering"
wave: 5
wave_name: "Regression gate"
complexity_points: 8
hard_dependencies: ["UX-13", "UX-14", "UX-15", "UX-16", "UX-17", "UX-18", "UX-19", "UX-20", "UX-21", "UX-22", "UX-23"]
parallel_wave_peers: []
directly_blocks: ["UX-25"]
recommended_owner: "UI test and visual-regression agent"
---

# UX-24: Complete automated visual and interaction regression coverage

## Outcome

Protect the redesigned editor from returning to inconsistent, clipped, inaccessible, or visually broken states.

## Why this task exists

The scope spans many parallel branches; a release gate must verify integrated states, not only unit components.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Quality engineering.
- **Recommended owner:** UI test and visual-regression agent.
- **Wave:** 5 — Regression gate.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Expand UX-13 fixtures and screenshot tests to all critical states, themes, and supported widths.
- Add interaction coverage for node search/add, panel resize/collapse, node selection, connection feedback, inspector forms, validation, dialogs, toolbar states, and execution feedback.
- Add accessibility assertions supported by the repository.
- Add regression coverage for `/pipelines` entry/return flows affected by UI changes.
- Stabilize nondeterministic data, animation, and timestamps in tests.

## Out of scope

- Approving intentional visual changes without review.
- Replacing useful semantic tests with screenshots only.
- Testing mock-only flows that differ from production component wiring.

## Owned surfaces and contracts

- Visual baseline suite and integrated UI interaction tests.
- Regression test documentation.
- Failure triage back to component owners.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Approved visual baselines.
- Integrated interaction and accessibility tests.
- Exact repository commands and results.
- A zero-unowned-failure report.

## Parallelization and sequencing

### Must run after

[UX-13](./ux_13_visual-fixture-harness.md), [UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

None.

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-25](./ux_25_final-uiux-integration-gate.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Every UX-04 core journey has automated coverage at the narrowest practical level.
- Critical shell, library, node, inspector, toolbar, overlay, and execution states have visual baselines.
- Tests cover normal and constrained widths plus supported themes.
- Tests are deterministic across repeated runs.
- No regression failure is dismissed as flaky without a root cause.

## Verification

- Run the complete suite twice from a clean workspace.
- Review every baseline change against UX-05.
- Record test commands and results for UX-25.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-25 uses the passing suite and baseline review as a release prerequisite.

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
