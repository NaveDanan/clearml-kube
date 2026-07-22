---
id: CP-13
title: "Implement deterministic function/component pipeline generation"
lane: "Generation"
wave: 3
wave_name: "Parallel foundational implementation"
complexity_points: 5
hard_dependencies: ["CP-03", "CP-06"]
parallel_wave_peers: ["CP-10", "CP-11", "CP-12", "CP-14", "CP-15"]
directly_blocks: ["CP-23", "CP-25", "CP-26"]
---

# CP-13: Implement deterministic function/component pipeline generation

## Outcome

Generate stable, readable ClearML code for the approved function/component subset using the single generation style selected during discovery.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Generation.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 3 — Parallel foundational implementation.

## Requirement areas covered

- Function generation
- Multiple outputs
- Generated subset
- Golden files

## In scope

- Generate the selected function-step or decorator model without mixing styles unless explicitly approved.
- Map component identity, arguments, defaults, outputs, multiple returns, packages, task type, queue, caching, retry, and entry points.
- Generate dependencies without contradictory explicit and inferred declarations.
- Provide deterministic formatting, identifier/string safety, source maps, and graph-linked diagnostics.
- Define the generated subset precisely enough for constrained import.
- Include local/remote entry behavior only where verified.

## Out of scope

- Arbitrary source-code parsing.
- Executing code to discover signatures.
- Task-backed generation.

## Deliverables

- A pure graph-to-function generator.
- Stable formatted output and source mapping.
- Golden fixtures for defaults, required inputs, multiple outputs, packages, queues, caching, and dependency inference.
- A machine-readable unsupported-feature surface.
- Unit and golden tests.

## Interfaces and handoff contract

- CP-25 configures nodes against this contract.
- CP-23 displays output; CP-26 uses existing execution services.
- CP-22 may import only the documented generated subset.

## Parallelization and sequencing

### Must run after

- CP-03
- CP-06

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-10
- CP-11
- CP-12
- CP-14
- CP-15

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-23
- CP-25
- CP-26

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- The chosen style is used consistently.
- Inputs, defaults, outputs, queues, cache, and packages map correctly.
- Multiple returns map deterministically.
- Unsupported constructs produce precise diagnostics.
- No evaluation or runtime introspection is used.

## Verification

- Run syntax/compile checks on all fixtures.
- Compare representative output with verified examples.
- Exercise multiple-output and dependency edge cases.
- Inspect output for secrets and transient editor state.

## Risks and guardrails

- Source inference will exceed the supported subset.
- Output port naming must remain stable.
- Editable generated code would create a second source of truth.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
