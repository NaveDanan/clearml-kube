---
id: CP-12
title: "Implement deterministic task-backed pipeline generation"
lane: "Generation"
wave: 3
wave_name: "Parallel foundational implementation"
complexity_points: 5
hard_dependencies: ["CP-03", "CP-06"]
parallel_wave_peers: ["CP-10", "CP-11", "CP-13", "CP-14", "CP-15"]
directly_blocks: ["CP-23", "CP-24", "CP-26"]
---

# CP-12: Implement deterministic task-backed pipeline generation

## Outcome

Generate stable, readable, valid task-based ClearML pipeline output for the supported subset, with explicit diagnostics for unsupported semantics.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Generation.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 3 — Parallel foundational implementation.

## Requirement areas covered

- Task generation
- Dependency generation
- Golden files

## In scope

- Generate the approved `PipelineController`-based representation or backend payload from graph metadata and settings.
- Map parameters, default queue, step names, base task identity, parents, overrides, step outputs, artifacts, queue overrides, caching, and approved retry/callback behavior.
- Use deterministic topological ordering and stable formatting independent of canvas position.
- Escape identifiers and strings safely.
- Distinguish data, artifact, parameter, inferred, and execution-only dependencies.
- Expose source-map metadata from generated sections to graph IDs.

## Out of scope

- Executing generated code.
- Function-backed generation.
- Guessing semantics from display labels when stable IDs exist.

## Deliverables

- A pure graph-to-task generator.
- Stable formatted output and source map.
- Golden fixtures for parameters, task identity, parents, artifacts, queues, caching, and multiple dependencies.
- Generation diagnostics.
- Unit and golden tests.

## Interfaces and handoff contract

- CP-24 configures nodes against this contract.
- CP-23 displays output; CP-26 submits through existing services.
- The generator imports no UI or network code.

## Parallelization and sequencing

### Must run after

- CP-03
- CP-06

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-10
- CP-11
- CP-13
- CP-14
- CP-15

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-23
- CP-24
- CP-26

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Unchanged logical graphs produce stable output.
- Supported task bindings are represented accurately.
- Pipeline, step-output, and artifact references are correct.
- Invalid identifiers and strings are safe.
- Unsupported features fail explicitly rather than being omitted.

## Verification

- Run syntax or repository-approved compile checks on fixtures.
- Compare fixtures with semantically equivalent ClearML examples.
- Regenerate identical graphs repeatedly and compare output.
- Inspect output for secrets and transient state.

## Risks and guardrails

- Naive ordering can violate dependencies.
- Combining inferred and explicit parents can alter semantics.
- Unsupported callbacks or retry behavior must not be silently dropped.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
