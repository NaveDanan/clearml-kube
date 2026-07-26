"""Execution projection for stop boundaries authored by the flow editor.

Graph v2 deliberately keeps canvas-only authoring data out of its canonical
schema.  The flow editor therefore stores boundaries in a
``# clearpipe-flow-graph:`` source marker.  A stop boundary cuts dependencies
that leave its rectangle.  Nodes that become unreachable from the graph's
original roots are omitted from the generated PipelineController program.
"""

from dataclasses import dataclass, replace
import json
import math
from typing import Mapping, Optional, Tuple

from ..graph_v2 import (
    ArtifactBinding,
    DataBinding,
    ExecutionOnlyBinding,
    GraphV2,
    InferredBinding,
    NodeEndpoint,
    PortEndpoint,
)


FLOW_GRAPH_META_TAG = "# clearpipe-flow-graph:"
DEFAULT_NODE_WIDTH = 240.0
DEFAULT_NODE_HEIGHT = 92.0


@dataclass(frozen=True)
class FlowBoundaryProjection:
    """Projected runtime graph plus deterministic boundary audit metadata."""

    graph: GraphV2
    excluded_node_ids: Tuple[str, ...] = ()
    cut_binding_ids: Tuple[str, ...] = ()


def _flow_graph_meta(graph: GraphV2) -> Optional[dict]:
    for node in graph.nodes:
        source = getattr(node, "source", None)
        if not isinstance(source, str):
            continue
        for line in source.splitlines():
            stripped = line.strip()
            if not stripped.startswith(FLOW_GRAPH_META_TAG):
                continue
            try:
                value = json.loads(stripped[len(FLOW_GRAPH_META_TAG):].strip())
            except (TypeError, ValueError):
                return None
            return value if isinstance(value, dict) else None
    return None


def _stop_boundaries(graph: GraphV2) -> Tuple[dict, ...]:
    meta = _flow_graph_meta(graph)
    raw = meta.get("boundaries") if isinstance(meta, dict) else None
    if not isinstance(raw, list):
        return ()
    result = []
    for item in raw:
        if not isinstance(item, Mapping) or item.get("onReach", "stop") != "stop":
            continue
        position = item.get("position")
        values = (
            position.get("x") if isinstance(position, Mapping) else None,
            position.get("y") if isinstance(position, Mapping) else None,
            item.get("width"),
            item.get("height"),
        )
        if (
            any(type(value) not in (int, float) or not math.isfinite(value) for value in values)
            or values[2] <= 0
            or values[3] <= 0
        ):
            continue
        result.append(
            {
                "id": item.get("id") if isinstance(item.get("id"), str) else "",
                "x": float(values[0]),
                "y": float(values[1]),
                "width": float(values[2]),
                "height": float(values[3]),
            }
        )
    return tuple(result)


def _inside(boundary: Mapping, node: object) -> bool:
    visual = getattr(node, "visual", None)
    position = getattr(visual, "position", None)
    if position is None:
        return False
    dimensions = getattr(visual, "dimensions", None)
    width = getattr(dimensions, "width", DEFAULT_NODE_WIDTH)
    height = getattr(dimensions, "height", DEFAULT_NODE_HEIGHT)
    center_x = position.x + width / 2.0
    center_y = position.y + height / 2.0
    return (
        boundary["x"] <= center_x <= boundary["x"] + boundary["width"]
        and boundary["y"] <= center_y <= boundary["y"] + boundary["height"]
    )


def _dependency(binding: object) -> Optional[Tuple[str, str]]:
    if isinstance(binding, DataBinding):
        return binding.source.node_id, binding.target.node_id
    if isinstance(binding, ArtifactBinding) and isinstance(binding.source, PortEndpoint):
        return binding.source.node_id, binding.target.node_id
    if isinstance(binding, (InferredBinding, ExecutionOnlyBinding)):
        return binding.source.node_id, binding.target.node_id
    return None


def _binding_node_ids(binding: object) -> Tuple[str, ...]:
    result = []
    for endpoint in (getattr(binding, "source", None), getattr(binding, "target", None)):
        if isinstance(endpoint, (NodeEndpoint, PortEndpoint)):
            result.append(endpoint.node_id)
    derived = getattr(binding, "derived_from", None)
    if isinstance(derived, PortEndpoint):
        result.append(derived.node_id)
    return tuple(result)


def project_flow_boundaries(graph: GraphV2) -> FlowBoundaryProjection:
    """Apply every authored ``onReach=stop`` boundary to a canonical graph."""

    boundaries = _stop_boundaries(graph)
    if not boundaries:
        return FlowBoundaryProjection(graph=graph)

    node_by_id = {node.id: node for node in graph.nodes}
    contained = {
        index: {node.id for node in graph.nodes if _inside(boundary, node)}
        for index, boundary in enumerate(boundaries)
    }
    dependencies = {
        binding.id: dependency
        for binding in graph.bindings
        if (dependency := _dependency(binding)) is not None
    }
    cut_binding_ids = {
        binding_id
        for binding_id, (source_id, target_id) in dependencies.items()
        if any(
            source_id in contained[index] and target_id not in contained[index]
            for index in contained
        )
    }
    if not cut_binding_ids:
        return FlowBoundaryProjection(graph=graph)

    parents = {node_id: set() for node_id in node_by_id}
    children = {node_id: set() for node_id in node_by_id}
    for source_id, target_id in dependencies.values():
        if source_id in node_by_id and target_id in node_by_id:
            parents[target_id].add(source_id)
    for binding_id, (source_id, target_id) in dependencies.items():
        if (
            binding_id not in cut_binding_ids
            and source_id in node_by_id
            and target_id in node_by_id
        ):
            children[source_id].add(target_id)

    reachable = set()
    pending = sorted(
        (node_id for node_id, parent_ids in parents.items() if not parent_ids)
    )
    while pending:
        node_id = pending.pop(0)
        if node_id in reachable:
            continue
        reachable.add(node_id)
        pending.extend(sorted(children[node_id] - reachable))

    excluded = set(node_by_id) - reachable
    retained_bindings = tuple(
        binding
        for binding in graph.bindings
        if binding.id not in cut_binding_ids
        and all(node_id in reachable for node_id in _binding_node_ids(binding))
    )
    if not excluded:
        return FlowBoundaryProjection(
            graph=replace(graph, bindings=retained_bindings),
            cut_binding_ids=tuple(sorted(cut_binding_ids)),
        )

    retained_outputs = tuple(
        output for output in graph.outputs if output.source.node_id in reachable
    )
    projected = replace(
        graph,
        nodes=tuple(node for node in graph.nodes if node.id in reachable),
        bindings=retained_bindings,
        outputs=retained_outputs,
    )
    return FlowBoundaryProjection(
        graph=projected,
        excluded_node_ids=tuple(sorted(excluded)),
        cut_binding_ids=tuple(sorted(cut_binding_ids)),
    )
