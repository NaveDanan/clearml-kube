---
id: CP-25
title: "Implement function- and component-backed node authoring"
lane: "Authoring features"
wave: 6
wave_name: "Parallel feature completion"
complexity_points: 8
hard_dependencies: ["CP-13", "CP-17", "CP-18", "CP-20"]
parallel_wave_peers: ["CP-24", "CP-26", "CP-27"]
directly_blocks: ["CP-29", "CP-30", "CP-31"]
---

# CP-25: Implement function- and component-backed node authoring

## Outcome

Deliver the constrained code-based authoring path: users can define or select a supported function/component, configure typed inputs and outputs, connect data, and obtain deterministic ClearML pipeline code without evaluating arbitrary source.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Authoring features.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 6 — Parallel feature completion.

## Requirement areas covered

- Code/function node requirements
- Journey B
- Generated code
- Constrained import

## In scope

- Register the approved function/component node extension against the shared graph schema, node renderer, inspector, validation, and generator contracts.
- Support component name, function name, description, safe source/reference metadata, task type, package requirements, queue, caching, and supported retry settings.
- Provide explicit input definitions with names, types, required/default values, and upstream or pipeline-parameter bindings.
- Provide explicit output definitions, stable port IDs, return-value names, and multiple-output handling.
- Integrate real reusable-component search through CP-18 where such a service exists; otherwise expose only the architecture-approved explicit-definition path.
- Surface unsupported constructs and generation failures through CP-11 diagnostics and CP-13 source mapping.
- Persist all supported settings through the canonical graph and ensure graph changes update the read-only code preview.

## Out of scope

- Arbitrary source-code parsing or unrestricted evaluation.
- Making generated code independently editable.
- Silently inferring signatures or outputs from code that has not been parsed by an approved constrained importer.
- Mixing generation styles or authoring modes unless CP-05 explicitly approves a compatibility model.

## Deliverables

- Function/component catalog entries, node card, typed ports, and configuration inspector.
- Input, default-value, output, and multiple-return editors.
- Package, task-type, queue, caching, and supported retry configuration.
- Integration with CP-13 generation and CP-11 validation.
- Focused fixtures and tests for single-output, multiple-output, parameter-bound, and upstream-bound components.

## Interfaces and handoff contract

- Consumes the CP-13 generator extension contract and must not duplicate code-generation logic in UI components.
- Publishes stable node/port semantics and source maps for CP-26 execution feedback and CP-29 existing-pipeline conversion.
- Coordinates with CP-22 only for the documented code-import subset; unsupported input must be rejected rather than approximated.

## Parallelization and sequencing

### Must run after

- CP-13
- CP-17
- CP-18
- CP-20

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-24
- CP-26
- CP-27

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

- A user can create, configure, connect, save, reload, and generate code for a two-component graph.
- Multiple declared outputs retain stable identities and can be bound independently.
- Arguments, defaults, packages, task type, queue, caching, and supported retry behavior persist and generate correctly.
- Unsupported constructs produce precise, actionable errors without dropping graph behavior.
- No user-entered code is executed merely to construct or inspect the graph.

## Verification

- Run node-form and port-contract tests.
- Run CP-13 generator fixtures for each supported component shape.
- Round-trip supported component graphs through serialization.
- Verify unsupported imports and definitions fail safely with stable diagnostic codes.

## Risks and guardrails

- An overly broad component model makes deterministic generation impossible; keep the supported subset explicit.
- Changing output names can break downstream bindings; use stable IDs and migration-aware rename behavior.
- Package and source fields can become injection surfaces; generate through typed AST/template helpers rather than string concatenation.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
