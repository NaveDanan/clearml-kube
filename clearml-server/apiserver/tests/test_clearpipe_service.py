import ast
import json
import unittest
from hashlib import sha256
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from apiserver.apierrors import errors
from apiserver.apimodels.clearpipe import GetAllRequest
from apiserver.services import clearpipe


FUNCTION_GRAPH = (
    Path(__file__).resolve().parents[3]
    / "clearml-web"
    / "src"
    / "app"
    / "features"
    / "clearpipe"
    / "domain"
    / "fixtures"
    / "function-graph.v2.json"
)
TASK_GRAPH = FUNCTION_GRAPH.with_name("task-graph.v2.json")


class FakeQuerySet:
    def __init__(self, tasks):
        self.tasks = list(tasks)

    def all_fields(self):
        return self

    def first(self):
        return self.tasks[0] if self.tasks else None

    def order_by(self, *_):
        return self

    def count(self):
        return len(self.tasks)

    def skip(self, _):
        return self

    def limit(self, _):
        return self

    def __iter__(self):
        return iter(self.tasks)


def task(company, origin=None):
    return SimpleNamespace(
        id="definition",
        company=company,
        company_origin=origin,
        project="project-a",
        name="Pipeline A",
        comment="",
    )


class ServiceCompanyIsolationTests(unittest.TestCase):
    def _with_task_model(self, item):
        model = Mock()
        model.objects.return_value = FakeQuerySet([item])
        return patch.object(clearpipe, "Task", model)

    def test_private_cross_company_read_and_write_are_rejected_even_if_db_returns_task(self):
        with self._with_task_model(task("company-a")):
            with self.assertRaises(errors.bad_request.InvalidTaskId):
                clearpipe._get_task("company-b", "definition")
            with self.assertRaises(errors.bad_request.InvalidTaskId):
                clearpipe._get_task("company-b", "definition", owned=True)

    def test_public_cross_company_read_allowed_but_mutation_is_origin_only(self):
        public = task("", "company-a")
        with self._with_task_model(public):
            self.assertIs(clearpipe._get_task("company-b", "definition"), public)
            with self.assertRaises(errors.bad_request.InvalidTaskId):
                clearpipe._get_task("company-b", "definition", owned=True)
            self.assertIs(
                clearpipe._get_task("company-a", "definition", owned=True), public
            )

    def test_public_run_project_is_created_in_requester_company(self):
        public = task("", "company-a")
        with patch.object(clearpipe, "_find_project", return_value="company-b-project") as find:
            project = clearpipe._run_project_for_definition(
                public, "company-b", "user-b"
            )
        self.assertEqual(project, "company-b-project")
        find.assert_called_once_with("company-b", "user-b", "Pipeline A", "")

    def test_private_run_keeps_definition_project(self):
        self.assertEqual(
            clearpipe._run_project_for_definition(
                task("company-a"), "company-a", "user-a"
            ),
            "project-a",
        )


class ServiceFailurePolicyTests(unittest.TestCase):
    @staticmethod
    def _start_call_and_request():
        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-a"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task="definition",
            revision=None,
            queue=None,
            parameters={},
            node_queues={},
            verify_watched_queue=False,
        )
        return call, request

    @staticmethod
    def _start_patches(*, clone_side_effect=None, enqueue_side_effect=None):
        definition = SimpleNamespace(
            id="definition",
            company="company-a",
            company_origin=None,
            project="project-a",
            name="Pipeline A",
            system_tags=[],
        )
        run = SimpleNamespace(id="run-1")
        compiled = {"script": "# controller", "configuration": {}}
        patches = [
            patch.object(clearpipe, "_get_task", return_value=definition),
            patch.object(clearpipe, "_revision", return_value=1),
            patch.object(clearpipe, "_graph", return_value={"nodes": [], "edges": []}),
            patch.object(clearpipe, "_validate_graph", return_value=SimpleNamespace(valid=True)),
            patch.object(clearpipe, "_assert_valid"),
            patch.object(clearpipe.queue_bll, "get_default", return_value=SimpleNamespace(id="queue-a")),
            patch.object(clearpipe, "_compile", return_value=compiled),
            patch.object(clearpipe, "_configurations", return_value={}),
            patch.object(clearpipe, "_run_project_for_definition", return_value="project-a"),
            patch.object(
                clearpipe.task_bll,
                "clone_task",
                return_value=(run, None),
                side_effect=clone_side_effect,
            ),
            patch.object(
                clearpipe,
                "enqueue_task",
                return_value=(True, None),
                side_effect=enqueue_side_effect,
            ),
        ]
        return patches, run

    def test_clone_failure_does_not_attempt_orphan_cleanup(self):
        call, request = self._start_call_and_request()
        task_model = Mock()
        patches, _ = self._start_patches(clone_side_effect=RuntimeError("clone failed"))
        with patch.object(clearpipe, "Task", task_model):
            with ExitStack() as stack:
                for item in patches:
                    stack.enter_context(item)
                with self.assertRaisesRegex(RuntimeError, "clone failed"):
                    clearpipe.start(call, "company-a", request)
        task_model.objects.assert_not_called()
        self.assertIsNone(call.result.data)

    def test_enqueue_failure_deletes_only_the_created_company_run(self):
        call, request = self._start_call_and_request()
        runtime_update = Mock()
        cleanup = Mock()
        task_model = Mock()
        task_model.objects.side_effect = [runtime_update, cleanup]
        patches, _ = self._start_patches(enqueue_side_effect=RuntimeError("enqueue failed"))
        with patch.object(clearpipe, "Task", task_model):
            with ExitStack() as stack:
                for item in patches:
                    stack.enter_context(item)
                with self.assertRaisesRegex(RuntimeError, "enqueue failed"):
                    clearpipe.start(call, "company-a", request)
        runtime_update.update_one.assert_called_once_with(
            set__runtime={"clearpipe_revision": 1, "_pipeline_hash": "clearpipe-v1"}
        )
        self.assertEqual(
            task_model.objects.call_args_list[1].kwargs,
            {
                "id": "run-1",
                "company": "company-a",
                "status": clearpipe.TaskStatus.created,
            },
        )
        cleanup.delete.assert_called_once_with()
        self.assertIsNone(call.result.data)

    def test_cleanup_failure_is_reported_as_unambiguous_internal_error(self):
        call, request = self._start_call_and_request()
        runtime_update = Mock()
        cleanup = Mock()
        cleanup.delete.side_effect = RuntimeError("delete failed")
        task_model = Mock()
        task_model.objects.side_effect = [runtime_update, cleanup]
        patches, _ = self._start_patches(enqueue_side_effect=RuntimeError("enqueue failed"))
        with patch.object(clearpipe, "Task", task_model):
            with ExitStack() as stack:
                for item in patches:
                    stack.enter_context(item)
                with self.assertRaises(errors.server_error.InternalError):
                    clearpipe.start(call, "company-a", request)
        cleanup.delete.assert_called_once_with()
        self.assertIsNone(call.result.data)

    def test_unsafe_get_all_refuses_page_instead_of_returning_short_count(self):
        queryset = FakeQuerySet([task("company-a")])
        model = Mock()
        model.objects.return_value = queryset
        call = SimpleNamespace(data={}, result=SimpleNamespace(data=None))
        with patch.object(clearpipe, "Task", model), patch.object(
            clearpipe,
            "_definition",
            side_effect=errors.bad_request.ValidationError("unsafe stored graph"),
        ):
            with self.assertRaises(errors.bad_request.ValidationError):
                clearpipe.get_all(call, "company-a", GetAllRequest())
        self.assertIsNone(call.result.data)

    def test_pre_enqueue_cleanup_is_company_status_scoped(self):
        deletion = Mock()
        model = Mock()
        model.objects.return_value = deletion
        run = SimpleNamespace(id="run-1")
        with patch.object(clearpipe, "Task", model):
            clearpipe._cleanup_unqueued_run(run, "company-a")
        model.objects.assert_called_once_with(
            id="run-1", company="company-a", status=clearpipe.TaskStatus.created
        )
        deletion.delete.assert_called_once_with()


class V2StartTests(unittest.TestCase):
    @staticmethod
    def _definition(graph, revision=7):
        return SimpleNamespace(
            id="definition",
            company="company-a",
            company_origin=None,
            project="project-a",
            name="Pipeline A",
            comment="",
            system_tags=[],
            runtime={"clearpipe_revision": revision},
            configuration={"ClearPipe": SimpleNamespace(value=json.dumps(graph))},
        )

    def test_start_clones_and_enqueues_compiled_controller_with_persisted_runtime_mapping(self):
        graph = json.loads(FUNCTION_GRAPH.read_text(encoding="utf-8"))
        definition = self._definition(graph)
        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-a"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task="definition",
            revision=7,
            queue=None,
            parameters={},
            node_queues={},
            verify_watched_queue=False,
        )
        run = SimpleNamespace(id="run-1")
        queue = SimpleNamespace(id="default")
        task_model = Mock()
        runtime_update = Mock()
        task_model.objects.return_value = runtime_update

        with patch.object(clearpipe, "_get_task", return_value=definition), patch.object(
            clearpipe.queue_bll, "get_by_id", return_value=queue
        ) as get_queue, patch.object(clearpipe.queue_bll, "get_default", return_value=queue), patch.object(
            clearpipe, "Task", task_model
        ), patch.object(
            clearpipe.task_bll, "clone_task", return_value=(run, None)
        ) as clone, patch.object(
            clearpipe, "enqueue_task", return_value=(True, None)
        ) as enqueue:
            clearpipe.start(call, "company-a", request)

        self.assertEqual(call.result.data, {"task": "run-1", "enqueued": True})
        clone_kwargs = clone.call_args.kwargs
        runtime = json.loads(clone_kwargs["configuration"]["ClearPipeRuntime"].value)
        self.assertNotIn("Pipeline", clone_kwargs["configuration"])
        self.assertEqual(runtime["definition_revision"], 7)
        self.assertEqual(
            runtime["runtime_steps"],
            [
                {"graph_node_id": "normalize", "pipeline_step_name": "normalize"},
                {"graph_node_id": "format-result", "pipeline_step_name": "format_result"},
            ],
        )
        script = clone_kwargs["script_overrides"]["diff"]
        self.assertIn("pipe.add_function_step", script)
        self.assertNotIn("DagRunner", script)
        self.assertTrue(script.endswith('if __name__ == "__main__":\n    pipe.start()\n'))
        run_runtime = runtime_update.update_one.call_args.kwargs["set__runtime"]
        self.assertEqual(run_runtime["clearpipe_revision"], 7)
        self.assertEqual(run_runtime["_pipeline_hash"], runtime["graph_digest"])
        provenance = run_runtime["clearpipe_runtime_provenance"]
        self.assertEqual(
            {
                key: value
                for key, value in provenance.items()
                if key != "signature"
            },
            {
                "schema_version": 1,
                "run_task_id": "run-1",
                "company_id": "company-a",
                "definition_task_id": "definition",
                "definition_revision": 7,
                "graph_digest": runtime["graph_digest"],
                "runtime_configuration_digest": sha256(
                    clone_kwargs["configuration"]["ClearPipeRuntime"].value.encode("utf-8")
                ).hexdigest(),
            },
        )
        self.assertEqual(
            provenance["signature"],
            clearpipe._runtime_provenance_signature(
                {key: value for key, value in provenance.items() if key != "signature"}
            ),
        )
        enqueue.assert_called_once_with(
            task_id="run-1",
            company_id="company-a",
            identity=call.identity,
            queue_id="default",
            status_message="Starting ClearPipe pipeline",
            status_reason="",
            validate=True,
        )
        get_queue.assert_called_once_with("company-a", "default", only=("id",))

    def test_start_rehydrates_declared_pipeline_parameter_for_task_child_steps(self):
        graph = json.loads(TASK_GRAPH.read_text(encoding="utf-8"))
        definition = self._definition(graph)
        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-a"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task="definition",
            revision=7,
            queue=None,
            parameters={"dataset_url": "override-url"},
            node_queues={},
            verify_watched_queue=False,
        )
        lookups = []

        def resource_checker(kind, resource_id, lookup=()):
            lookups.append((kind, resource_id, lookup))
            return True

        run = SimpleNamespace(id="run-1")
        queue = SimpleNamespace(id="default")
        task_model = Mock()
        task_model.objects.return_value = Mock()
        with patch.object(clearpipe, "_get_task", return_value=definition), patch.object(
            clearpipe, "_resource_checker", return_value=resource_checker
        ), patch.object(
            clearpipe, "_queue_checker", return_value=lambda _: True
        ), patch.object(
            clearpipe.queue_bll, "get_default", return_value=queue
        ), patch.object(
            clearpipe, "Task", task_model
        ), patch.object(
            clearpipe.task_bll, "clone_task", return_value=(run, None)
        ) as clone, patch.object(
            clearpipe, "enqueue_task", return_value=(True, None)
        ):
            clearpipe.start(call, "company-a", request)

        clone_kwargs = clone.call_args.kwargs
        override = clone_kwargs["hyperparams"]["Args"]["dataset_url"]
        self.assertEqual(
            (override.section, override.name, override.value),
            ("Args", "dataset_url", "override-url"),
        )
        script = clone_kwargs["script_overrides"]["diff"]
        ast.parse(script)
        self.assertIn(
            'parameter_override={"General/dataset_url": "${pipeline.dataset_url}"}',
            script,
        )
        self.assertIn("pipe.get_parameters()[_clearpipe_parameter_name]", script)
        self.assertIn('"dataset_url"', script)
        self.assertEqual(
            [lookup for lookup in lookups if lookup[2]],
            [
                (
                    "task",
                    "Pipeline step 1 dataset artifact",
                    (("name", "Pipeline step 1 dataset artifact"), ("project", "examples")),
                ),
                (
                    "task",
                    "Pipeline step 2 process dataset",
                    (("name", "Pipeline step 2 process dataset"), ("project", "examples")),
                ),
            ],
        )

    def test_start_rejects_unknown_v2_parameter_before_clone(self):
        definition = self._definition(
            json.loads(TASK_GRAPH.read_text(encoding="utf-8"))
        )
        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-a"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task="definition",
            revision=7,
            queue=None,
            parameters={"unknown": "value"},
            node_queues={},
            verify_watched_queue=False,
        )
        clone = Mock()

        with patch.object(clearpipe, "_get_task", return_value=definition), patch.object(
            clearpipe.task_bll, "clone_task", clone
        ):
            with self.assertRaises(errors.bad_request.ValidationError):
                clearpipe.start(call, "company-a", request)

        clone.assert_not_called()
        self.assertIsNone(call.result.data)

    def test_start_rejects_stale_v2_revision_before_creating_a_clone(self):
        definition = SimpleNamespace(id="definition", system_tags=[])
        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-a"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task="definition",
            revision=6,
            parameters={},
        )
        clone = Mock()

        with patch.object(clearpipe, "_get_task", return_value=definition), patch.object(
            clearpipe, "_revision", return_value=7
        ), patch.object(clearpipe.task_bll, "clone_task", clone):
            with self.assertRaises(clearpipe.RevisionConflict):
                clearpipe.start(call, "company-a", request)

        clone.assert_not_called()
        self.assertIsNone(call.result.data)

    def test_public_v2_definition_cannot_be_started_by_a_non_owner(self):
        graph = json.loads(FUNCTION_GRAPH.read_text(encoding="utf-8"))
        definition = SimpleNamespace(
            id="definition",
            company="",
            company_origin="company-a",
            system_tags=[],
            runtime={"clearpipe_revision": 7},
            configuration={"ClearPipe": SimpleNamespace(value=json.dumps(graph))},
        )
        call = SimpleNamespace(
            identity=SimpleNamespace(user="user-b"),
            result=SimpleNamespace(data=None),
        )
        request = SimpleNamespace(
            task="definition",
            revision=7,
            parameters={},
        )
        clone = Mock()

        with patch.object(clearpipe, "_get_task", return_value=definition), patch.object(
            clearpipe.task_bll, "clone_task", clone
        ):
            with self.assertRaises(errors.bad_request.ValidationError):
                clearpipe.start(call, "company-b", request)

        clone.assert_not_called()
        self.assertIsNone(call.result.data)


if __name__ == "__main__":
    unittest.main()
