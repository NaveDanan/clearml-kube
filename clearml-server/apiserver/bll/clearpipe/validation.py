import json
import re
from urllib.parse import parse_qsl, urlsplit
from collections import defaultdict, deque
from dataclasses import asdict, dataclass
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Set


SUPPORTED_NODE_TYPES = {
    "dataset",
    "versioning",
    "execute",
    "training",
    "experiment",
    "experiment_tracking",
    "report",
}
MAX_GRAPH_BYTES = 4 * 1024 * 1024
MAX_INLINE_SCRIPT_BYTES = 1024 * 1024
_SECRET_KEY = re.compile(
    r"(^|[_-])(secret|password|passwd|token|api[_-]?key|access[_-]?key|"
    r"secret[_-]?key|private[_-]?key|connection[_-]?string|credential)s?($|[_-])",
    re.IGNORECASE,
)
_SAFE_REFERENCE_KEYS = {"connectionid", "credentialid", "secretid", "keyid"}


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    path: str = ""
    node_id: Optional[str] = None
    severity: str = "error"

    def to_dict(self) -> dict:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass
class ValidationResult:
    issues: List[ValidationIssue]

    @property
    def valid(self) -> bool:
        return not any(issue.severity == "error" for issue in self.issues)

    def to_dict(self) -> dict:
        return {"valid": self.valid, "issues": [issue.to_dict() for issue in self.issues]}


class GraphValidator:
    """Validate the browser graph without ever materializing credentials server-side.

    ``resource_checker`` receives ``(kind, id)`` and returns whether the current
    identity may read it. ``queue_checker`` performs the same check for queues.
    The callbacks make the graph rules independently testable and keep company
    isolation in the service layer.
    """

    def __init__(
        self,
        resource_checker: Optional[Callable[[str, str], bool]] = None,
        queue_checker: Optional[Callable[[str], bool]] = None,
    ):
        self.resource_checker = resource_checker
        self.queue_checker = queue_checker

    def validate(self, graph: Mapping) -> ValidationResult:
        issues: List[ValidationIssue] = []
        if not isinstance(graph, Mapping):
            return ValidationResult([ValidationIssue("invalid_graph", "Graph must be an object")])

        try:
            size = len(json.dumps(graph, separators=(",", ":")).encode("utf-8"))
        except (TypeError, ValueError):
            return ValidationResult([ValidationIssue("invalid_graph", "Graph must be JSON serializable")])
        if size > MAX_GRAPH_BYTES:
            issues.append(ValidationIssue("graph_too_large", f"Graph exceeds {MAX_GRAPH_BYTES} bytes"))

        nodes = graph.get("nodes", [])
        edges = graph.get("edges", [])
        if not isinstance(nodes, list):
            issues.append(ValidationIssue("invalid_nodes", "nodes must be an array", "nodes"))
            nodes = []
        if not isinstance(edges, list):
            issues.append(ValidationIssue("invalid_edges", "edges must be an array", "edges"))
            edges = []

        node_ids = self._unique_ids(nodes, "node", issues)
        self._unique_ids(edges, "edge", issues)
        parents: Dict[str, Set[str]] = defaultdict(set)
        children: Dict[str, Set[str]] = defaultdict(set)
        for index, edge in enumerate(edges):
            if not isinstance(edge, Mapping):
                issues.append(ValidationIssue("invalid_edge", "Edge must be an object", f"edges.{index}"))
                continue
            source, target = edge.get("source"), edge.get("target")
            if source and source == target:
                issues.append(ValidationIssue("self_loop", "A node cannot depend on itself", f"edges.{index}"))
            for field, value in (("source", source), ("target", target)):
                if not value or value not in node_ids:
                    issues.append(
                        ValidationIssue(
                            "missing_node_reference",
                            f"Edge {field} references an unknown node",
                            f"edges.{index}.{field}",
                        )
                    )
            if source in node_ids and target in node_ids:
                parents[target].add(source)
                children[source].add(target)

        logical_edges = set()
        for index, edge in enumerate(edges):
            if not isinstance(edge, Mapping):
                continue
            logical = (
                edge.get("source"),
                edge.get("sourceHandle"),
                edge.get("target"),
                edge.get("targetHandle"),
            )
            if logical in logical_edges:
                issues.append(ValidationIssue("duplicate_connection", "Duplicate logical connection", f"edges.{index}"))
            logical_edges.add(logical)
            for field in ("sourceHandle", "targetHandle"):
                if field in edge and edge[field] is not None and not isinstance(edge[field], str):
                    issues.append(ValidationIssue("invalid_edge_port", f"{field} must be a string", f"edges.{index}.{field}"))

        if node_ids and self._has_cycle(node_ids, parents, children):
            issues.append(ValidationIssue("graph_cycle", "Pipeline graph must be acyclic", "edges"))

        self._check_secrets(graph, issues)
        for path, queue in self._default_queues(graph):
            if queue and self.queue_checker and not self.queue_checker(str(queue)):
                issues.append(ValidationIssue("invalid_queue", "Queue is missing or inaccessible", path))
        for index, node in enumerate(nodes):
            if isinstance(node, Mapping):
                self._validate_node(node, index, issues)
        return ValidationResult(issues)

    @staticmethod
    def _unique_ids(items: Sequence, kind: str, issues: List[ValidationIssue]) -> Set[str]:
        seen: Set[str] = set()
        for index, item in enumerate(items):
            value = item.get("id") if isinstance(item, Mapping) else None
            if not isinstance(value, str) or not value.strip():
                issues.append(ValidationIssue(f"missing_{kind}_id", f"{kind.title()} id is required", f"{kind}s.{index}.id"))
            elif value in seen:
                issues.append(ValidationIssue(f"duplicate_{kind}_id", f"Duplicate {kind} id: {value}", f"{kind}s.{index}.id"))
            else:
                seen.add(value)
        return seen

    @staticmethod
    def _has_cycle(node_ids: Iterable[str], parents: Mapping[str, Set[str]], children: Mapping[str, Set[str]]) -> bool:
        degrees = {node_id: len(parents.get(node_id, ())) for node_id in node_ids}
        ready = deque(node_id for node_id, degree in degrees.items() if degree == 0)
        visited = 0
        while ready:
            node_id = ready.popleft()
            visited += 1
            for child in children.get(node_id, ()):
                degrees[child] -= 1
                if degrees[child] == 0:
                    ready.append(child)
        return visited != len(degrees)

    def _check_secrets(self, value, issues: List[ValidationIssue], path: str = ""):
        if isinstance(value, Mapping):
            for key, child in value.items():
                child_path = f"{path}.{key}" if path else str(key)
                normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
                if (
                    normalized not in _SAFE_REFERENCE_KEYS
                    and _SECRET_KEY.search(str(key))
                    and child not in (None, "", {}, [])
                ):
                    issues.append(
                        ValidationIssue(
                            "embedded_secret",
                            "Credentials and secrets must be provided by the Agent environment or an opaque connection reference",
                            child_path,
                        )
                    )
                self._check_secrets(child, issues, child_path)
        elif isinstance(value, str):
            try:
                url = urlsplit(value)
                sensitive_query = any(_SECRET_KEY.search(key) for key, _ in parse_qsl(url.query))
                if (url.username or url.password or sensitive_query) and url.scheme:
                    issues.append(ValidationIssue("embedded_secret", "URLs must not contain credentials or secret query parameters", path))
            except ValueError:
                pass
            if path.lower().endswith(("inlinescript", "customcode")) and re.search(
                r"(?im)^\s*[A-Za-z_]*(?:secret|password|token|api_?key|access_?key)[A-Za-z_]*\s*=\s*['\"][^'\"]+['\"]",
                value,
            ):
                issues.append(ValidationIssue("embedded_secret", "Inline scripts must read credentials from the Agent environment", path))
        elif isinstance(value, list):
            for index, child in enumerate(value):
                self._check_secrets(child, issues, f"{path}.{index}")

    def _validate_node(self, node: Mapping, index: int, issues: List[ValidationIssue]):
        node_id = node.get("id")
        data = node.get("data") if isinstance(node.get("data"), Mapping) else node
        node_type = data.get("type") or node.get("type")
        config = data.get("config", {})
        base = f"nodes.{index}"
        if node_type not in SUPPORTED_NODE_TYPES:
            issues.append(ValidationIssue("unsupported_node_type", f"Unsupported node type: {node_type}", f"{base}.data.type", node_id))
            return
        if not isinstance(config, Mapping):
            issues.append(ValidationIssue("invalid_node_config", "Node config must be an object", f"{base}.data.config", node_id))
            return

        required = {
            "dataset": ("source",),
            "versioning": ("tool",),
            "execute": ("steps",),
            "training": ("scriptSource",),
            "experiment": ("tracker", "projectName", "experimentName"),
            "experiment_tracking": ("tracker", "projectName", "experimentName"),
            "report": ("title", "outputFormat"),
        }[node_type]
        for key in required:
            if config.get(key) in (None, ""):
                issues.append(ValidationIssue("missing_node_setting", f"{key} is required", f"{base}.data.config.{key}", node_id))

        for script_path, script in self._inline_scripts(node_type, config):
            if isinstance(script, str) and len(script.encode("utf-8")) > MAX_INLINE_SCRIPT_BYTES:
                issues.append(ValidationIssue("script_too_large", f"Inline script exceeds {MAX_INLINE_SCRIPT_BYTES} bytes", f"{base}.data.config.{script_path}", node_id))

        queue = config.get("queue") or config.get("queueId")
        if queue and self.queue_checker and not self.queue_checker(str(queue)):
            issues.append(ValidationIssue("invalid_queue", "Queue is missing or inaccessible", f"{base}.data.config.queue", node_id))

        if self.resource_checker:
            for kind, resource_id, path in self._resource_references(config):
                if resource_id and not self.resource_checker(kind, str(resource_id)):
                    issues.append(ValidationIssue("inaccessible_resource", f"{kind} is missing or inaccessible", f"{base}.data.config.{path}", node_id))

    @staticmethod
    def _inline_scripts(node_type: str, config: Mapping):
        if node_type == "execute":
            for index, step in enumerate(config.get("steps") or []):
                if isinstance(step, Mapping):
                    yield f"steps.{index}.inlineScript", step.get("inlineScript")
        if node_type == "training":
            yield "inlineScript", config.get("inlineScript")

    @staticmethod
    def _resource_references(config: Mapping):
        keys = {
            "datasetId": "dataset",
            "selectedDatasetId": "dataset",
            "taskId": "task",
            "baseTaskId": "task",
            "modelId": "model",
            "projectId": "project",
            "reportId": "report",
            "servingEndpointId": "serving",
        }
        for key, kind in keys.items():
            if config.get(key):
                yield kind, config[key], key

    @staticmethod
    def _default_queues(graph: Mapping):
        queue = graph.get("default_queue") or graph.get("defaultQueue")
        if queue:
            yield "default_queue", queue
        queues = graph.get("default_queues") or graph.get("defaultQueues") or {}
        if isinstance(queues, Mapping):
            for node_id, value in queues.items():
                yield f"default_queues.{node_id}", value
