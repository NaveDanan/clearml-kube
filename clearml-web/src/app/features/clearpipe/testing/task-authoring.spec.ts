import {TestBed} from '@angular/core/testing';
import {of, Subject} from 'rxjs';
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
import {ClearpipeTaskAuthoringCreateComponent} from '../editor/task-authoring/task-authoring-create.component';
import {
  isStaleDescriptorConfirmed,
  TaskAuthoringDefinition,
  TaskAuthoringDescriptorState,
  taskArtifactPortId,
  taskDescriptorConfirmationToken,
  taskParameterPortId,
  taskQueueResourceId,
} from '../editor/task-authoring/task-authoring.models';
import {ClearpipeTaskAuthoringService} from '../editor/task-authoring/task-authoring.service';
import {ClearpipeExtensionRegistry} from '../editor/framework/clearpipe-extension-registry';
import {ClearpipeAdapterOutcome, ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeResourceSummary} from '../resources/clearpipe-resource.models';
import {ClearpipeResourceQueryService} from '../resources/clearpipe-resource-query.service';

const resource = (id: string, name = 'Train model'): ClearpipeResourceSummary => ({
  id,
  kind: 'task',
  name,
  project: 'Research',
  type: 'training',
  status: 'completed',
  tags: ['approved'],
  updatedAt: '2026-07-22T12:00:00Z',
  taskBaseEligible: true,
});

const descriptor = (id: string, overrides: Partial<ClearpipeTaskDescriptor> = {}): ClearpipeTaskDescriptor => ({
  identity: {task_id: id},
  base_task_eligible: true,
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
  let resourceQueries: jasmine.SpyObj<Pick<ClearpipeResourceQueryService, 'for'>>;

  beforeEach(() => {
    adapter = jasmine.createSpyObj<Pick<ClearpipeAdapterService, 'taskDescriptor'>>('ClearpipeAdapterService', ['taskDescriptor']);
    resourceQueries = jasmine.createSpyObj<Pick<ClearpipeResourceQueryService, 'for'>>('ClearpipeResourceQueryService', ['for']);
    resourceQueries.for.and.returnValue({} as ReturnType<ClearpipeResourceQueryService['for']>);
    TestBed.configureTestingModule({
      providers: [
        GraphStoreService,
        ClearpipeSemanticEdgeController,
        ClearpipeTaskAuthoringService,
        {provide: ClearpipeAdapterService, useValue: adapter},
        {provide: ClearpipeResourceQueryService, useValue: resourceQueries},
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
    const ineligible: ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse> = {
      status: 'ready',
      data: {status: 'available', descriptor: descriptor('base-task-a', {base_task_eligible: false})},
    };
    adapter.taskDescriptor.and.returnValues(
      of(loading, available),
      of(loading, stale),
      of(loading, unavailable),
      of(loading, mismatched),
      of(loading, ineligible),
    );
    const states: string[][] = [];

    [available, stale, unavailable, mismatched, ineligible].forEach(() => {
      const values: string[] = [];
      authoring.describeTask('base-task-a', resource('base-task-a').updatedAt).subscribe(state => values.push(state.status));
      states.push(values);
    });

    expect(states).toEqual([
      ['loading', 'available'],
      ['loading', 'stale'],
      ['loading', 'unavailable'],
      ['loading', 'unavailable'],
      ['loading', 'unavailable'],
    ]);
    expect(adapter.taskDescriptor.calls.allArgs()).toEqual([
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
      ['base-task-a', '2026-07-22T12:00:00Z'],
    ]);
  });

  it('fails closed for ineligible inventory selections and descriptor identities', () => {
    const fixture = TestBed.createComponent(ClearpipeTaskAuthoringCreateComponent);
    const component = fixture.componentInstance;
    const ineligibleResource = {...resource('runtime-child'), taskBaseEligible: false};

    component.selectTask({
      resource: ineligibleResource,
      reference: {kind: 'task', resource_id: ineligibleResource.id},
    });

    expect(component.selectedTask()).toBeNull();
    expect(component.descriptor()).toEqual(jasmine.objectContaining({status: 'unavailable', retryable: false}));
    expect(adapter.taskDescriptor).not.toHaveBeenCalled();
    expect(authoring.create(definition('runtime-child', {
      descriptor: descriptor('runtime-child', {base_task_eligible: false}),
    }))).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'CP24ELIGIBILITY001'})],
    }));
    expect(store.nodes()).toEqual([]);
    fixture.destroy();
  });

  it('rejects literal overrides for secret-named descriptor parameters without retaining their values', () => {
    const secretParameters = [
      {section: 'General', name: 'api_key'},
      {section: 'Credentials', name: 'password'},
      {section: 'General', name: 'token'},
    ];
    const parameterDefaults = Object.fromEntries(secretParameters.map(parameter => [
      taskParameterPortId(parameter.section, parameter.name),
      'must-not-persist',
    ]));
    const candidate = definition('base-task-a', {
      descriptor: descriptor('base-task-a', {parameters: secretParameters}),
      parameterDefaults,
    });
    const result = authoring.create(candidate);

    expect(result).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({
        code: 'CPSEM010',
        message: jasmine.stringMatching(/secret-named.*Remove.*pipeline parameter/i),
      })],
    }));
    expect(store.nodes()).toEqual([]);
    expect(JSON.stringify(result.errors)).not.toContain('must-not-persist');
  });

  it('rejects secret-shaped literal parameter values before graph persistence', () => {
    const literal = 'token=must-not-persist';
    const result = authoring.create(definition('base-task-a', {
      parameterDefaults: {
        [taskParameterPortId('General', 'threshold')]: literal,
      },
    }));

    expect(result).toEqual(jasmine.objectContaining({
      ok: false,
      errors: [jasmine.objectContaining({code: 'CPSEM010'})],
    }));
    expect(store.nodes()).toEqual([]);
    expect(JSON.stringify(result.errors)).not.toContain(literal);
  });

  it('requires stale confirmation for the exact returned descriptor timestamp and resets it before refresh', () => {
    const first = descriptor('base-task-a', {
      context: {...descriptor('base-task-a').context, updated_at: '2026-07-22T12:01:00Z'},
    });
    const newer = descriptor('base-task-a', {
      context: {...descriptor('base-task-a').context, updated_at: '2026-07-22T12:02:00Z'},
    });
    const firstToken = taskDescriptorConfirmationToken(first);
    const firstState: TaskAuthoringDescriptorState = {status: 'stale', descriptor: first};
    const newerState: TaskAuthoringDescriptorState = {status: 'stale', descriptor: newer};
    const firstRequest = new Subject<TaskAuthoringDescriptorState>();
    const refreshRequest = new Subject<TaskAuthoringDescriptorState>();
    const createAuthoring = jasmine.createSpyObj<Pick<ClearpipeTaskAuthoringService, 'describeTask'>>(
      'ClearpipeTaskAuthoringService',
      ['describeTask'],
    );
    createAuthoring.describeTask.and.returnValues(firstRequest, refreshRequest);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ClearpipeTaskAuthoringCreateComponent],
      providers: [
        {provide: ClearpipeTaskAuthoringService, useValue: createAuthoring},
        {provide: ClearpipeResourceQueryService, useValue: resourceQueries},
      ],
    });
    const fixture = TestBed.createComponent(ClearpipeTaskAuthoringCreateComponent);
    const component = fixture.componentInstance;
    component.selectTask({resource: resource('base-task-a'), reference: {kind: 'task', resource_id: 'base-task-a'}});
    firstRequest.next(firstState);
    component.confirmStaleDescriptor();
    expect(component.staleConfirmed()).toBeTrue();
    expect(isStaleDescriptorConfirmed(newerState, firstToken)).toBeFalse();

    component.retryDescriptor();
    expect(component.staleConfirmed()).toBeFalse();
    refreshRequest.next(newerState);
    expect(component.staleConfirmed()).toBeFalse();
    component.confirmStaleDescriptor();
    expect(component.staleConfirmed()).toBeTrue();
    expect(taskDescriptorConfirmationToken(descriptor('base-task-a', {
      context: {...descriptor('base-task-a').context, updated_at: undefined},
    }))).toBeNull();
    fixture.destroy();
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

  it('updates an unchanged bound parameter port after graph canonicalization', () => {
    const created = authoring.create(definition('base-task-a'));
    const threshold = taskParameterPortId('General', 'threshold');
    expect(store.addParameter({id: 'threshold', name: 'threshold', required: false, order: 0}).ok).toBeTrue();
    expect(authoring.connectPipelineParameter(created.id!, threshold, 'threshold').eligible).toBeTrue();

    const update = authoring.update(store.node(created.id!) as TaskNode, definition('base-task-a', {
      label: 'Updated task label',
    }));

    expect(update.ok).withContext(JSON.stringify(update.errors)).toBeTrue();
    expect((store.node(created.id!) as TaskNode).label).toBe('Updated task label');
    expect(store.bindingsForPort(created.id!, threshold)).toHaveSize(1);
  });

  it('reconciles descriptor insertion and reordering without dropping a surviving bound port', () => {
    const parameter = (name: string) => ({section: 'General', name});
    const firstDescriptor = descriptor('base-task-a', {parameters: [parameter('a'), parameter('c')]});
    const created = authoring.create(definition('base-task-a', {
      descriptor: firstDescriptor,
      parameterDefaults: {},
    }));
    const cPort = taskParameterPortId('General', 'c');
    expect(store.addParameter({id: 'value', name: 'value', required: false, order: 0}).ok).toBeTrue();
    expect(authoring.connectPipelineParameter(created.id!, cPort, 'value').eligible).toBeTrue();

    const inserted = authoring.update(store.node(created.id!) as TaskNode, definition('base-task-a', {
      descriptor: descriptor('base-task-a', {parameters: [parameter('a'), parameter('b'), parameter('c')]}),
      parameterDefaults: {},
    }));
    expect(inserted.ok).withContext(JSON.stringify(inserted.errors)).toBeTrue();
    expect((store.node(created.id!) as TaskNode).ports.filter(port => port.direction === 'input')
      .map(port => [port.name, port.order])).toEqual([['General/a', 0], ['General/b', 1], ['General/c', 2]]);
    expect(store.bindingsForPort(created.id!, cPort)).toHaveSize(1);

    const reordered = authoring.update(store.node(created.id!) as TaskNode, definition('base-task-a', {
      descriptor: descriptor('base-task-a', {parameters: [parameter('c'), parameter('b'), parameter('a')]}),
      parameterDefaults: {},
    }));
    expect(reordered.ok).withContext(JSON.stringify(reordered.errors)).toBeTrue();
    expect((store.node(created.id!) as TaskNode).ports.filter(port => port.direction === 'input')
      .map(port => [port.name, port.order])).toEqual([['General/c', 0], ['General/b', 1], ['General/a', 2]]);
    expect(store.bindingsForPort(created.id!, cPort)).toHaveSize(1);
    expect(decodeGraphV2(store.graph()!).status).toBe('ok');
  });

  it('replaces a legacy project/name reference only after selecting an eligible immutable descriptor identity', () => {
    const legacy = store.createTaskNode({
      name: 'legacy_step',
      label: 'Legacy step',
      base_task: {kind: 'task-name', project: 'Research', name: 'Train model'},
      ports: [],
      configuration: {},
      visual: {position: {x: 0, y: 0}},
    });
    const legacyNode = store.node(legacy.id!) as TaskNode;

    const update = authoring.update(legacyNode, definition('base-task-a'));

    expect(update.ok).withContext(JSON.stringify(update.errors)).toBeTrue();
    expect((store.node(legacy.id!) as TaskNode).base_task).toEqual({kind: 'task-id', task_id: 'base-task-a'});
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
