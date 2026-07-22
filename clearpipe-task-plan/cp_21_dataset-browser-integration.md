---
id: CP-21
title: "Implement the ClearML Dataset browser and dataset integration"
lane: "Resource features"
wave: 5
wave_name: "Parallel semantic and lifecycle surfaces"
complexity_points: 5
hard_dependencies: ["CP-14", "CP-17", "CP-18"]
parallel_wave_peers: ["CP-20", "CP-22", "CP-23"]
directly_blocks: ["CP-30", "CP-31"]
---

# CP-21: Implement the ClearML Dataset browser and dataset integration

## Outcome

Adapt dataset selection to real ClearML APIs, permissions, versions, metadata, and graph bindings without exposing unsupported actions or credentials.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Resource features.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 5 — Parallel semantic and lifecycle surfaces.

## Requirement areas covered

- Dataset browser
- Dataset versions
- Permissions
- Dataset bindings

## In scope

- Implement dataset search, project filtering, IDs, versions, file counts, tags, updated time, pagination, refresh, loading, empty, error, and retry.
- Implement the approved dataset representation as a node, binding, selector, or template.
- Implement dataset/version selection and compact inspector summaries with source links.
- Expose only supported actions such as use, browse, create/version, download/acquire, or open details.
- Represent dataset ports/bindings where approved.
- Store only stable safe references.

## Out of scope

- Mocking unsupported dataset actions.
- Raw credential entry or serialization.
- Generic cloud-provider controls.

## Deliverables

- Dataset browser and selection UI.
- Dataset/version summary and inspector extension.
- Approved graph binding/node extension.
- Permission-aware actions and management links.
- Tests for search, versions, empty/error, stale, and permissions.

## Interfaces and handoff contract

- CP-24 and CP-25 may consume dataset bindings.
- CP-11 validates datasets through CP-18.
- CP-26 shows created dataset versions only when backend data exists.

## Parallelization and sequencing

### Must run after

- CP-14
- CP-17
- CP-18

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-20
- CP-22
- CP-23

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-30
- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Users can find and select real datasets and versions with context.
- Loading, empty, error, retry, permission, and stale states work.
- Only supported actions are visible and functional.
- References survive save/reload and contain no credentials.
- Bindings participate in validation/generation where approved.

## Verification

- Run browser tests across projects, versions, no results, failure, permissions, and stale references.
- Save and reload a graph with a dataset reference.
- Inspect graph/export payloads for secret leakage.
- Verify unsupported actions are absent or explained.

## Risks and guardrails

- Dataset APIs may not expose every desired field.
- A dataset is not necessarily an executable node.
- Do not duplicate dataset management owned elsewhere.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
