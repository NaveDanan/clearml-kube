---
id: UX-03
title: "Inventory ClearML design tokens, components, and interaction conventions"
lane: "Design-system discovery"
wave: 0
wave_name: "Parallel UI evidence"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["UX-01", "UX-02", "UX-04"]
directly_blocks: ["UX-05"]
recommended_owner: "Frontend design-system specialist"
---

# UX-03: Inventory ClearML design tokens, components, and interaction conventions

## Outcome

Create an exact map of the target repository’s ClearML visual language so all fleet agents use one existing system rather than inventing local styles.

## Why this task exists

The reference is only a behavioral guide. ClearML typography, spacing, color, elevation, icons, forms, menus, tables, dialogs, status treatments, and responsive conventions are the visual source of truth.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Design-system discovery.
- **Recommended owner:** Frontend design-system specialist.
- **Wave:** 0 — Parallel UI evidence.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Find the actual token, theme, typography, icon, spacing, radius, elevation, focus, status, and motion definitions.
- Inspect `/pipelines` and two other dense ClearML workspaces for shell, toolbar, panel, form, table, loading, error, and empty-state patterns.
- Identify reusable components for buttons, icon buttons, inputs, selects, search, tabs, accordions, drawers, tooltips, menus, dialogs, toasts, skeletons, badges, and status indicators.
- Record light/dark or theme variants actually supported by the repository.
- Identify deprecated components and styling escape hatches that should not be used.

## Out of scope

- Creating a new design system or parallel theme.
- Introducing raw colors where semantic tokens exist.
- Changing global tokens before UX-05 approves a narrowly scoped need.

## Owned surfaces and contracts

- Design-system inventory and approved-use examples.
- Token-to-purpose mapping used by all UI tasks.
- Reusable component decision table.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Exact repository paths for tokens and reusable components.
- A ClearML editor style map covering shell, surface, node, port, edge, status, form, overlay, focus, and motion roles.
- A do-use/do-not-use component list.
- A list of gaps that require a local ClearPipe component rather than a global design-system change.

## Parallelization and sequencing

### Must run after

None.

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-01](./ux_01_audit-current-clearpipe-ui.md), [UX-02](./ux_02_study-reference-node-library.md), [UX-04](./ux_04_define-usability-journeys.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-05](./ux_05_freeze-uiux-contract.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Every major visual role has an existing token or an explicitly documented gap.
- Examples come from current ClearML product surfaces, not only design files.
- The inventory includes accessible focus and error treatments.
- Agents can implement without guessing raw colors, typography, spacing, or icon conventions.
- No new global token is proposed without a verified cross-product need.

## Verification

- Open each referenced component or token path.
- Confirm examples render under all supported themes.
- Review with UX-05 before any foundation task starts.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-05 converts the inventory into the binding ClearPipe visual contract. All implementation agents must reference that contract.

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
