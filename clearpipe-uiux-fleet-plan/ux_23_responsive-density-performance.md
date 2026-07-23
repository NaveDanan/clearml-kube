---
id: UX-23
title: "Harden responsive density and large-graph performance"
lane: "Cross-cutting hardening"
wave: 4
wave_name: "Parallel hardening"
complexity_points: 8
hard_dependencies: ["UX-06", "UX-07", "UX-08", "UX-09", "UX-10", "UX-11", "UX-12", "UX-14", "UX-15", "UX-16", "UX-17", "UX-18", "UX-19", "UX-20", "UX-21"]
parallel_wave_peers: ["UX-22"]
directly_blocks: ["UX-24"]
recommended_owner: "Responsive and performance specialist"
---

# UX-23: Harden responsive density and large-graph performance

## Outcome

Keep the polished editor usable across supported viewport widths and representative large graphs.

## Why this task exists

A UI that looks good only in one screenshot or becomes sluggish after a few nodes is still unusable.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Cross-cutting hardening.
- **Recommended owner:** Responsive and performance specialist.
- **Wave:** 4 — Parallel hardening.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Implement approved panel compact/drawer behavior and toolbar overflow at constrained widths.
- Verify node library full/condensed/compact modes and inspector minimum-width layouts.
- Prevent clipped forms, hidden primary actions, and page-level overflow.
- Profile node dragging, selection, pan/zoom, validation presentation, live status, search, and motion on representative graph sizes.
- Reduce unnecessary full-graph rerenders and expensive layout/animation work without changing graph semantics.
- Respect existing pagination/search boundaries for resource data.

## Out of scope

- Unsupported mobile-first redesign.
- Changing canonical state or validation behavior for performance shortcuts.
- Premature replacement of the canvas engine.

## Owned surfaces and contracts

- Responsive overrides and compact-mode integration.
- Performance fixes local to rendering, subscriptions, and presentation.
- Performance evidence and budgets from UX-05.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Responsive screenshots and interaction evidence at approved widths.
- Representative large-graph profile before/after.
- Resolved clipping/overflow/density defects.
- Performance-focused tests where practical.

## Parallelization and sequencing

### Must run after

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Primary actions remain reachable at all supported widths.
- Panels collapse or convert according to the contract without losing graph state.
- Inspector content remains scrollable and unclipped.
- Node dragging and pan/zoom remain responsive on the representative graph.
- Live status updates do not rerender unrelated nodes.
- No expensive animation runs on ordinary idle edges.

## Verification

- Run UX-04 journeys at each supported width.
- Profile the agreed small, medium, and large graph fixtures.
- Inspect render counts for node cards and resource search.
- Capture evidence for UX-24.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-24 locks responsive and performance-sensitive states into regression coverage.

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
