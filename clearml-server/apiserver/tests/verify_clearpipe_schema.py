from apiserver.schema import SchemaReader


EXPECTED = {
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


schema = SchemaReader().get_schema()
assert set(schema.services["clearpipe"].endpoint_groups) == EXPECTED
print("clearpipe-schema: OK")

