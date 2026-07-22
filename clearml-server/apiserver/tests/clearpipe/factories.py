from __future__ import annotations

import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping, Sequence


class FixtureContractError(ValueError):
    """Raised when a test asks a factory for an unsupported fixture shape."""


class DeterministicIds:
    def __init__(self, start: int = 1):
        self._next = start

    def next(self, prefix: str) -> str:
        value = f"{prefix}-{self._next:04d}"
        self._next += 1
        return value


class DeterministicClock:
    def __init__(self, start: datetime | None = None):
        self._value = start or datetime(2026, 1, 1, tzinfo=timezone.utc)

    def now(self) -> str:
        value = self._value.isoformat().replace("+00:00", "Z")
        self._value += timedelta(seconds=1)
        return value


_FIXTURE_DIRECTORY = (
    Path(__file__).resolve().parents[4]
    / "clearml-web"
    / "src"
    / "app"
    / "features"
    / "clearpipe"
    / "domain"
    / "fixtures"
)


def _fixture(name: str) -> dict[str, Any]:
    with (_FIXTURE_DIRECTORY / name).open(encoding="utf-8") as handle:
        return json.load(handle)


def port(
    port_id: str,
    *,
    name: str,
    direction: str,
    role: str,
    accepted_binding_kinds: Sequence[str],
    required: bool = False,
    multiplicity: str = "single",
    order: int = 0,
    **overrides: Any,
) -> dict[str, Any]:
    value = {
        "id": port_id,
        "kind": "port",
        "name": name,
        "direction": direction,
        "role": role,
        "required": required,
        "multiplicity": multiplicity,
        "accepted_binding_kinds": list(accepted_binding_kinds),
        "order": order,
    }
    value.update(deepcopy(overrides))
    return value


def task_node(
    node_id: str = "task-source",
    *,
    name: str | None = None,
    base_task_id: str = "base-task-0001",
    ports: Sequence[Mapping[str, Any]] | None = None,
    position: Mapping[str, int] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    node_name = name or node_id.replace("-", "_")
    value = {
        "id": node_id,
        "name": node_name,
        "label": node_name.replace("_", " ").title(),
        "kind": "task",
        "base_task": {"kind": "task-id", "task_id": base_task_id},
        "ports": deepcopy(
            list(ports)
            if ports is not None
            else [
                port(
                    "in-parameter",
                    name="General/value",
                    direction="input",
                    role="parameter",
                    accepted_binding_kinds=["parameter"],
                ),
                port(
                    "out-artifact",
                    name="artifacts.result.url",
                    direction="output",
                    role="artifact",
                    accepted_binding_kinds=["artifact"],
                    multiplicity="many",
                ),
            ]
        ),
        "configuration": {"clone_base_task": True, "cache": False},
        "visual": {"position": deepcopy(position or {"x": 0, "y": 0})},
    }
    value.update(deepcopy(overrides))
    return value


def function_node(
    node_id: str = "function-transform",
    *,
    name: str | None = None,
    ports: Sequence[Mapping[str, Any]] | None = None,
    position: Mapping[str, int] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    node_name = name or node_id.replace("-", "_")
    value = {
        "id": node_id,
        "name": node_name,
        "label": node_name.replace("_", " ").title(),
        "kind": "function",
        "signature": "def function_transform(value: int) -> int",
        "source": "def function_transform(value: int) -> int:\n    return value\n",
        "ports": deepcopy(
            list(ports)
            if ports is not None
            else [
                port(
                    "in-value",
                    name="value",
                    direction="input",
                    role="data",
                    accepted_binding_kinds=["data"],
                    required=True,
                ),
                port(
                    "out-result",
                    name="result",
                    direction="output",
                    role="data",
                    accepted_binding_kinds=["data"],
                    multiplicity="many",
                ),
            ]
        ),
        "configuration": {"task_type": "data_processing", "cache": False},
        "visual": {"position": deepcopy(position or {"x": 320, "y": 0})},
    }
    value.update(deepcopy(overrides))
    return value


def binding(
    binding_id: str,
    *,
    kind: str,
    source_node_id: str,
    target_node_id: str,
    source_port_id: str | None = None,
    target_port_id: str | None = None,
    parameter_id: str = "pipeline-parameter",
    **overrides: Any,
) -> dict[str, Any]:
    if kind == "execution-only":
        value = {
            "id": binding_id,
            "kind": kind,
            "source": {"kind": "node", "node_id": source_node_id},
            "target": {"kind": "node", "node_id": target_node_id},
        }
    elif kind == "inferred":
        if not source_port_id:
            raise FixtureContractError("inferred bindings require a source port")
        value = {
            "id": binding_id,
            "kind": kind,
            "source": {"kind": "node", "node_id": source_node_id},
            "target": {"kind": "node", "node_id": target_node_id},
            "derived_from": {
                "kind": "port",
                "node_id": source_node_id,
                "port_id": source_port_id,
            },
        }
    elif kind == "parameter":
        if not target_port_id:
            raise FixtureContractError("parameter bindings require a target port")
        value = {
            "id": binding_id,
            "kind": kind,
            "source": {"kind": "parameter", "parameter_id": parameter_id},
            "target": {
                "kind": "port",
                "node_id": target_node_id,
                "port_id": target_port_id,
            },
        }
    else:
        if not source_port_id or not target_port_id:
            raise FixtureContractError(f"{kind} bindings require source and target ports")
        value = {
            "id": binding_id,
            "kind": kind,
            "source": {
                "kind": "port",
                "node_id": source_node_id,
                "port_id": source_port_id,
            },
            "target": {
                "kind": "port",
                "node_id": target_node_id,
                "port_id": target_port_id,
            },
        }
    value.update(deepcopy(overrides))
    return value


def graph_document(
    *,
    nodes: Sequence[Mapping[str, Any]] | None = None,
    bindings: Sequence[Mapping[str, Any]] | None = None,
    **overrides: Any,
) -> dict[str, Any]:
    value = {
        "schema_version": 2,
        "document": {
            "name": "cp09_fixture_pipeline",
            "project": "cp09-fixtures",
            "version": "1.0.0",
            "tags": ["clearpipe"],
        },
        "settings": {"default_execution_queue_id": "queue-default"},
        "parameters": [],
        "resources": [
            {
                "id": "queue-default",
                "kind": "queue",
                "resource_id": "default",
                "label": "default",
            }
        ],
        "outputs": [],
        "nodes": deepcopy(list(nodes or [])),
        "bindings": deepcopy(list(bindings or [])),
        "visual": {"viewport": {"x": 0, "y": 0}, "zoom": 1},
    }
    value.update(deepcopy(overrides))
    return value


def valid_task_graph() -> dict[str, Any]:
    return _fixture("task-graph.v2.json")


def valid_function_graph() -> dict[str, Any]:
    return _fixture("function-graph.v2.json")


@dataclass(frozen=True)
class InvalidGraphScenario:
    name: str
    document: dict[str, Any]


def invalid_graphs() -> tuple[InvalidGraphScenario, ...]:
    cycle = valid_task_graph()
    cycle["bindings"].append(
        binding(
            "bind-stage-process-stage-data",
            kind="execution-only",
            source_node_id="stage-process",
            target_node_id="stage-data",
        )
    )
    unknown_port = valid_function_graph()
    unknown_port["bindings"][0]["target"]["port_id"] = "does-not-exist"
    secret = valid_function_graph()
    secret["nodes"][0]["configuration"]["api_key"] = "<redacted>"
    unsupported = valid_task_graph()
    unsupported["schema_version"] = 999
    duplicate = valid_task_graph()
    duplicate["nodes"][1]["name"] = duplicate["nodes"][0]["name"]
    return (
        InvalidGraphScenario("duplicate-node-name", duplicate),
        InvalidGraphScenario("cycle", cycle),
        InvalidGraphScenario("unknown-port", unknown_port),
        InvalidGraphScenario("embedded-secret", secret),
        InvalidGraphScenario("unsupported-schema", unsupported),
    )


def resource(
    resource_id: str = "resource-0001",
    *,
    kind: str = "task",
    accessible: bool = True,
    stale: bool = False,
    **overrides: Any,
) -> dict[str, Any]:
    value = {
        "id": resource_id,
        "kind": kind,
        "resource_id": resource_id,
        "label": f"{kind}-{resource_id}",
        "accessible": accessible,
        "stale": stale,
    }
    value.update(deepcopy(overrides))
    return value


def permission(
    *,
    can_view: bool = True,
    can_edit: bool = True,
    can_run: bool = True,
    feature_enabled: bool = True,
) -> dict[str, bool]:
    return {
        "can_view": can_view,
        "can_edit": can_edit,
        "can_run": can_run,
        "feature_enabled": feature_enabled,
    }


def execution_state(
    *,
    state: str = "queued",
    run_id: str = "run-0001",
    queue_watched: bool = True,
    clock: DeterministicClock | None = None,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "state": state,
        "queue_watched": queue_watched,
        "updated_at": (clock or DeterministicClock()).now(),
    }


def diagnostic(
    *,
    code: str = "CPSEM001",
    target: str = "nodes[0].name",
    severity: str = "error",
    message: str = "Fixture diagnostic",
) -> dict[str, str]:
    return {
        "code": code,
        "target": target,
        "severity": severity,
        "message": message,
    }


def migrated_document(
    document: Mapping[str, Any] | None = None,
    *,
    from_version: int = 1,
    to_version: int = 2,
) -> dict[str, Any]:
    if from_version >= to_version or to_version != 2:
        raise FixtureContractError("CP-09 only supplies a v1-to-v2 migration fixture")
    value = deepcopy(dict(document or valid_task_graph()))
    value["schema_version"] = to_version
    return value
