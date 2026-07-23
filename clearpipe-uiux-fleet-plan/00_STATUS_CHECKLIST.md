# ClearPipe UI/UX fleet status checklist

Update this file after assignment, handoff, merge, and regression review.

## Status meanings

- `[ ]` Not started
- `[~]` In progress
- `[B]` Blocked
- `[R]` Ready for review
- `[x]` Merged and verified

## Fleet board

| Done | Task | Packet | Wave | Dependencies | Owner | Branch/worktree | PR | Blocker or latest result |
|---|---|---|---:|---|---|---|---|---|
| [ ] | UX-01 | [Audit the current ClearPipe UI and capture the unusable states](./ux_01_audit-current-clearpipe-ui.md) | 0 | — |  |  |  |  |
| [ ] | UX-02 | [Extract the reference node-library and editor interaction patterns](./ux_02_study-reference-node-library.md) | 0 | — |  |  |  |  |
| [ ] | UX-03 | [Inventory ClearML design tokens, components, and interaction conventions](./ux_03_inventory-clearml-design-system.md) | 0 | — |  |  |  |  |
| [ ] | UX-04 | [Define the usability journeys and measurable UI acceptance baseline](./ux_04_define-usability-journeys.md) | 0 | — |  |  |  |  |
| [ ] | UX-05 | [Freeze the ClearPipe UI/UX contract and fleet ownership map](./ux_05_freeze-uiux-contract.md) | 1 | UX-01, UX-02, UX-03, UX-04 |  |  |  |  |
| [ ] | UX-06 | [Rebuild the workspace shell and panel ergonomics](./ux_06_workspace-shell-panels.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-07 | [Implement the ClearML node library and user-facing node store](./ux_07_node-library-user-store.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-08 | [Polish the canvas surface, viewport controls, minimap, and first empty state](./ux_08_canvas-surface-controls.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-09 | [Create the shared ClearML node-card visual system](./ux_09_shared-node-card-system.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-10 | [Build the inspector shell and configuration information hierarchy](./ux_10_inspector-shell.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-11 | [Redesign the pipeline toolbar and action hierarchy](./ux_11_toolbar-action-hierarchy.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-12 | [Define and implement purposeful motion and interaction feedback](./ux_12_motion-feedback-system.md) | 2 | UX-05 |  |  |  |  |
| [ ] | UX-13 | [Create the UI fixture gallery and screenshot baseline harness](./ux_13_visual-fixture-harness.md) | 2 | UX-01, UX-05 |  |  |  |  |
| [ ] | UX-14 | [Implement task-backed and reusable-component node visuals](./ux_14_task-component-node-visuals.md) | 3 | UX-07, UX-09 |  |  |  |  |
| [ ] | UX-15 | [Implement dataset and resource-node visuals](./ux_15_dataset-resource-node-visuals.md) | 3 | UX-07, UX-09 |  |  |  |  |
| [ ] | UX-16 | [Implement code, function, and pipeline I/O node visuals](./ux_16_code-function-node-visuals.md) | 3 | UX-07, UX-09 |  |  |  |  |
| [ ] | UX-17 | [Redesign ports, edges, connection feedback, and graph motion](./ux_17_ports-edges-connection-ux.md) | 3 | UX-08, UX-09, UX-12 |  |  |  |  |
| [ ] | UX-18 | [Polish task, dataset, component, project, and queue selection UX](./ux_18_resource-search-selector-browser.md) | 3 | UX-07, UX-10 |  |  |  |  |
| [ ] | UX-19 | [Refactor inspector forms, progressive disclosure, and validation presentation](./ux_19_inspector-forms-validation.md) | 3 | UX-10, UX-12 |  |  |  |  |
| [ ] | UX-20 | [Redesign execution status, logs, and result feedback](./ux_20_execution-status-logs-results.md) | 3 | UX-09, UX-10, UX-11, UX-12 |  |  |  |  |
| [ ] | UX-21 | [Unify dialogs, menus, toasts, empty/loading/error, read-only, and unsaved states](./ux_21_overlays-empty-loading-error-unsaved.md) | 3 | UX-06, UX-07, UX-08, UX-10, UX-11, UX-12 |  |  |  |  |
| [ ] | UX-22 | [Harden accessibility, keyboard workflows, focus, and reduced motion](./ux_22_accessibility-keyboard-reduced-motion.md) | 4 | UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12, UX-14, UX-15, UX-16, UX-17, UX-18, UX-19, UX-20, UX-21 |  |  |  |  |
| [ ] | UX-23 | [Harden responsive density and large-graph performance](./ux_23_responsive-density-performance.md) | 4 | UX-06, UX-07, UX-08, UX-09, UX-10, UX-11, UX-12, UX-14, UX-15, UX-16, UX-17, UX-18, UX-19, UX-20, UX-21 |  |  |  |  |
| [ ] | UX-24 | [Complete automated visual and interaction regression coverage](./ux_24_visual-interaction-regression.md) | 5 | UX-13, UX-14, UX-15, UX-16, UX-17, UX-18, UX-19, UX-20, UX-21, UX-22, UX-23 |  |  |  |  |
| [ ] | UX-25 | [Run the final UI/UX integration, usability, and completion gate](./ux_25_final-uiux-integration-gate.md) | 6 | UX-04, UX-24 |  |  |  |  |

## Supplemental deployment tasks

| Done | Task | Packet | Lane | Dependencies | Owner | Branch/worktree | PR | Blocker or latest result |
|---|---|---|---|---|---|---|---|---|
| [ ] | AUTH-01 | [Switch ClearML from name-only to password login](./auth_01_switch-to-password-login.md) | Deployment authentication | — |  |  |  | Discovery complete: `apiserver.auth.fixed_users.enabled` selects password mode; pending live deployment/config verification. |

## Wave exit checklist

### Wave 0 — evidence

- [ ] Current UI screenshot baseline exists.
- [ ] Reference node-library findings are complete.
- [ ] ClearML design-system paths are verified.
- [ ] Core journey scorecard is dry-run against the current UI.

### Wave 1 — contract

- [ ] `UIUX_CONTRACT.md` is approved.
- [ ] Shared file ownership is recorded.
- [ ] All P0/P1 defects have downstream owners.
- [ ] Motion, density, responsive, and accessibility rules are frozen.

### Wave 2 — foundations

- [ ] Shell/panels
- [ ] Node Library
- [ ] Canvas surface/controls
- [ ] Base node card
- [ ] Inspector shell
- [ ] Toolbar
- [ ] Motion system
- [ ] Fixture/screenshot harness

### Wave 3 — component polish

- [ ] Task/component nodes
- [ ] Dataset/resource nodes
- [ ] Code/function/I/O nodes
- [ ] Ports/edges
- [ ] Resource selectors
- [ ] Inspector forms/validation
- [ ] Execution feedback
- [ ] Overlays and all non-happy-path states

### Wave 4 — hardening

- [ ] Keyboard/accessibility/reduced motion
- [ ] Responsive density/performance

### Wave 5 — regression

- [ ] Visual baselines reviewed.
- [ ] Interaction suite passes twice.
- [ ] `/pipelines` integration checks pass.
- [ ] No unowned test failure remains.

### Wave 6 — completion

- [ ] UX-04 manual script passes.
- [ ] No P0/P1 defect remains.
- [ ] Before/after evidence is complete.
- [ ] Tests, lint, type/static checks, build, and runtime-console review pass.
- [ ] Remaining limitations are concrete and verified.
