---
id: UX-05
title: "Freeze the ClearPipe UI/UX contract and fleet ownership map"
lane: "Convergence gate"
wave: 1
wave_name: "Sequential design gate"
complexity_points: 5
hard_dependencies: ["UX-01", "UX-02", "UX-03", "UX-04"]
parallel_wave_peers: []
directly_blocks: ["UX-06", "UX-07", "UX-08", "UX-09", "UX-10", "UX-11", "UX-12", "UX-13"]
recommended_owner: "Lead UI/UX implementation agent"
---

# UX-05: Freeze the ClearPipe UI/UX contract and fleet ownership map

## Outcome

Create one binding visual, interaction, motion, and ownership contract before the implementation fleet fans out.

## Why this task exists

The next wave edits adjacent surfaces. Without a frozen shell geometry, token map, component API, motion policy, and file ownership map, parallel work will produce another inconsistent UI.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Convergence gate.
- **Recommended owner:** Lead UI/UX implementation agent.
- **Wave:** 1 — Sequential design gate.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Reconcile the current audit, reference findings, ClearML design system, and journey scorecard.
- Define the three-region workspace geometry, panel behavior, canvas dominance, toolbar hierarchy, node-library information architecture, node-card anatomy, inspector structure, port/edge semantics, and overlay conventions.
- Define compact, condensed, and full density rules for the node library and editor.
- Define motion tokens, active-execution animation policy, reduced-motion behavior, and maximum acceptable visual noise.
- Assign one owner to every shared component, registry, style module, and integration file.
- Publish approved before/after target sketches or annotated wireframes using existing repository conventions.

## Out of scope

- Broad implementation.
- Reopening graph, backend, or execution architecture that is already complete.
- Allowing feature agents to invent local variants of shared primitives.

## Owned surfaces and contracts

- The binding UI/UX contract.
- Shared file and component ownership.
- The final wave/dependency map.
- The visual acceptance scorecard.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- `UIUX_CONTRACT.md` in the target repository with exact paths and decisions.
- An ownership table for shell, library, canvas, base node, inspector, toolbar, motion, overlays, and tests.
- Annotated target states for empty, configured, invalid, running, failed, and read-only editor states.
- A motion and accessibility policy.
- A merge-conflict and registration strategy for variant agents.

## Parallelization and sequencing

### Must run after

[UX-01](./ux_01_audit-current-clearpipe-ui.md), [UX-02](./ux_02_study-reference-node-library.md), [UX-03](./ux_03_inventory-clearml-design-system.md), [UX-04](./ux_04_define-usability-journeys.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

None.

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-06](./ux_06_workspace-shell-panels.md), [UX-07](./ux_07_node-library-user-store.md), [UX-08](./ux_08_canvas-surface-controls.md), [UX-09](./ux_09_shared-node-card-system.md), [UX-10](./ux_10_inspector-shell.md), [UX-11](./ux_11_toolbar-action-hierarchy.md), [UX-12](./ux_12_motion-feedback-system.md), [UX-13](./ux_13_visual-fixture-harness.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- Every foundation task can implement without making a new cross-cutting design decision.
- ClearML tokens and components are named by exact path.
- The node library is resource-backed and uses canonical graph creation commands.
- Node cards contain summaries, not full forms.
- Only meaningful active states animate; reduced motion is defined.
- Each shared file has one owner.

## Verification

- Run a contract review with owners of UX-06 through UX-13.
- Check that all UX-01 P0/P1 defects have an owning downstream task.
- Validate the contract against the core journeys from UX-04.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-06 through UX-13 implement independent foundations. The lead agent owns changes to this contract.

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
