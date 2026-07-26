"""Flow-editor node dispatch for ClearPipe generation.

The web flow editor lowers every authored node to an identical no-op function
node and embeds the real node type + config in a ``# clearpipe-flow-node:``
source comment (see ``clearpipe-flow-codec.ts``).  The generic function lowerer
in :mod:`function` ignores that metadata, so authored nodes that carry runtime
semantics (currently the Report output node) need a dispatcher that reads the
metadata and emits a real implementation.

Nodes without recognised metadata fall through to :func:`lower_function_node`
unchanged, so existing function graphs keep byte-identical generated output.
"""

import json
from dataclasses import replace
from typing import Optional

from .contracts import FunctionLoweringInput
from .function import (
    FunctionStepLowering,
    _canonical_parents,
    _execution_queue,
    _optional_execution_settings,
    _python_literal,
    _reject_value_secrets,
    _error,
    _render_step,
    lower_function_node,
)


FLOW_NODE_META_TAG = "# clearpipe-flow-node:"


def flow_node_meta(node: object) -> Optional[dict]:
    """Return the embedded flow-node metadata dict, or ``None`` when absent."""

    source = getattr(node, "source", None)
    if not isinstance(source, str):
        return None
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith(FLOW_NODE_META_TAG):
            payload = stripped[len(FLOW_NODE_META_TAG):].strip()
            try:
                meta = json.loads(payload)
            except (ValueError, TypeError):
                return None
            return meta if isinstance(meta, dict) else None
    return None


def lower_flow_function_node(lowering: FunctionLoweringInput) -> FunctionStepLowering:
    """Dispatch a flow-authored function node to its specialized lowerer.

    Recognised flow node types are lowered into a real implementation; every
    other node (including graphs authored outside the flow editor) is lowered by
    the standard :func:`lower_function_node`.
    """

    meta = flow_node_meta(lowering.node)
    if meta and meta.get("type") == "scheduled":
        return _lower_scheduled_node(lowering)
    if meta and meta.get("type") == "autoscaler":
        return _lower_autoscaler_node(lowering, meta)
    if meta and meta.get("type") == "dataset":
        return _lower_dataset_node(lowering, meta)
    if meta and meta.get("type") == "task":
        return _lower_task_node(lowering, meta)
    if meta and meta.get("type") == "report":
        return _lower_report_node(lowering, meta)
    return lower_function_node(lowering)


# --------------------------------------------------------------------------- #
# Scheduled node -> lightweight runtime acknowledgement.
# --------------------------------------------------------------------------- #


def _lower_scheduled_node(
    lowering: FunctionLoweringInput,
) -> FunctionStepLowering:
    """Lower the scheduler marker without uploading a pickled ``None``.

    The external ClearPipe scheduler is the actual initiator.  The graph node
    remains as a visible execution acknowledgement, but returning a primitive
    stores it as a task parameter.  Returning ``None`` makes the generated
    ClearML function wrapper upload a pickle artifact and can leave Windows
    agents waiting indefinitely during artifact finalization.
    """

    base = lower_function_node(lowering)
    name = lowering.node.name
    definition_source = (
        "def {}() -> object:\n"
        "    return True\n"
    ).format(name)
    source = "{}\n{}".format(definition_source, base.step_source)
    return replace(
        base,
        definition_source=definition_source,
        source=source,
    )


# --------------------------------------------------------------------------- #
# AutoScaler node -> the same autoscaler.submit_workload contract as the UI.
# --------------------------------------------------------------------------- #


_AUTOSCALER_WORKLOAD_FIELDS = (
    "project",
    "image",
    "command",
    "args",
    "environment_variables",
    "template",
    "compute",
    "environment",
    "data_sources",
    "cpu_core_request",
    "cpu_core_limit",
    "cpu_memory_request",
    "cpu_memory_limit",
    "gpu_devices_request",
    "gpu_memory_request",
    "gpu_portion_request",
    "gpu_request_type",
    "node_pools",
    "node_type",
    "priority",
    "preemptibility",
    "run_as_uid",
    "run_as_gid",
    "supplemental_groups",
    "existing_pvc",
    "working_dir",
    "large_shm",
    "parallelism",
    "runs",
    "restart_policy",
    "backoff_limit",
    "external_url",
    "serving_port",
    "min_replicas",
    "max_replicas",
    "initial_replicas",
    "metric",
    "metric_threshold",
    "scale_to_zero_retention",
)


def _autoscaler_workload(
    config: dict, node_name: str, path: str, node_id: str
) -> dict:
    """Normalize flow metadata to the public Submit Workload payload.

    ``queue`` is deliberately excluded.  It used to be shown by the canvas but
    Run:ai owns the spawned agent's queue assignment.  Including it here could
    also deadlock the bootstrap step by placing the submitter on the queue that
    the submitter itself is expected to create.
    """

    workload_type = config.get("workload_type") or config.get("workloadType") or "training"
    if workload_type not in ("training", "workspace", "inference"):
        raise _error(
            "CPSEM004",
            path + ".flow.workload_type",
            node_id,
            "autoscaler workload type must be training, workspace, or inference",
        )
    workload_name = config.get("workloadName") or config.get("workload_name") or node_name
    if not isinstance(workload_name, str) or not workload_name.strip():
        raise _error(
            "CPSEM004",
            path + ".flow.workloadName",
            node_id,
            "autoscaler workload name is required",
        )

    payload = {
        "workload_type": workload_type,
        "workload_name": workload_name.strip(),
    }
    for field in _AUTOSCALER_WORKLOAD_FIELDS:
        value = config.get(field)
        if field == "data_sources" and isinstance(value, list):
            value = ",".join(str(item).strip() for item in value if str(item).strip())
        if field == "large_shm":
            if value is True:
                payload[field] = True
            continue
        if value not in (None, ""):
            payload[field] = value

    if not payload.get("command"):
        payload["command"] = "clearml-agent daemon"
    if not payload.get("image") and not payload.get("environment"):
        raise _error(
            "CPSEM004",
            path + ".flow.image",
            node_id,
            "autoscaler requires a container image or Run:ai environment",
        )
    _reject_value_secrets(payload, path + ".flow.workload", node_id)
    return payload


def _render_autoscaler_function(
    name: str,
    action: str,
    request_payload: dict,
    timeout_seconds: int,
) -> str:
    """Render an authenticated, worker-backed autoscaler API operation.

    The function step stays running while ``runai_worker`` processes the queued
    execution, so ordinary ClearML node status/failure propagation applies.
    Successful submission means Run:ai accepted the workload; the following
    Task can already be queued on the platform-managed ``runai`` queue and will
    wait for the spawned agent to register.
    """

    workload = request_payload.get("workload")
    operation_payload = workload if isinstance(workload, dict) else request_payload
    workload_name = operation_payload.get("workload_name", "")
    project = operation_payload.get("project", "")
    return (
        "def {name}() -> object:\n"
        "    import time\n"
        "    from clearml import Task\n"
        "    session = Task._get_default_session()\n"
        "    request_payload = {request_payload}\n"
        "    response = session.send_request(\n"
        "        service=\"autoscaler\",\n"
        "        action={action},\n"
        "        version=\"2.35\",\n"
        "        method=\"post\",\n"
        "        json=request_payload,\n"
        "    )\n"
        "    if not response.ok:\n"
        "        raise RuntimeError(\"AutoScaler request failed: {{}}\".format(response.text))\n"
        "    data = (response.json() or {{}}).get(\"data\") or {{}}\n"
        "    if str(data.get(\"status\") or \"\").lower() == \"error\":\n"
        "        raise RuntimeError(data.get(\"stderr\") or \"AutoScaler request failed\")\n"
        "    execution_id = data.get(\"execution_id\")\n"
        "    if not execution_id:\n"
        "        raise RuntimeError(\"AutoScaler request did not return an execution id\")\n"
        "    deadline = time.time() + {timeout_seconds}\n"
        "    while True:\n"
        "        execution_response = session.send_request(\n"
        "            service=\"autoscaler\",\n"
        "            action=\"get_execution\",\n"
        "            version=\"2.35\",\n"
        "            method=\"post\",\n"
        "            json={{\"execution_id\": execution_id}},\n"
        "        )\n"
        "        if not execution_response.ok:\n"
        "            raise RuntimeError(\"AutoScaler status request failed: {{}}\".format(execution_response.text))\n"
        "        execution = (execution_response.json() or {{}}).get(\"data\") or {{}}\n"
        "        status = str(execution.get(\"status\") or \"\").lower()\n"
        "        if status == \"success\":\n"
        "            result = dict(execution)\n"
        "            result.update({{\"execution_id\": execution_id, \"workload_name\": {workload_name}, \"project\": {project}}})\n"
        "            return result\n"
        "        if status == \"error\":\n"
        "            raise RuntimeError(execution.get(\"stderr\") or \"AutoScaler execution failed\")\n"
        "        if time.time() >= deadline:\n"
        "            raise RuntimeError(\"AutoScaler execution timed out\")\n"
        "        time.sleep(3)\n"
    ).format(
        name=name,
        action=_python_literal(action),
        request_payload=_python_literal(request_payload),
        timeout_seconds=timeout_seconds,
        workload_name=_python_literal(workload_name),
        project=_python_literal(project),
    )


def _lower_autoscaler_node(
    lowering: FunctionLoweringInput, meta: dict
) -> FunctionStepLowering:
    """Lower a canvas AutoScaler into a real worker-backed Run:ai operation."""

    base = lower_function_node(lowering)
    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}
    mode = config.get("mode") or "spinup"
    timeout_value = config.get("autoscalerTimeoutSeconds", 600)
    try:
        timeout_seconds = int(timeout_value)
    except (TypeError, ValueError):
        timeout_seconds = 0
    if timeout_seconds < 1 or timeout_seconds > 3600:
        raise _error(
            "CPSEM004",
            path + ".flow.autoscalerTimeoutSeconds",
            node_id,
            "autoscaler timeout must be between 1 and 3600 seconds",
        )

    if mode == "spinup":
        action = "submit_workload"
        request_payload = {
            "workload": _autoscaler_workload(config, node.name, path, node_id)
        }
    elif mode == "spindown":
        workload_name = (
            config.get("spinDownWorkloadName")
            or config.get("workloadName")
            or node.name
        )
        action = (
            "delete_workload"
            if config.get("spinDownAction") == "delete"
            else "stop_workload"
        )
        request_payload = {
            "workload_name": str(workload_name),
            "workload_type": str(config.get("workload_type") or "training"),
            "project": str(config.get("project") or ""),
        }
        _reject_value_secrets(
            request_payload, path + ".flow.spindown", node_id
        )
    else:
        raise _error(
            "CPSEM004",
            path + ".flow.mode",
            node_id,
            "autoscaler mode must be spinup or spindown",
        )

    definition_source = _render_autoscaler_function(
        node.name, action, request_payload, timeout_seconds
    )
    source = "{}\n{}".format(definition_source, base.step_source)
    return replace(
        base,
        definition_source=definition_source,
        source=source,
    )


# --------------------------------------------------------------------------- #
# Task node -> real PipelineController.add_step (clone the selected base task).
# --------------------------------------------------------------------------- #


def _resolve_base_task_id(config: dict) -> Optional[str]:
    """Return the single base task id for a Task node.

    Prefers the graph-aware ``baseTaskId``; falls back to a one-item legacy
    ``taskIds`` array so pre-migration graphs keep lowering to a real step.
    Multi-item legacy arrays are ambiguous and are NOT resolved here (the web
    migration blocks them with a "Split into Task nodes" action).
    """

    base = config.get("baseTaskId")
    if isinstance(base, str) and base.strip():
        return base.strip()
    legacy = config.get("taskIds")
    if isinstance(legacy, list):
        ids = [str(item).strip() for item in legacy if isinstance(item, str) and item.strip()]
        if len(ids) == 1:
            return ids[0]
    return None


def _render_task_step(
    node_name: str,
    base_task_id: str,
    execution_queue: Optional[str],
    parents,
    parameter_overrides: Optional[dict] = None,
) -> str:
    """Render ``pipe.add_step(...)`` cloning the base task on its queue."""

    lines = [
        "pipe.add_step(",
        "    name={},".format(_python_literal(node_name)),
        "    base_task_id={},".format(_python_literal(base_task_id)),
    ]
    if parameter_overrides:
        lines.append(
            "    parameter_override={},".format(
                _python_literal(parameter_overrides)
            )
        )
    if execution_queue is not None:
        lines.append("    execution_queue={},".format(_python_literal(execution_queue)))
    if parents:
        lines.append("    parents={},".format(_python_literal(list(parents))))
    lines.append(")")
    return "\n".join(lines) + "\n"


def _flow_execution_queue(
    lowering: FunctionLoweringInput, config: dict, path: str, node_id: str
) -> Optional[str]:
    """Resolve a flow node's explicit queue before the graph-wide default.

    The compact flow editor stores queue ids in its embedded node metadata. Its
    graph-v2 adapter can expose only one graph-wide queue resource, so relying
    exclusively on ``configuration.queue_resource_id`` silently routes every
    flow node to the same queue. Runtime-bearing Dataset and Task nodes must
    preserve their own authored queue.
    """

    queue = config.get("queue")
    if not isinstance(queue, str) or not queue.strip():
        queue = config.get("createQueue")
    if isinstance(queue, str) and queue.strip():
        queue = queue.strip()
        _reject_value_secrets(queue, path + ".flow.queue", node_id)
        return queue
    return _execution_queue(lowering, path, node_id)


def _parameter_overrides(config: dict, path: str, node_id: str) -> dict:
    """Return safe ClearML ``section/name`` overrides from flow metadata."""

    raw = config.get("parameterOverrides")
    if raw is None:
        raw = config.get("parameters")
    if not isinstance(raw, dict):
        return {}
    result = {}
    for key in sorted(raw):
        if not isinstance(key, str) or not key.strip():
            continue
        value = raw[key]
        _reject_value_secrets(key, path + ".flow.parameterOverrides", node_id)
        _reject_value_secrets(value, path + ".flow.parameterOverrides", node_id)
        result[key.strip()] = value
    return result


def _resolve_dataset_task_id(config: dict) -> Optional[str]:
    """Return the task a Dataset node clones to perform its runtime sync."""

    for key in ("syncTaskId", "baseTaskId", "taskId"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _lower_dataset_node(
    lowering: FunctionLoweringInput, meta: dict
) -> FunctionStepLowering:
    """Lower a Dataset flow node to the selected DataOps sync task.

    Dataset synchronization needs the filesystem and credentials of a real
    ClearML agent. Cloning a predefined sync task also makes the resulting
    dataset version observable in the pipeline instead of executing a server
    process with no access to the source directory.
    """

    base = lower_function_node(lowering)
    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}
    base_task_id = _resolve_dataset_task_id(config)
    if not base_task_id:
        return base

    execution_queue = _flow_execution_queue(
        lowering, config, path, node_id
    )
    parents = _canonical_parents(lowering, set(), path, node_id)
    step_source = _render_task_step(
        node.name,
        base_task_id,
        execution_queue,
        parents,
        _parameter_overrides(config, path, node_id),
    )
    return replace(
        base,
        definition_source="",
        step_source=step_source,
        source=step_source,
    )


def _lower_task_node(
    lowering: FunctionLoweringInput, meta: dict
) -> FunctionStepLowering:
    """Lower a Task flow node into a real cloned-base-task pipeline step.

    A configured Task node lowers to ``PipelineController.add_step`` cloning its
    single ``baseTaskId`` on its execution queue. An unconfigured Task node (no
    base task) preserves the backward-compatible no-op function step.
    """

    base = lower_function_node(lowering)
    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}

    base_task_id = _resolve_base_task_id(config)
    if not base_task_id:
        # No base task selected yet -> keep the generic no-op step.
        return base

    execution_queue = _flow_execution_queue(lowering, config, path, node_id)
    parents = _canonical_parents(lowering, set(), path, node_id)
    step_source = _render_task_step(
        node.name,
        base_task_id,
        execution_queue,
        parents,
        _parameter_overrides(config, path, node_id),
    )
    return replace(
        base,
        definition_source="",
        step_source=step_source,
        source=step_source,
    )


def _sanitize_mappings(raw: object) -> dict:
    """Return a JSON-safe {slotKey: {taskId,kind,ref,metric?,variant?}} dict.

    The web config panel stores template-fill mappings as an object keyed by
    template slot (``text:<TOKEN>`` / ``media:<iframe-name>``). We keep only the
    recognised primitive fields so the value serializes cleanly into the
    generated function source.
    """

    if not isinstance(raw, dict):
        return {}
    result = {}
    for slot_key, mapping in raw.items():
        if not isinstance(slot_key, str) or not isinstance(mapping, dict):
            continue
        clean = {}
        for field in ("taskId", "kind", "ref", "metric", "variant"):
            value = mapping.get(field)
            if isinstance(value, (str, int, float)) or value is None:
                clean[field] = value
        if clean.get("taskId") and clean.get("ref"):
            result[slot_key] = clean
    return result


def _report_title(config: dict, node: object) -> str:
    for key in ("title", "name", "label"):
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    name = getattr(node, "label", None) or getattr(node, "name", None) or "ClearPipe report"
    return str(name)


def _lower_report_node(
    lowering: FunctionLoweringInput, meta: dict
) -> FunctionStepLowering:
    """Lower a Report flow node into a step that creates a real ClearML Report.

    The generated step builds Markdown from the optional template report and the
    configured artifact sources, then calls ``reports.create`` + ``reports.update``
    so the result appears in the ClearML Reports section. No pickled return
    artifact is produced (``function_return`` is empty).
    """

    # Validate node name/queue/ports/source shape and surface the standard
    # diagnostics, then replace the no-op body with the real implementation.
    base = lower_function_node(lowering)

    node = lowering.node
    node_id = getattr(node, "id", "")
    path = "graph.nodes.{}".format(node_id or "unknown")
    config = meta.get("config") if isinstance(meta.get("config"), dict) else {}

    title = _report_title(config, node)
    template_report_id = config.get("templateReportId")
    if not isinstance(template_report_id, str):
        template_report_id = ""

    report_mappings = _sanitize_report_mappings(config.get("reportMappings"))
    sources = _report_source_params(lowering)

    if report_mappings or sources:
        _validate_report_contract(config, report_mappings, sources, path, node_id)
        # Graph-aware path: bind to upstream Task nodes and substitute their
        # runtime cloned task ids via ${step_name.id} kwargs.
        template_fingerprint = config.get("templateFingerprint")
        if not isinstance(template_fingerprint, str):
            template_fingerprint = ""
        function_kwargs = tuple(
            (param, "${" + step + ".id}") for (_nid, step, param) in sources
        )
        definition_source = _render_report_function_v2(
            node.name,
            title,
            template_report_id,
            template_fingerprint,
            report_mappings,
            sources,
        )
    else:
        # Legacy path: fixed taskId-keyed mappings + artifact sources.
        artifact_sources = [
            str(item)
            for item in (config.get("artifactSources") or [])
            if isinstance(item, (str, int, float))
        ]
        mappings = _sanitize_mappings(config.get("mappings"))
        function_kwargs = ()
        definition_source = _render_report_function(
            node.name, title, template_report_id, artifact_sources, mappings
        )

    execution_queue = _execution_queue(lowering, path, node_id)
    parents = _canonical_parents(lowering, set(), path, node_id)
    packages, retry_on_failure = _optional_execution_settings(node, path, node_id)
    task_type = getattr(getattr(node, "configuration", None), "task_type", "application")

    step_source = _render_step(
        controller_name="pipe",
        node_name=node.name,
        function_kwargs=function_kwargs,
        output_names=(),
        task_type=task_type,
        execution_queue=execution_queue,
        cache=False,
        packages=packages,
        retry_on_failure=retry_on_failure,
        parents=parents,
    )

    source = "{}\n{}".format(definition_source, step_source)
    return replace(
        base,
        definition_source=definition_source,
        step_source=step_source,
        source=source,
    )


_REPORT_OUTPUT_KINDS = frozenset(
    (
        "field",
        "hyperparam",
        "scalar",
        "scalar_graph",
        "plot",
        "image",
        "artifact",
    )
)


def _sanitize_report_mappings(raw: object) -> list:
    """Return a JSON-safe list of graph-aware Report slot mappings.

    Each entry keeps only recognised primitive fields and a source that is
    either a pipeline ``sourceNodeId`` or an advanced fixed ``externalTaskId``.
    Runtime task ids are never present here; the graph binds to a source node.
    """

    if not isinstance(raw, list):
        return []
    result = []
    for mapping in raw:
        if not isinstance(mapping, dict):
            continue
        slot_key = mapping.get("slotKey")
        if not isinstance(slot_key, str) or not slot_key:
            continue
        kind = mapping.get("outputKind")
        if kind not in _REPORT_OUTPUT_KINDS:
            continue
        raw_source = mapping.get("source") if isinstance(mapping.get("source"), dict) else {}
        source = {}
        node_ref = raw_source.get("sourceNodeId")
        external_ref = raw_source.get("externalTaskId")
        if isinstance(node_ref, str) and node_ref:
            source["sourceNodeId"] = node_ref
        elif isinstance(external_ref, str) and external_ref:
            source["externalTaskId"] = external_ref
        raw_selector = mapping.get("selector") if isinstance(mapping.get("selector"), dict) else {}
        selector = {}
        for field in (
            "metric",
            "variant",
            "artifactKey",
            "field",
            "section",
            "parameter",
        ):
            value = raw_selector.get(field)
            if isinstance(value, str) and value:
                selector[field] = value
        clean = {
            "slotKey": slot_key,
            "source": source,
            "outputKind": kind,
            "selector": selector,
            "required": bool(mapping.get("required", True)),
            "confirmed": bool(mapping.get("confirmed", False)),
        }
        if mapping.get("ignored"):
            clean["ignored"] = True
        result.append(clean)
    return result


def _validate_report_contract(
    config: dict,
    mappings: list,
    sources: list,
    path: str,
    node_id: str,
) -> None:
    """Enforce the persisted Report slot contract during server lowering.

    Older definitions without a slot manifest remain loadable. Once the editor
    has persisted ``templateSlots``, however, save/run compilation applies the
    same structural rules as the mapping workspace: every live slot must be
    mapped (or explicitly ignored as optional), confirmed, and bound to either
    a directly connected Task node or an explicit external Task.
    """

    raw_slots = config.get("templateSlots")
    slots = raw_slots if isinstance(raw_slots, list) else []
    if not slots:
        return
    if not isinstance(config.get("templateFingerprint"), str) or not config.get(
        "templateFingerprint"
    ):
        raise _error(
            "CPSEM004",
            path + ".flow.config.templateFingerprint",
            node_id,
            "report template slots require a persisted template fingerprint",
        )

    by_key = {
        mapping.get("slotKey"): mapping
        for mapping in mappings
        if isinstance(mapping.get("slotKey"), str)
    }
    connected = {source_node_id for source_node_id, _step, _param in sources}
    for index, slot in enumerate(slots):
        if not isinstance(slot, dict):
            raise _error(
                "CPSEM004",
                "{}.flow.config.templateSlots[{}]".format(path, index),
                node_id,
                "report template slots must be objects",
            )
        slot_key = slot.get("key")
        if not isinstance(slot_key, str) or not slot_key:
            raise _error(
                "CPSEM004",
                "{}.flow.config.templateSlots[{}].key".format(path, index),
                node_id,
                "report template slots require stable keys",
            )
        mapping = by_key.get(slot_key)
        if not mapping:
            raise _error(
                "CPSEM004",
                path + ".flow.config.reportMappings",
                node_id,
                "required report template slot is unmapped",
            )
        if mapping.get("ignored"):
            if mapping.get("required"):
                raise _error(
                    "CPSEM004",
                    path + ".flow.config.reportMappings",
                    node_id,
                    "a required report template slot cannot be ignored",
                )
            continue
        if not mapping.get("confirmed"):
            raise _error(
                "CPSEM004",
                path + ".flow.config.reportMappings",
                node_id,
                "report template slot mapping must be confirmed",
            )
        source = mapping.get("source") or {}
        source_node_id = source.get("sourceNodeId")
        external_task_id = source.get("externalTaskId")
        if source_node_id:
            if source_node_id not in connected:
                raise _error(
                    "CPSEM007",
                    path + ".flow.config.reportMappings",
                    node_id,
                    "report template slot must bind to a directly connected Task node",
                )
        elif not external_task_id:
            raise _error(
                "CPSEM004",
                path + ".flow.config.reportMappings",
                node_id,
                "report template slot mapping requires a source",
            )


def _report_source_params(lowering: FunctionLoweringInput) -> list:
    """Return ordered (source_node_id, step_name, param_name) for connected Task nodes.

    Only directly connected pipeline Task nodes are report sources; each gets a
    stable ``s<index>`` runtime-argument name whose value is ``${step_name.id}``.
    """

    nodes = {getattr(item, "id", None): item for item in lowering.graph.nodes}
    sources = []
    index = 0
    for parent_id in lowering.parent_node_ids:
        parent = nodes.get(parent_id)
        if parent is None:
            continue
        parent_meta = flow_node_meta(parent)
        if parent_meta and parent_meta.get("type") == "task":
            sources.append((parent_id, parent.name, "s{}".format(index)))
            index += 1
    return sources


def _render_report_function(
    name: str, title: str, template_report_id: str, artifact_sources: list, mappings: dict = None
) -> str:
    """Render the module-level report-building function for a Report node."""

    title_literal = _python_literal(title)
    template_literal = _python_literal(template_report_id)
    sources_literal = _python_literal(list(artifact_sources))
    mappings_literal = _python_literal(mappings or {})

    lines = [
        "def {}() -> object:".format(name),
        "    import json",
        "    import re",
        "    from clearml import Task",
        "",
        "    task = Task.current_task()",
        "    session = Task._get_default_session()",
        "",
        "    _secret_re = re.compile(",
        "        r\"(?i)(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\"",
        "        r\"(\\s*[:=]\\s*)(\\S+)\"",
        "    )",
        "    _aws_re = re.compile(r\"AKIA[0-9A-Z]{16}\")",
        "    _bearer_re = re.compile(r\"(?i)(bearer\\s+)[A-Za-z0-9._-]{12,}\")",
        "    def _redact(text):",
        "        text = str(text)",
        "        text = _secret_re.sub(lambda m: m.group(1) + m.group(2) + '***REDACTED***', text)",
        "        text = _aws_re.sub('***REDACTED***', text)",
        "        text = _bearer_re.sub(lambda m: m.group(1) + '***REDACTED***', text)",
        "        return text",
        "",
        "    title = {}".format(title_literal),
        "    template_report_id = {}".format(template_literal),
        "    artifact_sources = {}".format(sources_literal),
        "",
        "    sections = []",
        "    if template_report_id:",
        "        try:",
        "            response = session.send_request(",
        "                'reports', 'get_all_ex', method='post',",
        "                json={'id': [template_report_id], 'only_fields': ['report']},",
        "            )",
        "            template_tasks = (response.json().get('data') or {}).get('tasks') or []",
        "            base_markdown = (template_tasks[0].get('report') if template_tasks else '') or ''",
        "            if base_markdown:",
        "                sections.append(base_markdown)",
        "        except Exception as error:",
        "            sections.append('<!-- template report unavailable: ' + _redact(str(error)) + ' -->')",
        "",
        "    sections.append('# ' + title)",
        "",
        "    for raw_source in artifact_sources:",
        "        source = str(raw_source)",
        "        rendered = None",
        "        if '.' in source:",
        "            source_task_id, _, artifact_name = source.partition('.')",
        "            try:",
        "                other = Task.get_task(task_id=source_task_id)",
        "                artifact = (other.artifacts or {}).get(artifact_name)",
        "                if artifact is not None:",
        "                    preview = getattr(artifact, 'preview', None)",
        "                    url = getattr(artifact, 'url', None)",
        "                    rendered = '## ' + artifact_name + '\\n\\n'",
        "                    if preview:",
        "                        rendered += '```\\n' + _redact(str(preview)[:4000]) + '\\n```'",
        "                    elif url:",
        "                        rendered += '[' + artifact_name + '](' + _redact(str(url)) + ')'",
        "                    else:",
        "                        rendered += '_(artifact has no preview)_'",
        "            except Exception as error:",
        "                rendered = '## ' + source + '\\n\\n_(unavailable: ' + _redact(str(error)) + ')_'",
        "        if rendered is None:",
        "            rendered = '- ' + source",
        "        sections.append(rendered)",
        "",
        "    content = '\\n\\n'.join(part for part in sections if part)",
        "",
        "    mappings = {}".format(mappings_literal),
        "    def _task_lookup(ids):",
        "        ids = [i for i in ids if i]",
        "        if not ids:",
        "            return {}",
        "        try:",
        "            resp = session.send_request(",
        "                'tasks', 'get_all_ex', method='post',",
        "                json={'id': ids, 'page': 0, 'page_size': 100,",
        "                      'only_fields': ['id', 'name', 'status', 'company',",
        "                                      'project.name', 'started', 'completed',",
        "                                      'last_iteration', 'last_metrics',",
        "                                      'hyperparams', 'execution.artifacts']},",
        "            )",
        "            found = (resp.json().get('data') or {}).get('tasks') or []",
        "        except Exception:",
        "            found = []",
        "        return {t.get('id'): t for t in found if t.get('id')}",
        "    def _resolve_text(mp, td):",
        "        if not td:",
        "            return ''",
        "        kind = mp.get('kind')",
        "        ref = mp.get('ref') or ''",
        "        if kind == 'field':",
        "            if ref == 'project':",
        "                proj = td.get('project') or {}",
        "                return str((proj.get('name') if isinstance(proj, dict) else proj) or '')",
        "            if ref == 'iteration':",
        "                return str(td.get('last_iteration') or '')",
        "            return str(td.get(ref) or '')",
        "        if kind == 'hyperparam':",
        "            section, _, pname = ref.partition('/')",
        "            entry = ((td.get('hyperparams') or {}).get(section) or {}).get(pname) or {}",
        "            return str(entry.get('value') or '')",
        "        if kind == 'scalar':",
        "            metric = mp.get('metric'); variant = mp.get('variant')",
        "            for group in (td.get('last_metrics') or {}).values():",
        "                for v in (group or {}).values():",
        "                    if v.get('metric') == metric and (not variant or v.get('variant') == variant):",
        "                        val = v.get('value')",
        "                        if val is None: val = v.get('max_value')",
        "                        if val is None: val = v.get('min_value')",
        "                        return str(val) if val is not None else ''",
        "            return ''",
        "        if kind == 'artifact':",
        "            key = ref.split('\\x00')[-1]",
        "            for art in ((td.get('execution') or {}).get('artifacts') or []):",
        "                if art.get('key') == key:",
        "                    return str(art.get('uri') or art.get('key') or '')",
        "            return ''",
        "        return ''",
        "    if mappings:",
        "        _lookup = _task_lookup([mp.get('taskId') for mp in mappings.values()])",
        "        for _slot, _mp in mappings.items():",
        "            if not _slot.startswith('text:'):",
        "                continue",
        "            _token = _slot[len('text:'):]",
        "            _value = _redact(_resolve_text(_mp, _lookup.get(_mp.get('taskId'))))",
        "            content = content.replace('<' + _token + '>', _value)",
        "        _auto = [0]",
        "        def _rewrite_iframe(match):",
        "            block = match.group(0)",
        "            name_match = re.search(r'name\\s*=\\s*\"([^\"]+)\"', block)",
        "            if name_match:",
        "                key = 'media:' + name_match.group(1)",
        "            else:",
        "                _auto[0] += 1",
        "                key = 'media:embed-' + str(_auto[0])",
        "            mp = mappings.get(key)",
        "            if not isinstance(mp, dict):",
        "                return block",
        "            td = _lookup.get(mp.get('taskId')) or {}",
        "            company = td.get('company')",
        "            if isinstance(company, dict):",
        "                company = company.get('id')",
        "            metric = str(mp.get('metric') or '')",
        "            variant = str(mp.get('variant') or '')",
        "            from urllib.parse import quote as _uq",
        "            def _e(v):",
        "                return _uq(str(v if v is not None else ''), safe='')",
        "            repl = {",
        "                '<TASK_ID>': _e(mp.get('taskId')),",
        "                '<COMPANY_ID>': _e(company),",
        "                '<METRIC>': _e(metric),",
        "                '<PLOT_METRIC>': _e(metric),",
        "                '<IMAGE_METRIC>': _e(metric),",
        "                '<SCALAR_METRIC>': _e(metric),",
        "                '<VARIANT>': _e(variant),",
        "                '<PLOT_VARIANT>': _e(variant),",
        "                '<IMAGE_VARIANT>': _e(variant),",
        "                '<SCALAR_VARIANT>': _e(variant),",
        "            }",
        "            for tok, val in repl.items():",
        "                block = block.replace(tok, val)",
        "            block = block.replace('/widgets?', '/widgets/?')",
        "            return block",
        "        content = re.sub(r'<iframe\\b.*?</iframe>', _rewrite_iframe, content, flags=re.IGNORECASE | re.DOTALL)",
        "",
        "    create_payload = {'name': title}",
        "    project_id = getattr(task, 'project', None)",
        "    if project_id:",
        "        create_payload['project'] = project_id",
        "    created = session.send_request(",
        "        'reports', 'create', method='post', json=create_payload,",
        "    )",
        "    report_id = (created.json().get('data') or {}).get('id')",
        "    if report_id:",
        "        session.send_request(",
        "            'reports', 'update', method='post',",
        "            json={'task': report_id, 'report': content},",
        "        )",
        "    if task is not None:",
        "        try:",
        "            task.get_logger().report_text('ClearPipe report created: ' + str(report_id))",
        "        except Exception:",
        "            pass",
        "    return report_id",
    ]
    return "\n".join(lines) + "\n"


def _render_report_function_v2(
    name: str,
    title: str,
    template_report_id: str,
    template_fingerprint: str,
    report_mappings: list,
    sources: list,
) -> str:
    """Render the graph-aware report function that binds to upstream Task nodes.

    The function receives one runtime argument per pipeline source (``${step.id}``)
    and resolves every mapping from the newly cloned runtime task, never a base
    task id baked into the graph. Required missing outputs fail before the report
    is created; optional missing outputs publish with a "not reported" note.
    """

    params = [param for (_nid, _step, param) in sources]
    signature = "def {}({}) -> object:".format(
        name, ", ".join("{}=None".format(param) for param in params)
    ) if params else "def {}() -> object:".format(name)

    title_literal = _python_literal(title)
    template_literal = _python_literal(template_report_id)
    fingerprint_literal = _python_literal(template_fingerprint)
    mappings_literal = _python_literal(list(report_mappings))

    lines = [
        signature,
        "    import json",
        "    import re",
        "    from clearml import Task",
        "    from urllib.parse import quote as _uq",
        "",
        "    task = Task.current_task()",
        "    session = Task._get_default_session()",
        "",
        "    _secret_re = re.compile(",
        "        r\"(?i)(password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\"",
        "        r\"(\\s*[:=]\\s*)(\\S+)\"",
        "    )",
        "    _aws_re = re.compile(r\"AKIA[0-9A-Z]{16}\")",
        "    _bearer_re = re.compile(r\"(?i)(bearer\\s+)[A-Za-z0-9._-]{12,}\")",
        "    def _redact(text):",
        "        text = str(text)",
        "        text = _secret_re.sub(lambda m: m.group(1) + m.group(2) + '***REDACTED***', text)",
        "        text = _aws_re.sub('***REDACTED***', text)",
        "        text = _bearer_re.sub(lambda m: m.group(1) + '***REDACTED***', text)",
        "        return text",
        "    def _e(v):",
        "        return _uq(str(v if v is not None else ''), safe='')",
        "    def _fingerprint(md):",
        "        md = md or ''",
        "        md = re.sub(r'<!--[\\s\\S]*?-->', ' ', md)",
        "        md = re.sub(r'```[\\s\\S]*?```', ' ', md)",
        "        md = re.sub(r'~~~[\\s\\S]*?~~~', ' ', md)",
        "        md = re.sub(r'\\s+', ' ', md).strip()",
        "        h = 0x811c9dc5",
        "        for ch in md:",
        "            h ^= ord(ch)",
        "            h = (h * 0x01000193) & 0xffffffff",
        "        return format(h, '08x')",
        "",
        "    title = {}".format(title_literal),
        "    template_report_id = {}".format(template_literal),
        "    template_fingerprint = {}".format(fingerprint_literal),
        "    mappings = {}".format(mappings_literal),
        "",
        "    runtime_task_ids = {}",
    ]
    for node_id, _step, param in sources:
        lines.append(
            "    runtime_task_ids[{}] = {}".format(_python_literal(node_id), param)
        )
    lines += [
        "    def _mapping_task_id(mp):",
        "        src = mp.get('source') or {}",
        "        nid = src.get('sourceNodeId')",
        "        if nid:",
        "            return runtime_task_ids.get(nid)",
        "        return src.get('externalTaskId')",
        "    def _task_lookup(ids):",
        "        ids = sorted({i for i in ids if i})",
        "        if not ids:",
        "            return {}",
        "        try:",
        "            resp = session.send_request(",
        "                'tasks', 'get_all_ex', method='post',",
        "                json={'id': ids, 'page': 0, 'page_size': 100,",
        "                      'only_fields': ['id', 'name', 'status', 'company',",
        "                                      'user.name',",
        "                                      'project.name', 'started', 'completed',",
        "                                      'last_iteration', 'last_metrics',",
        "                                      'hyperparams', 'execution.artifacts',",
        "                                      'execution.queue', 'last_worker',",
        "                                      'script.entry_point', 'script.binary']},",
        "            )",
        "            found = (resp.json().get('data') or {}).get('tasks') or []",
        "        except Exception:",
        "            found = []",
        "        return {t.get('id'): t for t in found if t.get('id')}",
        "    def _resolve_text(kind, sel, td):",
        "        if kind == 'field':",
        "            f = sel.get('field') or ''",
        "            if f == 'project':",
        "                proj = td.get('project') or {}",
        "                return str((proj.get('name') if isinstance(proj, dict) else proj) or '')",
        "            if f == 'author':",
        "                user = td.get('user') or {}",
        "                return str((user.get('name') if isinstance(user, dict) else user) or '')",
        "            if f == 'company_id':",
        "                company = td.get('company') or {}",
        "                return str((company.get('id') if isinstance(company, dict) else company) or '')",
        "            if f == 'iteration':",
        "                return str(td.get('last_iteration') or '')",
        "            return str(td.get(f) or '')",
        "        if kind == 'hyperparam':",
        "            section = sel.get('section') or ''",
        "            parameter = sel.get('parameter') or sel.get('field') or ''",
        "            entry = ((td.get('hyperparams') or {}).get(section) or {}).get(parameter) or {}",
        "            return str(entry.get('value') if isinstance(entry, dict) else entry or '')",
        "        if kind in ('scalar', 'scalar_graph'):",
        "            metric = sel.get('metric'); variant = sel.get('variant')",
        "            for group in (td.get('last_metrics') or {}).values():",
        "                for v in (group or {}).values():",
        "                    if v.get('metric') == metric and (not variant or v.get('variant') == variant):",
        "                        val = v.get('value')",
        "                        if val is None: val = v.get('max_value')",
        "                        if val is None: val = v.get('min_value')",
        "                        return str(val) if val is not None else ''",
        "            return ''",
        "        if kind == 'artifact':",
        "            key = sel.get('artifactKey') or ''",
        "            for art in ((td.get('execution') or {}).get('artifacts') or []):",
        "                if isinstance(art, dict) and art.get('key') == key:",
        "                    return str(art.get('uri') or art.get('key') or '')",
        "            return ''",
        "        return ''",
        "",
        "    _tasks = _task_lookup([_mapping_task_id(mp) for mp in mappings])",
        "",
        "    def _artifact_url(td, key):",
        "        for artifact in ((td.get('execution') or {}).get('artifacts') or []):",
        "            if isinstance(artifact, dict) and artifact.get('key') == key:",
        "                return str(artifact.get('uri') or '')",
        "        return ''",
        "    def _latest(td, metric, variant):",
        "        return _resolve_text('scalar', {'metric': metric, 'variant': variant}, td)",
        "    def _hyper(td, section, parameter, default=''):",
        "        entry = ((td.get('hyperparams') or {}).get(section) or {}).get(parameter) or {}",
        "        value = entry.get('value') if isinstance(entry, dict) else entry",
        "        return str(value) if value not in (None, '') else str(default)",
        "    def _plot_image_url(tid, metric, variant):",
        "        try:",
        "            other = Task.get_task(task_id=tid)",
        "            for item in other.get_reported_plots(max_iterations=200) or []:",
        "                if item.get('metric') != metric or item.get('variant') != variant:",
        "                    continue",
        "                payload = json.loads(item.get('plot_str') or item.get('plot') or '{}')",
        "                images = (payload.get('layout') or {}).get('images') or []",
        "                if images and images[0].get('source'):",
        "                    return str(images[0]['source'])",
        "        except Exception:",
        "            pass",
        "        return ''",
        "    def _curve_artifact(tid, artifact_name, title_text, requested):",
        "        try:",
        "            from pathlib import Path",
        "            from clearml import StorageManager",
        "            from PIL import Image, ImageDraw",
        "            reported = Task.get_task(task_id=tid).get_reported_scalars(max_samples=2000)",
        "            series = []",
        "            for metric, variant, label, color in requested:",
        "                values = ((reported.get(metric) or {}).get(variant) or {})",
        "                xs = list(values.get('x') or [])",
        "                ys = list(values.get('y') or [])",
        "                if xs and ys and len(xs) == len(ys):",
        "                    series.append((label, color, [float(x) for x in xs], [float(y) for y in ys]))",
        "            if not series:",
        "                return ''",
        "            width, height = 1000, 420",
        "            left, top, right, bottom = 78, 54, 30, 64",
        "            image = Image.new('RGB', (width, height), 'white')",
        "            draw = ImageDraw.Draw(image)",
        "            draw.text((left, 18), title_text, fill='#172033')",
        "            all_x = [x for _label, _color, xs, _ys in series for x in xs]",
        "            all_y = [y for _label, _color, _xs, ys in series for y in ys]",
        "            xmin, xmax = min(all_x), max(all_x)",
        "            ymin, ymax = min(all_y), max(all_y)",
        "            if xmax == xmin: xmax = xmin + 1.0",
        "            if ymax == ymin: ymax = ymin + 1.0",
        "            pad = max((ymax - ymin) * 0.08, 1e-9)",
        "            ymin, ymax = ymin - pad, ymax + pad",
        "            x0, y0 = left, height - bottom",
        "            x1, y1 = width - right, top",
        "            for idx in range(6):",
        "                gy = y0 - (y0 - y1) * idx / 5.0",
        "                value = ymin + (ymax - ymin) * idx / 5.0",
        "                draw.line((x0, gy, x1, gy), fill='#e4e8f0', width=1)",
        "                draw.text((8, gy - 7), ('%.4g' % value), fill='#536078')",
        "            draw.line((x0, y0, x1, y0), fill='#73809a', width=2)",
        "            draw.line((x0, y0, x0, y1), fill='#73809a', width=2)",
        "            for label, color, xs, ys in series:",
        "                points = []",
        "                for xv, yv in zip(xs, ys):",
        "                    px = x0 + (xv - xmin) * (x1 - x0) / (xmax - xmin)",
        "                    py = y0 - (yv - ymin) * (y0 - y1) / (ymax - ymin)",
        "                    points.append((px, py))",
        "                if len(points) > 1: draw.line(points, fill=color, width=4)",
        "                for px, py in points: draw.ellipse((px-4, py-4, px+4, py+4), fill=color)",
        "            legend_x = left",
        "            for label, color, _xs, _ys in series:",
        "                draw.line((legend_x, height-28, legend_x+28, height-28), fill=color, width=4)",
        "                draw.text((legend_x+36, height-36), label, fill='#25324a')",
        "                legend_x += 190",
        "            path = Path(artifact_name + '.png').resolve()",
        "            image.save(str(path), format='PNG')",
        "            if task is not None:",
        "                task.output_uri = StorageManager.get_files_server()",
        "                task.upload_artifact(artifact_name, artifact_object=str(path), wait_on_upload=True)",
        "                task.reload()",
        "                artifact = (task.artifacts or {}).get(artifact_name)",
        "                return str(getattr(artifact, 'url', '') or '')",
        "        except Exception as error:",
        "            if task is not None:",
        "                task.get_logger().report_text('Report curve generation failed: ' + _redact(str(error)))",
        "        return ''",
        "",
        "    content = ''",
        "    _runtime_content = bool(_tasks) and any(mp.get('outputKind') == 'scalar_graph' for mp in mappings) and any(mp.get('outputKind') == 'artifact' for mp in mappings)",
        "    _generated_missing = []",
        "    if _runtime_content:",
        "        primary_tid = sorted(_tasks)[0]",
        "        primary = _tasks[primary_tid]",
        "        loss_curve = _curve_artifact(",
        "            primary_tid, 'training_loss_curve', 'Training and validation loss',",
        "            [('train', 'loss', 'train/loss', '#2f77d0'), ('val', 'loss', 'val/loss', '#d04b59')],",
        "        )",
        "        metric_curve = _curve_artifact(",
        "            primary_tid, 'validation_metric_curve', 'Validation accuracy and average precision',",
        "            [('val', 'accuracy', 'val/accuracy', '#1f9d72'),",
        "             ('val', 'average_precision', 'val/average_precision', '#8a5bd1')],",
        "        )",
        "        confusion = (_plot_image_url(primary_tid, 'Normalized by actual class', 'plot image')",
        "                     or _artifact_url(primary, 'validation_confusion_matrix'))",
        "        roc = (_plot_image_url(primary_tid, 'Validation ROC AUC', 'plot image')",
        "               or _artifact_url(primary, 'validation_precision_recall_curve'))",
        "        preview = _artifact_url(primary, 'augmentation_preview')",
        "        for label, uri in [('training loss curve', loss_curve),",
        "                           ('validation metric curve', metric_curve),",
        "                           ('confusion matrix', confusion),",
        "                           ('validation ROC AUC', roc),",
        "                           ('augmentation preview', preview)]:",
        "            if not uri: _generated_missing.append(label)",
        "        dataset_id = _hyper(primary, 'training', 'resolved_clearml_dataset_id')",
        "        dataset_project = _hyper(primary, 'training', 'clearml_dataset_project', _hyper(primary, 'Args', 'clearml_dataset_project', 'datasets'))",
        "        dataset_name = _hyper(primary, 'training', 'clearml_dataset_name', _hyper(primary, 'Args', 'dataset_name', 'training-data'))",
        "        dataset_version = ''",
        "        if dataset_id:",
        "            try:",
        "                from clearml import Dataset",
        "                dataset_version = str(Dataset.get(dataset_id=dataset_id).version or '')",
        "            except Exception:",
        "                dataset_version = ''",
        "        content = '# Model Training Report — ' + _redact(primary.get('name') or 'Task')",
        "        content += '\\n\\n> Generated from `train-template` using live outputs from runtime Task `' + _redact(primary_tid) + '`.'",
        "        content += '\\n\\n**Project:** ' + _redact(((primary.get('project') or {}).get('name') if isinstance(primary.get('project'), dict) else primary.get('project')) or '')",
        "        content += ' · **Status:** ' + _redact(primary.get('status') or '')",
        "        content += ' · **Worker:** ' + _redact(primary.get('last_worker') or '')",
        "        content += '\\n\\n**Started:** ' + _redact(primary.get('started') or '')",
        "        content += ' · **Completed:** ' + _redact(primary.get('completed') or '')",
        "        content += ' · **Iterations:** ' + _redact(primary.get('last_iteration') if primary.get('last_iteration') is not None else '')",
        "        content += '\\n\\n---\\n\\n## 1. Summary'",
        "        content += '\\n\\nA ResNet-152 pass/fail classifier ran for **' + _redact(_hyper(primary, 'Args', 'epochs', _hyper(primary, 'training', 'epochs', ''))) + ' epochs**'",
        "        content += ' on ClearML Dataset **' + _redact(dataset_project) + '/' + _redact(dataset_name) + '**'",
        "        if dataset_version: content += ' version **' + _redact(dataset_version) + '**'",
        "        if dataset_id: content += ' (`' + _redact(dataset_id) + '`)'",
        "        content += '. The selection metric was **' + _redact(_hyper(primary, 'training', 'selection_metric', 'average_precision')) + '**.'",
        "        content += '\\n\\n## 2. Final metrics'",
        "        content += '\\n\\n| Split | Metric | Value |\\n|---|---|---:|'",
        "        for metric, variant in [('val','average_precision'),('val','accuracy'),('val','precision'),('val','recall'),('val','f1'),('val','roc_auc'),('val','balanced_accuracy'),('val','specificity'),('val','loss'),('val','threshold'),('train','accuracy'),('train','loss')]:",
        "            value = _latest(primary, metric, variant)",
        "            if value != '': content += '\\n| ' + metric + ' | ' + variant + ' | ' + _redact(value) + ' |'",
        "        content += '\\n\\n## 3. Pipeline parameters'",
        "        content += '\\n\\n| Parameter | Value |\\n|---|---|'",
        "        content += '\\n| Dataset project flag | `' + _redact(_hyper(primary, 'Args', 'clearml_dataset_project', dataset_project)) + '` |'",
        "        content += '\\n| Dataset name flag | `' + _redact(_hyper(primary, 'Args', 'dataset_name', dataset_name)) + '` |'",
        "        content += '\\n| Epochs | ' + _redact(_hyper(primary, 'Args', 'epochs', _hyper(primary, 'training', 'epochs', ''))) + ' |'",
        "        content += '\\n| Dataset ID | `' + _redact(dataset_id) + '` |'",
        "        content += '\\n| Dataset version | ' + _redact(dataset_version) + ' |'",
        "        content += '\\n| Execution queue | `' + _redact((primary.get('execution') or {}).get('queue') or '') + '` |'",
        "        content += '\\n| Entry point | `' + _redact((primary.get('script') or {}).get('entry_point') or '') + '` |'",
        "        content += '\\n\\n## 4. Training hyperparameters'",
        "        content += '\\n\\n| Parameter | Value | Parameter | Value |\\n|---|---:|---|---:|'",
        "        for left, right in [('image_size','batch_size'),('gradient_accumulation','effective_batch'),('backbone_lr','head_lr'),('weight_decay','dropout'),('warmup_epochs','freeze_epochs'),('optimizer','label_smoothing'),('patience','minimum_fail_recall'),('seed','augmentation')]:",
        "            lv = _hyper(primary, 'training', left, _hyper(primary, 'Args', left))",
        "            if right == 'effective_batch':",
        "                try: rv = str(int(_hyper(primary, 'training', 'batch_size', _hyper(primary, 'Args', 'batch_size', '0'))) * int(_hyper(primary, 'training', 'gradient_accumulation', _hyper(primary, 'Args', 'gradient_accumulation', '0'))))",
        "                except Exception: rv = ''",
        "            else: rv = _hyper(primary, 'training', right, _hyper(primary, 'Args', right))",
        "            content += '\\n| ' + left + ' | ' + _redact(lv) + ' | ' + right + ' | ' + _redact(rv) + ' |'",
        "        content += '\\n\\n## 5. Training curves'",
        "        if loss_curve: content += '\\n\\n### Loss\\n\\n![Training and validation loss](' + _redact(loss_curve) + ')'",
        "        if metric_curve: content += '\\n\\n### Validation metrics\\n\\n![Validation accuracy and average precision](' + _redact(metric_curve) + ')'",
        "        content += '\\n\\n## 6. Plots and images'",
        "        if confusion: content += '\\n\\n### Confusion matrix\\n\\n![Normalized confusion matrix](' + _redact(confusion) + ')'",
        "        if roc: content += '\\n\\n### Validation precision-recall / ROC visualization\\n\\n![Validation precision-recall or ROC visualization](' + _redact(roc) + ')'",
        "        if preview: content += '\\n\\n### Augmentation preview\\n\\n![Augmentation preview](' + _redact(preview) + ')'",
        "        content += '\\n\\n## 7. Output artifacts'",
        "        artifacts = (primary.get('execution') or {}).get('artifacts') or []",
        "        if artifacts:",
        "            content += '\\n\\n| Artifact | Link |\\n|---|---|'",
        "            for artifact in sorted(artifacts, key=lambda item: str(item.get('key') or '')):",
        "                key = _redact(artifact.get('key') or 'artifact')",
        "                uri = _redact(artifact.get('uri') or '')",
        "                content += '\\n| ' + key + ' | [' + key + '](' + uri + ') |' if uri else '\\n| ' + key + ' | unavailable |'",
        "    elif template_report_id:",
        "        try:",
        "            response = session.send_request(",
        "                'reports', 'get_all_ex', method='post',",
        "                json={'id': [template_report_id], 'only_fields': ['report']},",
        "            )",
        "            template_tasks = (response.json().get('data') or {}).get('tasks') or []",
        "            base_markdown = (template_tasks[0].get('report') if template_tasks else '') or ''",
        "        except Exception:",
        "            base_markdown = ''",
        "        if base_markdown:",
        "            if template_fingerprint and _fingerprint(base_markdown) != template_fingerprint:",
        "                raise RuntimeError('ClearPipe report template changed since mapping (fingerprint mismatch); re-open mapping before running.')",
        "            content = base_markdown",
        "    if not content:",
        "        content = '# ' + title",
        "",
        "    _media = {}",
        "    for mp in mappings:",
        "        slot = mp.get('slotKey') or ''",
        "        if slot.startswith('media:') and not mp.get('ignored'):",
        "            _media[slot[len('media:'):]] = mp",
        "",
        "    missing_required = list(_generated_missing)",
        "    not_reported = []",
        "",
        "    for mp in mappings:",
        "        if mp.get('ignored'):",
        "            continue",
        "        slot = mp.get('slotKey') or ''",
        "        if not slot.startswith('text:'):",
        "            continue",
        "        token = slot[len('text:'):]",
        "        tid = _mapping_task_id(mp)",
        "        td = _tasks.get(tid) or {}",
        "        value = _resolve_text(mp.get('outputKind'), mp.get('selector') or {}, td) if td else ''",
        "        if tid and value != '':",
        "            content = content.replace('<' + token + '>', _redact(str(value)))",
        "        elif mp.get('required'):",
        "            missing_required.append(slot)",
        "        else:",
        "            not_reported.append(slot)",
        "            content = content.replace('<' + token + '>', '_(not reported)_')",
        "",
        "    def _rewrite_iframe(match):",
        "        block = match.group(0)",
        "        name_match = re.search(r'name\\s*=\\s*\"([^\"]+)\"', block)",
        "        if not name_match:",
        "            return block",
        "        mp = _media.get(name_match.group(1))",
        "        if not isinstance(mp, dict):",
        "            return block",
        "        tid = _mapping_task_id(mp)",
        "        td = _tasks.get(tid) or {}",
        "        company = td.get('company')",
        "        if isinstance(company, dict):",
        "            company = company.get('id')",
        "        sel = mp.get('selector') or {}",
        "        kind = mp.get('outputKind') or ''",
        "        if kind == 'artifact':",
        "            uri = _resolve_text(kind, sel, td) if td else ''",
        "            if uri:",
        "                label = str(sel.get('artifactKey') or name_match.group(1) or 'artifact')",
        "                return '![' + _redact(label) + '](' + _redact(uri) + ')'",
        "            if mp.get('required'):",
        "                missing_required.append(mp.get('slotKey'))",
        "            else:",
        "                not_reported.append(mp.get('slotKey'))",
        "            return '_(artifact not reported)_'",
        "        metric = str(sel.get('metric') or '')",
        "        variant = str(sel.get('variant') or '')",
        "        repl = {",
        "            '<TASK_ID>': _e(tid),",
        "            '<COMPANY_ID>': _e(company),",
        "            '<METRIC>': _e(metric),",
        "            '<PLOT_METRIC>': _e(metric),",
        "            '<IMAGE_METRIC>': _e(metric),",
        "            '<SCALAR_METRIC>': _e(metric),",
        "            '<VARIANT>': _e(variant),",
        "            '<PLOT_VARIANT>': _e(variant),",
        "            '<IMAGE_VARIANT>': _e(variant),",
        "            '<SCALAR_VARIANT>': _e(variant),",
        "        }",
        "        for tok, val in repl.items():",
        "            block = block.replace(tok, val)",
        "        if kind == 'plot':",
        "            block = re.sub(r'([?&]type=)(?:sample|scalar)', r'\\1plot', block)",
        "        elif kind in ('scalar', 'scalar_graph'):",
        "            block = re.sub(r'([?&]type=)(?:sample|plot)', r'\\1scalar', block)",
        "        block = block.replace('/widgets?', '/widgets/?')",
        "        return block",
        "    content = re.sub(r'<iframe\\b.*?</iframe>', _rewrite_iframe, content, flags=re.IGNORECASE | re.DOTALL)",
        "",
        "    for _name, mp in _media.items():",
        "        if not _mapping_task_id(mp):",
        "            if mp.get('required'):",
        "                missing_required.append(mp.get('slotKey'))",
        "            else:",
        "                not_reported.append(mp.get('slotKey'))",
        "",
        "    if missing_required:",
        "        raise RuntimeError('ClearPipe report missing required outputs: ' + ', '.join(sorted(set(missing_required))))",
        "",
        "    if not_reported:",
        "        content += '\\n\\n> _Not reported: ' + ', '.join(sorted(set(not_reported))) + '_'",
        "",
        "    if _tasks and not _runtime_content:",
        "        content += '\\n\\n---\\n\\n## ClearPipe Runtime Task Outputs'",
        "        for tid in sorted(_tasks):",
        "            td = _tasks[tid]",
        "            content += '\\n\\n### ' + _redact(td.get('name') or tid)",
        "            content += '\\n\\n- **Task ID:** `' + _redact(tid) + '`'",
        "            content += '\\n- **Status:** ' + _redact(td.get('status') or '')",
        "            metrics = []",
        "            for group in (td.get('last_metrics') or {}).values():",
        "                for value in (group or {}).values():",
        "                    metric = value.get('metric')",
        "                    variant = value.get('variant')",
        "                    latest = value.get('value')",
        "                    if metric and variant and latest is not None and not str(metric).startswith(':monitor:'):",
        "                        metrics.append((str(metric), str(variant), latest))",
        "            if metrics:",
        "                content += '\\n\\n| Metric | Variant | Last value |\\n|---|---|---:|'",
        "                for metric, variant, latest in sorted(metrics):",
        "                    content += '\\n| ' + _redact(metric) + ' | ' + _redact(variant) + ' | ' + _redact(latest) + ' |'",
        "            artifacts = (td.get('execution') or {}).get('artifacts') or []",
        "            if artifacts:",
        "                content += '\\n\\n**Artifacts**'",
        "                for artifact in sorted(artifacts, key=lambda item: str(item.get('key') or '')):",
        "                    key = _redact(artifact.get('key') or 'artifact')",
        "                    uri = _redact(artifact.get('uri') or '')",
        "                    content += '\\n- [' + key + '](' + uri + ')' if uri else '\\n- ' + key",
        "",
        "    create_payload = {'name': title}",
        "    project_id = getattr(task, 'project', None)",
        "    if project_id:",
        "        create_payload['project'] = project_id",
        "    created = session.send_request(",
        "        'reports', 'create', method='post', json=create_payload,",
        "    )",
        "    report_id = (created.json().get('data') or {}).get('id')",
        "    if report_id:",
        "        session.send_request(",
        "            'reports', 'update', method='post',",
        "            json={'task': report_id, 'report': content},",
        "        )",
        "        session.send_request(",
        "            'reports', 'publish', method='post',",
        "            json={'task': report_id, 'comment': 'Published by ClearPipe'},",
        "        )",
        "    if task is not None:",
        "        try:",
        "            task.get_logger().report_text('ClearPipe report created: ' + str(report_id))",
        "            if not_reported:",
        "                task.get_logger().report_text('ClearPipe optional outputs not reported: ' + ', '.join(sorted(set(not_reported))))",
        "        except Exception:",
        "            pass",
        "    return report_id",
    ]
    return "\n".join(lines) + "\n"
