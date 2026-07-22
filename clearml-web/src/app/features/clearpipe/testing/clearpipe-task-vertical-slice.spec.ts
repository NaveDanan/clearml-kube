import {fakeAsync, flushMicrotasks, TestBed, tick} from '@angular/core/testing';
import {Router} from '@angular/router';
import {Store} from '@ngrx/store';
import {of} from 'rxjs';
import {HTTP} from '~/app.constants';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {ConfigurationService} from '@common/shared/services/configuration.service';
import {ClearpipeApiService, ClearpipeTaskDescriptor} from '../clearpipe-api.service';
import {GraphStoreService} from '../domain/graph-store.service';
import {TaskNode} from '../domain/graph-v2.types';
import {ClearpipeCodePreviewComponent} from '../editor/clearpipe-code-preview.component';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ClearpipeSemanticEdgeController} from '../editor/edges/clearpipe-semantic-edge.controller';
import {ClearpipeExecutionService} from '../editor/execution/clearpipe-execution.service';
import {
  taskArtifactPortId,
  taskParameterPortId,
  taskQueueResourceId,
  TaskAuthoringDescriptorState,
  TaskAuthoringDefinition,
} from '../editor/task-authoring/task-authoring.models';
import {ClearpipeTaskAuthoringService} from '../editor/task-authoring/task-authoring.service';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {
  ClearpipeTaskVerticalSliceTransport,
} from './clearpipe-task-vertical-slice.fixture';

describe('CP-28 task-backed vertical slice', () => {
  let adapter: ClearpipeAdapterService;
  let authoring: ClearpipeTaskAuthoringService;
  let lifecycle: ClearpipeLifecycleService;
  let router: jasmine.SpyObj<Router>;
  let store: GraphStoreService;
  let transport: ClearpipeTaskVerticalSliceTransport;
  let originalApiBase: string;

  beforeEach(() => {
    originalApiBase = HTTP.API_BASE_URL_NO_VERSION;
    HTTP.API_BASE_URL_NO_VERSION = '/cp28/api';
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);
    transport = new ClearpipeTaskVerticalSliceTransport();
    TestBed.configureTestingModule({
      imports: [ClearpipeCodePreviewComponent],
      providers: [
        ClearpipeApiService,
        ClearpipeAdapterService,
        GraphStoreService,
        ClearpipeSemanticEdgeController,
        ClearpipeTaskAuthoringService,
        ClearpipeLifecycleService,
        ClearpipeExecutionService,
        {provide: SmApiRequestsService, useValue: {post: transport.post.bind(transport)}},
        {provide: Router, useValue: router},
        {provide: Store, useValue: {select: () => of({id: 'cp28-authorized-user'})}},
        {provide: ConfigurationService, useValue: {configuration: () => ({clearpipeEnabled: true})}},
      ],
    });
    adapter = TestBed.inject(ClearpipeAdapterService);
    authoring = TestBed.inject(ClearpipeTaskAuthoringService);
    lifecycle = TestBed.inject(ClearpipeLifecycleService);
    store = TestBed.inject(GraphStoreService);
  });

  afterEach(() => {
    HTTP.API_BASE_URL_NO_VERSION = originalApiBase;
    TestBed.resetTestingModule();
  });

  it('creates, validates, generates, reloads, and starts a two-task graph through typed server contracts', fakeAsync(() => {
    const inventory: string[] = [];
    adapter.taskInventory().subscribe(outcome => {
      if (outcome.status === 'ready') inventory.push(...outcome.data.tasks.map(task => task.id));
    });
    expect(inventory).toEqual(['base-train-0001', 'base-publish-0002']);

    const sourceDescriptor = authorizedDescriptor('base-train-0001');
    const targetDescriptor = authorizedDescriptor('base-publish-0002');
    expect(lifecycle.new({
      name: 'CP28_task_vertical_slice',
      project: 'CP28 integration',
      tags: ['clearpipe', 'cp28'],
    })).toBeTrue();

    const queue = {id: 'queue-cp28-gpu', kind: 'queue' as const, name: 'CP-28 GPU'};
    const source = authoring.create(taskDefinition(sourceDescriptor, {
      name: 'train_model',
      label: 'Train model',
      cache: true,
      retryOnFailure: 2,
      queue,
      placement: {x: 120, y: 72},
      parameterDefaults: {[taskParameterPortId('General', 'threshold')]: 0.72},
    }));
    const target = authoring.create(taskDefinition(targetDescriptor, {
      name: 'publish_model',
      label: 'Publish model',
      cache: false,
      retryOnFailure: 1,
      queue,
      placement: {x: 560, y: 216},
    }));
    expect(source.ok).toBeTrue();
    expect(target.ok).toBeTrue();
    if (!source.id || !target.id) throw new Error('Task authoring did not return stable graph node IDs.');
    const sourceId = source.id;
    const targetId = target.id;
    const sourceArtifactPort = taskArtifactPortId('trained-model');
    const targetArtifactPort = taskParameterPortId('General', 'model_uri');
    const targetThresholdPort = taskParameterPortId('General', 'threshold');

    expect(store.addParameter({
      id: 'pipeline_threshold',
      name: 'pipeline_threshold',
      required: false,
      order: 0,
      default: 0.8,
    }).ok).toBeTrue();
    expect(authoring.connectArtifact(sourceId, sourceArtifactPort, targetId, targetArtifactPort).eligible).toBeTrue();
    expect(authoring.connectPipelineParameter(targetId, targetThresholdPort, 'pipeline_threshold').eligible).toBeTrue();
    expect(authoring.connectExecutionParent(sourceId, targetId).eligible).toBeTrue();

    const configured = store.graph()!;
    expect(store.dependencies()).toEqual([{source_node_id: sourceId, target_node_id: targetId}]);
    expect(store.generatedInputs()).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({node_id: targetId, port_id: targetArtifactPort}),
      jasmine.objectContaining({node_id: targetId, port_id: targetThresholdPort}),
    ]));
    expect(configured.bindings).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({
        kind: 'artifact',
        source: {kind: 'port', node_id: sourceId, port_id: sourceArtifactPort},
        target: {kind: 'port', node_id: targetId, port_id: targetArtifactPort},
      }),
      jasmine.objectContaining({
        kind: 'parameter',
        source: {kind: 'parameter', parameter_id: 'pipeline_threshold'},
        target: {kind: 'port', node_id: targetId, port_id: targetThresholdPort},
      }),
      jasmine.objectContaining({
        kind: 'execution-only',
        source: {kind: 'node', node_id: sourceId},
        target: {kind: 'node', node_id: targetId},
      }),
    ]));

    const preview = TestBed.createComponent(ClearpipeCodePreviewComponent);
    preview.componentRef.setInput('graph', configured);
    preview.componentRef.setInput('open', true);
    preview.detectChanges();
    flushMicrotasks();
    preview.detectChanges();
    const generated = preview.componentInstance.generated()?.source;
    expect(generated).toContain('base_task_id="base-train-0001"');
    expect(generated).toContain('base_task_id="base-publish-0002"');
    expect(generated).toContain(`kind="artifact", source="${sourceId}.${sourceArtifactPort}", target="${targetId}.${targetArtifactPort}"`);
    expect(generated).toContain(`kind="parameter", source="parameter:pipeline_threshold", target="${targetId}.${targetThresholdPort}"`);
    expect(generated).not.toMatch(/password|secret|api[_-]?key|token/i);
    expect(transport.callsFor('validate')[0].body).toEqual(jasmine.objectContaining({graph: configured}));

    void lifecycle.save();
    flushMicrotasks();
    const savedIdentity = lifecycle.identity();
    expect(savedIdentity).toEqual({
      taskId: 'definition-cp28-0001',
      revision: 1,
      name: 'CP28_task_vertical_slice',
    });
    expect(lifecycle.status()).toBe('saved');
    expect(lifecycle.dirty()).toBeFalse();

    void lifecycle.reload();
    flushMicrotasks();
    const reloaded = store.graph()!;
    const sourceNode = store.node(sourceId) as TaskNode;
    const targetNode = store.node(targetId) as TaskNode;
    expect(lifecycle.status()).toBe('ready');
    expect(reloaded.nodes.map(node => node.id)).toEqual([sourceId, targetId]);
    expect(sourceNode).toEqual(jasmine.objectContaining({
      base_task: {kind: 'task-id', task_id: 'base-train-0001'},
      configuration: jasmine.objectContaining({
        cache: true,
        retry_on_failure: 2,
        queue_resource_id: taskQueueResourceId('queue-cp28-gpu'),
      }),
      visual: {position: {x: 120, y: 72}},
    }));
    expect(targetNode).toEqual(jasmine.objectContaining({
      base_task: {kind: 'task-id', task_id: 'base-publish-0002'},
      configuration: jasmine.objectContaining({
        cache: false,
        retry_on_failure: 1,
        queue_resource_id: taskQueueResourceId('queue-cp28-gpu'),
      }),
      visual: {position: {x: 560, y: 216}},
    }));
    expect(reloaded.resources).toContain(jasmine.objectContaining({
      id: taskQueueResourceId('queue-cp28-gpu'),
      kind: 'queue',
      resource_id: 'queue-cp28-gpu',
    }));
    expect(reloaded.bindings).toEqual(configured.bindings);
    expect(JSON.stringify(reloaded)).not.toMatch(/password|secret|api[_-]?key|token/i);

    const execution = TestBed.inject(ClearpipeExecutionService);
    execution.setRouteContext(savedIdentity!.taskId, true);
    void execution.refresh();
    flushMicrotasks();
    expect(execution.preflight()).toEqual(jasmine.objectContaining({
      scopeKey: 'definition-cp28-0001@1',
      state: 'ready',
      reasons: [],
      evidence: jasmine.objectContaining({
        steps: jasmine.arrayContaining([
          {graphNodeId: sourceId, pipelineStepName: 'train_model'},
          {graphNodeId: targetId, pipelineStepName: 'publish_model'},
        ]),
      }),
    }));

    void execution.submit();
    flushMicrotasks();
    tick(0);
    expect(execution.run()).toEqual({state: 'submitted', runTaskId: 'run-cp28-0001', message: null});
    expect(execution.tracking()).toEqual(jasmine.objectContaining({
      state: 'completed',
      totalNodes: 2,
      receivedNodes: 2,
    }));
    expect(execution.nodes()).toEqual(jasmine.arrayContaining([
      jasmine.objectContaining({graphNodeId: sourceId, taskId: 'runtime-cp28-1', state: 'completed'}),
      jasmine.objectContaining({graphNodeId: targetId, taskId: 'runtime-cp28-2', state: 'completed'}),
    ]));
    expect(transport.callsFor('start')[0].body).toEqual(jasmine.objectContaining({
      task: 'definition-cp28-0001',
      revision: 1,
      verify_watched_queue: true,
      idempotency_key: jasmine.any(String),
    }));
    expect(JSON.stringify(transport.callsFor('start')[0].body)).not.toContain('PipelineController');
    const snapshotRequest = transport.callsFor('execution_snapshot')[0].body as Record<string, unknown>;
    expect(snapshotRequest).toEqual(jasmine.objectContaining({
      run: 'run-cp28-0001',
      definition_revision: 1,
      graph_digest: execution.preflight().evidence!.graphDigest,
    }));

    let navigated = false;
    void execution.openPipelineRun().then(result => navigated = result);
    flushMicrotasks();
    expect(navigated).toBeTrue();
    expect(router.navigate).toHaveBeenCalledWith(['/pipelines', '*', 'tasks', 'run-cp28-0001']);
  }));

  it('fails closed when an authorized task descriptor is no longer available', () => {
    transport.denyDescriptor('base-train-0001');
    expect(lifecycle.new({name: 'Denied descriptor', project: 'CP28 integration'})).toBeTrue();

    const states: TaskAuthoringDescriptorState[] = [];
    authoring.describeTask('base-train-0001').subscribe(state => states.push(state));

    expect(states.map(state => state.status)).toEqual(['loading', 'unavailable']);
    expect(store.nodes()).toEqual([]);
    expect(transport.callsFor('task_descriptor')[0].body).toEqual({
      task: 'base-train-0001',
      known_updated_at: undefined,
    });
  });

  function authorizedDescriptor(taskId: string): ClearpipeTaskDescriptor {
    const states: TaskAuthoringDescriptorState[] = [];
    authoring.describeTask(taskId).subscribe(state => states.push(state));
    expect(states.map(state => state.status)).toEqual(['loading', 'available']);
    const available = states.find(state => state.status === 'available');
    if (!available || available.status !== 'available') {
      throw new Error(`The authorized task descriptor "${taskId}" was unavailable.`);
    }
    return available.descriptor;
  }

  function taskDefinition(
    descriptor: ClearpipeTaskDescriptor,
    overrides: Partial<TaskAuthoringDefinition>,
  ): TaskAuthoringDefinition {
    return {
      selectedTaskId: descriptor.identity.task_id,
      descriptor,
      name: `task_${descriptor.identity.task_id.replaceAll('-', '_')}`,
      label: descriptor.context.name,
      cloneBaseTask: false,
      cache: false,
      parameterDefaults: {},
      ...overrides,
    };
  }
});
