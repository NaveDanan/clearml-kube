---
id: UX-07
title: "Implement the ClearML node library and user-facing node store"
lane: "Foundation implementation"
wave: 2
wave_name: "Parallel UI foundations"
complexity_points: 8
hard_dependencies: ["UX-05"]
parallel_wave_peers: ["UX-06", "UX-08", "UX-09", "UX-10", "UX-11", "UX-12", "UX-13"]
directly_blocks: ["UX-14", "UX-15", "UX-16", "UX-18", "UX-21", "UX-22", "UX-23"]
recommended_owner: "Node-library frontend agent"
---

# UX-07: Implement the ClearML node library and user-facing node store

## Outcome

Deliver a searchable, categorized, permission-aware node library that feels like the reference node store while using real ClearML concepts, resources, and visual language.

## Why this task exists

Node discovery is the editor’s front door. A static list of oversized or fake cards makes the product unusable even when the graph engine works.

## Sizing and ownership

- **Relative complexity:** 8 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Foundation implementation.
- **Recommended owner:** Node-library frontend agent.
- **Wave:** 2 — Parallel UI foundations.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Create a data-driven library adapter over the existing canonical node factories and graph commands.
- Define entry metadata for stable key, node kind, category, label, description, icon role, keywords, availability, permission state, port preview, and insertion action.
- Support static creation types and dynamic real-resource results without duplicating graph defaults.
- Provide search, categories, recent or saved presets only when backed by an approved preference/service, loading, empty, error, disabled, and permission states.
- Support drag-to-add, click-to-add, and keyboard insertion.
- Implement compact, condensed, and full presentation modes driven by actual panel width.
- Use ClearML terminology and subtle category accents rather than reference colors.

## Out of scope

- Owning pipeline domain state or copying default node configuration into the UI registry.
- Fake generic node types, unsupported cloud concepts, or local-only production resources.
- A separate node-state store that competes with the existing graph state.
- Persisting favorites or presets without an approved persistence boundary.

## Owned surfaces and contracts

- Node-library container, search, grouping, entry shell, and insertion adapter.
- UI catalog registration interface.
- Library-only preference state such as open categories, when allowed.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A reusable node-library component and registration contract.
- Full/condensed/compact entry renderers.
- Accessible drag, click, and keyboard insertion.
- Loading, no-results, permission, and disabled explanations.
- Unit/interaction coverage for search, grouping, modes, and insertion.

## Parallelization and sequencing

### Must run after

[UX-05](./ux_05_freeze-uiux-contract.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-06](./ux_06_workspace-shell-panels.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-14](./ux_14_task-component-node-visuals.md), [UX-15](./ux_15_dataset-resource-node-visuals.md), [UX-16](./ux_16_code-function-node-visuals.md), [UX-18](./ux_18_resource-search-selector-browser.md), [UX-21](./ux_21_overlays-empty-loading-error-unsaved.md), [UX-22](./ux_22_accessibility-keyboard-reduced-motion.md), [UX-23](./ux_23_responsive-density-performance.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- A user can find and add a valid node without knowing an ID.
- The library remains usable at all approved panel widths.
- Dynamic entries show enough project/resource context to disambiguate names.
- Disabled entries explain the exact reason.
- Adding a node calls the canonical graph creation command exactly once.
- No node defaults are duplicated between catalog and graph factory.
- Search and category changes do not rerender the full graph unnecessarily.

## Verification

- Test at least one static type and each supported dynamic resource family.
- Verify drag, click, and keyboard insertion produce equivalent graph nodes.
- Test no results, API error, permission denied, and narrow-panel modes.
- Review variant registration with UX-14 through UX-16.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-14 through UX-16 register node families. UX-18 supplies rich resource selectors without changing the library contract.

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
