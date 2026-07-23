---
id: UX-08
title: "Polish the canvas surface, viewport controls, minimap, and first empty state"
lane: "Foundation implementation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 8
hard_dependencies: ["UX-05"]
parallel_wave_peers: ["UX-06", "UX-07", "UX-09", "UX-10", "UX-11", "UX-12", "UX-13"]
directly_blocks: ["UX-17", "UX-21", "UX-22", "UX-23"]
recommended_owner: "Canvas-surface frontend agent"
---

# UX-08: Polish the canvas surface, viewport controls, minimap, and first empty state

## Outcome

Make the graph canvas feel like a specialized ClearML authoring surface rather than a raw diagramming area.

## Why this task exists

Canvas background, controls, empty-state guidance, zoom feedback, and viewport behavior establish orientation and trust before any node is configured.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Foundation implementation.
- **Recommended owner:** Canvas-surface frontend agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Apply the approved neutral canvas surface, subtle grid/dot treatment, and theme-aware contrast.
- Place zoom, fit, minimap, layout, and other existing controls without covering graph content.
- Improve control hit areas, tooltips, active/disabled states, and ClearML styling.
- Create an intentional empty canvas state with one primary action and clear alternatives.
- Improve zoom feedback and fit-to-view behavior using existing canvas APIs.
- Define safe overlay zones for toolbar, notices, connection hints, and run feedback.

## Out of scope

- Changing graph commands, connection validation, node cards, or toolbar actions.
- Adding decorative effects that reduce graph legibility.
- Replacing a working canvas engine.

## Owned surfaces and contracts

- Canvas surface and background.
- Viewport/minimap controls and placement.
- Empty-canvas content region.
- Canvas overlay positioning contract.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Styled canvas in all supported themes.
- Clear, non-overlapping controls and minimap.
- An actionable first-use empty state.
- Focused tests/stories for empty, populated, zoomed, and minimized views.

## Parallelization and sequencing

### Must run after

[UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-17](./ux_17_ports-edges-connection-ux.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- The grid remains subtle at normal and low zoom.
- Controls are understandable without relying on icon shape alone.
- The minimap is legible but does not dominate the workspace.
- The empty state explains how to add the first node and offers a primary action.
- Fit-to-view leaves useful padding around the graph.
- No control overlaps the toolbar, panels, or selected nodes at supported widths.

## Verification

- Test empty, small, and large graphs at minimum and maximum zoom.
- Verify control keyboard focus and tooltip content.
- Capture theme and viewport baselines for UX-13.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-17 adds semantic ports and edges. UX-21 adds error/read-only overlays within the reserved zones.

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
