import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {of, Subject} from 'rxjs';
import {
  ClearpipeCapabilities,
  ClearpipeExecutionSnapshot,
  ClearpipeExecutionSnapshotResponse,
  ClearpipeStartResponse,
  ClearpipeValidationResponse,
} from '../clearpipe-api.service';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ClearpipeExecutionService} from '../editor/execution/clearpipe-execution.service';
import {
  mergeNodeExecution,
  nodeExecutionFrom,
  runtimeEvidenceFrom,
} from '../editor/execution/clearpipe-execution-status-map';
import {ClearpipeAdapterOutcome, ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {functionGraph} from './clearpipe-fixtures';

describe('ClearPipe execution integration', () => {
  const capabilities = (overrides: Partial<ClearpipeCapabilities> = {}): ClearpipeCapabilities => ({
    view: true,
    edit: true,
    save_as: true,
    version: false,
    run: true,
    compilation: true,
    execution: true,
    import: true,
    export: true,
    source: true,
    archive: true,
    delete: true,
    ...overrides,
  });

  const compilerOutput = (graph = functionGraph()) => ({
    source: 'pipe = PipelineController(name="ClearPipe")\n',
    manifest: {
      graph_digest: 'sha256:clearpipe-test-digest',
      runtime_steps: graph.nodes.map(node => ({
        graph_node_id: node.id,
        pipeline_step_name: node.name,
      })),
    },
  });

  const validation = (
    graph = functionGraph(),
    issues: ClearpipeValidationResponse['issues'] = [],
  ): Extract<ClearpipeAdapterOutcome<ClearpipeValidationResponse>, {status: 'ready'}> => ({
    status: 'ready',
    data: {valid: true, issues, pipeline: compilerOutput(graph)},
  });

  const snapshot = (
    graph = functionGraph(),
    overrides: Partial<ClearpipeExecutionSnapshot> = {},
  ): ClearpipeExecutionSnapshot => ({
    run_task_id: 'run-1',
    definition_task_id: 'definition-1',
    definition_revision: 2,
    graph_digest: 'sha256:clearpipe-test-digest',
    node_offset: 0,
    total_nodes: graph.nodes.length,
    truncated: false,
    controller: {task_id: 'run-1', status: 'in_progress', updated_at: '2026-07-22T16:00:00.000Z'},
    nodes: graph.nodes.map((node, index) => ({
      graph_node_id: node.id,
      pipeline_step_name: node.name,
      record_status: 'available' as const,
      task_id: `task-${index + 1}`,
      log_task_id: `task-${index + 1}`,
      status: 'queued',
      updated_at: `2026-07-22T16:00:0${index}.000Z`,
    })),
    ...overrides,
  });

  function setup(overrides: Partial<{
    graph: ReturnType<typeof functionGraph> | null;
    dirty: boolean;
    readOnly: boolean;
    identity: {taskId: string; revision: number; name: string} | null;
    capabilities: ClearpipeCapabilities | null;
    lifecycleStatus: string;
  }> = {}) {
    const graph = overrides.graph === undefined ? functionGraph() : overrides.graph;
    const lifecycle = {
      graph: signal(graph),
      dirty: signal(overrides.dirty ?? false),
      readOnly: signal(overrides.readOnly ?? false),
      busy: signal(false),
      status: signal(overrides.lifecycleStatus ?? 'ready'),
      identity: signal(overrides.identity === undefined ? {taskId: 'definition-1', revision: 2, name: 'Definition'} : overrides.identity),
      capabilities: signal(overrides.capabilities === undefined ? capabilities() : overrides.capabilities),
    } as unknown as ClearpipeLifecycleService;
    const adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', [
      'validate', 'submit', 'pollExecutionSnapshot', 'executionSnapshot', 'navigate',
    ]);
    const polling = new Subject<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>>();
    adapter.validate.and.returnValue(of({status: 'loading'} as const, validation(graph ?? functionGraph())));
    adapter.submit.and.returnValue(of(
      {status: 'loading'} as const,
      {status: 'ready', data: {run_task_id: 'run-1', enqueued: true}} as const,
    ));
    adapter.pollExecutionSnapshot.and.returnValue(polling);
    adapter.executionSnapshot.and.returnValue(of());
    adapter.navigate.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        ClearpipeExecutionService,
        {provide: ClearpipeLifecycleService, useValue: lifecycle},
        {provide: ClearpipeAdapterService, useValue: adapter},
      ],
    });
    return {
      adapter,
      graph,
      lifecycle,
      polling,
      service: TestBed.inject(ClearpipeExecutionService),
    };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('blocks unsaved, dirty, queue/resource diagnostics, and unavailable execution with actionable reasons', async () => {
    const unsaved = setup({identity: null});
    await unsaved.service.refresh();
    expect(unsaved.service.preflight().reasons.map(reason => reason.code)).toContain('unsaved_definition');
    expect(unsaved.adapter.validate).not.toHaveBeenCalled();

    TestBed.resetTestingModule();
    const dirty = setup({dirty: true});
    await dirty.service.refresh();
    expect(dirty.service.preflight().reasons.map(reason => reason.code)).toContain('dirty_definition');

    TestBed.resetTestingModule();
    const queue = setup();
    queue.adapter.validate.and.returnValue(of({
      status: 'validation_failed',
      problem: {
        message: 'A queue is required.',
        retryable: false,
        issues: [{code: 'CPSEM008', message: 'Choose an authorized queue.', severity: 'error'}],
      },
    }));
    await queue.service.refresh();
    expect(queue.service.preflight().reasons).toEqual([{
      code: 'queue_unavailable',
      message: 'Choose an authorized queue.',
    }]);

    TestBed.resetTestingModule();
    const unavailable = setup({capabilities: capabilities({run: false, compilation: false, execution: false})});
    await unavailable.service.refresh();
    expect(unavailable.service.toolbarAction().disabled).toBeTrue();
    expect(unavailable.service.toolbarAction().disabledReason).toContain('provenance-signing keys');

    TestBed.resetTestingModule();
    const resource = setup();
    resource.adapter.validate.and.returnValue(of(validation(resource.graph!, [{
      code: 'CPRES005',
      message: 'The resource service is unavailable.',
      severity: 'warning',
    }])));
    await resource.service.refresh();
    expect(resource.service.preflight().reasons).toEqual([{
      code: 'resource_unavailable',
      message: 'The resource service is unavailable.',
    }]);
  });

  it('submits exactly once and starts CP-14 polling only after a confirmed run ID', async () => {
    const {adapter, service} = setup();
    const submission = new Subject<ClearpipeAdapterOutcome<ClearpipeStartResponse>>();
    adapter.submit.and.returnValue(submission);
    await service.refresh();

    const first = service.submit();
    const second = service.submit();
    expect(adapter.submit).toHaveBeenCalledTimes(1);
    expect(service.run().state).toBe('submitting');

    submission.next({status: 'ready', data: {run_task_id: 'run-1', enqueued: true}});
    submission.complete();
    await Promise.all([first, second]);

    expect(service.run()).toEqual({state: 'submitted', runTaskId: 'run-1', message: null});
    expect(adapter.pollExecutionSnapshot).toHaveBeenCalledWith(jasmine.objectContaining({
      run: 'run-1',
      definition_revision: 2,
      graph_digest: 'sha256:clearpipe-test-digest',
    }), 5000);
  });

  it('preserves distinct submission failures without inventing a submitted run', async () => {
    const {adapter, service} = setup();
    await service.refresh();
    adapter.submit.and.returnValue(of({
      status: 'resource_unavailable',
      problem: {message: 'The selected queue is unavailable.', retryable: true},
    }));

    await service.submit();

    expect(service.run()).toEqual({
      state: 'failed',
      runTaskId: null,
      message: 'The selected queue is unavailable.',
      reason: 'resource_unavailable',
    });

    adapter.submit.and.returnValue(of({
      status: 'denied_or_missing',
      problem: {message: 'Run access was removed.', retryable: false},
    }));
    await service.submit();
    expect(service.run()).toEqual({
      state: 'failed',
      runTaskId: null,
      message: 'Run access was removed.',
      reason: 'permission_denied',
    });

    adapter.submit.and.returnValue(of({
      status: 'failed',
      problem: {message: 'The execution service is unavailable.', retryable: true},
    }));
    await service.submit();
    expect(service.run().reason).toBe('request_failed');
  });

  it('uses only server runtime mappings and ignores older node snapshots', () => {
    const graph = functionGraph();
    const evidence = runtimeEvidenceFrom(compilerOutput(graph), graph.nodes.map(node => node.id));
    expect(evidence).not.toBeNull();
    const backendStates: {status: string; expected: string}[] = [
      {status: 'queued', expected: 'queued'},
      {status: 'in_progress', expected: 'running'},
      {status: 'completed', expected: 'completed'},
      {status: 'failed', expected: 'failed'},
      {status: 'stopped', expected: 'aborted'},
      {status: 'skipped', expected: 'skipped'},
      {status: 'cached', expected: 'cached'},
    ];
    let current;
    backendStates.forEach(({status, expected}, index) => {
      const update = nodeExecutionFrom({
        graph_node_id: 'normalize',
        pipeline_step_name: 'normalize',
        record_status: 'available',
        task_id: 'task-1',
        status,
        updated_at: `2026-07-22T16:0${index}:00.000Z`,
      }, evidence!);
      current = mergeNodeExecution(current, update!);
      expect(current.state).toBe(expected);
    });
    const queuedEarlier = nodeExecutionFrom({
      graph_node_id: 'normalize',
      pipeline_step_name: 'normalize',
      record_status: 'available',
      task_id: 'task-1',
      status: 'queued',
      updated_at: '2026-07-22T16:01:00.000Z',
    }, evidence!);

    expect(mergeNodeExecution(current, queuedEarlier!).state).toBe('cached');
    expect(nodeExecutionFrom({
      graph_node_id: 'normalize',
      pipeline_step_name: 'browser-parsed-step',
      record_status: 'available',
      status: 'completed',
    }, evidence!)).toBeNull();
  });

  it('loads all authorized snapshot pages and exposes stale, denied, and unavailable data visibly', async () => {
    const {adapter, graph, polling, service} = setup();
    await service.refresh();
    await service.submit();
    const firstPage = snapshot(graph!, {
      total_nodes: 2,
      truncated: true,
      next_node_offset: 1,
      nodes: [snapshot(graph!).nodes[0]],
    });
    const secondPage = snapshot(graph!, {
      node_offset: 1,
      total_nodes: 2,
      truncated: false,
      nodes: [snapshot(graph!).nodes[1]],
    });
    const page = new Subject<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>>();
    adapter.executionSnapshot.and.returnValue(page);

    polling.next({status: 'ready', data: {status: 'available', snapshot: firstPage}});
    expect(adapter.executionSnapshot).toHaveBeenCalledWith(jasmine.objectContaining({node_offset: 1}));
    expect(service.tracking().state).toBe('partial');
    page.next({status: 'ready', data: {status: 'available', snapshot: secondPage}});
    page.complete();
    expect(service.tracking().state).toBe('polling');
    expect(service.nodes().map(node => node.graphNodeId)).toEqual(['format-result', 'normalize']);

    polling.next({status: 'ready', data: {status: 'stale', snapshot: firstPage}});
    expect(service.tracking().state).toBe('stale');

    TestBed.resetTestingModule();
    const denied = setup();
    await denied.service.refresh();
    await denied.service.submit();
    denied.polling.next({status: 'denied_or_missing', problem: {message: 'Access was removed.', retryable: false}});
    expect(denied.service.tracking().state).toBe('denied');

    TestBed.resetTestingModule();
    const unavailable = setup();
    await unavailable.service.refresh();
    await unavailable.service.submit();
    unavailable.polling.next({status: 'ready', data: {status: 'unavailable'}});
    expect(unavailable.service.tracking().state).toBe('unavailable');
  });

  it('cancels preflight and polling on identity reset and service teardown', async () => {
    const {adapter, lifecycle, polling, service} = setup();
    const validationResponse = new Subject<ClearpipeAdapterOutcome<ClearpipeValidationResponse>>();
    adapter.validate.and.returnValue(validationResponse);
    const refresh = service.refresh();
    lifecycle.identity.set({taskId: 'definition-2', revision: 1, name: 'Replacement'});
    service.reset();
    validationResponse.next(validation());
    validationResponse.complete();
    await refresh;
    expect(service.preflight().scopeKey).toBe('definition-2@1');

    await service.refresh();
    await service.submit();
    TestBed.resetTestingModule();
    polling.next({status: 'ready', data: {status: 'available', snapshot: snapshot()}});
    expect(adapter.executionSnapshot).not.toHaveBeenCalled();
  });

  it('navigates only with safe server-provided identifiers', async () => {
    const {adapter, service} = setup();
    await service.openTask('unsafe/task');
    await service.openTask('task-1');
    await service.openResource('model', 'model-1');

    expect(adapter.navigate).toHaveBeenCalledTimes(2);
    expect(adapter.navigate).toHaveBeenCalledWith({
      kind: 'pipeline-details',
      runTaskId: 'task-1',
    });
    expect(adapter.navigate).toHaveBeenCalledWith({
      kind: 'resource-details',
      resourceType: 'model',
      resourceId: 'model-1',
    });
  });
});
