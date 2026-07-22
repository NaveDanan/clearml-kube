"""Typed handoff contracts for the deterministic ClearPipe source compiler.

CP-12 and CP-13 consume these data-only interfaces.  They do not launch
pipelines and do not expose a browser code generator.
"""

from dataclasses import dataclass
from typing import Mapping, Tuple

from ..graph_v2 import Binding, FunctionNode, GraphNode, GraphV2, TaskNode


@dataclass(frozen=True)
class SourceMapEntry:
    """A generated source span attributable to one stable graph element."""

    graph_element_id: str
    start_line: int
    end_line: int


@dataclass(frozen=True)
class RuntimeStepIdentity:
    """One unambiguous PipelineController step identity for a graph node."""

    graph_node_id: str
    pipeline_step_name: str

    def to_dict(self) -> dict:
        return {
            "graph_node_id": self.graph_node_id,
            "pipeline_step_name": self.pipeline_step_name,
        }


@dataclass(frozen=True)
class SourceManifest:
    """Deterministic metadata accompanying a no-launch generated definition."""

    graph_schema_version: int
    graph_digest: str
    node_ids: Tuple[str, ...]
    runtime_steps: Tuple[RuntimeStepIdentity, ...] = ()


@dataclass(frozen=True)
class ClearPipeRuntimeConfiguration:
    """Safe metadata persisted with a generated controller definition or run."""

    schema_version: int
    definition_revision: int
    graph_schema_version: int
    graph_digest: str
    runtime_steps: Tuple[RuntimeStepIdentity, ...]
    source_map: Tuple[SourceMapEntry, ...]

    def to_dict(self) -> dict:
        return {
            "schema_version": self.schema_version,
            "definition_revision": self.definition_revision,
            "graph_schema_version": self.graph_schema_version,
            "graph_digest": self.graph_digest,
            "runtime_steps": [item.to_dict() for item in self.runtime_steps],
            "source_map": [
                {
                    "graph_element_id": item.graph_element_id,
                    "start_line": item.start_line,
                    "end_line": item.end_line,
                }
                for item in self.source_map
            ],
        }

    @classmethod
    def from_dict(cls, value: Mapping) -> "ClearPipeRuntimeConfiguration":
        """Read only the exact safe payload shape persisted with a controller task."""

        if not isinstance(value, Mapping) or set(value) != {
            "schema_version",
            "definition_revision",
            "graph_schema_version",
            "graph_digest",
            "runtime_steps",
            "source_map",
        }:
            raise ValueError("invalid ClearPipe runtime configuration")
        if (
            value["schema_version"] != 1
            or type(value["definition_revision"]) is not int
            or value["definition_revision"] < 1
            or type(value["graph_schema_version"]) is not int
            or not isinstance(value["graph_digest"], str)
            or not value["graph_digest"].startswith("sha256:")
        ):
            raise ValueError("invalid ClearPipe runtime configuration")
        runtime_steps = tuple(
            _runtime_step(item) for item in _runtime_list(value["runtime_steps"])
        )
        source_map = tuple(
            _runtime_source_map_entry(item) for item in _runtime_list(value["source_map"])
        )
        if (
            len({item.graph_node_id for item in runtime_steps}) != len(runtime_steps)
            or len({item.pipeline_step_name for item in runtime_steps}) != len(runtime_steps)
            or any(item.end_line < item.start_line for item in source_map)
        ):
            raise ValueError("invalid ClearPipe runtime configuration")
        return cls(
            schema_version=value["schema_version"],
            definition_revision=value["definition_revision"],
            graph_schema_version=value["graph_schema_version"],
            graph_digest=value["graph_digest"],
            runtime_steps=runtime_steps,
            source_map=source_map,
        )


def _runtime_list(value: object) -> Tuple[Mapping, ...]:
    if not isinstance(value, list) or not all(isinstance(item, Mapping) for item in value):
        raise ValueError("invalid ClearPipe runtime configuration")
    return tuple(value)


def _runtime_step(value: Mapping) -> RuntimeStepIdentity:
    if set(value) != {"graph_node_id", "pipeline_step_name"}:
        raise ValueError("invalid ClearPipe runtime configuration")
    graph_node_id = value["graph_node_id"]
    pipeline_step_name = value["pipeline_step_name"]
    if not isinstance(graph_node_id, str) or not graph_node_id:
        raise ValueError("invalid ClearPipe runtime configuration")
    if not isinstance(pipeline_step_name, str) or not pipeline_step_name:
        raise ValueError("invalid ClearPipe runtime configuration")
    return RuntimeStepIdentity(graph_node_id, pipeline_step_name)


def _runtime_source_map_entry(value: Mapping) -> SourceMapEntry:
    if set(value) != {"graph_element_id", "start_line", "end_line"}:
        raise ValueError("invalid ClearPipe runtime configuration")
    graph_element_id = value["graph_element_id"]
    start_line = value["start_line"]
    end_line = value["end_line"]
    if not isinstance(graph_element_id, str) or not graph_element_id:
        raise ValueError("invalid ClearPipe runtime configuration")
    if type(start_line) is not int or start_line < 1:
        raise ValueError("invalid ClearPipe runtime configuration")
    if type(end_line) is not int or end_line < start_line:
        raise ValueError("invalid ClearPipe runtime configuration")
    return SourceMapEntry(graph_element_id, start_line, end_line)


@dataclass(frozen=True)
class NodeLoweringInput:
    """One node plus the canonical bindings and sorted parents that affect it."""

    graph: GraphV2
    node: GraphNode
    inbound_bindings: Tuple[Binding, ...]
    parent_node_ids: Tuple[str, ...]


@dataclass(frozen=True)
class TaskLoweringInput(NodeLoweringInput):
    node: TaskNode


@dataclass(frozen=True)
class FunctionLoweringInput(NodeLoweringInput):
    node: FunctionNode


@dataclass(frozen=True)
class GeneratedDefinition:
    """Server-generated, no-launch source and its source map."""

    source: str
    source_map: Tuple[SourceMapEntry, ...]
    manifest: SourceManifest
