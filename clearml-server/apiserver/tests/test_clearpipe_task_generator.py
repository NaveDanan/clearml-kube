import ast
import json
import unittest
from copy import deepcopy
from dataclasses import dataclass, replace
from pathlib import Path

from apiserver.bll.clearpipe.generation.compiler import (
    GenerationError,
    compile_graph,
)
from apiserver.bll.clearpipe.generation.contracts import ClearPipeRuntimeConfiguration
from apiserver.bll.clearpipe.generation.function import lower_function_node
from apiserver.bll.clearpipe.graph_v2 import DataBinding, PortEndpoint, read_graph_v2


ROOT = Path(__file__).resolve().parents[3]
GRAPH_FIXTURES = ROOT / "clearml-web" / "src" / "app" / "features" / "clearpipe" / "domain" / "fixtures"
GOLDENS = Path(__file__).parent / "fixtures" / "clearpipe_generation"


def graph_fixture(name):
    return json.loads((GRAPH_FIXTURES / name).read_text(encoding="utf-8"))


def parsed_graph(name):
    result = read_graph_v2(graph_fixture(name))
    if not result.is_supported:
        raise AssertionError(result)
    return result.graph


@dataclass(frozen=True)
class ExtendedTaskConfiguration:
    clone_base_task: bool
    cache: bool
    queue_resource_id: str
    retry_on_failure: int

    def to_dict(self):
        return {
            "clone_base_task": self.clone_base_task,
            "cache": self.cache,
            "queue_resource_id": self.queue_resource_id,
            "retry_on_failure": self.retry_on_failure,
        }


class ClearPipeTaskGeneratorTests(unittest.TestCase):
    def test_task_graph_matches_golden_and_is_valid_no_launch_source(self):
        generated = compile_graph(parsed_graph("task-graph.v2.json"))
        expected = (GOLDENS / "task-graph.expected.py").read_text(encoding="utf-8")

        self.assertEqual(generated.source, expected)
        ast.parse(generated.source)
        self.assertNotIn(".start(", generated.source)
        self.assertNotIn(".start_locally(", generated.source)
        self.assertIn("${pipeline.dataset_url}", generated.source)
        self.assertIn("${stage_data.artifacts.dataset.url}", generated.source)
        self.assertEqual(generated.manifest.node_ids, ("stage-data", "stage-process"))
        self.assertTrue(generated.manifest.graph_digest.startswith("sha256:"))
        self.assertEqual(
            [
                (item.graph_node_id, item.pipeline_step_name)
                for item in generated.manifest.runtime_steps
            ],
            [("stage-data", "stage_data"), ("stage-process", "stage_process")],
        )

    def test_runtime_identity_payload_round_trips_without_source_line_inference(self):
        generated = compile_graph(parsed_graph("task-graph.v2.json"))
        payload = ClearPipeRuntimeConfiguration(
            schema_version=1,
            definition_revision=4,
            graph_schema_version=generated.manifest.graph_schema_version,
            graph_digest=generated.manifest.graph_digest,
            runtime_steps=generated.manifest.runtime_steps,
            source_map=generated.source_map,
        )

        restored = ClearPipeRuntimeConfiguration.from_dict(payload.to_dict())

        self.assertEqual(restored, payload)
        self.assertEqual(
            restored.runtime_steps[0].graph_node_id,
            "stage-data",
        )
        self.assertEqual(
            restored.runtime_steps[0].pipeline_step_name,
            "stage_data",
        )

    def test_source_is_deterministic_when_canvas_and_collection_order_change(self):
        original = graph_fixture("task-graph.v2.json")
        original["nodes"].append(
            {
                "id": "archive",
                "kind": "task",
                "name": "archive",
                "label": "Archive",
                "base_task": {"kind": "task-id", "task_id": "archive-base-task"},
                "ports": [],
                "configuration": {"clone_base_task": True, "cache": False},
                "visual": {"position": {"x": 720, "y": 0}},
            }
        )
        equivalent = deepcopy(original)
        equivalent["nodes"].reverse()
        equivalent["bindings"].reverse()
        equivalent["visual"]["viewport"]["x"] = 999
        equivalent["nodes"][0]["visual"]["position"]["x"] = -42

        first = compile_graph(read_graph_v2(original).graph)
        second = compile_graph(read_graph_v2(equivalent).graph)

        self.assertEqual(first.source, second.source)
        self.assertEqual(first.manifest, second.manifest)
        self.assertEqual(first.source_map, second.source_map)
        self.assertLess(first.source.index('name="archive"'), first.source.index('name="stage_data"'))
        self.assertEqual(first.manifest.node_ids, ("archive", "stage-data", "stage-process"))

    def test_task_identity_resource_binding_queue_cache_and_clone_override_lower(self):
        fixture = graph_fixture("dataset-bound-graph.v2.json")
        fixture["resources"].append(
            {"id": "queue-fast", "kind": "queue", "resource_id": "fast", "label": "fast"}
        )
        fixture["nodes"][0]["configuration"] = {
            "clone_base_task": False,
            "cache": True,
            "queue_resource_id": "queue-fast",
        }
        graph = read_graph_v2(fixture).graph
        generated = compile_graph(graph)

        self.assertIn('base_task_id="clearml-base-task-id"', generated.source)
        self.assertIn('parameter_override={"General/dataset_id": "clearml-dataset-id"}', generated.source)
        self.assertIn('execution_queue="fast"', generated.source)
        self.assertIn("clone_base_task=False", generated.source)
        self.assertIn("cache_executed_step=True", generated.source)
        source_lines = generated.source.splitlines()

        def mapped_source(graph_element_id):
            return [
                "\n".join(source_lines[entry.start_line - 1 : entry.end_line])
                for entry in generated.source_map
                if entry.graph_element_id == graph_element_id
            ]

        self.assertEqual(len(mapped_source("dataset-iris")), 1)
        self.assertIn("parameter_override", mapped_source("dataset-iris")[0])
        self.assertEqual(len(mapped_source("queue-fast")), 1)
        self.assertIn('execution_queue="fast"', mapped_source("queue-fast")[0])
        self.assertEqual(mapped_source("queue-default"), ['pipe.set_default_execution_queue("default")'])

    def test_integer_retry_extension_lowers_and_callbacks_fail_explicitly(self):
        graph = parsed_graph("dataset-bound-graph.v2.json")
        node = graph.nodes[0]
        configuration = ExtendedTaskConfiguration(
            clone_base_task=True,
            cache=False,
            queue_resource_id=None,
            retry_on_failure=2,
        )
        extended = replace(graph, nodes=(replace(node, configuration=configuration),))
        generated = compile_graph(extended)
        self.assertIn("retry_on_failure=2", generated.source)

        callback_configuration = ExtendedTaskConfiguration(
            clone_base_task=True,
            cache=False,
            queue_resource_id=None,
            retry_on_failure=lambda: True,
        )
        callback_graph = replace(graph, nodes=(replace(node, configuration=callback_configuration),))
        with self.assertRaises(GenerationError) as callback_error:
            compile_graph(callback_graph)
        self.assertEqual(callback_error.exception.diagnostics[0].code, "CPSEM009")

    def test_explicit_and_inferred_parents_are_deduplicated(self):
        fixture = graph_fixture("task-graph.v2.json")
        fixture["bindings"].append(
            {
                "id": "bind-inferred-stage-data-stage-process",
                "kind": "inferred",
                "source": {"kind": "node", "node_id": "stage-data"},
                "target": {"kind": "node", "node_id": "stage-process"},
                "derived_from": {
                    "kind": "port",
                    "node_id": "stage-data",
                    "port_id": "out-dataset-url",
                },
            }
        )

        generated = compile_graph(read_graph_v2(fixture).graph)
        self.assertEqual(generated.source.count('parents=["stage_data"]'), 1)
        mapped_ids = {entry.graph_element_id for entry in generated.source_map}
        self.assertTrue(
            {
                "stage-process",
                "bind-artifact-dataset-url",
                "bind-execution-stage-data-stage-process",
                "bind-inferred-stage-data-stage-process",
            }.issubset(mapped_ids)
        )

    def test_data_transport_and_missing_queue_fail_with_graph_diagnostics(self):
        graph = parsed_graph("task-graph.v2.json")
        invalid_data = replace(
            graph,
            bindings=(
                DataBinding(
                    id="task-data",
                    source=PortEndpoint(node_id="stage-data", port_id="out-dataset-url"),
                    target=PortEndpoint(node_id="stage-process", port_id="in-dataset-url"),
                ),
            ),
        )
        with self.assertRaises(GenerationError) as data_error:
            compile_graph(invalid_data)
        self.assertEqual(data_error.exception.diagnostics[0].code, "CPSEM006")
        self.assertEqual(data_error.exception.diagnostics[0].graph_element_id, "task-data")

        no_queue = replace(graph, settings=replace(graph.settings, default_execution_queue_id=None))
        with self.assertRaises(GenerationError) as queue_error:
            compile_graph(no_queue)
        self.assertTrue(any(item.code == "CPSEM008" for item in queue_error.exception.diagnostics))

    def test_unrepresented_retry_policy_is_rejected_before_generation(self):
        fixture = graph_fixture("task-graph.v2.json")
        fixture["nodes"][0]["configuration"]["retry_on_failure"] = 2

        decoded = read_graph_v2(fixture)
        self.assertEqual(decoded.status, "unsupported")
        self.assertEqual(decoded.unsupported.reason, "unsupported_field")

    def test_secret_values_are_not_rendered_or_echoed_in_diagnostics(self):
        graph = parsed_graph("task-graph.v2.json")
        process = graph.nodes[1]
        ports = list(process.ports)
        ports[1] = replace(ports[1], default={"api_key": "must-not-persist"}, has_default=True)
        graph = replace(graph, nodes=(graph.nodes[0], replace(process, ports=tuple(ports))))

        with self.assertRaises(GenerationError) as error:
            compile_graph(graph)
        diagnostics = [item.to_dict() for item in error.exception.diagnostics]
        self.assertEqual(diagnostics[0]["code"], "CPSEM010")
        self.assertNotIn("must-not-persist", json.dumps(diagnostics))

    def test_function_lowering_is_an_explicit_registration_seam(self):
        graph = parsed_graph("function-graph.v2.json")

        with self.assertRaises(GenerationError) as unregistered:
            compile_graph(graph)
        self.assertTrue(any(item.code == "CPGEN001" for item in unregistered.exception.diagnostics))

        generated = compile_graph(graph, lowerers={"function": lower_function_node})
        ast.parse(generated.source)
        self.assertIn("from clearml import PipelineController, TaskTypes", generated.source)
        self.assertLess(generated.source.index("def normalize"), generated.source.index("pipe = PipelineController"))
        self.assertLess(generated.source.index("pipe = PipelineController"), generated.source.index("pipe.add_function_step"))
        self.assertEqual(
            sum(entry.graph_element_id == "normalize" for entry in generated.source_map),
            2,
        )
        self.assertEqual(generated.manifest.node_ids, ("normalize", "format-result"))

    def test_canonical_function_packages_and_retry_reach_the_compiled_step(self):
        fixture = graph_fixture("function-graph.v2.json")
        fixture["nodes"][0]["description"] = "Normalize a value."
        fixture["nodes"][0]["configuration"].update(
            packages=["pandas==2.2.3"],
            retry_on_failure=2,
        )

        generated = compile_graph(
            read_graph_v2(fixture).graph,
            lowerers={"function": lower_function_node},
        )

        self.assertIn('packages=["pandas==2.2.3"]', generated.source)
        self.assertIn("retry_on_failure=2", generated.source)

    def test_function_description_does_not_change_generated_source_or_digest(self):
        original = graph_fixture("function-graph.v2.json")
        described = deepcopy(original)
        described["nodes"][0]["description"] = "Normalize a deterministic value."

        first = compile_graph(
            read_graph_v2(original).graph,
            lowerers={"function": lower_function_node},
        )
        second = compile_graph(
            read_graph_v2(described).graph,
            lowerers={"function": lower_function_node},
        )

        self.assertEqual(first.source, second.source)
        self.assertEqual(first.manifest.graph_digest, second.manifest.graph_digest)

    def test_generator_owned_identifiers_are_rejected_before_source_is_rendered(self):
        fixture = graph_fixture("function-graph.v2.json")
        fixture["nodes"] = [fixture["nodes"][0]]
        fixture["bindings"] = []
        fixture["outputs"] = []

        for reserved_name in ("PipelineController", "TaskTypes", "pipe"):
            with self.subTest(reserved_name=reserved_name):
                invalid = deepcopy(fixture)
                invalid["nodes"][0]["name"] = reserved_name
                invalid["nodes"][0]["signature"] = invalid["nodes"][0]["signature"].replace(
                    "normalize", reserved_name
                )
                invalid["nodes"][0]["source"] = invalid["nodes"][0]["source"].replace(
                    "normalize", reserved_name
                )

                with self.assertRaises(GenerationError) as error:
                    compile_graph(
                        read_graph_v2(invalid).graph,
                        lowerers={"function": lower_function_node},
                    )

                self.assertTrue(
                    any(item.code == "CPSEM001" for item in error.exception.diagnostics)
                )


if __name__ == "__main__":
    unittest.main()
