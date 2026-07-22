# CP-25 code-backed authoring

## Published UI contract

`provideClearpipeFunctionAuthoring()` registers the `function` CP-17 extension.
The extension supplies the explicit function catalog entry and constrained typed
inspector form. `clearpipeFunctionAuthoringCatalogAction()` structurally
prepares the CP-24 catalog-action registration; the active generic-host owner
will mount `ClearpipeFunctionAuthoringCreateComponent` through that seam.
CP-25 does not modify the generic framework or routes.

`ClearpipeFunctionAuthoringService.create(definition)` creates a function only
through CP-10's `createFunctionNode`. `update(node, definition)` uses CP-10
node/configuration/port commands in one transaction. It deliberately creates
no bindings: CP-20 remains the sole semantic-edge controller.

The form accepts explicit `signature` and `source` unchanged. Its bounded
admission check has no parser, evaluator, import, signature inference, source
concatenation, or browser generator. CP-11/CP-13 remain authoritative through
the existing validation/preview API.

## CP-26 / CP-29 handoff

Function nodes provide stable `node.id`, stable input/output `port.id`, explicit
port names/order/types, canonical bindings, and the ordinary CP-13 source-map
and generated-definition response. CP-26 should correlate execution feedback
with those IDs/source-map entries. CP-29 should preserve those canonical fields
when converting existing supported definitions; it must reject source that
fails CP-13 rather than infer a signature.

## Verified contract gaps

CP-06 v2 currently only persists `task_type`, `cache`, and `queue_resource_id` on
function configuration. It has no fields for packages, retry policy,
description distinct from `label`, safe component reference metadata, or
source/signature mutation commands. CP-25 therefore rejects packages, retry,
and references with `CP25CONTRACT001`, and source/signature updates with
`CP25CONTRACT002`, rather than create shadow state or modify CP-06/CP-10. The
in-flight graph-contract correction owns those persisted fields; once it lands,
the CP-25 form can expose them through the canonical commands.

Bound ports are immutable in CP-25. A removal or semantic port change returns
`CP25BOUND001` and the form directs the user to CP-20's disconnect/remap flow;
it never silently drops bindings.

CP-18 registers `component` as unavailable because the authorized adapter has
no component query. CP-25 therefore exposes only the approved
explicit-definition route and does not fabricate a remote catalogue.
