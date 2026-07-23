---
id: UX-18
title: "Polish task, dataset, component, project, and queue selection UX"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 8
hard_dependencies: ["UX-07", "UX-10"]
parallel_wave_peers: ["UX-14", "UX-15", "UX-16", "UX-17", "UX-19", "UX-20", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Resource-selection frontend agent"
---

# UX-18: Polish task, dataset, component, project, and queue selection UX

## Outcome

Turn opaque ID fields and raw dropdowns into structured, searchable ClearML resource selection.

## Why this task exists

Users cannot configure pipelines efficiently when they must memorize IDs or distinguish same-named resources without context.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Resource-selection frontend agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Create reusable search/select surfaces over existing resource-query hooks and services.
- Support task, dataset/version, component/template, project, queue/agent, model/artifact, and other already-supported resource families.
- Show name, project, stable ID, type/status, tags, version, and update context where relevant.
- Implement debounced search, pagination/incremental loading, refresh, loading, empty, error/retry, stale selection, and permission states.
- Provide selected-value summaries that match node cards.
- Use existing detail links and permission rules.

## Out of scope

- New API clients, resource semantics, or permission bypass.
- Storing secrets or credentials.
- Changing the node library or inspector shell contracts.

## Owned surfaces and contracts

- Reusable resource search/selector/browser presentation.
- Search result row/card primitives.
- Selection loading/error/empty states.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Resource selectors for each existing supported family.
- Consistent result and selected-value presentation.
- Search, pagination, retry, and stale-selection coverage.
- Interaction tests.

## Parallelization and sequencing

### Must run after

[UX-07](./ux_07_node-library-user-store.md), [UX-10](./ux_10_inspector-shell.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Users can choose resources without pasting IDs.
- Same-named resources are distinguishable.
- Search does not fire on every keystroke without control.
- Large result sets do not freeze the inspector.
- Errors and permissions are actionable.
- Selected values remain readable in narrow inspector widths.

## Verification

- Test empty query, many results, no results, slow response, error, retry, permission denied, and stale selected ID.
- Verify use of existing query hooks and route helpers.
- Review card/selector terminology with UX-14 and UX-15.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-19 embeds selectors in type-specific forms. UX-23 checks performance and compact behavior.

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
