import {HttpErrorResponse} from '@angular/common/http';
import {fakeAsync, TestBed, tick} from '@angular/core/testing';
import {Router} from '@angular/router';
import {Store} from '@ngrx/store';
import {of, throwError} from 'rxjs';
import {HTTP} from '~/app.constants';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {ConfigurationService} from '@common/shared/services/configuration.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {
  ClearpipeAdapterOutcome,
  ClearpipeAdapterService,
  ClearpipeDefinitionState,
} from './clearpipe-adapter.service';
import {GraphV2} from '../domain/graph-v2.types';

describe('ClearpipeAdapterService', () => {
  let adapter: ClearpipeAdapterService;
  let requests: jasmine.SpyObj<SmApiRequestsService>;
  let router: jasmine.SpyObj<Router>;
  let clearpipeEnabled = true;

  const graph: GraphV2 = {
    schema_version: 2,
    document: {name: 'Pipe', project: '.pipelines/Pipe', tags: []},
    settings: {},
    parameters: [],
    resources: [],
    outputs: [],
    nodes: [],
    bindings: [],
    visual: {viewport: {x: 0, y: 0}, zoom: 1},
  };

  const definition = (overrides: Record<string, unknown> = {}) => ({
    id: 'pipe-1',
    name: 'Pipe',
    revision: 3,
    graph,
    representation: 'clearpipe_graph_v2',
    capabilities: {
      view: true,
      edit: true,
      save_as: true,
      version: false,
      run: true,
      import: true,
      export: true,
      source: false,
      archive: true,
      delete: true,
    },
    ...overrides,
  });

  beforeEach(() => {
    HTTP.API_BASE_URL_NO_VERSION = '/service/1/api';
    requests = jasmine.createSpyObj<SmApiRequestsService>('SmApiRequestsService', ['post']);
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'navigateByUrl']);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        ClearpipeApiService,
        ClearpipeAdapterService,
        {provide: SmApiRequestsService, useValue: requests},
        {provide: Router, useValue: router},
        {provide: Store, useValue: {select: () => of({id: 'user-1'})}},
        {
          provide: ConfigurationService,
          useValue: {configuration: () => ({clearpipeEnabled})},
        },
      ],
    });
    adapter = TestBed.inject(ClearpipeAdapterService);
  });

  it('uses the authenticated ClearPipe client and exposes loading, capabilities, and ready states', () => {
    requests.post.and.returnValue(of({definition: definition()}));

    const outcomes = collect(adapter.load('pipe-1'));

    expect(requests.post).toHaveBeenCalledWith('/service/1/api/v2.35/clearpipe.get_by_id', {task: 'pipe-1'});
    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'ready']);
    const ready = outcomes[1] as Extract<ClearpipeAdapterOutcome<ClearpipeDefinitionState>, {status: 'ready'}>;
    expect(ready.data.capabilities.run).toBeTrue();
    expect(ready.data.representation).toBe('clearpipe_graph_v2');
  });

  it('normalizes inaccessible definitions without disclosing whether their task exists', () => {
    requests.post.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 404,
      error: {code: 'InvalidTaskId'},
    })));

    const outcomes = collect(adapter.load('private-task'));

    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'denied_or_missing']);
    expect((outcomes[1] as Extract<ClearpipeAdapterOutcome<ClearpipeDefinitionState>, {problem: unknown}>).problem.message)
      .not.toContain('private-task');
  });

  it('preserves a stale revision as a non-retrying outcome', () => {
    requests.post.and.returnValue(throwError(() => new HttpErrorResponse({
      status: 409,
      error: {code: 'RevisionConflict'},
    })));

    const outcomes = collect(adapter.update({
      task: 'pipe-1',
      revision: 3,
      name: 'Pipe',
      graph,
    }));

    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'stale_revision']);
    expect((outcomes[1] as Extract<ClearpipeAdapterOutcome<ClearpipeDefinitionState>, {problem: unknown}>).problem.retryable)
      .toBeFalse();
  });

  it('fails closed for legacy representations and unsupported resource selectors', () => {
    requests.post.and.returnValue(of({definition: definition({
      representation: 'legacy_clearpipe_graph',
      graph: {schema_version: 1},
    })}));

    const legacy = collect(adapter.load('pipe-1'));
    const storage = collect(adapter.resources('storage'));

    expect(legacy.map(outcome => outcome.status)).toEqual(['loading', 'unsupported_representation']);
    expect(storage.map(outcome => outcome.status)).toEqual(['loading', 'resource_unavailable']);
  });

  it('keeps a successfully enqueued run visible when no queue worker is observed', () => {
    requests.post.and.returnValue(of({task: 'run-1', enqueued: true, queue_watched: false}));

    const outcomes = collect(adapter.submit({task: 'pipe-1', revision: 3}));

    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'submission_succeeded_unwatched']);
    expect((outcomes[1] as Extract<ClearpipeAdapterOutcome<{run_task_id: string}>, {status: 'submission_succeeded_unwatched'}>)
      .data.run_task_id).toBe('run-1');
    expect(requests.post).toHaveBeenCalledWith('/service/1/api/v2.35/clearpipe.start', jasmine.objectContaining({
      task: 'pipe-1',
      revision: 3,
      verify_watched_queue: true,
    }));
  });

  it('exposes stable v2 compilation/execution capability gaps without submitting a run', () => {
    requests.post.and.returnValue(of({definition: definition({
      capabilities: {
        ...definition().capabilities,
        run: false,
        compilation: false,
        execution: false,
      },
    })}));
    const loaded = collect(adapter.load('pipe-1'));
    const state = (loaded[1] as Extract<ClearpipeAdapterOutcome<ClearpipeDefinitionState>, {status: 'ready'}>).data;

    const submission = collect(adapter.submit({task: 'pipe-1', revision: 3}, state));

    expect(state.capabilities.compilation).toBeFalse();
    expect(state.capabilities.execution).toBeFalse();
    expect(submission.map(outcome => outcome.status)).toEqual(['loading', 'execution_unavailable']);
    expect(requests.post.calls.count()).toBe(1);
  });

  it('maps the server compilation_unavailable diagnostic without exposing its raw error body', () => {
    requests.post.and.returnValue(of({
      valid: true,
      issues: [{
        code: 'compilation_unavailable',
        message: 'ClearPipe graph v2 compilation and execution are unavailable until a v2 compiler is registered',
        severity: 'warning',
      }],
    }));

    const outcomes = collect(adapter.validate({graph}));

    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'execution_unavailable']);
    expect((outcomes[1] as Extract<ClearpipeAdapterOutcome<unknown>, {problem: unknown}>).problem.code)
      .toBe('compilation_unavailable');
  });

  it('normalizes execution-unavailable and secret-override server failures without exposing secret input', () => {
    requests.post.and.returnValues(
      throwError(() => new HttpErrorResponse({
        status: 400,
        error: {
          code: 'ValidationError',
          data: {issues: [{code: 'compilation_unavailable', message: 'v2 compiler is unavailable'}]},
        },
      })),
      throwError(() => new HttpErrorResponse({
        status: 400,
        error: {
          code: 'ValidationError',
          data: {issues: [{code: 'embedded_secret', message: 'Token token-value was rejected'}]},
        },
      })),
    );

    const execution = collect(adapter.submit({task: 'pipe-1', revision: 3}));
    const secret = collect(adapter.submit({task: 'pipe-1', revision: 3, parameters: {token: 'token-value'}}));

    expect(execution.map(outcome => outcome.status)).toEqual(['loading', 'execution_unavailable']);
    expect(secret.map(outcome => outcome.status)).toEqual(['loading', 'validation_failed']);
    const validation = secret[1] as Extract<ClearpipeAdapterOutcome<unknown>, {problem: unknown}>;
    expect(validation.problem.issues?.[0].message).toBe('Credentials and secrets are not accepted in ClearPipe input.');
    expect(JSON.stringify(validation)).not.toContain('token-value');
  });

  it('normalizes unexpected transport failures into a retryable outcome', () => {
    requests.post.and.returnValue(throwError(() => new Error('network unavailable')));

    const outcomes = collect(adapter.list());

    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'failed']);
    expect((outcomes[1] as Extract<ClearpipeAdapterOutcome<unknown>, {problem: unknown}>).problem.retryable).toBeTrue();
  });

  it('keeps explicit descriptor availability in typed data and stops cold snapshot polling on teardown', fakeAsync(() => {
    requests.post.and.returnValues(
      of({status: 'missing'}),
      of({
        status: 'available',
        snapshot: {
          run_task_id: 'run-1',
          definition_task_id: 'pipe-1',
          definition_revision: 3,
          graph_digest: 'sha256:digest',
          controller: {task_id: 'run-1', status: 'in_progress'},
          nodes: [],
        },
      }),
      of({
        status: 'available',
        snapshot: {
          run_task_id: 'run-1',
          definition_task_id: 'pipe-1',
          definition_revision: 3,
          graph_digest: 'sha256:digest',
          controller: {task_id: 'run-1', status: 'completed'},
          nodes: [],
        },
      }),
    );

    const descriptor = collect(adapter.taskDescriptor('missing-task'));
    expect(descriptor.map(outcome => outcome.status)).toEqual(['loading', 'ready']);
    expect((descriptor[1] as Extract<ClearpipeAdapterOutcome<unknown>, {status: 'ready'}>).data)
      .toEqual({status: 'missing'});
    expect(requests.post.calls.argsFor(0)).toEqual([
      '/service/1/api/v2.35/clearpipe.task_descriptor',
      {task: 'missing-task', known_updated_at: undefined},
    ]);

    const outcomes: ClearpipeAdapterOutcome<unknown>[] = [];
    const subscription = adapter.pollExecutionSnapshot({run: 'run-1'}, 100).subscribe(outcome => outcomes.push(outcome));
    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading']);
    tick(0);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'ready']);
    tick(1000);
    expect(outcomes.map(outcome => outcome.status)).toEqual(['loading', 'ready', 'ready']);
    subscription.unsubscribe();
    tick(1000);
    expect(requests.post.calls.count()).toBe(3);
    expect(requests.post.calls.argsFor(1)).toEqual([
      '/service/1/api/v2.35/clearpipe.execution_snapshot',
      {run: 'run-1', definition_revision: undefined, graph_digest: undefined},
    ]);
  }));

  it('builds guarded ClearPipe and existing task/pipeline handoff routes without calling pipelines.start_pipeline', async () => {
    expect(adapter.routeFor({kind: 'clearpipe-definition', taskId: 'pipe-1'})).toEqual(['/clearpipe', 'pipe-1', 'edit']);
    expect(adapter.routeFor({kind: 'definition-task-details', taskId: 'pipe-1'})).toEqual(['/projects', '*', 'tasks', 'pipe-1']);
    expect(adapter.routeFor({kind: 'pipeline-details', runTaskId: 'run-1'})).toEqual(['/pipelines', '*', 'tasks', 'run-1']);
    expect(adapter.parseRoute('/pipelines/clearpipe/pipe-1/edit')).toEqual({kind: 'clearpipe-definition', taskId: 'pipe-1'});

    clearpipeEnabled = false;
    await adapter.navigate({kind: 'clearpipe-new'});

    expect(router.navigateByUrl).toHaveBeenCalledWith('/404');
    expect(requests.post).not.toHaveBeenCalled();
  });

  function collect<T>(source: import('rxjs').Observable<T>): T[] {
    const outcomes: T[] = [];
    source.subscribe(outcome => outcomes.push(outcome));
    return outcomes;
  }
});
