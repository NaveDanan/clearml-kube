/**
 * Safe projection between the legacy Flow canvas and a deliberately narrow
 * canonical GraphV2 task profile.  This module never synthesizes executable
 * nodes: the original typed graph remains the source of truth on save.
 */
import {decodeGraphV2} from '../../domain/graph-v2-codec';
import {GraphV2, TaskNode} from '../../domain/graph-v2.types';
import {
  ClearpipeFlowEdge,
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
  emptyClearpipeFlowGraph,
} from './clearpipe-flow.models';

export interface FlowGraphProfile {
  status: 'editable' | 'unsupported';
  reason?: string;
}

export type FlowCanonicalPatch =
  | {status: 'ok'; graph: GraphV2}
  | {status: 'unsupported'; reason: string};

const executionEdge = (binding: GraphV2['bindings'][number]): ClearpipeFlowEdge | null =>
  binding.kind === 'execution-only'
    ? {id: binding.id, source: binding.source.node_id, target: binding.target.node_id}
    : null;

const taskCard = (node: TaskNode): ClearpipeFlowNode => ({
  id: node.id,
  type: 'task',
  position: {...node.visual.position},
  label: node.label,
  // The base task is deliberately visible but not authorable through this canvas.
  description: node.base_task.kind === 'task-id' ? node.base_task.task_id : '',
  status: 'idle',
  config: {
    baseTaskId: node.base_task.kind === 'task-id' ? node.base_task.task_id : '',
    cloneBaseTask: node.configuration.clone_base_task ?? true,
    cache: node.configuration.cache ?? false,
    ...(node.configuration.queue_resource_id ? {queueResourceId: node.configuration.queue_resource_id} : {}),
    ...(node.configuration.retry_on_failure !== undefined
      ? {retryOnFailure: node.configuration.retry_on_failure}
      : {}),
  },
});

/**
 * The Flow canvas only understands immutable task cards plus ordering arrows.
 * Anything which would require it to project semantic GraphV2 data into a
 * generic canvas representation is intentionally read-only.
 */
export const reviewFlowGraphV2 = (graph: GraphV2): FlowGraphProfile => {
  if (!graph.nodes.length) {
    return {status: 'unsupported', reason: 'An empty graph cannot be authored safely in the Flow editor.'};
  }
  if (graph.parameters.length) {
    return {status: 'unsupported', reason: 'Pipeline parameters are not editable in the Flow editor.'};
  }
  if (graph.outputs.length) {
    return {status: 'unsupported', reason: 'Graph outputs are not editable in the Flow editor.'};
  }
  const resources = new Map(graph.resources.map(resource => [resource.id, resource]));
  for (const node of graph.nodes) {
    if (node.kind !== 'task') {
      return {status: 'unsupported', reason: 'Function nodes are read-only in the Flow editor.'};
    }
    if (node.base_task.kind !== 'task-id') {
      return {status: 'unsupported', reason: 'Task-name references are read-only; select an immutable task ID instead.'};
    }
    const queueResourceId = node.configuration.queue_resource_id ?? graph.settings.default_execution_queue_id;
    if (!queueResourceId) {
      return {
        status: 'unsupported',
        reason: `Task "${node.name}" has no effective queue. Set settings.default_execution_queue_id or configuration.queue_resource_id.`,
      };
    }
    const queue = resources.get(queueResourceId);
    if (!queue) {
      return {
        status: 'unsupported',
        reason: `Task "${node.name}" references unknown queue resource "${queueResourceId}".`,
      };
    }
    if (queue.kind !== 'queue') {
      return {
        status: 'unsupported',
        reason: `Task "${node.name}" references non-queue resource "${queueResourceId}".`,
      };
    }
  }
  if (graph.resources.some(resource => resource.kind !== 'queue')) {
    return {status: 'unsupported', reason: 'Only canonical queue resources are supported by the Flow editor.'};
  }
  const dependencies = new Set<string>();
  for (const binding of graph.bindings) {
    if (binding.kind !== 'execution-only') {
      return {status: 'unsupported', reason: 'Data, artifact, parameter, and inferred bindings are read-only in the Flow editor.'};
    }
    const key = `${binding.source.node_id}\u0000${binding.target.node_id}`;
    if (dependencies.has(key)) {
      return {status: 'unsupported', reason: 'Parallel execution bindings require an explicit migration before editing.'};
    }
    dependencies.add(key);
  }
  return {status: 'editable'};
};

/**
 * Builds Flow cards directly from canonical task nodes. This is intentionally
 * not a lowering operation: ports, configurations, resources and bindings stay
 * in the loaded GraphV2 document and are reapplied unchanged by the patcher.
 */
export const graphV2ToFlow = (graph: GraphV2): ClearpipeFlowGraph => {
  const base = emptyClearpipeFlowGraph();
  return {
    ...base,
    ...(graph.document.id ? {id: graph.document.id} : {}),
    name: graph.document.name,
    ...(Object.prototype.hasOwnProperty.call(graph.document, 'description')
      ? {description: graph.document.description}
      : {}),
    nodes: graph.nodes.map(node => taskCard(node as TaskNode)),
    edges: graph.bindings.map(executionEdge).filter((edge): edge is ClearpipeFlowEdge => edge !== null),
    viewport: {
      x: graph.visual.viewport.x,
      y: graph.visual.viewport.y,
      zoom: graph.visual.zoom,
    },
  };
};

const sameJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const taskCardConfiguration = (node: TaskNode): Record<string, unknown> => taskCard(node).config;

/**
 * Applies the only lossless canvas changes (document metadata and visuals) to a
 * clone of the loaded graph. Structural or semantic canvas changes are rejected
 * rather than guessed, and the fully typed result is decoded before it can be
 * sent to the API.
 */
export const applyFlowCanonicalPatch = (
  loaded: GraphV2 | null,
  flow: ClearpipeFlowGraph,
): FlowCanonicalPatch => {
  if (!loaded) {
    return {status: 'unsupported', reason: 'No canonical task graph is loaded. Create task graphs in the typed editor.'};
  }
  const profile = reviewFlowGraphV2(loaded);
  if (profile.status !== 'editable') return {status: 'unsupported', reason: profile.reason!};

  if (flow.boundaries.length) {
    return {status: 'unsupported', reason: 'Flow boundaries are not part of the canonical task graph profile.'};
  }
  if (flow.nodes.length !== loaded.nodes.length || flow.edges.length !== loaded.bindings.length) {
    return {status: 'unsupported', reason: 'Adding, removing, or splitting task cards requires an explicit migration.'};
  }

  const cards = new Map(flow.nodes.map(card => [card.id, card]));
  const edges = new Map(flow.edges.map(edge => [edge.id, edge]));
  const patched = structuredClone(loaded);
  for (const node of patched.nodes) {
    if (node.kind !== 'task') return {status: 'unsupported', reason: 'Only canonical task nodes can be saved from Flow.'};
    if (node.base_task.kind !== 'task-id') {
      return {status: 'unsupported', reason: 'Task base references are immutable in the Flow editor.'};
    }
    const card = cards.get(node.id);
    if (!card || card.type !== 'task') {
      return {status: 'unsupported', reason: 'Task cards must map one-to-one to their canonical task nodes.'};
    }
    if ('taskIds' in card.config) {
      return {
        status: 'unsupported',
        reason: 'Legacy taskIds cards (including zero or multiple values) require an explicit split or migration.',
      };
    }
    if (!sameJson(card.config, taskCardConfiguration(node))) {
      return {status: 'unsupported', reason: 'Task selection and configuration are immutable in the Flow editor.'};
    }
    if (card.description !== node.base_task.task_id) {
      return {status: 'unsupported', reason: 'Task base references are immutable in the Flow editor.'};
    }
    node.label = card.label;
    node.visual.position = {...card.position};
  }
  for (const binding of patched.bindings) {
    if (binding.kind !== 'execution-only') {
      return {status: 'unsupported', reason: 'Only execution-only bindings are supported by the Flow editor.'};
    }
    const edge = edges.get(binding.id);
    if (!edge || edge.source !== binding.source.node_id || edge.target !== binding.target.node_id) {
      return {status: 'unsupported', reason: 'Changing canonical execution bindings requires an explicit migration.'};
    }
  }

  patched.document.name = flow.name;
  if (flow.description === undefined) delete patched.document.description;
  else patched.document.description = flow.description;
  patched.visual = {
    viewport: {x: flow.viewport.x, y: flow.viewport.y},
    zoom: flow.viewport.zoom,
  };

  const decoded = decodeGraphV2(patched);
  if (decoded.status !== 'ok') {
    return {
      status: 'unsupported',
      reason: decoded.status === 'unsupported'
        ? decoded.unsupported.reason
        : decoded.errors.map(error => error.message).join('; '),
    };
  }
  return {status: 'ok', graph: decoded.graph};
};
