---
id: UX-16
title: "Implement code, function, and pipeline I/O node visuals"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 5
hard_dependencies: ["UX-07", "UX-09"]
parallel_wave_peers: ["UX-14", "UX-15", "UX-17", "UX-18", "UX-19", "UX-20", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Code-authoring UI agent"
---

# UX-16: Implement code, function, and pipeline I/O node visuals

## Outcome

Give code/function components and pipeline input/output nodes a clear, compact representation aligned with generated-code authoring.

## Why this task exists

Code nodes need to expose function identity, input/output shape, package or source warnings, and generation state without becoming mini editors.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Code-authoring UI agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Register supported function/component and pipeline I/O entries in the node library.
- Implement card summaries for function/component name, source identity, input/output counts, task type, queue/cache, and generation validation.
- Represent multiple outputs and missing declarations clearly.
- Show generated-code errors or unsupported constructs succinctly.
- Provide a code-preview action through existing UI contracts.

## Out of scope

- Embedding editable source code in node cards.
- Changing code generation or parsing.
- Creating unsupported arbitrary-code import claims.

## Owned surfaces and contracts

- Code/function/I/O library registrations.
- Code-family card summaries and fixtures.
- Code-preview action presentation at node level.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Function/component, pipeline parameter/input, and output variants supported by the repository.
- Multiple-output and generation-error states.
- Registration and visual tests.

## Parallelization and sequencing

### Must run after

[UX-07](./ux_07_node-library-user-store.md), [UX-09](./ux_09_shared-node-card-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-19](./ux_19_inspector-forms-validation.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Function identity and input/output shape are understandable without opening the inspector.
- Multiple outputs remain scannable.
- Unsupported or invalid generation states are explicit.
- Cards never become source-code editors.
- The implementation uses the shared card/library contracts.

## Verification

- Test no inputs, many inputs, multiple outputs, long function names, missing source, and generation error.
- Confirm code-preview action routes to the existing preview surface.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-19 owns code configuration forms. UX-20 owns execution status.

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
