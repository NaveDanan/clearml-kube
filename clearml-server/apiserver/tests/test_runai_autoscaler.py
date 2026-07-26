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


def api_response(data=None, text=None, status=200, content_type=None):
    response = MagicMock()
    response.status_code = status
    if text is None and data is not None:
        text = json.dumps(data)
    response.text = text or ""
    response.headers = {
        "Content-Type": content_type or ("application/json" if data is not None else "text/plain")
    }
    if data is None:
        response.json.side_effect = ValueError("not json")
    else:
        response.json.return_value = data
    if status >= 400:
        response.raise_for_status.side_effect = autoscaler_mod.requests.HTTPError(
            f"HTTP {status}", response=response
        )
    return response


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
            workload_logs_method="api",
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

    def test_workload_info_fetches_all_events_plain_text_logs_and_lifetime_metrics(self):
        self._settings(runai_cp_url="https://runai.example")
        details = {
            "id": "workload-id",
            "name": "train-one",
            "type": "runai-job",
            "phase": "Running",
            "projectName": "project-a",
            "clusterId": "cluster-id",
            "createdAt": "2026-07-13T08:00:00Z",
            "images": ["repo/image:latest"],
            "currentNodePools": ["gpu-pool"],
            "workloadRequestedResources": {"gpu": {"request": 1.5}},
            "command": "python train.py",
            "submittedBy": "user@example.com",
        }
        first_page = [
            {
                "createdAt": f"2026-07-14T08:{index % 60:02d}:00Z",
                "message": f"event-{index}",
                "reason": "Scheduled",
                "type": "Normal",
            }
            for index in range(500)
        ]
        final_event = {
            "createdAt": "2026-07-14T09:00:00Z",
            "message": "warning-event",
            "reason": "BackOff",
            "type": "Warning",
            "source": "kubelet",
            "involvedObject": {"kind": "Pod", "name": "train-one-0-0"},
        }
        log_lines = [f"line-{index}" for index in range(550)]
        metrics = {
            "measurements": [
                {
                    "type": "GPU_UTILIZATION",
                    "labels": {"gpu": "0"},
                    "values": [{"timestamp": "2026-07-14T08:00:00Z", "value": "10"}],
                },
                {
                    "type": "GPU_UTILIZATION",
                    "labels": {"gpu": "1"},
                    "values": [{"timestamp": "2026-07-14T08:00:00Z", "value": "30"}],
                },
            ]
        }
        metric_params = []

        def get_response(url, params=None, **_):
            if url.endswith("/events"):
                self.assertEqual(params["limit"], 500)
                self.assertEqual(params["sortOrder"], "asc")
                if params["offset"] == 0:
                    return api_response({"events": first_page, "next": 500})
                self.assertEqual(params["offset"], 500)
                return api_response({"events": [final_event]})
            if url.endswith("/logs"):
                self.assertIsNone(params)
                return api_response(text="\n".join(log_lines), content_type="text/plain")
            if url.endswith("/metrics"):
                metric_params.extend(params)
                return api_response(metrics)
            return api_response(details)

        token_response = api_response({"accessToken": "token", "expiresIn": 1800})
        with patch.object(autoscaler_mod.requests, "post", return_value=token_response) as post, \
             patch.object(autoscaler_mod.requests, "get", side_effect=get_response):
            result = self.bll.get_workload_info("company-id", "workload-id")

        post.assert_called_once_with(
            "https://runai.example/api/v1/token",
            json={
                "grantType": "client_credentials",
                "clientId": "access",
                "clientSecret": "secret",
            },
            timeout=self.bll._api_timeout,
        )
        self.assertTrue(result["connected"])
        self.assertFalse(result["partial"])
        self.assertEqual(len(result["events"]), 501)
        self.assertEqual(result["events"][-1]["level"], "warn")
        self.assertEqual(result["events"][-1]["event_type"], "Warning")
        self.assertEqual(result["events"][-1]["issuer"], "kubelet")
        self.assertEqual(result["events"][-1]["component"], "Pod")
        self.assertEqual(result["logs"]["lines"], log_lines)
        self.assertEqual(result["details"]["image"], "repo/image:latest")
        self.assertEqual(result["details"]["gpus"], 1.5)
        self.assertEqual(result["details"]["node_pool"], "gpu-pool")
        self.assertEqual(len(result["metrics"]["series"]), 2)
        self.assertEqual(
            {series["id"] for series in result["metrics"]["series"]},
            {"GPU_UTILIZATION:gpu=0", "GPU_UTILIZATION:gpu=1"},
        )
        self.assertEqual(result["metrics"]["averages"]["GPU_UTILIZATION"], 20)
        self.assertIn(("start", "2026-07-13T08:00:00.000Z"), metric_params)
        self.assertTrue(any(key == "end" and value.endswith("Z") for key, value in metric_params))
        self.assertIn(("numberOfSamples", "1000"), metric_params)
        self.assertEqual(
            [value for key, value in metric_params if key == "metricType"],
            list(self.bll._api_metric_types),
        )

    def test_workload_info_surfaces_terminal_log_failure_without_hiding_other_sections(self):
        self._settings(
            runai_cp_url="https://runai.example",
            runai_api_token="cached-token",
            runai_api_token_expiry=datetime.utcnow() + timedelta(hours=1),
        )
        details = {
            "name": "done",
            "phase": "Completed",
            "createdAt": "2026-07-14T08:00:00Z",
            "completedAt": "2026-07-14T09:00:00Z",
        }

        def get_response(url, **_):
            if url.endswith("/events"):
                return api_response({"events": []})
            if url.endswith("/logs"):
                return api_response({"message": "logs not found"}, status=404)
            if url.endswith("/metrics"):
                return api_response({"measurements": []})
            return api_response(details)

        with patch.object(autoscaler_mod.requests, "get", side_effect=get_response), \
             patch.object(autoscaler_mod.requests, "post") as post:
            result = self.bll.get_workload_info("company-id", "workload-id")

        post.assert_not_called()
        self.assertTrue(result["connected"])
        self.assertTrue(result["partial"])
        self.assertEqual(result["details"]["status"], "Completed")
        self.assertIn("does not expose logs", result["errors"]["logs"])
        self.assertEqual(result["metrics"]["range"], {
            "start": "2026-07-14T08:00:00.000Z",
            "end": "2026-07-14T09:00:00.000Z",
        })

    def test_workload_info_cli_logs_method_skips_logs_rest_endpoint(self):
        self._settings(
            runai_cp_url="https://runai.example",
            workload_logs_method="cli",
            runai_api_token="cached-token",
            runai_api_token_expiry=datetime.utcnow() + timedelta(hours=1),
        )
        requested_urls = []

        def get_response(url, **_):
            requested_urls.append(url)
            if url.endswith("/events"):
                return api_response({"events": []})
            if url.endswith("/metrics"):
                return api_response({"measurements": []})
            if url.endswith("/logs"):
                self.fail("CLI log mode must not call the workload logs REST endpoint")
            return api_response({"name": "train-one", "phase": "Running"})

        with patch.object(autoscaler_mod.requests, "get", side_effect=get_response):
            result = self.bll.get_workload_info("company-id", "workload-id")

        self.assertTrue(result["connected"])
        self.assertFalse(result["partial"])
        self.assertEqual(result["logs"], {"lines": [], "source": "Run:ai CLI"})
        self.assertFalse(any(url.endswith("/logs") for url in requested_urls))

    def test_token_url_appends_endpoint_to_control_plane_base_without_duplication(self):
        settings = self._settings(runai_cp_url="https://runai.example")
        self.assertEqual(
            self.bll._token_url(settings),
            "https://runai.example/api/v1/token",
        )

        settings.runai_cp_url = "https://runai.example/api/v1/token"
        self.assertEqual(
            self.bll._token_url(settings),
            "https://runai.example/api/v1/token",
        )

    def test_command_catalog_previews_full_token_request_with_connection_credentials_masked(self):
        self._settings(
            runai_cp_url="https://runai.example",
            runai_access_key="saved-client-id",
            runai_secret_key="saved-client-secret",
        )

        response = self.bll.get_command_templates("company-id")
        token_entry = next(
            entry for entry in response["catalog"]["v2"] if entry["key"] == "api_token"
        )

        preview = token_entry["request_preview"]
        self.assertIn('POST "https://runai.example/api/v1/token"', preview)
        self.assertIn('"grantType": "client_credentials"', preview)
        self.assertIn('"clientId": "saved-client-id"', preview)
        self.assertIn('"clientSecret": "******** (from Connection dialog)"', preview)
        self.assertNotIn("saved-client-secret", preview)
        self.assertIn("Run:ai Application Access Key", token_entry["credential_source"])

    def test_workload_info_surfaces_token_http_error_without_exposing_secret(self):
        self._settings(runai_cp_url="https://runai.example", runai_secret_key="super-secret")
        response = api_response(
            {"error": "invalid client secret super-secret"}, status=401
        )

        with patch.object(autoscaler_mod.requests, "post", return_value=response):
            result = self.bll.get_workload_info("company-id", "workload-id")

        self.assertFalse(result["connected"])
        self.assertIn("https://runai.example/api/v1/token", result["error"])
        self.assertIn("HTTP 401", result["error"])
        self.assertNotIn("super-secret", result["error"])
        self.assertIn("<redacted>", result["error"])

    def test_workload_info_uses_editable_api_command_overrides(self):
        overrides = {
            "v2": {
                "api_workload_details": "GET https://api-proxy.example/details/{workload_id}",
                "api_workload_events": "GET /custom/{workload_id}/events",
                "api_workload_logs": "GET /custom/{workload_id}/logs",
                "api_workload_metrics": "GET /custom/{workload_id}/metrics",
            }
        }
        self._settings(
            runai_cp_url="https://runai.example",
            runai_api_token="cached-token",
            runai_api_token_expiry=datetime.utcnow() + timedelta(hours=1),
            command_templates=json.dumps(overrides),
        )
        requested_urls = []

        def get_response(url, **_):
            requested_urls.append(url)
            if url.endswith("/events"):
                return api_response({"events": []})
            if url.endswith("/logs"):
                return api_response(text="")
            if url.endswith("/metrics"):
                return api_response({"measurements": []})
            return api_response({"name": "custom"})

        with patch.object(autoscaler_mod.requests, "get", side_effect=get_response):
            result = self.bll.get_workload_info("company-id", "id/with space")

        self.assertTrue(result["connected"])
        self.assertEqual(requested_urls, [
            "https://api-proxy.example/details/id%2Fwith%20space",
            "https://runai.example/custom/id%2Fwith%20space/events",
            "https://runai.example/custom/id%2Fwith%20space/logs",
            "https://runai.example/custom/id%2Fwith%20space/metrics",
        ])

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

    def test_run_command_playground_requires_settings_and_enqueues_execution(self):
        result = self.bll.run_command_playground(
            "company-id",
            version="v2",
            key="project_list",
            command="runai project list --json",
            placeholders={},
        )
        self.assertEqual(result["status"], "error")
        self.assertIn("No stored Run:ai connection settings configured", result["stderr"])

        self._settings(worker="stored-worker")
        result = self.bll.run_command_playground(
            "company-id",
            version="v2",
            key="project_list",
            command="runai project list --json",
            placeholders={"project": "project-a"},
            user_id="user-id",
            worker_id=None,
        )

        self.assertEqual(result["status"], "queued")
        execution = FakeExecution._store[0]
        self.assertEqual(execution.operation, "command_playground")
        self.assertEqual(execution.workload_name, "project_list")
        self.assertEqual(execution.user, "user-id")
        self.assertEqual(execution.worker, "stored-worker")
        self.assertEqual(
            json.loads(execution.workload_params),
            {
                "version": "v2",
                "key": "project_list",
                "command": "runai project list --json",
                "placeholders": {"project": "project-a"},
            },
        )

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
                "runai-v2", "login", "access-key", "--client-id", "access",
                "--secret", "secret", "--interactive", "disabled",
            ],
            commands,
        )
        self.assertIn(["runai-v2", "cluster", "set", "cluster-a"], commands)
        self.assertIn(["runai-v2", "project", "set", "project-a"], commands)
        self.assertIn([
            "runai-v2", "training", "standard", "submit", "train-one",
            "-p", "project-a", "-i", "repo/image:latest", "-g", "1",
            "--command", "--", "python", "train.py", "--epochs", "1",
        ], commands)

    def test_process_command_playground_executes_selected_version_and_persists_metadata(self):
        self._settings(runai_cli_version="auto")
        execution = self._execution(
            operation="command_playground",
            workload_name="project_list",
            workload_params=json.dumps({
                "version": "v1",
                "key": "project_list",
                "command": "runai list projects --json",
                "placeholders": {},
            }),
        )

        with patch.object(autoscaler_mod.tempfile, "mkdtemp", return_value="runai-tmp"), \
             patch.object(autoscaler_mod.shutil, "rmtree"), \
             patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/usr/local/bin/{binary}"), \
             patch.object(self.bll, "_establish_connection"), \
             patch.object(autoscaler_mod.subprocess, "run", return_value=completed(stdout='{"items":[]}')) as run:
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "success")
        self.assertEqual(execution.status, "success")
        self.assertEqual(execution.stdout, '{"items":[]}')
        self.assertEqual(run.call_args.args[0], ["runai-v1", "list", "projects", "--json"])
        self.assertEqual(
            json.loads(execution.result_data),
            {
                "command": "runai-v1 list projects --json",
                "key": "project_list",
                "version": "v1",
                "placeholders": {},
            },
        )

    def test_collect_project_resources_logs_fetch_attempts(self):
        conn = self._settings()

        with patch.object(self.bll, "_set_runai_context"), \
             patch.object(self.bll, "_project_list_commands", return_value=[["runai", "project", "list", "--json"]]), \
             patch.object(self.bll, "_compute_list_commands", return_value=[["runai", "compute", "list", "--json", "-p", "project-a"]]), \
             patch.object(self.bll, "_environment_list_commands", return_value=[["runai", "environment", "list", "--json", "-p", "project-a"]]), \
             patch.object(self.bll, "_datasource_list_commands", return_value=[["runai", "datasource", "list", "--json", "-p", "project-a"]]), \
               patch.object(self.bll, "_nodepool_list_commands", return_value=[["runai", "nodepool", "list", "--json"]]), \
             patch.object(self.bll, "_describe_assets", side_effect=lambda *args: args[3]), \
             patch.object(
                 self.bll,
                 "_runai_records_with_fallback",
                side_effect=[[{"name": "project-a"}], [], [], [], [], []],
             ):
            result = self.bll._collect_project_resources(conn, {}, "project-a")

        messages = [entry.get("message") for entry in result["console_log"]]
        statuses = [entry.get("status") for entry in result["console_log"]]

        self.assertIn("Attempting to fetch Run:ai compute resources for project 'project-a'", messages)
        self.assertIn("Attempting to fetch Run:ai environments for project 'project-a'", messages)
        self.assertIn("Attempting to fetch Run:ai data sources for project 'project-a'", messages)
        self.assertIn("Attempting to fetch Run:ai workload templates for project 'project-a'", messages)
        self.assertEqual(statuses.count("info"), 4)

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

        with patch.object(AutoscalerBLL, "_establish_connection"), \
             patch.object(AutoscalerBLL, "_set_runai_context"), \
             patch.object(AutoscalerBLL, "_project_list_commands", return_value=[["runai", "project", "list"]]), \
             patch.object(AutoscalerBLL, "_runai_records_from_command", return_value=([{"name": "one"}, {"name": "two"}], True)), \
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

        with patch.object(AutoscalerBLL, "_establish_connection"), \
             patch.object(AutoscalerBLL, "_set_runai_context"), \
             patch.object(AutoscalerBLL, "_project_list_commands", return_value=[["runai", "project", "list"]]), \
             patch.object(AutoscalerBLL, "_runai_records_from_command", side_effect=fail_command), \
             patch.object(autoscaler_mod.shutil, "rmtree"):
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "error")
        self.assertIn("authentication failed", execution.stderr)

    def test_process_connection_test_verifies_rest_token_when_control_plane_is_configured(self):
        self._settings(runai_cp_url="https://runai.example")
        execution = self._execution(operation="test_connection", workload_params="{}")

        with patch.object(AutoscalerBLL, "_establish_connection"), \
             patch.object(AutoscalerBLL, "_set_runai_context"), \
             patch.object(AutoscalerBLL, "_project_list_commands", return_value=[["runai", "project", "list"]]), \
             patch.object(AutoscalerBLL, "_runai_records_from_command", return_value=([{"name": "one"}], True)), \
             patch.object(self.bll, "_get_api_token_result", return_value=("token", None)) as get_token, \
             patch.object(autoscaler_mod.shutil, "rmtree"):
            result = self.bll.process_execution(execution)

        self.assertEqual(result["status"], "success")
        get_token.assert_called_once_with(FakeSettings._store[0], "company-id", force=True)

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

    def test_records_fallback_skips_empty_success_and_uses_non_empty_command(self):
        # The project-scoped command succeeds but returns no records; the bare
        # fallback command returns the real assets. The submit-workload dialog
        # must surface the non-empty result instead of the empty success.
        def fake_command(cmd, _env, _console_log):
            if "-p" in cmd:
                return [], True
            return [{"name": "compute-a"}], True

        with patch.object(AutoscalerBLL, "_runai_records_from_command", side_effect=fake_command):
            records = self.bll._runai_records_with_fallback(
                [
                    ["runai-v2", "compute", "list", "--json", "-p", "project-a"],
                    ["runai-v2", "compute", "list", "--json"],
                ],
                {},
                [],
            )

        self.assertEqual(records, [{"name": "compute-a"}])

    def test_extract_records_handles_unknown_v2_wrapper_keys(self):
        # Run:ai v2 wraps the collection under command-specific keys that are not
        # in the known-key list; the generic fallback must still find the assets.
        self.assertEqual(
            self.bll._extract_records({"compute": [{"meta": {"name": "c1"}}]}),
            [{"meta": {"name": "c1"}}],
        )
        self.assertEqual(
            self.bll._extract_records({"entries": [{"name": "env-a"}], "nextPageToken": "abc"}),
            [{"name": "env-a"}],
        )
        self.assertEqual(
            self.bll._extract_records({"datasources": [{"name": "d1", "type": "pvc"}]}),
            [{"name": "d1", "type": "pvc"}],
        )

    def test_extract_records_real_v2_environment_list_payload(self):
        # Exact shape returned by `runai-v2 environment list --json`.
        payload = {
            "environments": [
                {"name": "llm-server", "scope": "system", "image": "runai.jfrog.io/core-llm/runai-vllm:v0.6.4-0.10.0"},
                {"name": "pytorch", "scope": "tenant", "image": "nvcr.io/nvidia/pytorch:25.02-py3"},
            ]
        }
        records = self.bll._extract_records(payload)
        self.assertEqual([self.bll._asset_name(item) for item in records], ["llm-server", "pytorch"])
        summaries = [self.bll._summarize_environment(item) for item in records]
        self.assertEqual(summaries[0]["name"], "llm-server")
        self.assertEqual(summaries[0]["image"], "runai.jfrog.io/core-llm/runai-vllm:v0.6.4-0.10.0")

    def test_summarize_environment_merges_real_v2_describe_payload(self):
        # Exact shape returned by `runai-v2 environment describe <name> -o json`.
        list_item = {"name": "cline8000-gemma", "scope": "project", "image": "old:tag"}
        describe = {
            "meta": {"name": "cline8000-gemma", "scope": "project"},
            "spec": {
                "image": "dvd12af.rafael.local:5113/vllm/vllm-openai:gemma4-cu130",
                "command": "vllm serve /models/g-4-31-it",
                "args": "--host=0.0.0.0 --port=8000",
            },
        }
        merged = self.bll._merge_asset_detail(list_item, self.bll._first_object(describe))
        summary = self.bll._summarize_environment(merged)
        self.assertEqual(summary["name"], "cline8000-gemma")
        self.assertEqual(summary["image"], "dvd12af.rafael.local:5113/vllm/vllm-openai:gemma4-cu130")
        self.assertEqual(summary["command"], "vllm serve /models/g-4-31-it")
        self.assertEqual(summary["args"], "--host=0.0.0.0 --port=8000")

    def test_summarize_environment_includes_described_variables_and_security(self):
        detail = {
            "meta": {"name": "secure-env"},
            "spec": {
                "environmentVariables": [
                    {"name": "HOME", "value": "/home/app"},
                    {"name": "MODEL", "value": "gemma"},
                ],
                "runAsUid": 1000,
                "runAsGid": 2000,
                "supplementalGroups": "3000,4000",
            },
        }
        summary = self.bll._summarize_environment(
            self.bll._merge_asset_detail({}, detail)
        )

        self.assertEqual(summary["environment_variables"], "HOME=/home/app,MODEL=gemma")
        self.assertEqual(summary["run_as_uid"], "1000")
        self.assertEqual(summary["run_as_gid"], "2000")
        self.assertEqual(summary["supplemental_groups"], "3000,4000")

    def test_cli_version_selection_orders_candidates(self):
        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            v1 = self.bll._project_list_commands(SimpleNamespace(runai_cli_version="v1"))
            v2 = self.bll._project_list_commands(SimpleNamespace(runai_cli_version="v2"))
            auto = self.bll._project_list_commands(SimpleNamespace(runai_cli_version="auto"))

        self.assertTrue(all(command[0] == "runai-v1" for command in v1))
        self.assertTrue(all(command[0] == "runai-v2" for command in v2))
        self.assertEqual(auto[0][0], "runai-v2")
        self.assertEqual(auto[-1][0], "runai-v1")

    def test_v2_workload_logs_prefers_generic_cli_command_without_tail(self):
        with patch.object(autoscaler_mod.shutil, "which", return_value="/bin/runai-v2"):
            commands = self.bll._workload_logs_commands(
                SimpleNamespace(runai_cli_version="v2"),
                "train-one",
                "project-a",
                "training",
                "200",
            )

        self.assertEqual(
            commands[0],
            ["runai-v2", "workload", "logs", "train-one", "-p", "project-a"],
        )
        self.assertNotIn("--tail", commands[0])

    def test_command_catalog_declares_only_placeholders_used_by_commands(self):
        for version, entries in autoscaler_mod.RUNAI_COMMAND_CATALOG.items():
            for entry in entries:
                with self.subTest(version=version, key=entry["key"]):
                    for placeholder in entry.get("placeholders", []):
                        self.assertIn(
                            "{" + placeholder["name"] + "}",
                            entry["command"],
                        )
                    if any(
                        placeholder["name"] == "project"
                        for placeholder in entry.get("placeholders", [])
                    ) and entry["key"] != "project_set":
                        self.assertIn("-p {project}", entry["command"])

    def test_v1_catalog_does_not_advertise_v2_only_asset_commands(self):
        v1_keys = {entry["key"] for entry in autoscaler_mod.RUNAI_COMMAND_CATALOG["v1"]}
        self.assertTrue({
            "login",
            "compute_list",
            "compute_describe",
            "environment_list",
            "environment_describe",
            "datasource_list",
            "datasource_describe",
            "nodepool_list",
        }.isdisjoint(v1_keys))

    def test_workload_list_catalog_and_runtime_fetch_every_project_without_single_page_mode(self):
        catalog = {
            version: next(entry for entry in entries if entry["key"] == "workload_list")
            for version, entries in autoscaler_mod.RUNAI_COMMAND_CATALOG.items()
        }
        self.assertEqual(catalog["v2"]["command"], "runai workload list --json -A")
        self.assertEqual(catalog["v1"]["command"], "runai list jobs --all-projects")
        self.assertNotIn("--no-pagination", catalog["v2"]["command"])

        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            v2 = self.bll._workload_list_commands(SimpleNamespace(
                runai_cli_version="v2", runai_project="project-a"
            ))
            v1 = self.bll._workload_list_commands(SimpleNamespace(
                runai_cli_version="v1", runai_project="project-a"
            ))

        self.assertEqual(v2, [["runai-v2", "workload", "list", "--json", "-A"]])
        self.assertEqual(v1, [["runai-v1", "list", "jobs", "--all-projects"]])

    def test_legacy_workload_list_overrides_are_migrated_to_all_projects(self):
        conn = SimpleNamespace(
            runai_cli_version="auto",
            command_templates=json.dumps({
                "v2": {"workload_list": "runai workload list --json --no-pagination -p={project}"},
                "v1": {"workload_list": "runai list jobs -p {project}"},
            }),
        )

        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            commands = self.bll._workload_list_commands(conn)

        self.assertEqual(commands[0], ["runai-v2", "workload", "list", "--json", "-A"])
        self.assertEqual(commands[1], ["runai-v1", "list", "jobs", "--all-projects"])

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
            ["runai-v2", "compute", "describe", "compute-a", "-o", "json", "-p", "project-a"],
            compute,
        )
        self.assertIn(
            ["runai-v2", "environment", "describe", "env-a", "-o", "json", "-p", "project-a"],
            environment,
        )
        self.assertIn(
            ["runai-v2", "datasource", "describe", "data-a", "--type", "pvc", "-o", "json", "-p", "project-a"],
            datasource,
        )

    def test_v2_project_asset_commands_do_not_use_removed_aliases(self):
        conn = SimpleNamespace(runai_cli_version="v2")

        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            compute = self.bll._compute_list_commands(conn, "project-a")
            datasource = self.bll._datasource_list_commands(conn, "project-a")
            nodepool = self.bll._nodepool_list_commands(conn)

        self.assertIn(["runai-v2", "compute", "list", "--json", "-p", "project-a"], compute)
        self.assertNotIn(["runai-v2", "compute-resource", "list", "--json", "-p", "project-a"], compute)
        self.assertIn(["runai-v2", "datasource", "list", "--json", "-p", "project-a"], datasource)
        self.assertNotIn(["runai-v2", "data-source", "list", "--json", "-p", "project-a"], datasource)
        self.assertIn(["runai-v2", "nodepool", "list", "--json"], nodepool)
        self.assertNotIn(["runai-v2", "node-pool", "list", "--json"], nodepool)

    def test_project_asset_command_overrides_support_selected_project_placeholder(self):
        conn = SimpleNamespace(
            runai_cli_version="v2",
            command_templates=json.dumps({
                "v2": {
                    "compute_list": "runai compute list --json -p {selected_project}",
                    "environment_describe": "runai environment describe {name} -o json -p {selected_project}",
                }
            }),
        )

        with patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"):
            compute = self.bll._compute_list_commands(conn, "project-a")
            environment = self.bll._environment_describe_commands(conn, "env-a", "project-a")

        self.assertEqual(compute[0], ["runai-v2", "compute", "list", "--json", "-p", "project-a"])
        self.assertEqual(environment[0], ["runai-v2", "environment", "describe", "env-a", "-o", "json", "-p", "project-a"])

    def test_legacy_asset_override_without_project_is_repaired(self):
        conn = SimpleNamespace(
            runai_cli_version="v2",
            command_templates=json.dumps({
                "v2": {"compute_list": "runai compute list --json"},
            }),
        )

        with patch.object(autoscaler_mod.shutil, "which", return_value="/bin/runai-v2"):
            commands = self.bll._compute_list_commands(conn, "project-a")

        self.assertEqual(
            commands[0],
            ["runai-v2", "compute", "list", "--json", "-p", "project-a"],
        )

    def test_project_scoped_asset_commands_fall_back_to_context_project(self):
        commands = self.bll._with_project([["runai", "compute", "list", "--json"]], "project-a")

        self.assertEqual(commands[0], ["runai", "compute", "list", "--json", "-p", "project-a"])
        self.assertEqual(commands[1], ["runai", "compute", "list", "--json"])

    def test_saved_asset_commands_feed_submit_workload_card_resources(self):
        conn = SimpleNamespace(
            runai_cli_version="v2",
            command_templates=json.dumps({
                "v2": {
                    "compute_list": "runai compute list --json -p {project}",
                    "environment_list": "runai environment list --json -p {project}",
                    "datasource_list": "runai datasource list --json -p {project}",
                }
            }),
        )
        seen = []

        def fake_command(command, _env, _console_log):
            seen.append(command)
            if command[1:3] == ["project", "list"]:
                return [{"name": "project-a"}], True
            if command[1:3] == ["compute", "list"]:
                return [{"name": "compute-a", "gpuDevicesRequest": 1}], True
            if command[1:3] == ["environment", "list"]:
                return [{"name": "environment-a", "image": "image:a"}], True
            if command[1:3] == ["datasource", "list"]:
                return [{"name": "data-a", "type": "pvc"}], True
            return [], True

        with patch.object(self.bll, "_set_runai_context"), \
             patch.object(self.bll, "_describe_assets", side_effect=lambda *args: args[3]), \
             patch.object(autoscaler_mod.shutil, "which", side_effect=lambda binary: f"/bin/{binary}"), \
             patch.object(AutoscalerBLL, "_runai_records_from_command", side_effect=fake_command):
            result = self.bll._collect_project_resources(conn, {}, "project-a")

        self.assertEqual(result["compute"][0]["name"], "compute-a")
        self.assertEqual(result["environments"][0]["name"], "environment-a")
        self.assertEqual(result["data_sources"][0]["name"], "data-a")
        self.assertIn(["runai-v2", "compute", "list", "--json", "-p", "project-a"], seen)
        self.assertIn(["runai-v2", "environment", "list", "--json", "-p", "project-a"], seen)
        self.assertIn(["runai-v2", "datasource", "list", "--json", "-p", "project-a"], seen)

    def test_submit_command_includes_selected_asset_cards(self):
        workload = self.bll._workload_from_execution(SimpleNamespace(
            workload_params=json.dumps(self._workload(
                compute="compute-a",
                environment="environment-a,environment-b",
                data_sources=json.dumps([{"name": "data-a", "type": "pvc"}]),
            ).to_struct()),
        ))

        with patch.object(autoscaler_mod.shutil, "which", return_value="/bin/runai-v2"):
            command = self.bll._build_workload_cmds(
                SimpleNamespace(runai_cli_version="v2"), workload
            )[0]

        self.assertIn(["-p", "project-a"], [command[index:index + 2] for index in range(len(command) - 1)])
        self.assertIn(["--compute", "compute-a"], [command[index:index + 2] for index in range(len(command) - 1)])
        self.assertIn(["--environment", "environment-a"], [command[index:index + 2] for index in range(len(command) - 1)])
        self.assertNotIn("environment-b", command)
        self.assertIn(["--datasource", "type=pvc,name=data-a"], [command[index:index + 2] for index in range(len(command) - 1)])

    def test_submit_command_places_name_and_custom_command_around_args_marker(self):
        workload = self.bll._workload_from_execution(SimpleNamespace(
            workload_params=json.dumps(self._workload(
                command='python "train script.py"',
                args='--epochs 2 --label "night run"',
                run_as_uid="1000",
                run_as_gid="2000",
                supplemental_groups="3000,4000",
                large_shm=True,
            ).to_struct()),
        ))

        for version in ("v2", "v1"):
            with self.subTest(version=version), \
                 patch.object(autoscaler_mod.shutil, "which", return_value=f"/bin/runai-{version}"):
                command = self.bll._build_workload_cmds(
                    SimpleNamespace(runai_cli_version=version), workload
                )[0]

            submit_index = command.index("submit")
            marker_index = command.index("--")
            if version == "v2":
                self.assertEqual(command[submit_index + 1], "train-one")
                self.assertLess(command.index("train-one"), command.index("-p"))
            else:
                self.assertEqual(
                    command[submit_index + 1:submit_index + 3],
                    ["--name", "train-one"],
                )
                self.assertLess(command.index("--name"), command.index("-p"))
            self.assertIn("--command", command[:marker_index])
            self.assertNotIn("-c", command)
            self.assertEqual(
                command[marker_index + 1:],
                ["python", "train script.py", "--epochs", "2", "--label", "night run"],
            )
            pairs = [command[index:index + 2] for index in range(len(command) - 1)]
            self.assertIn(["--run-as-uid", "1000"], pairs)
            self.assertIn(["--run-as-gid", "2000"], pairs)
            self.assertIn(["--supplemental-groups", "3000,4000"], pairs)
            self.assertIn("--large-shm", command[:marker_index])

    def test_dashboard_uses_phase_and_returns_every_workload(self):
        phases = ("Running", "Completed", "Creating", "Initializing", "Pending", "Failed")
        workloads = [
            {
                "id": f"workload-{index}",
                "name": f"workload-{index}",
                "project": f"project-{index % 3}",
                "phase": phases[index % len(phases)],
                "status": "WrongStatus",
            }
            for index in range(137)
        ]

        dashboard = self.bll._build_dashboard_data(workloads, [], [], [])

        self.assertEqual(dashboard["total_instances"], 137)
        self.assertEqual(len(dashboard["instances"]), 137)
        self.assertEqual(dashboard["instances"][0]["status"], "Running")
        self.assertEqual(dashboard["instances"][1]["status"], "Completed")
        self.assertNotIn("wrongstatus", dashboard["status_counts"])

    def test_v1_workload_table_parser_retains_name_phase_and_project(self):
        output = (
            "NAME          STATUS        PROJECT       TYPE\n"
            "train-one     Running       project-a     Training\n"
            "workspace-a   Completed     project-b     Workspace\n"
        )

        records = self.bll._extract_table_records(output)
        summaries = [self.bll._summarize_workload(record) for record in records]

        self.assertEqual(
            [(item["name"], item["status"], item["project"]) for item in summaries],
            [
                ("train-one", "Running", "project-a"),
                ("workspace-a", "Completed", "project-b"),
            ],
        )

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
        self.assertEqual(records, [{"name": "project-a", "phase": "Running", "raw": "project-a Running"}])

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
