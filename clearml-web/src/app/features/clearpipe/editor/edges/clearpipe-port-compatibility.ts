import {decodeGraphV2} from '../../domain/graph-v2-codec';
import {GraphBinding, GraphPort, GraphV2} from '../../domain/graph-v2.types';
import {GraphBindingInput} from '../../domain/graph-store.service';

export type SemanticEdgeRejection =
  | 'invalid_binding_kind'
  | 'unknown_binding'
  | 'unknown_node'
  | 'unknown_port'
  | 'unknown_resource'
  | 'unknown_parameter'
  | 'invalid_port_direction'
  | 'binding_not_accepted'
  | 'port_multiplicity_exceeded'
  | 'self_connection'
  | 'graph_cycle'
  | 'duplicate_binding'
  | 'invalid_binding';

export interface SemanticEdgeEligibility {
  readonly eligible: boolean;
  readonly reason: SemanticEdgeRejection | null;
  readonly message: string;
}

export interface SemanticPortLocation {
  readonly node_id: string;
  readonly port_id: string;
}

const supportedKinds = new Set<GraphBinding['kind']>([
  'data', 'artifact', 'parameter', 'inferred', 'execution-only',
]);

const messageFor = (reason: SemanticEdgeRejection): string => ({
  invalid_binding_kind: 'This binding kind is not supported by the canonical ClearPipe graph.',
  unknown_binding: 'The selected binding no longer exists.',
  unknown_node: 'A connection endpoint refers to a node that no longer exists.',
  unknown_port: 'A connection endpoint refers to a port that no longer exists.',
  unknown_resource: 'The artifact source resource no longer exists.',
  unknown_parameter: 'The parameter source no longer exists.',
  invalid_port_direction: 'Connections must run from an output port to an input port.',
  binding_not_accepted: 'The selected ports do not accept this binding kind.',
  port_multiplicity_exceeded: 'The target input accepts only one connection.',
  self_connection: 'A node cannot connect to itself.',
  graph_cycle: 'This connection would create a cycle in the execution graph.',
  duplicate_binding: 'An identical canonical binding already exists.',
  invalid_binding: 'This connection is not valid for the current ClearPipe graph.',
}[reason]);

const rejected = (reason: SemanticEdgeRejection): SemanticEdgeEligibility => ({
  eligible: false,
  reason,
  message: messageFor(reason),
});

const accepted = (): SemanticEdgeEligibility => ({eligible: true, reason: null, message: 'Compatible connection.'});

const endpointKey = (endpoint: {kind: string; node_id?: string; port_id?: string; parameter_id?: string; resource_id?: string}): string =>
  endpoint.kind === 'port' ? `port:${endpoint.node_id}:${endpoint.port_id}`
    : endpoint.kind === 'node' ? `node:${endpoint.node_id}`
      : endpoint.kind === 'parameter' ? `parameter:${endpoint.parameter_id}`
        : `resource:${endpoint.resource_id}`;

const bindingKey = (binding: GraphBinding | GraphBindingInput): string => {
  if (binding.kind === 'inferred') {
    return `${binding.kind}|${endpointKey(binding.source)}|${endpointKey(binding.target)}|${endpointKey(binding.derived_from)}`;
  }
  return `${binding.kind}|${endpointKey(binding.source)}|${endpointKey(binding.target)}`;
};

const endpointNodeIds = (binding: GraphBinding | GraphBindingInput): readonly string[] => {
  const source = binding.source.kind === 'node' || binding.source.kind === 'port' ? binding.source.node_id : undefined;
  const target = binding.target.kind === 'node' || binding.target.kind === 'port' ? binding.target.node_id : undefined;
  return source && target ? [source, target] : [];
};

const canonicalRejection = (candidate: GraphBindingInput, graph: GraphV2, replacingBindingId?: string): SemanticEdgeEligibility => {
  const bindings = graph.bindings.filter((binding) => binding.id !== replacingBindingId);
  const id = candidate.id ?? 'binding_compatibility_candidate';
  const decoded = decodeGraphV2({...graph, bindings: [...bindings, {...candidate, id} as GraphBinding]});
  if (decoded.status === 'ok') return accepted();
  const code = decoded.status === 'invalid' ? decoded.errors[0]?.code : 'invalid_binding';
  const supported: readonly SemanticEdgeRejection[] = [
    'unknown_node', 'unknown_port', 'unknown_resource', 'unknown_parameter',
    'invalid_port_direction', 'binding_not_accepted', 'port_multiplicity_exceeded', 'graph_cycle',
  ];
  return rejected(supported.includes(code as SemanticEdgeRejection) ? code as SemanticEdgeRejection : 'invalid_binding');
};

/**
 * Pure compatibility gateway for canonical bindings. It evaluates current graph
 * state only; no renderer geometry, browser event, or copied graph is retained.
 */
export const evaluateSemanticEdge = (
  graph: GraphV2 | null,
  candidate: GraphBindingInput,
  replacingBindingId?: string,
): SemanticEdgeEligibility => {
  if (!graph) return rejected('invalid_binding');
  if (!supportedKinds.has(candidate.kind)) return rejected('invalid_binding_kind');
  if (replacingBindingId && !graph.bindings.some((binding) => binding.id === replacingBindingId)) {
    return rejected('unknown_binding');
  }

  const [sourceNodeId, targetNodeId] = endpointNodeIds(candidate);
  if (sourceNodeId && targetNodeId && sourceNodeId === targetNodeId) return rejected('self_connection');

  const candidateKey = bindingKey(candidate);
  if (graph.bindings.some((binding) => binding.id !== replacingBindingId && bindingKey(binding) === candidateKey)) {
    return rejected('duplicate_binding');
  }

  return canonicalRejection(candidate, graph, replacingBindingId);
};

export const compatiblePortBindingKinds = (
  graph: GraphV2 | null,
  source: SemanticPortLocation,
  target: SemanticPortLocation,
  replacingBindingId?: string,
): readonly Extract<GraphBinding['kind'], 'data' | 'artifact'>[] =>
  (['data', 'artifact'] as const).filter((kind) => evaluateSemanticEdge(graph, {
    kind,
    source: {kind: 'port', ...source},
    target: {kind: 'port', ...target},
  }, replacingBindingId).eligible);

export const semanticPort = (graph: GraphV2 | null, location: SemanticPortLocation): GraphPort | null =>
  graph?.nodes.find((node) => node.id === location.node_id)?.ports.find((port) => port.id === location.port_id) ?? null;
