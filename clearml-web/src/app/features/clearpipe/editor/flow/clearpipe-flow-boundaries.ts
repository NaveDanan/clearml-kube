import {
  CLEARPIPE_FLOW_NODE_SIZE,
  ClearpipeFlowBoundary,
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
} from './clearpipe-flow.models';

export interface ClearpipeFlowBoundaryExecutionPlan {
  activeNodeIds: Set<string>;
  excludedNodeIds: Set<string>;
  cutEdgeIds: Set<string>;
  excludedByBoundary: Map<string, string>;
}

const contains = (boundary: ClearpipeFlowBoundary, node: ClearpipeFlowNode): boolean => {
  const centerX = node.position.x + CLEARPIPE_FLOW_NODE_SIZE.width / 2;
  const centerY = node.position.y + CLEARPIPE_FLOW_NODE_SIZE.height / 2;
  return centerX >= boundary.position.x
    && centerX <= boundary.position.x + boundary.width
    && centerY >= boundary.position.y
    && centerY <= boundary.position.y + boundary.height;
};

/**
 * Build the same execution projection as the server compiler. An edge leaving
 * an onReach=stop boundary is cut; nodes no longer reachable from the graph's
 * original roots are shown as stopped and are not compiled into the run.
 */
export const flowBoundaryExecutionPlan = (
  graph: ClearpipeFlowGraph,
): ClearpipeFlowBoundaryExecutionPlan => {
  const stopBoundaries = graph.boundaries.filter((boundary) => (boundary.onReach ?? 'stop') === 'stop');
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const parents = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
  const children = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of graph.edges) {
    parents.get(edge.target)?.add(edge.source);
  }

  const contained = new Map(stopBoundaries.map((boundary) => [
    boundary.id,
    new Set(graph.nodes.filter((node) => contains(boundary, node)).map((node) => node.id)),
  ]));
  const cutEdgeIds = new Set<string>();
  for (const edge of graph.edges) {
    if (stopBoundaries.some((boundary) => {
      const ids = contained.get(boundary.id)!;
      return ids.has(edge.source) && !ids.has(edge.target);
    })) {
      cutEdgeIds.add(edge.id);
    } else {
      children.get(edge.source)?.add(edge.target);
    }
  }

  const activeNodeIds = new Set<string>();
  const pending = graph.nodes
    .filter((node) => !(parents.get(node.id)?.size))
    .map((node) => node.id)
    .sort();
  while (pending.length) {
    const nodeId = pending.shift()!;
    if (activeNodeIds.has(nodeId)) continue;
    activeNodeIds.add(nodeId);
    pending.push(...[...(children.get(nodeId) ?? [])].filter((id) => !activeNodeIds.has(id)).sort());
  }

  const excludedNodeIds = new Set([...nodeIds].filter((nodeId) => !activeNodeIds.has(nodeId)));
  const excludedByBoundary = new Map<string, string>();
  for (const edge of graph.edges.filter((item) => cutEdgeIds.has(item.id))) {
    const boundary = stopBoundaries.find((item) => {
      const ids = contained.get(item.id)!;
      return ids.has(edge.source) && !ids.has(edge.target);
    });
    if (!boundary) continue;
    const downstream = [edge.target];
    const seen = new Set<string>();
    while (downstream.length) {
      const nodeId = downstream.shift()!;
      if (seen.has(nodeId)) continue;
      seen.add(nodeId);
      if (excludedNodeIds.has(nodeId) && !excludedByBoundary.has(nodeId)) {
        excludedByBoundary.set(nodeId, boundary.label || 'Boundary');
      }
      downstream.push(...graph.edges.filter((item) => item.source === nodeId).map((item) => item.target));
    }
  }
  return {activeNodeIds, excludedNodeIds, cutEdgeIds, excludedByBoundary};
};
