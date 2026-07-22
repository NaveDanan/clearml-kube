"""Canonical ClearPipe graph v2 parsing, invariants, and serialization.

This module is the server authority for the persistent graph document only.
It deliberately contains no service, UI, execution, or generator behavior.
"""

import json
import math
import re
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple, Union
from urllib.parse import unquote_plus, urlsplit

from .migrations import CURRENT_GRAPH_SCHEMA_VERSION, DEFAULT_MIGRATION_REGISTRY, MigrationRegistry


GRAPH_SCHEMA_VERSION = CURRENT_GRAPH_SCHEMA_VERSION
STABLE_ID_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_-]*$")
GENERATED_NAME_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_SECRET_ASSIGNMENT_PATTERN = re.compile(
    r"(?im)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*="
)
_SECRET_URL_IN_SOURCE_PATTERN = re.compile(
    r"(?i)https?://[^\s/@:]+(?::[^\s/@]+)?@|https?://[^\s?#]+[^\s]*[?&](?:password|secret|token|api[_-]?key|access[_-]?key)="
)
_SECRET_KEYS = {
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "accesskey",
    "privatekey",
    "credential",
    "credentials",
    "clientsecret",
    "connectionstring",
    "accountkey",
    "sastoken",
    "serviceaccountkey",
}
_OPAQUE_SECRET_REFERENCE_KEYS = {
    "credentialid",
    "credentialref",
    "credentialreference",
    "secretid",
    "secretref",
    "secretreference",
}
_UNSAFE_KEYS = {"__proto__", "prototype", "constructor"}
_BINDING_KINDS = {"data", "artifact", "parameter", "inferred", "execution-only"}
_RESOURCE_KINDS = {"dataset", "model", "queue", "task"}
_PORT_DIRECTIONS = {"input", "output"}
_PORT_ROLES = {"data", "artifact", "parameter"}
_MULTIPLICITIES = {"single", "many"}
_MAX_CANONICAL_INTEGER = 9007199254740991

JsonValue = Union[None, bool, int, float, str, List["JsonValue"], Dict[str, "JsonValue"]]


def _canonical_string_key(value: str) -> Tuple[int, ...]:
    """Unicode code-point ordering shared with the browser codec."""

    return tuple(ord(character) for character in value)


class GraphV2Error(ValueError):
    """A structurally invalid canonical v2 document."""

    def __init__(self, code: str, path: str, message: str):
        super().__init__(message)
        self.code = code
        self.path = path
        self.message = message


class UnsupportedGraphError(ValueError):
    """A document that must remain intact but cannot be edited as v2."""

    def __init__(self, code: str, path: str):
        super().__init__(code)
        self.code = code
        self.path = path


@dataclass(frozen=True)
class GraphIssue:
    code: str
    path: str
    message: str

    def to_dict(self) -> Dict[str, str]:
        return {"code": self.code, "path": self.path, "message": self.message}


@dataclass(frozen=True)
class UnsupportedGraph:
    raw: Dict[str, JsonValue]
    reason: str
    path: str = "graph"
    read_only: bool = True

    def to_dict(self) -> Dict[str, Any]:
        return {
            "raw": deepcopy(self.raw),
            "reason": self.reason,
            "path": self.path,
            "read_only": self.read_only,
        }


@dataclass(frozen=True)
class GraphReadResult:
    status: str
    graph: Optional["GraphV2"] = None
    unsupported: Optional[UnsupportedGraph] = None
    errors: Tuple[GraphIssue, ...] = ()

    @property
    def is_supported(self) -> bool:
        return self.status == "ok" and self.graph is not None


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def to_dict(self) -> Dict[str, float]:
        return {"x": self.x, "y": self.y}


@dataclass(frozen=True)
class Dimensions:
    width: float
    height: float

    def to_dict(self) -> Dict[str, float]:
        return {"width": self.width, "height": self.height}


@dataclass(frozen=True)
class NodeVisual:
    position: Point
    dimensions: Optional[Dimensions] = None

    def to_dict(self) -> Dict[str, Any]:
        value = {"position": self.position.to_dict()}
        if self.dimensions is not None:
            value["dimensions"] = self.dimensions.to_dict()
        return value


@dataclass(frozen=True)
class GraphVisual:
    viewport: Point
    zoom: float = 1.0

    def to_dict(self) -> Dict[str, Any]:
        return {"viewport": self.viewport.to_dict(), "zoom": self.zoom}


@dataclass(frozen=True)
class DocumentMetadata:
    name: str
    project: str
    version: Optional[str] = None
    description: Optional[str] = None
    tags: Tuple[str, ...] = ()
    id: Optional[str] = None
    revision: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        value = {
            "name": self.name,
            "project": self.project,
            "tags": sorted(self.tags, key=_canonical_string_key),
        }
        if self.version is not None:
            value["version"] = self.version
        if self.description is not None:
            value["description"] = self.description
        if self.id is not None:
            value["id"] = self.id
        if self.revision is not None:
            value["revision"] = self.revision
        return value


@dataclass(frozen=True)
class GraphSettings:
    default_execution_queue_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return (
            {"default_execution_queue_id": self.default_execution_queue_id}
            if self.default_execution_queue_id is not None
            else {}
        )


@dataclass(frozen=True)
class ResourceReference:
    id: str
    kind: str
    resource_id: str
    label: Optional[str] = None

    def to_dict(self) -> Dict[str, str]:
        value = {"id": self.id, "kind": self.kind, "resource_id": self.resource_id}
        if self.label is not None:
            value["label"] = self.label
        return value


@dataclass(frozen=True)
class PipelineParameter:
    id: str
    name: str
    required: bool
    order: int
    default: JsonValue = None
    has_default: bool = False
    description: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        value = {"id": self.id, "name": self.name, "required": self.required, "order": self.order}
        if self.has_default:
            value["default"] = self.default
        if self.description is not None:
            value["description"] = self.description
        return value


@dataclass(frozen=True)
class Port:
    id: str
    name: str
    direction: str
    role: str
    required: bool
    multiplicity: str
    accepted_binding_kinds: Tuple[str, ...]
    order: int
    default: JsonValue = None
    has_default: bool = False

    def to_dict(self) -> Dict[str, Any]:
        value = {
            "id": self.id,
            "kind": "port",
            "name": self.name,
            "direction": self.direction,
            "role": self.role,
            "required": self.required,
            "multiplicity": self.multiplicity,
            "accepted_binding_kinds": sorted(self.accepted_binding_kinds, key=_canonical_string_key),
            "order": self.order,
        }
        if self.has_default:
            value["default"] = self.default
        return value


@dataclass(frozen=True)
class TaskIdReference:
    task_id: str

    def to_dict(self) -> Dict[str, str]:
        return {"kind": "task-id", "task_id": self.task_id}


@dataclass(frozen=True)
class TaskNameReference:
    project: str
    name: str

    def to_dict(self) -> Dict[str, str]:
        return {"kind": "task-name", "project": self.project, "name": self.name}


TaskReference = Union[TaskIdReference, TaskNameReference]


@dataclass(frozen=True)
class TaskConfiguration:
    clone_base_task: bool = True
    cache: bool = False
    queue_resource_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        value = {"clone_base_task": self.clone_base_task, "cache": self.cache}
        if self.queue_resource_id is not None:
            value["queue_resource_id"] = self.queue_resource_id
        return value


@dataclass(frozen=True)
class FunctionConfiguration:
    task_type: str
    cache: bool = False
    queue_resource_id: Optional[str] = None
    packages: Tuple[str, ...] = ()
    retry_on_failure: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        value = {"task_type": self.task_type, "cache": self.cache}
        if self.queue_resource_id is not None:
            value["queue_resource_id"] = self.queue_resource_id
        if self.packages:
            value["packages"] = list(self.packages)
        if self.retry_on_failure is not None:
            value["retry_on_failure"] = self.retry_on_failure
        return value


@dataclass(frozen=True)
class TaskNode:
    id: str
    name: str
    label: str
    base_task: TaskReference
    ports: Tuple[Port, ...]
    configuration: TaskConfiguration
    visual: NodeVisual
    kind: str = field(init=False, default="task")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "label": self.label,
            "base_task": self.base_task.to_dict(),
            "ports": [port.to_dict() for port in _sort_ports(self.ports)],
            "configuration": self.configuration.to_dict(),
            "visual": self.visual.to_dict(),
        }


@dataclass(frozen=True)
class FunctionNode:
    id: str
    name: str
    label: str
    signature: str
    source: str
    ports: Tuple[Port, ...]
    configuration: FunctionConfiguration
    visual: NodeVisual
    description: Optional[str] = None
    kind: str = field(init=False, default="function")

    def to_dict(self) -> Dict[str, Any]:
        value = {
            "id": self.id,
            "kind": self.kind,
            "name": self.name,
            "label": self.label,
            "signature": self.signature,
            "source": self.source,
            "ports": [port.to_dict() for port in _sort_ports(self.ports)],
            "configuration": self.configuration.to_dict(),
            "visual": self.visual.to_dict(),
        }
        if self.description is not None:
            value["description"] = self.description
        return value


GraphNode = Union[TaskNode, FunctionNode]


@dataclass(frozen=True)
class PortEndpoint:
    node_id: str
    port_id: str

    def to_dict(self) -> Dict[str, str]:
        return {"kind": "port", "node_id": self.node_id, "port_id": self.port_id}


@dataclass(frozen=True)
class ParameterEndpoint:
    parameter_id: str

    def to_dict(self) -> Dict[str, str]:
        return {"kind": "parameter", "parameter_id": self.parameter_id}


@dataclass(frozen=True)
class ResourceEndpoint:
    resource_id: str

    def to_dict(self) -> Dict[str, str]:
        return {"kind": "resource", "resource_id": self.resource_id}


@dataclass(frozen=True)
class NodeEndpoint:
    node_id: str

    def to_dict(self) -> Dict[str, str]:
        return {"kind": "node", "node_id": self.node_id}


@dataclass(frozen=True)
class DataBinding:
    id: str
    source: PortEndpoint
    target: PortEndpoint
    kind: str = field(init=False, default="data")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "source": self.source.to_dict(), "target": self.target.to_dict()}


@dataclass(frozen=True)
class ArtifactBinding:
    id: str
    source: Union[PortEndpoint, ResourceEndpoint]
    target: PortEndpoint
    kind: str = field(init=False, default="artifact")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "source": self.source.to_dict(), "target": self.target.to_dict()}


@dataclass(frozen=True)
class ParameterBinding:
    id: str
    source: ParameterEndpoint
    target: PortEndpoint
    kind: str = field(init=False, default="parameter")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "source": self.source.to_dict(), "target": self.target.to_dict()}


@dataclass(frozen=True)
class InferredBinding:
    id: str
    source: NodeEndpoint
    target: NodeEndpoint
    derived_from: PortEndpoint
    kind: str = field(init=False, default="inferred")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "source": self.source.to_dict(),
            "target": self.target.to_dict(),
            "derived_from": self.derived_from.to_dict(),
        }


@dataclass(frozen=True)
class ExecutionOnlyBinding:
    id: str
    source: NodeEndpoint
    target: NodeEndpoint
    kind: str = field(init=False, default="execution-only")

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "source": self.source.to_dict(), "target": self.target.to_dict()}


Binding = Union[DataBinding, ArtifactBinding, ParameterBinding, InferredBinding, ExecutionOnlyBinding]


@dataclass(frozen=True)
class GraphOutput:
    id: str
    name: str
    source: PortEndpoint

    def to_dict(self) -> Dict[str, Any]:
        return {"id": self.id, "name": self.name, "source": self.source.to_dict()}


@dataclass(frozen=True)
class GraphV2:
    document: DocumentMetadata
    settings: GraphSettings
    parameters: Tuple[PipelineParameter, ...]
    resources: Tuple[ResourceReference, ...]
    outputs: Tuple[GraphOutput, ...]
    nodes: Tuple[GraphNode, ...]
    bindings: Tuple[Binding, ...]
    visual: GraphVisual
    schema_version: int = field(init=False, default=GRAPH_SCHEMA_VERSION)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "document": self.document.to_dict(),
            "settings": self.settings.to_dict(),
            "parameters": [parameter.to_dict() for parameter in sorted(self.parameters, key=lambda item: (item.order, _canonical_string_key(item.id)))],
            "resources": [resource.to_dict() for resource in sorted(self.resources, key=lambda item: _canonical_string_key(item.id))],
            "outputs": [output.to_dict() for output in sorted(self.outputs, key=lambda item: _canonical_string_key(item.id))],
            "nodes": [node.to_dict() for node in sorted(self.nodes, key=lambda item: _canonical_string_key(item.id))],
            "bindings": [binding.to_dict() for binding in sorted(self.bindings, key=lambda item: _canonical_string_key(item.id))],
            "visual": self.visual.to_dict(),
        }


@dataclass(frozen=True)
class GraphDependency:
    """A deduplicated node dependency derived from canonical bindings."""

    source_node_id: str
    target_node_id: str


def _sort_ports(ports: Sequence[Port]) -> List[Port]:
    return sorted(ports, key=lambda item: (_canonical_string_key(item.direction), item.order, _canonical_string_key(item.id)))


def derive_graph_dependencies(graph: GraphV2) -> Tuple[GraphDependency, ...]:
    """Derive sorted, deduplicated node dependencies from every node binding."""

    dependencies = set()
    for binding in graph.bindings:
        if isinstance(binding, DataBinding):
            dependencies.add((binding.source.node_id, binding.target.node_id))
        elif isinstance(binding, ArtifactBinding) and isinstance(binding.source, PortEndpoint):
            dependencies.add((binding.source.node_id, binding.target.node_id))
        elif isinstance(binding, (InferredBinding, ExecutionOnlyBinding)):
            dependencies.add((binding.source.node_id, binding.target.node_id))
    return tuple(
        GraphDependency(source_node_id=source, target_node_id=target)
        for source, target in sorted(
            dependencies,
            key=lambda item: (_canonical_string_key(item[0]), _canonical_string_key(item[1])),
        )
    )


def _validate_acyclic_dependencies(graph: GraphV2) -> None:
    dependencies = derive_graph_dependencies(graph)
    parents = {node.id: set() for node in graph.nodes}
    children = {node.id: set() for node in graph.nodes}
    for dependency in dependencies:
        if dependency.source_node_id == dependency.target_node_id:
            raise GraphV2Error("graph_cycle", "graph.bindings", "graph dependencies must be acyclic")
        parents[dependency.target_node_id].add(dependency.source_node_id)
        children[dependency.source_node_id].add(dependency.target_node_id)

    ready = sorted(
        (node_id for node_id, node_parents in parents.items() if not node_parents),
        key=_canonical_string_key,
    )
    visited = 0
    while ready:
        node_id = ready.pop(0)
        visited += 1
        for child_id in sorted(children[node_id], key=_canonical_string_key):
            parents[child_id].remove(node_id)
            if not parents[child_id]:
                ready.append(child_id)
        ready.sort(key=_canonical_string_key)
    if visited != len(graph.nodes):
        raise GraphV2Error("graph_cycle", "graph.bindings", "graph dependencies must be acyclic")


def _compact_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


def _is_secret_key(key: str) -> bool:
    compact = _compact_key(key)
    if compact in _OPAQUE_SECRET_REFERENCE_KEYS:
        return False
    return compact in _SECRET_KEYS or compact.endswith(("password", "apikey", "accesstoken"))


def _is_sensitive_url(value: str) -> bool:
    if not re.match(r"^https?://", value, re.IGNORECASE):
        return False
    parsed = urlsplit(value)
    if parsed.username or parsed.password:
        return True
    return any(_is_secret_key(key) for key, _ in _query_pairs(parsed.query))


def _query_pairs(query: str) -> Iterable[Tuple[str, str]]:
    for pair in query.split("&"):
        if not pair:
            continue
        key, _, value = pair.partition("=")
        yield unquote_plus(key), value


def _validate_json(value: Any, path: str = "graph") -> JsonValue:
    if value is None or isinstance(value, (str, bool)):
        return value
    if type(value) is int:
        if abs(value) > _MAX_CANONICAL_INTEGER:
            raise GraphV2Error("non_canonical_number", path, "integers must be IEEE-754 safe")
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise GraphV2Error("non_json_value", path, "numbers must be finite JSON values")
        if value.is_integer() and abs(value) > _MAX_CANONICAL_INTEGER:
            raise GraphV2Error("non_canonical_number", path, "integers must be IEEE-754 safe")
        return value
    if isinstance(value, list):
        return [_validate_json(item, "{}[{}]".format(path, index)) for index, item in enumerate(value)]
    if isinstance(value, Mapping):
        result = {}
        for key, nested in value.items():
            if not isinstance(key, str):
                raise GraphV2Error("non_json_key", path, "object keys must be strings")
            child_path = "{}.{}".format(path, key)
            if key in _UNSAFE_KEYS:
                raise GraphV2Error("unsafe_object_key", child_path, "unsafe object keys are not allowed")
            if _is_secret_key(key):
                raise GraphV2Error("secret_not_allowed", child_path, "secret-bearing fields are not allowed")
            if isinstance(nested, str) and _is_sensitive_url(nested):
                raise GraphV2Error("secret_not_allowed", child_path, "secret-bearing URLs are not allowed")
            result[key] = _validate_json(nested, child_path)
        return result
    raise GraphV2Error("non_json_value", path, "only JSON-safe values are allowed")


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise GraphV2Error("invalid_type", path, "expected an object")
    return value


def _list(value: Any, path: str) -> List[Any]:
    if not isinstance(value, list):
        raise GraphV2Error("invalid_type", path, "expected an array")
    return value


def _known_fields(value: Mapping[str, Any], allowed: Iterable[str], path: str) -> None:
    unknown = sorted(set(value) - set(allowed), key=_canonical_string_key)
    if unknown:
        raise UnsupportedGraphError("unsupported_field", "{}.{}".format(path, unknown[0]))


def _required_string(value: Mapping[str, Any], key: str, path: str) -> str:
    result = value.get(key)
    if not isinstance(result, str) or not result:
        raise GraphV2Error("invalid_string", "{}.{}".format(path, key), "expected a non-empty string")
    return result


def _optional_string(value: Mapping[str, Any], key: str, path: str) -> Optional[str]:
    if key not in value:
        return None
    result = value[key]
    if not isinstance(result, str):
        raise GraphV2Error("invalid_string", "{}.{}".format(path, key), "expected a string")
    return result


def _required_bool(value: Mapping[str, Any], key: str, path: str) -> bool:
    result = value.get(key)
    if type(result) is not bool:
        raise GraphV2Error("invalid_boolean", "{}.{}".format(path, key), "expected a boolean")
    return result


def _optional_bool(value: Mapping[str, Any], key: str, path: str, default: bool) -> bool:
    if key not in value:
        return default
    return _required_bool(value, key, path)


def _required_int(value: Mapping[str, Any], key: str, path: str, minimum: int = 0) -> int:
    result = value.get(key)
    if type(result) is not int or result < minimum:
        raise GraphV2Error("invalid_integer", "{}.{}".format(path, key), "expected an integer")
    return result


def _stable_id(value: str, path: str) -> str:
    if not STABLE_ID_PATTERN.match(value):
        raise GraphV2Error("invalid_stable_id", path, "expected a stable identifier")
    return value


def _generated_name(value: str, path: str) -> str:
    if not GENERATED_NAME_PATTERN.match(value):
        raise GraphV2Error("invalid_generated_name", path, "expected a generator-safe name")
    return value


def _number(value: Any, path: str, positive: bool = False) -> float:
    if type(value) not in (int, float) or not math.isfinite(value):
        raise GraphV2Error("invalid_number", path, "expected a finite number")
    result = value
    if positive and result <= 0:
        raise GraphV2Error("invalid_number", path, "expected a positive number")
    return result


def _parse_point(value: Any, path: str) -> Point:
    raw = _mapping(value, path)
    _known_fields(raw, {"x", "y"}, path)
    return Point(x=_number(raw.get("x"), path + ".x"), y=_number(raw.get("y"), path + ".y"))


def _parse_visual(value: Any, path: str) -> NodeVisual:
    raw = _mapping(value, path)
    _known_fields(raw, {"position", "dimensions"}, path)
    dimensions = None
    if "dimensions" in raw:
        raw_dimensions = _mapping(raw["dimensions"], path + ".dimensions")
        _known_fields(raw_dimensions, {"width", "height"}, path + ".dimensions")
        dimensions = Dimensions(
            width=_number(raw_dimensions.get("width"), path + ".dimensions.width", positive=True),
            height=_number(raw_dimensions.get("height"), path + ".dimensions.height", positive=True),
        )
    return NodeVisual(position=_parse_point(raw.get("position"), path + ".position"), dimensions=dimensions)


def _parse_document(value: Any) -> DocumentMetadata:
    raw = _mapping(value, "graph.document")
    _known_fields(raw, {"id", "revision", "name", "project", "version", "description", "tags"}, "graph.document")
    tags_raw = _list(raw.get("tags", []), "graph.document.tags")
    tags = tuple(_required_string({"tag": item}, "tag", "graph.document.tags[{}]".format(index)) for index, item in enumerate(tags_raw))
    if len(set(tags)) != len(tags):
        raise GraphV2Error("duplicate_tag", "graph.document.tags", "tags must be unique")
    document_id = _optional_string(raw, "id", "graph.document")
    if document_id is not None:
        _stable_id(document_id, "graph.document.id")
    revision = None
    if "revision" in raw:
        revision = _required_int(raw, "revision", "graph.document")
    return DocumentMetadata(
        id=document_id,
        revision=revision,
        name=_required_string(raw, "name", "graph.document"),
        project=_required_string(raw, "project", "graph.document"),
        version=_optional_string(raw, "version", "graph.document"),
        description=_optional_string(raw, "description", "graph.document"),
        tags=tags,
    )


def _parse_settings(value: Any) -> GraphSettings:
    raw = _mapping(value, "graph.settings")
    _known_fields(raw, {"default_execution_queue_id"}, "graph.settings")
    resource_id = _optional_string(raw, "default_execution_queue_id", "graph.settings")
    if resource_id is not None:
        _stable_id(resource_id, "graph.settings.default_execution_queue_id")
    return GraphSettings(default_execution_queue_id=resource_id)


def _parse_resource(value: Any, index: int) -> ResourceReference:
    path = "graph.resources[{}]".format(index)
    raw = _mapping(value, path)
    _known_fields(raw, {"id", "kind", "resource_id", "label"}, path)
    kind = _required_string(raw, "kind", path)
    if kind not in _RESOURCE_KINDS:
        raise UnsupportedGraphError("unsupported_resource_kind", path + ".kind")
    resource = ResourceReference(
        id=_stable_id(_required_string(raw, "id", path), path + ".id"),
        kind=kind,
        resource_id=_required_string(raw, "resource_id", path),
        label=_optional_string(raw, "label", path),
    )
    return resource


def _parse_parameter(value: Any, index: int) -> PipelineParameter:
    path = "graph.parameters[{}]".format(index)
    raw = _mapping(value, path)
    _known_fields(raw, {"id", "name", "required", "order", "default", "description"}, path)
    has_default = "default" in raw
    default = _validate_json(raw["default"], path + ".default") if has_default else None
    return PipelineParameter(
        id=_stable_id(_required_string(raw, "id", path), path + ".id"),
        name=_generated_name(_required_string(raw, "name", path), path + ".name"),
        required=_required_bool(raw, "required", path),
        order=_required_int(raw, "order", path),
        default=default,
        has_default=has_default,
        description=_optional_string(raw, "description", path),
    )


def _parse_port(value: Any, path: str) -> Port:
    raw = _mapping(value, path)
    _known_fields(
        raw,
        {"id", "kind", "name", "direction", "role", "required", "multiplicity", "accepted_binding_kinds", "order", "default"},
        path,
    )
    if _required_string(raw, "kind", path) != "port":
        raise UnsupportedGraphError("unsupported_port_kind", path + ".kind")
    direction = _required_string(raw, "direction", path)
    role = _required_string(raw, "role", path)
    multiplicity = _required_string(raw, "multiplicity", path)
    if direction not in _PORT_DIRECTIONS:
        raise UnsupportedGraphError("unsupported_port_direction", path + ".direction")
    if role not in _PORT_ROLES:
        raise UnsupportedGraphError("unsupported_port_role", path + ".role")
    if multiplicity not in _MULTIPLICITIES:
        raise UnsupportedGraphError("unsupported_port_multiplicity", path + ".multiplicity")
    accepted = tuple(_required_string({"kind": item}, "kind", "{}.accepted_binding_kinds[{}]".format(path, index)) for index, item in enumerate(_list(raw.get("accepted_binding_kinds"), path + ".accepted_binding_kinds")))
    if not accepted or any(kind not in _BINDING_KINDS for kind in accepted):
        raise UnsupportedGraphError("unsupported_binding_kind", path + ".accepted_binding_kinds")
    if len(set(accepted)) != len(accepted):
        raise GraphV2Error("duplicate_binding_kind", path + ".accepted_binding_kinds", "binding kinds must be unique")
    has_default = "default" in raw
    return Port(
        id=_stable_id(_required_string(raw, "id", path), path + ".id"),
        name=_required_string(raw, "name", path),
        direction=direction,
        role=role,
        required=_required_bool(raw, "required", path),
        multiplicity=multiplicity,
        accepted_binding_kinds=accepted,
        order=_required_int(raw, "order", path),
        default=_validate_json(raw["default"], path + ".default") if has_default else None,
        has_default=has_default,
    )


def _parse_base_task(value: Any, path: str) -> TaskReference:
    raw = _mapping(value, path)
    kind = _required_string(raw, "kind", path)
    if kind == "task-id":
        _known_fields(raw, {"kind", "task_id"}, path)
        return TaskIdReference(task_id=_required_string(raw, "task_id", path))
    if kind == "task-name":
        _known_fields(raw, {"kind", "project", "name"}, path)
        return TaskNameReference(project=_required_string(raw, "project", path), name=_required_string(raw, "name", path))
    raise UnsupportedGraphError("unsupported_task_reference", path + ".kind")


def _parse_task_configuration(value: Any, path: str) -> TaskConfiguration:
    raw = _mapping(value, path)
    _known_fields(raw, {"clone_base_task", "cache", "queue_resource_id"}, path)
    queue_resource_id = _optional_string(raw, "queue_resource_id", path)
    if queue_resource_id is not None:
        _stable_id(queue_resource_id, path + ".queue_resource_id")
    return TaskConfiguration(
        clone_base_task=_optional_bool(raw, "clone_base_task", path, True),
        cache=_optional_bool(raw, "cache", path, False),
        queue_resource_id=queue_resource_id,
    )


def _parse_function_configuration(value: Any, path: str) -> FunctionConfiguration:
    raw = _mapping(value, path)
    _known_fields(
        raw,
        {"task_type", "cache", "queue_resource_id", "packages", "retry_on_failure"},
        path,
    )
    queue_resource_id = _optional_string(raw, "queue_resource_id", path)
    if queue_resource_id is not None:
        _stable_id(queue_resource_id, path + ".queue_resource_id")
    packages = []
    if "packages" in raw:
        for index, package in enumerate(_list(raw["packages"], path + ".packages")):
            package_path = "{}.packages[{}]".format(path, index)
            if not isinstance(package, str) or not package:
                raise GraphV2Error(
                    "invalid_string",
                    package_path,
                    "expected a non-empty package string",
                )
            if _is_sensitive_url(package) or _SECRET_ASSIGNMENT_PATTERN.search(package):
                raise GraphV2Error(
                    "secret_not_allowed",
                    package_path,
                    "secret-bearing package is not allowed",
                )
            packages.append(package)
    retry_on_failure = (
        _required_int(raw, "retry_on_failure", path)
        if "retry_on_failure" in raw
        else None
    )
    return FunctionConfiguration(
        task_type=_generated_name(_required_string(raw, "task_type", path), path + ".task_type"),
        cache=_optional_bool(raw, "cache", path, False),
        queue_resource_id=queue_resource_id,
        packages=tuple(packages),
        retry_on_failure=retry_on_failure,
    )


def _parse_node(value: Any, index: int) -> GraphNode:
    path = "graph.nodes[{}]".format(index)
    raw = _mapping(value, path)
    kind = _required_string(raw, "kind", path)
    common = {"id", "kind", "name", "label", "ports", "configuration", "visual"}
    node_id = _stable_id(_required_string(raw, "id", path), path + ".id")
    name = _generated_name(_required_string(raw, "name", path), path + ".name")
    label = _required_string(raw, "label", path)
    ports = tuple(_parse_port(item, "{}.ports[{}]".format(path, port_index)) for port_index, item in enumerate(_list(raw.get("ports"), path + ".ports")))
    _require_unique((port.id for port in ports), path + ".ports", "duplicate_port_id")
    _require_unique(((port.direction, port.name) for port in ports), path + ".ports", "duplicate_port_name")
    _require_unique(((port.direction, port.order) for port in ports), path + ".ports", "duplicate_port_order")
    if kind == "task":
        _known_fields(raw, common | {"base_task"}, path)
        return TaskNode(
            id=node_id,
            name=name,
            label=label,
            base_task=_parse_base_task(raw.get("base_task"), path + ".base_task"),
            ports=ports,
            configuration=_parse_task_configuration(raw.get("configuration"), path + ".configuration"),
            visual=_parse_visual(raw.get("visual"), path + ".visual"),
        )
    if kind == "function":
        _known_fields(raw, common | {"signature", "source", "description"}, path)
        signature = _required_string(raw, "signature", path)
        source = _required_string(raw, "source", path)
        description = _optional_string(raw, "description", path)
        if _SECRET_ASSIGNMENT_PATTERN.search(source) or _SECRET_URL_IN_SOURCE_PATTERN.search(source):
            raise GraphV2Error("secret_not_allowed", path + ".source", "secret-bearing source is not allowed")
        if description is not None and (
            _SECRET_ASSIGNMENT_PATTERN.search(description)
            or _SECRET_URL_IN_SOURCE_PATTERN.search(description)
        ):
            raise GraphV2Error(
                "secret_not_allowed",
                path + ".description",
                "secret-bearing description is not allowed",
            )
        return FunctionNode(
            id=node_id,
            name=name,
            label=label,
            signature=signature,
            source=source,
            ports=ports,
            configuration=_parse_function_configuration(raw.get("configuration"), path + ".configuration"),
            visual=_parse_visual(raw.get("visual"), path + ".visual"),
            description=description,
        )
    raise UnsupportedGraphError("unsupported_node_kind", path + ".kind")


def _parse_port_endpoint(value: Any, path: str) -> PortEndpoint:
    raw = _mapping(value, path)
    _known_fields(raw, {"kind", "node_id", "port_id"}, path)
    if _required_string(raw, "kind", path) != "port":
        raise UnsupportedGraphError("unsupported_endpoint_kind", path + ".kind")
    return PortEndpoint(
        node_id=_stable_id(_required_string(raw, "node_id", path), path + ".node_id"),
        port_id=_stable_id(_required_string(raw, "port_id", path), path + ".port_id"),
    )


def _parse_parameter_endpoint(value: Any, path: str) -> ParameterEndpoint:
    raw = _mapping(value, path)
    _known_fields(raw, {"kind", "parameter_id"}, path)
    if _required_string(raw, "kind", path) != "parameter":
        raise UnsupportedGraphError("unsupported_endpoint_kind", path + ".kind")
    return ParameterEndpoint(parameter_id=_stable_id(_required_string(raw, "parameter_id", path), path + ".parameter_id"))


def _parse_resource_endpoint(value: Any, path: str) -> ResourceEndpoint:
    raw = _mapping(value, path)
    _known_fields(raw, {"kind", "resource_id"}, path)
    if _required_string(raw, "kind", path) != "resource":
        raise UnsupportedGraphError("unsupported_endpoint_kind", path + ".kind")
    return ResourceEndpoint(resource_id=_stable_id(_required_string(raw, "resource_id", path), path + ".resource_id"))


def _parse_node_endpoint(value: Any, path: str) -> NodeEndpoint:
    raw = _mapping(value, path)
    _known_fields(raw, {"kind", "node_id"}, path)
    if _required_string(raw, "kind", path) != "node":
        raise UnsupportedGraphError("unsupported_endpoint_kind", path + ".kind")
    return NodeEndpoint(node_id=_stable_id(_required_string(raw, "node_id", path), path + ".node_id"))


def _parse_binding(value: Any, index: int) -> Binding:
    path = "graph.bindings[{}]".format(index)
    raw = _mapping(value, path)
    kind = _required_string(raw, "kind", path)
    binding_id = _stable_id(_required_string(raw, "id", path), path + ".id")
    if kind == "data":
        _known_fields(raw, {"id", "kind", "source", "target"}, path)
        return DataBinding(binding_id, _parse_port_endpoint(raw.get("source"), path + ".source"), _parse_port_endpoint(raw.get("target"), path + ".target"))
    if kind == "artifact":
        _known_fields(raw, {"id", "kind", "source", "target"}, path)
        source = _mapping(raw.get("source"), path + ".source")
        source_kind = _required_string(source, "kind", path + ".source")
        if source_kind == "port":
            parsed_source = _parse_port_endpoint(source, path + ".source")
        elif source_kind == "resource":
            parsed_source = _parse_resource_endpoint(source, path + ".source")
        else:
            raise UnsupportedGraphError("unsupported_endpoint_kind", path + ".source.kind")
        return ArtifactBinding(binding_id, parsed_source, _parse_port_endpoint(raw.get("target"), path + ".target"))
    if kind == "parameter":
        _known_fields(raw, {"id", "kind", "source", "target"}, path)
        return ParameterBinding(binding_id, _parse_parameter_endpoint(raw.get("source"), path + ".source"), _parse_port_endpoint(raw.get("target"), path + ".target"))
    if kind == "inferred":
        _known_fields(raw, {"id", "kind", "source", "target", "derived_from"}, path)
        return InferredBinding(
            binding_id,
            _parse_node_endpoint(raw.get("source"), path + ".source"),
            _parse_node_endpoint(raw.get("target"), path + ".target"),
            _parse_port_endpoint(raw.get("derived_from"), path + ".derived_from"),
        )
    if kind == "execution-only":
        _known_fields(raw, {"id", "kind", "source", "target"}, path)
        return ExecutionOnlyBinding(binding_id, _parse_node_endpoint(raw.get("source"), path + ".source"), _parse_node_endpoint(raw.get("target"), path + ".target"))
    raise UnsupportedGraphError("unsupported_binding_kind", path + ".kind")


def _parse_output(value: Any, index: int) -> GraphOutput:
    path = "graph.outputs[{}]".format(index)
    raw = _mapping(value, path)
    _known_fields(raw, {"id", "name", "source"}, path)
    return GraphOutput(
        id=_stable_id(_required_string(raw, "id", path), path + ".id"),
        name=_generated_name(_required_string(raw, "name", path), path + ".name"),
        source=_parse_port_endpoint(raw.get("source"), path + ".source"),
    )


def _require_unique(values: Iterable[Any], path: str, code: str) -> None:
    seen = set()
    for value in values:
        if value in seen:
            raise GraphV2Error(code, path, "values must be unique")
        seen.add(value)


def _validate_references(graph: GraphV2) -> None:
    node_by_id = {node.id: node for node in graph.nodes}
    port_by_ref = {
        (node.id, port.id): port
        for node in graph.nodes
        for port in node.ports
    }
    parameter_ids = {parameter.id for parameter in graph.parameters}
    resource_by_id = {resource.id: resource for resource in graph.resources}
    _require_unique((node.id for node in graph.nodes), "graph.nodes", "duplicate_node_id")
    _require_unique((node.name for node in graph.nodes), "graph.nodes", "duplicate_node_name")
    _require_unique((parameter.id for parameter in graph.parameters), "graph.parameters", "duplicate_parameter_id")
    _require_unique((resource.id for resource in graph.resources), "graph.resources", "duplicate_resource_id")
    _require_unique((output.id for output in graph.outputs), "graph.outputs", "duplicate_output_id")
    _require_unique((binding.id for binding in graph.bindings), "graph.bindings", "duplicate_binding_id")

    def port(endpoint: PortEndpoint, path: str) -> Port:
        result = port_by_ref.get((endpoint.node_id, endpoint.port_id))
        if result is None:
            raise GraphV2Error("unknown_port", path, "binding references an unknown port")
        return result

    def node(endpoint: NodeEndpoint, path: str) -> GraphNode:
        result = node_by_id.get(endpoint.node_id)
        if result is None:
            raise GraphV2Error("unknown_node", path, "binding references an unknown node")
        return result

    for index, binding in enumerate(graph.bindings):
        path = "graph.bindings[{}]".format(index)
        if isinstance(binding, (DataBinding, ArtifactBinding, ParameterBinding)):
            target_port = port(binding.target, path + ".target")
            if target_port.direction != "input":
                raise GraphV2Error("invalid_port_direction", path + ".target", "binding targets must be input ports")
            if binding.kind not in target_port.accepted_binding_kinds:
                raise GraphV2Error("binding_not_accepted", path + ".target", "target port does not accept this binding")
        if isinstance(binding, DataBinding):
            source_port = port(binding.source, path + ".source")
            if source_port.direction != "output":
                raise GraphV2Error("invalid_port_direction", path + ".source", "binding sources must be output ports")
            if binding.kind not in source_port.accepted_binding_kinds:
                raise GraphV2Error("binding_not_accepted", path + ".source", "source port does not accept this binding")
        elif isinstance(binding, ArtifactBinding):
            if isinstance(binding.source, PortEndpoint):
                source_port = port(binding.source, path + ".source")
                if source_port.direction != "output":
                    raise GraphV2Error("invalid_port_direction", path + ".source", "binding sources must be output ports")
                if binding.kind not in source_port.accepted_binding_kinds:
                    raise GraphV2Error("binding_not_accepted", path + ".source", "source port does not accept this binding")
            elif binding.source.resource_id not in resource_by_id:
                raise GraphV2Error("unknown_resource", path + ".source", "binding references an unknown resource")
        elif isinstance(binding, ParameterBinding):
            if binding.source.parameter_id not in parameter_ids:
                raise GraphV2Error("unknown_parameter", path + ".source", "binding references an unknown parameter")
        elif isinstance(binding, InferredBinding):
            node(binding.source, path + ".source")
            node(binding.target, path + ".target")
            source_port = port(binding.derived_from, path + ".derived_from")
            if source_port.direction != "output":
                raise GraphV2Error("invalid_port_direction", path + ".derived_from", "derived port must be an output")
        elif isinstance(binding, ExecutionOnlyBinding):
            node(binding.source, path + ".source")
            node(binding.target, path + ".target")

    inbound = {}  # type: Dict[Tuple[str, str], int]
    for binding in graph.bindings:
        if isinstance(binding, (DataBinding, ArtifactBinding, ParameterBinding)):
            reference = (binding.target.node_id, binding.target.port_id)
            inbound[reference] = inbound.get(reference, 0) + 1
    for reference, count in inbound.items():
        if count > 1 and port_by_ref[reference].multiplicity == "single":
            raise GraphV2Error("port_multiplicity_exceeded", "graph.bindings", "single ports accept one binding")

    for output in graph.outputs:
        source = port(output.source, "graph.outputs")
        if source.direction != "output":
            raise GraphV2Error("invalid_port_direction", "graph.outputs", "graph outputs require output ports")
    if graph.settings.default_execution_queue_id is not None:
        queue = resource_by_id.get(graph.settings.default_execution_queue_id)
        if queue is None or queue.kind != "queue":
            raise GraphV2Error("invalid_default_queue", "graph.settings.default_execution_queue_id", "default queue must reference a queue resource")
    for node_value in graph.nodes:
        queue_id = node_value.configuration.queue_resource_id
        if queue_id is not None:
            queue = resource_by_id.get(queue_id)
            if queue is None or queue.kind != "queue":
                raise GraphV2Error("invalid_node_queue", "graph.nodes", "node queue must reference a queue resource")
    _validate_acyclic_dependencies(graph)


def _parse_graph_v2(raw_value: Mapping[str, Any]) -> GraphV2:
    raw = _mapping(raw_value, "graph")
    _known_fields(raw, {"schema_version", "document", "settings", "parameters", "resources", "outputs", "nodes", "bindings", "visual"}, "graph")
    if raw.get("schema_version") != GRAPH_SCHEMA_VERSION:
        raise GraphV2Error("invalid_schema_version", "graph.schema_version", "expected schema version 2")
    visual_raw = _mapping(raw.get("visual"), "graph.visual")
    _known_fields(visual_raw, {"viewport", "zoom"}, "graph.visual")
    graph = GraphV2(
        document=_parse_document(raw.get("document")),
        settings=_parse_settings(raw.get("settings")),
        parameters=tuple(_parse_parameter(item, index) for index, item in enumerate(_list(raw.get("parameters"), "graph.parameters"))),
        resources=tuple(_parse_resource(item, index) for index, item in enumerate(_list(raw.get("resources"), "graph.resources"))),
        outputs=tuple(_parse_output(item, index) for index, item in enumerate(_list(raw.get("outputs"), "graph.outputs"))),
        nodes=tuple(_parse_node(item, index) for index, item in enumerate(_list(raw.get("nodes"), "graph.nodes"))),
        bindings=tuple(_parse_binding(item, index) for index, item in enumerate(_list(raw.get("bindings"), "graph.bindings"))),
        visual=GraphVisual(
            viewport=_parse_point(visual_raw.get("viewport"), "graph.visual.viewport"),
            zoom=_number(visual_raw.get("zoom"), "graph.visual.zoom", positive=True),
        ),
    )
    _validate_references(graph)
    return graph


def read_graph_v2(raw: Union[str, Mapping[str, Any]], registry: MigrationRegistry = DEFAULT_MIGRATION_REGISTRY) -> GraphReadResult:
    """Read a persisted graph without dropping unknown or unsupported data."""

    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return GraphReadResult(status="invalid", errors=(GraphIssue("invalid_json", "graph", "invalid JSON document"),))
    try:
        normalized = _validate_json(raw)
        if not isinstance(normalized, dict):
            raise GraphV2Error("invalid_type", "graph", "expected a graph object")
        migration = registry.migrate(normalized)
        if migration.status == "unsupported":
            return GraphReadResult(
                status="unsupported",
                unsupported=UnsupportedGraph(raw=deepcopy(normalized), reason=migration.reason or "unsupported_schema_version"),
            )
        if migration.document is None:
            return GraphReadResult(status="invalid", errors=(GraphIssue("migration_failed", "graph", "migration produced no document"),))
        graph = _parse_graph_v2(migration.document)
        return GraphReadResult(status="ok", graph=graph)
    except UnsupportedGraphError as error:
        raw_document = normalized if "normalized" in locals() and isinstance(normalized, dict) else {}
        return GraphReadResult(
            status="unsupported",
            unsupported=UnsupportedGraph(raw=deepcopy(raw_document), reason=error.code, path=error.path),
        )
    except GraphV2Error as error:
        return GraphReadResult(status="invalid", errors=(GraphIssue(error.code, error.path, error.message),))


def canonical_graph_dict(graph: GraphV2) -> Dict[str, Any]:
    """Return the deterministic object form used for persistence comparisons."""

    return graph.to_dict()


def _canonical_number(value: Union[int, float]) -> str:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("canonical graph contains a non-finite number")
    if value == 0:
        return "0"
    if isinstance(value, int) or value.is_integer():
        if abs(value) > _MAX_CANONICAL_INTEGER:
            raise ValueError("canonical graph contains an unsafe integer")
        return str(int(value))
    mantissa, exponent = format(value, ".16e").split("e")
    mantissa = mantissa.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    return "{}e{}{}".format(mantissa, "+" if exponent_value >= 0 else "", exponent_value)


def _canonical_json(value: JsonValue) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if type(value) in (int, float):
        return _canonical_number(value)
    if isinstance(value, list):
        return "[{}]".format(",".join(_canonical_json(item) for item in value))
    if isinstance(value, Mapping):
        return "{{{}}}".format(",".join(
            "{}:{}".format(json.dumps(key, ensure_ascii=False), _canonical_json(value[key]))
            for key in sorted(value, key=_canonical_string_key)
        ))
    raise TypeError("canonical graph contains a non-JSON value")


def serialize_graph_v2(graph: GraphV2) -> str:
    """Serialize with Unicode code-point key order and IEEE-754-safe numbers."""

    return _canonical_json(canonical_graph_dict(graph))
