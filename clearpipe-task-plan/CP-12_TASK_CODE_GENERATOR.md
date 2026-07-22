# CP-12 — deterministic task code generator

## Delivered boundary

`apiserver.bll.clearpipe.generation.compiler` compiles a canonical `GraphV2`
into a `GeneratedDefinition`.  It is pure: it reads no UI state, makes no
network calls, does not inspect a base task, and never emits or invokes
`start`, `start_locally`, or debug/local execution.

The CP-12 task lowerer is
`apiserver.bll.clearpipe.generation.task.lower_task`.  It emits ordered
`PipelineController.add_step` calls from stable node IDs, with visible parent
names sorted deterministically.  The source digest intentionally excludes
canvas layout and display-only metadata, so moving a card cannot change source
or the manifest.

## Supported task subset

* `task-id` base tasks lower to `base_task_id`; project/name identity lowers to
  `base_task_project` and `base_task_name`.
* Pipeline parameter bindings lower to `${pipeline.<name>}`.
* A task output port with an approved ClearML reference (`artifacts.*.url`,
  `models.output.*.url`, `parameters.<section>/<key>`, or `id`) lowers to an
  explicit `${step.reference}` task-parameter override.
* Dataset/model/task resource bindings lower to their immutable
  `resource_id`; queue resources cannot be artifact inputs.
* Input-port defaults, per-node queue overrides, `clone_base_task=False`, and
  `cache_executed_step=True` lower explicitly.  Every node needs an effective
  node or default queue.
* Data, artifact, inferred, and execution-only dependencies all contribute one
  deduplicated parent set.  A task input never accepts generic `data`
  transport; it fails with `CPSEM006`.

CP-06 has no retry field in `TaskConfiguration`; an input containing one is
classified as unsupported by the current canonical decoder before generation.
The lowerer accepts a future compatible configuration extension only when its
`retry_on_failure` value is a non-negative integer, lowering it to
`add_step(retry_on_failure=<integer>)`. Callable retry remains explicitly
unsupported under CPSEM009, so it is never silently lost. Declared graph
outputs remain canonical authoring/export metadata; function and task output
*references* are lowered only through their typed bindings.

## Diagnostics and source maps

`GenerationError.diagnostics` supplies stable, value-free graph diagnostics:
CPSEM001 (identity/DAG), CPSEM002 (base task), CPSEM004 (unbound required
input), CPSEM006 (unsupported task data transport), CPSEM007 (reference or
binding shape), CPSEM008 (queue), CPSEM010 (secrets), plus CPGEN diagnostics for compiler/plugin-only cases.

Each result includes `SourceManifest` (schema version, semantic source digest,
topological node IDs) and `SourceMapEntry` spans for the document, parameters,
resources, nodes, and inbound bindings. Every resource endpoint used by an
artifact binding maps to its generated task-parameter use; every node-level
queue resource maps to its generated `execution_queue` use (the default queue
maps to `set_default_execution_queue`). Diagnostics never interpolate a secret
value.

## CP-13 registration seam

The compiler does not implement function lowering.  CP-13 can register its
lowerer without changing CP-12:

```python
from apiserver.bll.clearpipe.generation.compiler import ClearPipeCompiler

compiler = ClearPipeCompiler()
compiler.register_lowerer("function", lower_function)
definition = compiler.compile(graph)
```

The CP-13 lowerer receives the CP-06 `FunctionLoweringInput` contract and
returns its `FunctionStepLowering` contract.  The compiler adapts its
definition/step sections without importing or changing CP-13 lowering logic,
then supplies stable ordering, imports, manifest, source maps, and the same
no-launch boundary. Other plug-ins can return `LoweredNode` directly.

## Focused verification

```powershell
Set-Location clearml-server
py -3 -m unittest apiserver.tests.test_clearpipe_task_generator
py -3 -m py_compile apiserver\bll\clearpipe\generation\compiler.py `
  apiserver\bll\clearpipe\generation\task.py `
  apiserver\tests\fixtures\clearpipe_generation\task-graph.expected.py
```

The focused suite compares the task graph golden source, parses generated
Python without executing it, checks layout/order determinism, parameter/task/
artifact references, queue/cache/clone/integer-retry lowering, inferred-parent
deduplication, source maps, unsupported data/queue/callback diagnostics,
secret redaction, and the CP-13 registration seam.
