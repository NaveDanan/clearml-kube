---
id: UX-20
title: "Redesign execution status, logs, and result feedback"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 8
hard_dependencies: ["UX-09", "UX-10", "UX-11", "UX-12"]
parallel_wave_peers: ["UX-14", "UX-15", "UX-16", "UX-17", "UX-18", "UX-19", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Execution UX agent"
---

# UX-20: Redesign execution status, logs, and result feedback

## Outcome

Make submission, live progress, node state, failure location, logs, outputs, and handoff to `/pipelines` immediately understandable.

## Why this task exists

Execution feedback that is only a spinner or raw log dump leaves users unsure whether anything happened or what to do next.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Execution UX agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Map existing backend states to consistent pipeline-level and node-level visual states.
- Implement compact run/submission feedback in the toolbar and canvas.
- Add selected-node execution content to the inspector using real task/run links.
- Present logs with useful hierarchy, filtering or collapse where existing components support it, and clear loading/error states.
- Show results summary, outputs/artifacts/models/datasets, failure reason, timestamps, and next action.
- Animate only the active node/edge using UX-12.

## Out of scope

- Changing execution behavior, polling/subscription architecture, or `/pipelines` run history.
- Simulating statuses or success.
- Replacing full operational run details already owned by `/pipelines`.

## Owned surfaces and contracts

- Execution status presentation across node, toolbar, inspector, and concise result surface.
- Log/result visual composition.
- Run-detail navigation affordances.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Submission, queued, running, cached, completed, failed, aborted, skipped, and unknown-state presentations as supported.
- Node and pipeline result summaries.
- Log loading/error/empty states.
- Interaction and visual tests.

## Parallelization and sequencing

### Must run after

[UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Users can identify current pipeline state and active/failing node.
- Statuses reflect real data and use text/icon in addition to color.
- Failure feedback gives a next action or detail link.
- Duplicate run submissions are prevented visibly.
- The UI links to existing full run/task details.
- Motion stops when execution is no longer active.

## Verification

- Replay representative state fixtures from UX-13.
- Test state transitions and stale/out-of-order updates using existing test facilities.
- Verify links and no console errors.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-22 validates announcements, focus, and reduced motion. UX-23 validates update/render performance.

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
