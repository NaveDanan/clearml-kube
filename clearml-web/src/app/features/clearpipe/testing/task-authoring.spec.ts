import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {ClearpipeTaskDescriptor, ClearpipeTaskDescriptorResponse} from '../clearpipe-api.service';
import {clearpipeRoutes} from '../clearpipe.routes';
import {decodeGraphV2} from '../domain/graph-v2-codec';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {TaskNode} from '../domain/graph-v2.types';
import {ClearpipeSemanticEdgeController} from '../editor/edges/clearpipe-semantic-edge.controller';
import {
  clearpipeTaskAuthoringCatalogAction,
  clearpipeTaskAuthoringExtension,
} from '../editor/task-authoring/task-authoring.extension';
import {TaskAuthoringDefinition, taskArtifactPortId, taskParameterPortId, taskQueueResourceId} from '../editor/task-authoring/task-authoring.models';
import {ClearpipeTaskAuthoringService} from '../editor/task-authoring/task-authoring.service';
import {ClearpipeExtensionRegistry} from '../editor/framework/clearpipe-extension-registry';
import {ClearpipeAdapterOutcome, ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeResourceSummary} from '../resources/clearpipe-resource.models';

const resource = (id: string, name = 'Train model'): ClearpipeResourceSummary => ({
  id,
  kind: 'task',
  name,
  project: 'Research',
  type: 'training',
  status: 'completed',
  tags: ['approved'],
  updatedAt: '2026-07-22T12:00:00Z',
});

const descriptor = (id: string, overrides: Partial<ClearpipeTaskDescriptor> = {}): ClearpipeTaskDescriptor => ({
  identity: {task_id: id},
  context: {
    name: `Task ${id}`,
    type: 'training',
    status: 'completed',
    project_name: 'Research',
    updated_at: '2026-07-22T12:01:00Z',
  },
  parameters: [
    {section: 'General', name: 'model_url', type: 'string'},
    {section: 'General', name: 'threshold', type: 'number'},
  ],
  artifacts: [
    {id: 'model', name: 'model', type: 'model', direction: 'output'},
    {id: 'source_dataset', name: 'source dataset', type: 'dataset', direction: 'input'},
  ],
  ...overrides,
});

const definition = (
  id = 'base-task-a',
  overrides: Partial<TaskAuthoringDefinition> = {},
): TaskAuthoringDefinition => ({
  selectedTaskId: id,
  descriptor: descriptor(id),
  name: `task_${id.replaceAll('-', '_')}`,
  label: `Task ${id}`,
  cloneBaseTask: false,
  cache: true,
  retryOnFailure: 2,
  parameterDefaults: {[taskParameterPortId('General', 'threshold')]: 0.8},
  ...overrides,
});

describe('CP-24 task-backed authoring', () => {
  let store: GraphStoreService;
  let authoring: ClearpipeTaskAuthoringService;
  let adapter: jasmine.SpyObj<Pick<ClearpipeAdapterService, 'taskDescriptor'>>;

  beforeEach(() => {
    adapter = jasmine.createSpyObj<Pick<ClearpipeAdapterService, 'taskDescriptor'>>('ClearpipeAdapterService', ['taskDescriptor']);
    TestBed.configureTestingModule({
      providers: [
        GraphStoreService,
        ClearpipeSemanticEdgeController,
        ClearpipeTaskAuthoringService,
        {provide: ClearpipeAdapterService, useValue: adapter},
      ],
    });
    store = TestBed.inject(GraphStoreService);
    authoring = TestBed.inject(ClearpipeTaskAuthoringService);
    expect(store.load(createEmptyGraphV2({name: 'task-authoring', project: 'cp24'})).status).toBe('ok');
  });

  it('registers task card, inspector, and typed generic catalog actions for click, keyboard, and drop handoff', async () => {
    const registry = new ClearpipeExtensionRegistry();
    const received: string[] = [];
    registry.register(clearpipeTaskAuthoringExtension);
    registry.registerCatalogAction(clearpipeTaskAuthoringExtension,
      clearpipeTaskAuthoringCatalogAction(request => {
        received.push(request.method);
      }));
    const entry = registry.catalogEntry('approved-task')!;

    await registry.dispatchCatalogAction({entry, method: 'click'}, {readOnly: false});
    await registry.dispatchCatalogAction({entry, method: 'keyboard'}, {readOnly: false});
    await registry.dispatchCatalogAction({entry, method: 'drop', placement: {x: 240, y: 80}}, {readOnly: false});

    expect(received).toEqual(['click', 'keyboard', 'drop']);
    expect(registry.get('task')?.form?.id).toBe('task-authoring');
    expect(registry.get('task')?.summarize?.({
      id: 'node-a',
      name: 'task_a',
      label: 'Task A',
      kind: 'task',
      base_task: {kind: 'task-id', task_id: 'base-task-a'},
      ports: [],
      configuration: {},
      visual: {position: {x: 0, y: 0}},
    }).text).toContain('base-task-a');
  });

  it('composes the task provider at every ClearPipe editor route', () => {
    const editorRoutes = clearpipeRoutes.filter(route => ['new', ':taskId/edit', ':taskId'].includes(route.path ?? ''));
    expect(editorRoutes.every(route => route.providers?.length === 2)).toBeTrue();
  });

  it('uses the authorized descriptor identity and safely distinguishes available, stale, and unavailable outcomes', () => {
    const available: ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse> = {
      status: 'ready',
      data: {status: 'available', descriptor: descriptor('base-task-a')},
    };
    const stale: ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse> = {
      status: 'ready',
      data: {status: 'stale', descriptor: descriptor('base-task-a')},
    };
    const unavailable: ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse> = {
      status: 'ready',
      data: {status: 'unavailable'},
    };
    const loading: ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse> = {status: 'loading'};
    const mismatched: ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse> = {
      status: 'ready',
      data: {status: 'available', descriptor: descriptor('different-task')},
    };
    adapter.taskDescriptor.and.returnValues(
      of(loading, available),
      of(loading, stale),
      of(loading, unavailable),
      of(loading, mismatched),
    );
    const states: string[][] = [];

    [available, stale, unavailable, mismatched].forEach(() => {
      const values: string[] = [];
      authoring.describeTask('base-task-a', resource('base-task-a').updatedAt).subscribe(state => values.push(state.status));
      states.push(values);
    });

    expect(states).toEqual([
      ['loading', 'available'],
      ['loading', 'stale'],
      ['loading', 'unavailable'],
      ['loading', 'unavailable'],
    ]);
    expect(adapter.taskDescriptor.calls.allArgs()).toEqual([
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
    ]);
  });

  it('creates two canonical task nodes with descriptor-derived ports and connects parameter, artifact, and execution semantics', () => {
    const source = authoring.create(definition('base-task-a'));
    const target = authoring.create(definition('base-task-b', {
      name: 'task_base_task_b',
      label: 'Task base-task-b',
      descriptor: descriptor('base-task-b'),
    }));
    const sourceArtifact = taskArtifactPortId('model');
    const targetArtifactInput = taskParameterPortId('General', 'model_url');
    const targetPipelineInput = taskParameterPortId('General', 'threshold');
    expect(store.addParameter({id: 'threshold', name: 'threshold', required: false, order: 0, default: 0.5}).ok).toBeTrue();

    expect(source.ok).withContext(JSON.stringify(source.errors)).toBeTrue();
    expect(target.ok).withContext(JSON.stringify(target.errors)).toBeTrue();
    expect((store.node(source.id!) as TaskNode).base_task).toEqual({kind: 'task-id', task_id: 'base-task-a'});
    expect(store.node(source.id!)?.ports).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({id: targetArtifactInput, name: 'General/model_url', accepted_binding_kinds: ['artifact', 'parameter']}),
      jasmine.objectContaining({id: sourceArtifact, name: 'artifacts.model.url', direction: 'output', role: 'artifact'}),
    ]));
    expect(store.node(source.id!)?.ports.some(port => port.name === 'artifacts.source_dataset.url')).toBeFalse();
    expect(authoring.artifactSuggestions(target.id!, targetArtifactInput))
      .toContain(jasmine.objectContaining({nodeId: source.id, portId: sourceArtifact}));
    expect(authoring.connectArtifact(source.id!, sourceArtifact, target.id!, targetArtifactInput).eligible).toBeTrue();
    expect(authoring.connectPipelineParameter(target.id!, targetPipelineInput, 'threshold').eligible).toBeTrue();
    expect(authoring.connectExecutionParent(source.id!, target.id!).eligible).toBeTrue();
    expect(store.bindings().map(binding => binding.kind).sort()).toEqual(['artifact', 'execution-only', 'parameter']);
  });

  it('persists generator-compatible configuration without treating a runtime child ID as the base reference', () => {
    const queue = {...resource('queue-remote', 'GPU Queue'), kind: 'queue' as const};
    const runtimeChildId = 'runtime-child-should-never-persist';
    const result = authoring.create(definition('base-task-a', {queue, placement: {x: 96, y: 48}}));
    const node = store.node(result.id!) as TaskNode;

    expect(result.ok).toBeTrue();
    expect(node).toEqual(jasmine.objectContaining({
      name: 'task_base_task_a',
      base_task: {kind: 'task-id', task_id: 'base-task-a'},
      configuration: jasmine.objectContaining({
        clone_base_task: false,
        cache: true,
        retry_on_failure: 2,
        queue_resource_id: taskQueueResourceId('queue-remote'),
      }),
      visual: {position: {x: 96, y: 48}},
    }));
    expect(store.graph()?.resources).toContain(jasmine.objectContaining({
      id: taskQueueResourceId('queue-remote'),
      kind: 'queue',
      resource_id: 'queue-remote',
    }));
    expect(store.serialize()).not.toContain(runtimeChildId);
    expect(decodeGraphV2(store.graph()!).status).toBe('ok');
    expect(authoring.create(definition('runtime-child-should-never-persist', {
      descriptor: descriptor('base-task-a'),
    }))).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'CP24IDENTITY001'})],
    }));
  });

  it('blocks invalid semantic edges and descriptor port removals until explicit CP-20 disconnection', () => {
    const source = authoring.create(definition('base-task-a'));
    const target = authoring.create(definition('base-task-b', {descriptor: descriptor('base-task-b')}));
    const output = taskArtifactPortId('model');
    const input = taskParameterPortId('General', 'model_url');
    expect(authoring.connectArtifact(source.id!, output, target.id!, input).eligible).toBeTrue();

    const invalid = authoring.connectArtifact(source.id!, taskParameterPortId('General', 'model_url'), target.id!, input);
    expect(invalid.eligible).toBeFalse();
    expect(invalid.reason).toBe('invalid_port_direction');
    const update = authoring.update(store.node(target.id!) as TaskNode, definition('base-task-b', {
      descriptor: descriptor('base-task-b', {parameters: [{section: 'General', name: 'replacement'}]}),
      parameterDefaults: {},
    }));

    expect(update).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'CP24BOUND001', message: jasmine.stringMatching(/Disconnect or remap/)})],
    }));
    expect(store.bindingsForPort(target.id!, input)).toHaveSize(1);
    const bindingId = store.bindingsForPort(target.id!, input)[0].id;
    expect(authoring.disconnect(bindingId).eligible).toBeTrue();
    const updated = authoring.update(store.node(target.id!) as TaskNode, definition('base-task-b', {
      descriptor: descriptor('base-task-b', {parameters: [{section: 'General', name: 'replacement'}]}),
      parameterDefaults: {},
    }));
    expect(updated.ok).withContext(JSON.stringify(updated.errors)).toBeTrue();
  });
});
