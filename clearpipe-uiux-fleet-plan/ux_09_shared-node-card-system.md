---
id: UX-09
title: "Create the shared ClearML node-card visual system"
lane: "Foundation implementation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 8
hard_dependencies: ["UX-05"]
parallel_wave_peers: ["UX-06", "UX-07", "UX-08", "UX-10", "UX-11", "UX-12", "UX-13"]
directly_blocks: ["UX-14", "UX-15", "UX-16", "UX-17", "UX-20", "UX-22", "UX-23"]
recommended_owner: "Node-rendering frontend agent"
---

# UX-09: Create the shared ClearML node-card visual system

## Outcome

Provide one compact, scannable, extensible node-card shell for every ClearPipe node family.

## Why this task exists

Independent bespoke cards create inconsistent density, hidden state, oversized forms, and merge conflicts.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Foundation implementation.
- **Recommended owner:** Node-rendering frontend agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Implement the approved card anatomy: header identity, concise summary slots, status and validation, ports region, selection treatment, and contextual actions.
- Create typed extension slots for node-family summaries without allowing full forms in cards.
- Define density behavior across normal and lower zoom.
- Use non-color status cues, truncation/tooltip rules, and stable dimensions.
- Make configure, duplicate, delete, and resource-link actions discoverable without permanent clutter.
- Ensure rendering is memoization-friendly and does not subscribe to unrelated global state.

## Out of scope

- Node-family-specific content beyond example fixtures.
- Inspector forms or resource selectors.
- Changing graph data structures or business status models.

## Owned surfaces and contracts

- Base node-card shell and shared subcomponents.
- Card sizing, typography, spacing, selected/focus/hover states.
- Node action-menu presentation.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Shared node-card API and visual states.
- Fixture cards for unconfigured, valid, warning, invalid, queued, running, completed, failed, disabled, and unavailable.
- A registration guide for UX-14 through UX-16.
- Rendering and interaction tests.

## Parallelization and sequencing

### Must run after

[UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Users can identify node name, kind, status, validation state, and main configuration at a glance.
- Cards do not contain full forms or advanced settings.
- Selected, focused, hovered, invalid, and running states remain distinct without color alone.
- Long names and metadata do not break card dimensions.
- Card actions are keyboard accessible and do not start node dragging.
- The base card has no resource-family-specific branching.

## Verification

- Render all state fixtures under each supported theme.
- Test long labels, no description, many ports, and missing resource states.
- Profile a representative graph to ensure unrelated node updates do not rerender all cards.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-14 through UX-16 own only their summary and icon/category registrations. UX-17 owns port and edge visuals.

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
