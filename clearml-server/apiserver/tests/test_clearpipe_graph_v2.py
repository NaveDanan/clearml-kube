import json
import unittest
from copy import deepcopy
from pathlib import Path

from apiserver.bll.clearpipe.generation.contracts import NodeLoweringInput, SourceManifest
from apiserver.bll.clearpipe.graph_v2 import (
    GRAPH_SCHEMA_VERSION,
    canonical_graph_dict,
    derive_graph_dependencies,
    read_graph_v2,
    serialize_graph_v2,
)
from apiserver.bll.clearpipe.migrations import DEFAULT_MIGRATION_REGISTRY


FIXTURE_DIRECTORY = (
    Path(__file__).resolve().parents[3]
    / "clearml-web"
    / "src"
    / "app"
    / "features"
    / "clearpipe"
    / "domain"
    / "fixtures"
)


def fixture(name):
    with (FIXTURE_DIRECTORY / name).open(encoding="utf-8") as handle:
        return json.load(handle)


class ClearPipeGraphV2Tests(unittest.TestCase):
    def assert_supported_fixture(self, name):
        result = read_graph_v2(fixture(name))
        self.assertTrue(result.is_supported, result)
        return result.graph

    def test_canonical_task_function_and_dataset_fixtures_round_trip(self):
        task = self.assert_supported_fixture("task-graph.v2.json")
        function = self.assert_supported_fixture("function-graph.v2.json")
        dataset = self.assert_supported_fixture("dataset-bound-graph.v2.json")

        self.assertEqual([node.name for node in task.nodes], ["stage_data", "stage_process"])
        self.assertEqual({binding.kind for binding in task.bindings}, {"artifact", "parameter", "execution-only"})
        self.assertEqual(
            [(item.source_node_id, item.target_node_id) for item in derive_graph_dependencies(task)],
            [("stage-data", "stage-process")],
        )
        self.assertEqual([node.name for node in function.nodes], ["normalize", "format_result"])
        self.assertEqual({binding.kind for binding in function.bindings}, {"data", "inferred"})
        self.assertEqual(
            [(item.source_node_id, item.target_node_id) for item in derive_graph_dependencies(function)],
            [("normalize", "format-result")],
        )
        self.assertEqual(dataset.resources[0].kind, "dataset")
        self.assertFalse(any(node.kind == "dataset" for node in dataset.nodes))

        for graph in (task, function, dataset):
            serialized = serialize_graph_v2(graph)
            decoded = read_graph_v2(serialized)
            self.assertTrue(decoded.is_supported, decoded)
            self.assertEqual(canonical_graph_dict(graph), canonical_graph_dict(decoded.graph))

    def test_serialization_is_independent_of_collection_order(self):
        original = fixture("task-graph.v2.json")
        reordered = deepcopy(original)
        reordered["document"]["tags"].reverse()
        reordered["nodes"].reverse()
        reordered["bindings"].reverse()

        first = read_graph_v2(original)
        second = read_graph_v2(reordered)
        self.assertTrue(first.is_supported)
        self.assertTrue(second.is_supported)
        self.assertEqual(serialize_graph_v2(first.graph), serialize_graph_v2(second.graph))

    def test_function_description_packages_and_retry_round_trip(self):
        raw = fixture("function-graph.v2.json")
        raw["nodes"][0]["description"] = "Normalize a deterministic value."
        raw["nodes"][0]["configuration"].update(
            packages=["pandas==2.2.3", "scikit-learn==1.5.2"],
            retry_on_failure=2,
        )

        parsed = read_graph_v2(raw)

        self.assertTrue(parsed.is_supported, parsed)
        function = parsed.graph.nodes[0]
        self.assertEqual(function.description, "Normalize a deterministic value.")
        self.assertEqual(
            function.configuration.packages,
            ("pandas==2.2.3", "scikit-learn==1.5.2"),
        )
        self.assertEqual(function.configuration.retry_on_failure, 2)
        serialized = serialize_graph_v2(parsed.graph)
        reparsed = read_graph_v2(serialized)
        self.assertTrue(reparsed.is_supported, reparsed)
        self.assertEqual(canonical_graph_dict(reparsed.graph), canonical_graph_dict(parsed.graph))

    def test_function_execution_extensions_reject_invalid_or_secret_values(self):
        cases = (
            ("packages-not-array", {"packages": "numpy"}, "invalid", "invalid_type"),
            ("empty-package", {"packages": [""]}, "invalid", "invalid_string"),
            (
                "secret-package",
                {"packages": ["https://example.test/pkg?token=must-not-persist"]},
                "invalid",
                "secret_not_allowed",
            ),
            (
                "vcs-userinfo-package",
                {"packages": ["git+https://user:password@example.test/repo.git"]},
                "invalid",
                "secret_not_allowed",
            ),
            (
                "vcs-encoded-secret-query",
                {"packages": ["git+https://example.test/repo.git?to%6ben=must-not-persist"]},
                "invalid",
                "secret_not_allowed",
            ),
            ("negative-retry", {"retry_on_failure": -1}, "invalid", "invalid_integer"),
            ("fractional-retry", {"retry_on_failure": 1.5}, "invalid", "invalid_integer"),
            ("unknown-config", {"unknown": True}, "unsupported", "unsupported_field"),
        )
        for name, extension, status, code in cases:
            with self.subTest(name=name):
                raw = fixture("function-graph.v2.json")
                raw["nodes"][0]["configuration"].update(extension)

                result = read_graph_v2(raw)

                self.assertEqual(result.status, status)
                if status == "invalid":
                    self.assertEqual(result.errors[0].code, code)
                else:
                    self.assertEqual(result.unsupported.reason, code)

        raw = fixture("function-graph.v2.json")
        raw["nodes"][0]["description"] = "token=must-not-persist"
        secret_description = read_graph_v2(raw)
        self.assertEqual(secret_description.status, "invalid")
        self.assertEqual(secret_description.errors[0].code, "secret_not_allowed")
        self.assertNotIn("must-not-persist", json.dumps([issue.to_dict() for issue in secret_description.errors]))

    def test_task_retry_round_trips_and_secret_parameter_defaults_fail_closed(self):
        raw = fixture("task-graph.v2.json")
        raw["nodes"][0]["configuration"]["retry_on_failure"] = 2

        parsed = read_graph_v2(raw)

        self.assertTrue(parsed.is_supported, parsed)
        self.assertEqual(parsed.graph.nodes[0].configuration.retry_on_failure, 2)
        self.assertTrue(
            read_graph_v2(serialize_graph_v2(parsed.graph)).is_supported
        )

        for retry in (-1, 1.5, {"callback": "retry"}):
            with self.subTest(retry=retry):
                invalid = fixture("task-graph.v2.json")
                invalid["nodes"][0]["configuration"]["retry_on_failure"] = retry
                result = read_graph_v2(invalid)
                self.assertFalse(result.is_supported)

        secret_default = fixture("task-graph.v2.json")
        port = secret_default["nodes"][0]["ports"][0]
        port.update(name="General/api_key", default="must-not-persist")
        result = read_graph_v2(secret_default)
        self.assertEqual(result.status, "invalid")
        self.assertEqual(result.errors[0].code, "secret_not_allowed")
        self.assertNotIn(
            "must-not-persist",
            json.dumps([issue.to_dict() for issue in result.errors]),
        )

    def test_invalid_secret_fixture_never_echoes_the_secret(self):
        result = read_graph_v2(fixture("invalid-secret-graph.v2.json"))
        self.assertEqual(result.status, "invalid")
        self.assertEqual(result.errors[0].code, "secret_not_allowed")
        self.assertNotIn("must-not-persist", json.dumps([error.to_dict() for error in result.errors]))

        source_secret = fixture("function-graph.v2.json")
        source_secret["nodes"][0]["source"] = "def normalize():\n    api_key = 'must-not-persist'\n"
        source_result = read_graph_v2(source_secret)
        self.assertEqual(source_result.status, "invalid")
        self.assertEqual(source_result.errors[0].code, "secret_not_allowed")

        encoded_url_result = read_graph_v2(fixture("encoded-secret-url-graph.v2.json"))
        self.assertEqual(encoded_url_result.status, "invalid")
        self.assertEqual(encoded_url_result.errors[0].code, "secret_not_allowed")
        self.assertNotIn("must-not-persist", json.dumps([error.to_dict() for error in encoded_url_result.errors]))

    def test_rejects_cycles_derived_from_data_and_artifact_port_bindings(self):
        result = read_graph_v2(fixture("cyclic-graph.v2.json"))
        self.assertEqual(result.status, "invalid")
        self.assertEqual(result.errors[0].code, "graph_cycle")
        self.assertEqual(result.errors[0].path, "graph.bindings")

    def test_cross_codec_golden_serialization_normalizes_numbers_and_order(self):
        graph = self.assert_supported_fixture("canonical-serialization.v2.json")
        expected = fixture("canonical-serialization.golden.json")["canonical_json"]
        self.assertEqual(serialize_graph_v2(graph), expected)

    def test_legacy_v1_and_newer_versions_remain_read_only_with_original_data(self):
        legacy = {"schema_version": 1, "nodes": [{"id": "legacy"}], "edges": []}
        legacy_result = read_graph_v2(legacy)
        self.assertEqual(legacy_result.status, "unsupported")
        self.assertEqual(legacy_result.unsupported.reason, "legacy_v1_not_losslessly_representable")
        self.assertEqual(legacy_result.unsupported.raw, legacy)
        self.assertEqual(DEFAULT_MIGRATION_REGISTRY.migrate(fixture("task-graph.v2.json")).status, "current")

        newer = {"schema_version": GRAPH_SCHEMA_VERSION + 1, "unknown": {"preserve": True}}
        newer_result = read_graph_v2(newer)
        self.assertEqual(newer_result.status, "unsupported")
        self.assertEqual(newer_result.unsupported.reason, "schema_version_newer_than_supported")
        self.assertEqual(newer_result.unsupported.raw, newer)

    def test_unknown_schema_extensions_are_unsupported_and_bad_references_are_invalid(self):
        unknown_node = fixture("task-graph.v2.json")
        unknown_node["nodes"][0]["kind"] = "component"
        unsupported = read_graph_v2(unknown_node)
        self.assertEqual(unsupported.status, "unsupported")
        self.assertEqual(unsupported.unsupported.reason, "unsupported_node_kind")

        unknown_port_kind = fixture("task-graph.v2.json")
        unknown_port_kind["nodes"][0]["ports"][0]["kind"] = "future-port"
        port_kind_result = read_graph_v2(unknown_port_kind)
        self.assertEqual(port_kind_result.status, "unsupported")
        self.assertEqual(port_kind_result.unsupported.reason, "unsupported_port_kind")

        unknown_port = fixture("function-graph.v2.json")
        unknown_port["bindings"][0]["target"]["port_id"] = "missing-port"
        invalid = read_graph_v2(unknown_port)
        self.assertEqual(invalid.status, "invalid")
        self.assertEqual(invalid.errors[0].code, "unknown_port")

        unknown_field = fixture("task-graph.v2.json")
        unknown_field["nodes"][0]["future_field"] = True
        field_result = read_graph_v2(unknown_field)
        self.assertEqual(field_result.status, "unsupported")
        self.assertEqual(field_result.unsupported.raw, unknown_field)

    def test_generation_contract_is_data_only_and_uses_canonical_nodes(self):
        graph = self.assert_supported_fixture("function-graph.v2.json")
        lowered = NodeLoweringInput(
            graph=graph,
            node=graph.nodes[0],
            inbound_bindings=(),
            parent_node_ids=(),
        )
        manifest = SourceManifest(
            graph_schema_version=GRAPH_SCHEMA_VERSION,
            graph_digest="sha256:example",
            node_ids=tuple(node.id for node in graph.nodes),
        )
        self.assertEqual(lowered.node.id, "normalize")
        self.assertEqual(manifest.graph_schema_version, 2)


if __name__ == "__main__":
    unittest.main()
