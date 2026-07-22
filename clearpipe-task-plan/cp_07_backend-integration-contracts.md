---
id: CP-07
title: "Define backend, persistence, execution, permission, and route adapter contracts"
lane: "Platform contracts"
wave: 2
wave_name: "Parallel contract definition"
complexity_points: 5
hard_dependencies: ["CP-01", "CP-05"]
parallel_wave_peers: ["CP-06", "CP-08", "CP-09"]
directly_blocks: ["CP-14"]
---

# CP-07: Define backend, persistence, execution, permission, and route adapter contracts

## Outcome

Create a narrow integration boundary over existing pipeline services so ClearPipe never calls duplicate clients or relies on undocumented backend behavior.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Platform contracts.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 2 — Parallel contract definition.

## Requirement areas covered

- Integration contracts
- Persistence
- Execution
- Permissions and routes

## In scope

- Define load, create, update, create-version/save-as, delete-or-handoff, run, status, and navigation operations.
- Define how visual metadata is stored and retrieved through the existing persistence path.
- Define permission and feature-flag checks for view, edit, save, version, run, import/export, and source access.
- Define normalized loading, error, stale-version, unavailable-resource, and unsupported-representation outcomes.
- Define route parameters and return navigation without scattering route strings.
- Document backend capability gaps and required UI fallback.

## Out of scope

- Implementing service calls.
- Adding endpoints without separate approval.
- Creating a ClearPipe database or credential store.

## Deliverables

- Adapter interfaces and request/response types.
- A backend capability matrix.
- A normalized error and unsupported-state model.
- A route/permission contract.
- Contract fixtures for success and failure states.

## Interfaces and handoff contract

- CP-14 is the production implementation owner.
- Feature tasks consume adapters and may not call pipeline clients directly.
- Backend limitations affecting UX must also appear in CP-05 decisions.

## Parallelization and sequencing

### Must run after

- CP-01
- CP-05

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-06
- CP-08
- CP-09

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-14

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Every required lifecycle and navigation operation has an explicit contract.
- Permissions, flags, stale state, and unsupported representation are expressible.
- No contract requires a second runtime or persistence system.
- The boundary is testable and sufficient for the vertical slice.

## Verification

- Map each adapter operation to a verified existing service.
- Validate contract fixtures against observed response models.
- Review for duplicated clients, auth, and error handling.

## Risks and guardrails

- Visual metadata storage may be constrained.
- Version semantics may differ by entry path.
- Raw backend models must not leak into graph-domain code.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
