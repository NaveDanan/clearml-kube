import json
from dataclasses import replace

from apiserver.bll.clearpipe.generation.compiler import compile_graph
from apiserver.bll.clearpipe.generation.flow_boundaries import project_flow_boundaries
from apiserver.bll.clearpipe.generation.flow_nodes import lower_flow_function_node
from apiserver.bll.clearpipe.graph_v2 import read_graph_v2
from apiserver.tests.clearpipe.factories import binding, function_node, graph_document, port


def _source(name, node_type, graph_meta=None):
    lines = [
        "# clearpipe-flow-node:" + json.dumps({"type": node_type, "config": {}}),
    ]
    if graph_meta is not None:
        lines.append("# clearpipe-flow-graph:" + json.dumps(graph_meta))
    lines.extend(("def {}() -> object:".format(name), "    return True", ""))
    return "\n".join(lines)


def _boundary_graph(with_alternate_root=False):
    boundary = {
        "id": "boundary-1",
        "position": {"x": 0, "y": 0},
        "width": 620,
        "height": 260,
        "label": "Stop after Dataset",
        "onReach": "stop",
    }
    output_ports = [
        port(
            "out-result",
            name="result",
            direction="output",
            role="data",
            accepted_binding_kinds=["data"],
            multiplicity="many",
        )
    ]
    nodes = [
        function_node(
            "scheduled",
            name="Scheduled",
            position={"x": 20, "y": 40},
            source=_source("Scheduled", "scheduled", {"boundaries": [boundary]}),
            signature="def Scheduled() -> object",
            ports=output_ports,
        ),
        function_node(
            "dataset",
            name="Dataset",
            position={"x": 330, "y": 40},
            source=_source("Dataset", "dataset"),
            signature="def Dataset() -> object",
            ports=output_ports,
        ),
        function_node(
            "task",
            name="Task",
            position={"x": 650, "y": 40},
            source=_source("Task", "task"),
            signature="def Task() -> object",
            ports=output_ports,
        ),
        function_node(
            "report",
            name="Report",
            position={"x": 970, "y": 40},
            source=_source("Report", "report"),
            signature="def Report() -> object",
            ports=output_ports,
        ),
    ]
    bindings = [
        binding("edge-1", kind="execution-only", source_node_id="scheduled", target_node_id="dataset"),
        binding("edge-2", kind="execution-only", source_node_id="dataset", target_node_id="task"),
        binding("edge-3", kind="execution-only", source_node_id="task", target_node_id="report"),
    ]
    if with_alternate_root:
        nodes.append(
            function_node(
                "parallel",
                name="Parallel",
                position={"x": 650, "y": 180},
                source=_source("Parallel", "task"),
                signature="def Parallel() -> object",
            )
        )
        bindings.append(
            binding(
                "edge-alternate",
                kind="execution-only",
                source_node_id="parallel",
                target_node_id="task",
            )
        )
    parsed = read_graph_v2(graph_document(nodes=nodes, bindings=bindings))
    assert parsed.is_supported, parsed.errors
    return parsed.graph


def test_stop_boundary_cuts_exit_and_excludes_unreachable_downstream_nodes():
    projection = project_flow_boundaries(_boundary_graph())

    assert [node.id for node in projection.graph.nodes] == ["scheduled", "dataset"]
    assert [item.id for item in projection.graph.bindings] == ["edge-1"]
    assert projection.cut_binding_ids == ("edge-2",)
    assert projection.excluded_node_ids == ("report", "task")


def test_compiler_manifest_and_source_end_at_stop_boundary():
    generated = compile_graph(
        _boundary_graph(),
        lowerers={"function": lower_flow_function_node},
    )

    assert [step.graph_node_id for step in generated.manifest.runtime_steps] == [
        "scheduled",
        "dataset",
    ]
    assert 'name="Scheduled"' in generated.source
    assert 'name="Dataset"' in generated.source
    assert 'name="Task"' not in generated.source
    assert 'name="Report"' not in generated.source


def test_boundary_without_exit_keeps_the_original_graph():
    graph = _boundary_graph()
    metadata = {
        "boundaries": [{
            "id": "boundary-all",
            "position": {"x": 0, "y": 0},
            "width": 1400,
            "height": 260,
            "onReach": "stop",
        }]
    }
    first = graph.nodes[0]
    updated = replace(first, source=_source("Scheduled", "scheduled", metadata))
    graph = replace(graph, nodes=(updated,) + graph.nodes[1:])

    projection = project_flow_boundaries(graph)

    assert projection.graph is graph
    assert projection.excluded_node_ids == ()
    assert projection.cut_binding_ids == ()


def test_cut_dependency_is_removed_when_target_remains_reachable_from_another_root():
    graph = _boundary_graph(with_alternate_root=True)

    projection = project_flow_boundaries(graph)

    assert projection.excluded_node_ids == ()
    assert projection.cut_binding_ids == ("edge-2",)
    assert {item.id for item in projection.graph.bindings} == {
        "edge-1",
        "edge-3",
        "edge-alternate",
    }
