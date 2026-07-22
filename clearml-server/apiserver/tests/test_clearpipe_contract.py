import json
import unittest
from contextlib import nullcontext
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from apiserver.apimodels.clearpipe import (
    ArchiveResponse,
    CreateRequest,
    CreateResponse,
    DeleteResponse,
    DefinitionResponse,
    ExecutionSnapshotResponse,
    GetAllResponse,
    ParseScriptResponse,
    StartResponse,
    TaskDescriptorResponse,
    UpdateRequest,
    UpdateResponse,
    ValidationResponse,
)
from apiserver.apierrors import errors
from apiserver.bll.clearpipe.graph_v2 import canonical_graph_dict, read_graph_v2
from apiserver.schema import SchemaReader
from apiserver.service_repo import ServiceRepo
from apiserver.services import clearpipe
from apiserver.utilities.partial_version import PartialVersion


FIXTURES = Path(__file__).parent / "fixtures" / "clearpipe_contract"
CP06_FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "clearml-web"
    / "src"
    / "app"
    / "features"
    / "clearpipe"
    / "domain"
    / "fixtures"
)
TASK_NAME_LOOKUPS = [
    (
        "task",
        "Pipeline step 1 dataset artifact",
        (("name", "Pipeline step 1 dataset artifact"), ("project", "examples")),
    ),
    (
        "task",
        "Pipeline step 2 process dataset",
        (("name", "Pipeline step 2 process dataset"), ("project", "examples")),
    ),
]


def fixture(name):
    with (FIXTURES / name).open(encoding="utf-8") as stream:
        return json.load(stream)


def cp06_fixture(name):
    with (CP06_FIXTURES / name).open(encoding="utf-8") as stream:
        return json.load(stream)


def stored_definition(company="company-a", origin=None, schema_version=2):
    graph = (
        cp06_fixture("function-graph.v2.json")
        if schema_version == 2
        else {"schema_version": schema_version, "revision": 7, "nodes": [], "edges": []}
    )
    return SimpleNamespace(
        id="definition-1",
        company=company,
        company_origin=origin,
        project="project-1",
        name="Contract pipeline",
        comment="",
        user="user-1",
        tags=[],
        system_tags=["pipeline", "clearpipe"],
        created=None,
        last_update=None,
        runtime={"clearpipe_revision": 7},
        configuration={
            "ClearPipe": SimpleNamespace(
                value=json.dumps(graph)
            )
        },
    )


class ClearPipeContractSchemaTests(unittest.TestCase):
    def test_registered_handlers_enforce_the_typed_response_envelopes(self):
        expected = {
            "clearpipe.create": CreateResponse,
            "clearpipe.get_all": GetAllResponse,
            "clearpipe.get_by_id": DefinitionResponse,
            "clearpipe.update": UpdateResponse,
            "clearpipe.validate": ValidationResponse,
            "clearpipe.start": StartResponse,
            "clearpipe.task_descriptor": TaskDescriptorResponse,
            "clearpipe.execution_snapshot": ExecutionSnapshotResponse,
            "clearpipe.archive": ArchiveResponse,
            "clearpipe.delete": DeleteResponse,
            "clearpipe.parse_script": ParseScriptResponse,
        }
        for name, response_model in expected.items():
            endpoints = ServiceRepo._endpoints[name]
            endpoint = next(item for item in endpoints if str(item.min_version) == "2.35")
            self.assertIs(endpoint.response_data_model, response_model)

    def test_every_registered_operation_has_a_typed_v235_envelope(self):
        service = SchemaReader().get_schema().services["clearpipe"]
        expected = {
            "create",
            "get_all",
            "get_by_id",
            "update",
            "validate",
            "start",
            "task_descriptor",
            "execution_snapshot",
            "archive",
            "delete",
            "parse_script",
        }
        self.assertEqual(set(service.endpoint_groups), expected)
        self.assertTrue(
            {
                "clearpipe_graph_v2",
                "diagnostic",
                "compiler_output",
                "definition",
                "task_descriptor",
                "execution_snapshot",
            }
            .union({"runtime_metadata"})
            .issubset(service.definitions)
        )
        for action in expected:
            endpoint = service.endpoint_groups[action].get_for_version(PartialVersion("2.35"))
            self.assertEqual(endpoint.request_schema["type"], "object")
            self.assertEqual(endpoint.response_schema["type"], "object")
            self.assertTrue(endpoint.request_schema["properties"])
            self.assertTrue(endpoint.response_schema["properties"])
        self.assertNotIn(
            "default",
            service.definitions["task_descriptor"]["properties"]["parameters"][
                "items"
            ]["properties"],
        )
        self.assertEqual(
            service.endpoint_groups["task_descriptor"]
            .get_for_version(PartialVersion("2.35"))
            .response_schema["properties"]["status"]["enum"],
            ["available", "stale", "unavailable"],
        )
        snapshot = service.endpoint_groups["execution_snapshot"].get_for_version(
            PartialVersion("2.35")
        )
        self.assertTrue(
            {"node_offset", "node_limit"}.issubset(
                snapshot.request_schema["properties"]
            )
        )

    def test_named_opaque_envelopes_do_not_redeclare_graph_semantics(self):
        definitions = SchemaReader().get_schema().services["clearpipe"].definitions
        graph = definitions["clearpipe_graph_v2"]
        self.assertEqual(graph["type"], "object")
        self.assertTrue(graph["additionalProperties"])
        self.assertNotIn("nodes", graph.get("properties", {}))
        self.assertNotIn("ports", graph.get("properties", {}))
        self.assertNotIn("bindings", graph.get("properties", {}))


class ClearPipeContractFixtureTests(unittest.TestCase):
    def test_success_and_failure_fixtures_match_typed_outer_models(self):
        create = fixture("v2-create-success.json")
        CreateRequest(**create["request"]).validate()
        CreateResponse(**create["response"]).validate()

        stale = fixture("stale-revision.json")
        UpdateRequest(**stale["request"]).validate()
        self.assertEqual(stale["adapter_outcome"], "stale_revision")
        self.assertEqual(stale["error"]["http_status"], 409)

        validation = fixture("validation-resource-unavailable.json")
        ValidationResponse(**validation["response"]).validate()
        self.assertEqual(validation["adapter_outcome"], "resource_unavailable")

        start = fixture("start-unwatched.json")
        StartResponse(**start["response"]).validate()
        self.assertFalse(start["response"]["queue_watched"])
        self.assertEqual(start["navigation_target"], "pipeline-details")

    def test_fixtures_contain_no_secret_values_or_undeclared_graph_semantics(self):
        prohibited = {"password", "secret", "token", "credential", "api_key", "access_key"}
        for path in FIXTURES.glob("*.json"):
            payload = json.loads(path.read_text(encoding="utf-8"))
            encoded = json.dumps(payload).lower()
            self.assertFalse(any(f'"{term}"' in encoded for term in prohibited), path.name)
            graph = (
                payload.get("request", {}).get("graph")
                or payload.get("response", {}).get("definition", {}).get("graph")
            )
            if graph:
                self.assertEqual(set(graph), {"schema_version"})


class ClearPipeDefinitionCapabilityTests(unittest.TestCase):
    @staticmethod
    def _authorized_definition_checks():
        return (
            patch.object(clearpipe, "_resource_checker", return_value=lambda *_: True),
            patch.object(clearpipe, "_queue_checker", return_value=lambda _: True),
            patch.object(
                clearpipe,
                "_runtime_provenance_key_ring",
                return_value=("test-current", "test-secret", {"test-current": "test-secret"}),
            ),
        )

    def test_server_capabilities_distinguish_public_read_from_origin_mutation(self):
        public = stored_definition(company="", origin="company-a")
        resource_check, queue_check, key_ring = self._authorized_definition_checks()
        with resource_check, queue_check, key_ring:
            definition = clearpipe._definition(public, "company-b", project_name="Pipelines")
        self.assertEqual(definition["representation"], "clearpipe_graph_v2")
        self.assertTrue(definition["capabilities"]["view"])
        self.assertFalse(definition["capabilities"]["edit"])
        self.assertFalse(definition["capabilities"]["archive"])
        self.assertFalse(definition["capabilities"]["delete"])

    def test_v2_definition_reports_executable_compilation_and_runtime_identity(self):
        stored = stored_definition()
        generated = clearpipe._compile_v2(
            json.loads(stored.configuration["ClearPipe"].value)
        )
        stored.configuration["ClearPipeRuntime"] = SimpleNamespace(
            value=json.dumps(clearpipe._runtime_configuration(generated, 7).to_dict())
        )
        resource_check, queue_check, key_ring = self._authorized_definition_checks()
        with resource_check, queue_check, key_ring:
            definition = clearpipe._definition(stored, "company-a", project_name="Pipelines")

        self.assertTrue(definition["capabilities"]["compilation"])
        self.assertTrue(definition["capabilities"]["execution"])
        self.assertTrue(definition["capabilities"]["run"])
        self.assertTrue(definition["runtime"]["graph_digest"].startswith("sha256:"))
        self.assertEqual(
            definition["runtime"]["runtime_steps"],
            [
                {"graph_node_id": "normalize", "pipeline_step_name": "normalize"},
                {"graph_node_id": "format-result", "pipeline_step_name": "format_result"},
            ],
        )

    def test_v2_definition_disables_execution_without_dedicated_provenance_key(self):
        stored = stored_definition()
        resource_check, queue_check, _ = self._authorized_definition_checks()
        with resource_check, queue_check, patch.object(
            clearpipe, "_runtime_provenance_key_ring", return_value=(None, None, {})
        ):
            definition = clearpipe._definition(
                stored, "company-a", project_name="Pipelines"
            )

        self.assertTrue(definition["capabilities"]["compilation"])
        self.assertFalse(definition["capabilities"]["execution"])
        self.assertFalse(definition["capabilities"]["run"])

    def test_compiler_diagnostic_disables_v2_execution_without_hiding_the_definition(self):
        definition = stored_definition()
        graph = cp06_fixture("task-graph.v2.json")
        next(port for port in graph["nodes"][0]["ports"] if port["direction"] == "input")[
            "name"
        ] = "unsectioned"
        definition.configuration["ClearPipe"].value = json.dumps(graph)

        resource_check, queue_check, key_ring = self._authorized_definition_checks()
        with resource_check, queue_check, key_ring:
            response = clearpipe._definition(definition, "company-a", project_name="Pipelines")

        self.assertFalse(response["capabilities"]["compilation"])
        self.assertFalse(response["capabilities"]["execution"])
        self.assertFalse(response["capabilities"]["run"])
        self.assertIn("CPSEM007", {issue["code"] for issue in response["validation"]["issues"]})

    def test_v2_execution_capability_fails_closed_for_missing_or_denied_resources_and_queues(self):
        graph = cp06_fixture("task-graph.v2.json")
        for name, resource_allowed, queue_allowed in (
            ("missing-resource", False, True),
            ("denied-resource", False, True),
            ("missing-queue", True, False),
            ("denied-queue", True, False),
        ):
            with self.subTest(name=name):
                definition = stored_definition()
                definition.configuration["ClearPipe"].value = json.dumps(graph)
                with patch.object(
                    clearpipe, "_resource_checker", return_value=lambda *_: resource_allowed
                ), patch.object(
                    clearpipe, "_queue_checker", return_value=lambda _: queue_allowed
                ), patch.object(
                    clearpipe,
                    "_runtime_provenance_key_ring",
                    return_value=("test-current", "test-secret", {"test-current": "test-secret"}),
                ):
                    response = clearpipe._definition(
                        definition,
                        "company-a",
                        project_name="Pipelines",
                    )

                self.assertFalse(response["capabilities"]["compilation"])
                self.assertFalse(response["capabilities"]["execution"])
                self.assertFalse(response["capabilities"]["run"])
                self.assertIn("CPRES002", {issue["code"] for issue in response["validation"]["issues"]})

    def test_legacy_contract_is_explicitly_classified_for_read_only_adapter_policy(self):
        legacy = clearpipe._definition(
            stored_definition(schema_version=1), "company-a", project_name="Pipelines"
        )
        policy = fixture("legacy-read-only.json")["adapter_policy"]
        self.assertEqual(legacy["representation"], "legacy_clearpipe_graph")
        self.assertTrue(policy["read_only"])
        self.assertFalse(policy["allow_edit"])
        self.assertFalse(policy["allow_run"])

    def test_missing_schema_version_is_unsupported_not_assumed_legacy(self):
        unsupported = clearpipe._definition(
            stored_definition(schema_version=None), "company-a", project_name="Pipelines"
        )
        self.assertEqual(unsupported["representation"], "unsupported_clearpipe_graph")


class ClearPipeV2ServiceIntegrationTests(unittest.TestCase):
    def test_create_persists_named_task_reference_fixture_without_legacy_migration(self):
        graph = cp06_fixture("task-graph.v2.json")
        parsed = read_graph_v2(graph)
        self.assertTrue(parsed.is_supported, parsed)
        expected = canonical_graph_dict(parsed.graph)
        created = []
        resource_lookups = []

        class StoredTask:
            def __init__(self, **kwargs):
                self.__dict__.update(kwargs)
                created.append(self)

            def save(self):
                pass

        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-1"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            name="CP-06 pipeline",
            description="",
            graph=deepcopy(graph),
            tags=[],
            public=False,
        )

        def resource_checker(kind, resource_id, lookup=()):
            resource_lookups.append((kind, resource_id, lookup))
            return True

        with patch.object(clearpipe, "Task", StoredTask), patch.object(
            clearpipe, "distributed_lock", return_value=nullcontext()
        ), patch.object(clearpipe, "_find_project", return_value="project-1"), patch.object(
            clearpipe, "_assert_name_available"
        ), patch.object(clearpipe.task_bll, "validate"), patch.object(
            clearpipe, "update_project_time"
        ), patch.object(
            clearpipe, "_definition", return_value={"id": "definition-1"}
        ), patch.object(
            clearpipe, "_resource_checker", return_value=resource_checker
        ), patch.object(
            clearpipe, "_queue_checker", return_value=lambda _: True
        ):
            clearpipe.create(call, "company-a", request)

        self.assertEqual(len(created), 1)
        configuration = created[0].configuration
        persisted = json.loads(configuration["ClearPipe"].value)
        self.assertEqual(persisted, expected)
        self.assertEqual(persisted["schema_version"], 2)
        self.assertIn("bindings", persisted)
        self.assertNotIn("edges", persisted)
        self.assertNotIn("Pipeline", configuration)
        runtime = json.loads(configuration["ClearPipeRuntime"].value)
        self.assertEqual(runtime["definition_revision"], 1)
        self.assertEqual(
            runtime["runtime_steps"],
            [
                {"graph_node_id": "stage-data", "pipeline_step_name": "stage_data"},
                {"graph_node_id": "stage-process", "pipeline_step_name": "stage_process"},
            ],
        )
        self.assertTrue(created[0].runtime["_pipeline_hash"].startswith("sha256:"))
        self.assertIn("pipe.add_step", created[0].script["diff"])
        self.assertNotIn(".start(", created[0].script["diff"])
        self.assertEqual(
            [item for item in resource_lookups if item[2]],
            TASK_NAME_LOOKUPS,
        )

    def test_validate_v2_returns_server_generated_source_and_runtime_identity(self):
        graph = cp06_fixture("function-graph.v2.json")
        call = SimpleNamespace(data={"graph": graph}, result=SimpleNamespace(data=None))
        request = SimpleNamespace(task=None, graph=graph)

        with patch.object(
            clearpipe.queue_bll, "get_by_id", return_value=SimpleNamespace(id="default")
        ):
            clearpipe.validate(call, "company-a", request)

        self.assertTrue(call.result.data["valid"])
        self.assertEqual(call.result.data["issues"], [])
        compiler = call.result.data["pipeline"]
        self.assertIn("pipe.add_function_step", compiler["source"])
        self.assertEqual(
            compiler["manifest"]["runtime_steps"],
            [
                {"graph_node_id": "normalize", "pipeline_step_name": "normalize"},
                {"graph_node_id": "format-result", "pipeline_step_name": "format_result"},
            ],
        )
        self.assertEqual(compiler["runtime"]["definition_revision"], 1)

    def test_update_persists_v2_named_task_reference_without_legacy_compilation(self):
        graph = cp06_fixture("task-graph.v2.json")
        stored = stored_definition()
        call = SimpleNamespace(
            data={"graph": graph},
            identity=SimpleNamespace(user="user-1"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task=stored.id,
            revision=7,
            name=None,
            description=None,
            graph=deepcopy(graph),
            tags=None,
            public=None,
        )
        update = Mock(update_one=Mock(return_value=1))
        task_model = Mock()
        task_model.objects.return_value = update
        resource_lookups = []

        def resource_checker(kind, resource_id, lookup=()):
            resource_lookups.append((kind, resource_id, lookup))
            return True

        with patch.object(clearpipe, "_get_task", return_value=stored), patch.object(
            clearpipe, "_revision", return_value=7
        ), patch.object(clearpipe, "Task", task_model), patch.object(
            clearpipe, "update_project_time"
        ), patch.object(
            clearpipe, "_definition", return_value={"id": stored.id}
        ), patch.object(
            clearpipe, "_resource_checker", return_value=resource_checker
        ), patch.object(
            clearpipe, "_queue_checker", return_value=lambda _: True
        ):
            clearpipe.update(call, "company-a", request)

        updates = update.update_one.call_args.kwargs
        persisted = json.loads(updates["set__configuration"]["ClearPipe"].value)
        self.assertEqual(persisted, canonical_graph_dict(read_graph_v2(graph).graph))
        self.assertNotIn("Pipeline", updates["set__configuration"])
        runtime = json.loads(updates["set__configuration"]["ClearPipeRuntime"].value)
        self.assertEqual(runtime["definition_revision"], 8)
        self.assertIn(
            "pipe.add_step", updates["set__script__diff"]
        )
        self.assertNotIn(".start(", updates["set__script__diff"])
        self.assertTrue(updates["set__runtime"]["_pipeline_hash"].startswith("sha256:"))
        self.assertEqual(
            [item for item in resource_lookups if item[2]],
            TASK_NAME_LOOKUPS,
        )


class ClearPipeStartParameterSafetyTests(unittest.TestCase):
    def test_secret_parameter_keys_and_values_are_rejected_before_clone(self):
        definition = SimpleNamespace(id="definition", system_tags=[])
        for parameters, secret in (
            ({"api_key": "not-a-secret"}, "not-a-secret"),
            ({"label": "must-not-persist-secret"}, "must-not-persist-secret"),
        ):
            with self.subTest(parameters=list(parameters)):
                call = SimpleNamespace(
                    identity=SimpleNamespace(user="user-1"),
                    result=SimpleNamespace(data=None),
                )
                request = SimpleNamespace(
                    task="definition",
                    revision=None,
                    parameters=parameters,
                )
                clone = Mock()
                with patch.object(clearpipe, "_get_task", return_value=definition), patch.object(
                    clearpipe, "_revision", return_value=1
                ), patch.object(clearpipe.task_bll, "clone_task", clone):
                    with self.assertRaises(errors.bad_request.ValidationError) as error:
                        clearpipe.start(call, "company-a", request)
                clone.assert_not_called()
                self.assertNotIn(secret, str(error.exception))
                self.assertIsNone(call.result.data)


if __name__ == "__main__":
    unittest.main()
