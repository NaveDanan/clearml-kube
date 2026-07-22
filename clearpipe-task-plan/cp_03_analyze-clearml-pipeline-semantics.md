---
id: CP-03
title: "Map ClearML pipeline semantics and select the code-generation model"
lane: "Discovery"
wave: 0
wave_name: "Parallel discovery"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["CP-01", "CP-02", "CP-04"]
directly_blocks: ["CP-05", "CP-06", "CP-12", "CP-13"]
---

# CP-03: Map ClearML pipeline semantics and select the code-generation model

## Outcome

Define the exact task-backed and function-backed semantics ClearPipe may represent, including one primary function-generation target and a documented unsupported subset.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Discovery.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 0 — Parallel discovery.

## Requirement areas covered

- ClearML pipeline semantics
- Task-backed steps
- Function-backed steps
- Generated code

## In scope

- Inspect the complete ClearML pipeline example set rather than only README files.
- Map task-backed concepts: controller metadata, parameters, `add_step`, base task identity, parents, overrides, step/artifact references, queues, caching, callbacks, retries, and local/remote execution.
- Compare `PipelineController.add_function_step` with decorator-based component and pipeline models.
- Map function inputs, defaults, outputs, multiple returns, inferred/explicit dependencies, packages, task types, queues, caching, and serialization limits.
- Recommend one primary function-generation style and define whether mixed task/function graphs are supported.
- Define the constrained generated/importable subset and rejection behavior.

## Out of scope

- Implementing generators.
- Executing user code to infer a graph.
- Claiming arbitrary source-code round trips.

## Deliverables

- A graph-to-ClearML semantic mapping table.
- A decision memo comparing function-generation options.
- A supported-feature matrix for task and function nodes.
- Representative semantic fixtures for CP-12 and CP-13.

## Interfaces and handoff contract

- Feeds CP-05, CP-06, CP-12, and CP-13.
- Supported capabilities must later be machine-checkable, not prose-only.
- Reference-project implementation details are irrelevant here.

## Parallelization and sequencing

### Must run after

- None.

No project task is a hard prerequisite. Start immediately, in parallel with the other Wave 0 discovery tracks. Keep findings evidence-based and avoid making shared architecture decisions that belong to CP-05.

### Can run in parallel with

- CP-01
- CP-02
- CP-04

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-05
- CP-06
- CP-12
- CP-13

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Task and function semantics map to actual ClearML behavior.
- One primary function-generation target is selected with reasons.
- Data, artifact, parameter, inferred, and execution-only dependencies are distinct.
- Multiple outputs and unsupported constructs have defined behavior.

## Verification

- Validate conclusions against task, function, decorator, artifact, parameter, queue, and cache examples.
- Create at least one two-step task fixture and one two-function fixture.
- Confirm reference syntax can be generated deterministically.

## Risks and guardrails

- Examples may expose behavior unavailable through the current product backend.
- Mixing inferred and explicit dependencies can create contradictory output.
- Do not overstate code import support.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
