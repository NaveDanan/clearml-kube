import ast
import json
import unittest

from apiserver.bll.clearpipe.compiler import MAX_COMPILED_SCRIPT_BYTES, compile_definition, render_controller_script
from apiserver.bll.clearpipe.access import can_read_definition, can_write_definition
from apiserver.bll.clearpipe.controller_runner import RUNNER_SOURCE
from apiserver.bll.clearpipe.parser import parse_python_script
from apiserver.bll.clearpipe.validation import GraphValidator, MAX_INLINE_SCRIPT_BYTES


def node(node_id, node_type="execute", config=None):
    defaults = {
        "execute": {"steps": []},
        "dataset": {"source": "clearml"},
        "versioning": {"tool": "clearml-data"},
        "training": {"scriptSource": "git"},
        "experiment": {"tracker": "clearml", "projectName": "p", "experimentName": "e"},
        "report": {"title": "r", "outputFormat": "html"},
    }
    return {
        "id": node_id,
        "position": {"x": 1, "y": 2},
        "data": {"type": node_type, "label": node_id, "config": config or defaults[node_type]},
    }


class GraphValidationTests(unittest.TestCase):
    def test_accepts_disconnected_acyclic_components(self):
        graph = {
            "nodes": [node("a"), node("b"), node("c"), node("d")],
            "edges": [
                {"id": "ab", "source": "a", "target": "b"},
                {"id": "cd", "source": "c", "target": "d"},
            ],
        }
        self.assertTrue(GraphValidator().validate(graph).valid)

    def test_rejects_cycles_duplicate_ids_refs_edges_and_self_loops(self):
        graph = {
            "nodes": [node("a"), node("a"), node("b")],
            "edges": [
                {"id": "x", "source": "a", "target": "b"},
                {"id": "x", "source": "a", "target": "b"},
                {"id": "z", "source": "b", "target": "a"},
                {"id": "self", "source": "a", "target": "a"},
                {"id": "missing", "source": "a", "target": "nope"},
            ],
        }
        codes = {issue.code for issue in GraphValidator().validate(graph).issues}
        self.assertTrue(
            {"duplicate_node_id", "duplicate_edge_id", "duplicate_connection", "graph_cycle", "self_loop", "missing_node_reference"}.issubset(codes)
        )

    def test_rejects_embedded_secrets_urls_and_inline_assignments(self):
        graph = {
            "nodes": [
                node(
                    "a",
                    config={
                        "steps": [{"inlineScript": "API_TOKEN = 'abc'", "enabled": True}],
                        "endpoint": "https://user:pass@example.test/data",
                        "credentials": {"password": "hidden"},
                    },
                )
            ],
            "edges": [],
        }
        issues = GraphValidator().validate(graph).issues
        self.assertGreaterEqual(sum(issue.code == "embedded_secret" for issue in issues), 3)
        self.assertNotIn("hidden", json.dumps([issue.to_dict() for issue in issues]))

    def test_allows_opaque_credential_references_and_fails_closed_resources(self):
        graph = {
            "nodes": [node("a", "dataset", {"source": "clearml", "datasetId": "d", "connectionId": "vault-ref"})],
            "edges": [],
            "default_queue": "q",
        }
        result = GraphValidator(resource_checker=lambda *_: False, queue_checker=lambda *_: False).validate(graph)
        codes = {issue.code for issue in result.issues}
        self.assertIn("inaccessible_resource", codes)
        self.assertIn("invalid_queue", codes)
        self.assertNotIn("embedded_secret", codes)

    def test_rejects_oversized_inline_script(self):
        graph = {
            "nodes": [node("a", config={"steps": [{"inlineScript": "x" * (MAX_INLINE_SCRIPT_BYTES + 1)}]})],
            "edges": [],
        }
        self.assertIn("script_too_large", {issue.code for issue in GraphValidator().validate(graph).issues})


class CompanyIsolationPolicyTests(unittest.TestCase):
    def test_private_definition_is_readable_and_writable_only_by_its_company(self):
        self.assertTrue(can_read_definition("company-a", None, "company-a"))
        self.assertTrue(can_write_definition("company-a", None, "company-a"))
        self.assertFalse(can_read_definition("company-a", None, "company-b"))
        self.assertFalse(can_write_definition("company-a", None, "company-b"))

    def test_public_definition_is_readable_by_other_company_but_origin_only_can_mutate(self):
        self.assertTrue(can_read_definition("", "company-a", "company-b"))
        self.assertFalse(can_read_definition("", "company-a", "company-b", allow_public=False))
        self.assertFalse(can_write_definition("", "company-a", "company-b"))
        self.assertTrue(can_write_definition("", "company-a", "company-a"))


class ParserCompilerTests(unittest.TestCase):
    def test_parser_extracts_without_executing(self):
        script = """
import argparse
import os
raise RuntimeError('must not execute')
p = argparse.ArgumentParser()
p.add_argument('--epochs', type=int, default=3, choices=[1, 3], help='epochs')
name = os.getenv('RUN_NAME')
"""
        parsed = parse_python_script(script)
        self.assertEqual(parsed["parameters"][0]["name"], "epochs")
        self.assertEqual(parsed["parameters"][0]["type"], "int")
        self.assertEqual(parsed["environment"], ["RUN_NAME"])
        self.assertEqual(parsed["imports"], ["argparse", "os"])

    def test_parser_reports_safe_syntax_error_and_size(self):
        with self.assertRaisesRegex(ValueError, "invalid Python syntax"):
            parse_python_script("def :")
        with self.assertRaisesRegex(ValueError, "exceeds"):
            parse_python_script("x" * (MAX_INLINE_SCRIPT_BYTES + 1))

    def test_compiler_preserves_graph_and_normalizes_pipeline(self):
        graph = {
            "nodes": [node("a", "dataset"), node("b", "training")],
            "edges": [{"id": "ab", "source": "a", "target": "b"}],
            "viewport": {"x": 7, "y": 9, "zoom": 1.25},
            "future_field": {"keep": True},
        }
        compiled = compile_definition(graph, revision=4, default_queue="q")
        self.assertEqual(compiled["clearpipe"]["future_field"], {"keep": True})
        self.assertEqual(compiled["clearpipe"]["revision"], 4)
        self.assertEqual(compiled["pipeline"]["b"]["parents"], ["a"])
        self.assertEqual(compiled["pipeline"]["b"]["job_type"], "training")
        ast.parse(compiled["script"])
        self.assertNotIn("__CLEARPIPE_GRAPH__", compiled["script"])

    def test_compiled_script_has_independent_bound(self):
        with self.assertRaisesRegex(ValueError, "compiled controller script exceeds"):
            render_controller_script({"padding": "x" * MAX_COMPILED_SCRIPT_BYTES})


class FakeBackend:
    def __init__(self, outcomes=None, cancel=False):
        self.outcomes = {key: list(value) for key, value in (outcomes or {}).items()}
        self.cancel_now = cancel
        self.launched = []
        self.updates = []
        self.cancelled_handles = []
        self.restored = {}

    def cancelled(self):
        return self.cancel_now

    def restore(self, node_id):
        return self.restored.get(node_id)

    def launch(self, item, inputs, parameters, queue):
        handle = {"id": item["id"] + "-" + str(len(self.launched)), "node": item["id"], "inputs": inputs}
        self.launched.append(handle)
        return handle

    def status(self, handle):
        values = self.outcomes.setdefault(handle["node"], ["completed"])
        return values.pop(0) if len(values) > 1 else values[0]

    def outputs(self, handle):
        return {"manifest": {"uri": "s3://bucket/" + handle["id"]}}

    def cancel(self, handle):
        self.cancelled_handles.append(handle)

    def update_pipeline(self, node_id, handle, status):
        self.updates.append((node_id, status))

    @staticmethod
    def handle_id(handle):
        return handle["id"]


class RunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        namespace = {"__name__": "clearpipe_runner_test", "CLEARPIPE_GRAPH": "{}"}
        exec(compile(RUNNER_SOURCE, "<clearpipe-runner>", "exec"), namespace)
        cls.DagRunner = namespace["DagRunner"]

    def test_parallel_roots_fan_in_and_artifact_propagation(self):
        graph = {
            "nodes": [node("a"), node("b"), node("c")],
            "edges": [
                {"id": "ac", "source": "a", "target": "c"},
                {"id": "bc", "source": "b", "target": "c"},
            ],
        }
        backend = FakeBackend()
        result = self.DagRunner(graph, backend, poll_interval=0).run()
        self.assertEqual([item["node"] for item in backend.launched[:2]], ["a", "b"])
        child = backend.launched[2]
        self.assertEqual(set(child["inputs"]), {"a", "b"})
        self.assertEqual(set(result), {"a", "b", "c"})

    def test_retry_then_success(self):
        graph = {"nodes": [node("a", config={"steps": [], "retries": 1})], "edges": []}
        backend = FakeBackend({"a": ["failed", "completed"]})
        self.DagRunner(graph, backend, poll_interval=0).run()
        self.assertEqual(sum(item["node"] == "a" for item in backend.launched), 2)

    def test_failed_parent_blocks_child_and_continue_on_fail_does_not_propagate_failed_outputs(self):
        blocked = {"nodes": [node("a"), node("b")], "edges": [{"id": "ab", "source": "a", "target": "b"}]}
        with self.assertRaisesRegex(RuntimeError, "a, b"):
            self.DagRunner(blocked, FakeBackend({"a": ["failed"]}), poll_interval=0).run()
        continued = {
            "nodes": [node("a"), node("b", config={"steps": [], "continueOnFail": True})],
            "edges": [{"id": "ab", "source": "a", "target": "b"}],
        }
        backend = FakeBackend({"a": ["failed"], "b": ["completed"]})
        with self.assertRaisesRegex(RuntimeError, "a"):
            self.DagRunner(continued, backend, poll_interval=0).run()
        self.assertEqual(backend.launched[-1]["inputs"], {})

    def test_cancellation(self):
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            self.DagRunner({"nodes": [node("a")], "edges": []}, FakeBackend(cancel=True), poll_interval=0).run()

    def test_embedded_child_covers_all_six_adapters(self):
        ast.parse("CLEARPIPE_GRAPH = '{}'\n" + RUNNER_SOURCE)
        for adapter in ("dataset", "versioning", "execute", "training", "experiment", "report"):
            self.assertIn('"' + adapter + '": ' + adapter, RUNNER_SOURCE)

    def test_restart_restores_completed_child_without_duplicate_launch(self):
        graph = {"nodes": [node("a"), node("b")], "edges": [{"id": "ab", "source": "a", "target": "b"}]}
        backend = FakeBackend()
        backend.restored["a"] = ({"id": "a-existing", "node": "a", "inputs": {}}, "completed")
        self.DagRunner(graph, backend, poll_interval=0).run()
        self.assertEqual([item["node"] for item in backend.launched], ["b"])
        self.assertEqual(backend.launched[0]["inputs"]["a"]["manifest"]["uri"], "s3://bucket/a-existing")

    def test_timeout_cancels_child(self):
        graph = {"nodes": [node("a", config={"steps": [], "timeout": -1})], "edges": []}
        backend = FakeBackend({"a": ["queued"]})
        with self.assertRaisesRegex(RuntimeError, "a"):
            self.DagRunner(graph, backend, poll_interval=0).run()
        self.assertEqual(len(backend.cancelled_handles), 1)

    def test_five_transient_status_failures_become_terminal_failure(self):
        class TransientBackend(FakeBackend):
            def status(self, handle):
                raise ConnectionError("temporary")

        with self.assertRaisesRegex(RuntimeError, "a"):
            self.DagRunner({"nodes": [node("a")], "edges": []}, TransientBackend(), poll_interval=0).run()

    def test_controller_cancellation_propagates_to_active_child(self):
        class CancellingBackend(FakeBackend):
            def status(self, handle):
                self.cancel_now = True
                return "queued"

        backend = CancellingBackend()
        with self.assertRaisesRegex(RuntimeError, "cancelled"):
            self.DagRunner({"nodes": [node("a")], "edges": []}, backend, poll_interval=0).run()
        self.assertEqual(len(backend.cancelled_handles), 1)


if __name__ == "__main__":
    unittest.main()
