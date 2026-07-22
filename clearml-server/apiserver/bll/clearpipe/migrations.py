"""Deterministic, non-lossy routing for ClearPipe graph schema versions.

Migrations never mutate their input.  A version which cannot be proven
lossless is intentionally returned as unsupported so callers can retain the
original document for read-only/export handoff.
"""

from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Callable, Dict, Mapping, Optional


CURRENT_GRAPH_SCHEMA_VERSION = 2


@dataclass(frozen=True)
class MigrationOutcome:
    """The result of selecting and, where possible, applying a migration."""

    status: str
    document: Optional[Dict[str, Any]] = None
    reason: Optional[str] = None


Migration = Callable[[Mapping[str, Any]], MigrationOutcome]


class MigrationRegistry:
    """Registry of explicitly approved graph migrations."""

    def __init__(self, current_version: int = CURRENT_GRAPH_SCHEMA_VERSION):
        self.current_version = current_version
        self._migrations = {}  # type: Dict[int, Migration]

    def register(self, source_version: int, migration: Migration) -> None:
        if source_version in self._migrations:
            raise ValueError("a migration is already registered for schema version {}".format(source_version))
        self._migrations[source_version] = migration

    def migrate(self, raw: Mapping[str, Any]) -> MigrationOutcome:
        version = raw.get("schema_version")
        if type(version) is not int:
            return MigrationOutcome(status="unsupported", reason="schema_version_missing_or_invalid")
        if version == self.current_version:
            return MigrationOutcome(status="current", document=deepcopy(dict(raw)))
        migration = self._migrations.get(version)
        if migration is None:
            reason = "schema_version_newer_than_supported" if version > self.current_version else "schema_version_unrecognized"
            return MigrationOutcome(status="unsupported", reason=reason)
        return migration(raw)


def legacy_v1_to_v2(raw: Mapping[str, Any]) -> MigrationOutcome:
    """Preserve legacy ClearPipe v1 exactly; its generic nodes are not v2.

    The historical v1 document contains generic cards and untyped edges.  No
    transformation can establish v2 task/function and binding semantics without
    guessing, so D-09 requires an unsupported/read-only outcome.
    """

    return MigrationOutcome(status="unsupported", reason="legacy_v1_not_losslessly_representable")


DEFAULT_MIGRATION_REGISTRY = MigrationRegistry()
DEFAULT_MIGRATION_REGISTRY.register(1, legacy_v1_to_v2)
