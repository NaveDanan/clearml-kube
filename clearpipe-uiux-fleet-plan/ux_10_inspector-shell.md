---
id: UX-10
title: "Build the inspector shell and configuration information hierarchy"
lane: "Foundation implementation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 8
hard_dependencies: ["UX-05"]
parallel_wave_peers: ["UX-06", "UX-07", "UX-08", "UX-09", "UX-11", "UX-12", "UX-13"]
directly_blocks: ["UX-18", "UX-19", "UX-20", "UX-21", "UX-22", "UX-23"]
recommended_owner: "Inspector-shell frontend agent"
---

# UX-10: Build the inspector shell and configuration information hierarchy

## Outcome

Create a stable right-side inspector that supports contextual configuration without overwhelming the canvas.

## Why this task exists

A giant undifferentiated form is one of the most common causes of unusable visual editors.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Foundation implementation.
- **Recommended owner:** Inspector-shell frontend agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Implement selected-node header, resource identity, validation summary, close/collapse behavior, and scroll boundaries.
- Define tabs or sections for Configuration, General, and execution/log content according to UX-05.
- Create reusable section headers, field groups, inline help, advanced disclosure, sticky action/status regions, and empty selection state.
- Preserve selection and user context across non-destructive updates.
- Provide extension slots for resource selectors, type-specific forms, validation, and execution content.

## Out of scope

- Type-specific field implementation, resource queries, execution data, or validation logic.
- Duplicating node state inside inspector-local state except transient form state.
- Using route navigation for ordinary node configuration.

## Owned surfaces and contracts

- Inspector shell, header, tab/section navigation, scroll/focus behavior.
- Shared section and field-layout primitives.
- Inspector extension contract.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Inspector shell with no selection and representative selected-node fixtures.
- Reusable section primitives and extension API.
- Stable focus behavior when opening, closing, and switching nodes.
- Interaction tests for selection, tabs, scrolling, and collapse.

## Parallelization and sequencing

### Must run after

[UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Selecting a node opens the correct inspector without navigating away.
- The node identity and validation state stay visible and understandable.
- Long forms scroll inside the inspector, not the page.
- Advanced options are collapsed by default unless required.
- Switching nodes does not show stale fields from the previous node.
- Closing the inspector returns focus predictably.

## Verification

- Test no selection, rapid node switching, long forms, validation errors, and running state.
- Verify tab order and Escape behavior with UX-22.
- Capture inspector fixtures for UX-13.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-18 adds resource-selection surfaces. UX-19 adds forms and validation. UX-20 adds execution content.

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
