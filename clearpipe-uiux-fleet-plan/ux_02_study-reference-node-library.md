---
id: UX-02
title: "Extract the reference node-library and editor interaction patterns"
lane: "Reference research"
wave: 0
wave_name: "Parallel UI evidence"
complexity_points: 5
hard_dependencies: []
parallel_wave_peers: ["UX-01", "UX-03", "UX-04"]
directly_blocks: ["UX-05"]
recommended_owner: "Interaction designer or frontend architect"
---

# UX-02: Extract the reference node-library and editor interaction patterns

## Outcome

Document the useful product behavior of the NJ-Labs ClearPipe reference, especially its user-facing node store/library, without copying its branding or implementation architecture.

## Why this task exists

The reference has a coherent node discovery and editing model. The target should preserve that usability while conforming to ClearML’s product language and real resource model.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Reference research.
- **Recommended owner:** Interaction designer or frontend architect.
- **Wave:** 0 — Parallel UI evidence.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Inspect the read-only reference paths listed in `00_REFERENCE_FINDINGS.md`.
- Trace the node-library flow from catalog metadata to category grouping, width-responsive presentation, drag insertion, graph creation, renderer selection, card presentation, and inspector selection.
- Document palette modes, panel behavior, canvas controls, card hierarchy, ports, toolbar placement, zoom feedback, keyboard behavior, and motion.
- Identify patterns to adopt, adapt, reject, or improve.
- Call out reference behavior that is visually noisy, inaccessible, static, duplicated, or incompatible with ClearML.

## Out of scope

- Copying reference styles, colors, dependencies, persistence, credentials, or execution behavior.
- Treating the static reference node definitions as valid ClearML node types.
- Recommending pixel-for-pixel reproduction.

## Owned surfaces and contracts

- Reference behavior inventory.
- Adopt/adapt/reject recommendations for UX-05.
- A node-library sequence diagram and information hierarchy.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- A concise reference behavior report.
- A node-store/library model showing registry metadata, real resource results, creation command, renderer registry, card shell, and inspector extension points.
- A motion and panel-behavior inventory.
- A list of reference weaknesses that the target must not reproduce.

## Parallelization and sequencing

### Must run after

None.

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

[UX-01](./ux_01_audit-current-clearpipe-ui.md), [UX-03](./ux_03_inventory-clearml-design-system.md), [UX-04](./ux_04_define-usability-journeys.md)

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

[UX-05](./ux_05_freeze-uiux-contract.md)

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- The report covers catalog, insertion, canvas, node card, inspector, panels, toolbar, keyboard, and motion.
- Every adopted behavior has a ClearML-compatible interpretation.
- The report explicitly prevents duplicate node defaults and duplicate graph state.
- Always-on decorative edge animation and generic fake node categories are rejected.
- No reference implementation technology is proposed as a requirement.

## Verification

- Cross-check findings against all reference paths in `00_REFERENCE_FINDINGS.md`.
- Verify the proposed adaptation does not conflict with the target specification’s source-of-truth rules.
- Review the node-library sequence with UX-07 and the card model with UX-09.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

UX-05 freezes the adaptation decisions. UX-07, UX-09, and UX-12 implement the approved library, card, and motion patterns.

The handoff must include changed files, fixtures added, before/after evidence, tests run, known blockers, and any contract change.

## Universal guardrails

- Preserve existing graph, validation, persistence, execution, permission, feature-flag, and route contracts.
- Use the current ClearML design system and repository conventions; do not introduce a second styling or state system.
- Treat the NJ-Labs repository as a product-behavior reference only.
- Use real ClearML resources and existing commands. No mock-only production flow or decorative unsupported node type.
- Do not store credentials or secrets in graph/UI state, exports, URLs, or browser persistence.
- Keep ordinary graph edges static; animate only meaningful transient or active execution states.
- Add or update focused tests and register deterministic visual fixtures for changed states.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- The changed surface works with representative real data or approved boundary fixtures.
- Relevant tests, linting, type/static checks, and builds for the changed scope pass.
- There is no new runtime-console error.
- No core interaction introduced or changed by this task remains a placeholder.
- Any remaining limitation is concrete, verified, and assigned to a downstream owner.
