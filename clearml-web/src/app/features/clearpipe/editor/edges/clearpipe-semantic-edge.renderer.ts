import {GraphBinding, GraphNode} from '../../domain/graph-v2.types';
import {CanvasNodeDimensions, CanvasNodeView} from '../clearpipe-canvas.adapter';

export interface SemanticCanvasEdge {
  readonly id: string;
  readonly kind: GraphBinding['kind'];
  readonly path: string;
  readonly label: string;
  readonly sourceLabel: string;
  readonly targetLabel: string;
}

const endpointNodeId = (endpoint: GraphBinding['source'] | GraphBinding['target']): string | null =>
  endpoint.kind === 'port' || endpoint.kind === 'node' ? endpoint.node_id : null;

const portName = (node: GraphNode | undefined, portId: string): string =>
  node?.ports.find((port) => port.id === portId)?.name ?? `unknown port ${portId}`;

const bindingLabels = (binding: GraphBinding, nodeById: Map<string, GraphNode>): {source: string; target: string} => {
  const source = binding.source.kind === 'port'
    ? `${nodeById.get(binding.source.node_id)?.label ?? binding.source.node_id} output ${portName(nodeById.get(binding.source.node_id), binding.source.port_id)}`
    : binding.source.kind === 'node'
      ? `${nodeById.get(binding.source.node_id)?.label ?? binding.source.node_id} node`
      : binding.source.kind === 'parameter' ? `parameter ${binding.source.parameter_id}`
        : `resource ${binding.source.resource_id}`;
  const target = binding.target.kind === 'port'
    ? `${nodeById.get(binding.target.node_id)?.label ?? binding.target.node_id} input ${portName(nodeById.get(binding.target.node_id), binding.target.port_id)}`
    : `${nodeById.get(binding.target.node_id)?.label ?? binding.target.node_id} node`;
  return {source, target};
};

const edgePath = (source: CanvasNodeView, target: CanvasNodeView): string => {
  const sourceX = source.node.visual.position.x + source.dimensions.width;
  const sourceY = source.node.visual.position.y + source.dimensions.height / 2;
  const targetX = target.node.visual.position.x;
  const targetY = target.node.visual.position.y + target.dimensions.height / 2;
  const curve = Math.max(48, Math.abs(targetX - sourceX) / 2);
  return `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`;
};

/**
 * Read-only render projection. Canonical bindings remain the only edge source.
 */
export const semanticCanvasEdges = (
  nodes: readonly CanvasNodeView[],
  bindings: readonly GraphBinding[],
  dimensions: (node: GraphNode) => CanvasNodeDimensions,
): readonly SemanticCanvasEdge[] => {
  const nodeById = new Map(nodes.map((view) => [view.node.id, view.node]));
  const viewById = new Map(nodes.map((view) => [view.node.id, view]));
  return bindings.flatMap((binding) => {
    const sourceId = endpointNodeId(binding.source);
    const targetId = endpointNodeId(binding.target);
    const source = sourceId ? viewById.get(sourceId) : undefined;
    const target = targetId ? viewById.get(targetId) : undefined;
    if (!source || !target) return [];
    const labels = bindingLabels(binding, nodeById);
    return [{
      id: binding.id,
      kind: binding.kind,
      path: edgePath(
        {...source, dimensions: dimensions(source.node)},
        {...target, dimensions: dimensions(target.node)},
      ),
      sourceLabel: labels.source,
      targetLabel: labels.target,
      label: `${labels.source} to ${labels.target}; ${binding.kind} binding`,
    }];
  });
};
