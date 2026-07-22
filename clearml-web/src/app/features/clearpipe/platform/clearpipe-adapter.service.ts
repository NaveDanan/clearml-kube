import {inject, Injectable} from '@angular/core';
import {HttpErrorResponse} from '@angular/common/http';
import {toSignal} from '@angular/core/rxjs-interop';
import {Router} from '@angular/router';
import {Store} from '@ngrx/store';
import {concat, Observable, of, timer} from 'rxjs';
import {catchError, map, switchMap} from 'rxjs/operators';
import {selectCurrentUser} from '@common/core/reducers/users-reducer';
import {ConfigurationService} from '@common/shared/services/configuration.service';
import {
  ClearpipeApiService,
  ClearpipeArchiveResponse,
  ClearpipeCapabilities,
  ClearpipeCreateRequest,
  ClearpipeDefinitionResponse,
  ClearpipeExecutionSnapshotRequest,
  ClearpipeExecutionSnapshotResponse,
  ClearpipeListRequest,
  ClearpipeListResponse,
  ClearpipeParseScriptResponse,
  ClearpipeStartRequest,
  ClearpipeStartResponse,
  ClearpipeTaskDescriptorResponse,
  ClearpipeTaskInventoryRequest,
  ClearpipeTaskInventoryResponse,
  ClearpipeUpdateRequest,
  ClearpipeValidateRequest,
  ClearpipeValidationResponse,
} from '../clearpipe-api.service';
import {ClearpipeDefinition, ClearpipeResourceOption, ClearpipeValidationIssue} from '../clearpipe.models';
import {decodeGraphV2} from '../domain/graph-v2-codec';
import {GraphV2} from '../domain/graph-v2.types';

export type ClearpipeAdapterStatus =
  | 'loading'
  | 'ready'
  | 'denied_or_missing'
  | 'validation_failed'
  | 'stale_revision'
  | 'resource_unavailable'
  | 'unsupported_representation'
  | 'execution_unavailable'
  | 'submission_succeeded_unwatched'
  | 'failed';

export interface ClearpipeAdapterProblem {
  code?: string;
  message: string;
  retryable: boolean;
  issues?: ClearpipeValidationIssue[];
}

export type ClearpipeAdapterOutcome<T> =
  | {status: 'loading'}
  | {status: 'ready'; data: T}
  | {status: 'submission_succeeded_unwatched'; data: T; problem: ClearpipeAdapterProblem}
  | {
    status: Exclude<ClearpipeAdapterStatus, 'loading' | 'ready' | 'submission_succeeded_unwatched'>;
    data?: T;
    problem: ClearpipeAdapterProblem;
  };

export interface ClearpipeDefinitionState {
  definition: ClearpipeDefinition;
  graph?: GraphV2;
  representation: 'clearpipe_graph_v2' | 'legacy_clearpipe_graph' | 'unsupported_clearpipe_graph';
  capabilities: ClearpipeCapabilities;
}

export interface ClearpipeListState {
  definitions: ClearpipeDefinitionState[];
  total: number;
}

export interface ClearpipeAuthenticationState {
  authenticated: boolean;
  featureEnabled: boolean;
}

export type ClearpipeNavigationTarget =
  | {kind: 'clearpipe-library'}
  | {kind: 'clearpipe-new'}
  | {kind: 'clearpipe-definition'; taskId: string}
  | {kind: 'definition-task-details'; taskId: string}
  | {kind: 'pipeline-details'; runTaskId: string}
  | {kind: 'resource-details'; resourceType: ClearpipeResourceOption['type']; resourceId: string};

const capabilityKeys: (keyof ClearpipeCapabilities)[] = [
  'view', 'edit', 'save_as', 'version', 'run', 'compilation', 'execution', 'import', 'export', 'source', 'archive', 'delete',
];

const emptyCapabilities = (): ClearpipeCapabilities => capabilityKeys.reduce(
  (capabilities, key) => ({...capabilities, [key]: false}),
  {} as ClearpipeCapabilities
);

const isClearpipeNavigation = (target: ClearpipeNavigationTarget): boolean =>
  ['clearpipe-library', 'clearpipe-new', 'clearpipe-definition'].includes(target.kind);

/**
 * The only ClearPipe browser boundary for typed service operations, capability
 * checks, normalized failures, and semantic navigation.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeAdapterService {
  private readonly api = inject(ClearpipeApiService);
  private readonly configuration = inject(ConfigurationService).configuration;
  private readonly router = inject(Router);
  private readonly currentUser = toSignal(inject(Store).select(selectCurrentUser), {initialValue: null});

  authentication(): ClearpipeAuthenticationState {
    return {
      authenticated: Boolean(this.currentUser()),
      featureEnabled: this.configuration().clearpipeEnabled !== false,
    };
  }

  list(request: ClearpipeListRequest = {}): Observable<ClearpipeAdapterOutcome<ClearpipeListState>> {
    return this.withLoading(this.api.listDefinitions(request).pipe(
      map(response => ({
        status: 'ready' as const,
        data: this.listState(response),
      })),
      catchError(error => of(this.normalizeError<ClearpipeListState>(error, 'list')))
    ));
  }

  load(task: string): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    return this.withLoading(this.api.loadDefinition(task).pipe(
      map(response => this.definitionOutcome(response)),
      catchError(error => of(this.normalizeError<ClearpipeDefinitionState>(error, 'load')))
    ));
  }

  create(request: ClearpipeCreateRequest): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    return this.definitionMutation(() => this.api.createDefinition(request), request.graph);
  }

  update(request: ClearpipeUpdateRequest): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    return this.definitionMutation(() => this.api.updateDefinition(request), request.graph);
  }

  validate(request: ClearpipeValidateRequest): Observable<ClearpipeAdapterOutcome<ClearpipeValidationResponse>> {
    const graph = 'graph' in request ? request.graph : undefined;
    const unsupported = graph && this.unsupportedGraphProblem(graph);
    if (unsupported) return this.withLoading(of({status: 'unsupported_representation', problem: unsupported}));

    return this.withLoading(this.api.validateDefinition(request).pipe(
      map(response => this.executionUnavailableProblem(response.issues)
        ? {
          status: 'execution_unavailable' as const,
          data: response,
          problem: this.executionUnavailableProblem(response.issues)!,
        }
        : response.valid
        ? {status: 'ready' as const, data: response}
        : {
          status: 'validation_failed' as const,
          data: response,
          problem: {
            code: 'ValidationError',
            message: 'ClearPipe validation found issues that must be resolved before submission.',
            retryable: false,
            issues: response.issues,
          },
        }),
      catchError(error => of(this.normalizeError<ClearpipeValidationResponse>(error, 'validate')))
    ));
  }

  submit(request: ClearpipeStartRequest, state?: ClearpipeDefinitionState): Observable<ClearpipeAdapterOutcome<ClearpipeStartResponse>> {
    if (state && state.representation !== 'clearpipe_graph_v2') {
      return this.withLoading(of({
        status: 'unsupported_representation',
        problem: {
          message: 'This ClearPipe definition is read-only and cannot be submitted.',
          retryable: false,
        },
      }));
    }
    if (state && (!state.capabilities.compilation || !state.capabilities.execution || !state.capabilities.run)) {
      return this.withLoading(of({
        status: 'execution_unavailable',
        problem: {
          code: 'compilation_unavailable',
          message: 'ClearPipe graph v2 execution is unavailable until a compatible compiler is registered.',
          retryable: false,
        },
      }));
    }

    return this.withLoading(this.api.startDefinition(request).pipe(
      map(response => response.enqueued
        ? response.queue_watched === false
          ? {
            status: 'submission_succeeded_unwatched' as const,
            data: response,
            problem: {
              message: 'The ClearPipe run was submitted, but no worker was observed for its queue.',
              retryable: false,
            },
          }
          : {status: 'ready' as const, data: response}
        : {
          status: 'failed' as const,
          data: response,
          problem: {
            message: 'ClearPipe did not confirm that the run was submitted.',
            retryable: true,
          },
        }),
      catchError(error => of(this.normalizeError<ClearpipeStartResponse>(error, 'submit')))
    ));
  }

  archive(task: string, revision?: number): Observable<ClearpipeAdapterOutcome<ClearpipeArchiveResponse>> {
    return this.withLoading(this.api.archiveDefinition(task, revision).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<ClearpipeArchiveResponse>(error, 'archive')))
    ));
  }

  delete(task: string, revision?: number, force = false): Observable<ClearpipeAdapterOutcome<{deleted: boolean}>> {
    return this.withLoading(this.api.deleteDefinition(task, revision, force).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<{deleted: boolean}>(error, 'delete')))
    ));
  }

  parseScript(script: string, filename?: string): Observable<ClearpipeAdapterOutcome<ClearpipeParseScriptResponse>> {
    return this.withLoading(this.api.parseScriptDefinition(script, filename).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<ClearpipeParseScriptResponse>(error, 'parse-script')))
    ));
  }

  /**
   * Retrieves a server-authorized base-task descriptor. Its explicit data
   * status differentiates a stale descriptor from missing or denied access;
   * transport errors still use the shared adapter normalization below.
   */
  taskDescriptor(task: string, knownUpdatedAt?: string): Observable<ClearpipeAdapterOutcome<ClearpipeTaskDescriptorResponse>> {
    return this.withLoading(this.api.taskDescriptor(task, knownUpdatedAt).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<ClearpipeTaskDescriptorResponse>(error, 'task-descriptor')))
    ));
  }

  taskInventory(request: ClearpipeTaskInventoryRequest = {}): Observable<ClearpipeAdapterOutcome<ClearpipeTaskInventoryResponse>> {
    return this.withLoading(this.api.taskInventory(request).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<ClearpipeTaskInventoryResponse>(error, 'task-inventory')))
    ));
  }

  executionSnapshot(request: ClearpipeExecutionSnapshotRequest): Observable<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>> {
    return this.withLoading(this.snapshotRequest(request));
  }

  /**
   * A cold stream with no root-scoped polling state. Consumers own the
   * subscription and must unsubscribe on teardown; doing so cancels timer and
   * in-flight HTTP work through RxJS.
   */
  pollExecutionSnapshot(
    request: ClearpipeExecutionSnapshotRequest,
    intervalMs = 5000
  ): Observable<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>> {
    const interval = Math.min(60000, Math.max(1000, Math.floor(intervalMs)));
    return concat(
      of({status: 'loading'} as const),
      timer(0, interval).pipe(switchMap(() => this.snapshotRequest(request)))
    );
  }

  resources(type: ClearpipeResourceOption['type']): Observable<ClearpipeAdapterOutcome<ClearpipeResourceOption[]>> {
    if (type === 'endpoint' || type === 'storage') {
      return this.withLoading(of({
        status: 'resource_unavailable',
        problem: {
          message: `${type} resources are not supported by the ClearPipe validator.`,
          retryable: false,
        },
      }));
    }
    return this.withLoading(this.api.getResources(type).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<ClearpipeResourceOption[]>(error, 'resource')))
    ));
  }

  routeFor(target: ClearpipeNavigationTarget): string[] | null {
    switch (target.kind) {
      case 'clearpipe-library':
        return ['/clearpipe'];
      case 'clearpipe-new':
        return ['/clearpipe', 'new'];
      case 'clearpipe-definition':
        return ['/clearpipe', target.taskId, 'edit'];
      case 'definition-task-details':
        return ['/projects', '*', 'tasks', target.taskId];
      case 'pipeline-details':
        return ['/pipelines', '*', 'tasks', target.runTaskId];
      case 'resource-details':
        return this.resourceRoute(target.resourceType, target.resourceId);
    }
  }

  parseRoute(url: string): ClearpipeNavigationTarget | null {
    const segments = url.split(/[?#]/, 1)[0].split('/').filter(Boolean);
    if (segments[0] === 'clearpipe') {
      if (segments.length === 1) return {kind: 'clearpipe-library'};
      if (segments[1] === 'new' && segments.length === 2) return {kind: 'clearpipe-new'};
      if (segments.length === 2 || (segments.length === 3 && segments[2] === 'edit')) {
        return {kind: 'clearpipe-definition', taskId: segments[1]};
      }
    }
    if (segments[0] === 'pipelines' && segments[1] === 'clearpipe') {
      if (segments.length === 2) return {kind: 'clearpipe-library'};
      if (segments[2] === 'new' && segments.length === 3) return {kind: 'clearpipe-new'};
      if (segments.length === 4 && segments[3] === 'edit') {
        return {kind: 'clearpipe-definition', taskId: segments[2]};
      }
    }
    if (segments[0] === 'pipelines' && segments[1] === '*' && segments[2] === 'tasks' && segments[3]) {
      return {kind: 'pipeline-details', runTaskId: segments[3]};
    }
    if (segments[0] === 'projects' && segments[1] === '*' && segments[2] === 'tasks' && segments[3]) {
      return {kind: 'definition-task-details', taskId: segments[3]};
    }
    return null;
  }

  navigate(target: ClearpipeNavigationTarget): Promise<boolean> {
    const route = this.routeFor(target);
    if (!route) return Promise.resolve(false);
    if (isClearpipeNavigation(target) && !this.authentication().featureEnabled) {
      return this.router.navigateByUrl('/404');
    }
    if (isClearpipeNavigation(target) && !this.authentication().authenticated) {
      return this.router.navigate(['/login'], {queryParams: {redirect: route.join('/')}});
    }
    return this.router.navigate(route);
  }

  private definitionMutation(
    operation: () => Observable<ClearpipeDefinitionResponse>,
    graph: GraphV2
  ): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    const unsupported = this.unsupportedGraphProblem(graph);
    if (unsupported) return this.withLoading(of({status: 'unsupported_representation', problem: unsupported}));
    return this.withLoading(operation().pipe(
      map(response => this.definitionOutcome(response)),
      catchError(error => of(this.normalizeError<ClearpipeDefinitionState>(error, 'save')))
    ));
  }

  private listState(response: ClearpipeListResponse): ClearpipeListState {
    return {
      definitions: response.definitions.map(definition => this.definitionState(definition)),
      total: response.total,
    };
  }

  private definitionOutcome(
    response: ClearpipeDefinitionResponse
  ): Exclude<ClearpipeAdapterOutcome<ClearpipeDefinitionState>, {status: 'loading'}> {
    const state = this.definitionState(response);
    const unsupported = this.unsupportedDefinitionProblem(response, state);
    return unsupported
      ? {status: 'unsupported_representation', data: state, problem: unsupported}
      : {status: 'ready', data: state};
  }

  private definitionState(response: ClearpipeDefinitionResponse): ClearpipeDefinitionState {
    const decoded = decodeGraphV2(response.graph);
    const representation = response.representation
      ?? (decoded.status === 'ok' ? 'clearpipe_graph_v2' : 'unsupported_clearpipe_graph');
    const supported = representation === 'clearpipe_graph_v2' && decoded.status === 'ok';
    const capabilities = {...emptyCapabilities(), ...response.capabilities};
    if (!supported) {
      Object.assign(capabilities, {
        edit: false,
        save_as: false,
        version: false,
        run: false,
        import: false,
        export: false,
        archive: false,
        delete: false,
      });
    }
    return {
      definition: response.definition,
      graph: decoded.status === 'ok' ? decoded.graph : undefined,
      representation,
      capabilities,
    };
  }

  private unsupportedDefinitionProblem(
    response: ClearpipeDefinitionResponse,
    state: ClearpipeDefinitionState
  ): ClearpipeAdapterProblem | undefined {
    if (state.representation !== 'clearpipe_graph_v2') {
      return {
        code: state.representation,
        message: 'This ClearPipe representation is read-only. Open its existing task or pipeline details instead.',
        retryable: false,
      };
    }
    return this.unsupportedGraphProblem(response.graph);
  }

  private unsupportedGraphProblem(graph: unknown): ClearpipeAdapterProblem | undefined {
    const decoded = decodeGraphV2(graph);
    if (decoded.status === 'ok') return undefined;
    return {
      code: decoded.status === 'unsupported' ? decoded.unsupported.reason : decoded.errors[0]?.code,
      message: 'This ClearPipe graph cannot be edited, validated, or run safely in this client.',
      retryable: false,
    };
  }

  private resourceRoute(type: ClearpipeResourceOption['type'], id: string): string[] | null {
    switch (type) {
      case 'dataset':
        return ['/datasets', 'simple', '*', 'tasks', id];
      case 'task':
        return ['/projects', '*', 'tasks', id];
      case 'model':
        return ['/projects', '*', 'models', id];
      case 'queue':
        return ['/workers-and-queues'];
      case 'report':
        return ['/reports', id];
      case 'project':
        return ['/projects', id];
      default:
        return null;
    }
  }

  private withLoading<T>(operation: Observable<Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'}>>): Observable<ClearpipeAdapterOutcome<T>> {
    return concat(of({status: 'loading'} as const), operation);
  }

  private snapshotRequest(
    request: ClearpipeExecutionSnapshotRequest
  ): Observable<Exclude<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>, {status: 'loading'}>> {
    return this.api.executionSnapshot(request).pipe(
      map(data => ({status: 'ready' as const, data})),
      catchError(error => of(this.normalizeError<ClearpipeExecutionSnapshotResponse>(error, 'execution-snapshot')))
    );
  }

  private normalizeError<T>(error: unknown, operation: string): Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'} | {status: 'ready'; data: T}> {
    const response = error as HttpErrorResponse;
    const body = response?.error as Record<string, unknown> | undefined;
    const code = String(body?.['code'] ?? body?.['type'] ?? body?.['error'] ?? '');
    const status = response?.status;
    const issues = this.safeIssues(body?.['issues'] ?? (body?.['data'] as Record<string, unknown> | undefined)?.['issues']);

    if (status === 409 || /RevisionConflict/i.test(code)) {
      return {
        status: 'stale_revision',
        problem: {
          code: 'RevisionConflict',
          message: 'This ClearPipe definition changed on the server. Reload it or save your local work as a new definition.',
          retryable: false,
        },
      };
    }
    if (status === 401 || status === 403 || status === 404 || /InvalidTaskId|Permission|AccessDenied/i.test(code)) {
      return {
        status: 'denied_or_missing',
        problem: {
          code: 'denied_or_missing',
          message: 'This ClearPipe definition is unavailable or you no longer have access to it.',
          retryable: false,
        },
      };
    }
    const executionUnavailable = this.executionUnavailableProblem(issues, code);
    if (executionUnavailable) {
      return {status: 'execution_unavailable', problem: executionUnavailable};
    }
    if (operation === 'resource' || /Resource|Queue|Unavailable/i.test(code) || issues.some(issue => /resource|queue|unavailable/i.test(issue.code ?? ''))) {
      return {
        status: 'resource_unavailable',
        problem: {
          code: code || 'resource_unavailable',
          message: 'A required ClearML resource is unavailable or cannot be accessed.',
          retryable: true,
          issues,
        },
      };
    }
    if (/ValidationError/i.test(code) || issues.length) {
      return {
        status: 'validation_failed',
        problem: {
          code: code || 'ValidationError',
          message: 'ClearPipe validation failed. Review the reported diagnostics before trying again.',
          retryable: false,
          issues,
        },
      };
    }
    return {
      status: 'failed',
      problem: {
        code: code || undefined,
        message: 'The ClearPipe request could not be completed. Retry the request when the service is available.',
        retryable: true,
      },
    };
  }

  private safeIssues(value: unknown): ClearpipeValidationIssue[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(issue => {
      if (!issue || typeof issue !== 'object') return [];
      const record = issue as Record<string, unknown>;
      return typeof record['message'] === 'string'
        ? [{
          code: typeof record['code'] === 'string' ? record['code'] : undefined,
          message: this.safeDiagnosticMessage(record['message'], record['code']),
          node_id: typeof record['node_id'] === 'string' ? record['node_id'] : undefined,
          severity: record['severity'] === 'warning' ? 'warning' : 'error',
        }]
        : [];
    });
  }

  private safeDiagnosticMessage(message: string, code: unknown): string {
    if (code === 'embedded_secret'
      || /\b(password|passwd|secret|token|api[_ -]?key|access[_ -]?key|credential|private key|bearer)\b/i.test(message)) {
      return 'Credentials and secrets are not accepted in ClearPipe input.';
    }
    return message;
  }

  private executionUnavailableProblem(
    issues: ClearpipeValidationIssue[],
    code = ''
  ): ClearpipeAdapterProblem | undefined {
    if (!/compilation_unavailable|execution_unavailable/i.test(code)
      && !issues.some(issue => /compilation_unavailable|execution_unavailable/i.test(issue.code ?? ''))) {
      return undefined;
    }
    return {
      code: 'compilation_unavailable',
      message: 'ClearPipe graph v2 execution is unavailable until a compatible compiler is registered.',
      retryable: false,
      issues,
    };
  }
}
