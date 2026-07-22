import json
import unittest
from copy import deepcopy
from dataclasses import dataclass, replace
from pathlib import Path

from apiserver.bll.clearpipe.generation.contracts import FunctionLoweringInput
from apiserver.bll.clearpipe.generation.function import (
    FunctionGenerationError,
    lower_function_node,
)
from apiserver.bll.clearpipe.graph_v2 import derive_graph_dependencies, read_graph_v2


ROOT = Path(__file__).resolve().parents[3]
GRAPH_FIXTURE = (
    ROOT
    / "clearml-web"
    / "src"
    / "app"
    / "features"
    / "clearpipe"
    / "domain"
    / "fixtures"
    / "function-graph.v2.json"
)
GOLDEN_DIRECTORY = Path(__file__).parent / "fixtures" / "clearpipe_function_generator"


def graph_fixture():
    result = read_graph_v2(json.loads(GRAPH_FIXTURE.read_text(encoding="utf-8")))
    assert result.is_supported, result
    return result.graph


def lowering_for(graph, node_id, parent_ids=None):
    node = next(item for item in graph.nodes if item.id == node_id)
    inbound = tuple(
        binding
        for binding in graph.bindings
        if getattr(getattr(binding, "target", None), "node_id", None) == node_id
    )
    if parent_ids is None:
        parent_ids = tuple(
            dependency.source_node_id
            for dependency in derive_graph_dependencies(graph)
            if dependency.target_node_id == node_id
        )
    return FunctionLoweringInput(
        graph=graph,
        node=node,
        inbound_bindings=inbound,
        parent_node_ids=tuple(parent_ids),
    )


def lower_graph(graph):
    dependencies = derive_graph_dependencies(graph)
    parents = {node.id: set() for node in graph.nodes}
    children = {node.id: set() for node in graph.nodes}
    for dependency in dependencies:
        parents[dependency.target_node_id].add(dependency.source_node_id)
        children[dependency.source_node_id].add(dependency.target_node_id)

    ordered = []
    ready = sorted(node_id for node_id, values in parents.items() if not values)
    while ready:
        node_id = ready.pop(0)
        ordered.append(node_id)
        for child_id in sorted(children[node_id]):
            parents[child_id].remove(node_id)
            if not parents[child_id]:
                ready.append(child_id)
        ready.sort()
    return tuple(lower_function_node(lowering_for(graph, node_id)) for node_id in ordered)


@dataclass(frozen=True)
class ExtendedFunctionConfiguration:
    task_type: str
    cache: bool
    queue_resource_id: str
    packages: tuple
    retry_on_failure: int


class ClearPipeFunctionGenerationTests(unittest.TestCase):
    def test_unsupported_feature_surface_is_machine_readable(self):
        unsupported = json.loads(
            (GOLDEN_DIRECTORY / "unsupported-features.json").read_text(encoding="utf-8")
        )

        self.assertEqual(unsupported["generator"], "PipelineController.add_function_step")
        self.assertEqual(
            set(unsupported["diagnostics"]),
            {
                "CPSEM003",
                "CPSEM004",
                "CPSEM005",
                "CPSEM006",
                "CPSEM007",
                "CPSEM008",
                "CPSEM009",
                "CPSEM010",
            },
        )
        self.assertIn("PipelineController.start", unsupported["never_generated"])

    def test_function_graph_matches_golden_and_compiles_without_launch(self):
        lowered = lower_graph(graph_fixture())
        source = "\n".join(item.source for item in lowered)
        expected = (GOLDEN_DIRECTORY / "function-graph.golden.py").read_text(encoding="utf-8")

        self.assertEqual(source, expected)
        compile(source, "function-graph.golden.py", "exec")
        self.assertNotIn(".start(", source)
        self.assertNotIn(".start_locally(", source)
        self.assertNotIn("PipelineDecorator", source)
        self.assertEqual(
            lowered[1].source_map,
            (
                type(lowered[1].source_map[0])("format-result", 1, 2),
                type(lowered[1].source_map[0])("format-result", 4, 12),
            ),
        )

    def test_generation_is_deterministic_when_graph_collections_are_reordered(self):
        raw = json.loads(GRAPH_FIXTURE.read_text(encoding="utf-8"))
        reordered = deepcopy(raw)
        reordered["nodes"].reverse()
        reordered["bindings"].reverse()

        first = "\n".join(item.source for item in lower_graph(read_graph_v2(raw).graph))
        second = "\n".join(item.source for item in lower_graph(read_graph_v2(reordered).graph))
        self.assertEqual(first, second)

    def test_data_reference_and_inferred_parent_are_canonical(self):
        graph = graph_fixture()
        lowered = lower_function_node(lowering_for(graph, "format-result"))

        self.assertIn('function_kwargs={"value": "${normalize.normalized}", "prefix": "result="}', lowered.step_source)
        self.assertTrue(lowered.step_source.endswith('parents=["normalize"],\n)\n'))
        with self.assertRaises(FunctionGenerationError) as raised:
            lower_function_node(lowering_for(graph, "format-result", ()))
        self.assertEqual(raised.exception.code, "CPSEM007")

    def test_parameter_defaults_queue_cache_packages_and_retry_lower_explicitly(self):
        graph = graph_fixture()
        node = next(item for item in graph.nodes if item.id == "normalize")
        configured = replace(
            node,
            configuration=ExtendedFunctionConfiguration(
                task_type=node.configuration.task_type,
                cache=True,
                queue_resource_id="queue-default",
                packages=("pandas==2.2.3", "scikit-learn==1.5.2"),
                retry_on_failure=2,
            ),
        )
        lowered = lower_function_node(
            FunctionLoweringInput(graph=graph, node=configured, inbound_bindings=(), parent_node_ids=())
        )

        self.assertIn('function_kwargs={"value": 41, "increment": 1}', lowered.step_source)
        self.assertIn('execution_queue="default"', lowered.step_source)
        self.assertIn("cache_executed_step=True", lowered.step_source)
        self.assertIn('packages=["pandas==2.2.3", "scikit-learn==1.5.2"]', lowered.step_source)
        self.assertIn("retry_on_failure=2", lowered.step_source)

    def test_pipeline_parameter_input_and_signature_default_are_explicit(self):
        raw = json.loads(GRAPH_FIXTURE.read_text(encoding="utf-8"))
        raw["nodes"] = [raw["nodes"][0]]
        raw["outputs"] = []
        raw["parameters"] = [
            {
                "id": "parameter-value",
                "name": "pipeline_value",
                "required": False,
                "order": 0,
                "default": 7,
            }
        ]
        raw["nodes"][0]["ports"][0]["accepted_binding_kinds"] = ["parameter"]
        raw["bindings"] = [
            {
                "id": "bind-parameter-value",
                "kind": "parameter",
                "source": {"kind": "parameter", "parameter_id": "parameter-value"},
                "target": {"kind": "port", "node_id": "normalize", "port_id": "in-value"},
            }
        ]
        graph = read_graph_v2(raw).graph
        lowered = lower_function_node(lowering_for(graph, "normalize"))

        self.assertIn(
            'function_kwargs={"value": "${pipeline.pipeline_value}", "increment": 1}',
            lowered.step_source,
        )

    def test_multiple_outputs_are_port_ordered_and_syntax_valid(self):
        raw = json.loads(GRAPH_FIXTURE.read_text(encoding="utf-8"))
        raw["nodes"] = [
            {
                "id": "split",
                "kind": "function",
                "name": "split",
                "label": "Split",
                "signature": "def split(value: str) -> tuple",
                "source": "def split(value: str) -> tuple:\n    return (value.lower(), value.upper())\n",
                "ports": [
                    {
                        "id": "in-value",
                        "kind": "port",
                        "name": "value",
                        "direction": "input",
                        "role": "data",
                        "required": False,
                        "multiplicity": "single",
                        "accepted_binding_kinds": ["data"],
                        "order": 0,
                        "default": "ClearML",
                    },
                    {
                        "id": "out-right",
                        "kind": "port",
                        "name": "right",
                        "direction": "output",
                        "role": "data",
                        "required": False,
                        "multiplicity": "many",
                        "accepted_binding_kinds": ["data"],
                        "order": 1,
                    },
                    {
                        "id": "out-left",
                        "kind": "port",
                        "name": "left",
                        "direction": "output",
                        "role": "data",
                        "required": False,
                        "multiplicity": "many",
                        "accepted_binding_kinds": ["data"],
                        "order": 0,
                    },
                ],
                "configuration": {"task_type": "data_processing"},
                "visual": {"position": {"x": 0, "y": 0}},
            }
        ]
        raw["bindings"] = []
        raw["outputs"] = []
        graph = read_graph_v2(raw).graph
        lowered = lower_function_node(lowering_for(graph, "split"))

        self.assertIn('function_return=["left", "right"]', lowered.step_source)
        compile(lowered.source, "multiple-output.py", "exec")

    def test_unsupported_diagnostics_are_precise_and_never_echo_secrets(self):
        graph = graph_fixture()
        node = next(item for item in graph.nodes if item.id == "normalize")
        secret_node = replace(
            node,
            source=(
                "def normalize(value: int, increment: int = 1) -> int:\n"
                "    api_key = 'do-not-echo-this-value'\n"
                "    return value + increment\n"
            ),
        )
        with self.assertRaises(FunctionGenerationError) as raised:
            lower_function_node(
                FunctionLoweringInput(graph=graph, node=secret_node, inbound_bindings=(), parent_node_ids=())
            )
        self.assertEqual(raised.exception.code, "CPSEM010")
        self.assertNotIn("do-not-echo-this-value", str(raised.exception))

        multi_output = json.loads(GRAPH_FIXTURE.read_text(encoding="utf-8"))
        multi_output["nodes"][0]["ports"].append(
            {
                "id": "out-second",
                "kind": "port",
                "name": "second",
                "direction": "output",
                "role": "data",
                "required": False,
                "multiplicity": "many",
                "accepted_binding_kinds": ["data"],
                "order": 1,
            }
        )
        multi_output["bindings"] = []
        multi_output["nodes"] = [multi_output["nodes"][0]]
        multi_output["outputs"] = []
        graph = read_graph_v2(multi_output).graph
        with self.assertRaises(FunctionGenerationError) as raised:
            lower_function_node(lowering_for(graph, "normalize"))
        self.assertEqual(raised.exception.code, "CPSEM005")


if __name__ == "__main__":
    unittest.main()
