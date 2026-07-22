import {ClearpipeExtensionRegistry} from '../editor/framework/clearpipe-extension-registry';
import {TestBed} from '@angular/core/testing';
import {clearpipeFunctionAuthoringExtension} from '../editor/function-authoring/function-authoring.extension';
import {FunctionAuthoringDefinition} from '../editor/function-authoring/function-authoring.models';
import {ClearpipeFunctionAuthoringService} from '../editor/function-authoring/function-authoring.service';
import {validateFunctionAuthoringDefinition} from '../editor/function-authoring/function-authoring.validation';
import {decodeGraphV2} from '../domain/graph-v2-codec';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {FunctionNode} from '../domain/graph-v2.types';

const definition = (overrides: Partial<FunctionAuthoringDefinition> = {}): FunctionAuthoringDefinition => ({
  name: 'transform_data',
  label: 'Transform data',
  signature: 'def transform_data(value, prefix="")',
  source: 'def transform_data(value, prefix=""):\n    return value\n',
  taskType: 'data_processing',
  queueResourceId: 'queue-default',
  cache: true,
  inputs: [
    {id: 'input-value', name: 'value', type: 'data', required: true},
    {id: 'input-prefix', name: 'prefix', type: 'parameter', required: false, default: ''},
  ],
  outputs: [{id: 'output-result', name: 'result', type: 'data'}],
  ...overrides,
});

describe('CP-25 function authoring', () => {
  let store: GraphStoreService;
  let authoring: ClearpipeFunctionAuthoringService;

  beforeEach(() => {
    TestBed.configureTestingModule({providers: [GraphStoreService, ClearpipeFunctionAuthoringService]});
    store = TestBed.inject(GraphStoreService);
    expect(store.load(createEmptyGraphV2({name: 'authoring', project: 'cp25'})).status).toBe('ok');
    expect(store.addResource({id: 'queue-default', kind: 'queue', resource_id: 'default', label: 'Default'}).ok).toBeTrue();
    authoring = TestBed.inject(ClearpipeFunctionAuthoringService);
  });

  it('registers only through the CP-17 extension provider contract', () => {
    const registry = new ClearpipeExtensionRegistry();
    registry.register(clearpipeFunctionAuthoringExtension);

    expect(registry.catalogEntries()).toEqual([jasmine.objectContaining({
      id: 'explicit-function',
      nodeKind: 'function',
    })]);
    expect(registry.get('function')?.form?.id).toBe('function-authoring');
  });

  it('creates single and multiple output components with stable typed port identities', () => {
    const first = authoring.create(definition());
    const second = authoring.create(definition({
      name: 'split_data',
      label: 'Split data',
      signature: 'def split_data(value)',
      source: 'def split_data(value):\n    return (value, value)\n',
      outputs: [
        {id: 'output-left', name: 'left', type: 'data'},
        {id: 'output-right', name: 'right', type: 'artifact'},
      ],
    }));

    expect(first.ok).withContext(JSON.stringify(first.errors)).toBeTrue();
    expect(second.ok).withContext(JSON.stringify(second.errors)).toBeTrue();
    expect(store.node(first.id!)?.ports.map(port => port.id)).toEqual(['input-value', 'input-prefix', 'output-result']);
    expect(store.node(second.id!)?.ports.filter(port => port.direction === 'output')).toEqual([
      jasmine.objectContaining({id: 'output-left', name: 'left', role: 'data'}),
      jasmine.objectContaining({id: 'output-right', name: 'right', role: 'artifact'}),
    ]);
  });

  it('persists parameter defaults and configuration through canonical graph commands', () => {
    const result = authoring.create(definition());
    const node = store.node(result.id!);

    expect(node).toEqual(jasmine.objectContaining({
      configuration: {task_type: 'data_processing', cache: true, queue_resource_id: 'queue-default'},
    }));
    expect(node?.ports.find(port => port.id === 'input-prefix')).toEqual(jasmine.objectContaining({
      accepted_binding_kinds: ['parameter'],
      default: '',
    }));
    expect(decodeGraphV2(store.graph()!).status).toBe('ok');
  });

  it('keeps parameter and upstream bindings canonical and independently addressable', () => {
    const producer = authoring.create(definition({
      name: 'source_data',
      label: 'Source data',
      signature: 'def source_data()',
      source: 'def source_data():\n    return 1\n',
      inputs: [],
    }));
    const consumer = authoring.create(definition());
    expect(store.addParameter({id: 'prefix', name: 'prefix', required: false, order: 0, default: ''}).ok).toBeTrue();
    expect(store.addBinding({
      id: 'bind-upstream',
      kind: 'data',
      source: {kind: 'port', node_id: producer.id!, port_id: 'output-result'},
      target: {kind: 'port', node_id: consumer.id!, port_id: 'input-value'},
    }).ok).toBeTrue();
    expect(store.addBinding({
      id: 'bind-parameter',
      kind: 'parameter',
      source: {kind: 'parameter', parameter_id: 'prefix'},
      target: {kind: 'port', node_id: consumer.id!, port_id: 'input-prefix'},
    }).ok).toBeTrue();

    expect(store.generatedInputsForNode(consumer.id!)).toEqual([
      {node_id: consumer.id!, port_id: 'input-prefix', binding_ids: ['bind-parameter']},
      {node_id: consumer.id!, port_id: 'input-value', binding_ids: ['bind-upstream']},
    ]);
  });

  it('round-trips a two-component graph without authoring a second graph or generator', () => {
    authoring.create(definition());
    authoring.create(definition({
      name: 'format_result',
      label: 'Format result',
      signature: 'def format_result(value)',
      source: 'def format_result(value):\n    return value\n',
      inputs: [{id: 'format-input', name: 'value', type: 'data', required: true}],
      outputs: [{id: 'format-output', name: 'formatted', type: 'data'}],
    }));

    const serialized = store.serialize()!;
    const restored = new GraphStoreService();
    expect(restored.load(serialized).status).toBe('ok');
    expect(restored.serialize()).toBe(serialized);
    expect(serialized).not.toContain('generated_source');
  });

  it('rejects malformed forms, unsupported imports, and secrets without evaluating or leaking source', () => {
    const marker = '__CP25_NO_EVALUATION__';
    const unsafe = definition({
      source: `import os\n${marker} = True\ndef transform_data(value, prefix=""):\n    return value\n`,
      packages: ['https://user:password@example.test/private'],
    });
    const validation = validateFunctionAuthoringDefinition(unsafe);

    expect(validation.valid).toBeFalse();
    expect(validation.diagnostics.map(issue => issue.code)).toEqual(jasmine.arrayContaining(['CPSEM003', 'CP25CONTRACT001']));
    expect(JSON.stringify(validation.diagnostics)).not.toContain(marker);
    expect(JSON.stringify(validation.diagnostics)).not.toContain('password');
    expect(authoring.create(unsafe)).toEqual(jasmine.objectContaining({ok: false}));
    expect(store.nodes()).toEqual([]);
  });

  it('reports unavailable packages, retry, and reference metadata rather than writing unsupported CP-06 fields', () => {
    const validation = validateFunctionAuthoringDefinition(definition({
      packages: ['numpy'],
      retryOnFailure: 2,
      reference: 'components/normalize-v1',
    }));

    expect(validation.diagnostics).toContain(jasmine.objectContaining({code: 'CP25CONTRACT001'}));
    expect(authoring.create(definition({packages: ['numpy']})).ok).toBeFalse();
  });

  it('updates typed ports and configuration through CP-10 commands while retaining output IDs', () => {
    const created = authoring.create(definition());
    const node = store.node(created.id!) as FunctionNode;
    const updated = authoring.update(node, definition({
      label: 'Transform data v2',
      taskType: 'testing',
      cache: false,
      queueResourceId: undefined,
      outputs: [{id: 'output-result', name: 'normalized', type: 'data'}],
    }));

    expect(updated.ok).toBeTrue();
    expect(store.node(created.id!)).toEqual(jasmine.objectContaining({
      label: 'Transform data v2',
      configuration: {task_type: 'testing', cache: false},
      ports: jasmine.arrayContaining([jasmine.objectContaining({id: 'output-result', name: 'normalized'})]),
    }));
  });
});
