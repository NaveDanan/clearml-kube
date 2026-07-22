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


def signed_run(runtime, *, run_id="run-1", company_id="company-a", pipeline=None):
    run = SimpleNamespace(
        id=run_id,
        type=TaskType.controller,
        status="in_progress",
        started=datetime(2026, 7, 22, 16, 0, tzinfo=timezone.utc),
        completed=None,
        last_update=datetime(2026, 7, 22, 16, 1, tzinfo=timezone.utc),
        runtime={},
        configuration={
            "ClearPipeRuntime": configuration_item(runtime.to_dict()),
            **({"Pipeline": configuration_item(pipeline)} if pipeline else {}),
        },
        script=SimpleNamespace(diff="generated-source-must-not-leak"),
    )
    run.runtime[clearpipe.CLEARPIPE_RUNTIME_PROVENANCE] = (
        clearpipe._runtime_provenance(
            run.id,
            company_id,
            "definition-1",
            runtime,
            run.configuration["ClearPipeRuntime"].value,
        )
    )
    return run


class ClearPipeRuntimeContractTests(unittest.TestCase):
    def test_visible_task_lookup_never_probes_unscoped_task_existence(self):
        task_model = Mock()
        with patch.object(clearpipe, "Task", task_model), patch.object(
            clearpipe.task_bll,
            "get_by_id",
            side_effect=clearpipe.errors.bad_request.InvalidTaskId(id="private-task"),
        ) as get_by_id:
            self.assertIsNone(clearpipe._visible_task("company-b", "private-task"))

        get_by_id.assert_called_once_with("company-b", "private-task", allow_public=True)
        task_model.objects.assert_not_called()

    def test_task_descriptor_never_returns_parameter_defaults_and_handles_absent_updated_at(self):
        task = SimpleNamespace(
            id="base-task",
            name="Base Training",
            type="training",
            status="completed",
            project=None,
            last_update=None,
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

        with patch.object(clearpipe, "_visible_task", return_value=task):
            clearpipe.task_descriptor(
                call,
                "company-a",
                SimpleNamespace(task="base-task", known_updated_at="outdated"),
            )

        self.assertEqual(call.result.data["status"], "stale")
        descriptor = call.result.data["descriptor"]
        self.assertEqual(descriptor["identity"], {"task_id": "base-task"})
        self.assertEqual(
            descriptor["parameters"],
            [
                {"section": "Args", "name": "api_key", "type": "str"},
                {"section": "Args", "name": "epochs", "type": "int"},
            ],
        )
        encoded = json.dumps(call.result.data)
        for prohibited in ("must-not-leak", '"default"', '"value"', "uri", '"script"'):
            self.assertNotIn(prohibited, encoded)
        TaskDescriptorResponse(**call.result.data).validate()

    def test_task_descriptor_uses_one_non_enumerating_unavailable_result(self):
        for task_id in ("missing-task", "private-task"):
            with self.subTest(task_id=task_id):
                call = endpoint_call()
                with patch.object(clearpipe, "_visible_task", return_value=None):
                    clearpipe.task_descriptor(
                        call,
                        "company-a",
                        SimpleNamespace(task=task_id, known_updated_at=None),
                    )
                self.assertEqual(call.result.data, {"status": "unavailable"})
                TaskDescriptorResponse(**call.result.data).validate()

    def test_execution_snapshot_uses_signed_provenance_and_bulk_child_maps(self):
        runtime = runtime_configuration(("node-a", "stage_a"), ("node-b", "stage_b"))
        run = signed_run(
            runtime,
            pipeline={"steps": {"stage_a": {"task_id": "child-a"}}},
        )
        child = SimpleNamespace(
            id="child-a",
            parent="run-1",
            name="Child A",
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
        children = Mock(return_value={"child-a": child})
        models = Mock(return_value={})
        with patch.object(clearpipe, "_visible_task", return_value=run), patch.object(
            clearpipe, "_get_task", return_value=SimpleNamespace(id="definition-1")
        ), patch.object(
            clearpipe, "_visible_run_children", children
        ), patch.object(
            clearpipe, "_visible_models_by_id", models
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
        children.assert_called_once_with("company-a", "run-1", {"child-a"})
        models.assert_called_once_with("company-a", ())
        self.assertEqual(snapshot["nodes"][0]["record_status"], "available")
        self.assertEqual(snapshot["nodes"][0]["task_id"], "child-a")
        self.assertEqual(snapshot["nodes"][1], {
            "graph_node_id": "node-b",
            "pipeline_step_name": "stage_b",
            "record_status": "unavailable",
        })
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

    def test_execution_snapshot_fails_closed_for_tampered_or_unverified_provenance(self):
        runtime = runtime_configuration(("node-a", "stage_a"))
        for mutation in ("runtime", "seal", "historical"):
            with self.subTest(mutation=mutation):
                run = signed_run(runtime)
                if mutation == "runtime":
                    run.configuration["ClearPipeRuntime"].value = json.dumps(
                        {**runtime.to_dict(), "graph_digest": "sha256:mutated"}
                    )
                elif mutation == "seal":
                    run.runtime[clearpipe.CLEARPIPE_RUNTIME_PROVENANCE][
                        "definition_task_id"
                    ] = "other-definition"
                else:
                    run.runtime = {}
                call = endpoint_call()
                with patch.object(clearpipe, "_visible_task", return_value=run), patch.object(
                    clearpipe, "_get_task"
                ) as definition:
                    clearpipe.execution_snapshot(
                        call,
                        "company-a",
                        SimpleNamespace(
                            run="run-1",
                            definition_revision=None,
                            graph_digest=None,
                        ),
                    )
                self.assertEqual(call.result.data, {"status": "unavailable"})
                definition.assert_not_called()

    def test_execution_snapshot_requires_visible_mapped_definition_and_hides_child_access(self):
        runtime = runtime_configuration(("node-a", "stage_a"))
        run = signed_run(runtime, pipeline={"steps": {"stage_a": {"task_id": "child-a"}}})
        call = endpoint_call()
        with patch.object(clearpipe, "_visible_task", return_value=run), patch.object(
            clearpipe,
            "_get_task",
            side_effect=clearpipe.errors.bad_request.InvalidTaskId(id="definition-1"),
        ), patch.object(clearpipe, "_visible_run_children") as children:
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(run="run-1", definition_revision=None, graph_digest=None),
            )
        self.assertEqual(call.result.data, {"status": "unavailable"})
        children.assert_not_called()

    def test_execution_snapshot_bounds_bulk_step_resolution(self):
        steps = tuple((f"node-{index}", f"stage_{index}") for index in range(101))
        runtime = runtime_configuration(*steps)
        run = signed_run(
            runtime,
            pipeline={
                "steps": {
                    step_name: {"task_id": f"child-{index}"}
                    for index, (_, step_name) in enumerate(steps)
                }
            },
        )
        call = endpoint_call()
        children = Mock(return_value={})
        with patch.object(clearpipe, "_visible_task", return_value=run), patch.object(
            clearpipe, "_get_task", return_value=SimpleNamespace(id="definition-1")
        ), patch.object(
            clearpipe, "_visible_run_children", children
        ), patch.object(
            clearpipe, "_visible_models_by_id", return_value={}
        ):
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(run="run-1", definition_revision=None, graph_digest=None),
            )

        self.assertEqual(call.result.data["status"], "available")
        queried_ids = children.call_args.args[2]
        self.assertEqual(len(queried_ids), clearpipe.MAX_RUNTIME_SNAPSHOT_STEPS)
        self.assertEqual(
            call.result.data["snapshot"]["nodes"][-1],
            {
                "graph_node_id": "node-100",
                "pipeline_step_name": "stage_100",
                "record_status": "unavailable",
            },
        )


if __name__ == "__main__":
    unittest.main()
