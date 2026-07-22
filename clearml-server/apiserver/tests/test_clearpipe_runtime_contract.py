import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from apiserver.apimodels.clearpipe import (
    ExecutionSnapshotResponse,
    TaskDescriptorResponse,
)
from apiserver.bll.clearpipe.generation.contracts import (
    ClearPipeRuntimeConfiguration,
    RuntimeStepIdentity,
)
from apiserver.database.model.task.task import TaskType
from apiserver.services import clearpipe


def runtime_configuration(*steps):
    return ClearPipeRuntimeConfiguration(
        schema_version=1,
        definition_revision=4,
        graph_schema_version=2,
        graph_digest="sha256:runtime-contract-digest",
        runtime_steps=tuple(
            RuntimeStepIdentity(graph_node_id, step_name)
            for graph_node_id, step_name in steps
        ),
        source_map=(),
    )


def configuration_item(value):
    return SimpleNamespace(value=json.dumps(value))


def endpoint_call():
    return SimpleNamespace(result=SimpleNamespace(data=None))


class ClearPipeRuntimeContractTests(unittest.TestCase):
    def test_authorized_task_lookup_uses_native_access_then_distinguishes_missing_from_denied(self):
        denied_query = Mock()
        denied_query.only.return_value.first.return_value = SimpleNamespace(id="private-task")
        task_model = Mock()
        task_model.objects.return_value = denied_query

        with patch.object(clearpipe, "Task", task_model), patch.object(
            clearpipe.task_bll,
            "get_by_id",
            side_effect=clearpipe.errors.bad_request.InvalidTaskId(id="private-task"),
        ) as get_by_id:
            state, task = clearpipe._authorized_task_state("company-b", "private-task")

        self.assertEqual((state, task), ("denied", None))
        get_by_id.assert_called_once_with("company-b", "private-task", allow_public=True)

        missing_query = Mock()
        missing_query.only.return_value.first.return_value = None
        task_model.objects.return_value = missing_query
        with patch.object(clearpipe, "Task", task_model), patch.object(
            clearpipe.task_bll,
            "get_by_id",
            side_effect=clearpipe.errors.bad_request.InvalidTaskId(id="missing-task"),
        ):
            state, task = clearpipe._authorized_task_state("company-b", "missing-task")
        self.assertEqual((state, task), ("missing", None))

    def test_task_descriptor_filters_secret_defaults_and_reports_stale(self):
        task = SimpleNamespace(
            id="base-task",
            name="Base Training",
            type="training",
            status="completed",
            project=None,
            last_update=datetime(2026, 7, 22, 16, 0, tzinfo=timezone.utc),
            hyperparams={
                "Args": {
                    "epochs": SimpleNamespace(
                        section="Args", name="epochs", type="int", value="10"
                    ),
                    "api_key": SimpleNamespace(
                        section="Args",
                        name="api_key",
                        type="str",
                        value="must-not-leak-secret",
                    ),
                }
            },
            execution=SimpleNamespace(
                artifacts={
                    "metrics": SimpleNamespace(
                        key="metrics",
                        type="json",
                        mode="output",
                        uri="https://secret.example/metrics?token=must-not-leak",
                        hash="must-not-leak",
                    )
                }
            ),
            configuration={"secret-source": configuration_item("must-not-leak")},
            script=SimpleNamespace(diff="must-not-leak"),
        )
        call = endpoint_call()

        with patch.object(
            clearpipe, "_authorized_task_state", return_value=("available", task)
        ):
            clearpipe.task_descriptor(
                call,
                "company-a",
                SimpleNamespace(task="base-task", known_updated_at="outdated"),
            )

        self.assertEqual(call.result.data["status"], "stale")
        descriptor = call.result.data["descriptor"]
        self.assertEqual(descriptor["identity"], {"task_id": "base-task"})
        self.assertEqual(descriptor["context"]["name"], "Base Training")
        self.assertEqual(
            descriptor["parameters"],
            [
                {"section": "Args", "name": "api_key", "type": "str"},
                {
                    "section": "Args",
                    "name": "epochs",
                    "type": "int",
                    "default": "10",
                },
            ],
        )
        self.assertEqual(
            descriptor["artifacts"],
            [
                {
                    "id": "metrics",
                    "name": "metrics",
                    "type": "json",
                    "direction": "output",
                }
            ],
        )
        encoded = json.dumps(call.result.data)
        self.assertNotIn("must-not-leak", encoded)
        self.assertNotIn("uri", encoded)
        self.assertNotIn('"script"', encoded)
        TaskDescriptorResponse(**call.result.data).validate()

    def test_task_descriptor_distinguishes_missing_and_denied_without_descriptor(self):
        for status in ("missing", "denied"):
            with self.subTest(status=status):
                call = endpoint_call()
                with patch.object(
                    clearpipe, "_authorized_task_state", return_value=(status, None)
                ):
                    clearpipe.task_descriptor(
                        call,
                        "company-a",
                        SimpleNamespace(task="unavailable-task", known_updated_at=None),
                    )
                self.assertEqual(call.result.data, {"status": status})
                TaskDescriptorResponse(**call.result.data).validate()

    def test_execution_snapshot_maps_real_children_and_keeps_partial_records_explicit(self):
        runtime = runtime_configuration(("node-a", "stage_a"), ("node-b", "stage_b"))
        run = SimpleNamespace(
            id="run-1",
            type=TaskType.controller,
            status="in_progress",
            started=datetime(2026, 7, 22, 16, 0, tzinfo=timezone.utc),
            completed=None,
            last_update=datetime(2026, 7, 22, 16, 1, tzinfo=timezone.utc),
            runtime={
                "clearpipe_revision": 4,
                "_pipeline_hash": "sha256:runtime-contract-digest",
                "clearpipe_definition_id": "definition-1",
                "clearpipe_runtime_kind": "v2_controller_run",
            },
            configuration={
                "ClearPipeRuntime": configuration_item(runtime.to_dict()),
                "Pipeline": configuration_item(
                    {"steps": {"stage_a": {"task_id": "child-a"}}}
                ),
            },
            script=SimpleNamespace(diff="generated-source-must-not-leak"),
        )
        child = SimpleNamespace(
            id="child-a",
            parent="run-1",
            status="completed",
            started=datetime(2026, 7, 22, 16, 1, tzinfo=timezone.utc),
            completed=datetime(2026, 7, 22, 16, 2, tzinfo=timezone.utc),
            last_update=datetime(2026, 7, 22, 16, 2, tzinfo=timezone.utc),
            output=SimpleNamespace(
                result="success", error="secret failure detail must-not-leak"
            ),
            execution=SimpleNamespace(
                artifacts={
                    "result": SimpleNamespace(
                        key="result",
                        type="json",
                        mode="output",
                        uri="https://example.invalid/result?token=must-not-leak",
                    )
                }
            ),
            hyperparams={"Args": {"token": "must-not-leak"}},
            models=SimpleNamespace(input=[], output=[]),
            system_tags=[],
        )
        call = endpoint_call()
        with patch.object(
            clearpipe,
            "_authorized_task_state",
            side_effect=[("available", run), ("available", child)],
        ):
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(
                    run="run-1",
                    definition_revision=99,
                    graph_digest="sha256:runtime-contract-digest",
                ),
            )

        self.assertEqual(call.result.data["status"], "stale")
        snapshot = call.result.data["snapshot"]
        self.assertEqual(snapshot["definition_task_id"], "definition-1")
        self.assertEqual(snapshot["controller"]["status"], "in_progress")
        self.assertEqual(
            snapshot["nodes"][0],
            {
                "graph_node_id": "node-a",
                "pipeline_step_name": "stage_a",
                "task_id": "child-a",
                "status": "completed",
                "started_at": "2026-07-22T16:01:00+00:00",
                "completed_at": "2026-07-22T16:02:00+00:00",
                "updated_at": "2026-07-22T16:02:00+00:00",
                "record_status": "available",
                "log_task_id": "child-a",
                "artifacts": [
                    {
                        "id": "result",
                        "name": "result",
                        "type": "json",
                        "direction": "output",
                    }
                ],
                "models": {},
                "result": "success",
            },
        )
        self.assertEqual(
            snapshot["nodes"][1],
            {
                "graph_node_id": "node-b",
                "pipeline_step_name": "stage_b",
                "record_status": "unavailable",
            },
        )
        encoded = json.dumps(call.result.data)
        for prohibited in (
            "must-not-leak",
            "generated-source",
            "hyperparams",
            "output_error",
            "uri",
        ):
            self.assertNotIn(prohibited, encoded)
        ExecutionSnapshotResponse(**call.result.data).validate()

    def test_execution_snapshot_reports_unavailable_map_and_missing_or_denied_run(self):
        run = SimpleNamespace(
            id="run-1",
            type=TaskType.controller,
            runtime={},
            configuration={},
        )
        call = endpoint_call()
        with patch.object(
            clearpipe, "_authorized_task_state", return_value=("available", run)
        ):
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(run="run-1", definition_revision=None, graph_digest=None),
            )
        self.assertEqual(call.result.data, {"status": "unavailable"})
        ExecutionSnapshotResponse(**call.result.data).validate()

        for status in ("missing", "denied"):
            with self.subTest(status=status):
                call = endpoint_call()
                with patch.object(
                    clearpipe, "_authorized_task_state", return_value=(status, None)
                ):
                    clearpipe.execution_snapshot(
                        call,
                        "company-a",
                        SimpleNamespace(
                            run="unavailable-run",
                            definition_revision=None,
                            graph_digest=None,
                        ),
                    )
                self.assertEqual(call.result.data, {"status": status})
                ExecutionSnapshotResponse(**call.result.data).validate()

    def test_execution_snapshot_supports_submitted_historical_runtime_maps(self):
        runtime = runtime_configuration(("node-a", "stage_a"))
        run = SimpleNamespace(
            id="historical-run",
            type=TaskType.controller,
            status="queued",
            started=None,
            completed=None,
            last_update=None,
            runtime={
                "clearpipe_revision": 4,
                "_pipeline_hash": "sha256:runtime-contract-digest",
            },
            configuration={
                "ClearPipeRuntime": configuration_item(runtime.to_dict()),
            },
        )
        call = endpoint_call()
        with patch.object(
            clearpipe, "_authorized_task_state", return_value=("available", run)
        ):
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(
                    run="historical-run",
                    definition_revision=None,
                    graph_digest=None,
                ),
            )

        self.assertEqual(call.result.data["status"], "available")
        self.assertNotIn("definition_task_id", call.result.data["snapshot"])
        self.assertEqual(
            call.result.data["snapshot"]["nodes"],
            [
                {
                    "graph_node_id": "node-a",
                    "pipeline_step_name": "stage_a",
                    "record_status": "unavailable",
                }
            ],
        )
        ExecutionSnapshotResponse(**call.result.data).validate()


if __name__ == "__main__":
    unittest.main()
