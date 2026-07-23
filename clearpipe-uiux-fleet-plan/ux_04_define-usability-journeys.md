---
id: UX-04
title: "Define the usability journeys and measurable UI acceptance baseline"
lane: "Product UX"
wave: 0
wave_name: "Parallel UI evidence"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["UX-01", "UX-02", "UX-03"]
directly_blocks: ["UX-05", "UX-25"]
recommended_owner: "Product designer or UX engineer"
---

# UX-04: Define the usability journeys and measurable UI acceptance baseline

## Outcome

Turn “awful and unusable” into measurable user-journey acceptance criteria and a repeatable usability script.

## Why this task exists

Parallel component polish will not fix the product unless the complete authoring flow becomes understandable, efficient, and recoverable.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Product UX.
- **Recommended owner:** Product designer or UX engineer.
- **Wave:** 0 — Parallel UI evidence.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Define the primary journeys for first use, task-backed authoring, code-backed authoring, resource selection, connection repair, validation repair, save, run, and reopen.
- For each journey, record starting state, user intent, required information, expected feedback, recovery path, and success condition.
- Define interaction-cost targets such as obvious next action, no hidden required fields, no unnecessary route change, and no unexplained disabled control.
- Define a UX review script for keyboard, pointer, narrow viewport, error recovery, and reduced motion.
- Reconcile the journey failures with UX-01’s defect evidence.

## Out of scope

- Changing pipeline semantics to simplify the UI.
- Using subjective visual preference as the only acceptance criterion.
- Adding unsupported product capabilities.

## Owned surfaces and contracts

- Core-journey test script.
- UX scorecard dimensions and pass/fail rules.
- Terminology and information-priority recommendations.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A compact journey map and task-success checklist.
- A scorecard covering clarity, discoverability, efficiency, feedback, error recovery, accessibility, and visual consistency.
- A list of P0/P1 UX failures that must be zero before UX-25.
- A manual review script that can be executed by someone who did not implement the feature.

## Parallelization and sequencing

### Must run after

None.

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-01](./ux_01_audit-current-clearpipe-ui.md), [UX-02](./ux_02_study-reference-node-library.md), [UX-03](./ux_03_inventory-clearml-design-system.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-05](./ux_05_freeze-uiux-contract.md), [UX-25](./ux_25_final-uiux-integration-gate.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Every core authoring journey has a clear success condition.
- Validation, permission, loading, stale-resource, and run-failure recovery are included.
- The scorecard is observable and does not depend on personal taste.
- The script includes both drag and non-drag node insertion.
- UX-01 and UX-04 agree on the top-priority failures.

## Verification

- Dry-run the script against the current UI and record where it fails.
- Review the scorecard with UX-05 and UX-25.
- Ensure each criterion can be evidenced by a screenshot, interaction test, or manual observation.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-05 makes the scorecard binding. UX-25 reruns the same script for final acceptance.

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
