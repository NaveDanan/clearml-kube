"""Focused tests for the ClearPipe flow-node metadata dispatcher and the
Report node lowerer (``apiserver.bll.clearpipe.generation.flow_nodes``).

Two layers are exercised:

* Compile layer -- a report graph is lowered through the real compiler to check
  metadata dispatch, config parsing, and the generated step shape.
* Runtime layer -- the generated report function body is executed against a fake
  ``clearml`` SDK to assert the ``reports.create`` / ``reports.update`` payloads,
  artifact-source resolution, template handling, and failure behavior.
"""

import json
import sys
import types
import unittest
from types import SimpleNamespace

from apiserver.bll.clearpipe.generation.compiler import compile_graph
from apiserver.bll.clearpipe.generation.flow_nodes import (
    _render_report_function,
    flow_node_meta,
    lower_flow_function_node,
)
from apiserver.bll.clearpipe.generation.function import lower_function_node
from apiserver.bll.clearpipe.graph_v2 import derive_graph_dependencies, read_graph_v2
from apiserver.bll.clearpipe.generation.contracts import FunctionLoweringInput
from apiserver.tests.clearpipe.factories import function_node, graph_document, port


def _output_only_ports():
    return [
        port(
            "out-result",
            name="result",
            direction="output",
            role="data",
            accepted_binding_kinds=["data"],
            multiplicity="many",
        )
    ]


def _report_source(config, name="report_step", with_graph_meta=False):
    meta = "# clearpipe-flow-node:" + json.dumps({"type": "report", "config": config})
    lines = [meta]
    if with_graph_meta:
        lines.append("# clearpipe-flow-graph:" + json.dumps({"name": "demo"}))
    lines.append("def {}() -> object:".format(name))
    lines.append("    return None")
    lines.append("")
    return "\n".join(lines)


def _report_node(config=None, name="report_step", with_graph_meta=False):
    return function_node(
        "report-node",
        name=name,
        signature="def {}() -> object".format(name),
        source=_report_source(config or {}, name=name, with_graph_meta=with_graph_meta),
        ports=_output_only_ports(),
        configuration={"task_type": "application", "cache": False},
    )


def _plain_node(name="plain_step"):
    source = "def {}() -> object:\n    return None\n".format(name)
    return function_node(
        "plain-node",
        name=name,
        signature="def {}() -> object".format(name),
        source=source,
        ports=_output_only_ports(),
        configuration={"task_type": "application", "cache": False},
    )


def _compile(node):
    parsed = read_graph_v2(graph_document(nodes=[node], bindings=[]))
    assert parsed.is_supported, parsed
    return compile_graph(
        parsed.graph, lowerers={"function": lower_flow_function_node}
    ).source


def _lowering_for(node):
    parsed = read_graph_v2(graph_document(nodes=[node], bindings=[]))
    assert parsed.is_supported, parsed
    graph = parsed.graph
    only = graph.nodes[0]
    parent_ids = tuple(
        dep.source_node_id
        for dep in derive_graph_dependencies(graph)
        if dep.target_node_id == only.id
    )
    return FunctionLoweringInput(
        graph=graph, node=only, inbound_bindings=(), parent_node_ids=parent_ids
    )


# --------------------------------------------------------------------------- #
# Runtime fakes for executing the generated report function body.
# --------------------------------------------------------------------------- #


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def json(self):
        return {"data": self._data}


class _FakeSession:
    def __init__(self, responses=None, fail_on=None):
        self.calls = []
        self.responses = responses or {}
        self.fail_on = set(fail_on or ())

    def send_request(self, service, action, method=None, json=None, **kwargs):
        self.calls.append(
            {"service": service, "action": action, "method": method, "json": json}
        )
        key = (service, action)
        if key in self.fail_on:
            raise RuntimeError("api failure {}.{}".format(service, action))
        return _FakeResponse(self.responses.get(key, {}))


class _FakeLogger:
    def __init__(self):
        self.messages = []

    def report_text(self, text):
        self.messages.append(text)


class _FakeCurrentTask:
    def __init__(self, project="proj-1"):
        self.project = project
        self.logger = _FakeLogger()

    def get_logger(self):
        return self.logger


class _FakeArtifactTask:
    def __init__(self, artifacts):
        self.artifacts = artifacts


def _run_report_body(
    name,
    title,
    template_report_id,
    artifact_sources,
    *,
    session,
    current_task,
    tasks_by_id=None,
):
    tasks_by_id = tasks_by_id or {}

    class _Task:
        @staticmethod
        def current_task():
            return current_task

        @staticmethod
        def _get_default_session():
            return session

        @staticmethod
        def get_task(task_id=None):
            if task_id in tasks_by_id:
                return tasks_by_id[task_id]
            raise ValueError("unknown task {}".format(task_id))

    fake_clearml = types.ModuleType("clearml")
    fake_clearml.Task = _Task

    source = _render_report_function(
        name, title, template_report_id, artifact_sources
    )
    namespace = {}
    saved = sys.modules.get("clearml")
    sys.modules["clearml"] = fake_clearml
    try:
        exec(compile(source, "<report>", "exec"), namespace)  # noqa: S102
        return namespace[name]()
    finally:
        if saved is not None:
            sys.modules["clearml"] = saved
        else:
            sys.modules.pop("clearml", None)


# --------------------------------------------------------------------------- #
# 1. Metadata parsing and malformed metadata.
# --------------------------------------------------------------------------- #


class FlowNodeMetaTests(unittest.TestCase):
    def test_parses_valid_node_metadata(self):
        node = SimpleNamespace(
            source=_report_source({"templateReportId": "tmpl", "artifactSources": []})
        )
        meta = flow_node_meta(node)
        self.assertEqual(meta["type"], "report")
        self.assertEqual(meta["config"]["templateReportId"], "tmpl")

    def test_ignores_graph_meta_line_and_returns_node_meta(self):
        node = SimpleNamespace(source=_report_source({"title": "R"}, with_graph_meta=True))
        self.assertEqual(flow_node_meta(node)["type"], "report")

    def test_missing_metadata_returns_none(self):
        node = SimpleNamespace(source="def f() -> object:\n    return None\n")
        self.assertIsNone(flow_node_meta(node))

    def test_malformed_json_returns_none(self):
        node = SimpleNamespace(source="# clearpipe-flow-node:{not valid json]\ndef f(): pass")
        self.assertIsNone(flow_node_meta(node))

    def test_non_dict_payload_returns_none(self):
        node = SimpleNamespace(source="# clearpipe-flow-node:[1, 2, 3]\ndef f(): pass")
        self.assertIsNone(flow_node_meta(node))

    def test_non_string_source_returns_none(self):
        self.assertIsNone(flow_node_meta(SimpleNamespace(source=None)))
        self.assertIsNone(flow_node_meta(SimpleNamespace()))

    def test_dispatcher_passthrough_is_identical_for_plain_nodes(self):
        node = _plain_node()
        lowering = _lowering_for(node)
        self.assertEqual(
            lower_flow_function_node(lowering), lower_function_node(lowering)
        )


# --------------------------------------------------------------------------- #
# 2. Report config parsing + 6. no function output / no .pkl artifact.
# --------------------------------------------------------------------------- #


class ReportCompileTests(unittest.TestCase):
    def test_title_defaults_to_node_label(self):
        source = _compile(_report_node({}))
        # factory label for "report_step" -> "Report Step"
        self.assertIn('title = "Report Step"', source)

    def test_title_from_config_overrides_label(self):
        source = _compile(_report_node({"title": "Weekly Summary"}))
        self.assertIn('title = "Weekly Summary"', source)

    def test_config_values_are_embedded(self):
        source = _compile(
            _report_node(
                {
                    "templateReportId": "tmpl-9",
                    "artifactSources": ["t1.metrics", "note"],
                }
            )
        )
        self.assertIn('template_report_id = "tmpl-9"', source)
        self.assertIn('artifact_sources = ["t1.metrics", "note"]', source)

    def test_non_string_artifact_sources_are_coerced_or_dropped(self):
        source = _compile(
            _report_node({"artifactSources": ["ok", 5, {"bad": 1}, None]})
        )
        # ints coerced to strings, non-scalars dropped
        self.assertIn('artifact_sources = ["ok", "5"]', source)

    def test_step_has_no_pickled_return_and_is_not_a_noop(self):
        source = _compile(_report_node({"title": "R"}))
        self.assertIn("add_function_step", source)
        self.assertIn("function_return=[]", source)
        self.assertEqual(source.count("return None"), 0)
        self.assertIn("reports", source)
        self.assertIn("create", source)
        self.assertIn("update", source)

    def test_generated_program_is_valid_python(self):
        import ast

        ast.parse(_compile(_report_node({"title": "R", "artifactSources": ["t.a"]})))


# --------------------------------------------------------------------------- #
# 3/4/5/7. Runtime behavior of the generated report body.
# --------------------------------------------------------------------------- #


class ReportRuntimeTests(unittest.TestCase):
    def _session(self, **kwargs):
        responses = {("reports", "create"): {"id": "report-1"}}
        responses.update(kwargs.pop("responses", {}))
        return _FakeSession(responses=responses, **kwargs)

    def test_create_then_update_payloads(self):
        session = self._session()
        current = _FakeCurrentTask(project="proj-42")
        result = _run_report_body(
            "report_step",
            "My Report",
            "",
            ["just a note"],
            session=session,
            current_task=current,
        )
        self.assertEqual(result, "report-1")
        actions = [(c["service"], c["action"]) for c in session.calls]
        self.assertEqual(actions, [("reports", "create"), ("reports", "update")])

        create_call, update_call = session.calls
        self.assertEqual(create_call["method"], "post")
        self.assertEqual(create_call["json"]["name"], "My Report")
        self.assertEqual(create_call["json"]["project"], "proj-42")
        self.assertEqual(update_call["json"]["task"], "report-1")
        self.assertIn("# My Report", update_call["json"]["report"])
        self.assertIn("- just a note", update_call["json"]["report"])

    def test_project_omitted_when_task_has_none(self):
        session = self._session()
        current = _FakeCurrentTask(project=None)
        _run_report_body(
            "report_step", "R", "", [], session=session, current_task=current
        )
        self.assertNotIn("project", session.calls[0]["json"])

    def test_artifact_source_resolution_with_preview(self):
        session = self._session()
        artifact = SimpleNamespace(preview="PREVIEW-BODY", url=None)
        tasks = {"taskA": _FakeArtifactTask({"metrics": artifact})}
        _run_report_body(
            "report_step",
            "R",
            "",
            ["taskA.metrics"],
            session=session,
            current_task=_FakeCurrentTask(),
            tasks_by_id=tasks,
        )
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("## metrics", report_md)
        self.assertIn("PREVIEW-BODY", report_md)

    def test_artifact_source_resolution_with_url_when_no_preview(self):
        session = self._session()
        artifact = SimpleNamespace(preview=None, url="s3://bucket/model.bin")
        tasks = {"taskA": _FakeArtifactTask({"model": artifact})}
        _run_report_body(
            "report_step",
            "R",
            "",
            ["taskA.model"],
            session=session,
            current_task=_FakeCurrentTask(),
            tasks_by_id=tasks,
        )
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("s3://bucket/model.bin", report_md)

    def test_template_report_prepended(self):
        session = self._session(
            responses={
                ("reports", "get_all_ex"): {"tasks": [{"report": "TEMPLATE-MD"}]}
            }
        )
        _run_report_body(
            "report_step",
            "R",
            "tmpl-1",
            [],
            session=session,
            current_task=_FakeCurrentTask(),
        )
        actions = [(c["service"], c["action"]) for c in session.calls]
        self.assertEqual(actions[0], ("reports", "get_all_ex"))
        report_md = session.calls[-1]["json"]["report"]
        self.assertTrue(report_md.startswith("TEMPLATE-MD"))

    def test_no_template_fetch_when_id_absent(self):
        session = self._session()
        _run_report_body(
            "report_step", "R", "", [], session=session, current_task=_FakeCurrentTask()
        )
        actions = [(c["service"], c["action"]) for c in session.calls]
        self.assertNotIn(("reports", "get_all_ex"), actions)

    def test_template_fetch_failure_degrades_gracefully(self):
        session = self._session(fail_on={("reports", "get_all_ex")})
        result = _run_report_body(
            "report_step",
            "R",
            "tmpl-1",
            [],
            session=session,
            current_task=_FakeCurrentTask(),
        )
        self.assertEqual(result, "report-1")
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("template report unavailable", report_md)

    def test_missing_artifact_task_degrades_gracefully(self):
        session = self._session()
        # taskZ not present in tasks_by_id -> get_task raises -> unavailable note
        result = _run_report_body(
            "report_step",
            "R",
            "",
            ["taskZ.metrics"],
            session=session,
            current_task=_FakeCurrentTask(),
            tasks_by_id={},
        )
        self.assertEqual(result, "report-1")
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("unavailable", report_md)

    def test_absent_artifact_on_existing_task_falls_back_to_literal(self):
        session = self._session()
        tasks = {"taskA": _FakeArtifactTask({})}  # no such artifact
        _run_report_body(
            "report_step",
            "R",
            "",
            ["taskA.metrics"],
            session=session,
            current_task=_FakeCurrentTask(),
            tasks_by_id=tasks,
        )
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("- taskA.metrics", report_md)

    def test_create_api_failure_propagates(self):
        session = self._session(fail_on={("reports", "create")})
        with self.assertRaises(RuntimeError):
            _run_report_body(
                "report_step",
                "R",
                "",
                [],
                session=session,
                current_task=_FakeCurrentTask(),
            )

    def test_update_api_failure_propagates(self):
        session = self._session(fail_on={("reports", "update")})
        with self.assertRaises(RuntimeError):
            _run_report_body(
                "report_step",
                "R",
                "",
                [],
                session=session,
                current_task=_FakeCurrentTask(),
            )

    def test_artifact_preview_secrets_are_redacted(self):
        session = self._session()
        secret_preview = (
            "AWS_SECRET_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE\n"
            "password = hunter2\napi_key: sk-livedeadbeef123456"
        )
        artifact = SimpleNamespace(preview=secret_preview, url=None)
        tasks = {"taskA": _FakeArtifactTask({"metrics": artifact})}
        _run_report_body(
            "report_step",
            "R",
            "",
            ["taskA.metrics"],
            session=session,
            current_task=_FakeCurrentTask(),
            tasks_by_id=tasks,
        )
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("***REDACTED***", report_md)
        self.assertNotIn("hunter2", report_md)
        self.assertNotIn("AKIAIOSFODNN7EXAMPLE", report_md)
        self.assertNotIn("sk-livedeadbeef123456", report_md)

    def test_error_message_secrets_are_redacted(self):
        session = self._session()

        class _RaisingArtifacts:
            def get(self, name):
                raise RuntimeError("connect failed token=supersecrettoken123")

        tasks = {"taskA": SimpleNamespace(artifacts=_RaisingArtifacts())}
        _run_report_body(
            "report_step",
            "R",
            "",
            ["taskA.metrics"],
            session=session,
            current_task=_FakeCurrentTask(),
            tasks_by_id=tasks,
        )
        report_md = session.calls[-1]["json"]["report"]
        self.assertIn("***REDACTED***", report_md)
        self.assertNotIn("supersecrettoken123", report_md)


if __name__ == "__main__":
    unittest.main()
