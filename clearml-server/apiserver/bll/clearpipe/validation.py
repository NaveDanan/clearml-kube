"""Deterministic ClearPipe v2 validation and execution preflight.

CP-06 remains the only authority for parsing, structural invariants, cycle
checks, JSON safety, and secret detection.  This module consumes its parsed
``GraphV2`` object, adds CP-03 semantic diagnostics, and orchestrates optional
resource checks through an injected asynchronous resolver.
"""

import ast
import re
from dataclasses import dataclass
from typing import Any, Iterable, List, Mapping, Optional, Sequence, Tuple, Union

from .graph_v2 import (
    ArtifactBinding,
    DataBinding,
    ExecutionOnlyBinding,
    FunctionNode,
    GraphReadResult,
    GraphV2,
    InferredBinding,
    ParameterBinding,
    Port,
    PortEndpoint,
    ResourceEndpoint,
    TaskIdReference,
    TaskNameReference,
    TaskNode,
    read_graph_v2,
)


# Kept for the legacy AST parser import. CP-06 owns v2 document size and JSON
# validation; this limit is not a second graph parser.
MAX_GRAPH_BYTES = 4 * 1024 * 1024
MAX_INLINE_SCRIPT_BYTES = 1024 * 1024

ERROR = "error"
WARNING = "warning"
INFO = "info"

RESOURCE_AVAILABLE = "available"
RESOURCE_MISSING = "missing"
RESOURCE_DENIED = "denied"
RESOURCE_STALE = "stale"
RESOURCE_PENDING = "pending"
RESOURCE_UNAVAILABLE = "unavailable"
RESOURCE_STATUSES = frozenset(
    {
        RESOURCE_AVAILABLE,
        RESOURCE_MISSING,
        RESOURCE_DENIED,
        RESOURCE_STALE,
        RESOURCE_PENDING,
        RESOURCE_UNAVAILABLE,
    }
)


@dataclass(frozen=True)
class DiagnosticTarget:
    """A stable location in a canonical graph document."""

    kind: str
    path: str
    node_id: Optional[str] = None
    port_id: Optional[str] = None
    binding_id: Optional[str] = None
    resource_id: Optional[str] = None
    parameter_id: Optional[str] = None

    def to_dict(self) -> dict:
        result = {"kind": self.kind, "path": self.path}
        for key in ("node_id", "port_id", "binding_id", "resource_id", "parameter_id"):
            value = getattr(self, key)
            if value is not None:
                result[key] = value
        return result


@dataclass(frozen=True)
class DiagnosticDefinition:
    """A catalog entry shared by local validation and server preflight."""

    code: str
    severity: str
    message: str
    correction: str
    blocks_save: bool
    blocks_run: bool


def _rule(
    code: str,
    severity: str,
    message: str,
    correction: str,
    blocks_save: bool = True,
    blocks_run: bool = True,
) -> DiagnosticDefinition:
    return DiagnosticDefinition(code, severity, message, correction, blocks_save, blocks_run)


DIAGNOSTIC_CATALOG = {
    "CPSTR001": _rule(
        "CPSTR001",
        ERROR,
        "The document is not a valid canonical ClearPipe v2 graph.",
        "Correct the indicated graph field without dropping unrelated graph data.",
    ),
    "CPSTR002": _rule(
        "CPSTR002",
        ERROR,
        "This graph representation is unsupported and must remain read-only.",
        "Export or inspect the original graph; do not auto-convert or repair it.",
    ),
    "CPSEM001": _rule(
        "CPSEM001",
        ERROR,
        "Node names must be unique, generator-safe, non-reserved, and form an acyclic DAG.",
        "Rename the node or remove the self-dependency/cycle.",
    ),
    "CPSEM002": _rule(
        "CPSEM002",
        ERROR,
        "A task node requires an immutable base task ID or a project/name identity.",
        "Select a base task; prefer an immutable task ID.",
    ),
    "CPSEM003": _rule(
        "CPSEM003",
        ERROR,
        "A function node must provide one matching constrained module-level function.",
        "Provide explicit matching source and signature without closures, lambdas, async, or generators.",
    ),
    "CPSEM004": _rule(
        "CPSEM004",
        ERROR,
        "A declared function argument or required input has no deterministic JSON-safe binding/default.",
        "Declare the matching input port and provide a binding or JSON-safe default.",
    ),
    "CPSEM005": _rule(
        "CPSEM005",
        ERROR,
        "Declared function outputs must be unique generator-safe names with a compatible return arity.",
        "Declare ordered output ports that match every returned value.",
    ),
    "CPSEM006": _rule(
        "CPSEM006",
        ERROR,
        "A data binding must connect a declared function data output to a declared function data input.",
        "Use an explicit artifact, parameter, or execution-only binding for task-node transfer.",
    ),
    "CPSEM007": _rule(
        "CPSEM007",
        ERROR,
        "A binding or inferred dependency has no supported explicit lowering.",
        "Use a compatible declared source, target, and one non-conflicting typed binding.",
    ),
    "CPSEM008": _rule(
        "CPSEM008",
        ERROR,
        "A step has no effective execution queue.",
        "Set a valid node queue or graph default execution queue.",
    ),
    "CPSEM009": _rule(
        "CPSEM009",
        ERROR,
        "The graph requests unsupported dynamic execution behavior.",
        "Model the behavior outside ClearPipe's static graph subset.",
    ),
    "CPSEM010": _rule(
        "CPSEM010",
        ERROR,
        "Secret or credential material is not allowed in a ClearPipe graph.",
        "Use an approved opaque runtime reference; never store the secret value in the graph.",
    ),
    "CPSEM011": _rule(
        "CPSEM011",
        ERROR,
        "Strict reproducibility does not permit cached steps without a pinned repository commit.",
        "Pin the repository commit or disable step caching.",
    ),
    "CPRES001": _rule(
        "CPRES001",
        ERROR,
        "A referenced resource no longer exists.",
        "Select an existing authorized resource and save the updated graph.",
    ),
    "CPRES002": _rule(
        "CPRES002",
        ERROR,
        "The current identity cannot access a referenced resource.",
        "Request access or select a resource available to this definition.",
    ),
    "CPRES003": _rule(
        "CPRES003",
        WARNING,
        "Resource information is stale and execution cannot safely use it yet.",
        "Refresh the resource selection before running.",
        blocks_save=False,
    ),
    "CPRES004": _rule(
        "CPRES004",
        INFO,
        "Resource validation is pending an authorized resolver.",
        "Wait for resource validation before running.",
        blocks_save=False,
    ),
    "CPRES005": _rule(
        "CPRES005",
        WARNING,
        "The resource service is unavailable, so execution cannot be preflighted.",
        "Retry resource validation before running.",
        blocks_save=False,
    ),
    "CPPRE001": _rule(
        "CPPRE001",
        ERROR,
        "An empty draft cannot be generated or run.",
        "Add at least one valid task or function node before running.",
        blocks_save=False,
    ),
    "CPGEN001": _rule(
        "CPGEN001",
        ERROR,
        "A generator validation contributor returned an invalid diagnostic.",
        "Correct the generator validation contribution before generating source.",
    ),
    "CPWARN001": _rule(
        "CPWARN001",
        WARNING,
        "A project/name base task lookup is mutable.",
        "Prefer an immutable base task ID when reproducibility is required.",
        blocks_save=False,
        blocks_run=False,
    ),
}


@dataclass(frozen=True)
class ValidationIssue:
    """One serializable, value-safe validation diagnostic."""

    code: str
    severity: str
    target: DiagnosticTarget
    message: str
    correction: str
    blocks_save: bool = True
    blocks_run: bool = True

    @classmethod
    def create(
        cls,
        code: str,
        target: DiagnosticTarget,
        message: str,
        correction: str,
        severity: str = ERROR,
        blocks_save: bool = True,
        blocks_run: bool = True,
    ) -> "ValidationIssue":
        return cls(code, severity, target, message, correction, blocks_save, blocks_run)

    @property
    def path(self) -> str:
        """Compatibility accessor for the former opaque diagnostics shape."""

        return self.target.path

    @property
    def node_id(self) -> Optional[str]:
        return self.target.node_id

    def to_dict(self) -> dict:
        result = {
            "code": self.code,
            "severity": self.severity,
            "target": self.target.to_dict(),
            "message": self.message,
            "correction": self.correction,
            "blocks_save": self.blocks_save,
            "blocks_run": self.blocks_run,
            "path": self.target.path,
        }
        if self.target.node_id is not None:
            result["node_id"] = self.target.node_id
        return result


def _issue(code: str, target: DiagnosticTarget) -> ValidationIssue:
    definition = DIAGNOSTIC_CATALOG[code]
    return ValidationIssue(
        code=definition.code,
        severity=definition.severity,
        target=target,
        message=definition.message,
        correction=definition.correction,
        blocks_save=definition.blocks_save,
        blocks_run=definition.blocks_run,
    )


def _sort_key(issue: ValidationIssue) -> Tuple[Any, ...]:
    return (
        tuple(ord(character) for character in issue.target.path),
        tuple(ord(character) for character in issue.code),
        tuple(ord(character) for character in issue.severity),
        tuple(ord(character) for character in issue.message),
    )


@dataclass(frozen=True)
class ValidationResult:
    """Full or incremental validation result.

    ``valid`` is intentionally save validity for compatibility with the current
    endpoint envelope. Callers that enable execution use ``run_valid``.
    """

    issues: Tuple[ValidationIssue, ...] = ()

    def __post_init__(self):
        object.__setattr__(self, "issues", tuple(sorted(self.issues, key=_sort_key)))

    @property
    def save_valid(self) -> bool:
        return not any(issue.blocks_save for issue in self.issues)

    @property
    def run_valid(self) -> bool:
        return not any(issue.blocks_run for issue in self.issues)

    @property
    def valid(self) -> bool:
        return self.save_valid

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "save_valid": self.save_valid,
            "run_valid": self.run_valid,
            "issues": [issue.to_dict() for issue in self.issues],
        }


@dataclass(frozen=True)
class ResourceRequest:
    """A value-safe resource lookup request for an injected resolver."""

    kind: str
    resource_id: str
    target: DiagnosticTarget
    lookup: Tuple[Tuple[str, str], ...] = ()

    @property
    def key(self) -> Tuple[Any, ...]:
        return (
            tuple(ord(character) for character in self.kind),
            tuple(ord(character) for character in self.resource_id),
            tuple(ord(character) for character in self.target.path),
            tuple((tuple(ord(c) for c in key), tuple(ord(c) for c in value)) for key, value in self.lookup),
        )

    def to_dict(self) -> dict:
        result = {
            "kind": self.kind,
            "resource_id": self.resource_id,
            "target": self.target.to_dict(),
        }
        if self.lookup:
            result["lookup"] = dict(self.lookup)
        return result


@dataclass(frozen=True)
class ResourceResolution:
    """Resolver outcome. Details are deliberately not echoed in diagnostics."""

    status: str

    def __post_init__(self):
        if self.status not in RESOURCE_STATUSES:
            raise ValueError("unsupported ClearPipe resource resolution status")


class ResourceResolver:
    """Async boundary implemented by the owning service/resource layer.

    The validation engine never imports ClearML models, queues, HTTP clients, or
    service code. A resolver must return only the status, not exception text or
    private resource metadata.
    """

    async def resolve(self, request: ResourceRequest) -> ResourceResolution:
        raise NotImplementedError


class ValidationContributor:
    """Pure extension point for CP-12/CP-13 generator diagnostics."""

    def validate(self, graph: GraphV2) -> Iterable[ValidationIssue]:
        raise NotImplementedError


@dataclass(frozen=True)
class ValidationPolicy:
    strict_reproducibility: bool = False


@dataclass(frozen=True)
class ResourceCheck:
    request: ResourceRequest
    resolution: ResourceResolution

    def to_dict(self) -> dict:
        result = self.request.to_dict()
        result["status"] = self.resolution.status
        return result


@dataclass(frozen=True)
class PreflightResult:
    """Execution-specific result that includes resource-check outcomes."""

    issues: Tuple[ValidationIssue, ...] = ()
    resource_checks: Tuple[ResourceCheck, ...] = ()

    def __post_init__(self):
        object.__setattr__(self, "issues", tuple(sorted(self.issues, key=_sort_key)))
        object.__setattr__(
            self,
            "resource_checks",
            tuple(sorted(self.resource_checks, key=lambda item: item.request.key)),
        )

    @property
    def save_valid(self) -> bool:
        return not any(issue.blocks_save for issue in self.issues)

    @property
    def run_valid(self) -> bool:
        return not any(issue.blocks_run for issue in self.issues)

    @property
    def valid(self) -> bool:
        return self.save_valid

    def to_dict(self) -> dict:
        return {
            "valid": self.valid,
            "save_valid": self.save_valid,
            "run_valid": self.run_valid,
            "issues": [issue.to_dict() for issue in self.issues],
            "resource_checks": [check.to_dict() for check in self.resource_checks],
        }


_NODE_PATH = re.compile(r"^graph\.nodes\[(\d+)\](?:\.ports\[(\d+)\])?")
_BINDING_PATH = re.compile(r"^graph\.bindings\[(\d+)\]")
_RESOURCE_PATH = re.compile(r"^graph\.resources\[(\d+)\]")
_PARAMETER_PATH = re.compile(r"^graph\.parameters\[(\d+)\]")


def _raw_item(raw: Any, collection: str, index: int) -> Mapping[str, Any]:
    if not isinstance(raw, Mapping):
        return {}
    values = raw.get(collection)
    if not isinstance(values, list) or index >= len(values) or not isinstance(values[index], Mapping):
        return {}
    return values[index]


def _target_from_path(path: str, raw: Any = None) -> DiagnosticTarget:
    node_match = _NODE_PATH.match(path)
    if node_match:
        node = _raw_item(raw, "nodes", int(node_match.group(1)))
        node_id = node.get("id") if isinstance(node.get("id"), str) else None
        port_id = None
        kind = "node"
        if node_match.group(2) is not None:
            port = _raw_item(node, "ports", int(node_match.group(2)))
            port_id = port.get("id") if isinstance(port.get("id"), str) else None
            kind = "port"
        elif path != "graph.nodes[{}]".format(node_match.group(1)):
            kind = "field"
        return DiagnosticTarget(kind=kind, path=path, node_id=node_id, port_id=port_id)
    binding_match = _BINDING_PATH.match(path)
    if binding_match:
        binding = _raw_item(raw, "bindings", int(binding_match.group(1)))
        binding_id = binding.get("id") if isinstance(binding.get("id"), str) else None
        return DiagnosticTarget(kind="binding", path=path, binding_id=binding_id)
    resource_match = _RESOURCE_PATH.match(path)
    if resource_match:
        resource = _raw_item(raw, "resources", int(resource_match.group(1)))
        resource_id = resource.get("id") if isinstance(resource.get("id"), str) else None
        return DiagnosticTarget(kind="resource", path=path, resource_id=resource_id)
    parameter_match = _PARAMETER_PATH.match(path)
    if parameter_match:
        parameter = _raw_item(raw, "parameters", int(parameter_match.group(1)))
        parameter_id = parameter.get("id") if isinstance(parameter.get("id"), str) else None
        return DiagnosticTarget(kind="parameter", path=path, parameter_id=parameter_id)
    return DiagnosticTarget(kind="graph" if path == "graph" else "field", path=path)


def _node_target(graph: GraphV2, index: int, suffix: str = "", kind: str = "node") -> DiagnosticTarget:
    node = graph.nodes[index]
    path = "graph.nodes[{}]{}".format(index, suffix)
    return DiagnosticTarget(kind=kind, path=path, node_id=node.id)


def _port_target(graph: GraphV2, node_index: int, port_index: int) -> DiagnosticTarget:
    node = graph.nodes[node_index]
    port = node.ports[port_index]
    return DiagnosticTarget(
        kind="port",
        path="graph.nodes[{}].ports[{}]".format(node_index, port_index),
        node_id=node.id,
        port_id=port.id,
    )


def _binding_target(graph: GraphV2, index: int) -> DiagnosticTarget:
    binding = graph.bindings[index]
    return DiagnosticTarget(
        kind="binding",
        path="graph.bindings[{}]".format(index),
        binding_id=binding.id,
    )


def _resource_target(graph: GraphV2, index: int) -> DiagnosticTarget:
    resource = graph.resources[index]
    return DiagnosticTarget(
        kind="resource",
        path="graph.resources[{}]".format(index),
        resource_id=resource.id,
    )


def _structural_code(read_result: GraphReadResult, raw: Any) -> str:
    if read_result.status == "unsupported":
        unsupported = read_result.unsupported
        path = unsupported.path if unsupported is not None else ""
        if (
            unsupported is not None
            and unsupported.reason == "unsupported_field"
            and path.startswith("graph.nodes")
            and any(
                path.endswith("." + field)
                for field in (
                    "callback",
                    "base_task_factory",
                    "retry",
                    "serializer",
                    "deserializer",
                    "start",
                    "start_locally",
                    "debug_pipeline",
                )
            )
        ):
            return "CPSEM009"
        return "CPSTR002"
    issue = read_result.errors[0]
    path = issue.path
    if issue.code in {"graph_cycle", "duplicate_node_name"}:
        return "CPSEM001"
    if issue.code == "invalid_generated_name":
        if path.startswith("graph.outputs"):
            return "CPSEM005"
        if path.startswith("graph.parameters"):
            return "CPSEM004"
        return "CPSEM001"
    if issue.code == "duplicate_port_name" and path.startswith("graph.nodes"):
        node_match = _NODE_PATH.match(path)
        if node_match and _raw_item(raw, "nodes", int(node_match.group(1))).get("kind") == "function":
            return "CPSEM005"
    if issue.code == "secret_not_allowed":
        return "CPSEM010"
    if path.startswith("graph.nodes") and ".base_task" in path:
        return "CPSEM002"
    if path.startswith("graph.nodes") and (".source" in path or ".signature" in path):
        return "CPSEM003"
    if issue.code == "unknown_port":
        match = _BINDING_PATH.match(path)
        if match and _raw_item(raw, "bindings", int(match.group(1))).get("kind") == "data":
            return "CPSEM006"
        return "CPSEM007"
    if issue.code in {
        "unknown_node",
        "unknown_parameter",
        "unknown_resource",
        "binding_not_accepted",
        "invalid_port_direction",
        "port_multiplicity_exceeded",
        "duplicate_binding_id",
    }:
        return "CPSEM007"
    if issue.code in {"invalid_default_queue", "invalid_node_queue"}:
        return "CPSEM008"
    return "CPSTR001"


def _read_issues(read_result: GraphReadResult, raw: Any) -> Tuple[ValidationIssue, ...]:
    if read_result.status == "unsupported":
        unsupported = read_result.unsupported
        path = unsupported.path if unsupported is not None else "graph"
        return (_issue(_structural_code(read_result, raw), _target_from_path(path, raw)),)
    if read_result.errors:
        graph_issue = read_result.errors[0]
        return (_issue(_structural_code(read_result, raw), _target_from_path(graph_issue.path, raw)),)
    return ()


def _port_index(node: Union[TaskNode, FunctionNode], port_id: str) -> int:
    for index, port in enumerate(node.ports):
        if port.id == port_id:
            return index
    raise KeyError(port_id)


def _endpoint_port(
    graph: GraphV2, endpoint: PortEndpoint
) -> Tuple[int, Union[TaskNode, FunctionNode], int, Port]:
    for node_index, node in enumerate(graph.nodes):
        if node.id == endpoint.node_id:
            port_index = _port_index(node, endpoint.port_id)
            return node_index, node, port_index, node.ports[port_index]
    raise KeyError(endpoint.node_id)


def _function_arguments(function: ast.FunctionDef) -> Tuple[List[ast.arg], List[ast.expr]]:
    arguments = list(function.args.posonlyargs) + list(function.args.args) + list(function.args.kwonlyargs)
    defaults: List[ast.expr] = [None] * (len(function.args.posonlyargs) + len(function.args.args) - len(function.args.defaults))
    defaults.extend(function.args.defaults)
    defaults.extend(function.args.kw_defaults)
    return arguments, defaults


def _parse_signature(value: str) -> Optional[ast.FunctionDef]:
    source = value.strip()
    if not source.startswith("def "):
        return None
    source += "\n    pass\n" if source.endswith(":") else ":\n    pass\n"
    try:
        module = ast.parse(source)
    except SyntaxError:
        return None
    return module.body[0] if len(module.body) == 1 and isinstance(module.body[0], ast.FunctionDef) else None


def _arguments_match(left: ast.arguments, right: ast.arguments) -> bool:
    return ast.dump(left, include_attributes=False) == ast.dump(right, include_attributes=False)


def _call_name(value: ast.Call) -> str:
    target = value.func
    if isinstance(target, ast.Name):
        return target.id
    if isinstance(target, ast.Attribute):
        return target.attr
    return ""


class ValidationEngine:
    """Pure structural/semantic validator plus resolver-driven preflight."""

    def __init__(
        self,
        policy: Optional[ValidationPolicy] = None,
        contributors: Sequence[ValidationContributor] = (),
    ):
        self.policy = policy or ValidationPolicy()
        self.contributors = tuple(contributors)

    def validate_full(self, raw: Union[str, Mapping[str, Any]]) -> ValidationResult:
        result, _ = self._validate(raw)
        return result

    def validate_incremental(
        self,
        raw: Union[str, Mapping[str, Any]],
        affected: Iterable[Union[str, DiagnosticTarget]],
    ) -> ValidationResult:
        result, graph = self._validate(raw)
        selected = tuple(affected)
        if not selected:
            return result
        return ValidationResult(
            tuple(issue for issue in result.issues if self._matches_incremental(issue, selected, graph))
        )

    async def preflight(
        self,
        raw: Union[str, Mapping[str, Any]],
        resolver: Optional[ResourceResolver] = None,
    ) -> PreflightResult:
        result, graph = self._validate(raw)
        issues = list(result.issues)
        checks: List[ResourceCheck] = []
        if graph is None:
            return PreflightResult(tuple(issues), ())
        if not graph.nodes:
            issues.append(_issue("CPPRE001", DiagnosticTarget(kind="graph", path="graph.nodes")))
        for request in self.resource_requests(graph):
            resolution = await self._resolve(resolver, request)
            checks.append(ResourceCheck(request=request, resolution=resolution))
            code = {
                RESOURCE_MISSING: "CPRES001",
                RESOURCE_DENIED: "CPRES002",
                RESOURCE_STALE: "CPRES003",
                RESOURCE_PENDING: "CPRES004",
                RESOURCE_UNAVAILABLE: "CPRES005",
            }.get(resolution.status)
            if code is not None:
                issues.append(_issue(code, request.target))
        return PreflightResult(tuple(issues), tuple(checks))

    def resource_requests(self, graph: GraphV2) -> Tuple[ResourceRequest, ...]:
        requests: List[ResourceRequest] = []
        for index, resource in enumerate(graph.resources):
            requests.append(
                ResourceRequest(
                    kind=resource.kind,
                    resource_id=resource.resource_id,
                    target=_resource_target(graph, index),
                )
            )
        for index, node in enumerate(graph.nodes):
            if not isinstance(node, TaskNode):
                continue
            if isinstance(node.base_task, TaskIdReference):
                requests.append(
                    ResourceRequest(
                        kind="task",
                        resource_id=node.base_task.task_id,
                        target=_node_target(graph, index, ".base_task.task_id", "field"),
                    )
                )
            elif isinstance(node.base_task, TaskNameReference):
                requests.append(
                    ResourceRequest(
                        kind="task",
                        resource_id=node.base_task.name,
                        target=_node_target(graph, index, ".base_task", "field"),
                        lookup=(("name", node.base_task.name), ("project", node.base_task.project)),
                    )
                )
        return tuple(sorted(requests, key=lambda request: request.key))

    async def _resolve(
        self, resolver: Optional[ResourceResolver], request: ResourceRequest
    ) -> ResourceResolution:
        if resolver is None:
            return ResourceResolution(RESOURCE_PENDING)
        try:
            resolution = await resolver.resolve(request)
            if not isinstance(resolution, ResourceResolution):
                return ResourceResolution(RESOURCE_UNAVAILABLE)
            return resolution
        except Exception:
            return ResourceResolution(RESOURCE_UNAVAILABLE)

    def _validate(
        self, raw: Union[str, Mapping[str, Any]]
    ) -> Tuple[ValidationResult, Optional[GraphV2]]:
        read_result = read_graph_v2(raw)
        if not read_result.is_supported:
            return ValidationResult(_read_issues(read_result, raw)), None
        graph = read_result.graph
        issues = self._semantic_issues(graph)
        for contributor in self.contributors:
            try:
                contributed = tuple(contributor.validate(graph))
                if not all(isinstance(issue, ValidationIssue) for issue in contributed):
                    raise TypeError
                issues.extend(contributed)
            except Exception:
                issues.append(_issue("CPGEN001", DiagnosticTarget(kind="graph", path="graph")))
        return ValidationResult(tuple(issues)), graph

    def _semantic_issues(self, graph: GraphV2) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        parameter_names = set()
        for index, parameter in enumerate(graph.parameters):
            if parameter.name in parameter_names:
                issues.append(
                    _issue(
                        "CPSEM007",
                        DiagnosticTarget(
                            kind="parameter",
                            path="graph.parameters[{}].name".format(index),
                            parameter_id=parameter.id,
                        ),
                    )
                )
            parameter_names.add(parameter.name)
        output_names = set()
        for index, output in enumerate(graph.outputs):
            if output.name in output_names:
                issues.append(
                    _issue(
                        "CPSEM005",
                        DiagnosticTarget(kind="field", path="graph.outputs[{}].name".format(index)),
                    )
                )
            output_names.add(output.name)
        for index, node in enumerate(graph.nodes):
            if node.name == "pipeline":
                issues.append(_issue("CPSEM001", _node_target(graph, index, ".name", "field")))
            if isinstance(node, TaskNode):
                if isinstance(node.base_task, TaskNameReference):
                    issues.append(_issue("CPWARN001", _node_target(graph, index, ".base_task", "field")))
            else:
                issues.extend(self._validate_function(graph, index, node))
        issues.extend(self._validate_bindings(graph))
        issues.extend(self._validate_queues(graph))
        if self.policy.strict_reproducibility:
            for index, node in enumerate(graph.nodes):
                if node.configuration.cache:
                    issues.append(_issue("CPSEM011", _node_target(graph, index, ".configuration.cache", "field")))
        return issues

    def _validate_function(
        self, graph: GraphV2, node_index: int, node: FunctionNode
    ) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        source_target = _node_target(graph, node_index, ".source", "field")
        signature_target = _node_target(graph, node_index, ".signature", "field")
        try:
            module = ast.parse(node.source)
        except SyntaxError:
            return [_issue("CPSEM003", source_target)]
        functions = [item for item in module.body if isinstance(item, ast.FunctionDef)]
        allowed_module_items = (ast.FunctionDef, ast.Import, ast.ImportFrom)
        if (
            len(functions) != 1
            or len(module.body) != len([item for item in module.body if isinstance(item, allowed_module_items)])
            or functions[0].name != node.name
            or functions[0].decorator_list
        ):
            return [_issue("CPSEM003", source_target)]
        function = functions[0]
        signature = _parse_signature(node.signature)
        if signature is None or signature.name != node.name or not _arguments_match(signature.args, function.args):
            issues.append(_issue("CPSEM003", signature_target))
        if function.args.vararg is not None or function.args.kwarg is not None:
            issues.append(_issue("CPSEM004", source_target))
        nested_functions = [
            item for item in ast.walk(function) if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item is not function
        ]
        source_rejections = (ast.Lambda, ast.AsyncFunctionDef, ast.Yield, ast.YieldFrom, ast.Global, ast.Nonlocal)
        if nested_functions or any(isinstance(item, source_rejections) for item in ast.walk(function)):
            issues.append(_issue("CPSEM003", source_target))
        dynamic_nodes = (
            ast.For,
            ast.AsyncFor,
            ast.While,
            ast.If,
            ast.IfExp,
            ast.Try,
            ast.With,
            ast.AsyncWith,
            ast.ListComp,
            ast.SetComp,
            ast.DictComp,
            ast.GeneratorExp,
        )
        match_node = getattr(ast, "Match", None)
        if match_node is not None:
            dynamic_nodes = dynamic_nodes + (match_node,)
        forbidden_calls = {
            "callback",
            "base_task_factory",
            "retry",
            "serializer",
            "deserializer",
            "eval",
            "exec",
            "__import__",
            "start",
            "start_locally",
            "run_locally",
            "debug_pipeline",
        }
        if any(isinstance(item, dynamic_nodes) for item in ast.walk(function)) or any(
            _call_name(item) in forbidden_calls for item in ast.walk(function) if isinstance(item, ast.Call)
        ):
            issues.append(_issue("CPSEM009", source_target))
        arguments, defaults = _function_arguments(function)
        input_ports = [(index, port) for index, port in enumerate(node.ports) if port.direction == "input"]
        by_name = {port.name: (port_index, port) for port_index, port in input_ports}
        for argument, default in zip(arguments, defaults):
            found = by_name.get(argument.arg)
            if found is None:
                issues.append(_issue("CPSEM004", source_target))
                continue
            port_index, port = found
            if default is None and not port.has_default and not self._has_inbound_binding(graph, node.id, port.id):
                issues.append(_issue("CPSEM004", _port_target(graph, node_index, port_index)))
        argument_names = {argument.arg for argument in arguments}
        for port_index, port in input_ports:
            if port.name not in argument_names:
                issues.append(_issue("CPSEM004", _port_target(graph, node_index, port_index)))
        output_ports = [(index, port) for index, port in enumerate(node.ports) if port.direction == "output"]
        output_names = [port.name for _, port in output_ports]
        if any(not re.match(r"^[A-Za-z][A-Za-z0-9_]*$", name) for name in output_names):
            issues.append(_issue("CPSEM005", _node_target(graph, node_index, ".ports", "field")))
        returns = [item for item in ast.walk(function) if isinstance(item, ast.Return)]
        if output_ports and not returns:
            issues.append(_issue("CPSEM005", source_target))
        if len(output_ports) > 1:
            for returned in returns:
                if not isinstance(returned.value, (ast.Tuple, ast.List)) or len(returned.value.elts) != len(output_ports):
                    issues.append(_issue("CPSEM005", source_target))
                    break
        return issues

    def _validate_bindings(self, graph: GraphV2) -> List[ValidationIssue]:
        issues: List[ValidationIssue] = []
        duplicate_keys = set()
        data_links = {
            (
                binding.source.node_id,
                binding.source.port_id,
                binding.target.node_id,
            )
            for binding in graph.bindings
            if isinstance(binding, DataBinding)
        }
        inbound = set()
        outbound = set()
        graph_outputs = {(output.source.node_id, output.source.port_id) for output in graph.outputs}
        for index, binding in enumerate(graph.bindings):
            target = _binding_target(graph, index)
            if isinstance(binding, (DataBinding, ArtifactBinding, ParameterBinding)):
                inbound.add((binding.target.node_id, binding.target.port_id))
            if isinstance(binding, (DataBinding, ArtifactBinding)) and isinstance(binding.source, PortEndpoint):
                outbound.add((binding.source.node_id, binding.source.port_id))
            if isinstance(binding, DataBinding):
                _, source_node, _, source_port = _endpoint_port(graph, binding.source)
                _, target_node, _, target_port = _endpoint_port(graph, binding.target)
                if (
                    not isinstance(source_node, FunctionNode)
                    or not isinstance(target_node, FunctionNode)
                    or source_port.role != "data"
                    or target_port.role != "data"
                ):
                    issues.append(_issue("CPSEM006", target))
            elif isinstance(binding, ArtifactBinding):
                _, _, _, target_port = _endpoint_port(graph, binding.target)
                source_valid = isinstance(binding.source, ResourceEndpoint)
                if isinstance(binding.source, PortEndpoint):
                    _, _, _, source_port = _endpoint_port(graph, binding.source)
                    source_valid = source_port.role == "artifact"
                if not source_valid or target_port.role != "artifact":
                    issues.append(_issue("CPSEM007", target))
            elif isinstance(binding, ParameterBinding):
                _, _, _, target_port = _endpoint_port(graph, binding.target)
                if target_port.role != "parameter":
                    issues.append(_issue("CPSEM007", target))
            elif isinstance(binding, InferredBinding):
                _, source_node, _, source_port = _endpoint_port(graph, binding.derived_from)
                if (
                    binding.source.node_id != binding.derived_from.node_id
                    or not isinstance(source_node, FunctionNode)
                    or source_port.role != "data"
                    or (
                        binding.derived_from.node_id,
                        binding.derived_from.port_id,
                        binding.target.node_id,
                    )
                    not in data_links
                ):
                    issues.append(_issue("CPSEM007", target))
            key = self._binding_key(binding)
            if key in duplicate_keys:
                issues.append(_issue("CPSEM007", target))
            duplicate_keys.add(key)
        for node_index, node in enumerate(graph.nodes):
            for port_index, port in enumerate(node.ports):
                reference = (node.id, port.id)
                if port.direction == "input" and port.required and not port.has_default and reference not in inbound:
                    issues.append(_issue("CPSEM004", _port_target(graph, node_index, port_index)))
                if port.direction == "output" and port.required and reference not in outbound and reference not in graph_outputs:
                    code = "CPSEM005" if isinstance(node, FunctionNode) else "CPSEM007"
                    issues.append(_issue(code, _port_target(graph, node_index, port_index)))
        return issues

    @staticmethod
    def _binding_key(binding: Any) -> Tuple[Any, ...]:
        if isinstance(binding, InferredBinding):
            return (
                binding.kind,
                binding.source.node_id,
                binding.target.node_id,
                binding.derived_from.node_id,
                binding.derived_from.port_id,
            )
        if isinstance(binding, (DataBinding, ArtifactBinding, ParameterBinding)):
            return (binding.kind, tuple(sorted(binding.source.to_dict().items())), tuple(sorted(binding.target.to_dict().items())))
        if isinstance(binding, ExecutionOnlyBinding):
            return (binding.kind, binding.source.node_id, binding.target.node_id)
        return (binding.kind, binding.id)

    @staticmethod
    def _has_inbound_binding(graph: GraphV2, node_id: str, port_id: str) -> bool:
        return any(
            isinstance(binding, (DataBinding, ArtifactBinding, ParameterBinding))
            and binding.target.node_id == node_id
            and binding.target.port_id == port_id
            for binding in graph.bindings
        )

    @staticmethod
    def _validate_queues(graph: GraphV2) -> List[ValidationIssue]:
        if not graph.nodes or graph.settings.default_execution_queue_id is not None:
            return []
        return [
            _issue("CPSEM008", _node_target(graph, index, ".configuration.queue_resource_id", "field"))
            for index, node in enumerate(graph.nodes)
            if node.configuration.queue_resource_id is None
        ]

    @staticmethod
    def _binding_node_ids(binding: Any) -> Tuple[str, ...]:
        if isinstance(binding, (DataBinding, ArtifactBinding)) and isinstance(binding.source, PortEndpoint):
            return binding.source.node_id, binding.target.node_id
        if isinstance(binding, ParameterBinding):
            return (binding.target.node_id,)
        if isinstance(binding, (InferredBinding, ExecutionOnlyBinding)):
            return binding.source.node_id, binding.target.node_id
        return ()

    def _matches_incremental(
        self,
        issue: ValidationIssue,
        affected: Sequence[Union[str, DiagnosticTarget]],
        graph: Optional[GraphV2],
    ) -> bool:
        if issue.target.kind == "graph":
            return True
        paths = {item.path if isinstance(item, DiagnosticTarget) else item for item in affected}
        ids = set()
        for item in affected:
            if isinstance(item, DiagnosticTarget):
                ids.update(
                    value
                    for value in (item.node_id, item.port_id, item.binding_id, item.resource_id, item.parameter_id)
                    if value is not None
                )
            else:
                ids.add(item)
        if any(issue.target.path == path or issue.target.path.startswith(path + ".") for path in paths):
            return True
        if any(
            value in ids
            for value in (
                issue.target.node_id,
                issue.target.port_id,
                issue.target.binding_id,
                issue.target.resource_id,
                issue.target.parameter_id,
            )
            if value is not None
        ):
            return True
        if graph is not None and issue.target.binding_id is not None:
            for binding in graph.bindings:
                if binding.id == issue.target.binding_id and any(node_id in ids for node_id in self._binding_node_ids(binding)):
                    return True
        return False


def validate_graph(
    raw: Union[str, Mapping[str, Any]],
    policy: Optional[ValidationPolicy] = None,
    contributors: Sequence[ValidationContributor] = (),
) -> ValidationResult:
    """Convenience full-graph API for client and server consumers."""

    return ValidationEngine(policy=policy, contributors=contributors).validate_full(raw)


def validate_incremental(
    raw: Union[str, Mapping[str, Any]],
    affected: Iterable[Union[str, DiagnosticTarget]],
    policy: Optional[ValidationPolicy] = None,
    contributors: Sequence[ValidationContributor] = (),
) -> ValidationResult:
    """Return deterministic diagnostics relevant to changed canonical targets."""

    return ValidationEngine(policy=policy, contributors=contributors).validate_incremental(raw, affected)


async def preflight_graph(
    raw: Union[str, Mapping[str, Any]],
    resolver: Optional[ResourceResolver] = None,
    policy: Optional[ValidationPolicy] = None,
    contributors: Sequence[ValidationContributor] = (),
) -> PreflightResult:
    """Run semantic validation and optional asynchronous resource preflight."""

    return await ValidationEngine(policy=policy, contributors=contributors).preflight(raw, resolver)


class GraphValidator:
    """Compatibility facade for existing callers; new consumers use ``ValidationEngine``.

    The former synchronous checker callbacks are intentionally not invoked.
    CP-18/service code must implement the asynchronous ``ResourceResolver``
    contract and call ``preflight_graph`` for resource authorization.
    """

    def __init__(
        self,
        resource_checker: Optional[Any] = None,
        queue_checker: Optional[Any] = None,
        policy: Optional[ValidationPolicy] = None,
    ):
        self._resource_checker = resource_checker
        self._queue_checker = queue_checker
        self._engine = ValidationEngine(policy=policy)

    def validate(self, graph: Union[str, Mapping[str, Any]]) -> ValidationResult:
        return self._engine.validate_full(graph)
