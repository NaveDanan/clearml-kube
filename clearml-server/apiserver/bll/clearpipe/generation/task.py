"""Task-node lowering for the ClearPipe ``PipelineController`` compiler."""

import re
from typing import Dict, List, Mapping, Tuple

from ..graph_v2 import (
    ArtifactBinding,
    DataBinding,
    ParameterBinding,
    PortEndpoint,
    ResourceEndpoint,
    TaskIdReference,
    TaskNameReference,
)
from .compiler import GenerationDiagnostic, GenerationError, LoweredNode, _format_call, _unicode_key
from .contracts import TaskLoweringInput


_TASK_PARAMETER_KEY = re.compile(r"^[^/\r\n]+/[^/\r\n]+$")
_TASK_REFERENCE = re.compile(
    r"^(?:"
    r"artifacts\.[A-Za-z0-9_.-]+\.url"
    r"|models\.output\.-?[0-9]+\.url"
    r"|id"
    r"|parameters\.[^/\r\n]+/[^/\r\n]+"
    r")$"
)


def lower_task(input_value: TaskLoweringInput) -> LoweredNode:
    """Lower one canonical task node without inspecting or executing its task."""

    node = input_value.node
    diagnostics = []
    resource_by_id = {resource.id: resource for resource in input_value.graph.resources}
    node_by_id = {graph_node.id: graph_node for graph_node in input_value.graph.nodes}
    parameter_by_id = {parameter.id: parameter for parameter in input_value.graph.parameters}
    input_ports = sorted(
        (port for port in node.ports if port.direction == "input"),
        key=lambda port: (port.order, _unicode_key(port.id)),
    )
    bindings_by_port = {}  # type: Dict[str, List[object]]
    for binding in input_value.inbound_bindings:
        if isinstance(binding, (DataBinding, ArtifactBinding, ParameterBinding)):
            bindings_by_port.setdefault(binding.target.port_id, []).append(binding)

    overrides = {}
    for port in input_ports:
        path = "graph.nodes[{}].ports[{}]".format(node.id, port.id)
        if not _TASK_PARAMETER_KEY.fullmatch(port.name):
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM007",
                    path + ".name",
                    "task input ports must name a sectioned task parameter",
                    port.id,
                )
            )
            continue
        selected = bindings_by_port.get(port.id, [])
        if len(selected) > 1:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM007",
                    path,
                    "a task parameter can have only one generated binding",
                    port.id,
                )
            )
            continue
        if selected:
            override = _binding_override(
                selected[0],
                node_by_id=node_by_id,
                resource_by_id=resource_by_id,
                parameter_by_id=parameter_by_id,
            )
            if isinstance(override, GenerationDiagnostic):
                diagnostics.append(override)
                continue
            overrides[port.name] = override
        elif port.has_default:
            overrides[port.name] = port.default
        elif port.required:
            diagnostics.append(
                GenerationDiagnostic(
                    "CPSEM004",
                    path,
                    "required task input has no binding or declared default",
                    port.id,
                )
            )

    if diagnostics:
        raise GenerationError(diagnostics)

    kwargs = [("name", node.name)]  # type: List[Tuple[str, object]]
    parent_names = [node_by_id[parent_id].name for parent_id in input_value.parent_node_ids]
    if parent_names:
        kwargs.append(("parents", parent_names))
    if isinstance(node.base_task, TaskIdReference):
        kwargs.append(("base_task_id", node.base_task.task_id))
    elif isinstance(node.base_task, TaskNameReference):
        kwargs.extend(
            (
                ("base_task_project", node.base_task.project),
                ("base_task_name", node.base_task.name),
            )
        )
    else:
        raise GenerationError(
            (
                GenerationDiagnostic(
                    "CPSEM002",
                    "graph.nodes[{}].base_task".format(node.id),
                    "task node needs a base task ID or project/name identity",
                    node.id,
                ),
            )
        )
    if overrides:
        kwargs.append(("parameter_override", overrides))
    if node.configuration.queue_resource_id is not None:
        kwargs.append(("execution_queue", resource_by_id[node.configuration.queue_resource_id].resource_id))
    if not node.configuration.clone_base_task:
        kwargs.append(("clone_base_task", False))
    if node.configuration.cache:
        kwargs.append(("cache_executed_step", True))
    retry_on_failure = _retry_on_failure(node.configuration, node.id)
    if isinstance(retry_on_failure, GenerationDiagnostic):
        raise GenerationError((retry_on_failure,))
    if retry_on_failure is not None:
        kwargs.append(("retry_on_failure", retry_on_failure))

    return LoweredNode(
        statement_lines=_format_call("pipe.add_step", kwargs),
        graph_element_ids=(node.id,),
    )


def _binding_override(
    binding: object,
    node_by_id: Mapping[str, object],
    resource_by_id: Mapping[str, object],
    parameter_by_id: Mapping[str, object],
):
    path = "graph.bindings[{}]".format(binding.id)
    if isinstance(binding, ParameterBinding):
        parameter = parameter_by_id.get(binding.source.parameter_id)
        if parameter is None:
            return GenerationDiagnostic(
                "CPSEM007",
                path + ".source",
                "parameter binding references an unknown pipeline parameter",
                binding.id,
            )
        return "${{pipeline.{}}}".format(parameter.name)
    if isinstance(binding, DataBinding):
        return GenerationDiagnostic(
            "CPSEM006",
            path,
            "data bindings cannot lower into task-backed parameter overrides",
            binding.id,
        )
    if isinstance(binding, ArtifactBinding):
        if isinstance(binding.source, ResourceEndpoint):
            resource = resource_by_id.get(binding.source.resource_id)
            if resource is None or resource.kind == "queue":
                return GenerationDiagnostic(
                    "CPSEM007",
                    path + ".source",
                    "artifact binding must reference a supported non-queue resource",
                    binding.id,
                )
            return resource.resource_id
        if isinstance(binding.source, PortEndpoint):
            source_node = node_by_id.get(binding.source.node_id)
            if source_node is None or getattr(source_node, "kind", None) != "task":
                return GenerationDiagnostic(
                    "CPSEM007",
                    path + ".source",
                    "task artifact references must originate from a task output port",
                    binding.id,
                )
            source_port = next(
                (port for port in source_node.ports if port.id == binding.source.port_id),
                None,
            )
            if source_port is None or source_port.direction != "output" or not _TASK_REFERENCE.fullmatch(source_port.name):
                return GenerationDiagnostic(
                    "CPSEM007",
                    path + ".source",
                    "task artifact reference uses unsupported ClearML reference syntax",
                    binding.id,
                )
            return "${{{}.{}}}".format(source_node.name, source_port.name)
    return GenerationDiagnostic("CPSEM007", path, "binding cannot lower into a task parameter", binding.id)


def _retry_on_failure(configuration: object, node_id: str):
    """Allow only an explicit integer retry extension; never lower callbacks."""

    retry_on_failure = getattr(configuration, "retry_on_failure", None)
    if retry_on_failure is None:
        return None
    if type(retry_on_failure) is not int or retry_on_failure < 0:
        return GenerationDiagnostic(
            "CPSEM009",
            "graph.nodes[{}].configuration.retry_on_failure".format(node_id),
            "task retry must be a non-negative integer, not a callback",
            node_id,
        )
    return retry_on_failure
