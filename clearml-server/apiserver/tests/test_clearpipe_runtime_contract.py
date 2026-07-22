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
    MAX_RUNTIME_STEPS,
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
    def setUp(self):
        self.key_ring = patch.object(
            clearpipe,
            "_runtime_provenance_key_ring",
            return_value=(
                "test-current",
                "test-secret",
                {"test-current": "test-secret"},
            ),
        )
        self.key_ring.start()

    def tearDown(self):
        self.key_ring.stop()

    def test_visible_task_lookup_never_probes_unscoped_task_existence(self):
        query = Mock()
        query.only.return_value.first.return_value = None
        task_model = Mock()
        task_model.objects.return_value = query
        with patch.object(clearpipe, "Task", task_model):
            self.assertIsNone(
                clearpipe._visible_task(
                    "company-b", "private-task", clearpipe.DESCRIPTOR_TASK_FIELDS
                )
            )

        query.only.assert_called_once_with(*clearpipe.DESCRIPTOR_TASK_FIELDS)
        self.assertNotIn("script", query.only.call_args.args)
        self.assertNotIn("configuration", query.only.call_args.args)
        self.assertNotIn("hyperparams", query.only.call_args.args)

        snapshot_query = Mock()
        snapshot_query.only.return_value.first.return_value = None
        task_model.objects.return_value = snapshot_query
        with patch.object(clearpipe, "Task", task_model):
            clearpipe._visible_task(
                "company-b", "run-1", clearpipe.SNAPSHOT_RUN_FIELDS
            )
        snapshot_query.only.assert_called_once_with(*clearpipe.SNAPSHOT_RUN_FIELDS)
        self.assertNotIn("script", snapshot_query.only.call_args.args)
        self.assertNotIn("hyperparams", snapshot_query.only.call_args.args)
        self.assertNotIn("configuration", snapshot_query.only.call_args.args)

        child_query = Mock()
        child_query.only.return_value = []
        task_model.objects.return_value = child_query
        with patch.object(clearpipe, "Task", task_model):
            clearpipe._visible_run_children("company-b", "run-1", {"child-1"})
        child_fields = child_query.only.call_args.args
        self.assertIn("output.result", child_fields)
        for prohibited in ("script", "configuration", "hyperparams", "execution", "output"):
            self.assertNotIn(prohibited, child_fields)

    def test_task_descriptor_never_returns_parameter_defaults_and_handles_absent_updated_at(self):
        task = SimpleNamespace(
            id="base-task",
            name="Base Training",
            type="training",
            status="completed",
            project=None,
            last_update=None,
        )
        call = endpoint_call()

        with patch.object(clearpipe, "_visible_task", return_value=task), patch.object(
            clearpipe,
            "_descriptor_ports",
            return_value=(
                [
                    {"section": "Args", "name": "api_key", "type": "str"},
                    {"section": "Args", "name": "epochs", "type": "int"},
                ],
                [{"id": "metrics", "name": "metrics", "type": "json", "direction": "output"}],
            ),
        ):
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

    def test_descriptor_port_projection_never_materializes_parameter_or_artifact_values(self):
        task_model = Mock()
        task_model.aggregate.return_value = iter(
            [
                {
                    "parameters": [
                        {"section": "Args", "name": "epochs", "type": "int"}
                    ],
                    "artifacts": [
                        {"id": "metrics", "type": "json", "direction": "output"}
                    ],
                }
            ]
        )
        with patch.object(clearpipe, "Task", task_model):
            parameters, artifacts = clearpipe._descriptor_ports(
                "company-a", "base-task"
            )

        self.assertEqual(
            parameters, [{"section": "Args", "name": "epochs", "type": "int"}]
        )
        self.assertEqual(
            artifacts,
            [{"id": "metrics", "name": "metrics", "type": "json", "direction": "output"}],
        )
        projection = json.dumps(task_model.aggregate.call_args.args[0])
        for prohibited in ("items.v.value", "items.v.uri", "script", "configuration"):
            self.assertNotIn(prohibited, projection)

    def test_runtime_artifact_projection_is_bounded_and_marks_partial_records(self):
        task_model = Mock()
        task_model.aggregate.return_value = iter(
            [
                {
                    "_id": "child-1",
                    "truncated": True,
                    "artifacts": [
                        {"id": f"artifact-{index}", "type": "json", "direction": "output"}
                        for index in range(clearpipe.MAX_RUNTIME_ARTIFACTS_PER_NODE)
                    ],
                }
            ]
        )
        with patch.object(clearpipe, "Task", task_model):
            artifacts = clearpipe._visible_run_artifacts(
                "company-a", "run-1", {"child-1"}
            )

        self.assertTrue(artifacts["child-1"]["truncated"])
        self.assertEqual(
            len(artifacts["child-1"]["artifacts"]),
            clearpipe.MAX_RUNTIME_ARTIFACTS_PER_NODE,
        )
        projection = json.dumps(task_model.aggregate.call_args.args[0])
        self.assertIn('"$slice"', projection)
        self.assertNotIn("uri", projection)

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
            clearpipe, "_visible_definition", return_value=SimpleNamespace(id="definition-1")
        ), patch.object(
            clearpipe, "_visible_run_children", children
        ), patch.object(
            clearpipe, "_visible_models_by_id", models
        ), patch.object(
            clearpipe,
            "_visible_run_artifacts",
            return_value={
                "child-a": {
                    "artifacts": [{"id": "result", "name": "result", "type": "json", "direction": "output"}],
                    "truncated": False,
                }
            },
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
                    clearpipe, "_visible_definition"
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
            "_visible_definition",
            return_value=None,
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
            clearpipe, "_visible_definition", return_value=SimpleNamespace(id="definition-1")
        ), patch.object(
            clearpipe, "_visible_run_children", children
        ), patch.object(
            clearpipe, "_visible_models_by_id", return_value={}
        ), patch.object(
            clearpipe, "_visible_run_artifacts", return_value={}
        ):
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(run="run-1", definition_revision=None, graph_digest=None),
            )

        self.assertEqual(call.result.data["status"], "available")
        queried_ids = children.call_args.args[2]
        self.assertEqual(len(queried_ids), clearpipe.MAX_RUNTIME_SNAPSHOT_PAGE_SIZE)
        self.assertTrue(call.result.data["snapshot"]["truncated"])
        self.assertEqual(call.result.data["snapshot"]["next_node_offset"], 100)
        self.assertEqual(
            call.result.data["snapshot"]["nodes"][-1],
            {
                "graph_node_id": "node-99",
                "pipeline_step_name": "stage_99",
                "record_status": "unavailable",
            },
        )
        with patch.object(
            clearpipe, "_visible_definition", return_value=SimpleNamespace(id="definition-1")
        ), patch.object(
            clearpipe, "_visible_run_children", return_value={}
        ), patch.object(
            clearpipe, "_visible_run_artifacts", return_value={}
        ), patch.object(
            clearpipe, "_visible_models_by_id", return_value={}
        ):
            final_page = clearpipe._execution_snapshot(
                run, "company-a", node_offset=100, node_limit=100
            )
        self.assertEqual(final_page["node_offset"], 100)
        self.assertFalse(final_page["truncated"])
        self.assertNotIn("next_node_offset", final_page)
        self.assertEqual(
            final_page["nodes"],
            [
                {
                    "graph_node_id": "node-100",
                    "pipeline_step_name": "stage_100",
                    "record_status": "unavailable",
                }
            ],
        )

    def test_runtime_configuration_has_a_persisted_step_cardinality_limit(self):
        steps = tuple(
            RuntimeStepIdentity(f"node-{index}", f"step_{index}")
            for index in range(MAX_RUNTIME_STEPS + 1)
        )
        with self.assertRaises(ValueError):
            ClearPipeRuntimeConfiguration(
                schema_version=1,
                definition_revision=1,
                graph_schema_version=2,
                graph_digest="sha256:bounded",
                runtime_steps=steps,
                source_map=(),
            )

    def test_execution_snapshot_clamps_explicit_zero_node_limit_to_one(self):
        runtime = runtime_configuration(
            ("node-a", "stage_a"), ("node-b", "stage_b")
        )
        run = signed_run(runtime)
        call = endpoint_call()
        with patch.object(clearpipe, "_visible_task", return_value=run), patch.object(
            clearpipe, "_visible_definition", return_value=SimpleNamespace(id="definition-1")
        ), patch.object(
            clearpipe, "_visible_run_children", return_value={}
        ), patch.object(
            clearpipe, "_visible_run_artifacts", return_value={}
        ), patch.object(
            clearpipe, "_visible_models_by_id", return_value={}
        ):
            clearpipe.execution_snapshot(
                call,
                "company-a",
                SimpleNamespace(
                    run="run-1",
                    definition_revision=None,
                    graph_digest=None,
                    node_offset=0,
                    node_limit=0,
                ),
            )

        snapshot = call.result.data["snapshot"]
        self.assertEqual(len(snapshot["nodes"]), 1)
        self.assertTrue(snapshot["truncated"])
        self.assertEqual(snapshot["next_node_offset"], 1)

    def test_provenance_key_ring_supports_transition_and_retires_unknown_keys(self):
        self.key_ring.stop()
        runtime = runtime_configuration(("node-a", "stage_a"))
        run = SimpleNamespace(
            id="run-1",
            runtime={},
            configuration={"ClearPipeRuntime": configuration_item(runtime.to_dict())},
        )
        legacy_payload = {
            "schema_version": clearpipe.CLEARPIPE_LEGACY_PROVENANCE_VERSION,
            "run_task_id": "run-1",
            "company_id": "company-a",
            "definition_task_id": "definition-1",
            "definition_revision": 4,
            "graph_digest": "sha256:runtime-contract-digest",
            "runtime_configuration_digest": clearpipe._runtime_configuration_digest(run),
        }
        run.runtime[clearpipe.CLEARPIPE_RUNTIME_PROVENANCE] = {
            **legacy_payload,
            "signature": clearpipe._runtime_provenance_signature(
                legacy_payload, "legacy-secret"
            ),
        }

        transition_ring = {
            "current_key_id": "clearpipe-current",
            "transition_key_ids": [clearpipe.CLEARPIPE_LEGACY_PROVENANCE_KEY_ID],
            "allow_legacy_auth_token_verification": True,
            "keys": {"clearpipe-current": "current-secret"},
        }
        def config_value(path, default=None):
            return {
                "secure.clearpipe.provenance_keys": transition_ring,
                "secure.auth.token_secret": "legacy-secret",
            }.get(path, default)

        with patch.object(clearpipe.config, "get", side_effect=config_value), patch.object(
            clearpipe, "_visible_definition", return_value=SimpleNamespace(id="definition-1")
        ):
            self.assertEqual(
                clearpipe._verified_runtime_provenance(run, "company-a"), runtime
            )
            current = clearpipe._runtime_provenance(
                "run-2",
                "company-a",
                "definition-1",
                runtime,
                run.configuration["ClearPipeRuntime"].value,
            )

        self.assertEqual(current["key_id"], "clearpipe-current")
        v2_run = SimpleNamespace(
            id="run-2",
            runtime={clearpipe.CLEARPIPE_RUNTIME_PROVENANCE: current},
            configuration={"ClearPipeRuntime": configuration_item(runtime.to_dict())},
        )
        rotated_ring = {
            "current_key_id": "clearpipe-next",
            "transition_key_ids": ["clearpipe-current"],
            "keys": {
                "clearpipe-current": "current-secret",
                "clearpipe-next": "next-secret",
            },
        }
        with patch.object(
            clearpipe.config,
            "get",
            side_effect=lambda path, default=None: {
                "secure.clearpipe.provenance_keys": rotated_ring,
                "secure.auth.token_secret": "legacy-secret",
            }.get(path, default),
        ), patch.object(
            clearpipe, "_visible_definition", return_value=SimpleNamespace(id="definition-1")
        ):
            self.assertEqual(
                clearpipe._verified_runtime_provenance(v2_run, "company-a"), runtime
            )

        retired_ring = {
            "current_key_id": "clearpipe-current",
            "transition_key_ids": [],
            "keys": {"clearpipe-current": "current-secret"},
        }
        with patch.object(
            clearpipe.config,
            "get",
            side_effect=lambda path, default=None: {
                "secure.clearpipe.provenance_keys": retired_ring,
                "secure.auth.token_secret": "legacy-secret",
            }.get(path, default),
        ), patch.object(clearpipe, "_visible_definition") as definition:
            self.assertIsNone(clearpipe._verified_runtime_provenance(run, "company-a"))
        definition.assert_not_called()


if __name__ == "__main__":
    unittest.main()
