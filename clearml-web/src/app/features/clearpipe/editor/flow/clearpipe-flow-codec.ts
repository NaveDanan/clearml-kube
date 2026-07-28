/**
 * Round-trip codec between the visual flow model (ClearpipeFlowGraph) and the
 * canonical, server-persisted graph v2 contract.
 *
 * The flow model is richer than graph v2 (node types, per-type config,
 * boundaries, viewport) and graph v2 has no field to hold that authoring
 * metadata. To let a saved pipeline re-open in the SAME flow editor, every flow
 * node is lowered to a stub `function` node and its flow metadata is embedded as
 * leading comment lines in the function `source` - a field the server preserves
 * verbatim and that `ast.parse` ignores, so compilation is unaffected. Flow edges
 * become execution-only ordering bindings.
 */
import {GraphBinding, GraphNode, GraphV2} from '../../domain/graph-v2.types';
import {
  ClearpipeFlowBoundary,
  ClearpipeFlowEdge,
  ClearpipeFlowEdgeRule,
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
  ClearpipeFlowNodeType,
  ClearpipeFlowPoint,
  ClearpipeFlowViewport,
  clearpipeFlowNodeMeta,
  CLEARPIPE_FLOW_NODE_TYPES,
  emptyClearpipeFlowGraph,
} from './clearpipe-flow.models';
import {migrateFlowGraph} from './clearpipe-flow-migration';

const NODE_META_TAG = '# clearpipe-flow-node:';
const GRAPH_META_TAG = '# clearpipe-flow-graph:';

const FLOW_NODE_TYPES: ReadonlySet<string> = new Set(CLEARPIPE_FLOW_NODE_TYPES.map(meta => meta.type));

/** Per-node authoring metadata embedded in the function source. */
interface FlowNodeMeta {
  type: ClearpipeFlowNodeType;
  config: Record<string, unknown>;
  description?: string;
  /** Shared group identity (Group/Ungroup); round-tripped so groups survive reload. */
  groupId?: string;
  /** Marks the fallback stub emitted for an empty pipeline so decode can drop it. */
  synthetic?: boolean;
}

/** Graph-level authoring metadata embedded once, in the first node's source. */
interface FlowGraphMeta {
  name?: string;
  description?: string;
  activated?: boolean;
  boundaries?: ClearpipeFlowBoundary[];
  viewport?: ClearpipeFlowViewport;
  /** Conditional edge routing rules keyed by `<source>-><target>` (round-tripped
   *  losslessly; the server compiler ignores authoring metadata). */
  edgeRules?: Record<string, ClearpipeFlowEdgeRule[]>;
}

const edgeRuleKey = (edge: {source: string; target: string}): string => `${edge.source}->${edge.target}`;

const collectEdgeRules = (edges: readonly ClearpipeFlowEdge[]): Record<string, ClearpipeFlowEdgeRule[]> | undefined => {
  const map: Record<string, ClearpipeFlowEdgeRule[]> = {};
  for (const edge of edges) {
    if (edge.rules?.length) map[edgeRuleKey(edge)] = edge.rules;
  }
  return Object.keys(map).length ? map : undefined;
};

const sanitizeName = (name: string): string => {
  const normalized = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return /^[A-Za-z]/.test(normalized) ? normalized : `clearpipe_${normalized || 'flow'}`;
};

const uniqueName = (seed: string, used: Set<string>): string => {
  const base = sanitizeName(seed);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix++}`;
  }
  used.add(candidate);
  return candidate;
};

const functionSource = (name: string, nodeMeta: FlowNodeMeta, graphMeta?: FlowGraphMeta): string => {
  const lines = [`${NODE_META_TAG}${JSON.stringify(nodeMeta)}`];
  if (graphMeta) lines.push(`${GRAPH_META_TAG}${JSON.stringify(graphMeta)}`);
  lines.push(`def ${name}() -> object:`, '    return None', '');
  return lines.join('\n');
};

const functionNode = (
  id: string,
  name: string,
  label: string,
  position: ClearpipeFlowPoint,
  nodeMeta: FlowNodeMeta,
  graphMeta?: FlowGraphMeta,
): GraphNode => ({
  id,
  kind: 'function',
  name,
  label,
  ports: [{
    id: 'result',
    kind: 'port',
    name: 'result',
    direction: 'output',
    role: 'data',
    required: false,
    multiplicity: 'many',
    accepted_binding_kinds: ['data'],
    order: 0,
  }],
  visual: {position: {x: position.x, y: position.y}},
  signature: `def ${name}() -> object`,
  source: functionSource(name, nodeMeta, graphMeta),
  configuration: {task_type: 'application'},
});

/**
 * Lower the authored flow graph into canonical v2 function nodes + execution-only
 * bindings. Node type/config and graph boundaries/viewport are embedded in the
 * node sources so the graph re-opens losslessly in the flow editor.
 */
export const flowToGraphNodes = (flow: ClearpipeFlowGraph): {nodes: GraphNode[]; bindings: GraphBinding[]} => {
  const graphMeta: FlowGraphMeta = {
    name: flow.name,
    description: flow.description,
    activated: flow.activated,
    boundaries: flow.boundaries,
    viewport: flow.viewport,
    edgeRules: collectEdgeRules(flow.edges),
  };

  if (!flow.nodes.length) {
    const label = flow.name.trim() || 'Untitled ClearPipe';
    const meta: FlowNodeMeta = {type: 'task', config: {}, synthetic: true};
    return {nodes: [functionNode('clearpipe_flow', 'clearpipe_flow', label, {x: 0, y: 0}, meta, graphMeta)], bindings: []};
  }

  const used = new Set<string>();
  const nodes = flow.nodes.map((node, index) => {
    const name = uniqueName(node.label || node.type, used);
    const meta: FlowNodeMeta = {
      type: node.type,
      config: node.config ?? {},
      ...(node.description ? {description: node.description} : {}),
      ...(node.groupId ? {groupId: node.groupId} : {}),
    };
    return functionNode(node.id, name, node.label || node.type, node.position, meta, index === 0 ? graphMeta : undefined);
  });

  const nodeIds = new Set(flow.nodes.map(node => node.id));
  const seen = new Set<string>();
  const bindings: GraphBinding[] = [];
  flow.edges.forEach((edge, index) => {
    const key = `${edge.source}->${edge.target}`;
    if (edge.source === edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target) || seen.has(key)) return;
    seen.add(key);
    bindings.push({
      id: `edge_${index}`,
      kind: 'execution-only',
      source: {kind: 'node', node_id: edge.source},
      target: {kind: 'node', node_id: edge.target},
    });
  });
  return {nodes, bindings};
};

const decodeMeta = <T>(source: string, tag: string): T | null => {
  for (const line of source.split('\n')) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith(tag)) {
      try {
        return JSON.parse(trimmed.slice(tag.length)) as T;
      } catch {
        return null;
      }
    }
  }
  return null;
};

const normalizeType = (type: string | undefined): ClearpipeFlowNodeType =>
  type && FLOW_NODE_TYPES.has(type) ? (type as ClearpipeFlowNodeType) : 'task';

const endpointNodeId = (endpoint: unknown): string | null => {
  const value = endpoint as {node_id?: unknown} | null;
  return value && typeof value.node_id === 'string' ? value.node_id : null;
};

const decodeEdges = (
  graph: GraphV2,
  keptIds: ReadonlySet<string>,
  edgeRules?: Record<string, ClearpipeFlowEdgeRule[]>,
): ClearpipeFlowEdge[] => {
  const edges: ClearpipeFlowEdge[] = [];
  const seen = new Set<string>();
  graph.bindings.forEach((binding, index) => {
    const source = endpointNodeId((binding as {source?: unknown}).source);
    const target = endpointNodeId((binding as {target?: unknown}).target);
    if (!source || !target || source === target || !keptIds.has(source) || !keptIds.has(target)) return;
    const key = `${source}->${target}`;
    if (seen.has(key)) return;
    seen.add(key);
    const rules = edgeRules?.[key];
    edges.push({
      id: (binding as {id?: string}).id ?? `edge_${index}`,
      source,
      target,
      ...(rules?.length ? {rules} : {}),
    });
  });
  return edges;
};

/**
 * Reconstruct a flow graph from a canonical v2 graph. Flow-authored graphs
 * restore losslessly via their embedded metadata; v2 graphs authored elsewhere
 * degrade gracefully to generic `task` nodes with preserved labels/positions/edges.
 */
export const graphV2ToFlow = (graph: GraphV2): ClearpipeFlowGraph => {
  const base = emptyClearpipeFlowGraph();
  let graphMeta: FlowGraphMeta | null = null;
  const nodes: ClearpipeFlowNode[] = [];
  const keptIds = new Set<string>();

  graph.nodes.forEach(node => {
    const source = node.kind === 'function' ? node.source : '';
    if (!graphMeta) graphMeta = decodeMeta<FlowGraphMeta>(source, GRAPH_META_TAG);
    const meta = decodeMeta<FlowNodeMeta>(source, NODE_META_TAG);
    if (meta?.synthetic) return;
    const type = normalizeType(meta?.type);
    nodes.push({
      id: node.id,
      type,
      position: {x: node.visual?.position?.x ?? 0, y: node.visual?.position?.y ?? 0},
      label: node.label || node.name,
      ...(meta?.description ? {description: meta.description} : {}),
      ...(meta?.groupId ? {groupId: meta.groupId} : {}),
      status: 'idle',
      config: {...clearpipeFlowNodeMeta(type).defaults, ...(meta?.config ?? {})},
    });
    keptIds.add(node.id);
  });

  const meta: FlowGraphMeta = graphMeta ?? {};
  const flow: ClearpipeFlowGraph = {
    ...base,
    ...(graph.document.id ? {id: graph.document.id} : {}),
    name: meta.name ?? graph.document.name ?? base.name,
    ...(meta.description ?? graph.document.description ? {description: meta.description ?? graph.document.description} : {}),
    activated: meta.activated ?? false,
    nodes,
    edges: decodeEdges(graph, keptIds, meta.edgeRules),
    boundaries: meta.boundaries ?? [],
    viewport: meta.viewport ?? base.viewport,
  };
  // Additively upgrade legacy Task/Report contracts to graph-aware bindings.
  return migrateFlowGraph(flow).graph;
};
