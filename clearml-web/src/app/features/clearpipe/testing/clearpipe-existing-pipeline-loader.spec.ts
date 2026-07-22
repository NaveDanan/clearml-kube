import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {
  ClearpipeAdapterService,
  ClearpipeDefinitionState,
} from '../platform/clearpipe-adapter.service';
import {ClearpipeResourceOption} from '../clearpipe.models';
import {functionNode, graphFixture, taskGraph} from './clearpipe-fixtures';
import {ClearpipeExistingPipelineLoaderService} from '../existing-pipeline/clearpipe-existing-pipeline-loader.service';
import {ClearpipeExistingPipelineRepresentabilityService} from '../existing-pipeline/clearpipe-existing-pipeline-representability.service';
import {ExistingPipelineLoadResult} from '../existing-pipeline/clearpipe-existing-pipeline.models';

const capabilities = {
  view: true,
  edit: true,
  save_as: true,
  version: false,
  run: true,
  compilation: true,
  execution: true,
  import: true,
  export: true,
  source: false,
  archive: true,
  delete: true,
};

const definition = (graph = taskGraph()): ClearpipeDefinitionState => ({
  definition: {
    id: 'pipeline-1',
    task_id: 'pipeline-1',
    name: 'Pipeline one',
    revision: 3,
    schema_version: 2,
    nodes: [],
    edges: [],
    viewport: {x: 0, y: 0, zoom: 1},
  },
  graph,
  representation: 'clearpipe_graph_v2',
  capabilities,
});

describe('ClearpipeExistingPipelineLoaderService', () => {
  let adapter: jasmine.SpyObj<ClearpipeAdapterService>;
  let loader: ClearpipeExistingPipelineLoaderService;

  beforeEach(() => {
    adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', ['load', 'taskDescriptor', 'resources']);
    TestBed.configureTestingModule({
      providers: [
        ClearpipeExistingPipelineLoaderService,
        ClearpipeExistingPipelineRepresentabilityService,
        {provide: ClearpipeAdapterService, useValue: adapter},
      ],
    });
    loader = TestBed.inject(ClearpipeExistingPipelineLoaderService);
  });

  it('loads through the authorized adapter, checks immutable task references, and exposes an editable graph', () => {
    adapter.load.and.returnValue(of(
      {status: 'loading'} as const,
      {status: 'ready', data: definition()} as const,
    ));
    adapter.taskDescriptor.and.returnValue(of(
      {status: 'loading'} as const,
      {status: 'ready', data: {status: 'available' as const}} as const,
    ));
    const queues: ClearpipeResourceOption[] = [{id: 'default', name: 'default', type: 'queue'}];
    adapter.resources.and.returnValue(of(
      {status: 'loading'} as const,
      {status: 'ready', data: queues} as const,
    ));

    const results = collect(loader.load('pipeline-1'));

    expect(adapter.load).toHaveBeenCalledWith('pipeline-1');
    expect(adapter.taskDescriptor).toHaveBeenCalledWith('base-task-0001');
    expect(adapter.resources).toHaveBeenCalledWith('queue');
    expect(results.map(result => result.status)).toEqual(['loading', 'editable']);
    expect((results[1] as Extract<ExistingPipelineLoadResult, {status: 'editable'}>).state.definition.revision).toBe(3);
  });

  it('blocks stale and inaccessible references without fabricating a replacement', () => {
    const graph = graphFixture({
      resources: [{id: 'dataset-reference', kind: 'dataset', resource_id: 'missing-dataset', label: 'Old dataset'}],
    });
    adapter.load.and.returnValue(of({status: 'ready', data: definition(graph)} as const));
    adapter.resources.and.returnValue(of({status: 'ready', data: []} as const));

    const results = collect(loader.load('pipeline-1'));
    const unsupported = results[0] as Extract<ExistingPipelineLoadResult, {status: 'unsupported'}>;

    expect(unsupported.status).toBe('unsupported');
    expect(unsupported.blockers).toEqual([jasmine.objectContaining({
      code: 'resource_unavailable',
      resource: {kind: 'dataset', id: 'missing-dataset'},
    })]);
    expect(adapter.taskDescriptor).not.toHaveBeenCalled();
  });

  it('keeps denied resources non-enumerating and does not attempt a graph conversion', () => {
    adapter.load.and.returnValue(of({
      status: 'denied_or_missing',
      problem: {code: 'denied_or_missing', message: 'unavailable', retryable: false},
    } as const));

    const results = collect(loader.load('private-pipeline'));

    expect(results).toEqual([{
      status: 'denied',
      problem: {code: 'denied_or_missing', message: 'unavailable', retryable: false},
    }]);
    expect(adapter.taskDescriptor).not.toHaveBeenCalled();
    expect(adapter.resources).not.toHaveBeenCalled();
  });

  it('reports every static representation blocker before querying references', () => {
    const graph = taskGraph();
    graph.nodes.push(functionGraphNode());
    adapter.load.and.returnValue(of({status: 'ready', data: definition(graph)} as const));

    const results = collect(loader.load('pipeline-1'));
    const unsupported = results[0] as Extract<ExistingPipelineLoadResult, {status: 'unsupported'}>;

    expect(unsupported.blockers.map(blocker => blocker.code)).toEqual(['mixed_node_styles']);
    expect(adapter.taskDescriptor).not.toHaveBeenCalled();
    expect(adapter.resources).not.toHaveBeenCalled();
  });

  function functionGraphNode() {
    return functionNode('function-stage', {
      ports: [],
      visual: {position: {x: 640, y: 0}},
    });
  }
});

function collect(source: import('rxjs').Observable<ExistingPipelineLoadResult>): ExistingPipelineLoadResult[] {
  const results: ExistingPipelineLoadResult[] = [];
  source.subscribe(result => results.push(result));
  return results;
}
