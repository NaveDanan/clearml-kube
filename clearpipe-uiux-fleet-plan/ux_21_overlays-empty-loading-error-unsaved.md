---
id: UX-21
title: "Unify dialogs, menus, toasts, empty/loading/error, read-only, and unsaved states"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 8
hard_dependencies: ["UX-06", "UX-07", "UX-08", "UX-10", "UX-11", "UX-12"]
parallel_wave_peers: ["UX-14", "UX-15", "UX-16", "UX-17", "UX-18", "UX-19", "UX-20"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Feedback and overlay UX agent"
---

# UX-21: Unify dialogs, menus, toasts, empty/loading/error, read-only, and unsaved states

## Outcome

Replace ad hoc alerts, silent failures, and inconsistent empty states with one predictable ClearML feedback system.

## Why this task exists

A visual editor becomes unsafe when destructive actions, unsaved work, loading, permissions, and failures are presented inconsistently.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Feedback and overlay UX agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Use existing ClearML dialog, drawer, menu, tooltip, toast, banner, skeleton, and empty-state components.
- Standardize save/open/import/export/delete/run confirmations and unsaved-change protection.
- Implement loading, retry, permission, stale-resource, unsupported, and read-only editor states.
- Define feedback priority: inline field, node/edge, inspector, canvas banner, toast, or blocking dialog.
- Replace generic alerts and placeholder messages with actionable copy.
- Coordinate z-index, focus return, Escape, and overlay stacking with the shell.

## Out of scope

- Changing lifecycle commands or error normalization.
- Using a modal for every ordinary action.
- Mocking unsupported behavior.

## Owned surfaces and contracts

- Shared editor feedback and overlay composition.
- Unsaved/destructive confirmation presentation.
- Canvas/shell-level empty, loading, error, permission, unsupported, and read-only surfaces.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A feedback-routing matrix and implemented shared states.
- Consistent lifecycle dialogs and notifications.
- Actionable copy for all core failures.
- Focus/overlay interaction tests.

## Parallelization and sequencing

### Must run after

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- No core flow uses a browser alert or generic unexplained error.
- Unsaved work is protected before destructive navigation or replacement.
- Blocking dialogs are reserved for blocking decisions.
- Retryable failures expose Retry.
- Read-only/unsupported states explain the limitation and provide a safe next action.
- Focus returns to the invoking control after overlays close.

## Verification

- Test stacked menus/dialogs, Escape order, failed save, failed import, permission denied, stale resource, and navigation with unsaved work.
- Verify copy against UX-04 journeys.
- Review screen-reader announcements with UX-22.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-22 hardens accessibility. UX-23 handles compact/drawer behavior. UX-24 captures regression states.

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
