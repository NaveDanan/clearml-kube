import json
import os
import shlex
import shutil
import subprocess
import tempfile
from datetime import datetime
from types import SimpleNamespace
from typing import Optional

from apiserver.apimodels.autoscaler import (
    DeleteWorkloadRequest,
    SaveAppInstanceRequest,
    SetSettingsRequest,
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


class AutoscalerBLL:

    _execution_log_limit = 10000
    _workload_fields = (
        "workload_type",
        "workload_name",
        "project",
        "image",
        "command",
        "args",
        "environment_variables",
        "template",
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
            set__id=db_id(),
            **update_dict,
        )
        return result

    def reset_company_settings(self, company_id: str) -> int:
        return AutoscalerSettings.objects(company=company_id).delete()

    def test_connection(self, company_id: str, request: Optional[SetSettingsRequest] = None) -> dict:
        request_data = request.to_struct() if request else {}
        settings = request if any(value not in (None, "") for value in request_data.values()) else AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return {"connected": False, "error": "No settings configured"}

        config_dir = None
        try:
            config_dir = tempfile.mkdtemp(prefix="runai_")
            env = self._build_env(settings, config_dir)

            self._establish_connection(settings, env)
            projects = self._runai_records_with_fallback(
                self._project_list_commands(settings),
                env,
                [],
            )

            return {"connected": True, "projects_count": len(projects)}

        except subprocess.TimeoutExpired:
            return {"connected": False, "error": "Connection timed out"}
        except FileNotFoundError as e:
            return {"connected": False, "error": f"CLI not found: {e}"}
        except Exception as e:
            log.exception("test_connection failed")
            return {"connected": False, "error": str(e)}
        finally:
            if config_dir:
                shutil.rmtree(config_dir, ignore_errors=True)

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

    def get_dashboard(self, company_id: str) -> dict:
        settings = AutoscalerSettings.objects(company=company_id).first()
        if not settings:
            return {
                "connected": False,
                "error": "No settings configured",
                "timestamp": datetime.utcnow().isoformat(),
                **self._empty_dashboard_data(),
                "saved_instances": self.list_app_instances(company_id),
            }

        config_dir = tempfile.mkdtemp(prefix="runai_")
        console_log = []

        try:
            env = self._build_env(settings, config_dir)
            self._establish_connection(settings, env)
            self._set_runai_context(settings, env)

            workloads = self._runai_records_with_fallback(
                self._workload_list_commands(settings),
                env,
                console_log,
            )
            nodes = self._runai_records_with_fallback(
                self._node_list_commands(settings),
                env,
                console_log,
            )
            projects = self._runai_records_with_fallback(
                self._project_list_commands(settings),
                env,
                console_log,
            )

            return {
                "connected": True,
                "timestamp": datetime.utcnow().isoformat(),
                **self._build_dashboard_data(workloads, nodes, projects, console_log),
                "saved_instances": self.list_app_instances(company_id),
            }

        except subprocess.TimeoutExpired:
            return {
                "connected": False,
                "error": "Run:ai dashboard refresh timed out",
                "timestamp": datetime.utcnow().isoformat(),
                **self._empty_dashboard_data(console_log),
                "saved_instances": self.list_app_instances(company_id),
            }
        except FileNotFoundError as e:
            return {
                "connected": False,
                "error": f"CLI not found: {e}",
                "timestamp": datetime.utcnow().isoformat(),
                **self._empty_dashboard_data(console_log),
                "saved_instances": self.list_app_instances(company_id),
            }
        except Exception as e:
            log.exception("get_dashboard failed")
            return {
                "connected": False,
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat(),
                **self._empty_dashboard_data(console_log),
                "saved_instances": self.list_app_instances(company_id),
            }
        finally:
            shutil.rmtree(config_dir, ignore_errors=True)

    @staticmethod
    def _build_env(conn, config_dir: str) -> dict:
        env = os.environ.copy()
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

    def _run_execution_operation(self, execution: AutoscalerExecution, conn, env: dict, operation: str):
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
        raise RuntimeError(f"Unsupported execution operation: {operation}")

    @classmethod
    def _establish_connection(cls, conn, env: dict):
        if cls._connection_method(conn) == "runai_application":
            cls._do_runai_login(conn, env)
        else:
            cls._do_oc_login(conn, env)

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

        result = subprocess.run(
            [
                "oc", "login",
                api_url,
                "--token", token,
                "--insecure-skip-tls-verify=true",
            ],
            capture_output=True, text=True, timeout=30, env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(f"oc login failed: {result.stderr}")

    @staticmethod
    def _do_runai_login(conn, env: dict):
        access_key = getattr(conn, "runai_access_key", None)
        secret_key = getattr(conn, "runai_secret_key", None)
        if not access_key or not secret_key:
            raise RuntimeError("Run:ai application access key and secret key are required")

        commands = [
            ["runai", "login", "application", "--name", access_key, "--secret", secret_key, "--interactive", "disabled"],
            ["runai", "login", "app", "--name", access_key, "--secret", secret_key, "--interactive", "disabled"],
            ["runai", "login", "--access-key", access_key, "--secret-key", secret_key],
        ]
        result = AutoscalerBLL._run_with_fallback(commands, env, timeout=30)
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
                ]),
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
                ]),
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
    def _runai_records_from_command(cls, cmd: list, env: dict, console_log: list) -> tuple:
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
            return [], False

        try:
            return cls._extract_records(json.loads(result.stdout)), True
        except ValueError:
            records = cls._extract_table_records(result.stdout)
            if not records:
                console_log.append({
                    "timestamp": datetime.utcnow().isoformat(),
                    "command": command,
                    "status": "error",
                    "message": "Run:ai returned non-JSON output",
                })
            return records, True

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
        AutoscalerExecution.objects(id=execution.id).update_one(
            set__status=status,
            set__stdout=stdout,
            set__stderr=stderr,
            set__return_code=str(result.returncode),
        )
        cls._sync_saved_instance_status(execution, status)
        return {
            "status": status,
            "stdout": stdout,
            "stderr": stderr,
            "return_code": str(result.returncode),
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
        if (getattr(execution, "operation", None) or "submit").lower() != "submit":
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
            set__status=status,
            set__last_update=datetime.utcnow(),
        )

    @classmethod
    def _cli_candidates(cls, conn, v2_commands: list, v1_commands: list) -> list:
        version = (getattr(conn, "runai_cli_version", None) or "auto").lower()
        if version == "v1":
            return cls._apply_cli_binary(v1_commands, "runai-v1")
        if version == "v2":
            return cls._apply_cli_binary(v2_commands, "runai-v2")
        return [
            *cls._apply_cli_binary(v2_commands, "runai-v2"),
            *cls._apply_cli_binary(v1_commands, "runai-v1"),
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
        ])

    @classmethod
    def _node_list_commands(cls, conn) -> list:
        return cls._cli_candidates(conn, [
            ["runai", "node", "list", "--json"],
        ], [
            ["runai", "list", "nodes", "--json"],
            ["runai", "list", "nodes"],
        ])

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
        return cls._cli_candidates(conn, [v2_cmd], [v1_cmd, ["runai", "list", "jobs"]])

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
        return cls._cli_candidates(conn, v2_commands, v1_commands)

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
            if part in {"--access-key", "--secret-key", "--token", "--secret", "--password"}:
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
            if any(header in lowered for header in ("project", "name", "status")) and not lines:
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
    def _build_workload_cmds(cls, conn, workload: WorkloadRequest) -> list:
        wtype = workload.workload_type or "training"

        if wtype == "training":
            cmd = ["runai", "training", "standard", "submit"]
        elif wtype == "workspace":
            cmd = ["runai", "workspace", "submit"]
        elif wtype == "inference":
            cmd = ["runai", "inference", "submit"]
        else:
            raise ValueError(f"Unknown workload type: {wtype}")

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

        if wtype == "training":
            v1_tail = cmd[4:]
        else:
            v1_tail = cmd[3:]
        v1_cmd = ["runai", "submit", *v1_tail]

        return cls._cli_candidates(conn, [cmd], [v1_cmd])
