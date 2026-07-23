---
id: UX-19
title: "Refactor inspector forms, progressive disclosure, and validation presentation"
lane: "Feature surface"
wave: 3
wave_name: "Parallel component polish"
complexity_points: 8
hard_dependencies: ["UX-10", "UX-12"]
parallel_wave_peers: ["UX-14", "UX-15", "UX-16", "UX-17", "UX-18", "UX-20", "UX-21"]
directly_blocks: ["UX-22", "UX-23", "UX-24"]
recommended_owner: "Forms and validation UX agent"
---

# UX-19: Refactor inspector forms, progressive disclosure, and validation presentation

## Outcome

Make node configuration understandable, efficient, and recoverable across task-, dataset-, and code-backed nodes.

## Why this task exists

Dense forms with weak grouping, hidden errors, and uncontrolled updates are a primary usability failure.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Feature surface.
- **Recommended owner:** Forms and validation UX agent.
- **Wave:** 3 — Parallel component polish.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Apply shared field layout, labels, helper text, required indicators, units, defaults, and section hierarchy.
- Move uncommon queue, caching, retry, package, callback, and advanced options behind progressive disclosure.
- Present field-, section-, node-, and graph-level validation consistently using existing diagnostics.
- Show upstream-output suggestions and binding context where already supported.
- Handle dirty/saving/update feedback without noisy per-keystroke toasts.
- Ensure type-specific forms use UX-18 selectors and UX-10 sections.

## Out of scope

- Changing validation rules, node schemas, or resource APIs.
- Creating new form/state infrastructure without evidence.
- Hiding required fields inside advanced sections.

## Owned surfaces and contracts

- Type-specific form composition and shared field treatments.
- Validation message presentation inside the inspector.
- Advanced disclosure behavior.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Refactored forms for all currently supported node families.
- Consistent validation and helper text.
- Progressive disclosure and binding suggestion patterns.
- Form interaction tests.

## Parallelization and sequencing

### Must run after

[UX-10](./ux_10_inspector-shell.md), [UX-12](./ux_12_motion-feedback-system.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-17](./ux_17_ports-edges-connection-ux.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-20](./ux_20_execution-status-logs-results.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md), [UX-24](./ux_24_visual-interaction-regression.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Required configuration is visible and ordered by user intent.
- Advanced settings do not dominate the primary flow.
- Each error states what is wrong and how to correct it.
- Errors are associated with the affected control.
- Changing one field does not reset unrelated values or selection.
- Forms remain usable at minimum inspector width.

## Verification

- Test pristine, partially configured, invalid, corrected, loading-selector, and read-only forms.
- Verify typing does not trigger global shortcuts.
- Review accessibility with UX-22.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-22 performs keyboard and screen-reader hardening. UX-23 checks compact layout and update performance.

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
