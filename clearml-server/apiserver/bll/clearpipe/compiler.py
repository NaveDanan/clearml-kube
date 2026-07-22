import json
from copy import deepcopy
from typing import Mapping

from .controller_runner import RUNNER_SOURCE


SCHEMA_VERSION = 1
MAX_COMPILED_SCRIPT_BYTES = 5 * 1024 * 1024


def _node_data(node: Mapping) -> Mapping:
    return node.get("data") if isinstance(node.get("data"), Mapping) else node


def normalize_pipeline(graph: Mapping) -> dict:
    parents = {str(node["id"]): [] for node in graph.get("nodes", [])}
    for edge in graph.get("edges", []):
        if edge.get("source") in parents and edge.get("target") in parents:
            parents[edge["target"]].append(edge["source"])

    result = {}
    for node in graph.get("nodes", []):
        node_id = str(node["id"])
        data = _node_data(node)
        config = data.get("config") or {}
        result[node_id] = {
            "base_task_id": config.get("taskId") or config.get("baseTaskId"),
            "queue": config.get("queue") or config.get("queueId"),
            "parents": sorted(parents[node_id]),
            "stage": data.get("label") or node_id,
            "timeout": config.get("timeout"),
            "parameters": config.get("parameterValues") or {},
            "configurations": {},
            "task_overrides": {},
            "executed": None,
            "status": "pending",
            "clone_task": bool(config.get("taskId") or config.get("baseTaskId")),
            "job_type": _task_type(data.get("type")),
            "job_started": None,
            "job_ended": None,
            "job_code_section": node_id,
            "skip_job": False,
            "continue_on_fail": bool(config.get("continueOnFail", False)),
            "cache_executed_step": bool(config.get("cache", False)),
            "return_artifacts": config.get("outputs"),
            "monitor_metrics": config.get("monitorMetrics"),
            "monitor_artifacts": config.get("monitorArtifacts"),
            "monitor_models": config.get("monitorModels"),
            "job_id": None,
        }
    return result


def _task_type(node_type: str) -> str:
    return {
        "training": "training",
        "report": "report",
        "experiment": "monitor",
        "experiment_tracking": "monitor",
    }.get(node_type, "data_processing")


def render_controller_script(graph: Mapping) -> str:
    graph_json = json.dumps(graph, ensure_ascii=False, separators=(",", ":"))
    script = "CLEARPIPE_GRAPH = " + repr(graph_json) + "\n" + RUNNER_SOURCE
    if len(script.encode("utf-8")) > MAX_COMPILED_SCRIPT_BYTES:
        raise ValueError(f"compiled controller script exceeds {MAX_COMPILED_SCRIPT_BYTES} bytes")
    return script


def compile_definition(graph: Mapping, revision: int, default_queue=None, default_queues=None) -> dict:
    clearpipe = deepcopy(dict(graph))
    clearpipe.update(
        schema_version=SCHEMA_VERSION,
        revision=revision,
        default_queue=default_queue,
        default_queues=default_queues or {},
    )
    return {
        "clearpipe": clearpipe,
        "pipeline": normalize_pipeline(graph),
        "script": render_controller_script(clearpipe),
    }
