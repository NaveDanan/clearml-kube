import {
  FunctionNodeInput,
  GraphCommandWithId,
  TaskNodeInput,
} from '../domain/graph-store.service';
import {GraphBinding, GraphNode, GraphVisual, Point} from '../domain/graph-v2.types';

export const CANVAS_MIN_ZOOM = .35;
export const CANVAS_MAX_ZOOM = 2;
export const CANVAS_DEFAULT_NODE_DIMENSIONS = {width: 176, height: 72} as const;

export interface CanvasClientPoint {
  clientX: number;
  clientY: number;
}

export interface CanvasSurfaceBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasNodeDimensions {
  width: number;
  height: number;
}

export interface CanvasNodeView {
  node: GraphNode;
  dimensions: CanvasNodeDimensions;
}

export interface CanvasBasicBinding {
  id: string;
  source: CanvasNodeView;
  target: CanvasNodeView;
}

export type CanvasNodePlacement =
  | {kind: 'task'; node: Omit<TaskNodeInput, 'visual'>; dimensions?: CanvasNodeDimensions}
  | {kind: 'function'; node: Omit<FunctionNodeInput, 'visual'>; dimensions?: CanvasNodeDimensions};

export interface CanvasProfileMark {
  phase: 'placement' | 'move' | 'pan' | 'zoom' | 'fit' | 'delete';
  nodeCount: number;
  bindingCount: number;
}

export interface CanvasProfiler {
  mark(mark: CanvasProfileMark): void;
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;

export const clampCanvasZoom = (zoom: number): number => Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, finite(zoom, 1)));

export const normalizeCanvasDimensions = (dimensions: Partial<CanvasNodeDimensions> | undefined): CanvasNodeDimensions => ({
  width: Math.max(1, finite(dimensions?.width ?? CANVAS_DEFAULT_NODE_DIMENSIONS.width, CANVAS_DEFAULT_NODE_DIMENSIONS.width)),
  height: Math.max(1, finite(dimensions?.height ?? CANVAS_DEFAULT_NODE_DIMENSIONS.height, CANVAS_DEFAULT_NODE_DIMENSIONS.height)),
});

export const canvasPointFromClientPoint = (
  point: CanvasClientPoint,
  bounds: CanvasSurfaceBounds,
  visual: GraphVisual,
): Point => ({
  x: (point.clientX - bounds.left - visual.viewport.x) / visual.zoom,
  y: (point.clientY - bounds.top - visual.viewport.y) / visual.zoom,
});

export const canvasPositionAfterDrag = (position: Point, distance: Point, zoom: number): Point => ({
  x: position.x + finite(distance.x) / clampCanvasZoom(zoom),
  y: position.y + finite(distance.y) / clampCanvasZoom(zoom),
});

export const canvasVisualAtClientZoom = (
  visual: GraphVisual,
  point: CanvasClientPoint,
  bounds: CanvasSurfaceBounds,
  zoom: number,
): GraphVisual => {
  const clampedZoom = clampCanvasZoom(zoom);
  const graphPoint = canvasPointFromClientPoint(point, bounds, visual);
  return {
    viewport: {
      x: point.clientX - bounds.left - graphPoint.x * clampedZoom,
      y: point.clientY - bounds.top - graphPoint.y * clampedZoom,
    },
    zoom: clampedZoom,
  };
};

export const canvasGraphTransform = (visual: GraphVisual): string =>
  `translate(${visual.viewport.x}px, ${visual.viewport.y}px) scale(${visual.zoom})`;

export const canvasNodeTransform = (position: Point): string =>
  `translate3d(${position.x}px, ${position.y}px, 0)`;

const endpointNodeId = (endpoint: GraphBinding['source'] | GraphBinding['target']): string | null =>
  endpoint.kind === 'node' || endpoint.kind === 'port' ? endpoint.node_id : null;

export const basicCanvasBindings = (
  nodes: readonly CanvasNodeView[],
  bindings: readonly GraphBinding[],
): readonly CanvasBasicBinding[] => {
  const nodeById = new Map(nodes.map((view) => [view.node.id, view]));
  return bindings.flatMap((binding) => {
    const sourceId = endpointNodeId(binding.source);
    const targetId = endpointNodeId(binding.target);
    const source = sourceId ? nodeById.get(sourceId) : undefined;
    const target = targetId ? nodeById.get(targetId) : undefined;
    return source && target ? [{id: binding.id, source, target}] : [];
  });
};

export const basicCanvasBindingPath = (binding: CanvasBasicBinding): string => {
  const source = binding.source.node.visual.position;
  const target = binding.target.node.visual.position;
  const sourceX = source.x + binding.source.dimensions.width;
  const sourceY = source.y + binding.source.dimensions.height / 2;
  const targetX = target.x;
  const targetY = target.y + binding.target.dimensions.height / 2;
  const curve = Math.max(48, Math.abs(targetX - sourceX) / 2);
  return `M ${sourceX} ${sourceY} C ${sourceX + curve} ${sourceY}, ${targetX - curve} ${targetY}, ${targetX} ${targetY}`;
};

interface GraphBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const canvasBounds = (nodes: readonly CanvasNodeView[]): GraphBounds | null => {
  if (!nodes.length) return null;
  return nodes.reduce<GraphBounds>((bounds, view) => {
    const position = view.node.visual.position;
    return {
      left: Math.min(bounds.left, position.x),
      top: Math.min(bounds.top, position.y),
      right: Math.max(bounds.right, position.x + view.dimensions.width),
      bottom: Math.max(bounds.bottom, position.y + view.dimensions.height),
    };
  }, {
    left: nodes[0].node.visual.position.x,
    top: nodes[0].node.visual.position.y,
    right: nodes[0].node.visual.position.x + nodes[0].dimensions.width,
    bottom: nodes[0].node.visual.position.y + nodes[0].dimensions.height,
  });
};

export const fitCanvasVisual = (
  nodes: readonly CanvasNodeView[],
  surface: Pick<CanvasSurfaceBounds, 'width' | 'height'>,
  padding = 56,
): GraphVisual | null => {
  const bounds = canvasBounds(nodes);
  if (!bounds || surface.width <= 0 || surface.height <= 0) return null;
  const graphWidth = Math.max(1, bounds.right - bounds.left);
  const graphHeight = Math.max(1, bounds.bottom - bounds.top);
  const zoom = clampCanvasZoom(Math.min(
    (surface.width - padding * 2) / graphWidth,
    (surface.height - padding * 2) / graphHeight,
  ));
  return {
    viewport: {
      x: (surface.width - graphWidth * zoom) / 2 - bounds.left * zoom,
      y: (surface.height - graphHeight * zoom) / 2 - bounds.top * zoom,
    },
    zoom,
  };
};

export const placementResult = (
  placement: CanvasNodePlacement,
  position: Point,
  commands: {
    createTaskNode(input: TaskNodeInput): GraphCommandWithId;
    createFunctionNode(input: FunctionNodeInput): GraphCommandWithId;
  },
): GraphCommandWithId => {
  const visual = {
    position,
    ...(placement.dimensions ? {dimensions: normalizeCanvasDimensions(placement.dimensions)} : {}),
  };
  return placement.kind === 'task'
    ? commands.createTaskNode({...placement.node, visual})
    : commands.createFunctionNode({...placement.node, visual});
};
