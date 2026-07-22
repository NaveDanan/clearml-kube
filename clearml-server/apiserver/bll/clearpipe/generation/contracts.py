"""Typed handoff contracts for the deterministic ClearPipe source compiler.

CP-12 and CP-13 consume these data-only interfaces.  They do not launch
pipelines and do not expose a browser code generator.
"""

from dataclasses import dataclass
from typing import Tuple

from ..graph_v2 import Binding, FunctionNode, GraphNode, GraphV2, TaskNode


@dataclass(frozen=True)
class SourceMapEntry:
    """A generated source span attributable to one stable graph element."""

    graph_element_id: str
    start_line: int
    end_line: int


@dataclass(frozen=True)
class SourceManifest:
    """Deterministic metadata accompanying a no-launch generated definition."""

    graph_schema_version: int
    graph_digest: str
    node_ids: Tuple[str, ...]


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
