import asyncio
import json
import unittest
from copy import deepcopy
from pathlib import Path

from apiserver.bll.clearpipe.validation import (
    DiagnosticTarget,
    GraphValidator,
    ResourceResolution,
    ValidationContributor,
    ValidationEngine,
    ValidationIssue,
    ValidationPolicy,
)


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


def codes(result):
    return {issue.code for issue in result.issues}


class Resolver:
    def __init__(self, status):
        self.status = status
        self.requests = []

    async def resolve(self, request):
        self.requests.append(request)
        if self.status == "raise":
            raise RuntimeError("backend unavailable")
        return ResourceResolution(self.status)


class ClearPipeValidationEngineTests(unittest.TestCase):
    def test_valid_canonical_fixtures_are_save_and_run_valid(self):
        engine = ValidationEngine()
        for name in ("task-graph.v2.json", "function-graph.v2.json", "dataset-bound-graph.v2.json"):
            result = engine.validate_full(fixture(name))
            self.assertTrue(result.save_valid, result.to_dict())
            self.assertTrue(result.run_valid, result.to_dict())
            self.assertTrue(all(issue.severity != "error" for issue in result.issues))

    def test_cpsem001_maps_cp06_name_and_cycle_invariants_without_reimplementing_them(self):
        duplicate = fixture("function-graph.v2.json")
        duplicate["nodes"][1]["name"] = duplicate["nodes"][0]["name"]
        duplicate_result = ValidationEngine().validate_full(duplicate)
        self.assertEqual([issue.code for issue in duplicate_result.issues], ["CPSEM001"])
        self.assertEqual(duplicate_result.issues[0].target.kind, "field")

        cycle_result = ValidationEngine().validate_full(fixture("cyclic-graph.v2.json"))
        self.assertEqual([issue.code for issue in cycle_result.issues], ["CPSEM001"])
        self.assertEqual(cycle_result.issues[0].target.path, "graph.bindings")

    def test_cpsem002_through_cpsem011_catalog_rules(self):
        task = fixture("task-graph.v2.json")
        task["nodes"][0]["base_task"] = {"kind": "task-id", "task_id": ""}
        self.assertIn("CPSEM002", codes(ValidationEngine().validate_full(task)))

        invalid_source = fixture("function-graph.v2.json")
        invalid_source["nodes"][0]["source"] = (
            "def normalize(value: int, increment: int = 1) -> int:\n"
            "    transform = lambda item: item\n"
            "    return transform(value)\n"
        )
        self.assertIn("CPSEM003", codes(ValidationEngine().validate_full(invalid_source)))

        missing_argument = fixture("function-graph.v2.json")
        for key in ("source", "signature"):
            missing_argument["nodes"][0][key] = missing_argument["nodes"][0][key].replace(
                "increment: int = 1", "increment: int = 1, missing: int = 2"
            )
        self.assertIn("CPSEM004", codes(ValidationEngine().validate_full(missing_argument)))

        invalid_outputs = fixture("function-graph.v2.json")
        output = deepcopy(invalid_outputs["nodes"][0]["ports"][2])
        output.update({"id": "out-extra", "name": "extra", "order": 1})
        invalid_outputs["nodes"][0]["ports"].append(output)
        self.assertIn("CPSEM005", codes(ValidationEngine().validate_full(invalid_outputs)))

        invalid_data = fixture("function-graph.v2.json")
        invalid_data["nodes"][0]["ports"][2]["role"] = "artifact"
        self.assertIn("CPSEM006", codes(ValidationEngine().validate_full(invalid_data)))

        invalid_artifact = fixture("task-graph.v2.json")
        invalid_artifact["nodes"][1]["ports"][0]["role"] = "parameter"
        self.assertIn("CPSEM007", codes(ValidationEngine().validate_full(invalid_artifact)))

        missing_queue = fixture("function-graph.v2.json")
        missing_queue["settings"] = {}
        self.assertIn("CPSEM008", codes(ValidationEngine().validate_full(missing_queue)))

        dynamic_function = fixture("function-graph.v2.json")
        dynamic_function["nodes"][0]["source"] = (
            "def normalize(value: int, increment: int = 1) -> int:\n"
            "    for item in (value,):\n"
            "        return item + increment\n"
        )
        self.assertIn("CPSEM009", codes(ValidationEngine().validate_full(dynamic_function)))
        unsupported_retry = fixture("function-graph.v2.json")
        unsupported_retry["nodes"][0]["configuration"]["retry"] = 1
        self.assertIn("CPSEM009", codes(ValidationEngine().validate_full(unsupported_retry)))

        self.assertIn(
            "CPSEM010",
            codes(ValidationEngine().validate_full(fixture("invalid-secret-graph.v2.json"))),
        )

        strict = ValidationEngine(ValidationPolicy(strict_reproducibility=True))
        self.assertIn("CPSEM011", codes(strict.validate_full(fixture("function-graph.v2.json"))))

    def test_data_and_inferred_bindings_are_independent_of_binding_collection_order(self):
        graph = fixture("function-graph.v2.json")
        graph["bindings"].reverse()
        result = ValidationEngine().validate_full(graph)
        self.assertTrue(result.valid, result.to_dict())

    def test_cp06_structural_reference_and_multiplicity_failures_have_stable_targets(self):
        self_loop = fixture("function-graph.v2.json")
        self_loop["bindings"][0]["target"]["node_id"] = "normalize"
        self.assertIn("CPSEM001", codes(ValidationEngine().validate_full(self_loop)))

        duplicate_identifier = fixture("function-graph.v2.json")
        duplicate_identifier["nodes"][1]["id"] = duplicate_identifier["nodes"][0]["id"]
        self.assertIn("CPSTR001", codes(ValidationEngine().validate_full(duplicate_identifier)))

        dangling_node = fixture("function-graph.v2.json")
        dangling_node["bindings"][0]["source"]["node_id"] = "deleted-node"
        self.assertIn("CPSEM006", codes(ValidationEngine().validate_full(dangling_node)))

        unknown_output = fixture("function-graph.v2.json")
        unknown_output["bindings"][0]["source"]["port_id"] = "deleted-output"
        self.assertIn("CPSEM006", codes(ValidationEngine().validate_full(unknown_output)))

        multiplicity = fixture("function-graph.v2.json")
        duplicate_binding = deepcopy(multiplicity["bindings"][0])
        duplicate_binding["id"] = "bind-data-normalized-second"
        multiplicity["bindings"].append(duplicate_binding)
        self.assertIn("CPSEM007", codes(ValidationEngine().validate_full(multiplicity)))

    def test_required_inputs_outputs_and_duplicate_bindings_have_targeted_diagnostics(self):
        graph = fixture("function-graph.v2.json")
        graph["nodes"][1]["ports"][0]["required"] = True
        graph["bindings"] = []
        result = ValidationEngine().validate_full(graph)
        issue = next(issue for issue in result.issues if issue.code == "CPSEM004")
        self.assertEqual(issue.target.kind, "port")
        self.assertEqual(issue.target.node_id, "format-result")

        duplicate = fixture("function-graph.v2.json")
        extra = deepcopy(duplicate["bindings"][0])
        extra["id"] = "bind-data-normalized-copy"
        duplicate["bindings"].append(extra)
        self.assertIn("CPSEM007", codes(ValidationEngine().validate_full(duplicate)))

    def test_incremental_validation_selects_changed_targets_and_graph_diagnostics(self):
        graph = fixture("function-graph.v2.json")
        graph["nodes"][0]["source"] = (
            "def normalize(value: int, increment: int = 1) -> int:\n"
            "    value = lambda item: item\n"
            "    return value(increment)\n"
        )
        engine = ValidationEngine()
        self.assertNotIn("CPSEM003", codes(engine.validate_incremental(graph, ["format-result"])))
        self.assertIn("CPSEM003", codes(engine.validate_incremental(graph, ["normalize"])))

    def test_incremental_validation_derives_required_input_after_binding_deletion(self):
        graph = fixture("function-graph.v2.json")
        del graph["bindings"][0]
        result = ValidationEngine().validate_incremental(graph, ["bind-data-normalized"])
        missing_input = next(issue for issue in result.issues if issue.code == "CPSEM004")
        self.assertEqual(missing_input.target.node_id, "format-result")
        self.assertEqual(missing_input.target.port_id, "in-value")

    def test_preflight_distinguishes_missing_denied_stale_pending_and_unavailable_resources(self):
        graph = fixture("function-graph.v2.json")
        for status, code in (
            ("missing", "CPRES001"),
            ("denied", "CPRES002"),
            ("stale", "CPRES003"),
            ("unavailable", "CPRES005"),
        ):
            resolver = Resolver(status)
            result = asyncio.run(ValidationEngine().preflight(graph, resolver))
            self.assertIn(code, codes(result))
            self.assertEqual([request.resource_id for request in resolver.requests], ["default"])

        stale = asyncio.run(ValidationEngine().preflight(graph, Resolver("stale")))
        self.assertTrue(stale.save_valid)
        self.assertFalse(stale.run_valid)

        pending = asyncio.run(ValidationEngine().preflight(graph))
        self.assertIn("CPRES004", codes(pending))
        self.assertFalse(pending.run_valid)

        unavailable = asyncio.run(ValidationEngine().preflight(graph, Resolver("raise")))
        self.assertIn("CPRES005", codes(unavailable))

    def test_empty_draft_can_save_but_cannot_run(self):
        graph = fixture("function-graph.v2.json")
        graph["nodes"] = []
        graph["bindings"] = []
        graph["outputs"] = []
        result = asyncio.run(ValidationEngine().preflight(graph, Resolver("available")))
        self.assertIn("CPPRE001", codes(result))
        self.assertTrue(result.save_valid)
        self.assertFalse(result.run_valid)

    def test_generator_contributors_use_the_same_issue_model(self):
        class Contributor(ValidationContributor):
            def validate(self, graph):
                return (
                    ValidationIssue.create(
                        "CPGEN900",
                        DiagnosticTarget(kind="graph", path="graph"),
                        "Generator lowering requires an explicit capability.",
                        "Configure the supported generator capability.",
                    ),
                )

        result = ValidationEngine(contributors=(Contributor(),)).validate_full(
            fixture("function-graph.v2.json")
        )
        self.assertEqual([issue.code for issue in result.issues], ["CPGEN900"])

    def test_diagnostics_are_deterministic_and_never_echo_secret_values(self):
        graph = fixture("function-graph.v2.json")
        graph["nodes"][0]["source"] = "def normalize(value: int, increment: int = 1) -> int:\n    return\n"
        first = ValidationEngine().validate_full(graph)
        second = ValidationEngine().validate_full(deepcopy(graph))
        self.assertEqual(first.to_dict(), second.to_dict())

        secret = fixture("invalid-secret-graph.v2.json")
        result = ValidationEngine().validate_full(secret)
        self.assertNotIn("must-not-persist", json.dumps(result.to_dict()))

    def test_compatibility_validator_invokes_authorized_resource_and_queue_checkers(self):
        resource_calls = []
        queue_calls = []

        def resource_checker(kind, resource_id, lookup=()):
            resource_calls.append((kind, resource_id))
            return True

        def queue_checker(resource_id):
            queue_calls.append(resource_id)
            return True

        allowed = GraphValidator(
            resource_checker=resource_checker, queue_checker=queue_checker
        ).validate(fixture("task-graph.v2.json"))
        self.assertTrue(allowed.valid, allowed.to_dict())
        self.assertEqual(queue_calls, ["default"])
        self.assertEqual(
            resource_calls,
            [
                ("task", "Pipeline step 1 dataset artifact"),
                ("task", "Pipeline step 2 process dataset"),
            ],
        )

        denied = GraphValidator(
            resource_checker=resource_checker, queue_checker=lambda _: False
        ).validate(fixture("function-graph.v2.json"))
        self.assertFalse(denied.valid)
        self.assertIn("CPRES002", codes(denied))

        unverifiable = GraphValidator(resource_checker=resource_checker).validate(
            fixture("function-graph.v2.json")
        )
        self.assertFalse(unverifiable.valid)
        self.assertIn("CPRES006", codes(unverifiable))

        def failing_queue_checker(_):
            raise RuntimeError("lookup failure")

        callback_failure = GraphValidator(
            queue_checker=failing_queue_checker
        ).validate(fixture("function-graph.v2.json"))
        self.assertFalse(callback_failure.valid)
        self.assertIn("CPRES006", codes(callback_failure))

    def test_task_name_references_preserve_project_lookup_for_authorized_validation(self):
        task_graph = fixture("task-graph.v2.json")
        resource_calls = []

        def resource_checker(kind, resource_id, lookup=()):
            resource_calls.append((kind, resource_id, lookup))
            return True

        result = GraphValidator(
            resource_checker=resource_checker,
            queue_checker=lambda _: True,
        ).validate(task_graph)

        self.assertTrue(result.valid, result.to_dict())
        self.assertEqual(
            [item for item in resource_calls if item[2]],
            [
                (
                    "task",
                    "Pipeline step 1 dataset artifact",
                    (
                        ("name", "Pipeline step 1 dataset artifact"),
                        ("project", "examples"),
                    ),
                ),
                (
                    "task",
                    "Pipeline step 2 process dataset",
                    (
                        ("name", "Pipeline step 2 process dataset"),
                        ("project", "examples"),
                    ),
                ),
            ],
        )

    def test_compatibility_validator_blocks_value_safe_unsupported_graph_secrets(self):
        legacy = {
            "schema_version": 1,
            "nodes": [{"config": {"inlineScript": "API_TOKEN = 'must-not-echo'"}}],
            "edges": [],
        }
        result = GraphValidator().validate(legacy)
        self.assertIn("CPSTR002", codes(result))
        self.assertIn("embedded_secret", codes(result))
        self.assertNotIn("must-not-echo", json.dumps(result.to_dict()))


if __name__ == "__main__":
    unittest.main()
