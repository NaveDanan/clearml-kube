---
id: UX-11
title: "Redesign the pipeline toolbar and action hierarchy"
lane: "Foundation implementation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 5
hard_dependencies: ["UX-05"]
parallel_wave_peers: ["UX-06", "UX-07", "UX-08", "UX-09", "UX-10", "UX-12", "UX-13"]
directly_blocks: ["UX-20", "UX-21", "UX-22", "UX-23"]
recommended_owner: "Toolbar and lifecycle UI agent"
---

# UX-11: Redesign the pipeline toolbar and action hierarchy

## Outcome

Make the pipeline name, save state, validation, and Run action immediately understandable while moving secondary actions out of the way.

## Why this task exists

A crowded toolbar with equal-weight icons forces users to guess and hides the state of their work.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Foundation implementation.
- **Recommended owner:** Toolbar and lifecycle UI agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Implement the approved primary, secondary, and overflow action hierarchy using existing commands.
- Show pipeline identity and saved/modified/saving/error state compactly.
- Make Validate and Run stateful, explain disabled states, and prevent duplicate submissions.
- Group New/Open/Save/Version and Import/Export/Code Preview according to actual product conventions.
- Use labels, tooltips, menus, and shortcuts consistently.
- Provide responsive overflow hooks for UX-23.

## Out of scope

- Changing lifecycle or execution behavior.
- Adding buttons for unsupported or placeholder actions.
- Owning dialogs beyond trigger contracts.

## Owned surfaces and contracts

- Toolbar container and action presentation.
- Pipeline identity and save-state display.
- Primary/secondary/overflow grouping.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Toolbar states for new, saved, dirty, saving, save failed, invalid, ready, submitting, and running.
- Disabled-state explanations and shortcut hints.
- Action trigger contract for UX-21 dialogs/overlays.
- Interaction tests.

## Parallelization and sequencing

### Must run after

[UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Run is prominent but cannot bypass required validation.
- Save state is visible without opening a menu.
- Secondary actions do not crowd the primary workflow.
- Every disabled action explains why.
- Toolbar controls have accessible names and consistent focus order.
- No action duplicates a command already handled elsewhere.

## Verification

- Exercise every toolbar state against existing commands.
- Test narrow width overflow with UX-23.
- Verify no duplicate run/save submissions.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-20 supplies run status content. UX-21 owns triggered dialogs, toasts, and unsaved flows.

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
