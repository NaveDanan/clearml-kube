---
id: UX-17
title: "Redesign ports, edges, connection feedback, and graph motion"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 8
hard_dependencies: ["UX-08", "UX-09", "UX-12"]
parallel_wave_peers: ["UX-14", "UX-15", "UX-16", "UX-18", "UX-19", "UX-20", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Graph interaction specialist"
---

# UX-17: Redesign ports, edges, connection feedback, and graph motion

## Outcome

Make semantic connections easy to create, inspect, repair, and distinguish without turning the canvas into visual noise.

## Why this task exists

Tiny unlabeled handles, indistinguishable edges, and always-on animation make pipelines impossible to understand.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Graph interaction specialist.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Implement visible input/output port positioning, labels, hit targets, connected/required states, and compatibility highlighting.
- Style supported edge semantics with restrained line, marker, label, and selection treatments.
- Improve connection preview, valid/invalid feedback, reconnect, select, context actions, and deletion affordances.
- Display concise rejection reasons near the interaction or through the approved feedback surface.
- Use animation only for connection preview and real active execution.
- Keep edge labels and paths legible at normal and lower zoom.

## Out of scope

- Changing connection validation or graph semantics.
- Inventing new edge types not supported by the canonical model.
- Animating every edge.

## Owned surfaces and contracts

- Port and handle visuals.
- Edge renderers and connection interaction feedback.
- Edge-specific menus/labels in coordination with UX-21.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Port states and semantic edge variants.
- Connection preview and invalid-reason feedback.
- Reconnect/delete/select behavior polish.
- Active-execution animation using UX-12.
- Interaction and visual tests.

## Parallelization and sequencing

### Must run after

[UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-12](./ux_12_motion-feedback-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Compatible targets are obvious during a connection drag.
- Invalid targets are rejected with an understandable reason.
- Ports have usable pointer targets without appearing oversized.
- Selected edges and active execution are distinct from ordinary edges.
- Static graphs are visually calm.
- Edge interaction remains usable at approved zoom levels.

## Verification

- Test compatible, incompatible, self, duplicate, cycle, reconnect, and delete flows using existing validation.
- Run with reduced motion.
- Profile a representative large graph.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-22 audits keyboard and non-drag alternatives. UX-23 audits large-graph performance and density.

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
