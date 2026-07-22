---
id: CP-18
title: "Implement shared resource queries and permission-aware selectors"
lane: "Resource integration"
wave: 4
wave_name: "Parallel editor and lifecycle foundation"
complexity_points: 5
hard_dependencies: ["CP-08", "CP-14"]
parallel_wave_peers: ["CP-16", "CP-17", "CP-19"]
directly_blocks: ["CP-21", "CP-24", "CP-25", "CP-28", "CP-30"]
---

# CP-18: Implement shared resource queries and permission-aware selectors

## Outcome

Provide one reusable data-access and selector layer for ClearML projects, tasks, datasets, queues, models, templates, and components.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Resource integration.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 4 — Parallel editor and lifecycle foundation.

## Requirement areas covered

- Resource selectors
- Search/pagination
- Permissions
- Safe credential references

## In scope

- Wrap existing resource services without duplicating clients.
- Implement search, filters, refresh, pagination/incremental loading, loading, empty, error, retry, stale, and permission states.
- Display project, name, ID, version, type, status, tags, and last-update context while retaining stable IDs internally.
- Provide reusable selectors for projects, tasks, datasets/versions, queues, models, templates, and components where supported.
- Provide resource resolvers for validation.
- Represent existing connection/credential configuration only through safe references and management links.

## Out of scope

- Domain-specific inspector forms.
- Unsupported create/download/version actions.
- A credential store or secret browser persistence.

## Deliverables

- Shared query hooks/services and selector components.
- A normalized resource summary and stale/unavailable model.
- Resource resolvers for CP-11.
- Permission-aware management links.
- Tests for pagination, search, empty, error, retry, stale, and permissions.

## Interfaces and handoff contract

- CP-21, CP-24, and CP-25 consume this layer.
- CP-11 consumes narrow resource resolvers.
- No feature component calls production resource APIs directly when a shared abstraction exists.

## Parallelization and sequencing

### Must run after

- CP-08
- CP-14

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-16
- CP-17
- CP-19

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-21
- CP-24
- CP-25
- CP-28
- CP-30

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Normal flows do not require pasting opaque task, dataset, project, or queue IDs.
- Selectors show enough context to disambiguate resources.
- All loading/error/stale/permission states are implemented.
- Graph references use stable IDs and never contain secrets.
- No duplicate resource client is introduced.

## Verification

- Run query/selector tests with pagination, no results, transient failure, permission denial, and deleted resources.
- Inspect graph payloads for only safe references and display metadata.
- Verify credential selectors never expose secret values.

## Risks and guardrails

- Resource inventories may be large; pagination and cancellation are mandatory.
- Cached display metadata may be stale; stable IDs remain authoritative.
- Do not imply unsupported resource actions.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
