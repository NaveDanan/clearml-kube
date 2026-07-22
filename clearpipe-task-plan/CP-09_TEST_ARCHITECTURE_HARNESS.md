---
id: CP-09
title: "Establish the test architecture, fixtures, and CI harness"
lane: "Quality contracts"
wave: 2
wave_name: "Parallel contract definition"
complexity_points: 5
hard_dependencies: ["CP-01", "CP-02", "CP-05"]
parallel_wave_peers: ["CP-06", "CP-07", "CP-08"]
directly_blocks: ["CP-31"]
---

# CP-09: Establish the test architecture, fixtures, and CI harness

## Outcome

Provide shared test utilities and deterministic fixtures so parallel tasks add focused coverage without incompatible mocks or unstable generated-output assertions.

## Sizing and ownership

- **Relative complexity:** 5 points. Points indicate coordination and implementation complexity, not elapsed time.
- **Primary lane:** Quality contracts.
- **Recommended ownership:** One directly responsible engineer; pair with a domain reviewer for shared contracts.
- **Wave:** 2 — Parallel contract definition.

## Requirement areas covered

- Test architecture
- Fixtures
- Golden files
- CI commands

## In scope

- Identify existing unit, component, integration, E2E, golden, accessibility, and build-test conventions.
- Create fixture builders for graph documents, nodes, ports, edges, resources, permissions, errors, execution states, and migrated versions.
- Create a service-adapter fake aligned with CP-07 using deterministic IDs, clocks, and ordering.
- Set up golden-file infrastructure for task and function generation.
- Define test tiers, ownership, naming, cleanup, and exact repository commands.
- Create an acceptance-criteria coverage matrix template for CP-31.

## Out of scope

- Writing all feature tests before implementations exist.
- Replacing the repository test framework.
- Treating mock-only tests as proof of real service integration.

## Deliverables

- Shared fixture factories and adapter fakes.
- A stable golden-output helper and update policy.
- A test-plan document for unit through E2E and `/pipelines` regression.
- A command inventory.
- At least one harness smoke test.

## Interfaces and handoff contract

- Every implementation task owns local tests using this harness or existing equivalents.
- CP-31 closes cross-cutting gaps.
- Semantic fixture changes require coordination with graph, validation, and generator owners.

## Parallelization and sequencing

### Must run after

- CP-01
- CP-02
- CP-05

Begin after the listed hard dependencies publish stable, reviewed interfaces. Work may then proceed in parallel with the same-wave peers below. Starting earlier is likely to produce schema, service, UX, or test contracts that later require rework.

### Can run in parallel with

- CP-06
- CP-07
- CP-08

Same-wave parallelism is safe only after each owner's own dependencies are satisfied. A peer may finish earlier without blocking this task unless it appears in the hard-dependency list.

### Directly unblocks

- CP-31

### Merge-conflict controls

- Do not redefine contracts owned by another task; propose changes through that owner.
- Prefer extension points and registration modules over concurrent edits to shared monoliths.
- Rebase or integrate after any graph-schema, service-adapter, route, or generator contract change.
- Keep production behavior connected to real ClearML services; test doubles belong only at test boundaries.

## Acceptance criteria

- Teams can build valid/invalid graphs without hand-writing large objects.
- Permission, stale-resource, and execution scenarios are deterministic.
- Golden tests detect semantic drift without formatting noise.
- Relevant test, lint, type, and build commands are documented.

## Verification

- Run the harness smoke test and one golden assertion.
- Repeat runs to confirm determinism.
- Confirm the fake satisfies CP-07 without importing production clients.

## Risks and guardrails

- Over-mocking can hide integration defects.
- Snapshots must not replace semantic assertions.
- Do not add a second test framework.

## Definition of done

- All deliverables and acceptance criteria above are complete.
- Relevant focused tests pass under the repository's established commands.
- Formatting, linting, and static/type checks pass for the changed scope.
- Production flows use real ClearML services, permissions, route guards, and feature flags.
- No secret or credential value is stored in graph state, generated output, exports, URLs, or browser persistence.
- No core action introduced by this task remains a placeholder or mock-only production path.
- Any remaining limitation is concrete, verified, and handed to the owning downstream gate.

## Implemented harness contract

**Status:** published by CP-09 on the CP-05-approved baseline. This document is
the test-plan handoff to every implementation packet and to CP-31. It does not
define graph, endpoint, or UX semantics owned by CP-06, CP-07, or CP-08.

### Harness locations

| Location | Purpose | Ownership boundary |
|---|---|---|
| `clearml-server\apiserver\tests\clearpipe\factories.py` | Pure Python graph, resource, permission, diagnostic, migration, and execution-state builders | Test-only; reads the CP-06 canonical fixture documents. |
| `clearml-server\apiserver\tests\clearpipe\goldens.py` | AST-semantic Python golden assertion for CP-03 generator fixtures | Test-only; CP-12/CP-13 provide actual generated source. |
| `clearml-server\apiserver\tests\clearpipe\test_harness.py` | Executable determinism and golden-helper smoke coverage | Test-only. |
| `clearml-web\src\app\features\clearpipe\testing\clearpipe-fixtures.ts` | Browser-side structural fixtures and invalid-case recipes | Test-only; imports CP-06 graph types but no application services. |
| `clearml-web\src\app\features\clearpipe\testing\clearpipe-adapter.fake.ts` | Deterministic CP-07-shaped adapter boundary fake | Test-only; CP-14 must not import it. |
| `clearml-web\src\app\features\clearpipe\testing\clearpipe-harness.spec.ts` | Focused browser harness smoke coverage | Test-only. |
| `clearml-web\tsconfig.clearpipe.spec.json`, `karma.clearpipe.conf.js`, and `angular.json` target `test-clearpipe` | Isolated ClearPipe harness browser test target | Runs only test-support specs without changing the global test bootstrap. |
| `clearml-web\src\app\features\clearpipe\testing\tsconfig.pipelines-regression.spec.json` and `angular.json` target `test-pipelines-regression` | Isolated existing `/pipelines` browser regression | Test-only target for the existing pipeline-card menu spec. |

The factories bind to CP-06's merged repository-native v2 contract: server
builders load its shared canonical JSON documents and browser builders use its
`GraphV2` types. Small defaults plus explicit overrides preserve the scenario
names below without creating a competing schema. They retain CP-05's frozen
task/function, stable-port, five-binding-kind, visual-metadata, and
resource-ID boundaries.

### Fixture and scenario catalog

All builders are deterministic: absent caller input receives a stable ID,
name, geometry, queue, timestamp, and ordering. Builders deep-copy supplied
values, so a test cannot mutate another test's fixture.

| Builder or scenario | Intended consumer |
|---|---|
| `graph_document`, `task_node`, `function_node`, `port`, `binding` | CP-06/10/11/12/13/19/20 graph tests |
| `valid_task_graph`, `valid_function_graph`, `invalid_graphs` | CP-06 schema, CP-11 diagnostics, CP-12/13 lowering tests |
| `resource`, `permission`, `execution_state`, `diagnostic`, `migrated_document` | CP-07/18/19/21/26 lifecycle and state tests |
| `DeterministicIds`, `DeterministicClock` | Any test that otherwise needs a UUID or current time |
| `fixtureDefinition`, `taskGraph`, `functionGraph`, `invalidGraphs` | Browser equivalents for CP-10 onward |
| `ClearpipeAdapterFake` | Component and state tests at the CP-14 adapter seam |

Invalid scenarios deliberately preserve the attempted document. They identify a
reason (`duplicate-node-name`, `cycle`, `unknown-port`, `embedded-secret`, or
`unsupported-schema`) but do not implement CP-11
validation. Tests must assert the diagnostic later published by CP-11; they
must never silently repair or discard the invalid input.

### CP-07 adapter fake

`ClearpipeAdapterFake` implements the lifecycle seam CP-07 requires:
load, create, update with expected revision, save-as, validate, archive,
delete, start, and status. Its result union expresses the CP-07 outcome
families—permission/feature denial, missing definition, stale revision,
validation failure, unavailable resource, unsupported representation, and
execution unavailable—without modeling HTTP, a production client, or server
internals. `failNext` intentionally makes one named call return a chosen
outcome.

The fake has an injected `DeterministicClock` and `DeterministicIds`; calls are
recorded in operation order. A successful update increments exactly one
revision, and a successful start gets a stable `run-0001`-style identifier.
This makes state and component tests repeatable. It is a consumer-side
contract double only: it is not authorization proof, persistence proof, or
execution proof.

When CP-07 lands its exact request/response types, update this test-only
adapter's local structural interfaces and its focused spec in the same change.
Do not add a second production client, change the public endpoint contract, or
make production code depend on this fake.

### Deterministic goldens and contract checks

CP-03's checked-in fixtures are the source-of-truth generator examples:

| Generator owner | Input | Expected source |
|---|---|---|
| CP-12 | `clearpipe-task-plan\fixtures\cp-03\two-step-task.yaml` | `two-step-task.expected.py` |
| CP-13 | `clearpipe-task-plan\fixtures\cp-03\two-function.yaml` | `two-function.expected.py` |

CP-12 and CP-13 must call
`assert_python_golden(actual_source, expected_path)` as well as assert
semantic facts (controller fields, call kind, references, ordered parents,
manifest/source-map locations, and absence of launch calls). The helper parses
both files and compares attribute-free ASTs. Therefore line endings,
indentation, blank lines, and quote formatting do not create a false failure;
changed literals, call order, arguments, control flow, imports, or a launch
call do fail. It never executes generated Python.

Golden updates are allowed only when all of the following are in one reviewed
change:

1. the canonical CP-06/CP-11 semantic change and its migration/diagnostic
   coverage when applicable;
2. the updated YAML fixture, expected source, semantic assertions, and
   deterministic rerun evidence;
3. a stated CP-12/CP-13 owner rationale; and
4. confirmation that neither expected source nor test output contains a secret.

Snapshots never replace semantic assertions. A raw text snapshot, a generated
timestamp/UUID, or a golden that calls `start`/`start_locally` is prohibited.

Contract checks are layered: server schema/service tests use the real
authenticated service boundary and fixture DTOs; browser adapter tests assert
only the normalized CP-07 seam; browser flow tests exercise the real CP-14
adapter against a disposable authorized server environment. The latter—not the
fake—is the evidence for integration.

### Test layers and ownership

| Layer | Owner(s) | Required proof | Not proof of |
|---|---|---|---|
| Pure domain unit | CP-06, CP-10, CP-11 | codecs/migrations, commands, diagnostics, binding invariants, secret rejection | endpoint wiring or Agent execution |
| Generator/golden | CP-12, CP-13 | CP-03 lowering, AST golden, no-launch source, deterministic ordering | a reachable Agent/queue |
| Server contract/integration | CP-07, CP-14, CP-19, CP-26 | typed DTOs, CAS, authorization, archive/delete, queue warning, persisted derived source through real service boundary | browser presentation |
| Browser component | CP-15 through CP-27 | rendering, disabled reasons, focus/keyboard alternatives, loading/error/empty/read-only states at the adapter seam | server authorization |
| Browser flow/E2E | CP-28 through CP-31 | guarded route, authorized create/save/reload conflict, denial, resource failures, `/pipelines` handoff | Agent execution unless it uses one |
| Real-Agent smoke | CP-26, CP-28 | saved CP-03-representative definition creates/enqueues and is observed through real ClearML records | fake success |
| Regression/release | CP-30 through CP-32 | accessibility/responsive checks, focused ClearPipe suite, existing `/pipelines` regressions, quality evidence | untested capability |

### No-mock production policy

1. Production ClearPipe code imports only the CP-14 adapter and real ClearML
   services. It must never import `testing\`, a fake, fixture, Jasmine spy, or
   a browser runner.
2. Fakes are permitted only at a test boundary. Unit/component tests label
   their double in the test name and do not claim a service integration result.
3. Server integration proof uses real task/project/queue authorization and
   ClearPipe persistence in a disposable test environment. Browser flow proof
   uses the production adapter and that environment.
4. Run support requires CP-26's real-Agent evidence. A fake returned run ID,
   simulated status, or mocked enqueue is not a pass and must not enable Run.
5. `/pipelines` remains independently tested. No ClearPipe target changes its
   bootstrap, test inclusion, or operational semantics.

### Naming, errors, cleanup, and safety

* Name focused files `test_<area>.py` and `<area>.spec.ts`; use one behavior
  sentence per test and include the outcome, for example
  `rejects_stale_revision_without_replacing_local_document`.
* Test IDs use `CP09-<layer>-<scenario>` in comments or parameter labels only;
  product diagnostics retain CP-11's stable code and target exactly. Tests do
  not invent a second public error catalog.
* Assert normalized error **kind**, stable diagnostic code, target path, and
  safe message separately. Never compare localized prose, raw stack traces,
  response-wrapper order, or secret values.
* Test helpers raise `FixtureContractError` or `GoldenMismatch`; these are
  harness failures, not API errors. All service cleanup is `try/finally` and
  scoped to deterministic `cp09-` test resources. Never delete a shared task,
  project, queue, or controller run.
* Fixtures use only IDs, opaque credential references, and the literal
  `<redacted>` for negative secret-rejection cases. Test logs, snapshots,
  URLs, exported documents, and failure messages must not contain values.

### Command inventory and CI use

Run commands from the stated directories. CI installs the repository's locked
server and web dependencies before running these commands; this worktree must
not install a replacement framework or add a second runner.

| Scope | Command | CI gate / expected result |
|---|---|---|
| CP-09 Python smoke | `$env:PYTHONPATH = (Get-Location).Path; py -3 -m unittest apiserver.tests.clearpipe.test_harness` from `clearml-server` | Required; exercises CP-06-valid fixture determinism and both CP-03 AST golden assertions. |
| Existing server ClearPipe tests | `$env:PYTHONPATH = (Get-Location).Path; py -3 -m unittest apiserver.tests.test_clearpipe apiserver.tests.test_clearpipe_service` from `clearml-server` | Required after a server-facing ClearPipe change. |
| Schema registration | `$env:PYTHONPATH = (Get-Location).Path; py -3 apiserver\tests\verify_clearpipe_schema.py` from `clearml-server` | Required for CP-07 schema changes. |
| Focused browser harness | `npm run test-clearpipe` from `clearml-web` | Required; runs only ClearPipe test-support specs through the dedicated target. |
| Existing `/pipelines` regression | `npm run test-pipelines-regression` from `clearml-web` | Required before modifying global web test wiring or `/pipelines` integration. |
| Web lint | `npm run lint -- --lint-file-patterns "src/app/features/clearpipe/**/*.ts"` from `clearml-web` | Required for changed browser harness scope. |
| Production build | `npm run build` from `clearml-web` | Required when a browser production consumer changes; CP-09 test-only work does not make a build pass claim. |

The local CP-09 verification record is updated below after each attempted
command. Failure due to a missing dependency is recorded verbatim and is not a
test pass.

### CP-31 acceptance-criteria coverage matrix template

CP-31 must copy this matrix, replace `planned` with test IDs and command
evidence, and record every blocked environment prerequisite.

| Acceptance criterion / risk | Unit | Contract/integration | Browser flow/E2E | Real-Agent | `/pipelines` regression | Evidence/status |
|---|---|---|---|---|---|---|
| v2 graph schema, migration, deterministic serialization | planned | planned | n/a | n/a | n/a | planned |
| typed bindings, invalid graph diagnostics, no silent loss | planned | planned | planned | n/a | n/a | planned |
| secret-free graph/source/export and safe errors | planned | planned | planned | n/a | n/a | planned |
| deterministic task/function no-launch generation | planned | planned | preview planned | real Agent gate | n/a | planned |
| permissions, flags, denied/read-only/not-found | planned | planned | planned | n/a | n/a | planned |
| stale revision preserves local draft | planned | planned | planned | n/a | n/a | planned |
| resources distinguish loading, empty, stale, denied, and failed | planned | planned | planned | n/a | n/a | planned |
| create/save/archive/delete/start handoff and queue warning | planned | planned | planned | real Agent gate | planned | planned |
| keyboard, focus, announcements, narrow/reduced-motion states | n/a | n/a | planned | n/a | n/a | planned |
| existing `/pipelines` discovery/run/delete remains intact | n/a | existing suite | existing suite | n/a | planned | planned |

### CP-09 focused verification record

* **Dependencies restored:** `npm ci --no-audit --no-fund` completed from
  `clearml-web` (1076 packages), including the locked Angular-compatible
  Jasmine/Karma dependencies.
* **Passed:** with `PYTHONPATH` set to `clearml-server`, `py -3 -m unittest
  apiserver.tests.clearpipe.test_harness` ran 3 tests; `py -3
  apiserver\tests\verify_clearpipe_schema.py` reported `clearpipe-schema: OK`;
  and `py -3 -m unittest apiserver.tests.test_clearpipe
  apiserver.tests.test_clearpipe_service` ran 29 tests.
* **Passed:** `npm run test-clearpipe` ran 3 focused test-support specs in
  ChromeHeadless. `npm run test-pipelines-regression` ran the existing
  pipeline-card-menu regression in ChromeHeadless (1 test).
* **Passed:** `npx tsc --noEmit -p tsconfig.clearpipe.spec.json` and
  `npm run lint -- --lint-file-patterns
  "src/app/features/clearpipe/**/*.ts"` from `clearml-web`. The lint run
  emits the repository's existing `.eslintignore` deprecation warning only.
* **Passed static checks:** `node --check karma.clearpipe.conf.js`,
  test-target isolation/JSON parsing, and `git diff --check`.
