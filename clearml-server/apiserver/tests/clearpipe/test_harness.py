import unittest

from apiserver.bll.clearpipe.graph_v2 import read_graph_v2

from .factories import (
    DeterministicClock,
    DeterministicIds,
    diagnostic,
    execution_state,
    invalid_graphs,
    migrated_document,
    permission,
    resource,
    valid_function_graph,
    valid_task_graph,
)
from .goldens import GoldenMismatch, assert_python_golden, golden_fixture


class FixtureHarnessTests(unittest.TestCase):
    def test_factories_are_deterministic_and_do_not_share_mutable_documents(self):
        first = valid_function_graph()
        second = valid_function_graph()
        self.assertEqual(first, second)

        first["nodes"][0]["label"] = "Changed"
        self.assertEqual(second["nodes"][0]["label"], "Normalize")
        self.assertEqual(
            {scenario.name for scenario in invalid_graphs()},
            {
                "cycle",
                "duplicate-node-name",
                "embedded-secret",
                "unknown-port",
                "unsupported-schema",
            },
        )
        self.assertTrue(read_graph_v2(second).is_supported)
        self.assertTrue(read_graph_v2(valid_task_graph()).is_supported)
        self.assertEqual(
            {scenario.name: read_graph_v2(scenario.document).status for scenario in invalid_graphs()},
            {
                "cycle": "ok",
                "duplicate-node-name": "invalid",
                "embedded-secret": "invalid",
                "unknown-port": "invalid",
                "unsupported-schema": "unsupported",
            },
        )

    def test_deterministic_ids_clock_and_migration_are_repeatable(self):
        ids = DeterministicIds()
        clock = DeterministicClock()
        self.assertEqual([ids.next("definition"), ids.next("run")], ["definition-0001", "run-0002"])
        self.assertEqual([clock.now(), clock.now()], ["2026-01-01T00:00:00Z", "2026-01-01T00:00:01Z"])
        self.assertEqual(migrated_document(valid_task_graph())["schema_version"], 2)
        self.assertEqual(resource("task-1", kind="task")["label"], "task-task-1")
        self.assertFalse(permission(can_run=False)["can_run"])
        self.assertEqual(execution_state(clock=clock)["updated_at"], "2026-01-01T00:00:02Z")
        self.assertEqual(diagnostic()["code"], "CPSEM001")


class GoldenHarnessTests(unittest.TestCase):
    def test_cp03_goldens_ignore_line_endings_and_reject_semantic_drift(self):
        for fixture_name in ("two-step-task.expected.py", "two-function.expected.py"):
            fixture = golden_fixture(fixture_name)
            expected = fixture.read_text(encoding="utf-8")
            assert_python_golden("\n" + expected.replace("\n", "\r\n"), fixture)

            with self.assertRaises(GoldenMismatch):
                assert_python_golden(expected.replace("PipelineController", "PipelineControllerChanged", 1), fixture)


if __name__ == "__main__":
    unittest.main()
