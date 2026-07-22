import graphStoreFixture from '../domain/fixtures/graph-store.v2.json';
import {decodeGraphV2} from '../domain/graph-v2-codec';
import {
  createEmptyGraphV2,
  GraphStoreService,
  graphV2LogicallyEquals,
  FunctionConfigurationPatch,
  TaskConfigurationPatch,
} from '../domain/graph-store.service';

describe('GraphStoreService', () => {
  let store: GraphStoreService;

  beforeEach(() => {
    store = new GraphStoreService();
    expect(store.load(graphStoreFixture).status).toBe('ok');
  });

  it('uses CP-06 canonical serialization for logical equality and dirty tracking', () => {
    const graph = store.graph();
    if (!graph) throw new Error('fixture must load');
    const reordered = structuredClone(graph);
    reordered.nodes.reverse();
    reordered.bindings.reverse();
    reordered.document.tags.reverse();

    expect(graphV2LogicallyEquals(graph, reordered)).toBeTrue();
    expect(store.logicallyEquals(reordered)).toBeTrue();
    expect(store.serialize()).toBe(store.serialized());
    expect(store.dirty()).toBeFalse();

    expect(store.updateDocument({tags: [...graph.document.tags].reverse()}).changed).toBeFalse();
    expect(store.dirty()).toBeFalse();
    expect(store.setNodePosition('normalize', {x: 20, y: 30}).changed).toBeTrue();
    expect(store.dirty()).toBeTrue();
    const reloaded = new GraphStoreService();
    expect(reloaded.load(store.serialize()!).status).toBe('ok');
    expect(reloaded.logicallyEquals(store.graph())).toBeTrue();
    expect(store.markSaved()).toEqual(jasmine.objectContaining({ok: true}));
    expect(store.dirty()).toBeFalse();
  });

  it('keeps selection, hover, drag, menus, requests, and polling outside persisted dirty state', () => {
    store.selectNode('normalize');
    store.selectPort('normalize', 'out-value');
    store.setHoveredNode('format');
    store.setDraggingNode('normalize');
    store.setActiveMenu('node-menu');
    store.setRequestState('validate', 'pending');
    store.setPolling(true);

    expect(store.selectedNode()?.id).toBe('normalize');
    expect(store.selectedPort()?.port.id).toBe('out-value');
    expect(store.transient().requests.validate).toBe('pending');
    expect(store.dirty()).toBeFalse();

    store.setViewport({viewport: {x: 10, y: 20}, zoom: 1.25});
    expect(store.dirty()).toBeTrue();
  });

  it('derives the selected port from the current canonical graph after a port update', () => {
    store.selectPort('format', 'in-prefix');
    const previous = store.selectedPort()?.port;

    expect(store.updatePort('format', 'in-prefix', {default: 'updated='}).ok).toBeTrue();

    expect(store.selectedPort()).toEqual({
      node_id: 'format',
      port: jasmine.objectContaining({id: 'in-prefix', default: 'updated='}),
    });
    expect(store.selectedPort()?.port).toBe(store.port('format', 'in-prefix'));
    expect(store.selectedPort()?.port).not.toBe(previous);
    const transientDefault: unknown = store.transient().selected_port?.port.default;
    expect(transientDefault).toBe('updated=');
  });

  it('cleans bindings and outputs when ports and nodes are removed', () => {
    expect(store.generatedInputsForNode('format')).toEqual([
      {node_id: 'format', port_id: 'in-prefix', binding_ids: ['bind-parameter']},
      {node_id: 'format', port_id: 'in-value', binding_ids: ['bind-data']},
    ]);

    store.selectNode('format');
    expect(store.removePort('normalize', 'out-value').ok).toBeTrue();
    expect(store.bindings().map((binding) => binding.id)).toEqual(['bind-parameter']);
    expect(store.dependencies()).toEqual([]);

    expect(store.removeNode('format').ok).toBeTrue();
    expect(store.nodes().map((node) => node.id)).toEqual(['normalize']);
    expect(store.bindings()).toEqual([]);
    expect(store.graph()?.outputs).toEqual([]);
    expect(store.selectedNode()).toBeNull();
    expect(decodeGraphV2(store.graph()!).status).toBe('ok');
  });

  it('cleans resource and parameter dependent references instead of leaving dangling values', () => {
    expect(store.removeParameter('prefix').ok).toBeTrue();
    expect(store.bindings().map((binding) => binding.id)).toEqual(['bind-data']);

    expect(store.removeResource('queue-default').ok).toBeTrue();
    expect(store.graph()?.settings.default_execution_queue_id).toBeUndefined();
    expect(decodeGraphV2(store.graph()!).status).toBe('ok');
  });

  it('commits semantic commands atomically and rolls back an invalid transaction', () => {
    const before = store.serialize();
    const result = store.transaction('add invalid binding', () => {
      store.updateDocument({description: 'This must be rolled back'});
      store.addBinding({
        id: 'bad-binding',
        kind: 'execution-only',
        source: {kind: 'node', node_id: 'normalize'},
        target: {kind: 'node', node_id: 'missing'},
      });
    });

    expect(result.ok).toBeFalse();
    expect(store.serialize()).toBe(before);
    expect(store.graph()?.document.description).toBeUndefined();
    expect(store.dirty()).toBeFalse();
  });

  it('restores selected ports when a failed transaction rolls back a port removal', () => {
    store.selectNode('format');
    store.selectPort('format', 'in-prefix');
    const before = store.serialize();

    const result = store.transaction('remove port then fail', () => {
      store.removePort('format', 'in-prefix');
      store.addBinding({
        id: 'bad-binding',
        kind: 'execution-only',
        source: {kind: 'node', node_id: 'normalize'},
        target: {kind: 'node', node_id: 'missing'},
      });
    });

    expect(result.ok).toBeFalse();
    expect(store.serialize()).toBe(before);
    expect(store.selectedNode()?.id).toBe('format');
    expect(store.selectedPort()).toEqual({
      node_id: 'format',
      port: jasmine.objectContaining({id: 'in-prefix'}),
    });
  });

  it('restores node and port selection when a failed transaction rolls back a node removal', () => {
    store.selectNode('format');
    store.selectPort('format', 'out-text');
    const before = store.serialize();

    const result = store.transaction('remove node then fail', () => {
      store.removeNode('format');
      store.addBinding({
        id: 'bad-binding',
        kind: 'execution-only',
        source: {kind: 'node', node_id: 'normalize'},
        target: {kind: 'node', node_id: 'missing'},
      });
    });

    expect(result.ok).toBeFalse();
    expect(store.serialize()).toBe(before);
    expect(store.selectedNode()?.id).toBe('format');
    expect(store.selectedPort()).toEqual({
      node_id: 'format',
      port: jasmine.objectContaining({id: 'out-text'}),
    });
  });

  it('replaces a task base reference and updates only typed task configuration fields', () => {
    const empty = createEmptyGraphV2({name: 'task_configuration', project: 'examples'});
    expect(store.load(empty).status).toBe('ok');
    const created = store.createTaskNode({
      label: 'Task',
      base_task: {kind: 'task-id', task_id: 'base-task'},
      ports: [],
      configuration: {clone_base_task: true},
      visual: {position: {x: 0, y: 0}},
    });
    const taskId = created.id;
    if (!taskId) throw new Error('task must be created');
    expect(store.markSaved()).toEqual(jasmine.objectContaining({ok: true}));
    store.selectNode(taskId);

    expect(store.replaceTaskBaseTask(taskId, {
      kind: 'task-name',
      project: 'examples',
      name: 'Replacement task',
    })).toEqual(jasmine.objectContaining({ok: true, changed: true}));
    expect(store.updateTaskConfiguration(taskId, {
      cache: true,
      retry_on_failure: 2,
    })).toEqual(jasmine.objectContaining({ok: true, changed: true}));

    const task = store.node(taskId);
    if (!task || task.kind !== 'task') throw new Error('task must be available');
    expect(task.base_task).toEqual({kind: 'task-name', project: 'examples', name: 'Replacement task'});
    expect(task.configuration).toEqual(jasmine.objectContaining({cache: true, retry_on_failure: 2}));
    expect(store.selectedNode()?.id).toBe(taskId);
    expect(store.dirty()).toBeTrue();
    expect(decodeGraphV2(JSON.parse(store.serialize()!))).toEqual(jasmine.objectContaining({status: 'ok'}));

    const beforeInvalidUpdate = store.serialize();
    expect(store.updateTaskConfiguration(taskId, {retry_on_failure: -1})).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'invalid_integer'})],
    }));
    expect(store.serialize()).toBe(beforeInvalidUpdate);
    expect(store.updateTaskConfiguration(taskId, {
      unsupported_option: true,
    } as unknown as TaskConfigurationPatch)).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'unsupported_task_configuration_field'})],
    }));
    expect(store.serialize()).toBe(beforeInvalidUpdate);
  });

  it('enforces task-only task commands and rolls their changes back with the transaction', () => {
    const before = store.serialize();
    expect(store.replaceTaskBaseTask('normalize', {kind: 'task-id', task_id: 'base-task'})).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'node_not_task'})],
    }));
    expect(store.updateTaskConfiguration('normalize', {retry_on_failure: 1})).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'node_not_task'})],
    }));
    expect(store.replaceTaskBaseTask('missing', {kind: 'task-id', task_id: 'base-task'})).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'unknown_node'})],
    }));
    expect(store.serialize()).toBe(before);
    expect(store.dirty()).toBeFalse();

    const created = store.createTaskNode({
      label: 'Task',
      base_task: {kind: 'task-id', task_id: 'base-task'},
      ports: [],
      configuration: {},
      visual: {position: {x: 0, y: 0}},
    });
    const taskId = created.id;
    if (!taskId) throw new Error('task must be created');
    expect(store.markSaved()).toEqual(jasmine.objectContaining({ok: true}));
    store.selectNode(taskId);
    const beforeTransaction = store.serialize();

    const result = store.transaction('rollback task changes', () => {
      store.replaceTaskBaseTask(taskId, {kind: 'task-id', task_id: 'replacement-task'});
      store.updateTaskConfiguration(taskId, {retry_on_failure: 3});
      store.addBinding({
        id: 'bad-binding',
        kind: 'execution-only',
        source: {kind: 'node', node_id: taskId},
        target: {kind: 'node', node_id: 'missing'},
      });
    });

    expect(result.ok).toBeFalse();
    expect(store.serialize()).toBe(beforeTransaction);
    expect(store.selectedNode()?.id).toBe(taskId);
    expect(store.dirty()).toBeFalse();
  });

  it('updates function descriptions and declarative execution settings through typed commands', () => {
    store.selectNode('normalize');
    expect(store.updateFunctionDescription('normalize', 'Normalize an input value.')).toEqual(
      jasmine.objectContaining({ok: true, changed: true}),
    );
    expect(store.updateFunctionConfiguration('normalize', {
      packages: ['pandas==2.2.3', 'scikit-learn==1.5.2'],
      retry_on_failure: 2,
    })).toEqual(jasmine.objectContaining({ok: true, changed: true}));

    const node = store.node('normalize');
    if (!node || node.kind !== 'function') throw new Error('function node must be available');
    expect(node.description).toBe('Normalize an input value.');
    expect(node.configuration).toEqual(jasmine.objectContaining({
      packages: ['pandas==2.2.3', 'scikit-learn==1.5.2'],
      retry_on_failure: 2,
    }));
    expect(store.selectedNode()?.id).toBe('normalize');
    expect(store.dirty()).toBeTrue();

    const beforeInvalidUpdate = store.serialize();
    expect(store.updateFunctionConfiguration('normalize', {retry_on_failure: -1})).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'invalid_integer'})],
    }));
    expect(store.updateFunctionConfiguration('normalize', {
      unsupported_option: true,
    } as unknown as FunctionConfigurationPatch)).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'unsupported_function_configuration_field'})],
    }));
    expect(store.serialize()).toBe(beforeInvalidUpdate);

    expect(store.markSaved()).toEqual(jasmine.objectContaining({ok: true}));
    const beforeTransaction = store.serialize();
    const transaction = store.transaction('rollback function changes', () => {
      store.updateFunctionDescription('normalize', 'This must be rolled back');
      store.updateFunctionConfiguration('normalize', {retry_on_failure: 3});
      store.addBinding({
        id: 'bad-binding',
        kind: 'execution-only',
        source: {kind: 'node', node_id: 'normalize'},
        target: {kind: 'node', node_id: 'missing'},
      });
    });
    expect(transaction.ok).toBeFalse();
    expect(store.serialize()).toBe(beforeTransaction);
    expect(store.selectedNode()?.id).toBe('normalize');
    expect(store.dirty()).toBeFalse();
  });

  it('rejects function commands for task nodes', () => {
    expect(store.load(createEmptyGraphV2()).status).toBe('ok');
    const created = store.createTaskNode({
      label: 'Task',
      base_task: {kind: 'task-id', task_id: 'base-task'},
      ports: [],
      configuration: {},
      visual: {position: {x: 0, y: 0}},
    });
    const taskId = created.id;
    if (!taskId) throw new Error('task must be created');
    expect(store.markSaved()).toEqual(jasmine.objectContaining({ok: true}));
    const before = store.serialize();

    expect(store.updateFunctionDescription(taskId, 'Not a function')).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'node_not_function'})],
    }));
    expect(store.updateFunctionConfiguration(taskId, {retry_on_failure: 1})).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'node_not_function'})],
    }));
    expect(store.serialize()).toBe(before);
    expect(store.dirty()).toBeFalse();
  });

  it('creates stable generated IDs and names through a single transaction command boundary', () => {
    const empty = createEmptyGraphV2({name: 'draft_graph', project: 'examples'});
    expect(store.load(empty).status).toBe('ok');
    let firstId = '';
    let portId = '';

    const result = store.transaction('create task and port', () => {
      const task = store.createTaskNode({
        label: 'Task',
        base_task: {kind: 'task-id', task_id: 'base-task'},
        ports: [],
        configuration: {clone_base_task: true},
        visual: {position: {x: 0, y: 0}},
      });
      firstId = task.id ?? '';
      const port = store.createPort(firstId, {
        kind: 'port',
        name: 'General/input',
        direction: 'input',
        role: 'parameter',
        required: false,
        multiplicity: 'single',
        accepted_binding_kinds: ['parameter'],
        order: 0,
      });
      portId = port.id ?? '';
    });

    expect(result).toEqual(jasmine.objectContaining({ok: true, changed: true}));
    expect(firstId).toMatch(/^node_[1-9]\d*$/);
    expect(portId).toMatch(/^port_[1-9]\d*$/);
    expect(store.nodes()[0].name).toBe('task');
    expect(store.lastCommand()).toEqual({label: 'create task and port', transaction: true});
    expect(store.dirty()).toBeTrue();
  });

  it('uses the codec migration boundary and preserves unsupported documents read-only', () => {
    const legacy = {schema_version: 1, nodes: [{id: 'legacy'}], edges: []};
    const loaded = store.load(legacy);

    expect(loaded.status).toBe('unsupported');
    expect(store.unsupported()).toEqual(jasmine.objectContaining({
      reason: 'legacy_v1_not_losslessly_representable',
      raw: legacy,
      read_only: true,
    }));
    expect(store.graph()).toBeNull();
    expect(store.readOnly()).toBeTrue();
    expect(store.removeNode('legacy')).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'unsupported_graph_read_only'})],
    }));
  });

  it('reports malformed v2 graphs without treating them as editable documents', () => {
    const invalid = structuredClone(graphStoreFixture);
    invalid.bindings[0].target.port_id = 'missing-port';
    const result = store.load(invalid);

    expect(result.status).toBe('invalid');
    expect(store.graph()).toBeNull();
    expect(store.loadErrors()[0]).toEqual(jasmine.objectContaining({code: 'unknown_port'}));
    expect(store.dirty()).toBeFalse();
  });

  it('keeps local edits dirty when a malformed save response is rejected', () => {
    expect(store.setNodePosition('normalize', {x: 7, y: 9}).ok).toBeTrue();
    const malformed = structuredClone(graphStoreFixture);
    malformed.bindings[0].target.port_id = 'missing-port';

    expect(store.markSaved(malformed)).toEqual(jasmine.objectContaining({status: 'invalid'}));
    expect(store.node('normalize')?.visual.position).toEqual({x: 7, y: 9});
    expect(store.dirty()).toBeTrue();
  });
});
