import {
  BindingKind,
  FunctionNode,
  GraphBinding,
  GraphPort,
  GraphV2,
  TaskNode,
} from '../domain/graph-v2.types';

export type {BindingKind, FunctionNode, GraphBinding, GraphPort, GraphV2, TaskNode};
export type GraphFixture = GraphV2;

export interface DefinitionFixture {
  id: string;
  revision: number;
  document: GraphV2;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
}

export interface InvalidGraphFixture {
  name: 'duplicate-node-name' | 'cycle' | 'unknown-port' | 'embedded-secret' | 'unsupported-schema';
  document: GraphV2;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class DeterministicIds {
  private value: number;

  constructor(start = 1) {
    this.value = start;
  }

  next(prefix: string): string {
    const id = `${prefix}-${this.value.toString().padStart(4, '0')}`;
    this.value += 1;
    return id;
  }
}

export class DeterministicClock {
  private value = Date.UTC(2026, 0, 1, 0, 0, 0);

  now(): string {
    const timestamp = new Date(this.value).toISOString();
    this.value += 1000;
    return timestamp;
  }
}

export const port = (
  id: string,
  name: string,
  direction: 'input' | 'output',
  role: 'data' | 'artifact' | 'parameter',
  acceptedBindingKinds: BindingKind[],
  required = false,
  multiplicity: 'single' | 'many' = 'single',
  order = 0,
): GraphPort => ({
  id,
  kind: 'port',
  name,
  direction,
  role,
  required,
  multiplicity,
  accepted_binding_kinds: [...acceptedBindingKinds],
  order,
});

export const taskNode = (id = 'task-source', overrides: Partial<TaskNode> = {}): TaskNode => {
  const name = id.replaceAll('-', '_');
  return {
    id,
    name,
    label: name.replaceAll('_', ' '),
    kind: 'task',
    base_task: {kind: 'task-id', task_id: 'base-task-0001'},
    ports: [
      port('in-parameter', 'General/value', 'input', 'parameter', ['parameter']),
      port('out-artifact', 'artifacts.result.url', 'output', 'artifact', ['artifact'], false, 'many'),
    ],
    configuration: {clone_base_task: true, cache: false},
    visual: {position: {x: 0, y: 0}},
    ...clone(overrides),
  };
};

export const functionNode = (id = 'function-transform', overrides: Partial<FunctionNode> = {}): FunctionNode => {
  const name = id.replaceAll('-', '_');
  return {
    id,
    name,
    label: name.replaceAll('_', ' '),
    kind: 'function',
    signature: 'def function_transform(value: int) -> int',
    source: 'def function_transform(value: int) -> int:\n    return value\n',
    ports: [
      port('in-value', 'value', 'input', 'data', ['data'], true),
      port('out-result', 'result', 'output', 'data', ['data'], false, 'many'),
    ],
    configuration: {task_type: 'data_processing', cache: false},
    visual: {position: {x: 320, y: 0}},
    ...clone(overrides),
  };
};

export const graphFixture = (overrides: Partial<GraphV2> = {}): GraphV2 => ({
  schema_version: 2,
  document: {name: 'cp09_fixture_pipeline', project: 'cp09-fixtures', version: '1.0.0', tags: ['clearpipe']},
  settings: {default_execution_queue_id: 'queue-default'},
  parameters: [],
  resources: [{id: 'queue-default', kind: 'queue', resource_id: 'default', label: 'default'}],
  outputs: [],
  nodes: [],
  bindings: [],
  visual: {viewport: {x: 0, y: 0}, zoom: 1},
  ...clone(overrides),
});

export const taskGraph = (): GraphV2 => {
  const source = taskNode('task-source');
  const target = taskNode('task-target', {visual: {position: {x: 320, y: 0}}});
  const binding: GraphBinding = {
    id: 'task-source-to-task-target',
    kind: 'execution-only',
    source: {kind: 'node', node_id: source.id},
    target: {kind: 'node', node_id: target.id},
  };
  return graphFixture({nodes: [source, target], bindings: [binding]});
};

export const functionGraph = (): GraphV2 => {
  const source = functionNode('normalize', {
    name: 'normalize',
    label: 'Normalize',
    signature: 'def normalize(value: int) -> int',
    source: 'def normalize(value: int) -> int:\n    return value\n',
    ports: [
      port('in-value', 'value', 'input', 'data', ['data'], false),
      port('out-result', 'result', 'output', 'data', ['data'], false, 'many'),
    ],
    visual: {position: {x: 0, y: 0}},
  });
  const target = functionNode('format-result', {
    name: 'format_result',
    label: 'Format result',
    signature: 'def format_result(value: int) -> int',
    source: 'def format_result(value: int) -> int:\n    return value\n',
    ports: [
      port('in-value', 'value', 'input', 'data', ['data'], true),
      port('out-result', 'result', 'output', 'data', ['data'], false, 'many'),
    ],
  });
  const bindings: GraphBinding[] = [
    {
      id: 'normalize-result',
      kind: 'data',
      source: {kind: 'port', node_id: source.id, port_id: 'out-result'},
      target: {kind: 'port', node_id: target.id, port_id: 'in-value'},
    },
    {
      id: 'normalize-parent',
      kind: 'inferred',
      source: {kind: 'node', node_id: source.id},
      target: {kind: 'node', node_id: target.id},
      derived_from: {kind: 'port', node_id: source.id, port_id: 'out-result'},
    },
  ];
  return graphFixture({nodes: [source, target], bindings});
};

export const invalidGraphs = (): InvalidGraphFixture[] => {
  const duplicate = taskGraph();
  duplicate.nodes[1].name = duplicate.nodes[0].name;

  const cycle = taskGraph();
  cycle.bindings.push({
    id: 'task-target-to-task-source',
    kind: 'execution-only',
    source: {kind: 'node', node_id: 'task-target'},
    target: {kind: 'node', node_id: 'task-source'},
  });

  const unknownPort = functionGraph();
  (unknownPort.bindings[0] as Extract<GraphBinding, {kind: 'data'}>).target.port_id = 'does-not-exist';

  const secret = functionGraph();
  (
    secret.nodes[0] as unknown as {configuration: Record<string, unknown>}
  ).configuration.api_key = '<redacted>';

  const unsupported = taskGraph();
  (unsupported as {schema_version: number}).schema_version = 999;

  return [
    {name: 'duplicate-node-name', document: duplicate},
    {name: 'cycle', document: cycle},
    {name: 'unknown-port', document: unknownPort},
    {name: 'embedded-secret', document: secret},
    {name: 'unsupported-schema', document: unsupported},
  ];
};

export const fixtureDefinition = (overrides: Partial<DefinitionFixture> = {}): DefinitionFixture => ({
  id: 'definition-0001',
  revision: 1,
  document: functionGraph(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...clone(overrides),
});
