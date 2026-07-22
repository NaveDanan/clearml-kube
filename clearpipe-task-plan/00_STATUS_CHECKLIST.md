# ClearPipe task status checklist

Use one row per task. Keep the **Status** field to one of: `Not started`, `Ready`, `In progress`, `Blocked`, `In review`, or `Done`.

| Done | Task | Wave | Points | Owner | Status | Branch / PR | Blocker or handoff note |
|---|---|---:|---:|---|---|---|---|
| [x] | [CP-01](./cp_01_discover-pipelines-architecture.md) | 0 | 5 | cp-01-discovery | Done | 2a6c013 | Evidence pack: CP-01_PIPELINES_ARCHITECTURE.md |
| [x] | [CP-02](./cp_02_audit-current-clearpipe.md) | 0 | 5 | cp-02-audit | Done | bfc4ca6 | Evidence pack: CP-02_CLEARPIPE_AUDIT.md |
| [x] | [CP-03](./cp_03_analyze-clearml-pipeline-semantics.md) | 0 | 5 | cp-03-semantics | Done | ee0864c | Evidence pack and deterministic fixtures: CP-03_CLEARML_PIPELINE_SEMANTICS.md |
| [x] | [CP-04](./cp_04_analyze-reference-ux.md) | 0 | 5 | cp-04-reference | Done | copilot/cp-04 | Merged 41a688a; evidence pack: CP-04_REFERENCE_UX.md |
| [x] | [CP-05](./cp_05_architecture-decision-record.md) | 1 | 5 | cp-05-architecture | Done | eaf65cc | Approved ADR: CP-05_ARCHITECTURE_DECISION_RECORD.md |
| [x] | [CP-06](./cp_06_canonical-graph-schema.md) | 2 | 8 | cp-06-graph-contract | Done | d6f7d2e | Canonical v2 graph contract; focused parity and security fixes integrated. |
| [x] | [CP-07](./cp_07_backend-integration-contracts.md) | 2 | 5 | cp-07-backend-contract | Done | 0fdefec | Typed existing-service contract; safe v2 persistence and secret override rejection integrated. |
| [x] | [CP-08](./cp_08_ux-architecture-contract.md) | 2 | 5 | cp-08-ux-contract | Done | b8a2449 | UX architecture and slot/accessibility contract integrated. |
| [x] | [CP-09](./cp_09_test-architecture-harness.md) | 2 | 5 | cp-09-harness-resume | Done | 2efd5d7 | Dedicated harness; ClearPipe, `/pipelines`, server, and Redis-backed schema checks pass. |
| [x] | [CP-10](./cp_10_graph-state-engine.md) | 3 | 8 | cp-10-state-engine | Done | f64dcc1 | Canonical graph state engine with reviewed selected-port freshness and transactional transient rollback fixes integrated. |
| [x] | [CP-11](./cp_11_validation-engine.md) | 3 | 8 | cp-11-validation-engine | Done | b92afe9 | Deterministic validation/preflight engine with authorization and legacy-secret fixes integrated. |
| [x] | [CP-12](./cp_12_task-code-generator.md) | 3 | 5 | cp-12-task-generator | Done | 0994507 | Deterministic task compiler and resource source-map coverage integrated. |
| [x] | [CP-13](./cp_13_function-code-generator.md) | 3 | 5 | cp-13-function-generator | Done | 546746b | Deterministic function-step lowerer integrated. |
| [x] | [CP-14](./cp_14_service-adapters-route-integration.md) | 3 | 8 | cp-14-service-adapters | Done | 697f5d5 | Single typed platform adapter and guarded route handoffs integrated. |
| [x] | [CP-15](./cp_15_workspace-shell-first-use.md) | 3 | 5 | cp-15-workspace-shell | Done | c87f234 | Slot-based three-region workspace shell integrated. |
| [x] | [CP-16](./cp_16_canvas-foundation.md) | 4 | 8 | cp-16-canvas | Done | fab3dbb | Canonical canvas foundation integrated with zoom-safe drag, minimap mapping, and pointer-accessible keyboard controls. |
| [x] | [CP-17](./cp_17_generic-node-ui-framework.md) | 4 | 8 | cp-17-node-framework | Done | 99744f9 | Generic catalog, cards, ports, registry, and inspector framework integrated with isolated focused coverage. |
| [x] | [CP-18](./cp_18_shared-resource-query-layer.md) | 4 | 5 | cp-18-resource-queries | Done | b13bc8b | Authorized shared resource layer integrated with safe canonical inventory, local filtering, and retryable outage handling. |
| [x] | [CP-19](./cp_19_persistence-lifecycle.md) | 4 | 8 | cp-19-persistence-lifecycle | Done | 85f79f4 | Persistence lifecycle integrated with round-trip, CAS, read-only, and non-destructive Save As permission handling. |
| [x] | [CP-20](./cp_20_port-edge-semantics.md) | 5 | 5 | cp-20-port-edge-semantics | Done | 892fea3 | Canonical semantic edge compatibility, editing, and accessible feedback integrated. |
| [x] | [CP-21](./cp_21_dataset-browser-integration.md) | 5 | 5 | cp-21-dataset-browser | Done | fb42e53 | CP-18-backed dataset browser and safe artifact-binding handoff integrated. |
| [x] | [CP-22](./cp_22_import-export-unsaved-guards.md) | 5 | 5 | cp-22-import-export | Done | 99377c9 | Versioned safe transfer and unsaved-change guards integrated; unsupported generated source fails closed. |
| [x] | [CP-23](./cp_23_toolbar-code-preview.md) | 5 | 5 | cp-23-toolbar-preview | Done | 83963aa | Lifecycle toolbar and latest-wins read-only code preview integrated; unavailable compiler source fails closed. |
| [ ] | [CP-24](./cp_24_task-backed-authoring.md) | 6 | 8 | cp-24-task-authoring | Blocked | f16e63e | Authorized task metadata integrated; awaiting typed task configuration parity and generic extension-host composition. |
| [ ] | [CP-25](./cp_25_code-backed-authoring.md) | 6 | 8 | cp-25-function-authoring | Blocked | ebc65dd | Requires a current-base provider/create path, bound-port preservation, and typed function description/package/retry graph contracts. |
| [ ] | [CP-26](./cp_26_execution-integration.md) | 6 | 8 | cp-26-execution | Blocked | d5d11f1 | V2 server compilation/start, runtime-step source maps, and definition-scoped result lifecycle are required before execution UI can be accepted. |
| [ ] | [CP-27](./cp_27_advanced-editor-operations.md) | 6 | 8 | cp-27-advanced-editor | Blocked | 87129c2 | Awaiting graph-scoped atomic restore; history invalidation, clipboard closure, and dimension-aware layout remediation returned to owner. |
| [ ] | [CP-28](./cp_28_complete-task-vertical-slice.md) | 7 | 5 |  | Not started |  |  |
| [ ] | [CP-29](./cp_29_edit-existing-pipelines.md) | 7 | 8 |  | Not started |  |  |
| [ ] | [CP-30](./cp_30_accessibility-responsive-performance.md) | 8 | 8 |  | Not started |  |  |
| [ ] | [CP-31](./cp_31_automated-coverage-regression.md) | 8 | 8 |  | Not started |  |  |
| [ ] | [CP-32](./cp_32_final-integration-quality-report.md) | 9 | 5 |  | Not started |  |  |

## Gate checklist

- [x] **Discovery gate:** CP-01, CP-02, CP-03, and CP-04 are complete.
- [x] **Architecture gate:** CP-05 is approved.
- [x] **Contract gate:** CP-06, CP-07, CP-08, and CP-09 expose stable interfaces.
- [x] **Foundation gate:** CP-10 through CP-19 pass focused checks.
- [ ] **Feature gate:** CP-20 through CP-27 satisfy their supported subsets.
- [ ] **Integration gate:** CP-28 and CP-29 pass.
- [ ] **Hardening gate:** CP-30 and CP-31 pass.
- [ ] **Release gate:** CP-32 passes all required checks and publishes the final report.
