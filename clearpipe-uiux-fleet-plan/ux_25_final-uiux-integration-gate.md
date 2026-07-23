---
id: UX-25
title: "Run the final UI/UX integration, usability, and completion gate"
lane: "Release gate"
wave: 6
wave_name: "Sequential completion gate"
complexity_points: 5
hard_dependencies: ["UX-04", "UX-24"]
parallel_wave_peers: []
directly_blocks: []
recommended_owner: "Lead UI/UX implementation agent"
---

# UX-25: Run the final UI/UX integration, usability, and completion gate

## Outcome

Prove that ClearPipe is now coherent, usable, ClearML-native, and regression-safe across complete user journeys.

## Why this task exists

Component-level completion is not success unless the integrated editor solves the original usability failures.

## Sizing and ownership

- **Relative complexity:** 5 points. This is a coordination weight, not an elapsed-time estimate.
- **Primary lane:** Release gate.
- **Recommended owner:** Lead UI/UX implementation agent.
- **Wave:** 6 — Sequential completion gate.
- One directly responsible agent owns the task even when specialists review it.

## In scope

- Merge and reconcile all UI branches through the ownership rules.
- Rerun the exact UX-04 manual script and compare against UX-01 baselines.
- Review visual consistency, terminology, spacing, density, motion, focus, errors, and state transitions end to end.
- Resolve all P0/P1 UI/UX defects and assign any lower-severity verified limitation.
- Run relevant tests, linting, type checks, build, visual regression, and integration checks.
- Produce a concise before/after and remaining-limitations report.

## Out of scope

- Adding new scope during the release gate.
- Masking defects with screenshots or claiming checks not run.
- Accepting broken core journeys because individual components look polished.

## Owned surfaces and contracts

- Final integration branch.
- Cross-branch conflict resolution.
- Completion evidence and release decision.

Do not edit a peer-owned shared primitive unless its owner explicitly transfers the change or the lead integration agent coordinates it.

## Required deliverables

- Passing UX scorecard and manual journey record.
- Before/after screenshot comparison.
- Exact commands and results.
- Final changed-file/component summary.
- Concrete remaining limitations only.

## Parallelization and sequencing

### Must run after

[UX-04](./ux_04_define-usability-journeys.md), [UX-24](./ux_24_visual-interaction-regression.md)

These are hard dependencies. Do not begin implementation against guessed contracts.

### Can run in parallel with

None.

Parallel work is safe only when agents use isolated branches/worktrees and stay within the owned surfaces above.

### Directly unblocks

None.

### Merge-conflict controls

- Add registrations or extension modules instead of branching shared components.
- Do not reformat or reorganize unrelated files.
- Coordinate any API change to the shell, node library, base card, inspector, toolbar, motion helpers, or fixture harness with its designated owner.
- Return cross-cutting defects to the owning task rather than creating a shadow implementation.

## Acceptance criteria

- All 25 task packets are complete.
- No P0 or P1 UI/UX defect remains open.
- Node discovery, add, connect, configure, validate, save, run, and reopen journeys pass.
- The node library resembles the reference interaction model while remaining visually and semantically ClearML-native.
- The editor is keyboard operable for core actions and honors reduced motion.
- Responsive, visual, interaction, lint, type, build, and relevant integration checks pass.
- No new runtime-console error or nonfunctional UI action remains.

## Verification

- Execute UX-04’s script with a reviewer who did not implement the surface.
- Run every command recorded by UX-24 plus repository release checks.
- Inspect supported themes and viewports.
- Verify `/pipelines` entry and return paths remain functional.

Record the exact repository commands and their results. Do not claim a check passed unless it ran successfully.

## Handoff

Completion. Report only concrete verified limitations; do not describe completed behavior as future work.

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
