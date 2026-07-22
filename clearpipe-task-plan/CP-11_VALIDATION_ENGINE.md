# CP-11 — ClearPipe validation engine

## Boundary

`apiserver.bll.clearpipe.validation` is the one deterministic validation and
preflight engine for canonical ClearPipe graph v2. It calls CP-06's
`read_graph_v2` for parsing, migration classification, JSON/secret safety,
reference checks, multiplicity, and DAG-cycle decisions. It does not copy,
repair, or mutate those decisions; unsupported/legacy documents remain
read-only diagnostics.

The module imports no database, service, queue, HTTP, or generator code. It
never executes user source: function inspection uses `ast.parse` only.

## Public contract

* `ValidationEngine.validate_full(raw)` returns a deterministic
  `ValidationResult` for structural and CP-03 semantic diagnostics.
* `ValidationEngine.validate_incremental(raw, affected)` returns only
  diagnostics addressing affected graph paths/IDs, plus graph-level diagnostics.
* `await ValidationEngine.preflight(raw, resolver)` adds resource outcomes and
  returns `PreflightResult`.
* `validate_graph`, `validate_incremental`, and `preflight_graph` are matching
  convenience APIs.
* Generator owners may implement the pure `ValidationContributor` interface and
  return `ValidationIssue` items. CP-11 imports no generator implementation.

Every issue contains the stable `code`, `severity`, a typed `target`
(`graph`, `node`, `field`, `port`, `binding`, `resource`, or `parameter`),
safe user-facing `message`, `correction`, and explicit `blocks_save` /
`blocks_run` policy. Results sort by target path and code using Unicode
code-point order.

`valid` remains save-validity for the current outer API envelope.
`save_valid` and `run_valid` make the differing draft/execution policy
explicit. An empty v2 draft can be saved locally but receives `CPPRE001` and
cannot run.

## Stable catalog

| Code | Severity | Blocking | Meaning |
|---|---|---|---|
| `CPSTR001` | error | save/run | Invalid canonical v2 structural document not mapped to a CP-03 semantic rule |
| `CPSTR002` | error | save/run | Legacy/future/unsupported representation; read-only, never auto-converted |
| `CPSEM001` | error | save/run | Invalid/duplicate/reserved node name or CP-06 cycle/self-edge |
| `CPSEM002` | error | save/run | Missing task base identity |
| `CPSEM003` | error | save/run | Invalid constrained function source/signature |
| `CPSEM004` | error | save/run | Missing/unknown function argument or unbound required input |
| `CPSEM005` | error | save/run | Invalid output declaration or return arity |
| `CPSEM006` | error | save/run | Invalid function data binding |
| `CPSEM007` | error | save/run | Unsupported reference, artifact/parameter binding, or conflicting dependency |
| `CPSEM008` | error | save/run | No effective node queue |
| `CPSEM009` | error | save/run | Dynamic execution construct (control flow, callback/factory/serializer, local/debug run) |
| `CPSEM010` | error | save/run | CP-06 secret/credential rejection |
| `CPSEM011` | error | save/run | Strict-policy cache with no pinned repository commit |
| `CPRES001` | error | save/run | Referenced resource deleted/missing |
| `CPRES002` | error | save/run | Referenced resource denied |
| `CPRES003` | warning | run | Resource reference is stale |
| `CPRES004` | info | run | Resource check pending because no resolver is attached |
| `CPRES005` | warning | run | Resource service unavailable/invalid resolver outcome |
| `CPPRE001` | error | run | Empty draft cannot generate/run |
| `CPGEN001` | error | save/run | Invalid generator-contributor response |
| `CPWARN001` | warning | neither | Mutable task project/name identity; prefer immutable task ID |

## Resource resolver

The asynchronous boundary is:

```python
class ResourceResolver:
    async def resolve(self, request: ResourceRequest) -> ResourceResolution:
        ...
```

`ResourceRequest` carries only resource kind, safe ID or project/name lookup
keys, and the diagnostic target. `ResourceResolution.status` is exactly one of
`available`, `missing`, `denied`, `stale`, `pending`, or `unavailable`.
Resolver details/exceptions are never exposed in diagnostics. The engine calls
requests in sorted order and maps statuses to the `CPRES` catalog above.

CP-18/service ownership supplies the authorized resolver. The retained
`GraphValidator` constructor is only an import-compatible structural/semantic
facade; its former synchronous resource callbacks are not a resource-validation
path. Production save/run integration must call asynchronous preflight with the
real company-authorized resolver.

## Semantic policy

The engine accepts only CP-06's five bindings. It enforces function-to-function
data transport, explicit artifact/parameter roles, declared inferred data
dependencies, required ports, task/function identity, constrained static
function source, effective queue selection, and optional strict cache policy.
It neither guesses task output schemas nor treats a visual connection as data
transport. Task/function mixed mode can use only explicit compatible
artifact/parameter/ordering forms.
