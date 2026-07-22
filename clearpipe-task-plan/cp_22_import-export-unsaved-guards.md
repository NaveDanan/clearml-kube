---
id: CP-22
title: "Implement versioned import/export, migration UX, and unsaved-change protection"
lane: "Pipeline lifecycle"
wave: 5
wave_name: "Parallel semantic and lifecycle surfaces"
complexity_points: 5
hard_dependencies: ["CP-06", "CP-10", "CP-15", "CP-19"]
parallel_wave_peers: ["CP-20", "CP-21", "CP-23"]
directly_blocks: ["CP-29", "CP-30", "CP-31"]
---

# CP-22: Implement versioned import/export, migration UX, and unsaved-change protection

## Outcome

Provide safe import/export formats and protect in-progress work before graph replacement or navigation, with no silent loss or credential leakage.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Pipeline lifecycle.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 5 — Parallel semantic and lifecycle surfaces.

## Requirement areas covered

- Import/export
- Migrations
- Unsaved guards
- Security

## In scope

- Export the versioned graph document and generated code as separate explicit actions or both when approved.
- Validate graph imports before replacing current state.
- Apply migrations and surface unsupported versions, missing fields, invalid nodes/references, and migration failures.
- Support code import only for the documented ClearPipe-generated subset if approved.
- Protect unsaved work before New, Open, Import, route navigation, close, or incompatible mode changes.
- Reject or strip prohibited secret material according to the approved policy.

## Out of scope

- Arbitrary code-to-canvas conversion.
- Code evaluation.
- Using browser persistence as the production store.

## Deliverables

- Versioned graph export and generated-code download.
- Validated graph import with migration and confirmation.
- Optional constrained generated-code import.
- Unsaved-change guards.
- Tests for malformed files, old schemas, unsupported constructs, secrets, and cancellation.

## Interfaces and handoff contract

- CP-23 exposes toolbar actions.
- CP-29 reuses migration/read-only outcomes.
- CP-27 may treat a successful import as one replace-document history command.

## Parallelization and sequencing

### Must run after

- CP-06
- CP-10
- CP-15
- CP-19

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-20
- CP-21
- CP-23

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-29
- CP-30
- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Exports are deterministic, versioned, and secret-free.
- Invalid imports cannot replace the graph.
- Supported old schemas migrate explicitly; unsupported schemas fail safely.
- Every destructive replacement/navigation path protects unsaved work.
- Code import remains limited to the documented subset.

## Verification

- Round-trip valid task and function graph exports/imports.
- Exercise malformed JSON, missing fields, unknown node, unsupported version, failed migration, and secret-shaped fields.
- Test New/Open/Import/navigation/close guards with save, discard, and cancel.
- Confirm no code evaluation occurs.

## Risks and guardrails

- Import ordering errors can destroy work.
- Code parsing scope can expand uncontrollably.
- Do not export transient or execution state.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
