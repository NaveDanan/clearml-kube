---
id: CP-32
title: "Run the final integration, release-quality gate, and implementation report"
lane: "Release gate"
wave: 9
wave_name: "Final release-quality gate"
complexity_points: 5
hard_dependencies: ["CP-28", "CP-29", "CP-30", "CP-31"]
parallel_wave_peers: []
directly_blocks: []
---

# CP-32: Run the final integration, release-quality gate, and implementation report

## Outcome

Close the project only after the integrated feature satisfies the supported acceptance criteria, repository checks pass, no core action remains a placeholder, and all remaining limitations are concrete and verified.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Release gate.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 9 — Final release-quality gate.

## Requirement areas covered

- Final response format
- Acceptance criteria
- Verification
- Remaining limitations

## In scope

- Review all task acceptance evidence and reconcile the implementation against the final consolidated specification.
- Run the repository's exact formatting, linting, type/static checking, unit, integration, end-to-end, build, and relevant runtime-console checks.
- Perform final manual smoke journeys for new task-backed authoring, new code-backed authoring, supported existing-pipeline editing, unsupported read-only handling, save/reload, and execution handoff.
- Verify permissions, feature flags, route guards, unsaved protection, secrets handling, and `/pipelines` regression behavior.
- Remove or block any nonfunctional production toolbar action, decorative node, mock-only resource source, or simulated execution state.
- Produce the required findings, parity decisions, architecture decisions, UX behavior, important-file list, exact verification commands/results, and verified-limitations report.
- Ensure the final report does not mention prohibited implementation technologies from the external functional reference.

## Out of scope

- Adding new feature scope after the release gate begins.
- Claiming checks passed when they were not run successfully.
- Describing completed behavior as future work.
- Listing speculative limitations.

## Deliverables

- A final acceptance checklist mapped to implementation evidence.
- Exact command log and outcomes for tests, integration tests, linting, static/type checks, build, and manual verification.
- The structured final implementation report required by the project specification.
- A concrete list of residual limitations, or an explicit statement that none were verified.

## Interfaces and handoff contract

- This is deliberately sequential and begins only after CP-28, CP-29, CP-30, and CP-31 close.
- Failed checks reopen the owning task; the release gate does not paper over defects.
- The final report should cite exact workspace paths and real command results collected by earlier tasks.

## Parallelization and sequencing

### Must run after

- CP-28
- CP-29
- CP-30
- CP-31

This is the final sequential release gate. It cannot overlap unfinished feature, hardening, or regression work because its output is an evidence-based completion report and a definitive pass/fail decision.

### Can run in parallel with

- None.

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- None.

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- All supported acceptance criteria have implementation or verification evidence.
- All required repository checks pass, or the work is explicitly not declared complete.
- No new runtime-console errors appear in the core journeys.
- No core interaction is a placeholder or production-only mock.
- The final report follows the required structure and lists only verified limitations.

## Verification

- Run every command documented by the repository and CP-09/CP-31.
- Run focused manual smoke journeys with console/network inspection.
- Cross-check final changed files against architecture and reference-technology constraints.
- Archive command outputs or CI links according to repository norms.

## Risks and guardrails

- Late integration failures can expose false assumptions; reopen the responsible contract or feature task.
- Environment-dependent execution checks must be labeled accurately rather than inferred.
- A passing build is insufficient without semantic, persistence, and regression evidence.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.
