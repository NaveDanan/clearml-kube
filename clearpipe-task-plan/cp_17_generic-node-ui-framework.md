---
id: CP-17
title: "Implement the generic node catalog, cards, ports, and inspector framework"
lane: "Editor components"
wave: 4
wave_name: "Parallel editor and lifecycle foundation"
complexity_points: 8
hard_dependencies: ["CP-10", "CP-15"]
parallel_wave_peers: ["CP-16", "CP-18", "CP-19"]
directly_blocks: ["CP-20", "CP-21", "CP-24", "CP-25", "CP-27", "CP-30"]
---

# CP-17: Implement the generic node catalog, cards, ports, and inspector framework

## Outcome

Provide reusable, accessible editor surfaces that domain tasks extend without duplicating palette, card, port, status, action, or inspector architecture.

## Sizing and ownership

- **Relative complexity:** 8 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Editor components.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 4 — Parallel editor and lifecycle foundation.

## Requirement areas covered

- Node catalog
- Node cards
- Ports
- Inspector

## In scope

- Implement categorized catalog sections, search, compact mode, loading/empty/error/disabled states, drag affordance, and click-to-add hooks.
- Implement compact generic node cards with identity, concise summary, ports, actions, selection, validation, execution, stale-resource, and disabled states.
- Implement port primitives with labels, direction, connection state, compatibility state, and non-color-only indicators.
- Implement inspector header, stable ID, source link, collapse/close, Configuration and General areas, optional Logs/Execution/Code slots, scrolling, and focus management.
- Implement typed extension registries for catalog entries, summaries, forms, actions, icons, and status presentation.
- Use existing tokens/components and progressive disclosure.

## Out of scope

- Task, function, or dataset-specific forms.
- Connection semantics.
- Full execution panel or toolbar behavior.

## Deliverables

- Generic catalog, node card, port, action, status, validation, and inspector components.
- A typed domain-extension registry.
- Accessible loading, warning, invalid, running, completed, failed, and unavailable states.
- Visual fixtures/stories or repository equivalent.
- Component and accessibility tests.

## Interfaces and handoff contract

- CP-16 renders these components.
- CP-18 supplies resource states.
- CP-20 controls compatibility/highlight props.
- CP-21, CP-24, and CP-25 register domain extensions.

## Parallelization and sequencing

### Must run after

- CP-10
- CP-15

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-16
- CP-18
- CP-19

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-20
- CP-21
- CP-24
- CP-25
- CP-27
- CP-30

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Catalog entries support search, drag, and non-drag insertion.
- Cards show concise identity, configuration, validation, status, ports, and actions without full forms.
- Selection opens the inspector without navigation.
- States are understandable without color alone.
- Domain extensions do not copy generic components.

## Verification

- Run tests for search, add hooks, card states, port labels, tabs, focus, and menus.
- Render representative task, function, dataset, invalid, running, failed, and unavailable extensions.
- Perform semantic-button, label, status, and focus-order checks.

## Risks and guardrails

- An overly flexible extension API can become untyped.
- Large summaries will make the graph unreadable.
- Status mapping logic belongs to CP-26, not this layer.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
