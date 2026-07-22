# CP-13 — Function code generator

## Boundary

`apiserver.bll.clearpipe.generation.function` is the pure, deterministic
function-node plug-in for the selected CP-03 imperative model:
`PipelineController.add_function_step`.

Its sole input is CP-06's `FunctionLoweringInput`; it imports no UI, network,
ClearML runtime, graph codec, validator, or legacy compiler. It returns a
`FunctionStepLowering` with:

- one constrained module-level function definition;
- one `pipe.add_function_step(...)` block; and
- two graph-ID `SourceMapEntry` spans, one for each block.

The CP-12 compiler remains the only owner of imports, controller construction,
parameters, topological module ordering, full source maps/manifests, task
lowering, and no-launch definition orchestration.

## Supported lowering

The plug-in emits literal-keyword calls only. It always emits the explicit
`function_kwargs`, ordered `function_return`, and `TaskTypes.<task_type>`.
It emits `execution_queue` for a node override, `cache_executed_step=True`
when enabled, and canonical sorted/deduplicated `parents` when required.

Input values are selected in declared signature order:

1. a `data` binding becomes `${producer_step.output_name}`;
2. a `parameter` binding becomes `${pipeline.parameter_name}`;
3. an explicit input-port default is rendered as a deterministic Python JSON
   literal; or
4. a JSON-literal default in the declared signature is rendered explicitly.

Every input must resolve exactly once. Function outputs are the output ports
sorted by `(order, id)` and all multi-output return statements must use a tuple
or list with exactly that arity. A data binding's producer and every inferred
or execution-only dependency must already be in `parent_node_ids`; the plug-in
does not rely on ClearML to add an implicit parent.

CP-06 v2 currently defines `task_type`, `cache`, and `queue_resource_id`.
The lowerer also forwards declarative `packages: list[str]` and
`retry_on_failure: non-negative int` when a compatible CP-06 configuration
extension supplies them. It never invents either value from source or runtime
state, and emits neither when absent.

The generated code contains no `start`, `start_locally`, decorator local-run,
debug-run, source import, source evaluation, or runtime function inspection.

## Constrained source subset

Accepted source is exactly one top-level `def` whose name, arguments,
defaults, annotations, and return annotation exactly match `signature`.
It has no decorators, nested functions/closures, classes, async/await,
generators, imports, `global`/`nonlocal`, `eval`, `exec`, dynamic import, or
pipeline launch call. Positional-only, `*args`, and `**kwargs` signatures are
rejected because a deterministic `function_kwargs` map cannot bind them.

Function, input, and output names must be safe Python identifiers. Values are
JSON-safe finite values, object keys are canonical Unicode-code-point sorted,
and strings are escaped through Python JSON literals. Secret-bearing source
assignments/call arguments, object keys, package values, and credential URLs
are rejected without including the value in the diagnostic.

## Diagnostics

The machine-readable surface is
`clearml-server/apiserver/tests/fixtures/clearpipe_function_generator/unsupported-features.json`.
The lowerer returns value-free `FunctionGenerationError` diagnostics using the
CP-03 codes:

| Code | Function-lowering rejection |
| --- | --- |
| `CPSEM003` | invalid/non-static function source or signature |
| `CPSEM004` | unbindable argument, input mismatch, or non-JSON default |
| `CPSEM005` | invalid output names or incompatible multiple-return arity |
| `CPSEM006` | data/artifact transport not eligible for a function input |
| `CPSEM007` | invalid binding provenance or non-canonical parent set |
| `CPSEM008` | no effective queue |
| `CPSEM009` | unsupported task type/settings or source launch request |
| `CPSEM010` | secret-bearing source/value/package/URL |

## Verification fixtures

`test_clearpipe_function_generation.py` covers the canonical CP-06
two-function graph golden output, Python syntax compilation, deterministic
collection reordering, explicit defaults, queue/cache/packages/retry,
function-output references/inferred parents, ordered multiple outputs, and
secret-safe diagnostics. The golden output is
`function-graph.golden.py`; it intentionally contains no controller
construction because that is CP-12 compiler ownership.
