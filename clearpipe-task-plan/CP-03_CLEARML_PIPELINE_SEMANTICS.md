# CP-03 — ClearML pipeline semantics and function-generation decision

**Decision status:** handoff-ready discovery finding.
**Primary function target:** `PipelineController.add_function_step` (the imperative controller API).
**Mixed graph policy:** supported in generated output: one `PipelineController` may contain both `add_step` and `add_function_step` nodes. The policy applies only to the constrained subsets below; it does not make decorator code importable.

## Version and command evidence

Evidence was collected against the ClearML source commit
[`77e66d8c36c79c6904ce66b22c9878dba30f20d5`](https://github.com/allegroai/clearml/tree/77e66d8c36c79c6904ce66b22c9878dba30f20d5)
on 2026-07-22. Its `clearml/version.py` and the current PyPI index both report
**ClearML 2.1.10**. `py -3 -c "import clearml"` reported no locally installed
package in this worktree, so conclusions are source-validated rather than
runtime-service-validated.

The following commands were run from `D:\Projects\clearml\.worktrees\cp-03`;
they are reproducible without trusting a README:

```powershell
$sha = (git ls-remote https://github.com/allegroai/clearml.git HEAD).Split("`t")[0]
curl.exe -L --fail --silent --show-error `
  "https://api.github.com/repos/allegroai/clearml/contents/examples/pipeline?ref=$sha"
curl.exe -L --fail --silent --show-error `
  "https://raw.githubusercontent.com/allegroai/clearml/$sha/clearml/automation/controller.py"
py -3 -m pip index versions clearml
```

The directory listing contained exactly the ten Python files below plus
`requirements.txt`. Each Python source file was retrieved and inspected in
full, including the three task definitions; no README was used as semantic
evidence:

- `examples/pipeline/pipeline_from_tasks.py` plus its three real base-task scripts (`step1_dataset_artifact.py`, `step2_data_processing.py`, and `step3_train_model.py`): task lookup, pipeline parameters, task/artifact references, explicit parents, queue, callbacks, remote and local starts.
- `pipeline_from_functions.py` and `decorated_pipeline_step_functions.py`: controller function steps, defaults, named returns, artifact references, inferred parent references, cache, queue, and local step subprocesses.
- `pipeline_from_decorator.py`, `full_tabular_data_process_pipeline_example.py`, and `decorated_pipeline_step_decorators.py`: component/pipeline decorators, multiple returns, lazy evaluation, cache, task type, output URI, and local mode.
- `clearml/automation/controller.py`: controller `Node`, `add_step`, `add_function_step`, `_add_function_step`, DAG verification/reference parsing, execution starts, and decorator implementation.
- `clearml/backend_interface/task/populate.py`: generated-function template and its source extraction/return serialization behavior.

No example was executed. The evidence establishes API semantics, not availability
of a particular ClearML backend, queue, agent, credentials, or serializer.

## Graph-to-ClearML semantic mapping

| Canonical graph concept | Task-backed lowering | Function-backed lowering (selected model) | Semantics / validation rule |
|---|---|---|---|
| Pipeline/controller metadata | `PipelineController(name, project, version, ...)` | Same controller | Creates a controller `Task` (`TaskTypes.controller`), with pipeline tag and version. Preserve name/project/version, controller queue, default step queue, output URI, target project, and failure policy only when represented. Version must be valid semantic version when supplied. |
| Pipeline parameter | `add_parameter(name, default, description, param_type)` and `${pipeline.name}` | Same | It is controller hyperparameter `Pipeline/name`, not a step port. Only explicit declared parameters generate `${pipeline.<name>}`. |
| Task node identity | `add_step(name, base_task_id=...)` | n/a | `name` is a unique graph node/ref namespace. A base task is either an immutable ClearML task ID or a project/name lookup; generation must prefer ID. With default `clone_base_task=True`, each run clones then enqueues; `False` requires an existing draft task. |
| Function node identity | n/a | `add_function_step(name, function=global_function, ...)` | `name` must be unique. ClearML materializes a generated task definition from inspected source and stores it in the controller configuration. Generated graph code must define each function at module scope before controller construction. |
| Control/order edge | `parents=[upstream]` | `parents=[upstream]` | A child launches only after successful parents. This is an execution-only dependency: it carries no value. Emit it for each explicit control edge. |
| Pipeline-parameter edge | parameter override value `${pipeline.p}` | `function_kwargs={arg: '${pipeline.p}'}` | Data/configuration binding from controller parameter, not a parent edge. The source parameter must exist. |
| Task parameter edge | `parameter_override={'Section/key': '${up.parameters.Section/key}'}` | only as a string/reference value where API accepts it | Reads a predecessor task parameter. It is distinct from function return transport. A task parameter key must include a section (`Section/key`). |
| Task artifact edge | `parameter_override={'Section/key': '${up.artifacts.artifact.url}'}` | use only an explicit function input from an eligible function output | Task artifacts are task-owned files/objects; task references can request `.url`. They do not declare a typed graph output. Do not fabricate artifact names from a base task. |
| Task/model/task-ID edge | `${up.models.output.-1.url}`, `${up.id}`, or supported task property reference | `${up.id}` only where the function argument is deliberately an ID/string | These are runtime ClearML references, not generic object ports. Treat models, task IDs, script/execution/container/output/comment/tags/project property references as explicit reference kinds, never infer them from an ordinary data edge. |
| Function input | n/a | `function_kwargs` | Scalars (`str`, `int`, `float`, `bool`) become generated task kwargs. A non-scalar literal is uploaded to the controller as an input artifact. A reference `${up.output}` to a declared function output becomes `${up.id}.output` in Input Artifacts and is loaded from either an artifact or `Return/output` parameter. |
| Function default | n/a | missing kwargs are populated from inspectable Python positional defaults | Do not rely on runtime introspection for generated graphs: emit the chosen defaults explicitly in `function_kwargs`. Required omitted parameters are rejected by ClearPipe validation. |
| Function output / multi-output | n/a | `function_return=['left', 'right']` | Ordered, explicitly declared names define output ports. Template zips names to a tuple/list result; scalar/basic results (`float`, `int`, `bool`, `str`) are stored at `Return/name`, all other results are artifacts. Enforce a positive unique output-name list and a declared arity matching the generated function contract; ClearML's zip otherwise silently truncates mismatches. |
| Inferred dependency | controller validation adds referenced predecessor as parent | same | A top-level `${step...}` reference in node parameters causes `_verify_node` to add its referenced node as a parent when not already present. ClearPipe must compute it before emission, emit one deduplicated parent list, and reject contradictory references rather than depend on this mutation. |
| Queue | node `execution_queue`, otherwise controller default | same | Every node needs a node queue or default queue at controller verification. The controller itself starts on `services` by default; this is separate from step queues. |
| Cache | `cache_executed_step=True` | same | Cache searches for an exact executed task after effective configuration/code update. It requires a pinned git commit to reuse; it is not a pure graph memoization guarantee. |
| Retries/failure | `retry_on_failure`, `continue_behaviour`, optional time limit | same | Integer retry count is representable. Callback retry and all lifecycle callbacks are executable behavior, not declarative graph data. `continue_behaviour` controls continue/skip after failed or aborted steps. |
| Monitoring/output destination | monitor metrics/artifacts/models, `output_uri`, task/config overrides | same monitoring/output URI options | These are execution/reporting configuration, not data ports. Preserve only the declarative string/list forms allowed below. |
| Start mode | `start(queue, wait)` or `start_locally(run_pipeline_steps_locally)` | same | `start()` remotes the controller process; `start_locally()` leaves controller local, optionally running component tasks as local subprocesses. Generation is declarative and must not emit an automatic start invocation. |

### Dependency classes that CP-06 must keep separate

Use an edge/binding `kind` enum rather than one overloaded edge:

1. **`data`** — an object/value port from a declared function return to a function input; lowers to the Input Artifacts reference `${producer.id}.return_name`.
2. **`artifact`** — a task-owned artifact/property reference, normally `${producer.artifacts.name.url}` for a task parameter; it is not a function object-port claim.
3. **`parameter`** — controller parameter or predecessor task parameter binding; it configures a target parameter/argument.
4. **`inferred`** — provenance recorded when the graph compiler derives a parent from one of the preceding reference bindings. It is not independently user-editable transport.
5. **`execution-only`** — `parents` ordering, queue, cache, timeout, retry, failure continuation, monitors, and stage. It never implies a value transfer.

A graph may have both `data`/`artifact` and `execution-only` relationships between the same two nodes. The compiler merges their required parents, sorts/deduplicates names deterministically, and rejects a self edge or cycle.

## Decision memo — function code-generation model

### Options considered

| Option | Strengths | Why it is not the primary target |
|---|---|---|
| Imperative `PipelineController.add_function_step` | Direct static correspondence: graph node → one named call; explicit `function_kwargs`, `function_return`, `parents`, queues, cache and task settings. It supports task and function nodes in the same controller. `${step.output}` is documented by the shipped function example. | **Selected.** Its inspect-based source generation still limits function bodies, so ClearPipe must generate only declared source snippets and never claim arbitrary import/round-trip. |
| `@PipelineDecorator.component` plus `@PipelineDecorator.pipeline` | Compact author-written Python; component defaults and lazy outputs create dependencies; supports package/task-type/queue/cache controls. | Decorated pipeline logic is executable Python. Branches, loops, repeated calls (which receive generated suffix names), evaluation/printing of lazy values, `debug_pipeline`, and decorator stacks determine the runtime DAG. It has no one-node/one-static-call lowering or safe general importer. |
| Decorator component used ad hoc/eagerly | Useful to library authors and can retain wrapper decorators. | It may construct an ad-hoc pipeline at call time and chooses queue/local behavior from ambient task state. This is not a stable serialized graph contract. |

### Selected lowering

Generate a module containing module-level, self-contained function definitions followed by one `PipelineController` and ordered `add_function_step` / `add_step` calls. The generator must set all function input defaults and all `function_return` names explicitly, then emit deterministic parent/reference lists. It must not call `start`, `start_locally`, `PipelineDecorator.run_locally`, or `debug_pipeline`.

Mixed graphs are supported **at generation time** because both node forms create the same controller `Node` DAG. A function may consume a declared function output from another function. A task may order after a function or function after a task using `parents`; cross-style value transfer is only supported where an explicit ClearML-compatible reference binding is represented (for example a task artifact URL into a task parameter, or a task ID passed as a scalar function argument). ClearPipe does not infer output schemas from a task's source or execution history.

## Machine-checkable supported-feature matrix

`yes` means generator/import contract support, not that a backend has a compatible agent, credentials, queue, package, or serializer.

| Capability | Task node | Function node (imperative) | Decorator code import | Contract/result |
|---|---:|---:|---:|---|
| Unique static node name | yes | yes | no | Required; reject duplicates/reserved `pipeline`. |
| Stable base identity | yes: task ID preferred | n/a | n/a | ID or project/name lookup; no task code inspection. |
| Generated source body | n/a | yes, constrained module-level function | no | Input is authored `source` plus declared signature, not extracted arbitrary Python. |
| Scalar defaults / explicit arguments | parameter overrides | yes | no | JSON scalar/null only; key must be declared function argument. |
| Non-scalar literal input | no generic object port | yes, ClearML controller upload | no | Allow only JSON object/array values that the graph can serialize; reject opaque Python values. |
| Named output ports | declared artifact names only | yes | no | Function outputs are ordered names; scalar may be `Return/name`, object an artifact. |
| Multiple outputs | task artifact names may be referenced explicitly | yes | no | Require ordered unique names and compatible declared function arity. |
| Explicit control parent | yes | yes | no | Compiled to canonical sorted `parents`. |
| Reference-derived parent | yes | yes | no | Compiler records it as `inferred`, merges it into `parents`. |
| Pipeline parameter binding | yes | yes | no | Explicit declaration and `${pipeline.name}` only. |
| Task parameter/artifact/model/ID refs | yes | limited: ID/scalar only | no | Validate permitted reference grammar/kind. |
| Function-output-to-function-input data edge | n/a | yes | no | Only declared producer output → declared consumer argument. |
| Per-node queue / default queue | yes | yes | no | Require one effective step queue. |
| Cache flag | yes | yes | no | Boolean only; warn/reject cache-with-unpinned-repo according to downstream policy. |
| Task type / packages / repo / docker / output URI | yes, task/task overrides are limited | yes | no | Permit declarative scalar/list fields; no credentials/secrets. |
| Timeout, integer retry, declarative continuation, stage | yes | yes | no | Integer retry only; continuation keys limited to ClearML's four booleans. |
| Monitoring lists | yes | yes | no | String or string-pair forms only. |
| Callbacks/factories/callable serializers | no | no | no | Reject: they require arbitrary executable callable behavior. |
| Local/remote launch selection | metadata only | metadata only | no | Generate no launch call; product executes separately. |
| Import existing source | task metadata only | constrained generated pattern only | no general import | Never execute code; no AST/control-flow recovery or arbitrary round trip. |

### Constrained generated/importable subset

A future importer may accept only ClearPipe-generated files that match this exact imperative shape: imports; top-level `def` functions; one controller construction; `add_parameter`; and literal-keyword `add_step`/`add_function_step` calls with no loops, conditionals, aliases, unpacking, mutation, decorators, callbacks, lambdas, or dynamic expressions. It must parse AST only, never import/execute the file. It must verify the embedded/source manifest and reject the file if it differs from the deterministic output shape.

This report does **not** claim import support is implemented. Decorated pipelines, arbitrary `PipelineController` programs, existing task scripts, callables, closures, dynamic package/repository expressions, and source discovered from ClearML task diffs are unsupported inputs unless a later owner explicitly implements and validates them.

## Rejection and unsupported behavior

Fail graph validation before code generation with a stable code and target path; never silently drop an edge, output, or policy.

| Code | Reject condition | Reason / required remediation |
|---|---|---|
| `CPSEM001` | duplicate/empty/reserved node name; self-edge or cycle | ClearML needs unique names and a DAG. Rename or remove cycle. |
| `CPSEM002` | task node has no base task ID or project/name identity | `add_step` cannot resolve a base task. Supply identity; prefer immutable ID. |
| `CPSEM003` | function node lacks module-level source/signature, has closure/local/lambda/async/generator body, or uses unsupported dynamic construct | ClearML extracts source with `inspect`; ClearPipe will not execute or guess source. Supply constrained explicit function source. |
| `CPSEM004` | function argument absent, required argument omitted, or default/input is opaque/non-JSON | Generated kwargs must bind declared arguments deterministically. |
| `CPSEM005` | output names empty/duplicate/invalid, or declared multi-return arity conflicts with the generated function contract | ClearML zips result names and values and can truncate; fix explicit ordered outputs/body. |
| `CPSEM006` | data edge references a non-function output or an unknown output/argument | Only declared function output ports may use object transport. Use an explicit task artifact/parameter/ID binding for task nodes. |
| `CPSEM007` | unsupported reference grammar, source missing, nested reference without explicit supported lowering, or conflicting inferred/explicit topology | Keep parameter/artifact/model/ID references explicit; normalize one parent set or revise graph. |
| `CPSEM008` | no effective step queue | ClearML validates node/default queue presence. Set controller default or node queue. |
| `CPSEM009` | callback, base-task factory, callable retry, custom serializer/deserializer, decorator pipeline, dynamic loop/branch, or local debug/run request | These are execution behavior, not a static graph. Model externally or reject. |
| `CPSEM010` | secret/credential is present in metadata, parameter/default, package/repo/docker field, source manifest, export, or URL | Reject; use product secret references at runtime, never graph state/generated output. |
| `CPSEM011` | cache enabled with an unpinned/unknown repository commit under strict reproducibility policy | ClearML documents no cache reuse without a specific commit. Pin commit or disable cache. |

Warnings (not auto-fixes): a task project/name lookup is mutable; basic function returns are stored as `Return/name` parameters rather than artifacts; and actual execution can still fail from unavailable queues, packages, permissions, remote repository access, or unserializable runtime values.

## Representative semantic fixtures

The following are semantic fixtures for CP-12 (task generator) and CP-13
(function generator). The machine-readable canonical fixtures and deterministic
source snapshots are:

| Consumer | Graph fixture | Expected deterministic source | SHA-256 |
|---|---|---|---|
| CP-12 | `fixtures/cp-03/two-step-task.yaml` | `fixtures/cp-03/two-step-task.expected.py` | `461CB057C0A47BA862AD5F3882C3137353EF59304E95BF0FA50410615F77B6ED` |
| CP-13 | `fixtures/cp-03/two-function.yaml` | `fixtures/cp-03/two-function.expected.py` | `558726ED15A50F80FAD62AC11FDF99C3AD86C31B47EB4CB98DEC5B872A8FAB90` |

They are definitions only: do not execute their referenced tasks/functions.
The snapshots intentionally construct/configure only; they have no `start` or
`start_locally` call. The inline forms below explain their semantics, while the
files above are authoritative for golden comparisons.

### Fixture A — CP-12 `two-step-task.yaml`

```yaml
id: two_step_task_artifact_parameter
controller:
  name: iris-task-pipeline
  project: examples
  version: 1.0.0
  default_execution_queue: default
parameters:
  dataset_url:
    default: https://example.invalid/iris.pkl
    description: dataset URL
nodes:
  - id: stage_data
    kind: task
    base_task:
      project: examples
      name: Pipeline step 1 dataset artifact
    parameter_overrides:
      General/dataset_url: ${pipeline.dataset_url}
  - id: stage_process
    kind: task
    base_task:
      project: examples
      name: Pipeline step 2 process dataset
    parents: [stage_data]
    parameter_overrides:
      General/dataset_url: ${stage_data.artifacts.dataset.url}
      General/test_size: 0.25
edges:
  - {kind: parameter, from: pipeline.dataset_url, to: stage_data.General/dataset_url}
  - {kind: execution-only, from: stage_data, to: stage_process}
  - {kind: artifact, from: stage_data.artifacts.dataset.url, to: stage_process.General/dataset_url}
expected_lowering:
  - "pipe.add_parameter('dataset_url', default='https://example.invalid/iris.pkl', description='dataset URL')"
  - "pipe.add_step(name='stage_data', base_task_project='examples', base_task_name='Pipeline step 1 dataset artifact', parameter_override={'General/dataset_url': '${pipeline.dataset_url}'})"
  - "pipe.add_step(name='stage_process', parents=['stage_data'], base_task_project='examples', base_task_name='Pipeline step 2 process dataset', parameter_override={'General/dataset_url': '${stage_data.artifacts.dataset.url}', 'General/test_size': 0.25})"
```

Expected semantics: the first node is a cloned base task and its controller parameter is not an artifact. `stage_process` has one explicit execution parent and receives the URL property of `stage_data`'s uploaded `dataset` artifact. This fixture deliberately makes no claim that the selected base task presently owns that override or that either task is importable from source.

### Fixture B — CP-13 `two-function.yaml`

```yaml
id: two_function_declared_data_edge
controller:
  name: function-pipeline
  project: examples
  version: 1.0.0
  default_execution_queue: default
nodes:
  - id: normalize
    kind: function
    signature: "def normalize(value: int, increment: int = 1) -> int"
    source: |
      def normalize(value: int, increment: int = 1) -> int:
          return value + increment
    inputs:
      value: 41
      increment: 1
    outputs: [normalized]
    task_type: data_processing
    cache: true
  - id: format_result
    kind: function
    signature: "def format_result(value: int, prefix: str = 'result=') -> str"
    source: |
      def format_result(value: int, prefix: str = 'result=') -> str:
          return f"{prefix}{value}"
    inputs:
      value: ${normalize.normalized}
      prefix: result=
    outputs: [text]
    task_type: qc
    cache: true
edges:
  - {kind: data, from: normalize.normalized, to: format_result.value}
  - {kind: inferred, from: normalize, to: format_result, derived_from: normalize.normalized}
expected_lowering:
  - "pipe.add_function_step(name='normalize', function=normalize, function_kwargs={'value': 41, 'increment': 1}, function_return=['normalized'], task_type=TaskTypes.data_processing, cache_executed_step=True)"
  - "pipe.add_function_step(name='format_result', function=format_result, function_kwargs={'value': '${normalize.normalized}', 'prefix': 'result='}, function_return=['text'], task_type=TaskTypes.qc, cache_executed_step=True, parents=['normalize'])"
```

Expected semantics: `normalized` is a basic integer and therefore ClearML stores it as `Return/normalized`; its downstream generated task resolves it through the function input-artifact reference mechanism. The compiler records and emits the inferred parent as `parents=['normalize']` deterministically. The fixture uses a single named output per function to avoid ambiguous return arity; `function_return=['a', 'b']` is allowed only with an explicit compatible two-value return contract.

### Fixture verification evidence

The following focused validation passed on 2026-07-22:

```powershell
py -3 -m compileall -q clearpipe-task-plan\fixtures\cp-03
# result: success
```

An additional standard-library assertion read both snapshots and passed. It
confirmed `${pipeline.dataset_url}`,
`${stage_data.artifacts.dataset.url}`, and `${normalize.normalized}` are present
exactly; it confirmed the canonical parent lists
`["stage_data"]`/`["normalize"]`; and it rejected either `.start(` or
`.start_locally(` in either snapshot. Re-hashing the source files produced the
SHA-256 values in the table. This is a deterministic syntax/reference check,
not a ClearML service execution.

## Acceptance-criteria closure

| Acceptance criterion | Completed evidence |
|---|---|
| Task and function semantics map to actual ClearML behavior | The graph-to-ClearML table is tied to the complete v2.1.10 source/example set, including controller reference verification and function serialization. |
| One primary function-generation target is selected with reasons | The decision memo selects imperative `PipelineController.add_function_step` and rejects decorator code as an importer/generator target. |
| Data, artifact, parameter, inferred, and execution-only dependencies are distinct | The five-kind contract and lowering rules are specified separately, with parent merge/deduplication behavior. |
| Multiple outputs and unsupported constructs have defined behavior | Ordered named return behavior, scalar/object storage, arity validation, stable `CPSEM001`–`CPSEM011` rejections, and warnings are defined. |
| Two-step task and two-function fixtures exist | The two YAML graph fixtures and their source snapshots are in `fixtures/cp-03/`; syntax and exact-reference assertions passed. |
| Reference syntax is deterministic | Expected source snapshots, canonical ordered parents, SHA-256 values, and the focused assertion provide repeatable evidence. |

## Downstream handoff

- **CP-05:** use the selected imperative function target and the five dependency classes; do not make decorator import a primary architecture path.
- **CP-06:** encode `node.kind`, base task identity, declared function signature/source/inputs/ordered outputs, typed bindings, dependency provenance, and all policy fields as enums/validated records.
- **CP-12:** implement Fixture A without source inspection; preserve exact task references and explicit base task identity.
- **CP-13:** implement Fixture B using module-level functions and `add_function_step`; enforce the output-arity and input/reference rejections above.

Open product gates: confirm backend API/agent compatibility for any selected queue, serializer, and task-property reference at integration time. Those runtime prerequisites do not alter this static semantic contract.
