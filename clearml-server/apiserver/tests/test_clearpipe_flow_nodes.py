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

from apiserver.bll.clearpipe.generation.compiler import GenerationError, compile_graph
from apiserver.bll.clearpipe.generation.flow_nodes import (
    _render_autoscaler_function,
    _render_report_function,
    _render_report_function_v2,
    _resolve_base_task_id,
    _resolve_dataset_task_id,
    _sanitize_report_mappings,
    flow_node_meta,
    lower_flow_function_node,
)
from apiserver.bll.clearpipe.generation.function import lower_function_node
from apiserver.bll.clearpipe.graph_v2 import derive_graph_dependencies, read_graph_v2
from apiserver.bll.clearpipe.generation.contracts import FunctionLoweringInput
from apiserver.tests.clearpipe.factories import binding, function_node, graph_document, port


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
    def __init__(self, data, ok=True, text=""):
        self._data = data
        self.ok = ok
        self.text = text

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


def _last_report_markdown(session):
    return next(
        call["json"]["report"]
        for call in reversed(session.calls)
        if call["service"] == "reports" and call["action"] == "update"
    )


def _run_report_body(
    name,
    title,
    template_report_id,
    artifact_sources,
    *,
    session,
    current_task,
    tasks_by_id=None,
    mappings=None,
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
        name, title, template_report_id, artifact_sources, mappings
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
        report_md = _last_report_markdown(session)
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
        report_md = _last_report_markdown(session)
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
        report_md = _last_report_markdown(session)
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
        report_md = _last_report_markdown(session)
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
        report_md = _last_report_markdown(session)
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


# --------------------------------------------------------------------------- #
# 8. Template-fill mappings (text placeholders + media iframe rewrite).
# --------------------------------------------------------------------------- #


class ReportTemplateFillTests(unittest.TestCase):
    def _session(self, template_md, tasks, **kwargs):
        responses = {
            ("reports", "create"): {"id": "report-1"},
            ("reports", "get_all_ex"): {"tasks": [{"report": template_md}]},
            ("tasks", "get_all_ex"): {"tasks": tasks},
        }
        responses.update(kwargs.pop("responses", {}))
        return _FakeSession(responses=responses, **kwargs)

    def _fill(self, template_md, tasks, mappings):
        session = self._session(template_md, tasks)
        _run_report_body(
            "report_step",
            "R",
            "tmpl-1",
            [],
            session=session,
            current_task=_FakeCurrentTask(),
            mappings=mappings,
        )
        return session.calls[-1]["json"]["report"], session

    def test_text_field_tokens_are_filled(self):
        md = "Run <TASK_NAME> (<TASK_ID>) status <STATUS>."
        tasks = [{"id": "t1", "name": "resnet-run", "status": "completed"}]
        report, _ = self._fill(
            md,
            tasks,
            {
                "text:TASK_NAME": {"taskId": "t1", "kind": "field", "ref": "name"},
                "text:TASK_ID": {"taskId": "t1", "kind": "field", "ref": "id"},
                "text:STATUS": {"taskId": "t1", "kind": "field", "ref": "status"},
            },
        )
        self.assertIn("Run resnet-run (t1) status completed.", report)

    def test_project_field_reads_nested_name(self):
        md = "Project: <PROJECT>"
        tasks = [{"id": "t1", "project": {"name": "vision/prod"}}]
        report, _ = self._fill(
            md, tasks, {"text:PROJECT": {"taskId": "t1", "kind": "field", "ref": "project"}}
        )
        self.assertIn("Project: vision/prod", report)

    def test_scalar_mapping_fills_token_with_value(self):
        md = "Accuracy = <ACCURACY>"
        tasks = [
            {
                "id": "t1",
                "last_metrics": {
                    "h1": {"h2": {"metric": "accuracy", "variant": "top1", "value": 0.97}}
                },
            }
        ]
        report, _ = self._fill(
            md,
            tasks,
            {
                "text:ACCURACY": {
                    "taskId": "t1",
                    "kind": "scalar",
                    "ref": "scalar\x00accuracy\x00top1",
                    "metric": "accuracy",
                    "variant": "top1",
                }
            },
        )
        self.assertIn("Accuracy = 0.97", report)

    def test_hyperparam_mapping_fills_token(self):
        md = "LR = <LR>"
        tasks = [{"id": "t1", "hyperparams": {"General": {"lr": {"value": "0.001"}}}}]
        report, _ = self._fill(
            md, tasks, {"text:LR": {"taskId": "t1", "kind": "hyperparam", "ref": "General/lr"}}
        )
        self.assertIn("LR = 0.001", report)

    def test_media_iframe_tokens_rewritten_by_name(self):
        md = (
            '<iframe name="loss" '
            'src="/plots?task=<TASK_ID>&metric=<METRIC>&variant=<VARIANT>&company=<COMPANY_ID>">'
            "</iframe>"
        )
        tasks = [{"id": "t1", "company": {"id": "co-9"}}]
        report, _ = self._fill(
            md,
            tasks,
            {
                "media:loss": {
                    "taskId": "t1",
                    "kind": "plot",
                    "ref": "plot\x00loss\x00valid",
                    "metric": "loss",
                    "variant": "valid",
                }
            },
        )
        self.assertIn("task=t1", report)
        self.assertIn("metric=loss", report)
        self.assertIn("variant=valid", report)
        self.assertIn("company=co-9", report)

    def test_widget_embed_metric_variant_aliases_are_filled(self):
        # Real ClearML embeds use type-specific tokens: <PLOT_METRIC>/<PLOT_VARIANT>
        # (plot), <IMAGE_METRIC>/<IMAGE_VARIANT> (sample), <SCALAR_METRIC>/...
        md = (
            '<iframe src="/widgets?type=plot&objectType=task&objects=<TASK_ID>'
            '&metrics=<PLOT_METRIC>&variants=<PLOT_VARIANT>&company=<COMPANY_ID>" '
            'name="pr-roc-curve"></iframe>\n'
            '<iframe src="/widgets?type=sample&objects=<TASK_ID>'
            '&metrics=<IMAGE_METRIC>&variants=<IMAGE_VARIANT>" name="sample-image"></iframe>'
        )
        tasks = [{"id": "t1", "company": {"id": "co-9"}}]
        report, _ = self._fill(
            md,
            tasks,
            {
                "media:pr-roc-curve": {
                    "taskId": "t1",
                    "kind": "plot",
                    "ref": "plot\x00Validation ROC AUC\x00plot image",
                    "metric": "Validation ROC AUC",
                    "variant": "plot image",
                },
                "media:sample-image": {
                    "taskId": "t1",
                    "kind": "plot",
                    "ref": "plot\x00augmentation_preview\x00",
                    "metric": "augmentation_preview",
                    "variant": "",
                },
            },
        )
        self.assertIn("metrics=Validation%20ROC%20AUC", report)
        self.assertIn("variants=plot%20image", report)
        self.assertIn("metrics=augmentation_preview", report)
        self.assertIn("/widgets/?", report)
        self.assertNotIn("<PLOT_METRIC>", report)
        self.assertNotIn("<IMAGE_METRIC>", report)
        self.assertNotIn("<TASK_ID>", report)

    def test_unmapped_iframe_is_untouched(self):
        md = '<iframe name="other" src="/plots?task=<TASK_ID>"></iframe>'
        tasks = [{"id": "t1"}]
        report, _ = self._fill(
            md,
            tasks,
            {
                "media:loss": {
                    "taskId": "t1",
                    "kind": "plot",
                    "ref": "plot\x00l\x00v",
                    "metric": "l",
                    "variant": "v",
                }
            },
        )
        self.assertIn("task=<TASK_ID>", report)

    def test_unmapped_text_token_left_intact(self):
        md = "Hello <UNMAPPED> world"
        report, _ = self._fill(
            md,
            [{"id": "t1", "name": "n"}],
            {"text:OTHER": {"taskId": "t1", "kind": "field", "ref": "name"}},
        )
        self.assertIn("<UNMAPPED>", report)

    def test_no_task_fetch_without_mappings(self):
        session = self._session("no placeholders", [{"id": "t1"}])
        _run_report_body(
            "report_step",
            "R",
            "tmpl-1",
            [],
            session=session,
            current_task=_FakeCurrentTask(),
        )
        actions = [(c["service"], c["action"]) for c in session.calls]
        self.assertNotIn(("tasks", "get_all_ex"), actions)

    def test_mapped_value_is_redacted(self):
        md = "Note: <NOTE>"
        tasks = [{"id": "t1", "name": "token=supersecrettoken123"}]
        report, _ = self._fill(
            md, tasks, {"text:NOTE": {"taskId": "t1", "kind": "field", "ref": "name"}}
        )
        self.assertIn("***REDACTED***", report)
        self.assertNotIn("supersecrettoken123", report)


# --------------------------------------------------------------------------- #
# 9. Graph-aware Task-node lowering (real PipelineController.add_step).
# --------------------------------------------------------------------------- #


def _task_flow_node(config, name="train_step", node_id="task-node"):
    meta = "# clearpipe-flow-node:" + json.dumps({"type": "task", "config": config})
    source = "\n".join([meta, "def {}() -> object:".format(name), "    return None", ""])
    return function_node(
        node_id,
        name=name,
        signature="def {}() -> object".format(name),
        source=source,
        ports=_output_only_ports(),
        configuration={"task_type": "application", "cache": False},
    )


def _dataset_flow_node(config, name="dataset_step", node_id="dataset-node"):
    meta = "# clearpipe-flow-node:" + json.dumps(
        {"type": "dataset", "config": config}
    )
    source = "\n".join(
        [meta, "def {}() -> object:".format(name), "    return None", ""]
    )
    return function_node(
        node_id,
        name=name,
        signature="def {}() -> object".format(name),
        source=source,
        ports=_output_only_ports(),
        configuration={"task_type": "application", "cache": False},
    )


def _scheduled_flow_node(config=None, name="scheduled_step", node_id="scheduled-node"):
    meta = "# clearpipe-flow-node:" + json.dumps(
        {"type": "scheduled", "config": config or {}}
    )
    source = "\n".join(
        [meta, "def {}() -> object:".format(name), "    return None", ""]
    )
    return function_node(
        node_id,
        name=name,
        signature="def {}() -> object".format(name),
        source=source,
        ports=_output_only_ports(),
        configuration={"task_type": "application", "cache": False},
    )


def _autoscaler_flow_node(config, name="autoscaler_step", node_id="autoscaler-node"):
    meta = "# clearpipe-flow-node:" + json.dumps(
        {"type": "autoscaler", "config": config}
    )
    source = "\n".join(
        [meta, "def {}() -> object:".format(name), "    return None", ""]
    )
    return function_node(
        node_id,
        name=name,
        signature="def {}() -> object".format(name),
        source=source,
        ports=_output_only_ports(),
        configuration={"task_type": "application", "cache": False},
    )


def _compile_graph(nodes, bindings):
    parsed = read_graph_v2(graph_document(nodes=nodes, bindings=bindings))
    assert parsed.is_supported, parsed
    return compile_graph(
        parsed.graph, lowerers={"function": lower_flow_function_node}
    ).source


class TaskNodeLoweringTests(unittest.TestCase):
    def test_resolve_base_task_id_rules(self):
        self.assertEqual(_resolve_base_task_id({"baseTaskId": "base-1"}), "base-1")
        self.assertEqual(_resolve_base_task_id({"taskIds": ["only-1"]}), "only-1")
        # Multi-item legacy arrays are ambiguous and are not resolved.
        self.assertIsNone(_resolve_base_task_id({"taskIds": ["a", "b"]}))
        self.assertIsNone(_resolve_base_task_id({}))
        # baseTaskId wins over legacy.
        self.assertEqual(
            _resolve_base_task_id({"baseTaskId": "x", "taskIds": ["y"]}), "x"
        )

    def test_configured_task_lowers_to_add_step(self):
        source = _compile_graph([_task_flow_node({"baseTaskId": "base-abc"})], [])
        self.assertIn("pipe.add_step(", source)
        self.assertIn('base_task_id="base-abc"', source)
        self.assertNotIn("add_function_step", source)

    def test_flow_queue_and_parameter_overrides_are_preserved(self):
        source = _compile_graph(
            [
                _task_flow_node(
                    {
                        "baseTaskId": "base-abc",
                        "queue": "default",
                        "parameterOverrides": {
                            "Args/clearml_dataset_project": "datasets",
                            "Args/clearml_dataset_name": "training-data",
                        },
                    }
                )
            ],
            [],
        )
        self.assertIn('execution_queue="default"', source)
        self.assertIn(
            '"Args/clearml_dataset_name": "training-data"', source
        )
        self.assertIn(
            '"Args/clearml_dataset_project": "datasets"', source
        )

    def test_unconfigured_task_keeps_backward_compatible_noop(self):
        source = _compile_graph([_task_flow_node({})], [])
        self.assertIn("add_function_step", source)
        self.assertNotIn("pipe.add_step(", source)

    def test_legacy_single_taskids_lowers_to_add_step(self):
        source = _compile_graph([_task_flow_node({"taskIds": ["legacy-1"]})], [])
        self.assertIn('base_task_id="legacy-1"', source)

    def test_generated_program_is_valid_python(self):
        import ast

        ast.parse(_compile_graph([_task_flow_node({"baseTaskId": "base-abc"})], []))


class DatasetNodeLoweringTests(unittest.TestCase):
    def test_resolve_sync_task_id_rules(self):
        self.assertEqual(
            _resolve_dataset_task_id({"syncTaskId": "sync-1"}), "sync-1"
        )
        self.assertEqual(
            _resolve_dataset_task_id({"baseTaskId": "sync-2"}), "sync-2"
        )
        self.assertIsNone(_resolve_dataset_task_id({"syncDatasetId": "project"}))

    def test_dataset_sync_clones_task_on_dataset_queue(self):
        source = _compile_graph(
            [
                _dataset_flow_node(
                    {
                        "mode": "sync",
                        "syncTaskId": "dataset-sync-task",
                        "queue": "dataset",
                    }
                )
            ],
            [],
        )
        self.assertIn("pipe.add_step(", source)
        self.assertIn('base_task_id="dataset-sync-task"', source)
        self.assertIn('execution_queue="dataset"', source)
        self.assertNotIn("add_function_step", source)


class ScheduledNodeLoweringTests(unittest.TestCase):
    def test_scheduled_marker_returns_primitive_instead_of_pickle_artifact(self):
        source = _compile_graph([_scheduled_flow_node()], [])
        self.assertIn("def scheduled_step() -> object:\n    return True", source)
        self.assertIn("pipe.add_function_step(", source)
        self.assertNotIn("def scheduled_step() -> object:\n    return None", source)


class AutoscalerNodeLoweringTests(unittest.TestCase):
    def test_spinup_uses_submit_workload_and_platform_managed_queue(self):
        source = _compile_graph(
            [
                _autoscaler_flow_node(
                    {
                        "mode": "spinup",
                        "workloadName": "pipeline-agent",
                        "workload_type": "training",
                        "project": "ml-project",
                        "image": "allegroai/clearml-agent:latest",
                        "command": "clearml-agent daemon",
                        "queue": "runai",
                        "gpu_devices_request": "1",
                    }
                )
            ],
            [],
        )

        self.assertIn('action="submit_workload"', source)
        self.assertIn('"workload_name": "pipeline-agent"', source)
        self.assertIn('"command": "clearml-agent daemon"', source)
        self.assertIn('"gpu_devices_request": "1"', source)
        self.assertNotIn('"queue": "runai"', source)
        self.assertIn('action="get_execution"', source)

    def test_missing_command_defaults_to_clearml_agent_daemon(self):
        source = _compile_graph(
            [
                _autoscaler_flow_node(
                    {
                        "mode": "spinup",
                        "workloadName": "pipeline-agent",
                        "environment": "clearml-agent-environment",
                    }
                )
            ],
            [],
        )

        self.assertIn('"command": "clearml-agent daemon"', source)

    def test_image_or_environment_is_required_like_submit_dialog(self):
        with self.assertRaises(GenerationError) as raised:
            _compile_graph(
                [_autoscaler_flow_node({"mode": "spinup", "workloadName": "agent"})],
                [],
            )

        self.assertEqual(raised.exception.diagnostics[0].code, "CPSEM004")
        self.assertIn("container image or Run:ai environment", raised.exception.diagnostics[0].message)

    def test_generated_program_is_valid_python(self):
        import ast

        ast.parse(
            _compile_graph(
                [
                    _autoscaler_flow_node(
                        {
                            "mode": "spinup",
                            "workloadName": "pipeline-agent",
                            "image": "allegroai/clearml-agent:latest",
                        }
                    )
                ],
                [],
            )
        )

    def test_downstream_task_waits_for_successful_runai_submission(self):
        autoscaler = _autoscaler_flow_node(
            {
                "mode": "spinup",
                "workloadName": "pipeline-agent",
                "image": "allegroai/clearml-agent:latest",
            }
        )
        task = _task_flow_node(
            {"baseTaskId": "base-task", "queue": "runai"},
            name="training_step",
            node_id="task-node",
        )
        edge = binding(
            "autoscaler-to-task",
            kind="execution-only",
            source_node_id="autoscaler-node",
            target_node_id="task-node",
        )
        source = _compile_graph([autoscaler, task], [edge])

        self.assertIn('action="submit_workload"', source)
        self.assertIn('execution_queue="runai"', source)
        self.assertIn('parents=["autoscaler_step"]', source)

    def test_runtime_waits_for_worker_execution_and_returns_identity(self):
        session = _FakeSession(
            responses={
                ("autoscaler", "submit_workload"): {
                    "status": "queued",
                    "execution_id": "execution-1",
                },
                ("autoscaler", "get_execution"): {
                    "status": "success",
                    "stdout": "workload submitted",
                },
            }
        )

        class _Task:
            @staticmethod
            def _get_default_session():
                return session

        fake_clearml = types.ModuleType("clearml")
        fake_clearml.Task = _Task
        saved = sys.modules.get("clearml")
        sys.modules["clearml"] = fake_clearml
        try:
            namespace = {}
            source = _render_autoscaler_function(
                "autoscaler_step",
                "submit_workload",
                {
                    "workload": {
                        "workload_type": "training",
                        "workload_name": "pipeline-agent",
                        "project": "ml-project",
                        "image": "agent:latest",
                        "command": "clearml-agent daemon",
                    }
                },
                60,
            )
            exec(compile(source, "<autoscaler>", "exec"), namespace)  # noqa: S102
            result = namespace["autoscaler_step"]()
        finally:
            if saved is not None:
                sys.modules["clearml"] = saved
            else:
                sys.modules.pop("clearml", None)

        self.assertEqual(result["execution_id"], "execution-1")
        self.assertEqual(result["workload_name"], "pipeline-agent")
        self.assertEqual(result["project"], "ml-project")
        self.assertEqual(
            [(call["action"], call["json"]) for call in session.calls],
            [
                (
                    "submit_workload",
                    {
                        "workload": {
                            "workload_type": "training",
                            "workload_name": "pipeline-agent",
                            "project": "ml-project",
                            "image": "agent:latest",
                            "command": "clearml-agent daemon",
                        }
                    },
                ),
                ("get_execution", {"execution_id": "execution-1"}),
            ],
        )


# --------------------------------------------------------------------------- #
# 10. Graph-aware Report lowering: ${step.id} args + runtime resolution.
# --------------------------------------------------------------------------- #


def _fingerprint(md):
    import re

    md = md or ""
    md = re.sub(r"<!--[\s\S]*?-->", " ", md)
    md = re.sub(r"```[\s\S]*?```", " ", md)
    md = re.sub(r"~~~[\s\S]*?~~~", " ", md)
    md = re.sub(r"\s+", " ", md).strip()
    h = 0x811C9DC5
    for ch in md:
        h ^= ord(ch)
        h = (h * 0x01000193) & 0xFFFFFFFF
    return format(h, "08x")


def _run_report_v2(
    report_mappings,
    sources,
    runtime_ids,
    *,
    session,
    current_task=None,
    title="R",
    template_report_id="",
    template_fingerprint="",
    name="report_step",
):
    class _Task:
        @staticmethod
        def current_task():
            return current_task or _FakeCurrentTask()

        @staticmethod
        def _get_default_session():
            return session

    fake_clearml = types.ModuleType("clearml")
    fake_clearml.Task = _Task
    source = _render_report_function_v2(
        name, title, template_report_id, template_fingerprint, report_mappings, sources
    )
    namespace = {}
    saved = sys.modules.get("clearml")
    sys.modules["clearml"] = fake_clearml
    try:
        exec(compile(source, "<report_v2>", "exec"), namespace)  # noqa: S102
        return namespace[name](*runtime_ids)
    finally:
        if saved is not None:
            sys.modules["clearml"] = saved
        else:
            sys.modules.pop("clearml", None)


class ReportGraphAwareCompileTests(unittest.TestCase):
    def _source(self, mappings):
        task = _task_flow_node({"baseTaskId": "base-abc"}, name="train_step", node_id="task-node")
        report = _report_ga(mappings)
        edge = binding(
            "edge-1",
            kind="execution-only",
            source_node_id="task-node",
            target_node_id="report-node",
        )
        return _compile_graph([task, report], [edge])

    def test_report_receives_step_id_runtime_argument(self):
        source = self._source(
            [
                {
                    "slotKey": "text:TASK_NAME",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "name"},
                    "required": True,
                    "confirmed": True,
                }
            ]
        )
        # Task node clones its base task; report binds to the runtime step id.
        self.assertIn('base_task_id="base-abc"', source)
        self.assertIn('"${train_step.id}"', source)
        self.assertIn("def report_step(s0=None) -> object:", source)
        self.assertIn('runtime_task_ids["task-node"] = s0', source)

    def test_no_runtime_task_id_is_persisted_in_report(self):
        source = self._source(
            [
                {
                    "slotKey": "text:TASK_NAME",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "name"},
                    "required": True,
                    "confirmed": True,
                }
            ]
        )
        # The report references the source only by node id + ${step.id}; the base
        # task id belongs to the Task step, never baked into the report mapping.
        report_def = source.split("pipe = PipelineController")[0]
        report_fn = report_def.split("def report_step")[1]
        self.assertNotIn("base-abc", report_fn)

    def test_generated_program_is_valid_python(self):
        import ast

        ast.parse(
            self._source(
                [
                    {
                        "slotKey": "media:roc",
                        "source": {"sourceNodeId": "task-node"},
                        "outputKind": "plot",
                        "selector": {"metric": "ROC", "variant": "v"},
                        "required": True,
                        "confirmed": True,
                    }
                ]
            )
        )

    def test_runtime_report_uses_task_plot_artifacts_when_plot_events_are_absent(self):
        source = self._source(
            [
                {
                    "slotKey": "media:confusion",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "artifact",
                    "selector": {"artifactKey": "validation_confusion_matrix"},
                    "required": True,
                    "confirmed": True,
                },
                {
                    "slotKey": "media:loss",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "scalar_graph",
                    "selector": {"metric": "val", "variant": "loss"},
                    "required": True,
                    "confirmed": True,
                },
            ]
        )
        self.assertIn(
            "_artifact_url(primary, 'validation_confusion_matrix')", source
        )
        self.assertIn(
            "_artifact_url(primary, 'validation_precision_recall_curve')", source
        )

    def test_sanitize_report_mappings_filters_invalid(self):
        clean = _sanitize_report_mappings(
            [
                {"slotKey": "text:A", "source": {"sourceNodeId": "n1"}, "outputKind": "field", "selector": {"field": "name"}},
                {"slotKey": "text:B", "outputKind": "bogus"},  # bad kind
                {"no_slot": 1},  # missing slotKey
                "not-a-dict",
            ]
        )
        self.assertEqual(len(clean), 1)
        self.assertEqual(clean[0]["slotKey"], "text:A")
        self.assertTrue(clean[0]["required"])  # default required

    def test_persisted_template_manifest_requires_every_slot_mapping(self):
        task = _task_flow_node(
            {"baseTaskId": "base-abc"}, name="train_step", node_id="task-node"
        )
        report = _report_ga(
            [],
            config={
                "templateSlots": [
                    {"key": "text:AUTHOR", "kind": "text", "label": "AUTHOR"}
                ],
                "templateFingerprint": "abc12345",
            },
        )
        edge = binding(
            "edge-1",
            kind="execution-only",
            source_node_id="task-node",
            target_node_id="report-node",
        )
        with self.assertRaises(GenerationError) as raised:
            _compile_graph([task, report], [edge])
        self.assertEqual(raised.exception.diagnostics[0].code, "CPSEM004")
        self.assertIn("unmapped", raised.exception.diagnostics[0].message)

    def test_persisted_template_manifest_accepts_confirmed_connected_mapping(self):
        task = _task_flow_node(
            {"baseTaskId": "base-abc"}, name="train_step", node_id="task-node"
        )
        mapping = {
            "slotKey": "text:AUTHOR",
            "source": {"sourceNodeId": "task-node"},
            "outputKind": "field",
            "selector": {"field": "author"},
            "required": True,
            "confirmed": True,
        }
        report = _report_ga(
            [mapping],
            config={
                "templateSlots": [
                    {"key": "text:AUTHOR", "kind": "text", "label": "AUTHOR"}
                ],
                "templateFingerprint": "abc12345",
            },
        )
        edge = binding(
            "edge-1",
            kind="execution-only",
            source_node_id="task-node",
            target_node_id="report-node",
        )
        source = _compile_graph([task, report], [edge])
        self.assertIn('"${train_step.id}"', source)


def _report_ga(mappings, name="report_step", config=None):
    report_config = {"templateReportId": "tmpl", "reportMappings": mappings}
    report_config.update(config or {})
    return _report_node(report_config, name=name)


class ReportGraphAwareRuntimeTests(unittest.TestCase):
    def _session(self, template_md, runtime_tasks, **kwargs):
        responses = {
            ("reports", "create"): {"id": "report-1"},
            ("reports", "get_all_ex"): {"tasks": [{"report": template_md}]},
            ("tasks", "get_all_ex"): {"tasks": runtime_tasks},
        }
        responses.update(kwargs.pop("responses", {}))
        return _FakeSession(responses=responses, **kwargs)

    def test_text_slot_resolves_from_runtime_task(self):
        session = self._session(
            "Run <TASK_NAME>", [{"id": "run-123", "name": "resnet-run"}]
        )
        _run_report_v2(
            [
                {
                    "slotKey": "text:TASK_NAME",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "name"},
                    "required": True,
                    "confirmed": True,
                }
            ],
            [("task-node", "train_step", "s0")],
            ("run-123",),
            session=session,
            template_report_id="tmpl",
        )
        report_md = _last_report_markdown(session)
        self.assertIn("Run resnet-run", report_md)
        self.assertIn(
            ("reports", "publish"),
            [(call["service"], call["action"]) for call in session.calls],
        )

    def test_author_and_company_fields_resolve_from_runtime_task(self):
        session = self._session(
            "By <AUTHOR> at <COMPANY_ID>",
            [
                {
                    "id": "run-123",
                    "user": {"name": "Tester"},
                    "company": {"id": "company-1"},
                }
            ],
        )
        _run_report_v2(
            [
                {
                    "slotKey": "text:AUTHOR",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "author"},
                    "required": True,
                    "confirmed": True,
                },
                {
                    "slotKey": "text:COMPANY_ID",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "company_id"},
                    "required": True,
                    "confirmed": True,
                },
            ],
            [("task-node", "train_step", "s0")],
            ("run-123",),
            session=session,
            template_report_id="tmpl",
        )
        self.assertIn("By Tester at company-1", _last_report_markdown(session))

    def test_required_missing_output_fails_before_report_creation(self):
        session = self._session("Run <TASK_NAME>", [])
        with self.assertRaises(RuntimeError):
            _run_report_v2(
                [
                    {
                        "slotKey": "text:TASK_NAME",
                        "source": {"sourceNodeId": "task-node"},
                        "outputKind": "field",
                        "selector": {"field": "name"},
                        "required": True,
                        "confirmed": True,
                    }
                ],
                [("task-node", "train_step", "s0")],
                (None,),  # source task did not produce a runtime id
                session=session,
                template_report_id="tmpl",
            )
        actions = [(c["service"], c["action"]) for c in session.calls]
        self.assertNotIn(("reports", "create"), actions)

    def test_optional_missing_output_publishes_with_not_reported_note(self):
        session = self._session("Run <TASK_NAME>", [])
        _run_report_v2(
            [
                {
                    "slotKey": "text:TASK_NAME",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "name"},
                    "required": False,
                    "confirmed": True,
                }
            ],
            [("task-node", "train_step", "s0")],
            (None,),
            session=session,
            template_report_id="tmpl",
        )
        report_md = _last_report_markdown(session)
        self.assertIn("_(not reported)_", report_md)
        self.assertIn("Not reported", report_md)

    def test_media_iframe_rewritten_with_runtime_task(self):
        template = (
            '<iframe src="/widgets?type=plot&objects=<TASK_ID>&metrics=<PLOT_METRIC>'
            '&variants=<PLOT_VARIANT>&company=<COMPANY_ID>" name="roc"></iframe>'
        )
        session = self._session(
            template, [{"id": "run-123", "company": {"id": "co-1"}}]
        )
        _run_report_v2(
            [
                {
                    "slotKey": "media:roc",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "plot",
                    "selector": {"metric": "ROC", "variant": "plot image"},
                    "required": True,
                    "confirmed": True,
                }
            ],
            [("task-node", "train_step", "s0")],
            ("run-123",),
            session=session,
            template_report_id="tmpl",
        )
        report_md = _last_report_markdown(session)
        self.assertIn("objects=run-123", report_md)
        self.assertIn("metrics=ROC", report_md)
        self.assertIn("variants=plot%20image", report_md)
        self.assertIn("company=co-1", report_md)
        self.assertIn("/widgets/?", report_md)

    def test_external_task_mapping_resolves_without_source_node(self):
        session = self._session("Run <TASK_NAME>", [{"id": "ext-1", "name": "hist-run"}])
        _run_report_v2(
            [
                {
                    "slotKey": "text:TASK_NAME",
                    "source": {"externalTaskId": "ext-1"},
                    "outputKind": "field",
                    "selector": {"field": "name"},
                    "required": True,
                    "confirmed": True,
                }
            ],
            [],  # no pipeline sources
            (),
            session=session,
            template_report_id="tmpl",
        )
        report_md = _last_report_markdown(session)
        self.assertIn("Run hist-run", report_md)

    def test_template_fingerprint_drift_fails(self):
        session = self._session("# Title changed", [{"id": "run-123", "name": "x"}])
        with self.assertRaises(RuntimeError):
            _run_report_v2(
                [],
                [("task-node", "train_step", "s0")],
                ("run-123",),
                session=session,
                template_report_id="tmpl",
                template_fingerprint="deadbeef",  # will not match
            )

    def test_matching_template_fingerprint_passes(self):
        template = "# Title <TASK_NAME>"
        session = self._session(template, [{"id": "run-123", "name": "ok-run"}])
        _run_report_v2(
            [
                {
                    "slotKey": "text:TASK_NAME",
                    "source": {"sourceNodeId": "task-node"},
                    "outputKind": "field",
                    "selector": {"field": "name"},
                    "required": True,
                    "confirmed": True,
                }
            ],
            [("task-node", "train_step", "s0")],
            ("run-123",),
            session=session,
            template_report_id="tmpl",
            template_fingerprint=_fingerprint(template),
        )
        report_md = _last_report_markdown(session)
        self.assertIn("ok-run", report_md)


if __name__ == "__main__":
    unittest.main()
