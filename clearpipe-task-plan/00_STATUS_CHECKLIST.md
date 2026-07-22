# ClearPipe task status checklist

Use one row per task. Keep the **Status** field to one of: `Not started`, `Ready`, `In progress`, `Blocked`, `In review`, or `Done`.

| Done | Task | Wave | Points | Owner | Status | Branch / PR | Blocker or handoff note |
|---|---|---:|---:|---|---|---|---|
| [ ] | [CP-01](./cp_01_discover-pipelines-architecture.md) | 0 | 5 |  | Not started |  |  |
| [ ] | [CP-02](./cp_02_audit-current-clearpipe.md) | 0 | 5 |  | Not started |  |  |
| [ ] | [CP-03](./cp_03_analyze-clearml-pipeline-semantics.md) | 0 | 5 |  | Not started |  |  |
| [x] | [CP-04](./cp_04_analyze-reference-ux.md) | 0 | 5 | cp-04-reference | Done | copilot/cp-04 | Merged 41a688a; evidence pack: CP-04_REFERENCE_UX.md |
| [ ] | [CP-05](./cp_05_architecture-decision-record.md) | 1 | 5 |  | Not started |  |  |
| [ ] | [CP-06](./cp_06_canonical-graph-schema.md) | 2 | 8 |  | Not started |  |  |
| [ ] | [CP-07](./cp_07_backend-integration-contracts.md) | 2 | 5 |  | Not started |  |  |
| [ ] | [CP-08](./cp_08_ux-architecture-contract.md) | 2 | 5 |  | Not started |  |  |
| [ ] | [CP-09](./cp_09_test-architecture-harness.md) | 2 | 5 |  | Not started |  |  |
| [ ] | [CP-10](./cp_10_graph-state-engine.md) | 3 | 8 |  | Not started |  |  |
| [ ] | [CP-11](./cp_11_validation-engine.md) | 3 | 8 |  | Not started |  |  |
| [ ] | [CP-12](./cp_12_task-code-generator.md) | 3 | 5 |  | Not started |  |  |
| [ ] | [CP-13](./cp_13_function-code-generator.md) | 3 | 5 |  | Not started |  |  |
| [ ] | [CP-14](./cp_14_service-adapters-route-integration.md) | 3 | 8 |  | Not started |  |  |
| [ ] | [CP-15](./cp_15_workspace-shell-first-use.md) | 3 | 5 |  | Not started |  |  |
| [ ] | [CP-16](./cp_16_canvas-foundation.md) | 4 | 8 |  | Not started |  |  |
| [ ] | [CP-17](./cp_17_generic-node-ui-framework.md) | 4 | 8 |  | Not started |  |  |
| [ ] | [CP-18](./cp_18_shared-resource-query-layer.md) | 4 | 5 |  | Not started |  |  |
| [ ] | [CP-19](./cp_19_persistence-lifecycle.md) | 4 | 8 |  | Not started |  |  |
| [ ] | [CP-20](./cp_20_port-edge-semantics.md) | 5 | 5 |  | Not started |  |  |
| [ ] | [CP-21](./cp_21_dataset-browser-integration.md) | 5 | 5 |  | Not started |  |  |
| [ ] | [CP-22](./cp_22_import-export-unsaved-guards.md) | 5 | 5 |  | Not started |  |  |
| [ ] | [CP-23](./cp_23_toolbar-code-preview.md) | 5 | 5 |  | Not started |  |  |
| [ ] | [CP-24](./cp_24_task-backed-authoring.md) | 6 | 8 |  | Not started |  |  |
| [ ] | [CP-25](./cp_25_code-backed-authoring.md) | 6 | 8 |  | Not started |  |  |
| [ ] | [CP-26](./cp_26_execution-integration.md) | 6 | 8 |  | Not started |  |  |
| [ ] | [CP-27](./cp_27_advanced-editor-operations.md) | 6 | 8 |  | Not started |  |  |
| [ ] | [CP-28](./cp_28_complete-task-vertical-slice.md) | 7 | 5 |  | Not started |  |  |
| [ ] | [CP-29](./cp_29_edit-existing-pipelines.md) | 7 | 8 |  | Not started |  |  |
| [ ] | [CP-30](./cp_30_accessibility-responsive-performance.md) | 8 | 8 |  | Not started |  |  |
| [ ] | [CP-31](./cp_31_automated-coverage-regression.md) | 8 | 8 |  | Not started |  |  |
| [ ] | [CP-32](./cp_32_final-integration-quality-report.md) | 9 | 5 |  | Not started |  |  |

## Gate checklist

- [ ] **Discovery gate:** CP-01, CP-02, CP-03, and CP-04 are complete.
- [ ] **Architecture gate:** CP-05 is approved.
- [ ] **Contract gate:** CP-06, CP-07, CP-08, and CP-09 expose stable interfaces.
- [ ] **Foundation gate:** CP-10 through CP-19 pass focused checks.
- [ ] **Feature gate:** CP-20 through CP-27 satisfy their supported subsets.
- [ ] **Integration gate:** CP-28 and CP-29 pass.
- [ ] **Hardening gate:** CP-30 and CP-31 pass.
- [ ] **Release gate:** CP-32 passes all required checks and publishes the final report.
