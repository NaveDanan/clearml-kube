from apiserver.schema import SchemaReader
from apiserver.utilities.partial_version import PartialVersion


EXPECTED = {
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


schema = SchemaReader().get_schema()
service = schema.services["clearpipe"]

assert set(service.endpoint_groups) == EXPECTED
assert {
    "clearpipe_graph_v2",
    "diagnostic",
    "compiler_output",
    "definition",
    "task_descriptor",
    "execution_snapshot",
}.issubset(service.definitions)

for action in EXPECTED:
    endpoint = service.endpoint_groups[action].get_for_version(PartialVersion("2.35"))
    assert endpoint.request_schema["type"] == "object"
    assert endpoint.response_schema["type"] == "object"
    assert endpoint.request_schema["properties"]
    assert endpoint.response_schema["properties"]

assert (
    service.endpoint_groups["create"]
    .get_for_version(PartialVersion("2.35"))
    .request_schema["properties"]["graph"]["$ref"]
    == "#/definitions/clearpipe_graph_v2"
)
assert (
    service.endpoint_groups["validate"]
    .get_for_version(PartialVersion("2.35"))
    .response_schema["properties"]["issues"]["items"]["$ref"]
    == "#/definitions/diagnostic"
)
print("clearpipe-schema: OK")
