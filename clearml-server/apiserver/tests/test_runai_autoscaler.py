import json
import os
import subprocess
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from apiserver.bll import autoscaler as autoscaler_mod
from apiserver.bll.autoscaler import AutoscalerBLL
from apiserver.jobs import runai_worker


class FakeQuery:
    def __init__(self, model, filters):
        self.model = model
        self.filters = filters
        self._order_by = []

    def _matches(self, item):
        return all(getattr(item, key, None) == value for key, value in self.filters.items())

    def _items(self):
        items = [item for item in self.model._store if self._matches(item)]
        for field in reversed(self._order_by):
            reverse = field.startswith("-")
            key = field[1:] if reverse else field
            items.sort(key=lambda item: getattr(item, key, None), reverse=reverse)
        return items

    def first(self):
        items = self._items()
        return items[0] if items else None

    def order_by(self, *fields):
        self._order_by = fields
        return self

    def __iter__(self):
        return iter(self._items())

    def modify(self, new=False, **updates):
        item = self.first()
        if not item:
            return None
        self._apply_updates(item, updates)
        return item if new else None

    def update_one(self, upsert=False, **updates):
        item = self.first()
        if not item and upsert:
            values = dict(self.filters)
            if "set_on_insert__id" in updates:
                values["id"] = updates["set_on_insert__id"]
            item = self.model(**values).save()
        if not item:
            return 0
        self._apply_updates(item, updates)
        return 1

    def delete(self):
        before = len(self.model._store)
        self.model._store = [item for item in self.model._store if not self._matches(item)]
        return before - len(self.model._store)

    @staticmethod
    def _apply_updates(item, updates):
        for key, value in updates.items():
            if key.startswith("set__"):
                setattr(item, key[5:], value)


class FakeManager:
    def __init__(self, model):
        self.model = model

    def __call__(self, **filters):
        return FakeQuery(self.model, filters)


class FakeDocument:
    _store = []

    def __init_subclass__(cls):
        cls._store = []
        cls.objects = FakeManager(cls)

    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

    def __getattr__(self, _):
        return None

    def save(self):
        existing = next((item for item in self.__class__._store if getattr(item, "id", None) == getattr(self, "id", None)), None)
        if existing is None:
            self.__class__._store.append(self)
        return self


class FakeSettings(FakeDocument):
    pass


class FakeExecution(FakeDocument):
    pass


class FakeAppInstance(FakeDocument):
    pass


class Struct(SimpleNamespace):
    def to_struct(self):
        return dict(self.__dict__)


def completed(returncode=0, stdout="ok", stderr=""):
    return SimpleNamespace(returncode=returncode, stdout=stdout, stderr=stderr)


class TestAutoscalerBLL(unittest.TestCase):
    def setUp(self):
        for model in (FakeSettings, FakeExecution, FakeAppInstance):
            model._store = []

        self.patches = [
            patch.object(autoscaler_mod, "AutoscalerSettings", FakeSettings),
            patch.object(autoscaler_mod, "AutoscalerExecution", FakeExecution),
            patch.object(autoscaler_mod, "AutoscalerAppInstance", FakeAppInstance),
            patch.object(autoscaler_mod, "db_id", MagicMock(side_effect=[f"id-{idx}" for idx in range(100)])),
        ]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

        self.bll = AutoscalerBLL()

    def _settings(self, **overrides):
        data = dict(
            id="settings-id",
            company="company-id",
            connection_method="runai_application",
            runai_access_key="access",
            runai_secret_key="secret",
            runai_cluster="cluster-a",
            runai_project="project-a",
            runai_cli_version="v2",
            user="user-id",
            worker="worker-id",
        )
        data.update(overrides)
        return FakeSettings(**data).save()

    def _workload(self, **overrides):
        data = dict(
            workload_type="training",
            workload_name="train-one",
            project="project-a",
            image="repo/image:latest",
            command="python train.py",
            args="--epochs 1",
            gpu_devices_request="1",
        )
        data.update(overrides)
        return Struct(**data)

    def _execution(self, **overrides):
        data = dict(
            id="execution-id",
            company="company-id",
            created=datetime.utcnow(),
            status="running",
            operation="submit",
            workload_type="training",
            workload_name="train-one",
            workload_params=json.dumps(self._workload().to_struct()),
        )
        data.update(overrides)
        return FakeExecution(**data).save()

    def test_submit_workload_saves_instance_and_enqueues_execution(self):
        self._settings()
        result = self.bll.submit_workload(
            "company-id",
            Struct(workload=self._workload()),
            user_id="user-id",
            worker_id="worker-id",
        )

        self.assertEqual(result["status"], "queued")
        self.assertEqual(result["execution_id"], "id-1")
        self.assertEqual(len(FakeAppInstance._store), 1)
        self.assertEqual(FakeAppInstance._store[0].status, "submitted")
        self.assertEqual(len(FakeExecution._store), 1)
        execution = FakeExecution._store[0]
        self.assertEqual(execution.status, "pending")
        self.assertEqual(execution.operation, "submit")
        self.assertEqual(json.loads(execution.workload_params)["image"], "repo/image:latest")

    def test_set_company_settings_keeps_existing_document_id(self):
        settings = self._settings(id="existing-id", runai_project="old-project")

        updated = self.bll.set_company_settings(
            "company-id",
            Struct(runai_project="new-project"),
        )

        self.assertEqual(updated, 1)
        self.assertEqual(settings.id, "existing-id")
        self.assertEqual(settings.runai_project, "new-project")

    def test_test_connection_requires_saved_settings_and_enqueues_execution(self):
        result = self.bll.test_connection("company-id")
        self.assertEqual(result["status"], "error")
        self.assertIn("No stored Run:ai connection settings configured", result["stderr"])

        self._settings(worker="stored-worker")
        result = self.bll.test_connection(
            "company-id",
            user_id="user-id",
            worker_id=None,
        )

        self.assertEqual(result["status"], "queued")
        execution = FakeExecution._store[0]
        self.assertEqual(execution.operation, "test_connection")
        self.assertEqual(json.loads(execution.workload_params), {})
        self.assertEqual(execution.user, "user-id")
        self.assertEqual(execution.worker, "stored-worker")

    def test_delete_workload_handles_saved_only_and_enqueues_with_settings(self):
        saved = FakeAppInstance(id="app-id", company="company-id", name="train-one").save()
        result = self.bll.delete_workload(
            "company-id",
            Struct(instance_id=saved.id, workload_name="", workload_type="training", project="project-a"),
        )
        self.assertEqual(result["status"], "success")
        self.assertEqual(FakeAppInstance._store, [])

        self._settings(worker="stored-worker")
        result = self.bll.delete_workload(
            "company-id",
            Struct(instance_id=None, workload_name="train-one", workload_type="training", project="project-a"),
            worker_id=None,
        )

        self.assertEqual(result["status"], "queued")
        self.assertEqual(FakeExecution._store[0].operation, "delete")
        self.assertEqual(FakeExecution._store[0].worker, "stored-worker")

    def test_claim_pending_execution_claims_oldest(self):
        newer = self._execution(id="newer", status="pending", created=datetime.utcnow())
        older = self._execution(id="older", status="pending", created=datetime.utcnow() - timedelta(minutes=1))

        claimed = self.bll.claim_pending_execution()

        self.assertEqual(claimed.id, older.id)
        self.assertEqual(claimed.status, "running")
        self.assertEqual(newer.status, "pending")

    def test_process_execution_success_persists_result_and_syncs_saved_instance(self):
        self._settings()
        execution = self._execution()
        FakeAppInstance(
            id="app-id",
            company="company-id",
            project="project-a",
            name="train-one",
            status="submitted",
        ).save()

        with patch.object(autoscaler_mod.tempfile, "mkdtemp", return_value="runai-tmp"), \
             patch.object(autoscaler_mod.shutil, "rmtree"), \
             patch.object(autoscaler_mod.shutil, "which", return_value="/usr/local/bin/runai-v2"), \
             patch.object(autoscaler_mod.subprocess, "run", return_value=completed(stdout="submitted")) as run:
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "success")
        self.assertEqual(execution.status, "success")
        self.assertEqual(execution.stdout, "submitted")
        self.assertEqual(execution.return_code, "0")
        self.assertEqual(FakeAppInstance._store[0].status, "success")
        commands = [call.args[0] for call in run.call_args_list]
        self.assertIn(
            [
                "runai-v2", "login", "application", "--client-id", "access",
                "--secret", "secret", "--interactive", "disabled",
            ],
            commands,
        )
        self.assertIn(["runai-v2", "cluster", "set", "cluster-a"], commands)
        self.assertIn(["runai-v2", "project", "set", "project-a"], commands)
        self.assertIn(["runai-v2", "training", "standard", "submit", "train-one", "-i", "repo/image:latest", "-c", "python train.py", "-g", "1", "--", "--epochs", "1"], commands)

    def test_collect_project_resources_logs_fetch_attempts(self):
        conn = self._settings()

        with patch.object(self.bll, "_set_runai_context"), \
             patch.object(self.bll, "_project_list_commands", return_value=[["runai", "project", "list", "--json"]]), \
             patch.object(self.bll, "_compute_list_commands", return_value=[["runai", "compute", "list", "--json", "--project", "project-a"]]), \
             patch.object(self.bll, "_environment_list_commands", return_value=[["runai", "environment", "list", "--json", "--project", "project-a"]]), \
             patch.object(self.bll, "_datasource_list_commands", return_value=[["runai", "datasource", "list", "--json", "--project", "project-a"]]), \
               patch.object(self.bll, "_nodepool_list_commands", return_value=[["runai", "nodepool", "list", "--json"]]), \
             patch.object(self.bll, "_describe_assets", side_effect=lambda *args: args[3]), \
             patch.object(
                 self.bll,
                 "_runai_records_with_fallback",
                 side_effect=[[{"name": "project-a"}], [], [], [], []],
             ):
            result = self.bll._collect_project_resources(conn, {}, "project-a")

        messages = [entry.get("message") for entry in result["console_log"]]
        statuses = [entry.get("status") for entry in result["console_log"]]

        self.assertIn("Attempting to fetch Run:ai compute resources for project 'project-a'", messages)
        self.assertIn("Attempting to fetch Run:ai environments for project 'project-a'", messages)
        self.assertIn("Attempting to fetch Run:ai data sources for project 'project-a'", messages)
        self.assertEqual(statuses.count("info"), 3)

    def test_process_execution_command_failure_persists_error(self):
        self._settings()
        execution = self._execution()
        stderr = "x" * (AutoscalerBLL._execution_log_limit + 10)

        with patch.object(self.bll, "_establish_connection"), \
             patch.object(self.bll, "_run_execution_operation", return_value=completed(returncode=7, stderr=stderr)):
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "error")
        self.assertEqual(execution.status, "error")
        self.assertEqual(execution.return_code, "7")
        self.assertEqual(len(execution.stderr), AutoscalerBLL._execution_log_limit)

    def test_process_connection_test_persists_project_count(self):
        self._settings()
        execution = self._execution(operation="test_connection", workload_params="{}")

        with patch.object(self.bll, "_establish_connection"), \
             patch.object(self.bll, "_project_list_commands", return_value=[["runai", "project", "list"]]), \
             patch.object(self.bll, "_runai_records_from_command", return_value=([{"name": "one"}, {"name": "two"}], True)), \
             patch.object(autoscaler_mod.shutil, "rmtree"):
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["projects_count"], 2)
        self.assertEqual(execution.projects_count, 2)

    def test_process_connection_test_persists_cli_error(self):
        self._settings()
        execution = self._execution(operation="test_connection", workload_params="{}")
        console_error = [{"status": "error", "message": "authentication failed"}]

        def fail_command(_, __, console_log):
            console_log.extend(console_error)
            return [], False

        with patch.object(self.bll, "_establish_connection"), \
             patch.object(self.bll, "_project_list_commands", return_value=[["runai", "project", "list"]]), \
             patch.object(self.bll, "_runai_records_from_command", side_effect=fail_command), \
             patch.object(autoscaler_mod.shutil, "rmtree"):
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "error")
        self.assertIn("authentication failed", execution.stderr)

    def test_process_execution_missing_settings_persists_error(self):
        execution = self._execution()

        result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "error")
        self.assertEqual(execution.status, "error")
        self.assertIn("No stored Run:ai connection settings configured", execution.stderr)

    def test_process_execution_exception_paths_persist_errors(self):
        cases = [
            subprocess.TimeoutExpired(cmd="runai", timeout=1),
            FileNotFoundError("runai"),
            RuntimeError("boom"),
        ]

        for idx, error in enumerate(cases):
            with self.subTest(error=type(error).__name__):
                FakeSettings._store = []
                self._settings(id=f"settings-{idx}")
                execution = self._execution(id=f"execution-{idx}")
                with patch.object(autoscaler_mod.shutil, "rmtree"), \
                     patch.object(self.bll, "_establish_connection", side_effect=error):
                    result = self.bll.process_execution(execution)
                self.assertEqual(result["status"], "error")
                self.assertEqual(execution.status, "error")

    def test_process_execution_payload_and_operation_errors_persist_errors(self):
        self._settings()
        cases = [
            self._execution(id="bad-json", workload_params="{bad-json"),
            self._execution(id="bad-operation", operation="scale"),
            self._execution(id="bad-delete", operation="delete", workload_params="{bad-json"),
        ]

        for execution in cases:
            with self.subTest(execution=execution.id):
                with patch.object(self.bll, "_establish_connection"), \
                     patch.object(autoscaler_mod.shutil, "rmtree"):
                    result = self.bll.process_execution(execution)
                self.assertEqual(result["status"], "error")
                self.assertEqual(execution.status, "error")

    def test_cli_version_selection_orders_candidates(self):
        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            v1 = self.bll._project_list_commands(SimpleNamespace(runai_cli_version="v1"))
            v2 = self.bll._project_list_commands(SimpleNamespace(runai_cli_version="v2"))
            auto = self.bll._project_list_commands(SimpleNamespace(runai_cli_version="auto"))

        self.assertTrue(all(command[0] == "runai-v1" for command in v1))
        self.assertTrue(all(command[0] == "runai-v2" for command in v2))
        self.assertEqual(auto[0][0], "runai-v2")
        self.assertEqual(auto[-1][0], "runai-v1")

    def test_v2_project_asset_describe_commands_use_supported_json_flags(self):
        conn = SimpleNamespace(runai_cli_version="v2")

        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            compute = self.bll._compute_describe_commands(conn, "compute-a", "project-a")
            environment = self.bll._environment_describe_commands(conn, "env-a", "project-a")
            datasource = self.bll._datasource_describe_commands(
                conn,
                "data-a",
                "project-a",
                {"type": "pvc"},
            )

        self.assertIn(
            ["runai-v2", "compute", "describe", "compute-a", "-o", "json", "--project", "project-a"],
            compute,
        )
        self.assertIn(
            ["runai-v2", "environment", "describe", "env-a", "-o", "json", "--project", "project-a"],
            environment,
        )
        self.assertIn(
            ["runai-v2", "datasource", "describe", "data-a", "--type", "pvc", "-o", "json", "--project", "project-a"],
            datasource,
        )

    def test_v2_project_asset_commands_do_not_use_removed_aliases(self):
        conn = SimpleNamespace(runai_cli_version="v2")

        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            compute = self.bll._compute_list_commands(conn, "project-a")
            datasource = self.bll._datasource_list_commands(conn, "project-a")
            nodepool = self.bll._nodepool_list_commands(conn)

        self.assertIn(["runai-v2", "compute", "list", "--json", "--project", "project-a"], compute)
        self.assertNotIn(["runai-v2", "compute-resource", "list", "--json", "--project", "project-a"], compute)
        self.assertIn(["runai-v2", "datasource", "list", "--json", "--project", "project-a"], datasource)
        self.assertNotIn(["runai-v2", "data-source", "list", "--json", "--project", "project-a"], datasource)
        self.assertIn(["runai-v2", "nodepool", "list", "--json"], nodepool)
        self.assertNotIn(["runai-v2", "node-pool", "list", "--json"], nodepool)

    def test_project_scoped_asset_commands_fall_back_to_context_project(self):
        commands = self.bll._with_project([["runai", "compute", "list", "--json"]], "project-a")

        self.assertEqual(commands[0], ["runai", "compute", "list", "--json", "--project", "project-a"])
        self.assertEqual(commands[1], ["runai", "compute", "list", "--json"])

    def test_build_env_adds_default_cli_paths(self):
        with patch.dict(autoscaler_mod.os.environ, {"PATH": "/custom/bin"}, clear=True):
            env = self.bll._build_env(SimpleNamespace(), "runai-tmp")

        path_entries = env["PATH"].split(os.pathsep)
        self.assertEqual(path_entries[0], "/custom/bin")
        self.assertIn("/usr/local/bin", path_entries)
        self.assertIn("/opt/bin", path_entries)

    def test_oc_login_resolves_cli_from_subprocess_env_path(self):
        settings = SimpleNamespace(
            openshift_api_url="https://api.example:6443",
            openshift_token="token",
        )
        env = {"PATH": "/usr/local/bin:/usr/bin"}

        with patch.object(autoscaler_mod.shutil, "which", return_value="/usr/local/bin/oc") as which, \
             patch.object(autoscaler_mod.subprocess, "run", return_value=completed()) as run:
            self.bll._do_oc_login(settings, env)

        which.assert_called_once_with("oc", path=env["PATH"])
        run.assert_called_once()
        command = run.call_args.args[0]
        self.assertEqual(command[0], "/usr/local/bin/oc")
        self.assertEqual(command[1:4], ["login", "https://api.example:6443", "--token"])
        self.assertEqual(command[4], "token")
        self.assertIn("--insecure-skip-tls-verify=true", command)

    def test_oc_login_allows_configured_cli_path_override(self):
        settings = SimpleNamespace(
            openshift_api_url="https://api.example:6443",
            openshift_token="token",
        )
        env = {
            "PATH": "/usr/bin",
            "CLEARML_OPENSHIFT_CLI": "/custom/oc",
        }

        with patch.object(autoscaler_mod.shutil, "which") as which, \
             patch.object(autoscaler_mod.subprocess, "run", return_value=completed()) as run:
            self.bll._do_oc_login(settings, env)

        which.assert_not_called()
        self.assertEqual(run.call_args.args[0][0], "/custom/oc")

    def test_command_redaction_hides_sensitive_values(self):
        redacted = self.bll._redact_command([
            "runai",
            "login",
            "--access-key",
            "access",
            "--secret-key",
            "secret",
            "--token",
            "token",
        ])

        self.assertIn("--access-key ***", redacted)
        self.assertIn("--secret-key ***", redacted)
        self.assertIn("--token ***", redacted)
        self.assertNotIn("access ", redacted)
        self.assertNotIn("secret ", redacted)
        self.assertNotIn("token", redacted.replace("--token", ""))

    def test_runai_record_and_dashboard_parsing(self):
        self.assertEqual(self.bll._extract_records([{"name": "item"}]), [{"name": "item"}])
        self.assertEqual(self.bll._extract_records({"data": {"items": [{"name": "nested"}]}}), [{"name": "nested"}])

        console_log = []
        with patch.object(autoscaler_mod.subprocess, "run", return_value=completed(stdout='[{"name": "json"}]')):
            records, success = self.bll._runai_records_from_command(["runai", "project", "list", "--json"], {}, console_log)
        self.assertTrue(success)
        self.assertEqual(records, [{"name": "json"}])

        table = "NAME STATUS\nproject-a Running\n"
        with patch.object(autoscaler_mod.subprocess, "run", return_value=completed(stdout=table)):
            records, success = self.bll._runai_records_from_command(["runai", "list", "projects"], {}, console_log)
        self.assertTrue(success)
        self.assertEqual(records, [{"raw": "project-a Running"}])

        with patch.object(autoscaler_mod.subprocess, "run", return_value=completed(stdout="WARNING only\n")):
            records, success = self.bll._runai_records_from_command(["runai", "list", "projects"], {}, console_log)
        self.assertTrue(success)
        self.assertEqual(records, [])
        self.assertEqual(console_log[-1]["message"], "Run:ai returned non-JSON output")

        dashboard = self.bll._build_dashboard_data(
            workloads=[{"name": "w1", "status": "Running", "project": "project-a", "gpus": "2"}],
            nodes=[{"gpuTotal": 4, "gpuAllocated": 2, "cpuTotal": 16}],
            projects=[{"name": "project-a", "gpuLimit": 4}],
            console_log=[],
        )
        self.assertEqual(dashboard["running_instances"], 1)
        self.assertEqual(dashboard["resources"]["gpu_total"], 4)

    def test_get_dashboard_without_settings_returns_empty_dashboard(self):
        FakeAppInstance(id="app-id", company="company-id", name="saved", project="", status="saved").save()

        dashboard = self.bll.get_dashboard("company-id")

        self.assertFalse(dashboard["connected"])
        self.assertEqual(dashboard["total_instances"], 0)
        self.assertEqual(dashboard["saved_instances"][0]["name"], "saved")


class TestRunaiWorker(unittest.TestCase):
    def test_process_pending_respects_batch_size_and_stops(self):
        executions = [
            SimpleNamespace(id="one", workload_type="training", workload_name="one"),
            SimpleNamespace(id="two", workload_type="training", workload_name="two"),
            SimpleNamespace(id="three", workload_type="training", workload_name="three"),
        ]
        worker_bll = MagicMock()
        worker_bll.claim_pending_execution.side_effect = executions
        worker_bll.process_execution.return_value = {"status": "success", "return_code": "0"}

        with patch.object(runai_worker, "autoscaler_bll", worker_bll), \
             patch.object(runai_worker, "MAX_EXECUTIONS_PER_POLL", 2):
            processed = runai_worker.process_pending()

        self.assertEqual(processed, 2)
        self.assertEqual(worker_bll.process_execution.call_count, 2)

    def test_process_pending_continues_after_execution_failure(self):
        executions = [
            SimpleNamespace(id="one", workload_type="training", workload_name="one"),
            SimpleNamespace(id="two", workload_type="training", workload_name="two"),
            None,
        ]
        worker_bll = MagicMock()
        worker_bll.claim_pending_execution.side_effect = executions
        worker_bll.process_execution.side_effect = [RuntimeError("boom"), {"status": "success", "return_code": "0"}]
        worker_bll._fail_execution.return_value = {"status": "error", "return_code": ""}

        with patch.object(runai_worker, "autoscaler_bll", worker_bll), \
             patch.object(runai_worker, "MAX_EXECUTIONS_PER_POLL", 5):
            processed = runai_worker.process_pending()

        self.assertEqual(processed, 2)
        self.assertEqual(worker_bll._fail_execution.call_count, 1)
        self.assertEqual(worker_bll.process_execution.call_count, 2)


if __name__ == "__main__":
    unittest.main()
