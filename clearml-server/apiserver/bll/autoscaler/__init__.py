import json
import os
import shlex
import shutil
import subprocess
import tempfile
from datetime import datetime, timedelta
from types import SimpleNamespace
from typing import Optional

import requests

from apiserver.apimodels.autoscaler import (
    DeleteWorkloadRequest,
    GetWorkloadInfoRequest,
    GetWorkloadLogsRequest,
    SaveAppInstanceRequest,
    SetSettingsRequest,
    StopWorkloadRequest,
    SubmitWorkloadRequest,
    WorkloadRequest,
)
from apiserver.config_repo import config
from apiserver.database.model.autoscaler_settings import (
    AutoscalerAppInstance,
    AutoscalerSettings,
    AutoscalerExecution,
)
from apiserver.database.utils import id as db_id

log = config.logger(__file__)


class _SafeFormatDict(dict):
    """dict that returns an empty string for missing template placeholders."""

    def __missing__(self, key):
        return ""


# Catalog of the Run:ai CLI commands the autoscaler can run, grouped by CLI
# version. The ``command`` values are the editable defaults shown in the
# "Autoscalar Commands" settings tab. Placeholders in ``{}`` are substituted at
# run time. For the ``submit_*`` / ``submit`` entries only the base command is
# editable; the concrete workload flags (image, GPU, command, args, ...) are
# appended automatically.
RUNAI_COMMAND_CATALOG = {
    "v2": [
        {
            "key": "login",
            "label": "Application login",
            "description": "Authenticate to Run:ai using application credentials.",
            "command": "runai login application --client-id {access_key} --secret {secret_key} --interactive disabled",
            "placeholders": [
                {"name": "access_key", "description": "Run:ai application client id / access key"},
                {"name": "secret_key", "description": "Run:ai application client secret"},
            ],
        },
        {
            "key": "cp_url",
            "label": "Set control plane URL",
            "description": "Configure the Run:ai control plane URL (v2 only).",
            "command": "runai config set --cp-url {cp_url}",
            "placeholders": [{"name": "cp_url", "description": "Run:ai control plane URL"}],
        },
        {
            "key": "cluster_set",
            "label": "Select cluster",
            "description": "Set the active Run:ai cluster.",
            "command": "runai cluster set {cluster}",
            "placeholders": [{"name": "cluster", "description": "Run:ai cluster name"}],
        },
        {
            "key": "project_set",
            "label": "Select project",
            "description": "Set the active Run:ai project.",
            "command": "runai project set {project}",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "project_list",
            "label": "List projects",
            "description": "List Run:ai projects (used by the connection test and dashboard).",
            "command": "runai project list --json",
            "placeholders": [],
        },
        {
            "key": "node_list",
            "label": "List nodes",
            "description": "List cluster nodes for the resources dashboard.",
            "command": "runai node list --json",
            "placeholders": [],
        },
        {
            "key": "workload_list",
            "label": "List workloads",
            "description": "List workloads for the dashboard. Add --project {project} to scope it.",
            "command": "runai workload list --json --no-pagination",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "compute_list",
            "label": "List compute resources",
            "description": "List compute resources/templates used when building a new workload.",
            "command": "runai compute list --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "compute_describe",
            "label": "Describe compute resource",
            "description": "Read the full definition of a single compute resource for the new-workload form.",
            "command": "runai compute describe {name} -o json",
            "placeholders": [
                {"name": "name", "description": "Compute resource name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "environment_list",
            "label": "List environments",
            "description": "List environments used when building a new workload.",
            "command": "runai environment list --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "environment_describe",
            "label": "Describe environment",
            "description": "Read the full definition of a single environment for the new-workload form.",
            "command": "runai environment describe {name} -o json",
            "placeholders": [
                {"name": "name", "description": "Environment name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "datasource_list",
            "label": "List data sources",
            "description": "List data sources used when building a new workload.",
            "command": "runai datasource list --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "datasource_describe",
            "label": "Describe data source",
            "description": "Read the full definition of a single data source for the new-workload form.",
            "command": "runai datasource describe {name} --type {type} -o json",
            "placeholders": [
                {"name": "name", "description": "Data source name"},
                {"name": "type", "description": "Data source type"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "nodepool_list",
            "label": "List node pools",
            "description": "List node pools available for a new workload.",
            "command": "runai nodepool list --json",
            "placeholders": [],
        },
        {
            "key": "submit_training",
            "label": "Submit training",
            "description": "Base command to submit a training workload. Workload flags are appended automatically.",
            "command": "runai training standard submit",
            "placeholders": [],
        },
        {
            "key": "submit_workspace",
            "label": "Submit workspace",
            "description": "Base command to submit a workspace workload. Workload flags are appended automatically.",
            "command": "runai workspace submit",
            "placeholders": [],
        },
        {
            "key": "submit_inference",
            "label": "Submit inference",
            "description": "Base command to submit an inference workload. Workload flags are appended automatically.",
            "command": "runai inference submit",
            "placeholders": [],
        },
        {
            "key": "delete_workload",
            "label": "Delete workload",
            "description": "Delete a workload. The active project is selected beforehand.",
            "command": "runai workload delete {name} --force",
            "placeholders": [
                {"name": "name", "description": "Workload name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "stop_workload",
            "label": "Stop workload",
            "description": "Suspend (stop) a running workload.",
            "command": "runai workload suspend {name}",
            "placeholders": [
                {"name": "name", "description": "Workload name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "workload_logs",
            "label": "Workload logs",
            "description": "Read console logs for a single workload.",
            "command": "runai {workload_type} logs {name} --tail {tail}",
            "placeholders": [
                {"name": "workload_type", "description": "training, workspace, or inference"},
                {"name": "name", "description": "Workload name"},
                {"name": "tail", "description": "Number of trailing log lines"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
    ],
    "v1": [
        {
            "key": "login",
            "label": "Application login",
            "description": "Authenticate to Run:ai using application credentials.",
            "command": "runai login application --name {access_key} --secret {secret_key} --interactive disabled",
            "placeholders": [
                {"name": "access_key", "description": "Run:ai application name / access key"},
                {"name": "secret_key", "description": "Run:ai application secret"},
            ],
        },
        {
            "key": "cluster_set",
            "label": "Select cluster",
            "description": "Set the active Run:ai cluster.",
            "command": "runai config cluster {cluster}",
            "placeholders": [{"name": "cluster", "description": "Run:ai cluster name"}],
        },
        {
            "key": "project_set",
            "label": "Select project",
            "description": "Set the active Run:ai project.",
            "command": "runai config project {project}",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "project_list",
            "label": "List projects",
            "description": "List Run:ai projects (used by the connection test and dashboard).",
            "command": "runai list projects --json",
            "placeholders": [],
        },
        {
            "key": "node_list",
            "label": "List nodes",
            "description": "List cluster nodes for the resources dashboard.",
            "command": "runai list nodes --json",
            "placeholders": [],
        },
        {
            "key": "workload_list",
            "label": "List workloads",
            "description": "List jobs for the dashboard.",
            "command": "runai list jobs --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "compute_list",
            "label": "List compute resources",
            "description": "List compute resources/templates used when building a new workload.",
            "command": "runai list compute --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "compute_describe",
            "label": "Describe compute resource",
            "description": "Read the full definition of a single compute resource for the new-workload form.",
            "command": "runai describe compute {name} --json",
            "placeholders": [
                {"name": "name", "description": "Compute resource name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "environment_list",
            "label": "List environments",
            "description": "List environments used when building a new workload.",
            "command": "runai list environment --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "environment_describe",
            "label": "Describe environment",
            "description": "Read the full definition of a single environment for the new-workload form.",
            "command": "runai describe environment {name} --json",
            "placeholders": [
                {"name": "name", "description": "Environment name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "datasource_list",
            "label": "List data sources",
            "description": "List data sources used when building a new workload.",
            "command": "runai list datasource --json",
            "placeholders": [{"name": "project", "description": "Run:ai project name"}],
        },
        {
            "key": "datasource_describe",
            "label": "Describe data source",
            "description": "Read the full definition of a single data source for the new-workload form.",
            "command": "runai describe datasource {name} --json",
            "placeholders": [
                {"name": "name", "description": "Data source name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "nodepool_list",
            "label": "List node pools",
            "description": "List node pools available for a new workload.",
            "command": "runai list node-pools --json",
            "placeholders": [],
        },
        {
            "key": "submit",
            "label": "Submit workload",
            "description": "Base command to submit a workload. Workload flags are appended automatically.",
            "command": "runai submit",
            "placeholders": [],
        },
        {
            "key": "delete_workload",
            "label": "Delete workload",
            "description": "Delete a workload. The active project is selected beforehand.",
            "command": "runai delete {name}",
            "placeholders": [
                {"name": "name", "description": "Workload name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "stop_workload",
            "label": "Stop workload",
            "description": "Suspend (stop) a running workload.",
            "command": "runai suspend {name}",
            "placeholders": [
                {"name": "name", "description": "Workload name"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
        {
            "key": "workload_logs",
            "label": "Workload logs",
            "description": "Read console logs for a single workload.",
            "command": "runai logs {name} --tail {tail}",
            "placeholders": [
                {"name": "name", "description": "Workload name"},
                {"name": "tail", "description": "Number of trailing log lines"},
                {"name": "project", "description": "Run:ai project name"},
            ],
        },
    ],
}


class AutoscalerBLL:

    _execution_log_limit = 10000
    _log_line_limit = 2000
    _default_cli_paths = (
        "/usr/local/sbin",
        "/usr/local/bin",
        "/usr/sbin",
        "/usr/bin",
        "/sbin",
        "/bin",
        "/opt/bin",
    )
    _openshift_cli_env_vars = (
        "CLEARML_OPENSHIFT_CLI",
        "OPENSHIFT_CLI",
        "OC_BINARY",
    )
    _workload_fields = (
        "workload_type",
        "workload_name",
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
        "existing_pvc",
        "working_dir",
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

    _settings_fields = (
        "connection_method",
        "openshift_login_mode",
        "openshift_api_url",
        "openshift_token",
        "openshift_login_command",
        "runai_cp_url",
        "runai_access_key",
        "runai_secret_key",
        "runai_cluster",
        "runai_project",
        "runai_cli_version",
        "user",
        "worker",
    )

    def get_company_settings(self, company_id: str) -> dict:
        db_settings = AutoscalerSettings.objects(company=company_id).first()
        if not db_settings:
            return {}
        return {
            field: getattr(db_settings, field, None) or ""
            for field in self._settings_fields
        }

    def set_company_settings(
        self, company_id: str, request: SetSettingsRequest, user_id: str = None, worker_id: str = None
    ) -> int:
        update_dict = {}
        for field in self._settings_fields:
            val = getattr(request, field, None)
            if val is not None:
                update_dict[f"set__{field}"] = val

        if not update_dict:
            return 0

        update_dict["set__last_update"] = datetime.utcnow()
        if user_id is not None:
            update_dict["set__user"] = user_id
        if worker_id is not None:
            update_dict["set__worker"] = worker_id

        result = AutoscalerSettings.objects(company=company_id).update_one(
            upsert=True,
            set_on_insert__id=db_id(),
            **update_dict,
        )
        # Best-effort: prefetch a Run:ai REST API access token right after the
        # connection is saved, so the workload info visualizer can query the API
        # immediately. Failures are non-fatal (the token is fetched lazily too).
        try:
            saved = AutoscalerSettings.objects(company=company_id).first()
            if saved and self._connection_method(saved) == "runai_application":
                self._get_api_token(saved, company_id, force=True)
        except Exception as ex:
            log.warning(f"Run:ai token prefetch failed: {ex}")
        return result

    def reset_company_settings(self, company_id: str) -> int:
        return AutoscalerSettings.objects(company=company_id).delete()

    # ------------------------------------------------------------------ #
    # Run:ai REST API (workload info visualizer)                          #
    # Fetches workload details/events/logs/metrics directly from the      #
    # Run:ai control plane using a cached bearer token (NOT the CLI).     #
    # ------------------------------------------------------------------ #
    _api_timeout = 15
    _token_skew = timedelta(seconds=60)

    @classmethod
    def _api_base(cls, settings) -> Optional[str]:
        url = (getattr(settings, "runai_cp_url", None) or "").strip()
        return url.rstrip("/") if url else None

    def _fetch_api_token(self, settings, company_id: str) -> Optional[str]:
        base = self._api_base(settings)
        client_id = (getattr(settings, "runai_access_key", None) or "").strip()
        client_secret = (getattr(settings, "runai_secret_key", None) or "").strip()
        if not base or not client_id or not client_secret:
            return None
        try:
            resp = requests.post(
                f"{base}/api/v1/token",
                json={
                    "grantType": "client_credentials",
                    "clientId": client_id,
                    "clientSecret": client_secret,
                },
                timeout=self._api_timeout,
            )
            resp.raise_for_status()
            data = resp.json()
        except Exception as ex:
            log.warning(f"Run:ai token request failed: {ex}")
            return None
        token = data.get("accessToken") or data.get("access_token")
        if not token:
            return None
        expires_in = data.get("expiresIn") or data.get("expires_in") or 1800
        try:
            expiry = datetime.utcnow() + timedelta(seconds=int(expires_in))
        except (TypeError, ValueError):
            expiry = datetime.utcnow() + timedelta(seconds=1800)
        AutoscalerSettings.objects(company=company_id).update_one(
            set__runai_api_token=token,
            set__runai_api_token_expiry=expiry,
        )
        return token

    def _get_api_token(self, settings, company_id: str, force: bool = False) -> Optional[str]:
        if not force:
            token = getattr(settings, "runai_api_token", None)
            expiry = getattr(settings, "runai_api_token_expiry", None)
            if token and expiry and expiry - self._token_skew > datetime.utcnow():
                return token
        return self._fetch_api_token(settings, company_id)

    def refresh_api_token(self, company_id: str) -> Optional[str]:
        settings = AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return None
        return self._get_api_token(settings, company_id, force=True)

    def _api_get(self, settings, company_id: str, path: str, params=None):
        base = self._api_base(settings)
        if not base:
            return None
        token = self._get_api_token(settings, company_id)
        if not token:
            return None
        url = f"{base}{path}"
        try:
            resp = requests.get(
                url,
                params=params,
                headers={"Authorization": f"Bearer {token}"},
                timeout=self._api_timeout,
            )
            if resp.status_code == 401:
                token = self._get_api_token(settings, company_id, force=True)
                if not token:
                    return None
                resp = requests.get(
                    url,
                    params=params,
                    headers={"Authorization": f"Bearer {token}"},
                    timeout=self._api_timeout,
                )
            resp.raise_for_status()
            return resp.json()
        except Exception as ex:
            log.warning(f"Run:ai API GET {path} failed: {ex}")
            return None

    def get_workload_info(self, company_id: str, workload_id: str) -> dict:
        """Aggregate details/events/logs/metrics for one Run:ai workload via the
        REST API (used by the workload info visualizer)."""
        workload_id = (workload_id or "").strip()
        if not workload_id:
            return {"connected": False, "error": "Missing workload id"}
        settings = AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return {"connected": False, "error": "No stored Run:ai connection settings configured"}
        if not self._api_base(settings):
            return {"connected": False, "error": "Run:ai control plane URL is not configured"}
        if not self._get_api_token(settings, company_id):
            return {"connected": False, "error": "Failed to obtain a Run:ai API access token"}

        wl = f"/api/v1/workloads/{workload_id}"
        details = self._api_get(settings, company_id, wl) or {}
        events = self._api_get(settings, company_id, f"{wl}/events") or {}
        logs = self._api_get(settings, company_id, f"{wl}/logs", {"tailLines": 200})
        metrics = self._api_get(
            settings,
            company_id,
            f"{wl}/metrics",
            [
                ("metricType", "GPU_UTILIZATION"),
                ("metricType", "GPU_MEMORY_USAGE_BYTES"),
                ("metricType", "CPU_USAGE_CORES"),
                ("metricType", "CPU_MEMORY_USAGE_BYTES"),
                ("numberOfSamples", "60"),
            ],
        )
        return {
            "connected": True,
            "workload_id": workload_id,
            "details": self._summarize_workload_details(details),
            "events": self._summarize_workload_events(events),
            "logs": self._summarize_api_logs(logs),
            "metrics": self._summarize_workload_metrics(metrics),
        }

    @classmethod
    def _summarize_workload_details(cls, data) -> dict:
        item = data.get("workload") if isinstance(data, dict) and isinstance(data.get("workload"), dict) else data
        item = item if isinstance(item, dict) else {}
        spec = item.get("spec") if isinstance(item.get("spec"), dict) else {}
        merged = {**spec, **item}
        return {
            "name": cls._pick(merged, ("name", "workloadName", "workload_name")) or "",
            "type": cls._pick(merged, ("type", "workloadType", "kind", "category")) or "",
            "status": cls._pick(merged, ("phase", "status", "state")) or "unknown",
            "project": cls._pick(merged, ("project", "projectName", "namespace")) or "",
            "cluster": cls._pick(merged, ("cluster", "clusterName", "clusterId")) or "",
            "image": cls._pick(merged, ("image", "imageName")) or "",
            "gpus": cls._find_number(merged, ("gpu", "gpus", "gpuDevices", "requestedGpus")),
            "node_pool": cls._pick(merged, ("nodePool", "node_pool", "nodePoolName")) or "",
            "command": cls._pick(merged, ("command", "cmd")) or "",
            "created": cls._pick(merged, ("createdAt", "creationTimestamp", "created")) or "",
            "submitted_by": cls._pick(merged, ("submittedBy", "user", "owner")) or "",
        }

    @classmethod
    def _summarize_workload_events(cls, data) -> list:
        rows = cls._as_list(data, ("events", "items", "data"))
        events = []
        for row in rows[:100]:
            if not isinstance(row, dict):
                continue
            events.append({
                "time": cls._pick(row, ("createdAt", "timestamp", "time", "creationTimestamp")) or "",
                "message": cls._pick(row, ("message", "description", "note")) or "",
                "reason": cls._pick(row, ("reason", "type", "eventType")) or "",
                "level": (cls._pick(row, ("type", "severity", "level")) or "").lower(),
            })
        return events

    @classmethod
    def _summarize_api_logs(cls, data) -> dict:
        if data is None:
            return {"lines": [], "source": "runai"}
        if isinstance(data, dict):
            raw = data.get("logs") or data.get("log") or data.get("raw") or ""
            lines = data.get("lines") if isinstance(data.get("lines"), list) else None
            if lines is None:
                lines = [ln for ln in str(raw).splitlines() if ln]
        elif isinstance(data, list):
            lines = [str(ln) for ln in data if str(ln)]
        else:
            lines = [ln for ln in str(data).splitlines() if ln]
        return {"lines": lines[-500:], "source": "runai"}

    @classmethod
    def _summarize_workload_metrics(cls, data) -> dict:
        series = cls._as_list(data, ("measurements", "metrics", "series", "data"))
        out = []
        averages = {}
        for entry in series:
            if not isinstance(entry, dict):
                continue
            metric_type = cls._pick(entry, ("type", "metricType", "name")) or ""
            values = entry.get("values") if isinstance(entry.get("values"), list) else []
            points = []
            nums = []
            for v in values:
                if isinstance(v, dict):
                    ts = cls._pick(v, ("timestamp", "time", "date")) or ""
                    num = cls._to_number(cls._pick(v, ("value", "val", "y")))
                else:
                    ts = ""
                    num = cls._to_number(v)
                if num is not None:
                    nums.append(num)
                points.append({"t": ts, "v": num})
            out.append({"type": metric_type, "points": points})
            if nums:
                averages[metric_type] = round(sum(nums) / len(nums), 2)
        return {"series": out, "averages": averages}

    @staticmethod
    def _as_list(data, keys) -> list:
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in keys:
                val = data.get(key)
                if isinstance(val, list):
                    return val
        return []

    @staticmethod
    def _to_number(value):
        try:
            if value is None or value == "":
                return None
            return float(value)
        except (TypeError, ValueError):
            return None

    # ------------------------------------------------------------------ #
    # Editable Run:ai CLI command templates ("Autoscalar Commands" tab)  #
    # ------------------------------------------------------------------ #
    @staticmethod
    def _catalog_keys() -> dict:
        return {
            version: {entry["key"] for entry in entries}
            for version, entries in RUNAI_COMMAND_CATALOG.items()
        }

    def get_command_templates(self, company_id: str) -> dict:
        settings = AutoscalerSettings.objects(company=company_id).first()
        overrides = self._command_overrides(settings) if settings else {}
        return {
            "catalog": RUNAI_COMMAND_CATALOG,
            "overrides": overrides,
        }

    def set_command_templates(self, company_id: str, overrides: dict) -> int:
        catalog_keys = self._catalog_keys()
        cleaned = {}
        if isinstance(overrides, dict):
            for version, commands in overrides.items():
                if version not in catalog_keys or not isinstance(commands, dict):
                    continue
                version_overrides = {}
                for key, command in commands.items():
                    if key not in catalog_keys[version]:
                        continue
                    text = (command or "").strip()
                    if text:
                        version_overrides[key] = text
                if version_overrides:
                    cleaned[version] = version_overrides

        result = AutoscalerSettings.objects(company=company_id).update_one(
            upsert=True,
            set_on_insert__id=db_id(),
            set__command_templates=json.dumps(cleaned),
            set__last_update=datetime.utcnow(),
        )
        return result

    @classmethod
    def _command_overrides(cls, conn) -> dict:
        raw = getattr(conn, "command_templates", None)
        data = cls._load_json(raw) if isinstance(raw, str) else raw
        if not isinstance(data, dict):
            return {}
        return data

    @classmethod
    def _command_override_argv(cls, conn, version: str, key: Optional[str], subs: Optional[dict]):
        if not key:
            return None
        overrides = cls._command_overrides(conn)
        template = (overrides.get(version) or {}).get(key)
        if not template or not str(template).strip():
            return None
        try:
            formatted = str(template).format_map(_SafeFormatDict(subs or {}))
            argv = shlex.split(formatted)
        except Exception:
            return None
        return argv or None

    @classmethod
    def _submit_prefix(cls, conn, version: str, wtype: str) -> list:
        if version == "v2":
            defaults = {
                "training": ["runai", "training", "standard", "submit"],
                "workspace": ["runai", "workspace", "submit"],
                "inference": ["runai", "inference", "submit"],
            }
            override = cls._command_override_argv(conn, "v2", f"submit_{wtype}", {})
            return override or defaults.get(wtype, ["runai", wtype, "submit"])
        override = cls._command_override_argv(conn, "v1", "submit", {})
        return override or ["runai", "submit"]

    def test_connection(self, company_id: str, user_id: str = None, worker_id: str = None) -> dict:
        settings = AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return {"status": "error", "stderr": "No stored Run:ai connection settings configured"}

        execution_id = self._enqueue_execution(
            company_id=company_id,
            operation="test_connection",
            payload={},
            user_id=user_id,
            worker_id=worker_id or getattr(settings, "worker", None),
        )
        return {"status": "queued", "execution_id": execution_id}

    def run_command_playground(
        self,
        company_id: str,
        version: str,
        key: str,
        command: str,
        placeholders: dict = None,
        user_id: str = None,
        worker_id: str = None,
    ) -> dict:
        settings = AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return {"status": "error", "stderr": "No stored Run:ai connection settings configured"}

        command = (command or "").strip()
        if not command:
            return {"status": "error", "stderr": "Missing command to execute"}

        version = (version or "v2").strip().lower()
        if version not in self._catalog_keys():
            version = "v2"

        execution_id = self._enqueue_execution(
            company_id=company_id,
            operation="command_playground",
            payload={
                "version": version,
                "key": key,
                "command": command,
                "placeholders": placeholders if isinstance(placeholders, dict) else {},
            },
            workload_name=key,
            user_id=user_id,
            worker_id=worker_id or getattr(settings, "worker", None),
        )
        return {"status": "queued", "execution_id": execution_id}

    def submit_workload(
        self, company_id: str, request: SubmitWorkloadRequest, user_id: str = None, worker_id: str = None
    ) -> dict:
        workload = request.workload
        conn = AutoscalerSettings.objects(company=company_id).first()

        if not workload:
            return {"status": "error", "stderr": "Missing workload data"}
        if not conn:
            return {"status": "error", "stderr": "No stored Run:ai connection settings configured"}

        self._save_app_instance(company_id, workload, status="submitted", user_id=user_id, worker_id=worker_id)
        execution_id = self._enqueue_execution(
            company_id=company_id,
            operation="submit",
            payload=workload.to_struct(),
            workload_type=workload.workload_type,
            workload_name=workload.workload_name,
            user_id=user_id,
            worker_id=worker_id or getattr(conn, "worker", None),
        )

        return {
            "status": "queued",
            "execution_id": execution_id,
        }

    def get_execution(self, company_id: str, execution_id: str) -> Optional[dict]:
        ex = AutoscalerExecution.objects(
            id=execution_id, company=company_id
        ).first()
        if not ex:
            return None
        return {
            "status": ex.status,
            "stdout": ex.stdout,
            "stderr": ex.stderr,
            "return_code": ex.return_code,
            "projects_count": ex.projects_count,
            "result_data": self._load_json(ex.result_data),
            "timestamp": ex.created.isoformat() if ex.created else None,
            "execution_id": ex.id,
        }

    def claim_pending_execution(self) -> Optional[AutoscalerExecution]:
        return AutoscalerExecution.objects(status="pending").order_by("created").modify(
            new=True,
            set__status="running",
        )

    def list_app_instances(self, company_id: str) -> list:
        return [
            self._serialize_app_instance(instance)
            for instance in AutoscalerAppInstance.objects(company=company_id).order_by("-created")
        ]

    def save_app_instance(
        self, company_id: str, request: SaveAppInstanceRequest, status: str = "saved",
        user_id: str = None, worker_id: str = None
    ) -> dict:
        return self._save_app_instance(company_id, request.workload, status=status, user_id=user_id, worker_id=worker_id)

    def _save_app_instance(
        self, company_id: str, workload: WorkloadRequest, status: str = "saved",
        user_id: str = None, worker_id: str = None
    ) -> dict:
        if not workload:
            return {"status": "error", "stderr": "Missing workload data"}
        name = workload.workload_name
        if not name:
            return {"status": "error", "stderr": "Missing workload name"}

        now = datetime.utcnow()
        params = json.dumps(workload.to_struct())
        existing = AutoscalerAppInstance.objects(
            company=company_id,
            project=workload.project or "",
            name=name,
        ).first()
        if existing:
            existing.update(
                set__last_update=now,
                set__workload_type=workload.workload_type,
                set__status=status,
                set__workload_params=params,
                set__user=user_id,
                set__worker=worker_id,
            )
            instance = AutoscalerAppInstance.objects(id=existing.id).first()
        else:
            instance = AutoscalerAppInstance(
                id=db_id(),
                company=company_id,
                created=now,
                last_update=now,
                name=name,
                project=workload.project or "",
                workload_type=workload.workload_type,
                status=status,
                workload_params=params,
                user=user_id,
                worker=worker_id,
            ).save()
        return {"status": "success", "instance": self._serialize_app_instance(instance)}

    def delete_workload(
        self, company_id: str, request: DeleteWorkloadRequest, user_id: str = None, worker_id: str = None
    ) -> dict:
        if request.instance_id:
            AutoscalerAppInstance.objects(id=request.instance_id, company=company_id).delete()

        settings = AutoscalerSettings.objects(company=company_id).first()
        if not request.workload_name:
            return {"status": "success", "stderr": "Missing workload name; removed saved instance only"}
        if not settings:
            return {"status": "success", "stderr": "No settings configured; removed saved instance only"}

        execution_id = self._enqueue_execution(
            company_id=company_id,
            operation="delete",
            payload=request.to_struct(),
            workload_type=request.workload_type,
            workload_name=request.workload_name,
            user_id=user_id,
            worker_id=worker_id or getattr(settings, "worker", None),
        )
        return {
            "status": "queued",
            "execution_id": execution_id,
        }

    def stop_workload(
        self, company_id: str, request: StopWorkloadRequest, user_id: str = None, worker_id: str = None
    ) -> dict:
        if not request.workload_name:
            return {"status": "error", "stderr": "Missing workload name"}

        settings = AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return {"status": "error", "stderr": "No stored Run:ai connection settings configured"}

        execution_id = self._enqueue_execution(
            company_id=company_id,
            operation="stop",
            payload=request.to_struct(),
            workload_type=request.workload_type,
            workload_name=request.workload_name,
            user_id=user_id,
            worker_id=worker_id or getattr(settings, "worker", None),
        )
        return {
            "status": "queued",
            "execution_id": execution_id,
        }

    def get_workload_logs(
        self, company_id: str, request: GetWorkloadLogsRequest, user_id: str = None, worker_id: str = None
    ) -> dict:
        """Return cached console logs for a single workload and queue a refresh.

        Logs are collected on ``runai_worker`` (which has the ``runai``/``oc``
        CLIs) by enqueuing a ``logs`` execution; the apiserver only serves the
        most recent cached result so it never shells out to a CLI it lacks.
        """
        settings = AutoscalerSettings.objects(company=company_id).first()
        name = (request.workload_name or "").strip()
        project = (request.project or "").strip()
        if not settings:
            return {
                "connected": False,
                "error": "No settings configured",
                **self._empty_workload_logs(name, project),
            }
        if not name:
            return {
                "connected": False,
                "error": "Missing workload name",
                **self._empty_workload_logs(name, project),
            }

        payload = {
            "workload_name": name,
            "workload_type": request.workload_type or "",
            "project": project,
            "tail": request.tail or "",
        }
        execution_id = self._enqueue_or_reuse_execution(
            company_id=company_id,
            operation="logs",
            payload=payload,
            match_payload={"workload_name": name, "project": project},
            user_id=getattr(settings, "user", None),
            worker_id=getattr(settings, "worker", None),
        )

        cached = self._latest_operation_result(
            company_id, "logs", match_payload={"workload_name": name, "project": project}
        )
        base = cached or {
            "connected": False,
            **self._empty_workload_logs(name, project),
        }
        return {
            **base,
            "refreshing": True,
            "execution_id": execution_id,
        }

    def get_dashboard(self, company_id: str) -> dict:
        """Return the latest dashboard snapshot and queue a refresh on the worker.

        The live Run:ai data is collected by ``runai_worker`` (which has the
        ``oc``/``runai`` CLIs installed); the apiserver only enqueues the
        refresh and serves the most recent cached result so it never shells out
        to a CLI it does not contain.
        """
        settings = AutoscalerSettings.objects(company=company_id).first()
        saved_instances = self.list_app_instances(company_id)
        if not settings:
            return {
                "connected": False,
                "error": "No settings configured",
                "timestamp": datetime.utcnow().isoformat(),
                **self._empty_dashboard_data(),
                "saved_instances": saved_instances,
            }

        execution_id = self._enqueue_or_reuse_execution(
            company_id=company_id,
            operation="dashboard",
            payload={},
            user_id=getattr(settings, "user", None),
            worker_id=getattr(settings, "worker", None),
        )

        cached = self._latest_operation_result(company_id, "dashboard")
        base = cached or {
            "connected": False,
            "timestamp": datetime.utcnow().isoformat(),
            **self._empty_dashboard_data(),
        }
        return {
            **base,
            "refreshing": True,
            "execution_id": execution_id,
            "saved_instances": saved_instances,
        }

    def get_project_resources(self, company_id: str, project: str = None) -> dict:
        """Return cached Run:ai project assets and queue a refresh on the worker.

        The actual ``runai ... list`` commands run on ``runai_worker``; the
        apiserver enqueues the lookup and returns the latest cached result.
        """
        settings = AutoscalerSettings.objects(company=company_id).first()
        project = (project or "").strip() or getattr(settings, "runai_project", None) or ""
        if not settings:
            return {
                "connected": False,
                "error": "No settings configured",
                **self._empty_project_resources(project),
            }

        execution_id = self._enqueue_or_reuse_execution(
            company_id=company_id,
            operation="project_resources",
            payload={"project": project},
            match_payload={"project": project},
            user_id=getattr(settings, "user", None),
            worker_id=getattr(settings, "worker", None),
        )

        cached = self._latest_operation_result(
            company_id, "project_resources", match_project=project
        )
        base = cached or {
            "connected": False,
            **self._empty_project_resources(project),
        }
        return {
            **base,
            "refreshing": True,
            "execution_id": execution_id,
        }

    def _collect_dashboard_data(self, conn, env: dict, company_id: str) -> dict:
        console_log = []
        self._set_runai_context(conn, env)
        workloads = self._runai_records_with_fallback(
            self._workload_list_commands(conn), env, console_log
        )
        nodes = self._runai_records_with_fallback(
            self._node_list_commands(conn), env, console_log
        )
        projects = self._runai_records_with_fallback(
            self._project_list_commands(conn), env, console_log
        )
        return {
            "connected": True,
            "timestamp": datetime.utcnow().isoformat(),
            **self._build_dashboard_data(workloads, nodes, projects, console_log),
            "saved_instances": self.list_app_instances(company_id),
        }

    def _collect_project_resources(self, conn, env: dict, project: str) -> dict:
        console_log = []
        self._set_runai_context(conn, env, project)
        projects = self._runai_records_with_fallback(
            self._project_list_commands(conn), env, console_log
        )
        compute_commands = self._compute_list_commands(conn, project)
        self._append_console_attempt(
            console_log,
            compute_commands,
            f"Attempting to fetch Run:ai compute resources for project '{project}'",
        )
        compute = self._runai_records_with_fallback(
            compute_commands, env, console_log
        )
        compute = self._describe_assets(
            conn, env, console_log, compute, self._compute_describe_commands, project
        )
        environment_commands = self._environment_list_commands(conn, project)
        self._append_console_attempt(
            console_log,
            environment_commands,
            f"Attempting to fetch Run:ai environments for project '{project}'",
        )
        environments = self._runai_records_with_fallback(
            environment_commands, env, console_log
        )
        environments = self._describe_assets(
            conn, env, console_log, environments, self._environment_describe_commands, project
        )
        datasource_commands = self._datasource_list_commands(conn, project)
        self._append_console_attempt(
            console_log,
            datasource_commands,
            f"Attempting to fetch Run:ai data sources for project '{project}'",
        )
        data_sources = self._runai_records_with_fallback(
            datasource_commands, env, console_log
        )
        data_sources = self._describe_assets(
            conn, env, console_log, data_sources, self._datasource_describe_commands, project
        )
        node_pools = self._runai_records_with_fallback(
            self._nodepool_list_commands(conn), env, console_log
        )
        return {
            "connected": True,
            "project": project,
            "projects": self._unique_names(self._asset_name(item) for item in projects),
            "compute": [self._summarize_compute(item) for item in compute],
            "environments": [self._summarize_environment(item) for item in environments],
            "data_sources": [self._summarize_data_source(item) for item in data_sources],
            "node_pools": self._unique_names(self._asset_name(item) for item in node_pools),
            "console_log": console_log[-20:],
        }

    def _describe_assets(
        self, conn, env: dict, console_log: list, items: list, describe_builder, project: str
    ) -> list:
        """Enrich each listed asset with the output of its ``describe`` command so
        the new-workload form has full details. Falls back to the list record when
        describe is unsupported or fails, and stops probing once it is clear the
        describe command is not available to avoid spamming the console log."""
        enriched = []
        describe_supported = True
        for item in items:
            name = self._asset_name(item)
            if not describe_supported or not name:
                enriched.append(item)
                continue
            detail = self._runai_object_with_fallback(
                describe_builder(conn, name, project, item), env, console_log
            )
            if not detail:
                describe_supported = False
                enriched.append(item)
                continue
            enriched.append(self._merge_asset_detail(item, detail))
        return enriched

    def _collect_workload_logs(self, conn, env: dict, payload: dict) -> dict:
        console_log = []
        name = (payload.get("workload_name") or "").strip()
        project = (payload.get("project") or "").strip()
        workload_type = (payload.get("workload_type") or "").strip()
        tail = (payload.get("tail") or "").strip()
        self._set_runai_context(conn, env, project)
        lines, source, success = self._fetch_workload_log_lines(
            conn, env, console_log, name, project, workload_type, tail
        )
        result = {
            "connected": success,
            "workload_name": name,
            "project": project,
            "source": source,
            "lines": lines[-self._log_line_limit:],
            "console_log": console_log[-20:],
            "timestamp": datetime.utcnow().isoformat(),
        }
        if not success:
            result["error"] = next(
                (entry.get("message") for entry in reversed(console_log) if entry.get("message")),
                "Could not read workload logs from Run:ai or OpenShift",
            )
        return result

    def _fetch_workload_log_lines(
        self, conn, env: dict, console_log: list, name: str, project: str,
        workload_type: str, tail: str
    ) -> tuple:
        for cmd in self._workload_logs_commands(conn, name, project, workload_type, tail):
            lines, success = self._log_lines_from_command(cmd, env, console_log)
            if success:
                return lines, "runai", True
        for cmd in self._oc_logs_commands(env, name, project, tail):
            lines, success = self._log_lines_from_command(cmd, env, console_log)
            if success:
                return lines, "openshift", True
        return [], "", False

    @classmethod
    def _log_lines_from_command(cls, cmd: list, env: dict, console_log: list) -> tuple:
        started = datetime.utcnow().isoformat()
        command = cls._redact_command(cmd)
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=45,
                env=env,
            )
        except FileNotFoundError as ex:
            console_log.append({
                "timestamp": started,
                "command": command,
                "status": "error",
                "message": f"CLI not found: {ex}",
            })
            return [], False

        console_log.append({
            "timestamp": started,
            "command": command,
            "status": "success" if result.returncode == 0 else "error",
            "message": (result.stderr or "").strip()[:500],
        })
        if result.returncode != 0:
            return [], False
        lines = [line.rstrip() for line in (result.stdout or "").splitlines()]
        return lines, True

    @classmethod
    def _workload_logs_commands(
        cls, conn, name: str, project: str, workload_type: str, tail: str
    ) -> list:
        tail = tail or "200"
        v2_commands = []
        if workload_type in {"training", "workspace", "inference"}:
            v2_commands.append(["runai", workload_type, "logs", name])
        v2_commands.extend([
            ["runai", "workload", "logs", name],
            ["runai", "training", "logs", name],
            ["runai", "logs", name],
        ])
        v2_commands = [[*cmd, "--tail", tail] for cmd in v2_commands]
        if project:
            v2_commands = [[*cmd, "--project", project] for cmd in v2_commands]

        v1_commands = [["runai", "logs", name, "--tail", tail]]
        if project:
            v1_commands = [[*cmd, "--project", project] for cmd in v1_commands]
        return cls._cli_candidates(
            conn, v2_commands, v1_commands,
            key="workload_logs",
            subs={"name": name, "project": project or "", "workload_type": workload_type or "", "tail": tail},
        )

    @classmethod
    def _oc_logs_commands(cls, env: dict, name: str, project: str, tail: str) -> list:
        oc_binary = cls._resolve_cli_binary(
            "oc", env, env_vars=cls._openshift_cli_env_vars
        )
        tail = tail or "200"
        selectors = [
            f"workloadName={name}",
            f"release={name}",
            f"app={name}",
            f"job-name={name}",
        ]
        namespaces = []
        if project:
            namespaces.extend([project, f"runai-{project}"])
        commands = []
        for namespace in namespaces or [None]:
            for selector in selectors:
                cmd = [
                    oc_binary, "logs",
                    "-l", selector,
                    "--all-containers=true",
                    "--tail", tail,
                    "--prefix=true",
                ]
                if namespace:
                    cmd.extend(["-n", namespace])
                commands.append(cmd)
        return commands

    @staticmethod
    def _empty_workload_logs(name: str, project: str) -> dict:
        return {
            "workload_name": name or "",
            "project": project or "",
            "source": "",
            "lines": [],
            "console_log": [],
            "timestamp": datetime.utcnow().isoformat(),
        }

    @staticmethod
    def _build_env(conn, config_dir: str) -> dict:
        env = os.environ.copy()
        AutoscalerBLL._add_default_cli_paths(env)
        env["KUBECONFIG"] = os.path.join(config_dir, "kubeconfig")
        env["RUNAI_CONFIG_DIR"] = os.path.join(config_dir, "runai")
        env["RUNAI_CLI_CONFIG_PATH"] = os.path.join(config_dir, "runai")
        env["HOME"] = config_dir
        if getattr(conn, "user", None):
            env["CLEARML_AUTOSCALER_USER"] = conn.user
        if getattr(conn, "worker", None):
            env["CLEARML_AUTOSCALER_WORKER"] = conn.worker
        return env

    def process_execution(self, execution: AutoscalerExecution) -> dict:
        conn = AutoscalerSettings.objects(company=execution.company).first()
        if not conn:
            return self._fail_execution(execution, "No stored Run:ai connection settings configured")

        config_dir = tempfile.mkdtemp(prefix="runai_")
        operation = (getattr(execution, "operation", None) or "submit").lower()

        try:
            env = self._build_env(conn, config_dir)
            self._establish_connection(conn, env)
            result = self._run_execution_operation(execution, conn, env, operation)
            return self._persist_execution_result(execution, result)
        except subprocess.TimeoutExpired:
            return self._fail_execution(execution, "Command timed out")
        except FileNotFoundError as ex:
            return self._fail_execution(execution, f"CLI not found: {ex}")
        except Exception as ex:
            log.exception("process_execution failed", extra={"execution_id": execution.id})
            return self._fail_execution(execution, str(ex))
        finally:
            shutil.rmtree(config_dir, ignore_errors=True)

    def _enqueue_execution(
        self,
        company_id: str,
        operation: str,
        payload: dict,
        workload_type: str = None,
        workload_name: str = None,
        user_id: str = None,
        worker_id: str = None,
    ) -> str:
        execution_id = db_id()
        AutoscalerExecution(
            id=execution_id,
            company=company_id,
            created=datetime.utcnow(),
            status="pending",
            operation=operation,
            workload_type=workload_type,
            workload_name=workload_name,
            workload_params=json.dumps(payload),
            user=user_id,
            worker=worker_id,
        ).save()
        return execution_id

    def _enqueue_or_reuse_execution(
        self,
        company_id: str,
        operation: str,
        payload: dict,
        match_payload: dict = None,
        user_id: str = None,
        worker_id: str = None,
    ) -> str:
        """Reuse an in-flight read execution if one matches, else enqueue a new one.

        Prevents flooding the worker queue when the dashboard auto-refreshes or
        the user reloads project assets repeatedly.
        """
        self._prune_operation_history(company_id, operation)
        active = AutoscalerExecution.objects(
            company=company_id,
            operation=operation,
            status__in=["pending", "running"],
        ).order_by("-created")
        for candidate in active:
            if match_payload is None or self._payload_matches(candidate, match_payload):
                return candidate.id
        return self._enqueue_execution(
            company_id=company_id,
            operation=operation,
            payload=payload,
            user_id=user_id,
            worker_id=worker_id,
        )

    def _latest_operation_result(
        self, company_id: str, operation: str, match_project: str = None, match_payload: dict = None
    ) -> Optional[dict]:
        query = AutoscalerExecution.objects(
            company=company_id,
            operation=operation,
            status="success",
            result_data__ne=None,
        ).order_by("-created").limit(10)
        for candidate in query:
            payload = self._load_json(candidate.workload_params) or {}
            if match_project is not None and (payload.get("project") or "") != match_project:
                continue
            if match_payload is not None and not all(
                (payload.get(key) or "") == (value or "") for key, value in match_payload.items()
            ):
                continue
            data = self._load_json(candidate.result_data)
            if data is not None:
                return data
        return None

    @classmethod
    def _prune_operation_history(cls, company_id: str, operation: str):
        AutoscalerExecution.objects(
            company=company_id,
            operation=operation,
            status__in=["success", "error"],
            created__lt=datetime.utcnow() - timedelta(hours=1),
        ).delete()

    @staticmethod
    def _payload_matches(execution: AutoscalerExecution, match_payload: dict) -> bool:
        payload = AutoscalerBLL._load_json(execution.workload_params) or {}
        return all(payload.get(key) == value for key, value in match_payload.items())

    @staticmethod
    def _load_json(value: Optional[str]):
        if not value:
            return None
        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None

    def _run_execution_operation(self, execution: AutoscalerExecution, conn, env: dict, operation: str):
        if operation == "test_connection":
            console_log = []
            # Apply the cluster/project context from the connection dialog first
            # (runai cluster set <name> / runai project set <name>) so that
            # `runai project list` has a cluster URL to talk to.
            self._set_runai_context(conn, env)
            for command in self._project_list_commands(conn):
                projects, success = self._runai_records_from_command(command, env, console_log)
                if success:
                    return SimpleNamespace(
                        returncode=0,
                        stdout="",
                        stderr="",
                        projects_count=len(projects),
                    )
            error = next(
                (entry.get("message") for entry in reversed(console_log) if entry.get("message")),
                "Unable to list Run:ai projects",
            )
            raise RuntimeError(error)
        if operation == "dashboard":
            data = self._collect_dashboard_data(conn, env, execution.company)
            return SimpleNamespace(
                returncode=0, stdout="", stderr="", result_data=json.dumps(data)
            )
        if operation == "project_resources":
            payload = self._load_json(execution.workload_params) or {}
            project = (payload.get("project") or "").strip()
            data = self._collect_project_resources(conn, env, project)
            return SimpleNamespace(
                returncode=0, stdout="", stderr="", result_data=json.dumps(data)
            )
        if operation == "logs":
            payload = self._load_json(execution.workload_params) or {}
            data = self._collect_workload_logs(conn, env, payload)
            return SimpleNamespace(
                returncode=0, stdout="", stderr="", result_data=json.dumps(data)
            )
        if operation == "submit":
            workload = self._workload_from_execution(execution)
            self._set_runai_context(conn, env, workload.project)
            return self._run_with_fallback(
                self._build_workload_cmds(conn, workload),
                env,
                timeout=120,
            )
        if operation == "delete":
            request = self._delete_request_from_execution(execution)
            self._set_runai_context(conn, env, request.project)
            return self._run_with_fallback(
                self._delete_workload_commands(conn, request),
                env,
                timeout=60,
            )
        if operation == "stop":
            request = self._delete_request_from_execution(execution)
            self._set_runai_context(conn, env, request.project)
            return self._run_with_fallback(
                self._stop_workload_commands(conn, request),
                env,
                timeout=60,
            )
        if operation == "command_playground":
            payload = self._load_json(execution.workload_params) or {}
            version = (payload.get("version") or "v2").strip().lower()
            key = payload.get("key")
            command = (payload.get("command") or "").strip()
            placeholders = payload.get("placeholders")
            if not isinstance(placeholders, dict):
                placeholders = {}
            if not command:
                raise RuntimeError("Missing command to execute")
            # Apply the cluster/project context from the connection settings first,
            # so context-dependent commands (e.g. project-scoped lists) resolve.
            self._set_runai_context(conn, env)
            try:
                formatted = command.format_map(_SafeFormatDict(placeholders))
                argv = shlex.split(formatted)
            except Exception as ex:
                raise RuntimeError(f"Invalid command: {ex}")
            if not argv:
                raise RuntimeError("Command is empty after substitution")
            binary = "runai-v2" if version == "v2" else "runai-v1"
            commands = self._apply_cli_binary([argv], binary)
            result = self._run_with_fallback(commands, env, timeout=120)
            result.result_data = json.dumps({
                "command": " ".join(commands[0]),
                "key": key,
                "version": version,
                "placeholders": placeholders,
            })
            return result
        raise RuntimeError(f"Unsupported execution operation: {operation}")

    @classmethod
    def _establish_connection(cls, conn, env: dict):
        cls._configure_runai_cp_url(conn, env)
        if cls._connection_method(conn) == "runai_application":
            cls._do_runai_login(conn, env)
        else:
            cls._do_oc_login(conn, env)

    @classmethod
    def _configure_runai_cp_url(cls, conn, env: dict):
        cp_url = getattr(conn, "runai_cp_url", None)
        if not cp_url:
            return
        version = (getattr(conn, "runai_cli_version", None) or "auto").lower()
        if version == "v1":
            # The Run:ai v1 CLI has no control-plane URL concept.
            return
        override = cls._command_override_argv(conn, "v2", "cp_url", {"cp_url": cp_url})
        default_cmd = ["runai", "config", "set", "--cp-url", cp_url]
        commands = cls._apply_cli_binary([override or default_cmd], "runai-v2")
        result = cls._run_with_fallback(commands, env, timeout=15)
        if result is not None and result.returncode != 0:
            raise RuntimeError(
                f"Failed to set Run:ai control plane URL: {result.stderr}"
            )

    @staticmethod
    def _connection_method(conn) -> str:
        method = (getattr(conn, "connection_method", None) or "").strip()
        if method in {"openshift", "runai_application"}:
            return method
        if getattr(conn, "openshift_api_url", None) or getattr(conn, "openshift_login_command", None):
            return "openshift"
        return "runai_application"

    @staticmethod
    def _do_oc_login(conn, env: dict):
        api_url, token = AutoscalerBLL._openshift_credentials(conn)
        if not api_url or not token:
            raise RuntimeError("OpenShift API URL and token are required")

        oc_binary = AutoscalerBLL._resolve_cli_binary(
            "oc",
            env,
            env_vars=AutoscalerBLL._openshift_cli_env_vars,
        )
        result = subprocess.run(
            [
                oc_binary, "login",
                api_url,
                "--token", token,
                "--insecure-skip-tls-verify=true",
            ],
            capture_output=True, text=True, timeout=30, env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(f"oc login failed: {result.stderr}")

    @classmethod
    def _add_default_cli_paths(cls, env: dict):
        path = env.get("PATH") or ""
        entries = [entry for entry in path.split(os.pathsep) if entry]
        for entry in cls._default_cli_paths:
            if entry not in entries:
                entries.append(entry)
        env["PATH"] = os.pathsep.join(entries)

    @classmethod
    def _resolve_cli_binary(cls, binary: str, env: dict = None, env_vars: tuple = ()) -> str:
        env = env or {}
        for env_var in env_vars:
            configured = env.get(env_var) or os.environ.get(env_var)
            if configured:
                return configured

        resolved = shutil.which(binary, path=env.get("PATH"))
        if resolved:
            return resolved

        for directory in cls._default_cli_paths:
            candidate = os.path.join(directory, binary)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate

        return binary

    @classmethod
    def _do_runai_login(cls, conn, env: dict):
        access_key = getattr(conn, "runai_access_key", None)
        secret_key = getattr(conn, "runai_secret_key", None)
        if not access_key or not secret_key:
            raise RuntimeError("Run:ai application access key and secret key are required")

        commands = cls._cli_candidates(
            conn,
            [
                [
                    "runai", "login", "application", "--client-id", access_key,
                    "--secret", secret_key, "--interactive", "disabled",
                ],
            ],
            [
                ["runai", "login", "application", "--name", access_key, "--secret", secret_key, "--interactive", "disabled"],
                ["runai", "login", "app", "--name", access_key, "--secret", secret_key, "--interactive", "disabled"],
            ],
            key="login",
            subs={"access_key": access_key, "secret_key": secret_key},
        )
        result = cls._run_with_fallback(commands, env, timeout=30)
        if result.returncode != 0:
            raise RuntimeError(f"runai login failed: {result.stderr}")

    @classmethod
    def _set_runai_context(cls, conn, env: dict, project_override: Optional[str] = None):
        if conn.runai_cluster:
            cls._run_with_fallback(
                cls._cli_candidates(conn, [
                    ["runai", "cluster", "set", conn.runai_cluster],
                ], [
                    ["runai", "config", "cluster", conn.runai_cluster],
                ], key="cluster_set", subs={"cluster": conn.runai_cluster}),
                env,
                timeout=15,
            )
        project = project_override or conn.runai_project
        if project:
            cls._run_with_fallback(
                cls._cli_candidates(conn, [
                    ["runai", "project", "set", project],
                ], [
                    ["runai", "config", "project", project],
                ], key="project_set", subs={"project": project}),
                env,
                timeout=15,
            )

    @staticmethod
    def _openshift_credentials(conn) -> tuple:
        command = getattr(conn, "openshift_login_command", None)
        mode = getattr(conn, "openshift_login_mode", None)
        if command and (mode == "command" or not getattr(conn, "openshift_api_url", None)):
            return AutoscalerBLL._parse_oc_login_command(command)
        return getattr(conn, "openshift_api_url", None), getattr(conn, "openshift_token", None)

    @staticmethod
    def _parse_oc_login_command(command: str) -> tuple:
        try:
            parts = shlex.split(command)
        except ValueError as ex:
            raise RuntimeError(f"Invalid oc login command: {ex}")

        api_url = None
        token = None
        idx = 0
        while idx < len(parts):
            part = parts[idx]
            if part.startswith("--token="):
                token = part.split("=", 1)[1]
            elif part == "--token" and idx + 1 < len(parts):
                idx += 1
                token = parts[idx]
            elif part.startswith("--server="):
                api_url = part.split("=", 1)[1]
            elif part == "--server" and idx + 1 < len(parts):
                idx += 1
                api_url = parts[idx]
            elif part.startswith("https://") or part.startswith("http://"):
                api_url = part
            idx += 1

        if not api_url or not token:
            raise RuntimeError("The oc login command must include a server URL and token")
        return api_url, token

    @classmethod
    def _runai_json(cls, cmd: list, env: dict, console_log: list) -> list:
        records, _ = cls._runai_records_from_command(cmd, env, console_log)
        return records

    @classmethod
    def _runai_records_with_fallback(cls, commands: list, env: dict, console_log: list) -> list:
        last_records = []
        for cmd in commands:
            records, success = cls._runai_records_from_command(cmd, env, console_log)
            last_records = records
            if success:
                return records
        return last_records

    @classmethod
    def _append_console_attempt(cls, console_log: list, commands: list, message: str):
        if not commands:
            return
        console_log.append({
            "timestamp": datetime.utcnow().isoformat(),
            "command": cls._redact_command(commands[0]),
            "status": "info",
            "message": message,
        })

    @classmethod
    def _runai_records_from_command(cls, cmd: list, env: dict, console_log: list) -> tuple:
        data, raw, success = cls._run_cli_json(cmd, env, console_log)
        if not success:
            return [], False
        if data is not None:
            return cls._extract_records(data), True
        records = cls._extract_table_records(raw)
        if not records:
            console_log.append({
                "timestamp": datetime.utcnow().isoformat(),
                "command": cls._redact_command(cmd),
                "status": "error",
                "message": "Run:ai returned non-JSON output",
            })
        return records, True

    @classmethod
    def _runai_object_with_fallback(cls, commands: list, env: dict, console_log: list) -> dict:
        last_object = {}
        for cmd in commands:
            obj, success = cls._runai_object_from_command(cmd, env, console_log)
            if success and obj:
                return obj
            if obj:
                last_object = obj
        return last_object

    @classmethod
    def _runai_object_from_command(cls, cmd: list, env: dict, console_log: list) -> tuple:
        data, _, success = cls._run_cli_json(cmd, env, console_log)
        if not success or data is None:
            return {}, False
        obj = cls._first_object(data)
        return obj, bool(obj)

    @classmethod
    def _run_cli_json(cls, cmd: list, env: dict, console_log: list) -> tuple:
        """Run a CLI command and return (parsed_json_or_None, raw_stdout, success)."""
        started = datetime.utcnow().isoformat()
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=45,
            env=env,
        )
        if result.returncode != 0 and "--no-pagination" in cmd:
            result = subprocess.run(
                [part for part in cmd if part != "--no-pagination"],
                capture_output=True,
                text=True,
                timeout=45,
                env=env,
            )
        command = cls._redact_command(cmd)
        console_log.append({
            "timestamp": started,
            "command": command,
            "status": "success" if result.returncode == 0 else "error",
            "message": (result.stderr or result.stdout or "").strip()[:500],
        })
        if result.returncode != 0 or not result.stdout:
            return None, result.stdout or "", False
        try:
            return json.loads(result.stdout), result.stdout, True
        except ValueError:
            return None, result.stdout, True

    @classmethod
    def _first_object(cls, data) -> dict:
        if isinstance(data, dict):
            for key in ("item", "resource", "result", "data"):
                value = data.get(key)
                if isinstance(value, dict):
                    return value
                if isinstance(value, list):
                    for entry in value:
                        if isinstance(entry, dict):
                            return entry
            return data
        if isinstance(data, list):
            for entry in data:
                if isinstance(entry, dict):
                    return entry
        return {}

    @staticmethod
    def _merge_asset_detail(base, detail) -> dict:
        """Merge a describe result (detail) over a list item (base), pulling up
        nested ``spec``/``meta`` so ``_pick`` based summaries find more fields."""
        if not isinstance(detail, dict):
            return base
        merged = dict(base) if isinstance(base, dict) else {}
        for nested_key in ("spec", "attributes"):
            nested = detail.get(nested_key)
            if isinstance(nested, dict):
                merged.update({k: v for k, v in nested.items() if v not in (None, "")})
        meta = detail.get("meta")
        if isinstance(meta, dict) and meta.get("name"):
            merged.setdefault("name", meta.get("name"))
        merged.update({
            k: v for k, v in detail.items()
            if k not in ("spec", "attributes", "meta") and v not in (None, "")
        })
        return merged

    @classmethod
    def _run_with_fallback(cls, commands: list, env: dict, timeout: int):
        last_result = None
        for cmd in commands:
            log.info(f"Executing: {cls._redact_command(cmd)}")
            last_result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=env,
            )
            if last_result.returncode == 0:
                return last_result
        return last_result

    @classmethod
    def _workload_from_execution(cls, execution: AutoscalerExecution) -> SimpleNamespace:
        try:
            payload = json.loads(execution.workload_params or "{}")
        except ValueError as ex:
            raise RuntimeError(f"Invalid workload parameters: {ex}")
        return cls._workload_from_dict(payload)

    @staticmethod
    def _delete_request_from_execution(execution: AutoscalerExecution) -> SimpleNamespace:
        try:
            payload = json.loads(execution.workload_params or "{}")
        except ValueError as ex:
            raise RuntimeError(f"Invalid delete request parameters: {ex}")
        return SimpleNamespace(
            instance_id=payload.get("instance_id"),
            workload_name=payload.get("workload_name"),
            workload_type=payload.get("workload_type"),
            project=payload.get("project"),
        )

    @classmethod
    def _workload_from_dict(cls, payload: dict):
        return SimpleNamespace(**{
            field: payload.get(field)
            for field in cls._workload_fields
        })

    @classmethod
    def _persist_execution_result(cls, execution: AutoscalerExecution, result) -> dict:
        status = "success" if result.returncode == 0 else "error"
        stdout = (result.stdout or "")[:cls._execution_log_limit]
        stderr = (result.stderr or "")[:cls._execution_log_limit]
        projects_count = getattr(result, "projects_count", None)
        result_data = getattr(result, "result_data", None)
        AutoscalerExecution.objects(id=execution.id).update_one(
            set__status=status,
            set__stdout=stdout,
            set__stderr=stderr,
            set__return_code=str(result.returncode),
            set__projects_count=projects_count,
            set__result_data=result_data,
        )
        cls._sync_saved_instance_status(execution, status)
        return {
            "status": status,
            "stdout": stdout,
            "stderr": stderr,
            "return_code": str(result.returncode),
            "projects_count": projects_count,
            "execution_id": execution.id,
        }

    @classmethod
    def _fail_execution(cls, execution: AutoscalerExecution, message: str) -> dict:
        truncated_message = (message or "")[:cls._execution_log_limit]
        AutoscalerExecution.objects(id=execution.id).update_one(
            set__status="error",
            set__stderr=truncated_message,
        )
        cls._sync_saved_instance_status(execution, "error")
        return {
            "status": "error",
            "stderr": truncated_message,
            "execution_id": execution.id,
        }

    @classmethod
    def _sync_saved_instance_status(cls, execution: AutoscalerExecution, status: str):
        operation = (getattr(execution, "operation", None) or "submit").lower()
        if operation == "submit":
            instance_status = status
        elif operation == "stop":
            instance_status = "stopped" if status == "success" else status
        else:
            return

        try:
            payload = json.loads(execution.workload_params or "{}")
        except ValueError:
            payload = {}

        AutoscalerAppInstance.objects(
            company=execution.company,
            project=payload.get("project") or "",
            name=execution.workload_name,
        ).update_one(
            set__status=instance_status,
            set__last_update=datetime.utcnow(),
        )

    @classmethod
    def _cli_candidates(cls, conn, v2_commands: list, v1_commands: list, key: str = None, subs: dict = None) -> list:
        version = (getattr(conn, "runai_cli_version", None) or "auto").lower()
        v2_override = cls._command_override_argv(conn, "v2", key, subs)
        v1_override = cls._command_override_argv(conn, "v1", key, subs)
        v2_cmds = [v2_override] if v2_override else v2_commands
        v1_cmds = [v1_override] if v1_override else v1_commands
        if version == "v1":
            return cls._apply_cli_binary(v1_cmds, "runai-v1")
        if version == "v2":
            return cls._apply_cli_binary(v2_cmds, "runai-v2")
        return [
            *cls._apply_cli_binary(v2_cmds, "runai-v2"),
            *cls._apply_cli_binary(v1_cmds, "runai-v1"),
        ]

    @staticmethod
    def _apply_cli_binary(commands: list, binary: str) -> list:
        resolved_binary = binary if shutil.which(binary) else "runai"
        return [
            [resolved_binary, *cmd[1:]] if cmd and cmd[0] == "runai" else cmd
            for cmd in commands
        ]

    @classmethod
    def _project_list_commands(cls, conn) -> list:
        return cls._cli_candidates(conn, [
            ["runai", "project", "list", "--json"],
            ["runai", "project", "list", "--json", "--no-pagination"],
        ], [
            ["runai", "list", "projects", "--json"],
            ["runai", "list", "projects"],
        ], key="project_list")

    @classmethod
    def _node_list_commands(cls, conn) -> list:
        return cls._cli_candidates(conn, [
            ["runai", "node", "list", "--json"],
        ], [
            ["runai", "list", "nodes", "--json"],
            ["runai", "list", "nodes"],
        ], key="node_list")

    @classmethod
    def _compute_list_commands(cls, conn, project: Optional[str] = None) -> list:
        return cls._cli_candidates(
            conn,
            cls._with_project([
                ["runai", "compute", "list", "--json"],
                ["runai", "compute", "list"],
            ], project),
            cls._with_project([
                ["runai", "list", "compute", "--json"],
                ["runai", "list", "compute"],
            ], project),
            key="compute_list",
            subs={"project": project or ""},
        )

    @classmethod
    def _environment_list_commands(cls, conn, project: Optional[str] = None) -> list:
        return cls._cli_candidates(
            conn,
            cls._with_project([
                ["runai", "environment", "list", "--json"],
                ["runai", "environment", "list"],
            ], project),
            cls._with_project([
                ["runai", "list", "environment", "--json"],
                ["runai", "list", "environment"],
            ], project),
            key="environment_list",
            subs={"project": project or ""},
        )

    @classmethod
    def _datasource_list_commands(cls, conn, project: Optional[str] = None) -> list:
        return cls._cli_candidates(
            conn,
            cls._with_project([
                ["runai", "datasource", "list", "--json"],
                ["runai", "datasource", "list"],
            ], project),
            cls._with_project([
                ["runai", "list", "datasource", "--json"],
                ["runai", "list", "datasource"],
            ], project),
            key="datasource_list",
            subs={"project": project or ""},
        )

    @classmethod
    def _compute_describe_commands(
        cls, conn, name: str, project: Optional[str] = None, item: Optional[dict] = None
    ) -> list:
        return cls._cli_candidates(
            conn,
            cls._with_project([
                ["runai", "compute", "describe", name, "-o", "json"],
                ["runai", "compute", "describe", name],
            ], project),
            cls._with_project([
                ["runai", "describe", "compute", name, "--json"],
                ["runai", "describe", "compute", name],
            ], project),
            key="compute_describe",
            subs={"name": name, "project": project or ""},
        )

    @classmethod
    def _environment_describe_commands(
        cls, conn, name: str, project: Optional[str] = None, item: Optional[dict] = None
    ) -> list:
        return cls._cli_candidates(
            conn,
            cls._with_project([
                ["runai", "environment", "describe", name, "-o", "json"],
                ["runai", "environment", "describe", name],
            ], project),
            cls._with_project([
                ["runai", "describe", "environment", name, "--json"],
                ["runai", "describe", "environment", name],
            ], project),
            key="environment_describe",
            subs={"name": name, "project": project or ""},
        )

    @classmethod
    def _datasource_describe_commands(
        cls, conn, name: str, project: Optional[str] = None, item: Optional[dict] = None
    ) -> list:
        source_type = cls._asset_value(
            item or {}, ("type", "kind", "dataSourceType", "data_source_type")
        )
        return cls._cli_candidates(
            conn,
            cls._with_project([
                *([
                    ["runai", "datasource", "describe", name, "--type", source_type, "-o", "json"],
                    ["runai", "datasource", "describe", name, "--type", source_type],
                ] if source_type else []),
                ["runai", "datasource", "describe", name],
            ], project),
            cls._with_project([
                ["runai", "describe", "datasource", name, "--json"],
                ["runai", "describe", "datasource", name],
            ], project),
            key="datasource_describe",
            subs={"name": name, "project": project or "", "type": source_type},
        )

    @classmethod
    def _nodepool_list_commands(cls, conn) -> list:
        return cls._cli_candidates(
            conn,
            [
                ["runai", "nodepool", "list", "--json"],
                ["runai", "nodepool", "list"],
            ],
            [
                ["runai", "list", "node-pools", "--json"],
                ["runai", "list", "node-pools"],
            ],
            key="nodepool_list",
        )

    @staticmethod
    def _with_project(commands: list, project: Optional[str]) -> list:
        if not project:
            return commands
        return [[*cmd, "--project", project] for cmd in commands] + commands

    @classmethod
    def _workload_list_commands(cls, conn) -> list:
        v2_cmd = ["runai", "workload", "list", "--json", "--no-pagination"]
        v1_cmd = ["runai", "list", "jobs", "--json"]
        project = getattr(conn, "runai_project", None)
        if project:
            v2_cmd = [*v2_cmd, "--project", project]
            v1_cmd = [*v1_cmd, "--project", project]
        else:
            v1_cmd.append("--all-projects")
        return cls._cli_candidates(conn, [v2_cmd], [v1_cmd, ["runai", "list", "jobs"]], key="workload_list", subs={"project": project or ""})

    @classmethod
    def _delete_workload_commands(cls, conn, request: DeleteWorkloadRequest) -> list:
        name = request.workload_name
        project = request.project or getattr(conn, "runai_project", None)
        workload_type = request.workload_type or "workload"
        v2_commands = [
            ["runai", "workload", "delete", name, "--force"],
            ["runai", "delete", "workload", name, "--force"],
        ]
        if workload_type in {"training", "workspace", "inference"}:
            v2_commands.insert(0, ["runai", workload_type, "delete", name, "--force"])
        if project:
            v2_commands = [[*cmd, "--project", project] for cmd in v2_commands]

        v1_commands = [
            ["runai", "delete", name],
            ["runai", "delete", "job", name],
        ]
        if project:
            v1_commands = [[*cmd, "--project", project] for cmd in v1_commands]
        return cls._cli_candidates(conn, v2_commands, v1_commands, key="delete_workload", subs={"name": name, "project": project or ""})

    @classmethod
    def _stop_workload_commands(cls, conn, request: StopWorkloadRequest) -> list:
        name = request.workload_name
        project = request.project or getattr(conn, "runai_project", None)
        workload_type = request.workload_type or "workload"
        v2_commands = [
            ["runai", "workload", "suspend", name],
            ["runai", "suspend", "workload", name],
        ]
        if workload_type in {"training", "workspace", "inference"}:
            v2_commands.insert(0, ["runai", workload_type, "suspend", name])
        if project:
            v2_commands = [[*cmd, "--project", project] for cmd in v2_commands]

        v1_commands = [
            ["runai", "suspend", name],
            ["runai", "suspend", "job", name],
        ]
        if project:
            v1_commands = [[*cmd, "--project", project] for cmd in v1_commands]
        return cls._cli_candidates(conn, v2_commands, v1_commands, key="stop_workload", subs={"name": name, "project": project or ""})

    @staticmethod
    def _redact_command(cmd: list) -> str:
        redacted = []
        redact_next = False
        for part in cmd:
            if redact_next:
                redacted.append("***")
                redact_next = False
                continue
            redacted.append(part)
            if part in {"--access-key", "--secret-key", "--token", "--secret", "--client-secret", "--password"}:
                redact_next = True
        return " ".join(redacted)

    @classmethod
    def _extract_records(cls, data) -> list:
        if isinstance(data, list):
            return data
        if not isinstance(data, dict):
            return []
        for key in ("items", "data", "workloads", "nodes", "projects", "results", "resources"):
            value = data.get(key)
            if isinstance(value, list):
                return value
            if isinstance(value, dict):
                nested = cls._extract_records(value)
                if nested:
                    return nested
        return []

    @staticmethod
    def _extract_table_records(output: str) -> list:
        lines = []
        for line in output.splitlines():
            text = line.strip()
            if not text:
                continue
            lowered = text.lower()
            if lowered.startswith(("warning", "info", "error")):
                continue
            if set(text) <= {"-", "+", "|", " "}:
                continue
            header_tokens = set(lowered.split())
            if (
                not lines
                and header_tokens & {"project", "name"}
                and header_tokens & {"status", "state", "phase"}
            ):
                continue
            lines.append({"raw": text})
        return lines

    @classmethod
    def _build_dashboard_data(cls, workloads: list, nodes: list, projects: list, console_log: list) -> dict:
        instances = [cls._summarize_workload(item) for item in workloads]
        status_counts = {}
        for instance in instances:
            status = (instance.get("status") or "unknown").lower()
            status_counts[status] = status_counts.get(status, 0) + 1

        idle_statuses = {"idle", "stopped", "suspended"}
        running_statuses = {"running", "ready", "active"}
        pending_statuses = {"pending", "initializing", "creating", "queued"}
        failed_statuses = {"failed", "error", "crashed", "evicted"}

        resources = cls._summarize_resources(nodes, projects, instances)
        queues = cls._summarize_queues(projects, instances)

        return {
            "idle_instances": sum(status_counts.get(status, 0) for status in idle_statuses),
            "running_instances": sum(status_counts.get(status, 0) for status in running_statuses),
            "pending_instances": sum(status_counts.get(status, 0) for status in pending_statuses),
            "failed_instances": sum(status_counts.get(status, 0) for status in failed_statuses),
            "total_instances": len(instances),
            "status_counts": status_counts,
            "resources": resources,
            "queues": queues,
            "instances": instances[:100],
            "console_log": console_log[-20:],
        }

    @classmethod
    def _summarize_workload(cls, item: dict) -> dict:
        return {
            "name": cls._pick(item, ("name", "workloadName", "workload_name", "id")) or "Unnamed workload",
            "workload_id": cls._pick(item, ("id", "uuid", "workloadId", "workload_id")),
            "type": cls._pick(item, ("type", "workloadType", "workload_type", "category")) or "",
            "status": cls._pick(item, ("status", "state", "phase", "workloadStatus")) or "unknown",
            "project": cls._pick(item, ("project", "projectName", "project_name", "namespace")) or "",
            "gpus": cls._find_number(item, ("gpu", "gpus", "gpuDevices", "gpu_devices", "requestedGpus")),
            "age": cls._pick(item, ("age", "createdAt", "created", "creationTimestamp")) or "",
        }

    @classmethod
    def _summarize_resources(cls, nodes: list, projects: list, instances: list) -> dict:
        gpu_total = sum(cls._find_number(node, ("gpuTotal", "totalGpus", "gpuDevices", "gpu_devices", "gpus")) for node in nodes)
        gpu_allocated = sum(cls._find_number(node, ("gpuAllocated", "allocatedGpus", "usedGpus", "gpuUsed")) for node in nodes)
        gpu_requested = sum(cls._find_number(instance, ("gpus",)) for instance in instances)
        cpu_total = sum(cls._find_number(node, ("cpuTotal", "totalCpu", "cpu", "cpus")) for node in nodes)
        cpu_allocated = sum(cls._find_number(node, ("cpuAllocated", "allocatedCpu", "usedCpu", "cpuUsed")) for node in nodes)
        return {
            "gpu_total": gpu_total,
            "gpu_allocated": gpu_allocated,
            "gpu_requested": gpu_requested,
            "cpu_total": cpu_total,
            "cpu_allocated": cpu_allocated,
            "node_count": len(nodes),
            "project_count": len(projects),
        }

    @classmethod
    def _summarize_queues(cls, projects: list, instances: list) -> list:
        queue_map = {}
        for project in projects:
            name = cls._pick(project, ("name", "projectName", "project_name", "id")) or "default"
            queue_map[name] = {
                "name": name,
                "running": 0,
                "pending": 0,
                "gpu_allocated": cls._find_number(project, ("allocatedGpus", "gpuAllocated", "usedGpus")),
                "gpu_limit": cls._find_number(project, ("gpuLimit", "gpu_limit", "limitGpus", "deservedGpus")),
            }

        for instance in instances:
            name = instance.get("project") or "default"
            queue = queue_map.setdefault(name, {
                "name": name,
                "running": 0,
                "pending": 0,
                "gpu_allocated": 0,
                "gpu_limit": 0,
            })
            status = (instance.get("status") or "").lower()
            if status in {"running", "ready", "active"}:
                queue["running"] += 1
            elif status in {"pending", "initializing", "creating", "queued"}:
                queue["pending"] += 1

        return list(queue_map.values())[:20]

    @staticmethod
    def _empty_dashboard_data(console_log: Optional[list] = None) -> dict:
        return {
            "idle_instances": 0,
            "running_instances": 0,
            "pending_instances": 0,
            "failed_instances": 0,
            "total_instances": 0,
            "status_counts": {},
            "resources": {
                "gpu_total": 0,
                "gpu_allocated": 0,
                "gpu_requested": 0,
                "cpu_total": 0,
                "cpu_allocated": 0,
                "node_count": 0,
                "project_count": 0,
            },
            "queues": [],
            "instances": [],
            "saved_instances": [],
            "console_log": console_log or [],
        }

    @staticmethod
    def _serialize_app_instance(instance: AutoscalerAppInstance) -> dict:
        workload = {}
        if instance.workload_params:
            try:
                workload = json.loads(instance.workload_params)
            except ValueError:
                workload = {}
        return {
            "id": instance.id,
            "name": instance.name,
            "project": instance.project,
            "type": instance.workload_type,
            "status": instance.status,
            "source": instance.source,
            "user": instance.user,
            "worker": instance.worker,
            "created": instance.created.isoformat() if instance.created else None,
            "last_update": instance.last_update.isoformat() if instance.last_update else None,
            "workload": workload,
        }

    @classmethod
    def _pick(cls, data: dict, keys: tuple):
        for key in keys:
            value = cls._get_nested(data, key)
            if value not in (None, ""):
                return value
        return None

    @staticmethod
    def _get_nested(data: dict, key: str):
        if not isinstance(data, dict):
            return None
        if key in data:
            return data[key]
        lowered = key.lower()
        for current_key, value in data.items():
            if str(current_key).lower() == lowered:
                return value
            if isinstance(value, dict):
                nested = AutoscalerBLL._get_nested(value, key)
                if nested not in (None, ""):
                    return nested
        return None

    @classmethod
    def _find_number(cls, data: dict, keys: tuple) -> float:
        value = cls._pick(data, keys)
        if isinstance(value, list):
            return float(len(value))
        if isinstance(value, dict):
            for nested_key in ("value", "count", "total", "allocated", "requested"):
                if nested_key in value:
                    return cls._coerce_number(value[nested_key])
            return 0
        return cls._coerce_number(value)

    @staticmethod
    def _coerce_number(value) -> float:
        if value in (None, ""):
            return 0
        if isinstance(value, (int, float)):
            return float(value)
        try:
            return float(str(value).strip().split()[0])
        except (TypeError, ValueError):
            return 0

    @classmethod
    def _asset_name(cls, item) -> str:
        if isinstance(item, str):
            return item.strip()
        if isinstance(item, dict):
            name = cls._pick(item, ("name", "displayName", "display_name", "meta_name", "id"))
            if name:
                return str(name)
            raw = item.get("raw")
            if isinstance(raw, str) and raw.strip():
                return raw.strip().split()[0]
        return ""

    @staticmethod
    def _unique_names(names) -> list:
        seen = []
        for name in names:
            cleaned = (name or "").strip()
            if cleaned and cleaned not in seen:
                seen.append(cleaned)
        return seen

    @classmethod
    def _summarize_compute(cls, item: dict) -> dict:
        return {
            "name": cls._asset_name(item),
            "gpu_devices_request": cls._asset_value(item, ("gpuDevicesRequest", "gpuDevices", "gpu", "gpus", "gpu_devices")),
            "gpu_memory_request": cls._asset_value(item, ("gpuMemoryRequest", "gpuMemory", "gpu_memory")),
            "gpu_portion_request": cls._asset_value(item, ("gpuPortionRequest", "gpuPortion", "gpu_portion")),
            "cpu_core_request": cls._asset_value(item, ("cpuCoreRequest", "cpuCores", "cpu", "cpu_cores")),
            "cpu_core_limit": cls._asset_value(item, ("cpuCoreLimit", "cpuCoresLimit", "cpuLimit", "cpu_core_limit")),
            "cpu_memory_request": cls._asset_value(item, ("cpuMemoryRequest", "cpuMemory", "memory", "cpu_memory")),
            "cpu_memory_limit": cls._asset_value(item, ("cpuMemoryLimit", "memoryLimit", "cpu_memory_limit")),
        }

    @classmethod
    def _summarize_environment(cls, item: dict) -> dict:
        return {
            "name": cls._asset_name(item),
            "image": cls._asset_value(item, ("image", "imageName", "image_name", "containerImage")),
            "command": cls._asset_text(item, ("command", "cmd")),
            "args": cls._asset_text(item, ("args", "arguments")),
            "working_dir": cls._asset_value(item, ("workingDir", "working_dir", "workingDirectory")),
            "environment_variables": cls._asset_env_vars(item),
        }

    @classmethod
    def _summarize_data_source(cls, item: dict) -> dict:
        return {
            "name": cls._asset_name(item),
            "type": cls._asset_value(item, ("type", "kind", "dataSourceType", "data_source_type")),
            "existing_pvc": cls._asset_value(item, ("claimName", "claim_name", "pvc", "existingPvc", "existing_pvc")),
            "path": cls._asset_value(item, ("path", "mountPath", "mount_path", "containerPath")),
        }

    @classmethod
    def _asset_value(cls, item, keys: tuple) -> str:
        value = cls._pick(item, keys)
        if value in (None, ""):
            return ""
        if isinstance(value, (list, dict)):
            return ""
        return str(value)

    @classmethod
    def _asset_text(cls, item, keys: tuple) -> str:
        """Like ``_asset_value`` but joins list values (e.g. a command/args
        array from a describe result) into a single space-separated string."""
        value = cls._pick(item, keys)
        if value in (None, ""):
            return ""
        if isinstance(value, (list, tuple)):
            return " ".join(str(part) for part in value if part not in (None, ""))
        if isinstance(value, dict):
            return ""
        return str(value)

    @classmethod
    def _asset_env_vars(cls, item) -> str:
        """Extract environment variables from a describe result and return them
        as a comma-joined ``KEY=VALUE`` string (the form's storage format)."""
        value = cls._pick(item, ("environmentVariables", "envVariables", "environment_variables", "env"))
        pairs = []
        if isinstance(value, dict):
            for key, val in value.items():
                if key:
                    pairs.append(f"{key}={'' if val is None else val}")
        elif isinstance(value, (list, tuple)):
            for entry in value:
                if isinstance(entry, dict):
                    name = entry.get("name") or entry.get("key") or entry.get("Name") or entry.get("Key")
                    val = entry.get("value")
                    if val is None:
                        val = entry.get("Value")
                    if name:
                        pairs.append(f"{name}={'' if val is None else val}")
                elif isinstance(entry, str) and "=" in entry:
                    pairs.append(entry.strip())
        return ",".join(pairs)

    @staticmethod
    def _empty_project_resources(project: str, console_log: Optional[list] = None) -> dict:
        return {
            "project": project or "",
            "projects": [],
            "compute": [],
            "environments": [],
            "data_sources": [],
            "node_pools": [],
            "console_log": (console_log or [])[-20:],
        }

    @classmethod
    def _build_workload_cmds(cls, conn, workload: WorkloadRequest) -> list:
        wtype = workload.workload_type or "training"

        if wtype not in ("training", "workspace", "inference"):
            raise ValueError(f"Unknown workload type: {wtype}")

        # ``cmd`` accumulates the workload arguments that follow the editable
        # submit base command (the prefix). The concrete prefix per CLI version
        # is resolved from the command-template catalog/overrides below.
        cmd = []

        if workload.workload_name:
            cmd.append(workload.workload_name)

        # Image
        if workload.image:
            cmd.extend(["-i", workload.image])

        # Template
        if workload.template:
            cmd.extend(["--template", workload.template])

        # Command
        if workload.command:
            cmd.extend(["-c", workload.command])

        # Environment variables
        if workload.environment_variables:
            for pair in workload.environment_variables.split(","):
                pair = pair.strip()
                if pair:
                    cmd.extend(["-e", pair])

        # CPU
        if workload.cpu_core_request:
            cmd.extend(["--cpu-core-request", workload.cpu_core_request])
        if workload.cpu_core_limit:
            cmd.extend(["--cpu-core-limit", workload.cpu_core_limit])
        if workload.cpu_memory_request:
            cmd.extend(["--cpu-memory-request", workload.cpu_memory_request])
        if workload.cpu_memory_limit:
            cmd.extend(["--cpu-memory-limit", workload.cpu_memory_limit])

        # GPU
        if workload.gpu_devices_request:
            cmd.extend(["-g", workload.gpu_devices_request])
        if workload.gpu_memory_request:
            cmd.extend(["--gpu-memory-request", workload.gpu_memory_request])
        if workload.gpu_portion_request:
            cmd.extend(["--gpu-portion-request", workload.gpu_portion_request])
        if workload.gpu_request_type:
            cmd.extend(["--gpu-request-type", workload.gpu_request_type])

        # Scheduling
        if workload.node_pools:
            cmd.extend(["--node-pools", workload.node_pools])
        if workload.node_type:
            cmd.extend(["--node-type", workload.node_type])
        if workload.priority:
            cmd.extend(["--priority", workload.priority])
        if workload.preemptibility:
            cmd.extend(["--preemptibility", workload.preemptibility])

        # Storage
        if workload.existing_pvc:
            cmd.extend(["--existing-pvc", workload.existing_pvc])
        if workload.working_dir:
            cmd.extend(["--working-dir", workload.working_dir])

        # Training-specific
        if wtype == "training":
            if workload.parallelism:
                cmd.extend(["--parallelism", workload.parallelism])
            if workload.runs:
                cmd.extend(["--runs", workload.runs])
            if workload.restart_policy:
                cmd.extend(["--restart-policy", workload.restart_policy])
            if workload.backoff_limit:
                cmd.extend(["--backoff-limit", workload.backoff_limit])

        # Workspace-specific
        if wtype == "workspace":
            if workload.external_url:
                cmd.extend(["--external-url", workload.external_url])

        # Inference-specific
        if wtype == "inference":
            if workload.serving_port:
                cmd.extend(["--serving-port", workload.serving_port])
            if workload.min_replicas:
                cmd.extend(["--min-replicas", workload.min_replicas])
            if workload.max_replicas:
                cmd.extend(["--max-replicas", workload.max_replicas])
            if workload.initial_replicas:
                cmd.extend(["--initial-replicas", workload.initial_replicas])
            if workload.metric:
                cmd.extend(["--metric", workload.metric])
            if workload.metric_threshold:
                cmd.extend(["--metric-threshold", workload.metric_threshold])
            if workload.scale_to_zero_retention:
                cmd.extend(["--scale-to-zero-retention-seconds", workload.scale_to_zero_retention])

        # Args after --
        if workload.args:
            cmd.append("--")
            cmd.extend(workload.args.split())

        prefix_v2 = cls._submit_prefix(conn, "v2", wtype)
        prefix_v1 = cls._submit_prefix(conn, "v1", wtype)
        v2_cmd = [*prefix_v2, *cmd]
        v1_cmd = [*prefix_v1, *cmd]

        return cls._cli_candidates(conn, [v2_cmd], [v1_cmd])
