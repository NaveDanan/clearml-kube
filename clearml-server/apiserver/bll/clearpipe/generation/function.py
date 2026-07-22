"""Deterministic, no-launch lowering for ClearPipe function nodes.

This module is intentionally a node-level plug-in.  The compiler owns module
imports, controller construction, topological ordering, and manifests; this
lowerer contributes one constrained module-level definition and its matching
``PipelineController.add_function_step`` call.
"""

import ast
import json
import keyword
import math
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple
from urllib.parse import unquote_plus, urlsplit

from .contracts import FunctionLoweringInput, SourceMapEntry


_GENERATED_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")
_SECRET_ASSIGNMENT = re.compile(
    r"(?im)\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*="
)
_MAX_SAFE_INTEGER = (1 << 53) - 1
_UNSET = object()
_TASK_TYPES = frozenset(
    (
        "training",
        "testing",
        "inference",
        "data_processing",
        "application",
        "monitor",
        "controller",
        "optimizer",
        "service",
        "qc",
        "custom",
    )
)


@dataclass
class FunctionGenerationError(ValueError):
    """A value-free diagnostic for an unsupported function lowering."""

    code: str
    path: str
    node_id: str
    message: str

    def __str__(self) -> str:
        return "{} at {}: {}".format(self.code, self.path, self.message)

    def to_dict(self) -> Dict[str, str]:
        return {
            "code": self.code,
            "path": self.path,
            "node_id": self.node_id,
            "message": self.message,
        }


@dataclass(frozen=True)
class FunctionStepLowering:
    """The two generated blocks contributed by one function node."""

    node_id: str
    function_name: str
    definition_source: str
    step_source: str
    source: str
    source_map: Tuple[SourceMapEntry, ...]


@dataclass(frozen=True)
class _Argument:
    name: str
    default: Any = _UNSET


def lower_function_node(
    lowering: FunctionLoweringInput, controller_name: str = "pipe"
) -> FunctionStepLowering:
    """Lower one CP-06 function input without importing, evaluating, or launching it.

    ``parent_node_ids`` is supplied by the compiler from canonical bindings.
    Data references are checked against that list rather than relying on
    ClearML's implicit parent mutation.
    """

    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    if getattr(node, "kind", None) != "function":
        raise _error("CPSEM003", path, node_id, "function lowerer requires a function node")
    _require_generated_name(getattr(node, "name", ""), path + ".name", node_id, "CPSEM003")
    _require_generated_name(controller_name, "controller_name", node_id, "CPSEM009")

    source_function = _parse_source(node, path)
    signature_function = _parse_signature(node, path)
    _validate_function_shape(node, path, source_function, signature_function)
    arguments = _arguments_from_signature(signature_function, path, node_id)
    _validate_source_returns(source_function, path, node_id, len(_output_ports(node, path, node_id)))
    _reject_source_secrets(source_function, getattr(node, "source", ""), path, node_id)

    input_ports = _input_ports(node, path, node_id)
    output_ports = _output_ports(node, path, node_id)
    _validate_ports_against_signature(arguments, input_ports, path, node_id)
    output_names = _output_names(output_ports, path, node_id)
    function_kwargs, data_parent_ids, inferred_parent_ids, execution_parent_ids = _function_kwargs(
        lowering, arguments, input_ports, path, node_id
    )
    parents = _canonical_parents(
        lowering, data_parent_ids | inferred_parent_ids | execution_parent_ids, path, node_id
    )
    execution_queue = _execution_queue(lowering, path, node_id)
    packages, retry_on_failure = _optional_execution_settings(node, path, node_id)
    task_type = getattr(getattr(node, "configuration", None), "task_type", None)
    if task_type not in _TASK_TYPES:
        raise _error(
            "CPSEM009",
            path + ".configuration.task_type",
            node_id,
            "task type is not supported by PipelineController.add_function_step",
        )

    definition_source = _normalized_source(getattr(node, "source", ""))
    step_source = _render_step(
        controller_name=controller_name,
        node_name=node.name,
        function_kwargs=function_kwargs,
        output_names=output_names,
        task_type=task_type,
        execution_queue=execution_queue,
        cache=bool(getattr(node.configuration, "cache", False)),
        packages=packages,
        retry_on_failure=retry_on_failure,
        parents=parents,
    )
    source = "{}\n{}".format(definition_source, step_source)
    definition_lines = definition_source.count("\n")
    step_start = definition_lines + 2
    step_lines = step_source.rstrip("\n").count("\n") + 1
    source_map = (
        SourceMapEntry(node_id, 1, definition_lines),
        SourceMapEntry(node_id, step_start, step_start + step_lines - 1),
    )
    return FunctionStepLowering(
        node_id=node_id,
        function_name=node.name,
        definition_source=definition_source,
        step_source=step_source,
        source=source,
        source_map=source_map,
    )


# The concise name is retained for compiler plug-in callers.
lower_function_step = lower_function_node
lower_function = lower_function_node


def _parse_source(node: Any, path: str) -> ast.FunctionDef:
    node_id = node.id
    source = getattr(node, "source", None)
    if not isinstance(source, str) or not source.strip():
        raise _error("CPSEM003", path + ".source", node_id, "module-level function source is required")
    try:
        module = ast.parse(source, mode="exec")
    except SyntaxError:
        raise _error("CPSEM003", path + ".source", node_id, "function source must be valid Python")
    if len(module.body) != 1 or not isinstance(module.body[0], ast.FunctionDef):
        raise _error(
            "CPSEM003",
            path + ".source",
            node_id,
            "source must contain exactly one module-level function definition",
        )
    return module.body[0]


def _parse_signature(node: Any, path: str) -> ast.FunctionDef:
    node_id = node.id
    signature = getattr(node, "signature", None)
    if not isinstance(signature, str) or not signature.strip() or "\n" in signature:
        raise _error("CPSEM003", path + ".signature", node_id, "one-line function signature is required")
    header = signature.strip()
    if header.endswith(":"):
        header = header[:-1].rstrip()
    try:
        module = ast.parse("{}:\n    pass\n".format(header), mode="exec")
    except SyntaxError:
        raise _error("CPSEM003", path + ".signature", node_id, "signature must be a valid function header")
    if len(module.body) != 1 or not isinstance(module.body[0], ast.FunctionDef):
        raise _error("CPSEM003", path + ".signature", node_id, "signature must declare a function")
    return module.body[0]


def _validate_function_shape(
    node: Any, path: str, source_function: ast.FunctionDef, signature_function: ast.FunctionDef
) -> None:
    node_id = node.id
    if source_function.name != node.name or signature_function.name != node.name:
        raise _error(
            "CPSEM003",
            path + ".signature",
            node_id,
            "source, signature, and node name must declare the same function",
        )
    if source_function.decorator_list:
        raise _error("CPSEM003", path + ".source", node_id, "function decorators are unsupported")
    if getattr(source_function, "type_params", ()):
        raise _error("CPSEM003", path + ".source", node_id, "generic type parameters are unsupported")
    if ast.dump(source_function.args, include_attributes=False) != ast.dump(
        signature_function.args, include_attributes=False
    ) or ast.dump(source_function.returns, include_attributes=False) != ast.dump(
        signature_function.returns, include_attributes=False
    ):
        raise _error(
            "CPSEM003",
            path + ".signature",
            node_id,
            "signature must exactly match the declared source function",
        )

    unsupported = (
        ast.AsyncFunctionDef,
        ast.ClassDef,
        ast.Lambda,
        ast.Yield,
        ast.YieldFrom,
        ast.Await,
        ast.Global,
        ast.Nonlocal,
        ast.Import,
        ast.ImportFrom,
    )
    for child in ast.walk(source_function):
        if child is not source_function and isinstance(child, ast.FunctionDef):
            raise _error("CPSEM003", path + ".source", node_id, "nested functions and closures are unsupported")
        if isinstance(child, unsupported):
            raise _error("CPSEM003", path + ".source", node_id, "source uses an unsupported dynamic construct")
        if isinstance(child, ast.Call):
            if isinstance(child.func, ast.Name) and child.func.id in {"eval", "exec", "__import__"}:
                raise _error("CPSEM003", path + ".source", node_id, "source may not evaluate or import dynamically")
            if isinstance(child.func, ast.Attribute) and child.func.attr in {
                "start",
                "start_locally",
                "run_locally",
                "debug_pipeline",
            }:
                raise _error("CPSEM009", path + ".source", node_id, "function source may not launch a pipeline")


def _arguments_from_signature(
    function: ast.FunctionDef, path: str, node_id: str
) -> Tuple[_Argument, ...]:
    arguments = function.args
    if arguments.posonlyargs or arguments.vararg is not None or arguments.kwarg is not None:
        raise _error(
            "CPSEM004",
            path + ".signature",
            node_id,
            "positional-only, variadic, and keyword-capture arguments are unsupported",
        )
    positional = list(arguments.args)
    defaults = [_UNSET] * (len(positional) - len(arguments.defaults))
    defaults.extend(_json_from_ast(default, path + ".signature", node_id) for default in arguments.defaults)
    result = [_Argument(argument.arg, default) for argument, default in zip(positional, defaults)]
    for argument, default in zip(arguments.kwonlyargs, arguments.kw_defaults):
        result.append(
            _Argument(
                argument.arg,
                _UNSET if default is None else _json_from_ast(default, path + ".signature", node_id),
            )
        )
    return tuple(result)


def _json_from_ast(value: ast.AST, path: str, node_id: str) -> Any:
    if isinstance(value, ast.Constant):
        return _validate_json_value(value.value, path, node_id)
    if isinstance(value, ast.UnaryOp) and isinstance(value.op, (ast.USub, ast.UAdd)) and isinstance(
        value.operand, ast.Constant
    ):
        operand = value.operand.value
        if type(operand) in (int, float):
            return _validate_json_value(-operand if isinstance(value.op, ast.USub) else operand, path, node_id)
    if isinstance(value, ast.List):
        return [_json_from_ast(item, path, node_id) for item in value.elts]
    if isinstance(value, ast.Dict):
        result = {}
        for key, nested in zip(value.keys, value.values):
            if key is None or not isinstance(key, ast.Constant) or not isinstance(key.value, str):
                raise _error("CPSEM004", path, node_id, "signature defaults must be JSON-safe literals")
            result[key.value] = _json_from_ast(nested, path, node_id)
        return _validate_json_value(result, path, node_id)
    raise _error("CPSEM004", path, node_id, "signature defaults must be JSON-safe literals")


def _validate_json_value(value: Any, path: str, node_id: str) -> Any:
    if value is None or type(value) in (bool, str):
        return value
    if type(value) is int:
        if abs(value) > _MAX_SAFE_INTEGER:
            raise _error("CPSEM004", path, node_id, "integer defaults must be IEEE-754 safe")
        return value
    if type(value) is float:
        if not math.isfinite(value):
            raise _error("CPSEM004", path, node_id, "numeric defaults must be finite")
        if value.is_integer() and abs(value) > _MAX_SAFE_INTEGER:
            raise _error("CPSEM004", path, node_id, "integer defaults must be IEEE-754 safe")
        return value
    if isinstance(value, list):
        return [_validate_json_value(item, path, node_id) for item in value]
    if isinstance(value, Mapping):
        result = {}
        for key, nested in value.items():
            if not isinstance(key, str):
                raise _error("CPSEM004", path, node_id, "object defaults require string keys")
            if _is_secret_key(key):
                raise _error("CPSEM010", path, node_id, "secret-bearing defaults are not allowed")
            result[key] = _validate_json_value(nested, path, node_id)
        return result
    raise _error("CPSEM004", path, node_id, "defaults must be JSON-safe values")


def _input_ports(node: Any, path: str, node_id: str) -> Tuple[Any, ...]:
    return tuple(
        sorted(
            (port for port in node.ports if getattr(port, "direction", None) == "input"),
            key=lambda port: (port.order, port.id),
        )
    )


def _output_ports(node: Any, path: str, node_id: str) -> Tuple[Any, ...]:
    ports = tuple(
        sorted(
            (port for port in node.ports if getattr(port, "direction", None) == "output"),
            key=lambda port: (port.order, port.id),
        )
    )
    if not ports:
        raise _error("CPSEM005", path + ".ports", node_id, "function nodes require at least one named output")
    return ports


def _validate_ports_against_signature(
    arguments: Sequence[_Argument], ports: Sequence[Any], path: str, node_id: str
) -> None:
    argument_names = {argument.name for argument in arguments}
    port_names = {port.name for port in ports}
    if argument_names != port_names:
        raise _error(
            "CPSEM004",
            path + ".ports",
            node_id,
            "input ports must exactly match the declared function arguments",
        )
    for port in ports:
        _require_generated_name(port.name, path + ".ports.{}.name".format(port.id), node_id, "CPSEM004")


def _output_names(ports: Sequence[Any], path: str, node_id: str) -> Tuple[str, ...]:
    names = []
    for port in ports:
        _require_generated_name(port.name, path + ".ports.{}.name".format(port.id), node_id, "CPSEM005")
        if port.name in names:
            raise _error("CPSEM005", path + ".ports", node_id, "function output names must be unique")
        names.append(port.name)
    return tuple(names)


def _validate_source_returns(
    function: ast.FunctionDef, path: str, node_id: str, output_count: int
) -> None:
    returns = [item for item in ast.walk(function) if isinstance(item, ast.Return)]
    if not returns:
        raise _error("CPSEM005", path + ".source", node_id, "function source must return declared outputs")
    if output_count == 1:
        return
    for returned in returns:
        if not isinstance(returned.value, (ast.Tuple, ast.List)) or len(returned.value.elts) != output_count:
            raise _error(
                "CPSEM005",
                path + ".source",
                node_id,
                "each return must be a tuple or list matching the declared output arity",
            )


def _reject_source_secrets(
    function: ast.FunctionDef, source: str, path: str, node_id: str
) -> None:
    if _SECRET_ASSIGNMENT.search(source):
        raise _error("CPSEM010", path + ".source", node_id, "secret-bearing source is not allowed")
    for item in ast.walk(function):
        if isinstance(item, ast.Constant) and isinstance(item.value, str) and _is_sensitive_url(item.value):
            raise _error("CPSEM010", path + ".source", node_id, "secret-bearing URLs are not allowed")
        if isinstance(item, ast.Call):
            for keyword_argument in item.keywords:
                if (
                    keyword_argument.arg
                    and _is_secret_key(keyword_argument.arg)
                    and not _is_empty_literal(keyword_argument.value)
                ):
                    raise _error("CPSEM010", path + ".source", node_id, "secret-bearing source is not allowed")


def _function_kwargs(
    lowering: FunctionLoweringInput,
    arguments: Sequence[_Argument],
    ports: Sequence[Any],
    path: str,
    node_id: str,
) -> Tuple[Tuple[Tuple[str, Any], ...], set, set, set]:
    node = lowering.node
    port_by_id = {port.id: port for port in ports}
    values = {}  # type: Dict[str, Any]
    data_parent_ids = set()
    inferred_parent_ids = set()
    data_sources = {}  # type: Dict[str, set]

    bindings = sorted(lowering.inbound_bindings, key=lambda item: item.id)
    for binding in bindings:
        kind = getattr(binding, "kind", None)
        target = getattr(binding, "target", None)
        if kind in ("data", "parameter", "artifact"):
            if getattr(target, "node_id", None) != node.id or getattr(target, "port_id", None) not in port_by_id:
                raise _error(
                    "CPSEM007",
                    "graph.bindings.{}".format(binding.id),
                    node_id,
                    "lowering input contains a binding outside this function node",
                )
            port = port_by_id[target.port_id]
            if port.name in values:
                raise _error(
                    "CPSEM004",
                    "graph.bindings.{}".format(binding.id),
                    node_id,
                    "function inputs accept one resolved binding",
                )
            if kind == "data":
                source_node_id, source_port_name = _data_source(lowering, binding, path, node_id)
                values[port.name] = "${{{}.{}}}".format(source_node_id[1], source_port_name)
                data_parent_ids.add(source_node_id[0])
                data_sources.setdefault(source_node_id[0], set()).add(getattr(binding.source, "port_id", ""))
            elif kind == "parameter":
                parameter_name = _parameter_name(lowering, binding, path, node_id)
                values[port.name] = "${{pipeline.{}}}".format(parameter_name)
            else:
                raise _error(
                    "CPSEM006",
                    "graph.bindings.{}".format(binding.id),
                    node_id,
                    "artifact bindings cannot provide function object inputs",
                )
        elif kind == "inferred":
            continue
        elif kind == "execution-only":
            continue
        else:
            raise _error(
                "CPSEM007",
                "graph.bindings.{}".format(getattr(binding, "id", "unknown")),
                node_id,
                "binding kind has no supported function lowering",
            )

    for binding in bindings:
        kind = getattr(binding, "kind", None)
        target = getattr(binding, "target", None)
        if kind == "inferred":
            if getattr(target, "node_id", None) != node.id:
                raise _error(
                    "CPSEM007",
                    "graph.bindings.{}".format(binding.id),
                    node_id,
                    "lowering input contains an inferred binding for another node",
                )
            source_id = getattr(getattr(binding, "source", None), "node_id", None)
            derived_from = getattr(binding, "derived_from", None)
            expected = data_sources.get(source_id)
            if (
                expected is None
                or getattr(derived_from, "node_id", None) != source_id
                or getattr(derived_from, "port_id", None) not in expected
            ):
                raise _error(
                    "CPSEM007",
                    "graph.bindings.{}".format(binding.id),
                    node_id,
                    "inferred dependency must correspond to a declared function data input",
                )
            inferred_parent_ids.add(source_id)
        elif kind == "execution-only":
            if getattr(target, "node_id", None) != node.id:
                raise _error(
                    "CPSEM007",
                    "graph.bindings.{}".format(binding.id),
                    node_id,
                    "lowering input contains an execution dependency for another node",
                )

    ordered = []
    for argument in arguments:
        port = next(port for port in ports if port.name == argument.name)
        if argument.name in values:
            value = values[argument.name]
        elif getattr(port, "has_default", False):
            value = _validate_json_value(port.default, path + ".ports.{}.default".format(port.id), node_id)
        elif getattr(port, "required", False):
            raise _error(
                "CPSEM004",
                path + ".ports.{}".format(port.id),
                node_id,
                "required function input has no binding or explicit default",
            )
        elif argument.default is not _UNSET:
            value = argument.default
        else:
            raise _error(
                "CPSEM004",
                path + ".ports.{}".format(port.id),
                node_id,
                "function input has no binding or explicit default",
            )
        _reject_value_secrets(value, path + ".ports.{}".format(port.id), node_id)
        ordered.append((argument.name, value))
    execution_parent_ids = {
        binding.source.node_id
        for binding in bindings
        if getattr(binding, "kind", None) == "execution-only"
        and getattr(getattr(binding, "source", None), "node_id", None) is not None
    }
    return tuple(ordered), data_parent_ids, inferred_parent_ids, execution_parent_ids


def _data_source(
    lowering: FunctionLoweringInput, binding: Any, path: str, node_id: str
) -> Tuple[Tuple[str, str], str]:
    source = getattr(binding, "source", None)
    source_node_id = getattr(source, "node_id", None)
    source_port_id = getattr(source, "port_id", None)
    source_node = next((item for item in lowering.graph.nodes if item.id == source_node_id), None)
    if source_node is None or getattr(source_node, "kind", None) != "function":
        raise _error(
            "CPSEM006",
            "graph.bindings.{}".format(binding.id),
            node_id,
            "data bindings into functions require a declared function output",
        )
    source_port = next((item for item in source_node.ports if item.id == source_port_id), None)
    if source_port is None or getattr(source_port, "direction", None) != "output":
        raise _error(
            "CPSEM006",
            "graph.bindings.{}".format(binding.id),
            node_id,
            "data binding references an unknown function output",
        )
    _require_generated_name(source_port.name, path + ".ports.{}.name".format(source_port.id), node_id, "CPSEM006")
    return (source_node.id, source_node.name), source_port.name


def _parameter_name(lowering: FunctionLoweringInput, binding: Any, path: str, node_id: str) -> str:
    parameter_id = getattr(getattr(binding, "source", None), "parameter_id", None)
    parameter = next((item for item in lowering.graph.parameters if item.id == parameter_id), None)
    if parameter is None:
        raise _error(
            "CPSEM007",
            "graph.bindings.{}".format(binding.id),
            node_id,
            "parameter binding references an unknown pipeline parameter",
        )
    _require_generated_name(parameter.name, path + ".parameters.{}.name".format(parameter.id), node_id, "CPSEM007")
    return parameter.name


def _canonical_parents(
    lowering: FunctionLoweringInput, required_parent_ids: set, path: str, node_id: str
) -> Tuple[str, ...]:
    nodes = {item.id: item for item in lowering.graph.nodes}
    requested = set(lowering.parent_node_ids)
    missing = required_parent_ids - requested
    if missing:
        raise _error(
            "CPSEM007",
            path + ".parents",
            node_id,
            "reference-derived dependencies must be included in canonical parents",
        )
    names = []
    for parent_id in sorted(requested):
        parent = nodes.get(parent_id)
        if parent is None or parent_id == node_id:
            raise _error("CPSEM007", path + ".parents", node_id, "parents must reference other graph nodes")
        names.append(parent.name)
    return tuple(names)


def _execution_queue(lowering: FunctionLoweringInput, path: str, node_id: str) -> Optional[str]:
    configuration = lowering.node.configuration
    resource_id = getattr(configuration, "queue_resource_id", None)
    if resource_id is None:
        resource_id = getattr(lowering.graph.settings, "default_execution_queue_id", None)
    if resource_id is None:
        raise _error("CPSEM008", path + ".configuration.queue_resource_id", node_id, "no effective step queue")
    resource = next((item for item in lowering.graph.resources if item.id == resource_id), None)
    if resource is None or getattr(resource, "kind", None) != "queue":
        raise _error(
            "CPSEM008",
            path + ".configuration.queue_resource_id",
            node_id,
            "effective queue must reference a queue resource",
        )
    if getattr(configuration, "queue_resource_id", None) is None:
        return None
    _reject_value_secrets(resource.resource_id, path + ".configuration.queue_resource_id", node_id)
    return resource.resource_id


def _optional_execution_settings(node: Any, path: str, node_id: str) -> Tuple[Tuple[str, ...], Optional[int]]:
    """Accept optional declarative CP-06 extensions without probing ClearML APIs."""

    configuration = node.configuration
    packages_value = getattr(configuration, "packages", ())
    if packages_value is None:
        packages_value = ()
    if isinstance(packages_value, str) or not isinstance(packages_value, (tuple, list)):
        raise _error(
            "CPSEM009",
            path + ".configuration.packages",
            node_id,
            "packages must be a list of declarative package strings",
        )
    packages = tuple(packages_value)
    for package in packages:
        if not isinstance(package, str) or not package:
            raise _error(
                "CPSEM009",
                path + ".configuration.packages",
                node_id,
                "packages must be non-empty declarative strings",
            )
        _reject_value_secrets(package, path + ".configuration.packages", node_id)
    retry_on_failure = getattr(configuration, "retry_on_failure", None)
    if retry_on_failure is not None and (type(retry_on_failure) is not int or retry_on_failure < 0):
        raise _error(
            "CPSEM009",
            path + ".configuration.retry_on_failure",
            node_id,
            "retry_on_failure must be a non-negative integer",
        )
    return packages, retry_on_failure


def _render_step(
    controller_name: str,
    node_name: str,
    function_kwargs: Sequence[Tuple[str, Any]],
    output_names: Sequence[str],
    task_type: str,
    execution_queue: Optional[str],
    cache: bool,
    packages: Sequence[str],
    retry_on_failure: Optional[int],
    parents: Sequence[str],
) -> str:
    lines = [
        "{}.add_function_step(".format(controller_name),
        "    name={},".format(_python_literal(node_name)),
        "    function={},".format(node_name),
        "    function_kwargs={},".format(_keyword_mapping_literal(function_kwargs)),
        "    function_return={},".format(_python_literal(list(output_names))),
        "    task_type=TaskTypes.{},".format(task_type),
    ]
    if execution_queue is not None:
        lines.append("    execution_queue={},".format(_python_literal(execution_queue)))
    if cache:
        lines.append("    cache_executed_step=True,")
    if packages:
        lines.append("    packages={},".format(_python_literal(list(packages))))
    if retry_on_failure is not None:
        lines.append("    retry_on_failure={},".format(retry_on_failure))
    if parents:
        lines.append("    parents={},".format(_python_literal(list(parents))))
    lines.append(")")
    return "\n".join(lines) + "\n"


def _keyword_mapping_literal(items: Sequence[Tuple[str, Any]]) -> str:
    return "{{{}}}".format(
        ", ".join("{}: {}".format(_python_literal(key), _python_literal(value)) for key, value in items)
    )


def _python_literal(value: Any) -> str:
    if value is None:
        return "None"
    if value is True:
        return "True"
    if value is False:
        return "False"
    if type(value) is int:
        return str(value)
    if type(value) is float:
        return repr(value)
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list):
        return "[{}]".format(", ".join(_python_literal(item) for item in value))
    if isinstance(value, Mapping):
        return "{{{}}}".format(
            ", ".join(
                "{}: {}".format(_python_literal(key), _python_literal(value[key]))
                for key in sorted(value)
            )
        )
    raise TypeError("expected JSON-safe function lowering value")


def _normalized_source(source: str) -> str:
    return source.replace("\r\n", "\n").replace("\r", "\n").strip("\n") + "\n"


def _require_generated_name(value: Any, path: str, node_id: str, code: str) -> None:
    if not isinstance(value, str) or not _GENERATED_NAME.match(value) or keyword.iskeyword(value):
        raise _error(code, path, node_id, "generated names must be safe Python identifiers")


def _reject_value_secrets(value: Any, path: str, node_id: str) -> None:
    _validate_json_value(value, path, node_id)
    if isinstance(value, str) and _is_sensitive_url(value):
        raise _error("CPSEM010", path, node_id, "secret-bearing URLs are not allowed")
    if isinstance(value, list):
        for item in value:
            _reject_value_secrets(item, path, node_id)
    elif isinstance(value, Mapping):
        for key, nested in value.items():
            if _is_secret_key(key):
                raise _error("CPSEM010", path, node_id, "secret-bearing defaults are not allowed")
            _reject_value_secrets(nested, path, node_id)


def _is_empty_literal(value: ast.AST) -> bool:
    return isinstance(value, ast.Constant) and value.value in (None, "")


def _is_secret_key(value: str) -> bool:
    compact = re.sub(r"[^a-z0-9]", "", value.lower())
    return compact in {
        "secret",
        "password",
        "passwd",
        "token",
        "apikey",
        "accesskey",
        "privatekey",
        "credential",
        "connectionstring",
    } or compact.endswith(("password", "apikey", "accesstoken"))


def _is_sensitive_url(value: str) -> bool:
    if not re.match(r"^https?://", value, re.IGNORECASE):
        return False
    parsed = urlsplit(value)
    if parsed.username or parsed.password:
        return True
    return any(
        _is_secret_key(unquote_plus(pair.partition("=")[0]))
        for pair in parsed.query.split("&")
        if pair
    )


def _error(code: str, path: str, node_id: str, message: str) -> FunctionGenerationError:
    return FunctionGenerationError(code=code, path=path, node_id=node_id, message=message)
