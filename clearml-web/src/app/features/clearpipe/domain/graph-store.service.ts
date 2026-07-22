import {computed, Injectable, signal} from '@angular/core';
import {
  ArtifactBinding,
  DataBinding,
  DocumentMetadata,
  ExecutionOnlyBinding,
  FunctionConfiguration,
  FunctionNode,
  GraphBinding,
  GraphCodecIssue,
  GraphDecodeResult,
  GraphDependency,
  GraphNode,
  GraphOutput,
  GraphPort,
  GraphSettings,
  GraphV2,
  InferredBinding,
  JsonValue,
  ParameterBinding,
  PipelineParameter,
  Point,
  ResourceReference,
  TaskConfiguration,
  TaskNode,
  TaskReference,
  UnsupportedGraph,
  GRAPH_V2_SCHEMA_VERSION,
} from './graph-v2.types';
import {canonicalGraphV2, decodeGraphV2, deriveGraphV2Dependencies, serializeGraphV2} from './graph-v2-codec';

export interface GraphCommandResult {
  ok: boolean;
  changed: boolean;
  command: string;
  errors: GraphCodecIssue[];
}

export interface GraphCommandWithId extends GraphCommandResult {
  id?: string;
}

export interface GraphCommandMetadata {
  label: string;
  transaction: boolean;
}

export interface GraphPortReference {
  node_id: string;
  port: GraphPort;
}

export interface GraphGeneratedInput {
  node_id: string;
  port_id: string;
  binding_ids: string[];
}

export interface GraphEditorTransientState {
  selected_node_id: string | null;
  selected_port: GraphPortReference | null;
  hovered_node_id: string | null;
  dragging_node_id: string | null;
  active_menu: string | null;
  polling: boolean;
  requests: Readonly<Record<string, 'idle' | 'pending' | 'success' | 'error'>>;
}

export type GraphBindingInput =
  | (Omit<DataBinding, 'id'> & {id?: string})
  | (Omit<ArtifactBinding, 'id'> & {id?: string})
  | (Omit<ParameterBinding, 'id'> & {id?: string})
  | (Omit<InferredBinding, 'id'> & {id?: string})
  | (Omit<ExecutionOnlyBinding, 'id'> & {id?: string});

export type TaskNodeInput = Omit<TaskNode, 'id' | 'name' | 'kind'> & {id?: string; name?: string};
export type FunctionNodeInput = Omit<FunctionNode, 'id' | 'name' | 'kind'> & {id?: string; name?: string};
export type GraphPortInput = Omit<GraphPort, 'id'> & {id?: string};
export type TaskConfigurationPatch = Partial<TaskConfiguration>;

interface ActiveTransaction {
  label: string;
  graph: GraphV2;
  before: string;
  failed: GraphCommandResult | null;
}

interface TransientSnapshot {
  selectedNodeId: string | null;
  selectedPort: {node_id: string; port_id: string} | null;
  hoveredNodeId: string | null;
  draggingNodeId: string | null;
  activeMenu: string | null;
  polling: boolean;
  requests: Record<string, 'idle' | 'pending' | 'success' | 'error'>;
}

const emptyResult = (command: string, changed = false): GraphCommandResult => ({ok: true, changed, command, errors: []});

const errorResult = (command: string, code: string, path = 'graph', message = code): GraphCommandResult => ({
  ok: false,
  changed: false,
  command,
  errors: [{code, path, message}],
});

const taskConfigurationFields = ['clone_base_task', 'cache', 'queue_resource_id', 'retry_on_failure'] as const;
const hasOwn = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);

const clone = <T>(value: T): T => structuredClone(value);

const compareStableStrings = (left: string, right: string): number => left === right ? 0 : left < right ? -1 : 1;

const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(freeze);
  }
  return value;
};

const endpointReferencesNode = (binding: GraphBinding, nodeId: string): boolean => {
  if (binding.source.kind === 'node' || binding.source.kind === 'port') {
    if (binding.source.node_id === nodeId) return true;
  }
  if (binding.target.kind === 'node' || binding.target.kind === 'port') {
    if (binding.target.node_id === nodeId) return true;
  }
  return binding.kind === 'inferred' && binding.derived_from.node_id === nodeId;
};

const endpointReferencesPort = (binding: GraphBinding, nodeId: string, portId: string): boolean => {
  const matches = (endpoint: {kind: string; node_id?: string; port_id?: string}): boolean =>
    endpoint.kind === 'port' && endpoint.node_id === nodeId && endpoint.port_id === portId;
  return matches(binding.source) || matches(binding.target)
    || (binding.kind === 'inferred' && matches(binding.derived_from));
};

const asResult = (command: string, result: GraphDecodeResult): GraphCommandResult =>
  result.status === 'invalid'
    ? {ok: false, changed: false, command, errors: result.errors}
    : errorResult(command, result.status === 'unsupported' ? result.unsupported.reason : 'invalid_graph',
      result.status === 'unsupported' ? result.unsupported.path : 'graph');

const decodeGraphDocument = (raw: unknown): GraphDecodeResult => {
  if (typeof raw !== 'string') return decodeGraphV2(raw);
  try {
    return decodeGraphV2(JSON.parse(raw));
  } catch {
    return {
      status: 'invalid',
      errors: [{code: 'invalid_json', path: 'graph', message: 'The graph document is not valid JSON'}],
    };
  }
};

export const createEmptyGraphV2 = (document: Partial<DocumentMetadata> = {}): GraphV2 => {
  const {tags, ...metadata} = document;
  return {
    schema_version: GRAPH_V2_SCHEMA_VERSION,
    document: {
      name: 'Untitled_ClearPipe',
      project: 'ClearPipe',
      ...metadata,
      tags: [...(tags ?? ['clearpipe', 'pipeline'])],
    },
    settings: {},
    parameters: [],
    resources: [],
    outputs: [],
    nodes: [],
    bindings: [],
    visual: {viewport: {x: 0, y: 0}, zoom: 1},
  };
};

/**
 * The only mutable owner of a canonical ClearPipe v2 graph in the browser.
 * UI interaction state is intentionally kept in separate signals below.
 */
@Injectable({providedIn: 'root'})
export class GraphStoreService {
  private readonly graphState = signal<GraphV2 | null>(null);
  private readonly baselineSerialization = signal<string | null>(null);
  private readonly editableState = signal(true);
  private readonly activeTransactionState = signal<ActiveTransaction | null>(null);
  private idSequence = 0;

  readonly graph = this.graphState.asReadonly();
  readonly unsupported = signal<UnsupportedGraph | null>(null);
  readonly loadErrors = signal<GraphCodecIssue[]>([]);
  readonly editable = this.editableState.asReadonly();
  readonly readOnly = computed(() => !this.editableState() || this.unsupported() !== null);
  readonly serialized = computed(() => {
    const graph = this.graphState();
    return graph ? serializeGraphV2(graph) : null;
  });
  readonly dirty = computed(() => {
    const baseline = this.baselineSerialization();
    const serialized = this.serialized();
    return baseline !== null && serialized !== null && baseline !== serialized;
  });
  readonly lastCommand = signal<GraphCommandMetadata | null>(null);

  readonly selectedNodeId = signal<string | null>(null);
  private readonly selectedPortLocation = signal<{node_id: string; port_id: string} | null>(null);
  readonly selectedPort = computed<GraphPortReference | null>(() => {
    const location = this.selectedPortLocation();
    const port = location ? this.port(location.node_id, location.port_id) : null;
    return port && location ? {node_id: location.node_id, port} : null;
  });
  readonly hoveredNodeId = signal<string | null>(null);
  readonly draggingNodeId = signal<string | null>(null);
  readonly activeMenu = signal<string | null>(null);
  readonly polling = signal(false);
  readonly requests = signal<Record<string, 'idle' | 'pending' | 'success' | 'error'>>({});
  readonly transient = computed<GraphEditorTransientState>(() => ({
    selected_node_id: this.selectedNodeId(),
    selected_port: this.selectedPort(),
    hovered_node_id: this.hoveredNodeId(),
    dragging_node_id: this.draggingNodeId(),
    active_menu: this.activeMenu(),
    polling: this.polling(),
    requests: this.requests(),
  }));

  readonly nodes = computed<readonly GraphNode[]>(() => this.graphState()?.nodes ?? []);
  readonly ports = computed<readonly GraphPortReference[]>(() =>
    (this.graphState()?.nodes ?? []).flatMap((node) => node.ports.map((port) => ({node_id: node.id, port}))));
  readonly bindings = computed<readonly GraphBinding[]>(() => this.graphState()?.bindings ?? []);
  readonly dependencies = computed<readonly GraphDependency[]>(() => {
    const graph = this.graphState();
    return graph ? deriveGraphV2Dependencies(graph) : [];
  });
  readonly generatedInputs = computed<readonly GraphGeneratedInput[]>(() => {
    const graph = this.graphState();
    if (!graph) return [];
    const inputs = new Map<string, GraphGeneratedInput>();
    graph.bindings.forEach((binding) => {
      if (binding.kind !== 'data' && binding.kind !== 'artifact' && binding.kind !== 'parameter') return;
      const key = `${binding.target.node_id}\u0000${binding.target.port_id}`;
      const current = inputs.get(key) ?? {
        node_id: binding.target.node_id,
        port_id: binding.target.port_id,
        binding_ids: [],
      };
      current.binding_ids.push(binding.id);
      inputs.set(key, current);
    });
    return [...inputs.values()]
      .map((input) => ({...input, binding_ids: input.binding_ids.sort(compareStableStrings)}))
      .sort((left, right) => compareStableStrings(left.node_id, right.node_id)
        || compareStableStrings(left.port_id, right.port_id));
  });
  readonly selectedNode = computed(() => {
    const selectedId = this.selectedNodeId();
    return this.nodes().find((node) => node.id === selectedId) ?? null;
  });

  create(document: Partial<DocumentMetadata> = {}): GraphCommandResult {
    const loaded = this.load(createEmptyGraphV2(document));
    return loaded.status === 'ok' ? emptyResult('create', true) : asResult('create', loaded);
  }

  load(raw: unknown): GraphDecodeResult {
    const decoded = decodeGraphDocument(raw);
    this.resetTransient();
    this.lastCommand.set(null);
    if (decoded.status === 'ok') {
      const graph = freeze(canonicalGraphV2(clone(decoded.graph)));
      this.graphState.set(graph);
      this.baselineSerialization.set(serializeGraphV2(graph));
      this.unsupported.set(null);
      this.loadErrors.set([]);
      return {status: 'ok', graph};
    }

    this.graphState.set(null);
    this.baselineSerialization.set(null);
    if (decoded.status === 'unsupported') {
      this.unsupported.set(freeze(clone(decoded.unsupported)));
      this.loadErrors.set([]);
    } else {
      this.unsupported.set(null);
      this.loadErrors.set(clone(decoded.errors));
    }
    return decoded;
  }

  markSaved(raw?: unknown): GraphDecodeResult | GraphCommandResult {
    if (typeof raw !== 'undefined') {
      const decoded = decodeGraphDocument(raw);
      return decoded.status === 'ok' ? this.load(decoded.graph) : decoded;
    }
    const graph = this.graphState();
    if (!graph) return errorResult('mark-saved', 'no_graph_loaded');
    this.baselineSerialization.set(serializeGraphV2(graph));
    return emptyResult('mark-saved');
  }

  setEditable(editable: boolean): void {
    this.editableState.set(editable);
  }

  serialize(): string | null {
    return this.serialized();
  }

  logicallyEquals(other: GraphV2 | null | undefined): boolean {
    const graph = this.graphState();
    return !!graph && !!other && graphV2LogicallyEquals(graph, other);
  }

  runTransaction(label: string, operation: () => void): GraphCommandResult {
    const active = this.activeTransactionState();
    if (active) {
      operation();
      return active.failed ?? emptyResult(label);
    }
    const graph = this.editableGraph(label);
    if ('result' in graph) return graph.result;

    const transientBefore = this.captureTransient();
    const transaction: ActiveTransaction = {
      label,
      graph: clone(graph.value),
      before: serializeGraphV2(graph.value),
      failed: null,
    };
    this.activeTransactionState.set(transaction);
    try {
      operation();
    } catch {
      transaction.failed = errorResult(label, 'transaction_failed', 'graph', 'The graph transaction was rolled back');
    } finally {
      this.activeTransactionState.set(null);
    }
    if (transaction.failed) {
      this.restoreTransient(transientBefore);
      return transaction.failed;
    }

    const decoded = decodeGraphV2(transaction.graph);
    if (decoded.status !== 'ok') {
      this.restoreTransient(transientBefore);
      return asResult(label, decoded);
    }
    const canonical = canonicalGraphV2(decoded.graph);
    const changed = transaction.before !== serializeGraphV2(canonical);
    if (changed) this.graphState.set(freeze(clone(canonical)));
    this.lastCommand.set({label, transaction: true});
    return emptyResult(label, changed);
  }

  transaction(label: string, operation: () => void): GraphCommandResult {
    return this.runTransaction(label, operation);
  }

  updateDocument(patch: Partial<DocumentMetadata>): GraphCommandResult {
    return this.command('update-document', (graph) => {
      graph.document = {...graph.document, ...clone(patch), tags: [...(patch.tags ?? graph.document.tags)]};
    });
  }

  updateSettings(patch: Partial<GraphSettings>): GraphCommandResult {
    return this.command('update-settings', (graph) => {
      graph.settings = {...graph.settings, ...clone(patch)};
      if (typeof patch.default_execution_queue_id === 'undefined') delete graph.settings.default_execution_queue_id;
    });
  }

  addNode(node: GraphNode): GraphCommandResult {
    return this.command('add-node', (graph) => {
      graph.nodes.push(clone(node));
    });
  }

  createTaskNode(input: TaskNodeInput): GraphCommandWithId {
    const graph = this.currentGraph();
    if (!graph) return {...errorResult('create-task-node', 'no_graph_loaded'), id: undefined};
    const id = input.id ?? this.nextId('node', graph.nodes.map((node) => node.id));
    const name = input.name ?? this.nextName('task', graph.nodes.map((node) => node.name));
    const result = this.addNode({id, name, ...clone(input), kind: 'task'} as TaskNode);
    return {...result, id: result.ok ? id : undefined};
  }

  createFunctionNode(input: FunctionNodeInput): GraphCommandWithId {
    const graph = this.currentGraph();
    if (!graph) return {...errorResult('create-function-node', 'no_graph_loaded'), id: undefined};
    const id = input.id ?? this.nextId('node', graph.nodes.map((node) => node.id));
    const name = input.name ?? this.nextName('function', graph.nodes.map((node) => node.name));
    const result = this.addNode({id, name, ...clone(input), kind: 'function'} as FunctionNode);
    return {...result, id: result.ok ? id : undefined};
  }

  updateNodeMetadata(nodeId: string, patch: Pick<Partial<GraphNode>, 'name' | 'label'>): GraphCommandResult {
    return this.command('update-node-metadata', (graph) => {
      const node = this.requireNode(graph, nodeId);
      Object.assign(node, clone(patch));
    });
  }

  updateNodeConfiguration(nodeId: string, patch: Record<string, JsonValue | undefined>): GraphCommandResult {
    return this.command('update-node-configuration', (graph) => {
      const node = this.requireNode(graph, nodeId);
      const configuration = {...node.configuration} as Record<string, JsonValue>;
      Object.entries(patch).forEach(([key, value]) => {
        if (typeof value === 'undefined') delete configuration[key];
        else configuration[key] = clone(value);
      });
      node.configuration = configuration as unknown as TaskConfiguration & FunctionConfiguration;
    });
  }

  replaceTaskBaseTask(nodeId: string, baseTask: TaskReference): GraphCommandResult {
    return this.command('replace-task-base-task', (graph) => {
      this.requireTaskNode(graph, nodeId).base_task = clone(baseTask);
    });
  }

  updateTaskConfiguration(nodeId: string, patch: TaskConfigurationPatch): GraphCommandResult {
    return this.command('update-task-configuration', (graph) => {
      const task = this.requireTaskNode(graph, nodeId);
      const unsupportedField = Object.keys(patch).find((key) =>
        !(taskConfigurationFields as readonly string[]).includes(key));
      if (unsupportedField) {
        throw errorResult('graph-command', 'unsupported_task_configuration_field',
          `graph.nodes.${nodeId}.configuration.${unsupportedField}`);
      }
      const configuration = {...task.configuration};
      if (hasOwn(patch, 'clone_base_task')) {
        if (typeof patch.clone_base_task === 'undefined') delete configuration.clone_base_task;
        else configuration.clone_base_task = patch.clone_base_task;
      }
      if (hasOwn(patch, 'cache')) {
        if (typeof patch.cache === 'undefined') delete configuration.cache;
        else configuration.cache = patch.cache;
      }
      if (hasOwn(patch, 'queue_resource_id')) {
        if (typeof patch.queue_resource_id === 'undefined') delete configuration.queue_resource_id;
        else configuration.queue_resource_id = patch.queue_resource_id;
      }
      if (hasOwn(patch, 'retry_on_failure')) {
        if (typeof patch.retry_on_failure === 'undefined') delete configuration.retry_on_failure;
        else configuration.retry_on_failure = patch.retry_on_failure;
      }
      task.configuration = configuration;
    });
  }

  setNodePosition(nodeId: string, position: Point): GraphCommandResult {
    return this.command('set-node-position', (graph) => {
      this.requireNode(graph, nodeId).visual.position = clone(position);
    });
  }

  setNodeDimensions(nodeId: string, dimensions: {width: number; height: number} | undefined): GraphCommandResult {
    return this.command('set-node-dimensions', (graph) => {
      const visual = this.requireNode(graph, nodeId).visual;
      if (dimensions) visual.dimensions = clone(dimensions);
      else delete visual.dimensions;
    });
  }

  removeNode(nodeId: string): GraphCommandResult {
    return this.command('remove-node', (graph) => {
      this.requireNode(graph, nodeId);
      graph.nodes = graph.nodes.filter((node) => node.id !== nodeId);
      graph.bindings = graph.bindings.filter((binding) => !endpointReferencesNode(binding, nodeId));
      graph.outputs = graph.outputs.filter((output) => output.source.node_id !== nodeId);
      this.clearTransientReferences(nodeId);
    });
  }

  addPort(nodeId: string, port: GraphPort): GraphCommandResult {
    return this.command('add-port', (graph) => {
      this.requireNode(graph, nodeId).ports.push(clone(port));
    });
  }

  createPort(nodeId: string, input: GraphPortInput): GraphCommandWithId {
    const node = this.currentGraph()?.nodes.find((item) => item.id === nodeId);
    if (!node) return {...errorResult('create-port', 'unknown_node', 'graph.nodes'), id: undefined};
    const id = input.id ?? this.nextId('port', node.ports.map((port) => port.id));
    const result = this.addPort(nodeId, {id, ...clone(input)} as GraphPort);
    return {...result, id: result.ok ? id : undefined};
  }

  updatePort(nodeId: string, portId: string, patch: Omit<Partial<GraphPort>, 'id'>): GraphCommandResult {
    return this.command('update-port', (graph) => {
      const port = this.requirePort(graph, nodeId, portId);
      Object.assign(port, clone(patch));
    });
  }

  removePort(nodeId: string, portId: string): GraphCommandResult {
    return this.command('remove-port', (graph) => {
      const node = this.requireNode(graph, nodeId);
      this.requirePort(graph, nodeId, portId);
      node.ports = node.ports.filter((port) => port.id !== portId);
      graph.bindings = graph.bindings.filter((binding) => !endpointReferencesPort(binding, nodeId, portId));
      graph.outputs = graph.outputs.filter((output) =>
        output.source.node_id !== nodeId || output.source.port_id !== portId);
      if (this.selectedPortLocation()?.node_id === nodeId && this.selectedPortLocation()?.port_id === portId) {
        this.selectedPortLocation.set(null);
      }
    });
  }

  addBinding(binding: GraphBinding): GraphCommandResult {
    return this.command('add-binding', (graph) => {
      graph.bindings.push(clone(binding));
    });
  }

  createBinding(input: GraphBindingInput): GraphCommandWithId {
    const graph = this.currentGraph();
    if (!graph) return {...errorResult('create-binding', 'no_graph_loaded'), id: undefined};
    const id = input.id ?? this.nextId('binding', graph.bindings.map((binding) => binding.id));
    const result = this.addBinding({...clone(input), id} as GraphBinding);
    return {...result, id: result.ok ? id : undefined};
  }

  replaceBinding(bindingId: string, binding: GraphBinding): GraphCommandResult {
    return this.command('replace-binding', (graph) => {
      const index = graph.bindings.findIndex((item) => item.id === bindingId);
      if (index < 0) throw errorResult('replace-binding', 'unknown_binding', 'graph.bindings');
      if (binding.id !== bindingId) throw errorResult('replace-binding', 'binding_id_immutable', 'graph.bindings');
      graph.bindings[index] = clone(binding);
    });
  }

  updateBinding(bindingId: string, binding: GraphBinding): GraphCommandResult {
    return this.replaceBinding(bindingId, binding);
  }

  removeBinding(bindingId: string): GraphCommandResult {
    return this.command('remove-binding', (graph) => {
      if (!graph.bindings.some((binding) => binding.id === bindingId)) {
        throw errorResult('remove-binding', 'unknown_binding', 'graph.bindings');
      }
      graph.bindings = graph.bindings.filter((binding) => binding.id !== bindingId);
    });
  }

  addParameter(parameter: PipelineParameter): GraphCommandResult {
    return this.command('add-parameter', (graph) => {
      graph.parameters.push(clone(parameter));
    });
  }

  updateParameter(parameterId: string, patch: Omit<Partial<PipelineParameter>, 'id'>): GraphCommandResult {
    return this.command('update-parameter', (graph) => {
      const parameter = graph.parameters.find((item) => item.id === parameterId);
      if (!parameter) throw errorResult('update-parameter', 'unknown_parameter', 'graph.parameters');
      Object.assign(parameter, clone(patch));
    });
  }

  removeParameter(parameterId: string): GraphCommandResult {
    return this.command('remove-parameter', (graph) => {
      if (!graph.parameters.some((parameter) => parameter.id === parameterId)) {
        throw errorResult('remove-parameter', 'unknown_parameter', 'graph.parameters');
      }
      graph.parameters = graph.parameters.filter((parameter) => parameter.id !== parameterId);
      graph.bindings = graph.bindings.filter((binding) =>
        binding.kind !== 'parameter' || binding.source.parameter_id !== parameterId);
    });
  }

  addResource(resource: ResourceReference): GraphCommandResult {
    return this.command('add-resource', (graph) => {
      graph.resources.push(clone(resource));
    });
  }

  updateResource(resourceId: string, patch: Omit<Partial<ResourceReference>, 'id'>): GraphCommandResult {
    return this.command('update-resource', (graph) => {
      const resource = graph.resources.find((item) => item.id === resourceId);
      if (!resource) throw errorResult('update-resource', 'unknown_resource', 'graph.resources');
      Object.assign(resource, clone(patch));
    });
  }

  removeResource(resourceId: string): GraphCommandResult {
    return this.command('remove-resource', (graph) => {
      if (!graph.resources.some((resource) => resource.id === resourceId)) {
        throw errorResult('remove-resource', 'unknown_resource', 'graph.resources');
      }
      graph.resources = graph.resources.filter((resource) => resource.id !== resourceId);
      graph.bindings = graph.bindings.filter((binding) =>
        binding.kind !== 'artifact' || binding.source.kind !== 'resource' || binding.source.resource_id !== resourceId);
      if (graph.settings.default_execution_queue_id === resourceId) delete graph.settings.default_execution_queue_id;
      graph.nodes.forEach((node) => {
        if (node.configuration.queue_resource_id === resourceId) delete node.configuration.queue_resource_id;
      });
    });
  }

  addOutput(output: GraphOutput): GraphCommandResult {
    return this.command('add-output', (graph) => {
      graph.outputs.push(clone(output));
    });
  }

  updateOutput(outputId: string, patch: Omit<Partial<GraphOutput>, 'id'>): GraphCommandResult {
    return this.command('update-output', (graph) => {
      const output = graph.outputs.find((item) => item.id === outputId);
      if (!output) throw errorResult('update-output', 'unknown_output', 'graph.outputs');
      Object.assign(output, clone(patch));
    });
  }

  removeOutput(outputId: string): GraphCommandResult {
    return this.command('remove-output', (graph) => {
      if (!graph.outputs.some((output) => output.id === outputId)) {
        throw errorResult('remove-output', 'unknown_output', 'graph.outputs');
      }
      graph.outputs = graph.outputs.filter((output) => output.id !== outputId);
    });
  }

  setViewport(viewport: GraphV2['visual']): GraphCommandResult {
    return this.command('set-viewport', (graph) => {
      graph.visual = clone(viewport);
    });
  }

  node(nodeId: string): GraphNode | null {
    return this.nodes().find((node) => node.id === nodeId) ?? null;
  }

  port(nodeId: string, portId: string): GraphPort | null {
    return this.node(nodeId)?.ports.find((port) => port.id === portId) ?? null;
  }

  portsForNode(nodeId: string): readonly GraphPort[] {
    return this.node(nodeId)?.ports ?? [];
  }

  bindingsForNode(nodeId: string): readonly GraphBinding[] {
    return this.bindings().filter((binding) => endpointReferencesNode(binding, nodeId));
  }

  bindingsForPort(nodeId: string, portId: string): readonly GraphBinding[] {
    return this.bindings().filter((binding) => endpointReferencesPort(binding, nodeId, portId));
  }

  dependenciesForNode(nodeId: string): readonly GraphDependency[] {
    return this.dependencies().filter((dependency) =>
      dependency.source_node_id === nodeId || dependency.target_node_id === nodeId);
  }

  generatedInputsForNode(nodeId: string): readonly GraphGeneratedInput[] {
    return this.generatedInputs().filter((input) => input.node_id === nodeId);
  }

  selectNode(nodeId: string | null): void {
    this.selectedNodeId.set(nodeId && this.node(nodeId) ? nodeId : null);
    if (nodeId === null || !this.node(nodeId)) this.selectedPortLocation.set(null);
  }

  selectPort(nodeId: string | null, portId?: string): void {
    const port = nodeId && portId ? this.port(nodeId, portId) : null;
    this.selectedPortLocation.set(port && nodeId && portId ? {node_id: nodeId, port_id: portId} : null);
    if (port && nodeId) this.selectedNodeId.set(nodeId);
  }

  setHoveredNode(nodeId: string | null): void {
    this.hoveredNodeId.set(nodeId && this.node(nodeId) ? nodeId : null);
  }

  setDraggingNode(nodeId: string | null): void {
    this.draggingNodeId.set(nodeId && this.node(nodeId) ? nodeId : null);
  }

  setActiveMenu(menu: string | null): void {
    this.activeMenu.set(menu);
  }

  setRequestState(request: string, state: 'idle' | 'pending' | 'success' | 'error'): void {
    this.requests.update((requests) => ({...requests, [request]: state}));
  }

  setPolling(polling: boolean): void {
    this.polling.set(polling);
  }

  resetTransient(): void {
    this.selectedNodeId.set(null);
    this.selectedPortLocation.set(null);
    this.hoveredNodeId.set(null);
    this.draggingNodeId.set(null);
    this.activeMenu.set(null);
    this.polling.set(false);
    this.requests.set({});
  }

  private command(label: string, mutation: (graph: GraphV2) => void): GraphCommandResult {
    const active = this.activeTransactionState();
    if (active?.failed) return active.failed;
    const graphResult = active ? {ok: true as const, value: active.graph} : this.editableGraph(label);
    if ('result' in graphResult) {
      if (active) active.failed = graphResult.result;
      return graphResult.result;
    }
    const draft = clone(graphResult.value);
    const before = serializeGraphV2(graphResult.value);
    try {
      mutation(draft);
    } catch (error: unknown) {
      const result = this.commandError(label, error);
      if (active) active.failed = result;
      return result;
    }
    const decoded = decodeGraphV2(draft);
    if (decoded.status !== 'ok') {
      const result = asResult(label, decoded);
      if (active) active.failed = result;
      return result;
    }
    const canonical = canonicalGraphV2(decoded.graph);
    const changed = before !== serializeGraphV2(canonical);
    if (active) {
      active.graph = canonical;
      return emptyResult(label, changed);
    }
    if (changed) this.graphState.set(freeze(clone(canonical)));
    this.lastCommand.set({label, transaction: false});
    return emptyResult(label, changed);
  }

  private editableGraph(command: string):
    | {ok: true; value: GraphV2}
    | {ok: false; result: GraphCommandResult} {
    const graph = this.graphState();
    if (!graph) {
      return {ok: false, result: errorResult(command, this.unsupported() ? 'unsupported_graph_read_only' : 'no_graph_loaded')};
    }
    if (this.readOnly()) return {ok: false, result: errorResult(command, 'graph_read_only')};
    return {ok: true, value: graph};
  }

  private requireNode(graph: GraphV2, nodeId: string): GraphNode {
    const node = graph.nodes.find((item) => item.id === nodeId);
    if (!node) throw errorResult('graph-command', 'unknown_node', 'graph.nodes');
    return node;
  }

  private requireTaskNode(graph: GraphV2, nodeId: string): TaskNode {
    const node = this.requireNode(graph, nodeId);
    if (node.kind !== 'task') throw errorResult('graph-command', 'node_not_task', 'graph.nodes');
    return node;
  }

  private requirePort(graph: GraphV2, nodeId: string, portId: string): GraphPort {
    const port = this.requireNode(graph, nodeId).ports.find((item) => item.id === portId);
    if (!port) throw errorResult('graph-command', 'unknown_port', 'graph.nodes');
    return port;
  }

  private commandError(command: string, error: unknown): GraphCommandResult {
    if (this.isCommandResult(error)) return {...error, command};
    return errorResult(command, 'command_failed', 'graph', 'The graph command could not be applied');
  }

  private isCommandResult(value: unknown): value is GraphCommandResult {
    return !!value && typeof value === 'object' && 'ok' in value && 'errors' in value;
  }

  private clearTransientReferences(nodeId: string): void {
    if (this.selectedNodeId() === nodeId) this.selectedNodeId.set(null);
    if (this.selectedPortLocation()?.node_id === nodeId) this.selectedPortLocation.set(null);
    if (this.hoveredNodeId() === nodeId) this.hoveredNodeId.set(null);
    if (this.draggingNodeId() === nodeId) this.draggingNodeId.set(null);
  }

  private captureTransient(): TransientSnapshot {
    const selectedPort = this.selectedPortLocation();
    return {
      selectedNodeId: this.selectedNodeId(),
      selectedPort: selectedPort ? {...selectedPort} : null,
      hoveredNodeId: this.hoveredNodeId(),
      draggingNodeId: this.draggingNodeId(),
      activeMenu: this.activeMenu(),
      polling: this.polling(),
      requests: {...this.requests()},
    };
  }

  private restoreTransient(snapshot: TransientSnapshot): void {
    this.selectedNodeId.set(snapshot.selectedNodeId);
    this.selectedPortLocation.set(snapshot.selectedPort);
    this.hoveredNodeId.set(snapshot.hoveredNodeId);
    this.draggingNodeId.set(snapshot.draggingNodeId);
    this.activeMenu.set(snapshot.activeMenu);
    this.polling.set(snapshot.polling);
    this.requests.set(snapshot.requests);
  }

  private currentGraph(): GraphV2 | null {
    return this.activeTransactionState()?.graph ?? this.graphState();
  }

  private nextId(prefix: string, occupied: readonly string[]): string {
    const ids = new Set(occupied);
    let candidate = '';
    do {
      this.idSequence += 1;
      candidate = `${prefix}_${this.idSequence}`;
    } while (ids.has(candidate));
    return candidate;
  }

  private nextName(prefix: string, occupied: readonly string[]): string {
    const names = new Set(occupied);
    let index = 1;
    let candidate = prefix;
    while (names.has(candidate)) {
      index += 1;
      candidate = `${prefix}_${index}`;
    }
    return candidate;
  }
}

export const graphV2LogicallyEquals = (left: GraphV2, right: GraphV2): boolean =>
  serializeGraphV2(left) === serializeGraphV2(right);
