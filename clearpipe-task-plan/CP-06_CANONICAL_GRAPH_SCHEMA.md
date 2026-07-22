# CP-06 — ClearPipe canonical graph schema v2

## Authority and boundary

`configuration.ClearPipe` stores the canonical authoring document.  Its
current `schema_version` is **2**.  The server implementation in
`apiserver.bll.clearpipe.graph_v2` is authoritative; the browser
`domain/graph-v2.types.ts` and `graph-v2-codec.ts` are an intentionally exact
typed projection.  The contract imports no UI, service client, or executor.

This is not a public endpoint definition.  CP-07 must reference the named
`GraphV2`, `GraphReadResult` / `GraphDecodeResult`, and `UnsupportedGraph`
contracts rather than redeclaring graph fields in endpoint models.

## Persistent shape

```text
GraphV2 {
  schema_version: 2
  document: DocumentMetadata
  settings: GraphSettings
  parameters: PipelineParameter[]
  resources: ResourceReference[]
  outputs: GraphOutput[]
  nodes: (TaskNode | FunctionNode)[]
  bindings: GraphBinding[]
  visual: GraphVisual
}
```

`document.id` and `document.revision` are optional only for an unsaved draft;
the server supplies them for saved definitions. `document.name` and every node
`name` are generated-safe (`[A-Za-z][A-Za-z0-9_]*`). Port names are explicit
lowering keys (for example, `General/dataset_url`) and consequently need not
be Python identifiers. IDs are stable
(`[A-Za-z][A-Za-z0-9_-]*`) and do not change when labels or positions change.

Task nodes use either a ClearML `task-id` base reference or a project/name
fallback. Function nodes carry only a constrained, module-level source and
signature. Both define stable, directional `port` objects. A port declares
role, requiredness, order, multiplicity, and accepted binding kinds.

`resources` is the only dataset/resource representation in v2: it holds an
immutable `resource_id` and optional display label. A dataset is not an
executable generic node. Pipeline inputs are `parameters`; pipeline outputs
are `outputs` sourced from declared output ports. The sole approved control
concept is an `execution-only` binding—there are no loop, branch, callback, or
dynamic-control nodes.

## Binding discriminators

| Kind | Source | Target | Meaning |
|---|---|---|---|
| `data` | output port | input port | Declared function-object transport |
| `artifact` | output port or resource | input port | Explicit ClearML artifact/resource reference |
| `parameter` | pipeline parameter | input port | Controller parameter override |
| `inferred` | node | node, plus output `derived_from` port | Explicit dependency inferred from supported lowering |
| `execution-only` | node | node | Ordering only |

Bindings have stable IDs. Multiple kinds may connect the same node pair.
Consumers compute a sorted, deduplicated parent list; a visual edge never
means untyped data transport.

## Serialization, JSON, and secrets

The codecs accept only finite JSON values, reject unsafe object keys, and
reject secret-bearing key names, credential URLs, and secret assignments in
function source. Opaque reference IDs such as `credential_ref` remain safe as
references, but no credential value is part of this graph. Transient editor
state (selection, hover, drag, panels, request/history/clipboard/run state)
has no field in v2. Approved positions, optional dimensions, and viewport do.

Serialization sorts tags and unordered collections by stable identity, sorts
ports by direction/order/ID, sorts JSON object keys, and emits compact JSON.
Logical round-trips therefore have one deterministic representation.

## Migration and unsupported policy

`migrations.py` routes every document without mutation:

* v2 parses and normalizes to the canonical object.
* Existing v1 ClearPipe documents return
  `legacy_v1_not_losslessly_representable`, are read-only, and retain their
  complete raw JSON for export/details.
* Newer, missing, unknown-field, unknown-node, unknown-port-kind, and
  unknown-binding-kind documents also return a read-only `UnsupportedGraph`.
* Malformed known-v2 values and dangling references are `invalid` with
  value-free issue paths. No branch silently drops or repairs data.

There is intentionally no best-effort v1 conversion: the prior generic
six-node/edge model cannot prove the task/function semantics mandated by
D-07 and D-09.

## Fixtures and compatibility

The shared JSON fixtures live in
`clearml-web/src/app/features/clearpipe/domain/fixtures/` and are read by both
server and browser focused tests:

* `task-graph.v2.json` maps CP-03's two-step parameter/artifact/execution
  example.
* `function-graph.v2.json` maps CP-03's two-function data/inferred example.
* `dataset-bound-graph.v2.json` demonstrates an ID-backed dataset artifact
  binding, not a dataset card.
* `invalid-secret-graph.v2.json` proves credential-shaped values are rejected
  without echoing their contents.

The no-launch lowering handoff is named in
`apiserver.bll.clearpipe.generation.contracts`; CP-12 and CP-13 own the actual
compiler/lowerers.
