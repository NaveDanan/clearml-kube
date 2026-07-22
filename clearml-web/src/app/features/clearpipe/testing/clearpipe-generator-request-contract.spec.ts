import {TestBed} from '@angular/core/testing';
import {Router} from '@angular/router';
import {Store} from '@ngrx/store';
import {Observable, of} from 'rxjs';
import {HTTP} from '~/app.constants';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {ConfigurationService} from '@common/shared/services/configuration.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {GraphV2} from '../domain/graph-v2.types';
import {FunctionAuthoringDefinition} from '../editor/function-authoring/function-authoring.models';
import {ClearpipeFunctionAuthoringService} from '../editor/function-authoring/function-authoring.service';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {graphFixture, port, taskNode} from './clearpipe-fixtures';

interface CompilerCall {
  url: string;
  body: unknown;
}

class CompilerRequestTransport {
  readonly calls: CompilerCall[] = [];

  post<T>(url: string, body: unknown): Observable<T> {
    this.calls.push({url, body: structuredClone(body)});
    const graph = (body as {graph?: GraphV2}).graph;
    if (!graph) throw new Error('ClearPipe validation requires a canonical graph.');

    return of({
      valid: true,
      issues: [],
      pipeline: {
        source: 'server compiler source is covered by apiserver generator goldens',
        manifest: {
          graph_digest: `sha256:request-${graph.document.name}`,
          runtime_steps: graph.nodes.map(node => ({
            graph_node_id: node.id,
            pipeline_step_name: node.name,
          })),
        },
      },
    } as T);
  }
}

describe('ClearPipe compiler request contracts', () => {
  let adapter: ClearpipeAdapterService;
  let transport: CompilerRequestTransport;
  let store: GraphStoreService;
  let functionAuthoring: ClearpipeFunctionAuthoringService;

  beforeEach(() => {
    transport = new CompilerRequestTransport();
    TestBed.configureTestingModule({
      providers: [
        ClearpipeApiService,
        ClearpipeAdapterService,
        GraphStoreService,
        ClearpipeFunctionAuthoringService,
        {provide: SmApiRequestsService, useValue: {post: transport.post.bind(transport)}},
        {provide: Router, useValue: jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl'])},
        {provide: Store, useValue: {select: () => of({id: 'request-contract-user'})}},
        {provide: ConfigurationService, useValue: {configuration: () => ({clearpipeEnabled: true})}},
      ],
    });
    adapter = TestBed.inject(ClearpipeAdapterService);
    store = TestBed.inject(GraphStoreService);
    functionAuthoring = TestBed.inject(ClearpipeFunctionAuthoringService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('sends task parameters, artifacts, queues, cache settings, and escaped identifiers to the compiler boundary', () => {
    const graph = taskGeneratorGraph();

    validate(graph);

    const requested = requestedGraph();
    expect(requested.document.name).toBe('task_request_contract');
    expect(requested.parameters).toEqual([jasmine.objectContaining({name: 'threshold', default: 0.75})]);
    expect(requested.resources).toEqual([jasmine.objectContaining({kind: 'queue', resource_id: 'gpu-a'})]);
    expect(requested.bindings.map(binding => binding.kind).sort()).toEqual(['artifact', 'parameter']);
    expect(requested.nodes).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        base_task: {kind: 'task-id', task_id: 'base-task-"extract"'},
        configuration: jasmine.objectContaining({
          cache: true,
          queue_resource_id: 'queue-gpu',
          retry_on_failure: 2,
        }),
      }),
    ]));
  });

  it('sends function multiple outputs, packages, queue, cache, and escaped defaults to the compiler boundary', () => {
    expect(store.load(createEmptyGraphV2({name: 'function_request_contract', project: 'contracts'})).status).toBe('ok');
    expect(store.addResource({id: 'queue-cpu', kind: 'queue', resource_id: 'cpu-a', label: 'CPU'}).ok).toBeTrue();
    expect(store.addParameter({
      id: 'prefix',
      name: 'prefix',
      required: false,
      order: 0,
      default: 'a\\b"c',
    }).ok).toBeTrue();
    const created = functionAuthoring.create(functionDefinition());
    expect(created.ok).toBeTrue();
    expect(created.id).toBeDefined();
    expect(store.addBinding({
      id: 'prefix-binding',
      kind: 'parameter',
      source: {kind: 'parameter', parameter_id: 'prefix'},
      target: {kind: 'port', node_id: created.id!, port_id: 'prefix'},
    }).ok).toBeTrue();
    expect(store.addOutput({
      id: 'left-result',
      name: 'left_result',
      source: {kind: 'port', node_id: created.id!, port_id: 'left'},
    }).ok).toBeTrue();

    validate(store.graph()!);

    const requested = requestedGraph();
    const node = requested.nodes[0];
    expect(node).toEqual(jasmine.objectContaining({
      kind: 'function',
      source: 'def split_data(value, prefix=""):\n    return value, value\n',
      configuration: jasmine.objectContaining({
        cache: true,
        queue_resource_id: 'queue-cpu',
        packages: ['pandas==2.2.3'],
        retry_on_failure: 3,
      }),
    }));
    expect(node.ports.filter(port => port.direction === 'output').map(port => port.name)).toEqual(['left', 'right']);
    expect(requested.parameters).toEqual([jasmine.objectContaining({name: 'prefix', default: 'a\\b"c'})]);
    expect(requested.outputs).toEqual([jasmine.objectContaining({name: 'left_result'})]);
  });

  function validate(graph: GraphV2): void {
    const outcomes: string[] = [];
    adapter.validate({graph}).subscribe(outcome => outcomes.push(outcome.status));
    expect(outcomes).toEqual(['loading', 'ready']);
  }

  function requestedGraph(): GraphV2 {
    expect(transport.calls.length).toBe(1);
    expect(transport.calls[0].url).toBe(`${HTTP.API_BASE_URL_NO_VERSION}/v2.35/clearpipe.validate`);
    return (transport.calls[0].body as {graph: GraphV2}).graph;
  }
});

const taskGeneratorGraph = (): GraphV2 => {
  const extract = taskNode('extract', {
    name: 'extract_data',
    label: 'Extract data',
    base_task: {kind: 'task-id', task_id: 'base-task-"extract"'},
    ports: [
      {...port('artifact-model', 'model', 'output', 'artifact', ['artifact'], false, 'many'), order: 0},
    ],
    configuration: {
      clone_base_task: false,
      cache: true,
      queue_resource_id: 'queue-gpu',
      retry_on_failure: 2,
    },
  });
  const publish = taskNode('publish', {
    name: 'publish_model',
    label: 'Publish model',
    base_task: {kind: 'task-id', task_id: 'base-task-publish'},
    ports: [
      {...port('parameter-model_uri', 'model_uri', 'input', 'artifact', ['artifact'], true), order: 0},
      {...port('parameter-threshold', 'threshold', 'input', 'parameter', ['parameter'], false), order: 1, default: 0.75},
    ],
    configuration: {
      clone_base_task: false,
      cache: false,
      queue_resource_id: 'queue-gpu',
      retry_on_failure: 1,
    },
  });

  return graphFixture({
    document: {name: 'task_request_contract', project: 'contracts', tags: ['clearpipe']},
    settings: {default_execution_queue_id: 'queue-gpu'},
    parameters: [{id: 'threshold', name: 'threshold', required: false, order: 0, default: 0.75}],
    resources: [{id: 'queue-gpu', kind: 'queue', resource_id: 'gpu-a', label: 'GPU A'}],
    nodes: [extract, publish],
    bindings: [
      {
        id: 'artifact-model',
        kind: 'artifact',
        source: {kind: 'port', node_id: extract.id, port_id: 'artifact-model'},
        target: {kind: 'port', node_id: publish.id, port_id: 'parameter-model_uri'},
      },
      {
        id: 'pipeline-threshold',
        kind: 'parameter',
        source: {kind: 'parameter', parameter_id: 'threshold'},
        target: {kind: 'port', node_id: publish.id, port_id: 'parameter-threshold'},
      },
    ],
    outputs: [{
      id: 'trained-model',
      name: 'trained_model',
      source: {kind: 'port', node_id: extract.id, port_id: 'artifact-model'},
    }],
  });
};

const functionDefinition = (): FunctionAuthoringDefinition => ({
  name: 'split_data',
  label: 'Split data',
  signature: 'def split_data(value, prefix="") -> tuple[int, int]',
  source: 'def split_data(value, prefix=""):\n    return value, value\n',
  taskType: 'data_processing',
  queueResourceId: 'queue-cpu',
  cache: true,
  packages: ['pandas==2.2.3'],
  retryOnFailure: 3,
  inputs: [
    {id: 'value', name: 'value', type: 'data', required: true},
    {id: 'prefix', name: 'prefix', type: 'parameter', required: false, default: 'a\\b"c'},
  ],
  outputs: [
    {id: 'left', name: 'left', type: 'data'},
    {id: 'right', name: 'right', type: 'artifact'},
  ],
});
