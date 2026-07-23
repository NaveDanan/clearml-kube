---
id: UX-14
title: "Implement task-backed and reusable-component node visuals"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 5
hard_dependencies: ["UX-07", "UX-09"]
parallel_wave_peers: ["UX-15", "UX-16", "UX-17", "UX-18", "UX-19", "UX-20", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Task authoring UI agent"
---

# UX-14: Implement task-backed and reusable-component node visuals

## Outcome

Make task-backed and reusable-component nodes easy to identify, scan, and distinguish from their runtime task instances.

## Why this task exists

Task identity, project context, queue, cache, inputs, outputs, and validation need a concise hierarchy rather than a generic card.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Task authoring UI agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Register task and reusable-component entries in the node library.
- Implement task-family card summaries using UX-09 slots.
- Show base task identity versus execution-created task state clearly.
- Present project/name, task type, queue override, cache state, configured bindings, and validation in a compact hierarchy.
- Provide source-resource action and unavailable/stale resource treatment.
- Use actual existing state and links; do not invent task metadata.

## Out of scope

- Changing task search, task semantics, execution, or graph schema.
- Forking the base node card.
- Adding inspector forms owned by UX-19.

## Owned surfaces and contracts

- Task/component library registrations.
- Task-family card summary renderer and icons/labels.
- Task-specific visual fixtures.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Configured, unconfigured, invalid, stale, running, completed, and failed task node states.
- Concise resource identity and source link.
- Registration and visual tests.

## Parallelization and sequencing

### Must run after

[UX-07](./ux_07_node-library-user-store.md), [UX-09](./ux_09_shared-node-card-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Users can tell the base task from a run-created task.
- Task nodes remain compact with long project and task names.
- Missing or inaccessible tasks have actionable non-color-only feedback.
- Queue/cache/binding summaries are readable but secondary.
- The implementation only extends UX-07 and UX-09 contracts.

## Verification

- Render representative task states in the fixture gallery.
- Test long names, missing permissions, many bindings, and active execution.
- Confirm links use existing route helpers.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-19 supplies task configuration forms. UX-20 supplies live execution details.

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
