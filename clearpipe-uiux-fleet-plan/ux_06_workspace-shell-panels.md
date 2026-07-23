---
id: UX-06
title: "Rebuild the workspace shell and panel ergonomics"
lane: "Foundation implementation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 8
hard_dependencies: ["UX-05"]
parallel_wave_peers: ["UX-07", "UX-08", "UX-09", "UX-10", "UX-11", "UX-12", "UX-13"]
directly_blocks: ["UX-21", "UX-22", "UX-23"]
recommended_owner: "Workspace-shell frontend agent"
---

# UX-06: Rebuild the workspace shell and panel ergonomics

## Outcome

Make the editor shell stable, canvas-dominant, resizable, collapsible, and visually consistent with ClearML.

## Why this task exists

Poor panel geometry and route-level spacing can make every downstream component appear cramped or broken.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Foundation implementation.
- **Recommended owner:** Workspace-shell frontend agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Implement the approved three-region shell using existing ClearML layout primitives.
- Fix full-height sizing, overflow boundaries, independent panel scrolling, resize handles, collapse controls, and canvas expansion.
- Preserve selected node, scroll state where appropriate, and graph state when panels collapse.
- Provide clean collapsed affordances rather than unusable narrow content.
- Ensure panel widths and minimums follow UX-05 rather than reference hard-coded dimensions.
- Expose stable slots for library, canvas, inspector, toolbar, and optional lower/drawer surfaces.

## Out of scope

- Node-library content, node cards, inspector fields, toolbar content, or business logic.
- Adding a new layout/state system when the repository already has one.
- Persisting temporary panel state in the pipeline document.

## Owned surfaces and contracts

- Route-level editor frame.
- Left/right panel containers, resize handles, and collapse affordances.
- Workspace overflow and z-index boundaries.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A stable shell at approved desktop widths.
- Panel open, closed, resized, and restore states.
- Documented slots/interfaces for peer agents.
- Focused layout tests or stories.

## Parallelization and sequencing

### Must run after

[UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-21](./ux_21_overlays-empty-loading-error-unsaved.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- The canvas expands when either panel closes.
- No panel content is clipped or hidden behind the toolbar.
- The canvas, library, and inspector scroll independently as designed.
- Resizing does not select nodes, pan the canvas, or lose focus unexpectedly.
- No horizontal page-level scrollbar appears at supported widths.
- The shell uses only approved ClearML tokens and components.

## Verification

- Test both panels open, each panel closed, both closed, minimum/maximum widths, and a long inspector.
- Verify keyboard access to collapse controls and visible focus.
- Capture screenshots for UX-13 fixtures.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-21 adds overlays and empty/error states within the shell. UX-22 and UX-23 harden accessibility and responsive behavior.

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
