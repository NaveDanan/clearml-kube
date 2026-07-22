---
id: CP-23
title: "Implement the pipeline toolbar and synchronized code preview"
lane: "Editor lifecycle UI"
wave: 5
wave_name: "Parallel semantic and lifecycle surfaces"
complexity_points: 5
hard_dependencies: ["CP-11", "CP-12", "CP-13", "CP-15", "CP-19"]
parallel_wave_peers: ["CP-20", "CP-21", "CP-22"]
directly_blocks: ["CP-26", "CP-28", "CP-30", "CP-31"]
---

# CP-23: Implement the pipeline toolbar and synchronized code preview

## Outcome

Expose real high-frequency lifecycle actions and a read-only graph-driven code view without overcrowding the canvas or creating an independent source of truth.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Editor lifecycle UI.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 5 — Parallel semantic and lifecycle surfaces.

## Requirement areas covered

- Toolbar
- Code preview
- Action gating
- Responsive overflow

## In scope

- Implement pipeline name, saved state, New, Save, Open, Validate, Import, Export, Code Preview, Run hook, and More/Settings actions.
- Provide actionable disabled reasons for validation, permissions, missing references, queues, unsupported state, or save requirements.
- Implement syntax highlighting, copy, download, regeneration status, diagnostics, and graph-source-of-truth messaging.
- Regenerate only on relevant domain-state changes.
- Keep generated code read-only unless a safe synchronization model was explicitly approved.
- Implement keyboard access and responsive overflow.

## Out of scope

- Execution submission and live status.
- Arbitrary manual editing of generated code.
- Recreating full `/pipelines` management.

## Deliverables

- Production toolbar bound to lifecycle and validation.
- Read-only task/function code preview.
- Action availability and disabled-reason logic.
- Responsive overflow and keyboard behavior.
- Tests for actions, errors, copy/download, and regeneration boundaries.

## Interfaces and handoff contract

- CP-22 supplies Import/Export.
- CP-26 supplies Run behavior.
- CP-28 uses the complete toolbar path.
- Generators remain pure and isolated.

## Parallelization and sequencing

### Must run after

- CP-11
- CP-12
- CP-13
- CP-15
- CP-19

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-20
- CP-21
- CP-22

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-26
- CP-28
- CP-30
- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Required toolbar actions are real or explicitly disabled; no placeholders remain.
- Generated code is synchronized, stable, read-only, copyable, and downloadable.
- Generation errors link to diagnostics.
- Toolbar remains usable on constrained widths.
- Transient UI changes do not trigger regeneration.

## Verification

- Run tests for visibility, keyboard access, overflow, disabled reasons, and generation errors.
- Compare preview with generator golden fixtures.
- Measure regeneration calls for transient versus domain changes.
- Confirm manual editing is absent unless approved.

## Risks and guardrails

- Toolbar scope can expand into full management UI.
- Manual code editing creates a second source of truth.
- Frequent regeneration can hurt large graphs.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
