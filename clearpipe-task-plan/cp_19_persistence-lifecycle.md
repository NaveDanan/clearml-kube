---
id: CP-19
title: "Implement new, open, save, reload, and version lifecycle behavior"
lane: "Pipeline lifecycle"
wave: 4
wave_name: "Parallel editor and lifecycle foundation"
complexity_points: 8
hard_dependencies: ["CP-10", "CP-14", "CP-15"]
parallel_wave_peers: ["CP-16", "CP-17", "CP-18"]
directly_blocks: ["CP-22", "CP-23", "CP-26", "CP-27", "CP-28", "CP-29", "CP-30"]
---

# CP-19: Implement new, open, save, reload, and version lifecycle behavior

## Outcome

Persist and restore the canonical graph through existing pipeline services, including version semantics, dirty state, progress, success, failure, and conflict handling.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Pipeline lifecycle.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 4 — Parallel editor and lifecycle foundation.

## Requirement areas covered

- Save/reload
- Versioning
- Dirty state
- Persistence integration

## In scope

- Implement new initialization, open/load, create, update, and save-as/create-version according to verified semantics.
- Serialize schema version, metadata, nodes, edges, positions, ports, bindings, settings, generated inputs, parameters, and approved viewport metadata.
- Restore the same logical graph and configuration on reload.
- Implement saved/modified state, save progress, success, failure, stale-version/conflict, and permission-aware disabled states.
- Integrate return navigation to pipeline details without duplicating management UI.
- Add persistence integration tests through CP-14.

## Out of scope

- File import/export and route-leave guards.
- Execution submission.
- Deleting pipelines inside ClearPipe unless explicitly assigned.

## Deliverables

- Lifecycle controller/hooks for new, open, save, update, version, reload, and return.
- Graph-to-persistence and persistence-to-graph adapters.
- Dirty/saved state and actionable errors.
- Round-trip integration tests.
- An unsupported/read-only load outcome.

## Interfaces and handoff contract

- CP-22 wraps this with import/export and unsaved protection.
- CP-23 binds toolbar actions.
- CP-28 proves the complete save/reload journey.
- CP-29 reuses lifecycle behavior for existing pipelines.

## Parallelization and sequencing

### Must run after

- CP-10
- CP-14
- CP-15

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-16
- CP-17
- CP-18

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-22
- CP-23
- CP-26
- CP-27
- CP-28
- CP-29
- CP-30

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- New graphs save through existing services.
- Reload restores nodes, edges, ports, settings, bindings, and positions.
- Dirty state ignores purely transient UI changes.
- Version creation follows current product semantics.
- Permission, backend, and stale-version errors are actionable.
- No ClearPipe-only production store is introduced.

## Verification

- Run save/reload tests for task, function, and approved unsupported fixtures.
- Compare pre-save and post-load logical equality.
- Exercise create, update, version, permission, stale, and failure paths.
- Inspect persisted payloads for secrets and transient fields.

## Risks and guardrails

- Visual metadata storage may be limited; follow the approved fallback.
- Incorrect dirty-state boundaries create noisy warnings.
- Unknown fields must not be silently discarded.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
