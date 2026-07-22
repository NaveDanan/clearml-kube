"""Deterministic, no-launch source compiler for canonical ClearPipe graphs.

Node kinds are deliberately lowered through registered functions.  CP-12 owns
the task lowerer; CP-13 can register the function lowerer without changing the
controller orchestration or the canonical graph contract.
"""

from dataclasses import dataclass
from hashlib import sha256
import json
import math
import re
from typing import Callable, Dict, Iterable, Mapping, Optional, Sequence, Tuple
from urllib.parse import unquote_plus, urlsplit

from ..graph_v2 import (
    ArtifactBinding,
    DataBinding,
    ExecutionOnlyBinding,
    FunctionNode,
    GraphNode,
    GraphV2,
    InferredBinding,
    NodeEndpoint,
    PortEndpoint,
    ResourceEndpoint,
    TaskNode,
)
from .contracts import (
    FunctionLoweringInput,
    GeneratedDefinition,
    NodeLoweringInput,
    RuntimeStepIdentity,
    SourceManifest,
    SourceMapEntry,
    TaskLoweringInput,
)


_GENERATED_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_RESERVED_NODE_NAMES = {"pipeline", "pipe", "PipelineController", "TaskTypes"}
_SECRET_KEY_PART = re.compile(
    r"(?:^|[_\-/])(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)"
    r"(?:$|[_\-/])",
    re.IGNORECASE,
)
_SECRET_ASSIGNMENT = re.compile(
    r"(?im)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*="
)
_OPAQUE_SECRET_REFERENCE_KEYS = {
    "credentialid",
    "credentialref",
    "credentialreference",
    "secretid",
    "secretref",
    "secretreference",
}


def _unicode_key(value: str) -> Tuple[int, ...]:
    return tuple(ord(character) for character in value)


@dataclass(frozen=True)
class GenerationDiagnostic:
    """A deterministic, value-free diagnostic for an unsupported graph shape."""

    code: str
    path: str
    message: str
    graph_element_id: Optional[str] = None

    def to_dict(self) -> dict:
        result = {"code": self.code, "path": self.path, "message": self.message}
        if self.graph_element_id is not None:
            result["graph_element_id"] = self.graph_element_id
        return result


class GenerationError(ValueError):
    """Raised instead of silently omitting a graph feature during lowering."""

    def __init__(self, diagnostics: Iterable[GenerationDiagnostic]):
        self.diagnostics = tuple(diagnostics)
        if not self.diagnostics:
            raise ValueError("GenerationError requires at least one diagnostic")
        super().__init__("; ".join("{} at {}".format(item.code, item.path) for item in self.diagnostics))


@dataclass(frozen=True)
class LoweredNode:
    """Source fragments returned by a registered node lowerer.

    ``preamble_lines`` are emitted before the controller construction, allowing
    CP-13 to register module-level function definitions.  ``statement_lines``
    are emitted in stable topological order after pipeline parameters.
    """

    statement_lines: Tuple[str, ...]
    preamble_lines: Tuple[str, ...] = ()
    clearml_imports: Tuple[str, ...] = ()
    graph_element_ids: Tuple[str, ...] = ()


NodeLowerer = Callable[[NodeLoweringInput], object]


class ClearPipeCompiler:
    """Compile one canonical graph using independently registered node lowerers."""

    def __init__(self, lowerers: Optional[Mapping[str, NodeLowerer]] = None):
        # The import stays lazy so task.py may use the public LoweredNode type.
        from .task import lower_task

        self._lowerers = {"task": lower_task}  # type: Dict[str, NodeLowerer]
        for kind, lowerer in (lowerers or {}).items():
            self.register_lowerer(kind, lowerer)

    def register_lowerer(self, node_kind: str, lowerer: NodeLowerer, replace: bool = False) -> None:
        """Register a lowering seam for a canonical node discriminator.

        CP-13 should call this with ``"function"`` and a lowerer accepting the
        CP-06 ``FunctionLoweringInput`` data contract.  Registration is scoped
        to this compiler instance, keeping output deterministic and testable.
        """

        if not isinstance(node_kind, str) or not node_kind:
            raise ValueError("node_kind must be a non-empty string")
        if not callable(lowerer):
            raise TypeError("lowerer must be callable")
        if node_kind in self._lowerers and not replace:
            raise ValueError("a lowerer is already registered for {!r}".format(node_kind))
        self._lowerers[node_kind] = lowerer

    def compile(self, graph: GraphV2) -> GeneratedDefinition:
        """Return a pure Python definition; never launch or execute it."""

        plan = _compile_plan(graph, self._lowerers)
        lowered = []
        for node in plan.topological_nodes:
            input_value = _lowering_input(graph, node, plan)
            lowerer = self._lowerers.get(node.kind)
            if lowerer is None:
                raise GenerationError(
                    (
                        GenerationDiagnostic(
                            "CPGEN001",
                            "graph.nodes[{}]".format(node.id),
                            "no lowering is registered for this node kind",
                            node.id,
                        ),
                    )
                )
            try:
                result = _coerce_lowered_node(lowerer(input_value), node)
            except GenerationError:
                raise
            except (TypeError, ValueError) as error:
                if all(hasattr(error, attribute) for attribute in ("code", "path", "message")):
                    raise GenerationError(
                        (
                            GenerationDiagnostic(
                                error.code,
                                error.path,
                                error.message,
                                getattr(error, "node_id", node.id),
                            ),
                        )
                    ) from error
                raise GenerationError(
                    (
                        GenerationDiagnostic(
                            "CPGEN002",
                            "graph.nodes[{}]".format(node.id),
                            "node lowering failed without exposing graph values",
                            node.id,
                        ),
                    )
                ) from error
            lowered.append((node, result))

        return _render_definition(graph, plan, lowered)


@dataclass(frozen=True)
class _CompilePlan:
    topological_nodes: Tuple[GraphNode, ...]
    parent_node_ids: Mapping[str, Tuple[str, ...]]
    inbound_bindings: Mapping[str, Tuple[object, ...]]


def compile_graph(
    graph: GraphV2,
    lowerers: Optional[Mapping[str, NodeLowerer]] = None,
) -> GeneratedDefinition:
    """Compile a graph with CP-12 task lowering and optional registered plugins."""

    return ClearPipeCompiler(lowerers=lowerers).compile(graph)


def _compile_plan(graph: GraphV2, lowerers: Mapping[str, NodeLowerer]) -> _CompilePlan:
    diagnostics = []
    if not isinstance(graph, GraphV2):
        raise GenerationError(
            (
                GenerationDiagnostic(
                    "CPGEN000",
                    "graph",
                    "generation requires a canonical GraphV2 instance",
                ),
            )
        )
    if not graph.nodes:
        diagnostics.append(GenerationDiagnostic("CPGEN004", "graph.nodes", "an empty graph cannot be generated"))
    if _contains_secret(graph.to_dict()):
        diagnostics.append(
            GenerationDiagnostic(
                "CPSEM010",
                "graph",
                "generated definitions cannot contain credential or secret values",
            )
        )
    if not isinstance(graph.document.name, str) or not _GENERATED_NAME.fullmatch(graph.document.name):
        diagnostics.append(
            GenerationDiagnostic(
                "CPSEM001",
                "graph.document.name",
                "pipeline name is not a safe generated identifier",
            )
        )

    parameter_names = set()
    for parameter in graph.parameters:
        path = "graph.parameters[{}].name".format(parameter.id)
        if not isinstance(parameter.name, str) or not _GENERATED_NAME.fullmatch(parameter.name):
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM001",
                    path,
                    "pipeline parameter name is not a safe generated identifier",
                    parameter.id,
                )
            )
        elif parameter.name in parameter_names:
            diagnostics.append(
                GenerationDiagnostic("CPSEM001", path, "pipeline parameter names must be unique", parameter.id)
            )
        parameter_names.add(parameter.name)

    node_by_id = {node.id: node for node in graph.nodes}
    if len(node_by_id) != len(graph.nodes):
        diagnostics.append(GenerationDiagnostic("CPSEM001", "graph.nodes", "node IDs must be unique"))
    names = set()
    for node in graph.nodes:
        path = "graph.nodes[{}].name".format(node.id)
        if not isinstance(node.name, str) or not _GENERATED_NAME.fullmatch(node.name):
            diagnostics.append(
                GenerationDiagnostic("CPSEM001", path, "node name is not a safe generated identifier", node.id)
            )
        elif node.name in _RESERVED_NODE_NAMES:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM001",
                    path,
                    "node name is reserved by the generated PipelineController program",
                    node.id,
                )
            )
        elif node.name in names:
            diagnostics.append(GenerationDiagnostic("CPSEM001", path, "node names must be unique", node.id))
        names.add(node.name)
        if node.kind not in lowerers:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPGEN001",
                    "graph.nodes[{}]".format(node.id),
                    "no lowering is registered for this node kind",
                    node.id,
                )
            )

    resource_by_id = {resource.id: resource for resource in graph.resources}
    default_queue_id = graph.settings.default_execution_queue_id
    if default_queue_id is not None:
        queue = resource_by_id.get(default_queue_id)
        if queue is None or queue.kind != "queue":
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM008",
                    "graph.settings.default_execution_queue_id",
                    "default execution queue must resolve to a queue resource",
                )
            )

    for node in graph.nodes:
        queue_id = node.configuration.queue_resource_id
        if queue_id is not None:
            queue = resource_by_id.get(queue_id)
            if queue is None or queue.kind != "queue":
                diagnostics.append(
                    GenerationDiagnostic(
                        "CPSEM008",
                        "graph.nodes[{}].configuration.queue_resource_id".format(node.id),
                        "node execution queue must resolve to a queue resource",
                        node.id,
                    )
                )
        elif default_queue_id is None:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM008",
                    "graph.nodes[{}].configuration".format(node.id),
                    "every generated step needs a node or default execution queue",
                    node.id,
                )
            )

    parents = {node.id: set() for node in graph.nodes}
    inbound = {node.id: [] for node in graph.nodes}
    for binding in sorted(graph.bindings, key=lambda item: _unicode_key(item.id)):
        target_node_id = _binding_target_node_id(binding)
        if target_node_id is not None and target_node_id in inbound:
            inbound[target_node_id].append(binding)
        dependency = _binding_dependency(binding)
        if dependency is None:
            continue
        source_node_id, target_node_id = dependency
        if source_node_id not in node_by_id or target_node_id not in node_by_id:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM007",
                    "graph.bindings[{}]".format(binding.id),
                    "dependency references an unknown node",
                    binding.id,
                )
            )
            continue
        if source_node_id == target_node_id:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM001",
                    "graph.bindings[{}]".format(binding.id),
                    "a step cannot depend on itself",
                    binding.id,
                )
            )
            continue
        parents[target_node_id].add(source_node_id)
        if isinstance(binding, InferredBinding) and binding.source.node_id != binding.derived_from.node_id:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM007",
                    "graph.bindings[{}].derived_from".format(binding.id),
                    "inferred dependency provenance must belong to its source node",
                    binding.id,
                )
            )

    topological_node_ids = _topological_order(node_by_id, parents)
    if topological_node_ids is None:
        diagnostics.append(GenerationDiagnostic("CPSEM001", "graph.bindings", "graph dependencies must be acyclic"))
    if diagnostics:
        raise GenerationError(diagnostics)

    parent_node_ids = {
        node_id: tuple(
            sorted(
                parent_ids,
                key=lambda parent_id: _unicode_key(node_by_id[parent_id].name),
            )
        )
        for node_id, parent_ids in parents.items()
    }
    return _CompilePlan(
        topological_nodes=tuple(node_by_id[node_id] for node_id in topological_node_ids),
        parent_node_ids=parent_node_ids,
        inbound_bindings={node_id: tuple(values) for node_id, values in inbound.items()},
    )


def _binding_target_node_id(binding: object) -> Optional[str]:
    if isinstance(binding, (DataBinding, ArtifactBinding)):
        return binding.target.node_id
    if hasattr(binding, "target") and isinstance(binding.target, NodeEndpoint):
        return binding.target.node_id
    if hasattr(binding, "target") and isinstance(binding.target, PortEndpoint):
        return binding.target.node_id
    return None


def _binding_dependency(binding: object) -> Optional[Tuple[str, str]]:
    if isinstance(binding, DataBinding):
        return binding.source.node_id, binding.target.node_id
    if isinstance(binding, ArtifactBinding) and isinstance(binding.source, PortEndpoint):
        return binding.source.node_id, binding.target.node_id
    if isinstance(binding, (InferredBinding, ExecutionOnlyBinding)):
        return binding.source.node_id, binding.target.node_id
    return None


def _topological_order(
    node_by_id: Mapping[str, GraphNode],
    parents: Mapping[str, set],
) -> Optional[Tuple[str, ...]]:
    unresolved = {node_id: set(values) for node_id, values in parents.items()}
    children = {node_id: set() for node_id in node_by_id}
    for target_node_id, parent_node_ids in unresolved.items():
        for parent_node_id in parent_node_ids:
            children[parent_node_id].add(target_node_id)
    ready = sorted((node_id for node_id, values in unresolved.items() if not values), key=_unicode_key)
    ordered = []
    while ready:
        node_id = ready.pop(0)
        ordered.append(node_id)
        for child_id in sorted(children[node_id], key=_unicode_key):
            unresolved[child_id].remove(node_id)
            if not unresolved[child_id]:
                ready.append(child_id)
        ready.sort(key=_unicode_key)
    return tuple(ordered) if len(ordered) == len(node_by_id) else None


def _lowering_input(graph: GraphV2, node: GraphNode, plan: _CompilePlan) -> NodeLoweringInput:
    arguments = dict(
        graph=graph,
        node=node,
        inbound_bindings=plan.inbound_bindings[node.id],
        parent_node_ids=plan.parent_node_ids[node.id],
    )
    if isinstance(node, TaskNode):
        return TaskLoweringInput(**arguments)
    if isinstance(node, FunctionNode):
        return FunctionLoweringInput(**arguments)
    return NodeLoweringInput(**arguments)


def _coerce_lowered_node(result: object, node: GraphNode) -> LoweredNode:
    """Adapt the CP-13 plug-in result without importing or owning its lowerer."""

    if isinstance(result, LoweredNode):
        return result
    required = ("node_id", "definition_source", "step_source", "source_map")
    if not all(hasattr(result, attribute) for attribute in required):
        raise GenerationError(
            (
                GenerationDiagnostic(
                    "CPGEN003",
                    "graph.nodes[{}]".format(node.id),
                    "registered lowerer returned an invalid source fragment",
                    node.id,
                ),
            )
        )
    if result.node_id != node.id or not isinstance(result.definition_source, str) or not isinstance(result.step_source, str):
        raise GenerationError(
            (
                GenerationDiagnostic(
                    "CPGEN003",
                    "graph.nodes[{}]".format(node.id),
                    "registered lowerer returned a fragment for a different node",
                    node.id,
                ),
            )
        )
    return LoweredNode(
        preamble_lines=tuple(result.definition_source.rstrip("\n").splitlines()),
        statement_lines=tuple(result.step_source.rstrip("\n").splitlines()),
        clearml_imports=("TaskTypes",),
        graph_element_ids=(node.id,),
    )


def _render_definition(
    graph: GraphV2,
    plan: _CompilePlan,
    lowered: Sequence[Tuple[GraphNode, LoweredNode]],
) -> GeneratedDefinition:
    digest = "sha256:" + sha256(_generation_digest_document(graph).encode("utf-8")).hexdigest()
    import_names = {"PipelineController"}
    for _, fragment in lowered:
        import_names.update(fragment.clearml_imports)
    if any(not _GENERATED_NAME.fullmatch(name) for name in import_names):
        raise GenerationError(
            (
                GenerationDiagnostic(
                    "CPGEN003",
                    "graph",
                    "registered lowerer requested an unsafe ClearML import",
                ),
            )
        )

    lines = ["from clearml import {}".format(", ".join(sorted(import_names, key=_unicode_key))), ""]
    lines.append("# ClearPipe graph schema v{} {}".format(graph.schema_version, digest))
    lines.append("")
    source_map = []

    for node, fragment in lowered:
        if not fragment.preamble_lines:
            continue
        start = len(lines) + 1
        lines.extend(fragment.preamble_lines)
        end = len(lines)
        lines.append("")
        _add_source_map_entries(source_map, fragment.graph_element_ids or (node.id,), start, end)

    document_id = graph.document.id or "graph"
    controller_start = len(lines) + 1
    lines.extend(
        (
            "pipe = PipelineController(",
            "    name={},".format(_python_literal(graph.document.name)),
            "    project={},".format(_python_literal(graph.document.project)),
        )
    )
    if graph.document.version is not None:
        lines.append("    version={},".format(_python_literal(graph.document.version)))
    lines.extend(("    add_pipeline_tags=False,", ")", ""))
    _add_source_map_entries(source_map, (document_id,), controller_start, len(lines) - 1)

    if graph.settings.default_execution_queue_id is not None:
        queue_resource = next(
            resource for resource in graph.resources if resource.id == graph.settings.default_execution_queue_id
        )
        start = len(lines) + 1
        lines.append("pipe.set_default_execution_queue({})".format(_python_literal(queue_resource.resource_id)))
        lines.append("")
        _add_source_map_entries(source_map, (document_id, queue_resource.id), start, start)

    for parameter in sorted(graph.parameters, key=lambda item: (item.order, _unicode_key(item.id))):
        start = len(lines) + 1
        kwargs = [("name", parameter.name)]
        if parameter.has_default:
            kwargs.append(("default", parameter.default))
        if parameter.description is not None:
            kwargs.append(("description", parameter.description))
        lines.extend(_format_call("pipe.add_parameter", kwargs))
        lines.append("")
        _add_source_map_entries(source_map, (parameter.id,), start, len(lines) - 1)

    for node, fragment in lowered:
        start = len(lines) + 1
        lines.extend(fragment.statement_lines)
        end = len(lines)
        lines.append("")
        element_ids = fragment.graph_element_ids or (node.id,)
        _add_source_map_entries(source_map, element_ids, start, end)
        if node.configuration.queue_resource_id is not None:
            _add_source_map_entries(source_map, (node.configuration.queue_resource_id,), start, end)
        for binding in plan.inbound_bindings[node.id]:
            _add_source_map_entries(source_map, (binding.id,), start, end)
            _add_source_map_entries(source_map, _binding_resource_ids(binding), start, end)

    while lines and lines[-1] == "":
        lines.pop()
    source = "\n".join(lines) + "\n"
    return GeneratedDefinition(
        source=source,
        source_map=tuple(source_map),
        manifest=SourceManifest(
            graph_schema_version=graph.schema_version,
            graph_digest=digest,
            node_ids=tuple(node.id for node in plan.topological_nodes),
            runtime_steps=tuple(
                RuntimeStepIdentity(
                    graph_node_id=node.id,
                    pipeline_step_name=node.name,
                )
                for node in plan.topological_nodes
            ),
        ),
    )


def _add_source_map_entries(
    target: list,
    graph_element_ids: Sequence[str],
    start_line: int,
    end_line: int,
) -> None:
    target.extend(
        SourceMapEntry(graph_element_id=element_id, start_line=start_line, end_line=end_line)
        for element_id in graph_element_ids
    )


def _format_call(name: str, kwargs: Sequence[Tuple[str, object]]) -> Tuple[str, ...]:
    lines = [name + "("]
    for key, value in kwargs:
        rendered = _python_literal(value, indent=4)
        parts = rendered.splitlines() or [rendered]
        lines.append("    {}={}".format(key, parts[0]))
        lines.extend(parts[1:])
        lines[-1] += ","
    lines.append(")")
    return tuple(lines)


def _contains_secret(value: object) -> bool:
    """Defend the source boundary even when callers bypass the graph decoder."""

    if isinstance(value, Mapping):
        for key, child in value.items():
            compact_key = re.sub(r"[^a-z0-9]", "", str(key).lower())
            if (
                compact_key not in _OPAQUE_SECRET_REFERENCE_KEYS
                and _SECRET_KEY_PART.search(str(key))
                and child not in (None, "", (), [], {})
            ):
                return True
            if _contains_secret(child):
                return True
        return False
    if isinstance(value, (tuple, list)):
        return any(_contains_secret(item) for item in value)
    if isinstance(value, str):
        if _SECRET_ASSIGNMENT.search(value):
            return True
        try:
            parsed = urlsplit(value)
        except ValueError:
            return False
        if parsed.scheme.lower() in {"http", "https"} and (parsed.username or parsed.password):
            return True
        return any(
            _SECRET_KEY_PART.search(unquote_plus(partition[0]))
            for pair in parsed.query.split("&")
            if pair
            for partition in (pair.split("=", 1),)
        )
    return False


def _generation_digest_document(graph: GraphV2) -> str:
    """Serialize only fields that can affect generated source.

    Canvas layout, labels, saved-document identity, and resource labels are
    authoring/display metadata.  Including them would make an unchanged
    pipeline definition appear to have changed when a user merely moved a card.
    """

    document = graph.to_dict()
    document.pop("visual", None)
    metadata = document["document"]
    for key in ("id", "revision", "description", "tags"):
        metadata.pop(key, None)
    for resource in document["resources"]:
        resource.pop("label", None)
    for node in document["nodes"]:
        node.pop("label", None)
        node.pop("description", None)
        node.pop("visual", None)
    return _canonical_digest_json(document)


def _canonical_digest_json(value: object) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if type(value) is int:
        return str(value)
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("non-finite values are not valid generated literals")
        if value == 0:
            return "0"
        if value.is_integer():
            return str(int(value))
        mantissa, exponent = format(value, ".16e").split("e")
        return "{}e{:+d}".format(mantissa.rstrip("0").rstrip("."), int(exponent))
    if isinstance(value, (tuple, list)):
        return "[{}]".format(",".join(_canonical_digest_json(item) for item in value))
    if isinstance(value, Mapping):
        return "{{{}}}".format(
            ",".join(
                "{}:{}".format(json.dumps(key, ensure_ascii=False), _canonical_digest_json(value[key]))
                for key in sorted(value, key=_unicode_key)
            )
        )
    raise ValueError("only JSON values can be represented in a generation digest")


def _python_literal(value: object, indent: int = 0) -> str:
    """Render a JSON value as deterministic, valid Python without execution."""

    if value is None:
        return "None"
    if value is True:
        return "True"
    if value is False:
        return "False"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if type(value) is int:
        return str(value)
    if type(value) is float:
        if value != value or value in (float("inf"), float("-inf")):
            raise ValueError("non-finite values are not valid generated literals")
        if value == 0:
            return "0"
        if value.is_integer():
            return str(int(value))
        return repr(value)
    if isinstance(value, (tuple, list)):
        items = [_python_literal(item, indent + 4) for item in value]
        compact = "[{}]".format(", ".join(items))
        if all("\n" not in item for item in items) and len(compact) + indent <= 88:
            return compact
        item_lines = ["["]
        for item in items:
            parts = item.splitlines()
            item_lines.append(" " * (indent + 4) + parts[0])
            item_lines.extend(parts[1:])
            item_lines[-1] += ","
        item_lines.append(" " * indent + "]")
        return "\n".join(item_lines)
    if isinstance(value, Mapping):
        items = [
            (_python_literal(key), _python_literal(value[key], indent + 4))
            for key in sorted(value, key=_unicode_key)
        ]
        compact = "{{{}}}".format(", ".join("{}: {}".format(key, item) for key, item in items))
        if all("\n" not in item for _, item in items) and len(compact) + indent <= 88:
            return compact
        item_lines = ["{"]
        for key, item in items:
            parts = item.splitlines()
            item_lines.append(" " * (indent + 4) + "{}: {}".format(key, parts[0]))
            item_lines.extend(parts[1:])
            item_lines[-1] += ","
        item_lines.append(" " * indent + "}")
        return "\n".join(item_lines)
    raise ValueError("only JSON values can be rendered into generated source")


def _binding_resource_ids(binding: object) -> Tuple[str, ...]:
    """Return stable resource IDs whose literal value is emitted for this binding."""

    if isinstance(binding, ArtifactBinding) and isinstance(binding.source, ResourceEndpoint):
        return (binding.source.resource_id,)
    return ()
