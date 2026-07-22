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
assert (
    "default"
    not in service.definitions["task_descriptor"]["properties"]["parameters"]["items"][
        "properties"
    ]
)
assert service.endpoint_groups["task_descriptor"].get_for_version(
    PartialVersion("2.35")
).response_schema["properties"]["status"]["enum"] == [
    "available",
    "stale",
    "unavailable",
]
snapshot = service.endpoint_groups["execution_snapshot"].get_for_version(
    PartialVersion("2.35")
)
assert {"node_offset", "node_limit"}.issubset(snapshot.request_schema["properties"])
assert {
    "node_offset",
    "total_nodes",
    "truncated",
}.issubset(service.definitions["execution_snapshot"]["properties"])

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
