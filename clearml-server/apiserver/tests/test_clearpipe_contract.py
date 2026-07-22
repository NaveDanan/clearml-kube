import json
import unittest
from pathlib import Path
from types import SimpleNamespace

from apiserver.apimodels.clearpipe import (
    ArchiveResponse,
    CreateRequest,
    CreateResponse,
    DeleteResponse,
    DefinitionResponse,
    GetAllResponse,
    ParseScriptResponse,
    StartResponse,
    UpdateRequest,
    UpdateResponse,
    ValidationResponse,
)
from apiserver.schema import SchemaReader
from apiserver.service_repo import ServiceRepo
from apiserver.services import clearpipe
from apiserver.utilities.partial_version import PartialVersion


FIXTURES = Path(__file__).parent / "fixtures" / "clearpipe_contract"


def fixture(name):
    with (FIXTURES / name).open(encoding="utf-8") as stream:
        return json.load(stream)


def stored_definition(company="company-a", origin=None, schema_version=2):
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
                value=json.dumps(
                    {"schema_version": schema_version, "revision": 7, "nodes": [], "edges": []}
                )
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
            "archive",
            "delete",
            "parse_script",
        }
        self.assertEqual(set(service.endpoint_groups), expected)
        self.assertTrue(
            {"clearpipe_graph_v2", "diagnostic", "compiler_output", "definition"}
            .issubset(service.definitions)
        )
        for action in expected:
            endpoint = service.endpoint_groups[action].get_for_version(PartialVersion("2.35"))
            self.assertEqual(endpoint.request_schema["type"], "object")
            self.assertEqual(endpoint.response_schema["type"], "object")
            self.assertTrue(endpoint.request_schema["properties"])
            self.assertTrue(endpoint.response_schema["properties"])

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
    def test_server_capabilities_distinguish_public_read_from_origin_mutation(self):
        public = stored_definition(company="", origin="company-a")
        definition = clearpipe._definition(public, "company-b", project_name="Pipelines")
        self.assertEqual(definition["representation"], "clearpipe_graph_v2")
        self.assertTrue(definition["capabilities"]["view"])
        self.assertFalse(definition["capabilities"]["edit"])
        self.assertFalse(definition["capabilities"]["archive"])
        self.assertFalse(definition["capabilities"]["delete"])

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


if __name__ == "__main__":
    unittest.main()
