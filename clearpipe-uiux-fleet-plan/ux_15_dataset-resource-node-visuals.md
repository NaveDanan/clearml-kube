---
id: UX-15
title: "Implement dataset and resource-node visuals"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 5
hard_dependencies: ["UX-07", "UX-09"]
parallel_wave_peers: ["UX-14", "UX-16", "UX-17", "UX-18", "UX-19", "UX-20", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Dataset/resource UI agent"
---

# UX-15: Implement dataset and resource-node visuals

## Outcome

Make ClearML datasets, versions, pipeline inputs, artifacts, models, and supported output resources visually understandable at graph scale.

## Why this task exists

Resource nodes often become oversized metadata dumps or ambiguous generic data boxes.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Dataset/resource UI agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Register supported data/resource entries in the node library.
- Implement compact card summaries for dataset identity, project, version, file count, tags, selected artifact/model/output, and availability.
- Differentiate input/source resources from produced outputs without relying only on color.
- Show stale, deleted, inaccessible, loading, and version-changed states.
- Provide existing resource-detail actions.
- Use actual supported resource kinds only.

## Out of scope

- Building the resource browser or query layer.
- Changing dataset semantics or adding unsupported resource types.
- Forking shared card or library primitives.

## Owned surfaces and contracts

- Dataset/resource library registrations.
- Resource-family card summary renderers.
- Resource visual fixtures.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Dataset/source/output card variants.
- Version and availability treatments.
- Registration and visual tests.

## Parallelization and sequencing

### Must run after

[UX-07](./ux_07_node-library-user-store.md), [UX-09](./ux_09_shared-node-card-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Dataset project, name, and version are distinguishable at a glance.
- Input versus produced output is clear without color alone.
- Unavailable resources remain understandable and actionable.
- Metadata does not overflow the card.
- Only real ClearML resource concepts are presented.

## Verification

- Test long project/dataset names, many tags, no version, deleted resource, and permission denied.
- Verify detail links and status labels.
- Review selector/card consistency with UX-18.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-18 owns resource selection and browsing. UX-19 owns resource configuration fields.

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
