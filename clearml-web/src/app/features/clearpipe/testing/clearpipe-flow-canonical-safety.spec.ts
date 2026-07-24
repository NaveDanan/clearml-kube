import {TestBed} from '@angular/core/testing';
import {ActivatedRoute, Router} from '@angular/router';
import {Store} from '@ngrx/store';
import {of, throwError} from 'rxjs';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {decodeGraphV2} from '../domain/graph-v2-codec';
import {GraphV2, TaskNode} from '../domain/graph-v2.types';
import {
  applyFlowCanonicalPatch,
  graphV2ToFlow,
  reviewFlowGraphV2,
} from '../editor/flow/clearpipe-flow-codec';
import {ClearpipeFlowEditorComponent} from '../editor/flow/clearpipe-flow-editor.component';
import {ClearpipeAdapterService, ClearpipeDefinitionState} from '../platform/clearpipe-adapter.service';

const canonicalTaskGraph = (): GraphV2 => ({
  schema_version: 2,
  document: {
    id: 'flow-doc',
    revision: 7,
    name: 'Canonical_Flow',
    project: 'ClearPipe',
    description: 'canonical task flow',
    tags: ['clearpipe'],
  },
  settings: {default_execution_queue_id: 'queue_gpu'},
  parameters: [],
  resources: [{id: 'queue_gpu', kind: 'queue', resource_id: 'queue-001', label: 'GPU'}],
  outputs: [],
  nodes: [
    {
      id: 'prepare',
      kind: 'task',
      name: 'prepare',
      label: 'Prepare',
      ports: [{
        id: 'prepared_data',
        kind: 'port',
        name: 'prepared_data',
        direction: 'output',
        role: 'data',
        required: false,
        multiplicity: 'many',
        accepted_binding_kinds: ['data'],
        order: 0,
      }],
      visual: {position: {x: 10, y: 20}, dimensions: {width: 280, height: 120}},
      base_task: {kind: 'task-id', task_id: 'base-prepare'},
      configuration: {clone_base_task: false, cache: true, queue_resource_id: 'queue_gpu', retry_on_failure: 2},
    },
    {
      id: 'train',
      kind: 'task',
      name: 'train',
      label: 'Train',
      ports: [{
        id: 'model',
        kind: 'port',
        name: 'model',
        direction: 'input',
        role: 'artifact',
        required: false,
        multiplicity: 'single',
        accepted_binding_kinds: ['artifact'],
        order: 0,
      }],
      visual: {position: {x: 360, y: 20}},
      base_task: {kind: 'task-id', task_id: 'base-train'},
      configuration: {clone_base_task: true, cache: false, queue_resource_id: 'queue_gpu'},
    },
  ],
  bindings: [{
    id: 'after_prepare',
    kind: 'execution-only',
    source: {kind: 'node', node_id: 'prepare'},
    target: {kind: 'node', node_id: 'train'},
  }],
  visual: {viewport: {x: 4, y: 8}, zoom: 1.25},
});

describe('Flow canonical task safety', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('round-trips real task cards without creating function stubs or flattening typed fields', () => {
    const graph = canonicalTaskGraph();
    const flow = graphV2ToFlow(graph);
    const saved = applyFlowCanonicalPatch(graph, flow);

    expect(saved.status).toBe('ok');
    if (saved.status !== 'ok') return;
    expect(saved.graph).toEqual(graph);
    expect(saved.graph.nodes.map(node => node.kind)).toEqual(['task', 'task']);
    expect(saved.graph.nodes.map(node => (node as TaskNode).base_task)).toEqual([
      {kind: 'task-id', task_id: 'base-prepare'},
      {kind: 'task-id', task_id: 'base-train'},
    ]);
    expect(saved.graph.nodes.map(node => node.ports)).toEqual(graph.nodes.map(node => node.ports));
    expect(saved.graph.nodes.map(node => node.configuration)).toEqual(graph.nodes.map(node => node.configuration));
    expect(saved.graph.resources).toEqual(graph.resources);
    expect(saved.graph.bindings).toEqual(graph.bindings);
    expect(JSON.stringify(saved.graph)).not.toContain('clearpipe-flow-node');
    expect(JSON.stringify(saved.graph)).not.toContain('return None');
  });

  it('only applies typed metadata and layout patches to the loaded document', () => {
    const graph = canonicalTaskGraph();
    const original = structuredClone(graph);
    const flow = graphV2ToFlow(graph);
    flow.name = 'Renamed_Flow';
    flow.viewport = {x: 30, y: 40, zoom: 1.5};
    flow.nodes[0].position = {x: 99, y: 77};

    const saved = applyFlowCanonicalPatch(graph, flow);

    expect(saved.status).toBe('ok');
    if (saved.status !== 'ok') return;
    expect(graph).toEqual(original);
    expect(saved.graph.document.revision).toBe(7);
    expect(saved.graph.document.name).toBe('Renamed_Flow');
    expect(saved.graph.nodes[0].visual.position).toEqual({x: 99, y: 77});
    expect(saved.graph.nodes[0].ports).toEqual(original.nodes[0].ports);
    expect(saved.graph.nodes[0].configuration).toEqual(original.nodes[0].configuration);
    expect(saved.graph.bindings).toEqual(original.bindings);
  });

  it('fails closed for every graph shape the Flow surface cannot represent', () => {
    const cases: Array<{name: string; graph: GraphV2}> = [
      {
        name: 'function nodes',
        graph: {...canonicalTaskGraph(), nodes: [{
          ...canonicalTaskGraph().nodes[0],
          kind: 'function',
          signature: 'def unsafe() -> object',
          source: 'def unsafe() -> object:\n    return None\n',
          configuration: {task_type: 'application'},
        }] as GraphV2['nodes']},
      },
      {
        name: 'task-name references',
        graph: {...canonicalTaskGraph(), nodes: canonicalTaskGraph().nodes.map((node, index) =>
          index ? node : {...node, base_task: {kind: 'task-name', project: 'p', name: 'mutable'}}) as GraphV2['nodes']},
      },
      {name: 'parameters', graph: {...canonicalTaskGraph(), parameters: [{id: 'p', name: 'p', required: false, order: 0}]}},
      {name: 'outputs', graph: {...canonicalTaskGraph(), outputs: [{id: 'out', name: 'out', source: {kind: 'port', node_id: 'prepare', port_id: 'prepared_data'}}]}},
      {name: 'non-queue resources', graph: {...canonicalTaskGraph(), resources: [{id: 'dataset', kind: 'dataset', resource_id: 'd'}]}},
      {
        name: 'semantic binding',
        graph: {...canonicalTaskGraph(), bindings: [{
          id: 'data',
          kind: 'data',
          source: {kind: 'port', node_id: 'prepare', port_id: 'prepared_data'},
          target: {kind: 'port', node_id: 'train', port_id: 'model'},
        }] as GraphV2['bindings']},
      },
      {
        name: 'parallel execution binding',
        graph: {...canonicalTaskGraph(), bindings: [
          ...canonicalTaskGraph().bindings,
          {id: 'also_after_prepare', kind: 'execution-only', source: {kind: 'node', node_id: 'prepare'}, target: {kind: 'node', node_id: 'train'}},
        ]},
      },
    ];

    cases.forEach(({name, graph}) => {
      const flow = graphV2ToFlow(canonicalTaskGraph());
      expect(reviewFlowGraphV2(graph).status).withContext(name).toBe('unsupported');
      expect(applyFlowCanonicalPatch(graph, flow).status).withContext(name).toBe('unsupported');
    });
    expect(decodeGraphV2({...canonicalTaskGraph(), schema_version: 3}).status).toBe('unsupported');
  });

  it('requires every task card to have an effective canonical queue resource', () => {
    const taskNodes = (queueResourceId?: string): TaskNode[] => canonicalTaskGraph().nodes.map(node => {
      const task = node as TaskNode;
      const configuration = {...task.configuration};
      if (queueResourceId === undefined) delete configuration.queue_resource_id;
      else configuration.queue_resource_id = queueResourceId;
      return {...task, configuration};
    });
    const withoutTaskQueues = (): GraphV2 => ({...canonicalTaskGraph(), nodes: taskNodes()});
    const withFirstTaskQueue = (queueResourceId: string): TaskNode[] => {
      const nodes = taskNodes('queue_gpu');
      nodes[0] = {...nodes[0], configuration: {...nodes[0].configuration, queue_resource_id: queueResourceId}};
      return nodes;
    };
    const cases: Array<{name: string; graph: GraphV2; reason: string}> = [
      {
        name: 'missing queue',
        graph: {...withoutTaskQueues(), settings: {}},
        reason: 'Task "prepare" has no effective queue. Set settings.default_execution_queue_id or configuration.queue_resource_id.',
      },
      {
        name: 'unknown default queue',
        graph: {...withoutTaskQueues(), settings: {default_execution_queue_id: 'queue-missing'}},
        reason: 'Task "prepare" references unknown queue resource "queue-missing".',
      },
      {
        name: 'non-queue default resource',
        graph: {
          ...withoutTaskQueues(),
          settings: {default_execution_queue_id: 'dataset'},
          resources: [{id: 'dataset', kind: 'dataset', resource_id: 'dataset-001'}],
        },
        reason: 'Task "prepare" references non-queue resource "dataset".',
      },
      {
        name: 'unknown task queue override',
        graph: {
          ...canonicalTaskGraph(),
          nodes: withFirstTaskQueue('queue-missing'),
        },
        reason: 'Task "prepare" references unknown queue resource "queue-missing".',
      },
      {
        name: 'non-queue task queue override',
        graph: {
          ...canonicalTaskGraph(),
          resources: [
            ...canonicalTaskGraph().resources,
            {id: 'dataset', kind: 'dataset', resource_id: 'dataset-001'},
          ],
          nodes: withFirstTaskQueue('dataset'),
        },
        reason: 'Task "prepare" references non-queue resource "dataset".',
      },
    ];

    expect(reviewFlowGraphV2(withoutTaskQueues())).toEqual({status: 'editable'});
    expect(reviewFlowGraphV2({...canonicalTaskGraph(), settings: {}})).toEqual({status: 'editable'});
    cases.forEach(({name, graph, reason}) => {
      expect(reviewFlowGraphV2(graph)).withContext(name).toEqual({status: 'unsupported', reason});
      expect(applyFlowCanonicalPatch(graph, graphV2ToFlow(canonicalTaskGraph())))
        .withContext(`${name} patch`)
        .toEqual(jasmine.objectContaining({status: 'unsupported', reason}));
    });
  });

  it('refuses legacy zero or multi-task card configurations before any graph can be updated', () => {
    const graph = canonicalTaskGraph();
    const zero = graphV2ToFlow(graph);
    zero.nodes[0].config = {taskIds: []};
    const many = graphV2ToFlow(graph);
    many.nodes[0].config = {taskIds: ['base-prepare', 'base-other']};

    expect(applyFlowCanonicalPatch(graph, zero)).toEqual(jasmine.objectContaining({status: 'unsupported'}));
    expect(applyFlowCanonicalPatch(graph, many)).toEqual(jasmine.objectContaining({status: 'unsupported'}));
  });

  it('does not issue an update when Flow has explicitly marked a graph read-only', () => {
    const updateDefinition = jasmine.createSpy('updateDefinition');
    const component = createEditor(updateDefinition);

    component['flowBlockedReason'].set('Function nodes are read-only in the Flow editor.');
    component['save']();

    expect(updateDefinition).not.toHaveBeenCalled();
  });

  it('blocks save, run, and activation mutations for graphs without an effective queue', () => {
    const updateDefinition = jasmine.createSpy('updateDefinition');
    const setActivation = jasmine.createSpy('setActivation');
    const startDefinition = jasmine.createSpy('startDefinition');
    const graph = canonicalTaskGraph();
    graph.settings = {};
    graph.nodes.forEach(node => delete node.configuration.queue_resource_id);
    const component = createEditor(updateDefinition, graph, {setActivation, startDefinition});

    component['loadExisting']('flow-doc');
    component['save']();
    component['run']();
    component['toggleActivated']();

    expect(component['flowBlockedReason']()).toContain('has no effective queue');
    expect(updateDefinition).not.toHaveBeenCalled();
    expect(startDefinition).not.toHaveBeenCalled();
    expect(setActivation).not.toHaveBeenCalled();
  });

  it('keeps the loaded revision and dirty graph after a revision conflict', () => {
    const updateDefinition = jasmine.createSpy('updateDefinition')
      .and.returnValue(throwError(() => ({status: 409})));
    const component = createEditor(updateDefinition, canonicalTaskGraph());

    component['loadExisting']('flow-doc');
    component['store'].updateMetadata({name: 'Changed_Flow'});
    component['save']();

    expect(updateDefinition).toHaveBeenCalledWith(jasmine.objectContaining({revision: 7}));
    expect(component['editingRevision']).toBe(7);
    expect(component['store'].dirty()).toBeTrue();
  });
});

function createEditor(
  updateDefinition: jasmine.Spy,
  graph?: GraphV2,
  mutations: {setActivation?: jasmine.Spy; startDefinition?: jasmine.Spy} = {},
): ClearpipeFlowEditorComponent {
  const state: ClearpipeDefinitionState = {
    definition: {
      id: 'flow-doc',
      task_id: 'flow-doc',
      name: 'Canonical_Flow',
      revision: 7,
      schema_version: 2,
      nodes: [],
      edges: [],
      viewport: {x: 0, y: 0, zoom: 1},
    },
    ...(graph ? {graph, rawGraph: graph} : {}),
    representation: 'clearpipe_graph_v2',
    capabilities: {
      view: true, edit: true, save_as: true, version: false, run: true,
      compilation: true, execution: true, import: true, export: true,
      source: false, archive: true, delete: true,
    },
  };
  TestBed.configureTestingModule({
    imports: [ClearpipeFlowEditorComponent],
    providers: [
      {
        provide: ClearpipeApiService,
        useValue: {updateDefinition, latestRun: () => of({}), ...mutations},
      },
      {provide: ClearpipeAdapterService, useValue: {load: () => of({status: 'ready', data: state})}},
      {provide: ActivatedRoute, useValue: {snapshot: {paramMap: {get: () => null}}}},
      {provide: Router, useValue: {navigate: () => Promise.resolve(true)}},
      {provide: Store, useValue: {dispatch: () => undefined}},
    ],
  });
  const component = TestBed.createComponent(ClearpipeFlowEditorComponent).componentInstance;
  return component;
}
