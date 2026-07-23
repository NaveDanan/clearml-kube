---
id: UX-22
title: "Harden accessibility, keyboard workflows, focus, and reduced motion"
lane: "Cross-cutting hardening"
wave: 4
wave_name: "Parallel hardening"
complexity_points: 8
hard_dependencies: ["UX-06", "UX-07", "UX-08", "UX-09", "UX-10", "UX-11", "UX-12", "UX-14", "UX-15", "UX-16", "UX-17", "UX-18", "UX-19", "UX-20", "UX-21"]
parallel_wave_peers: ["UX-23"]
directly_blocks: ["UX-24"]
recommended_owner: "Accessibility specialist"
---

# UX-22: Harden accessibility, keyboard workflows, focus, and reduced motion

## Outcome

Ensure the completed editor can be operated and understood without relying on precise dragging, color, or unrestricted motion.

## Why this task exists

Accessibility must validate the integrated interactions; isolated component conformance is insufficient for a canvas editor.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Cross-cutting hardening.
- **Recommended owner:** Accessibility specialist.
- **Wave:** 4 — Parallel hardening.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Audit semantic controls, accessible names, form labels, descriptions, status announcements, contrast, focus visibility, and tab order.
- Verify shortcuts do not fire while typing or while a dialog/menu owns focus.
- Provide non-drag methods to add nodes and complete supported connection operations.
- Verify node action menus, panel controls, toolbar, selectors, inspector, dialogs, and canvas controls by keyboard.
- Implement predictable Escape layering and focus return.
- Verify reduced-motion behavior for panels, nodes, edges, menus, validation, and execution.

## Out of scope

- Changing domain behavior.
- Claiming full screen-reader graph manipulation when the underlying canvas cannot support it; document exact limitations instead.
- Hiding inaccessible functionality without an alternative.

## Owned surfaces and contracts

- Cross-component accessibility fixes and tests.
- Keyboard shortcut help/reference presentation if needed.
- Reduced-motion conformance review.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Accessibility defect list resolved or concretely documented.
- Keyboard journey tests.
- Contrast/focus/reduced-motion evidence.
- A concise remaining limitation statement.

## Parallelization and sequencing

### Must run after

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-23](./ux_23_responsive-density-performance.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- All toolbar, panel, library, inspector, selector, menu, and dialog controls are keyboard reachable.
- Drag-only node insertion has an equivalent path.
- Status and errors do not rely on color alone.
- Focus is never lost behind an overlay or collapsed panel.
- Shortcuts are suppressed in editable controls and modal contexts.
- Reduced-motion mode removes non-essential movement.

## Verification

- Run automated accessibility checks already supported by the repository.
- Complete UX-04 journeys with keyboard only where supported.
- Test screen-reader announcements for save, validation, run submission, and failure.
- Test high zoom or browser text scaling if part of product support.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-24 adds regression coverage. UX-25 reviews any documented limitation.

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
