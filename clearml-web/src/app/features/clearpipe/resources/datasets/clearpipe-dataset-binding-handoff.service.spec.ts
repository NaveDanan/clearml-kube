import {TestBed} from '@angular/core/testing';
import {GraphStoreService, createEmptyGraphV2} from '../../domain/graph-store.service';
import {TaskNode} from '../../domain/graph-v2.types';
import {ClearpipeResourceSelection} from '../clearpipe-resource.models';
import {ClearpipeDatasetBindingHandoffService} from './clearpipe-dataset-binding-handoff.service';

describe('ClearpipeDatasetBindingHandoffService', () => {
  let graphStore: GraphStoreService;
  let handoff: ClearpipeDatasetBindingHandoffService;
  let node: TaskNode;

  const selection: ClearpipeResourceSelection = {
    resource: {id: 'dataset-id-1', kind: 'dataset', name: 'Iris'},
    reference: {kind: 'dataset', resource_id: 'dataset-id-1', label: 'Iris'},
  };

  beforeEach(() => {
    TestBed.configureTestingModule({providers: [GraphStoreService]});
    graphStore = TestBed.inject(GraphStoreService);
    handoff = TestBed.inject(ClearpipeDatasetBindingHandoffService);
    expect(graphStore.load(createEmptyGraphV2({name: 'dataset-binding'})).status).toBe('ok');
    const created = graphStore.createTaskNode({
      label: 'Consume dataset',
      base_task: {kind: 'task-id', task_id: 'base-task'},
      configuration: {},
      ports: [{
        id: 'dataset-input', kind: 'port', name: 'dataset_id', direction: 'input', role: 'artifact',
        required: true, multiplicity: 'single', accepted_binding_kinds: ['artifact'], order: 0,
      }],
      visual: {position: {x: 0, y: 0}},
    });
    node = graphStore.node(created.id!) as TaskNode;
  });

  it('uses the existing canonical resource and artifact binding representation across save and reload', () => {
    const result = handoff.bind(selection, node, 'dataset-input');

    expect(result.status).toBe('bound');
    expect(graphStore.graph()?.resources).toEqual([jasmine.objectContaining({
      kind: 'dataset', resource_id: 'dataset-id-1', label: 'Iris',
    })]);
    expect(graphStore.graph()?.bindings).toEqual([jasmine.objectContaining({
      kind: 'artifact',
      source: jasmine.objectContaining({kind: 'resource'}),
      target: {kind: 'port', node_id: node.id, port_id: 'dataset-input'},
    })]);
    const serialized = graphStore.serialize()!;
    expect(serialized).not.toContain('credential');
    expect(serialized).not.toContain('token');
    expect(graphStore.load(serialized).status).toBe('ok');
    expect(graphStore.graph()?.resources[0].resource_id).toBe('dataset-id-1');
  });

  it('fails closed for unsupported targets and does not replace an existing binding', () => {
    expect(handoff.bind(selection, node, 'missing').status).toBe('unsupported-target');
    expect(handoff.bind(selection, node, 'dataset-input').status).toBe('bound');
    expect(handoff.bind(selection, node, 'dataset-input').status).toBe('already-bound');
    expect(graphStore.graph()?.bindings).toHaveSize(1);
  });
});
