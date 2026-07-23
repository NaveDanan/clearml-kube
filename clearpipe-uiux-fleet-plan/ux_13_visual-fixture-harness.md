---
id: UX-13
title: "Create the UI fixture gallery and screenshot baseline harness"
lane: "Quality foundation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 5
hard_dependencies: ["UX-01", "UX-05"]
parallel_wave_peers: ["UX-06", "UX-07", "UX-08", "UX-09", "UX-10", "UX-11", "UX-12"]
directly_blocks: ["UX-24"]
recommended_owner: "Frontend test-infrastructure agent"
---

# UX-13: Create the UI fixture gallery and screenshot baseline harness

## Outcome

Provide deterministic visual fixtures so parallel agents can review states without reconstructing an entire live pipeline for every change.

## Why this task exists

Visual refactors need stable comparison states; otherwise regressions hide behind data variability and manual setup.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Quality foundation.
- **Recommended owner:** Frontend test-infrastructure agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Use the repository’s existing component/story/test-route approach.
- Create deterministic fixtures for shell, library modes, canvas states, node states, inspector sections, toolbar states, overlays, resource results, and execution feedback.
- Seed representative long labels, many ports, empty data, errors, permissions, stale resources, and read-only cases.
- Add screenshot capture at approved viewports and themes.
- Make fixtures reuse production components and approved test doubles only at external boundaries.

## Out of scope

- Creating a parallel production UI.
- Using mock behavior in production paths.
- Brittle screenshots containing uncontrolled timestamps or IDs.

## Owned surfaces and contracts

- Fixture gallery/test route or existing story system integration.
- Visual baseline configuration and deterministic data.
- Screenshot naming and review workflow.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A discoverable fixture index.
- Baseline images for UX-01 states plus all UX-05 target states.
- A command or test target for local and CI screenshot generation.
- Guidance for feature agents to add fixtures without editing one monolithic file.

## Parallelization and sequencing

### Must run after

[UX-01](./ux_01_audit-current-clearpipe-ui.md), [UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Fixtures render production components and stable data.
- All shared foundations have at least one representative fixture.
- Screenshots are deterministic across repeated runs.
- The harness supports the target themes and viewports.
- Feature agents can register fixtures in separate modules.

## Verification

- Run the screenshot command twice and compare outputs.
- Confirm no network dependency is required for deterministic fixtures.
- Review fixture coverage against UX-01 and UX-05.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-24 expands the harness into release-level visual and interaction regression coverage.

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
