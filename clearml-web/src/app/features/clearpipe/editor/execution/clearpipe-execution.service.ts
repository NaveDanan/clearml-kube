import {computed, DestroyRef, effect, inject, Injectable, signal} from '@angular/core';
import {firstValueFrom, Observable, of, Subject, Subscription, timer} from 'rxjs';
import {defaultIfEmpty, exhaustMap, expand, filter, take, takeUntil} from 'rxjs/operators';
import {
  ClearpipeExecutionSnapshot,
  ClearpipeExecutionSnapshotRequest,
  ClearpipeExecutionSnapshotResponse,
  ClearpipeValidationResponse,
} from '../../clearpipe-api.service';
import {
  ClearpipeAdapterOutcome,
  ClearpipeAdapterService,
} from '../../platform/clearpipe-adapter.service';
import {ClearpipeLifecycleService} from '../clearpipe-lifecycle.service';
import {
  ClearpipeExecutionAction,
  ClearpipeExecutionPreflight,
  ClearpipeExecutionPreflightReason,
  ClearpipeExecutionPresentation,
  ClearpipeExecutionRunState,
  ClearpipeExecutionTracking,
  ClearpipeNodeExecution,
} from './clearpipe-execution.models';
import {
  controllerFrom,
  mergeNodeExecution,
  nodeExecutionFrom,
  nodeStatusPresentation,
  runtimeEvidenceFrom,
  snapshotMatchesScope,
} from './clearpipe-execution-status-map';
import {ClearpipeStatusPresentation} from '../framework/clearpipe-ui.types';

const POLL_INTERVAL_MS = 5000;
const SNAPSHOT_PAGE_SIZE = 100;
const terminalControllerStatuses = new Set(['completed', 'failed', 'stopped', 'aborted', 'closed', 'published']);

const idlePreflight = (): ClearpipeExecutionPreflight => ({
  scopeKey: null,
  state: 'idle',
  reasons: [{code: 'not_checked', message: 'Run checks have not completed yet.'}],
  evidence: null,
});

const idleRun = (): ClearpipeExecutionRunState => ({state: 'idle', runTaskId: null, message: null});

const idleTracking = (): ClearpipeExecutionTracking => ({
  state: 'idle',
  message: null,
  controller: null,
  receivedNodes: 0,
  totalNodes: null,
});

/**
 * Editor-scoped coordination around the CP-14 adapter. It owns request and
 * presentation state only; it never executes generated source or persists a
 * browser-side run.
 */
@Injectable()
export class ClearpipeExecutionService {
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly lifecycle = inject(ClearpipeLifecycleService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly scopeCancelled = new Subject<void>();
  private readonly preflightCancelled = new Subject<void>();
  private pollSubscription: Subscription | null = null;
  private activeScopeKey: string | null = null;
  private preflightRequest = 0;
  private snapshotRanges = new Map<number, number>();
  private nodeRecords = new Map<string, ClearpipeNodeExecution>();
  private readonly routeContext = signal<{taskId: string | null; ready: boolean}>({taskId: null, ready: false});

  readonly preflight = signal<ClearpipeExecutionPreflight>(idlePreflight());
  readonly run = signal<ClearpipeExecutionRunState>(idleRun());
  readonly tracking = signal<ClearpipeExecutionTracking>(idleTracking());
  readonly nodes = signal<readonly ClearpipeNodeExecution[]>([]);
  readonly presentation = computed<ClearpipeExecutionPresentation>(() => ({
    preflight: this.preflight(),
    run: this.run(),
    tracking: this.tracking(),
    nodes: this.nodes(),
  }));
  readonly canRun = computed(() => {
    const preflight = this.preflight();
    return preflight.state === 'ready'
      && preflight.scopeKey === this.scopeKey()
      && !this.localReasons().length
      && !['submitting', 'reconciling'].includes(this.run().state);
  });
  readonly toolbarAction = computed<ClearpipeExecutionAction>(() => ({
    disabled: !this.canRun(),
    disabledReason: this.canRun()
      ? null
      : this.localReasons()[0]?.message
        ?? this.preflight().reasons[0]?.message
        ?? 'Run is unavailable.',
  }));

  constructor() {
    this.resetForScope(this.scopeKey());
    effect(() => {
      const scopeKey = this.scopeKey();
      if (scopeKey !== this.activeScopeKey) this.resetForScope(scopeKey);
    });
    this.destroyRef.onDestroy(() => this.cancelScope());
  }

  reset(): void {
    this.resetForScope(this.scopeKey());
  }

  /**
   * The editor declares a route runnable only after its load has completed for
   * that exact definition. This prevents a failed or superseded load from
   * borrowing a prior definition's lifecycle identity.
   */
  setRouteContext(taskId: string | null, ready: boolean): void {
    const next = {taskId, ready};
    const current = this.routeContext();
    if (current.taskId === next.taskId && current.ready === next.ready) return;
    this.routeContext.set(next);
    this.resetForScope(this.scopeKey());
  }

  readonly routeReady = computed(() => {
    const route = this.routeContext();
    const identity = this.lifecycle.identity();
    return route.ready && (!route.taskId || route.taskId === identity?.taskId);
  });

  async refresh(): Promise<void> {
    const scopeKey = this.scopeKey();
    if (scopeKey !== this.activeScopeKey) this.resetForScope(scopeKey);
    const request = ++this.preflightRequest;
    this.preflightCancelled.next();
    const localReasons = this.localReasons();
    if (localReasons.length) {
      this.setPreflight(scopeKey, request, {scopeKey, state: 'blocked', reasons: localReasons, evidence: null});
      return;
    }

    const identity = this.lifecycle.identity();
    const graph = this.lifecycle.graph();
    if (!identity || !graph) return;
    this.setPreflight(scopeKey, request, {scopeKey, state: 'checking', reasons: [], evidence: null});
    const outcome = await this.finalOutcome(
      this.adapter.validate({task: identity.taskId}),
      this.preflightCancelled,
    );
    if (!outcome || !this.current(scopeKey, request)) return;

    if (outcome.status !== 'ready') {
      this.setPreflight(scopeKey, request, {
        scopeKey,
        state: 'blocked',
        reasons: this.outcomeReasons(outcome),
        evidence: null,
      });
      return;
    }

    const diagnosticReasons = this.diagnosticReasons(outcome.data.issues);
    const evidence = runtimeEvidenceFrom(outcome.data.pipeline, graph.nodes.map(node => node.id));
    const reasons = [
      ...diagnosticReasons,
      ...(!evidence ? [{
        code: outcome.data.pipeline ? 'runtime_mapping_unavailable' as const : 'generated_output_unavailable' as const,
        message: outcome.data.pipeline
          ? 'Run requires the server compiler runtime map for every stable graph node.'
          : 'Run requires approved generated output from ClearPipe validation.',
      }] : []),
    ];
    this.setPreflight(scopeKey, request, {
      scopeKey,
      state: reasons.length ? 'blocked' : 'ready',
      reasons,
      evidence: reasons.length ? null : evidence,
    });
  }

  async submit(): Promise<void> {
    if (this.run().state === 'submitting' || this.run().state === 'reconciling') return;
    if (!this.canRun()) {
      await this.refresh();
      if (!this.canRun()) return;
    }

    const scopeKey = this.scopeKey();
    const identity = this.lifecycle.identity();
    if (!identity) return;
    this.stopPolling();
    this.nodeRecords.clear();
    this.nodes.set([]);
    this.tracking.set(idleTracking());
    const idempotencyKey = this.newIdempotencyKey();
    this.run.set({state: 'submitting', runTaskId: null, message: null, idempotencyKey});
    const outcome = await this.finalOutcome(
      this.adapter.submit({
        task: identity.taskId,
        revision: identity.revision,
        verify_watched_queue: true,
      }),
      this.scopeCancelled,
    );
    if (!outcome || !this.current(scopeKey)) return;

    if ((outcome.status === 'ready' || outcome.status === 'submission_succeeded_unwatched') && outcome.data.run_task_id) {
      const runTaskId = this.safeNavigationId(outcome.data.run_task_id);
      if (!runTaskId) {
        this.run.set({
          state: 'failed',
          runTaskId: null,
          message: 'Run submission was not confirmed with a safe pipeline run ID.',
          reason: 'request_failed',
        });
        return;
      }
      this.run.set({
        state: outcome.status === 'ready' ? 'submitted' : 'submitted_unwatched',
        runTaskId,
        message: outcome.status === 'submission_succeeded_unwatched' ? outcome.problem.message : null,
      });
      const evidence = this.preflight().evidence;
      if (evidence) this.startPolling(scopeKey, runTaskId, identity.taskId, identity.revision, evidence.graphDigest);
      return;
    }

    if (outcome.status === 'failed') {
      this.run.set({
        state: 'reconciling',
        runTaskId: null,
        message: 'The submission outcome is uncertain. Reconciliation is required before another run can be submitted.',
        reason: 'request_failed',
        idempotencyKey,
      });
      return;
    }

    const failure = outcome.status === 'ready'
      ? {code: 'request_failed' as const, message: 'Run submission was not confirmed with a pipeline run ID.'}
      : this.outcomeReasons(outcome)[0] ?? {code: 'request_failed' as const, message: 'Run submission was not confirmed.'};
    this.run.set({state: 'failed', runTaskId: null, message: failure.message, reason: failure.code});
  }

  openPipelineRun(): Promise<boolean> {
    const runTaskId = this.run().runTaskId;
    return runTaskId && this.safeNavigationId(runTaskId)
      ? this.adapter.navigate({kind: 'pipeline-details', runTaskId})
      : Promise.resolve(false);
  }

  openTask(taskId: string): Promise<boolean> {
    return this.safeNavigationId(taskId)
      ? this.adapter.navigate({kind: 'pipeline-details', runTaskId: taskId})
      : Promise.resolve(false);
  }

  openResource(type: 'dataset' | 'model', resourceId: string): Promise<boolean> {
    return this.safeNavigationId(resourceId)
      ? this.adapter.navigate({kind: 'resource-details', resourceType: type, resourceId})
      : Promise.resolve(false);
  }

  nodeStatuses(nodeId: string): readonly ClearpipeStatusPresentation[] {
    return nodeStatusPresentation(this.nodes().find(node => node.graphNodeId === nodeId));
  }

  private startPolling(
    scopeKey: string,
    runTaskId: string,
    definitionTaskId: string,
    revision: number,
    graphDigest: string,
  ): void {
    this.stopPolling();
    const request: ClearpipeExecutionSnapshotRequest = {
      run: runTaskId,
      definition_revision: revision,
      graph_digest: graphDigest,
      node_offset: 0,
      node_limit: SNAPSHOT_PAGE_SIZE,
    };
    this.tracking.set({...idleTracking(), state: 'polling', message: 'Retrieving authorized runtime records.'});
    this.pollSubscription = timer(0, POLL_INTERVAL_MS).pipe(
      exhaustMap(() => this.snapshotPages(request)),
      takeUntil(this.scopeCancelled),
    ).subscribe(outcome => this.consumeSnapshotOutcome(
      scopeKey,
      runTaskId,
      definitionTaskId,
      revision,
      graphDigest,
      outcome,
    ));
  }

  private snapshotPages(
    request: ClearpipeExecutionSnapshotRequest,
  ): Observable<Exclude<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>, {status: 'loading'}>> {
    return this.snapshotOutcome(request).pipe(
      expand(outcome => {
        if (outcome.status !== 'ready' || outcome.data.status !== 'available' || !outcome.data.snapshot) return of();
        const snapshot = outcome.data.snapshot;
        if (!snapshot.truncated || snapshot.next_node_offset === undefined || snapshot.next_node_offset <= snapshot.node_offset) return of();
        return this.snapshotOutcome({
          ...request,
          node_offset: snapshot.next_node_offset,
          node_limit: SNAPSHOT_PAGE_SIZE,
        });
      }),
    );
  }

  private snapshotOutcome(
    request: ClearpipeExecutionSnapshotRequest,
  ): Observable<Exclude<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>, {status: 'loading'}>> {
    return this.adapter.executionSnapshot(request).pipe(
      filter((outcome): outcome is Exclude<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>, {status: 'loading'}> =>
        outcome.status !== 'loading'),
      take(1),
    );
  }

  private consumeSnapshotOutcome(
    scopeKey: string,
    runTaskId: string,
    definitionTaskId: string,
    revision: number,
    graphDigest: string,
    outcome: Exclude<ClearpipeAdapterOutcome<ClearpipeExecutionSnapshotResponse>, {status: 'loading'}>,
  ): void {
    if (!this.current(scopeKey) || this.run().runTaskId !== runTaskId) return;
    if (outcome.status !== 'ready') {
      const reason = this.outcomeReasons(outcome)[0];
      const state = outcome.status === 'denied_or_missing' ? 'denied'
        : outcome.status === 'execution_unavailable' ? 'unavailable'
          : outcome.status === 'stale_revision' ? 'stale'
            : 'failed';
      this.tracking.set({...this.tracking(), state, message: reason?.message ?? 'Live execution data is unavailable.'});
      if (state === 'denied' || state === 'unavailable' || state === 'stale') this.stopPolling();
      return;
    }

    const response = outcome.data;
    if (response.status === 'unavailable' || !response.snapshot) {
      this.tracking.set({...this.tracking(), state: 'unavailable', message: 'Live execution data is unavailable or no longer authorized.'});
      this.stopPolling();
      return;
    }
    if (response.status === 'stale' || !snapshotMatchesScope(
      response.snapshot,
      runTaskId,
      definitionTaskId,
      revision,
      graphDigest,
    )) {
      this.tracking.set({...this.tracking(), state: 'stale', message: 'Live execution data belongs to a different saved definition revision and was not applied.'});
      this.stopPolling();
      return;
    }

    if (this.consumeSnapshot(response.snapshot)) {
      this.tracking.update(tracking => ({...tracking, state: 'completed'}));
      this.stopPolling();
    }
  }

  private consumeSnapshot(snapshot: ClearpipeExecutionSnapshot): boolean {
    const evidence = this.preflight().evidence;
    if (!evidence) return false;
    if (snapshot.node_offset === 0) this.snapshotRanges.clear();
    const pageEnd = snapshot.truncated
      ? snapshot.next_node_offset
      : snapshot.node_offset + snapshot.nodes.length;
    if (pageEnd === undefined || pageEnd < snapshot.node_offset || pageEnd > snapshot.total_nodes) {
      this.tracking.set({...this.tracking(), state: 'partial', message: 'Live execution data has an incomplete page boundary.'});
      return false;
    }
    this.snapshotRanges.set(snapshot.node_offset, pageEnd);

    let unmatched = false;
    snapshot.nodes.forEach(record => {
      const mapped = nodeExecutionFrom(record, evidence);
      if (!mapped) {
        unmatched = true;
        return;
      }
      this.nodeRecords.set(mapped.graphNodeId, mergeNodeExecution(this.nodeRecords.get(mapped.graphNodeId), mapped));
    });
    this.nodes.set([...this.nodeRecords.values()].sort((left, right) => left.graphNodeId.localeCompare(right.graphNodeId)));

    const complete = this.pagesCoverSnapshot(snapshot.total_nodes);
    this.tracking.set({
      state: complete && !unmatched ? 'polling' : 'partial',
      message: unmatched
        ? 'Some runtime records did not match the server compiler mapping and were not applied.'
        : complete
          ? null
          : 'Live execution data is loading in authorized pages; unmapped nodes have no inferred state.',
      controller: controllerFrom(snapshot),
      receivedNodes: [...this.snapshotRanges.entries()].reduce((sum, [offset, end]) => sum + end - offset, 0),
      totalNodes: snapshot.total_nodes,
    });
    return complete && !unmatched && terminalControllerStatuses.has(snapshot.controller.status.toLowerCase());
  }

  private pagesCoverSnapshot(totalNodes: number): boolean {
    let cursor = 0;
    for (const [offset, end] of [...this.snapshotRanges.entries()].sort(([left], [right]) => left - right)) {
      if (offset !== cursor || end < offset) return false;
      cursor = end;
    }
    return cursor === totalNodes;
  }

  private localReasons(): ClearpipeExecutionPreflightReason[] {
    const graph = this.lifecycle.graph();
    const identity = this.lifecycle.identity();
    const capabilities = this.lifecycle.capabilities();
    const reasons: ClearpipeExecutionPreflightReason[] = [];
    const route = this.routeContext();
    if (!route.ready) {
      reasons.push({code: 'route_not_ready', message: 'Wait for this ClearPipe definition to finish loading before running it.'});
    } else if (route.taskId && route.taskId !== identity?.taskId) {
      reasons.push({code: 'route_identity_mismatch', message: 'This route no longer matches the loaded ClearPipe definition. Reload it before running.'});
    } else if (route.taskId && !['ready', 'saved'].includes(this.lifecycle.status())) {
      reasons.push({code: 'route_not_ready', message: 'This ClearPipe definition did not load successfully. Retry the requested definition before running.'});
    }
    if (!graph) reasons.push({code: 'no_graph', message: 'There is no supported ClearPipe graph to run.'});
    else if (!graph.nodes.length) reasons.push({code: 'empty_graph', message: 'Add at least one validated ClearPipe node before running.'});
    if (this.lifecycle.readOnly()) reasons.push({code: 'read_only', message: 'This read-only ClearPipe definition cannot be run.'});
    if (this.lifecycle.busy()) reasons.push({code: 'lifecycle_busy', message: 'Wait for the current ClearPipe save or load operation to finish.'});
    if (this.lifecycle.dirty()) reasons.push({code: 'dirty_definition', message: 'Save the latest ClearPipe graph before running it.'});
    if (!identity) reasons.push({code: 'unsaved_definition', message: 'Save this ClearPipe graph before running it.'});
    else if (!Number.isInteger(identity.revision) || identity.revision < 0) {
      reasons.push({code: 'stale_definition', message: 'Reload this ClearPipe definition to obtain a valid saved revision before running.'});
    }
    if (this.lifecycle.status() === 'conflict') {
      reasons.push({code: 'stale_definition', message: 'Reload the changed ClearPipe definition before running it.'});
    }
    if (identity && !capabilities) {
      reasons.push({code: 'execution_unavailable', message: 'Execution eligibility is unavailable. Reload the ClearPipe definition before running.'});
    }
    if (capabilities && (!capabilities.compilation || !capabilities.execution)) {
      reasons.push({
        code: 'execution_unavailable',
        message: 'ClearPipe execution is unavailable. An administrator must configure a compatible compiler and dedicated provenance-signing keys before running v2 definitions.',
      });
    } else if (capabilities && !capabilities.run) {
      reasons.push({code: 'permission_denied', message: 'You do not have permission to run this ClearPipe definition.'});
    }
    return reasons;
  }

  private diagnosticReasons(issues: ClearpipeValidationResponse['issues']): ClearpipeExecutionPreflightReason[] {
    return issues.flatMap<ClearpipeExecutionPreflightReason>(issue => {
      if (issue.severity === 'warning' && !/^CPRES00[3456]$/i.test(issue.code ?? '')) return [];
      if (issue.code === 'CPSEM008') return [{code: 'queue_unavailable', message: issue.message}];
      if (/^CPRES/i.test(issue.code ?? '')) return [{code: 'resource_unavailable', message: issue.message}];
      if (issue.severity !== 'warning') return [{code: 'validation_failed', message: issue.message}];
      return [];
    });
  }

  private outcomeReasons(
    outcome: Exclude<ClearpipeAdapterOutcome<unknown>, {status: 'loading'}>,
  ): ClearpipeExecutionPreflightReason[] {
    if (outcome.status === 'ready') {
      return [{code: 'request_failed', message: 'The ClearPipe request completed without the required execution data.'}];
    }
    const issues = outcome.problem.issues ?? [];
    const mappedDiagnostics = this.diagnosticReasons(issues);
    if (mappedDiagnostics.length) return mappedDiagnostics;
    switch (outcome.status) {
      case 'denied_or_missing':
        return [{code: 'permission_denied', message: outcome.problem.message}];
      case 'resource_unavailable':
        return [{code: 'resource_unavailable', message: outcome.problem.message}];
      case 'execution_unavailable':
        return [{code: 'execution_unavailable', message: outcome.problem.message}];
      case 'stale_revision':
        return [{code: 'stale_definition', message: outcome.problem.message}];
      case 'validation_failed':
        return [{code: 'validation_failed', message: outcome.problem.message}];
      default:
        return [{code: 'request_failed', message: outcome.problem.message}];
    }
  }

  private async finalOutcome<T>(
    source: Observable<ClearpipeAdapterOutcome<T>>,
    cancelled: Subject<void>,
  ): Promise<Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'}> | null> {
    return firstValueFrom(source.pipe(
      filter((outcome): outcome is Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'}> => outcome.status !== 'loading'),
      take(1),
      takeUntil(cancelled),
      defaultIfEmpty(null),
    ));
  }

  private scopeKey(): string | null {
    const identity = this.lifecycle.identity();
    return identity && Number.isInteger(identity.revision)
      ? `${identity.taskId}@${identity.revision}`
      : null;
  }

  private current(scopeKey: string | null, request?: number): boolean {
    return this.activeScopeKey === scopeKey && (request === undefined || request === this.preflightRequest);
  }

  private setPreflight(
    scopeKey: string | null,
    request: number,
    value: ClearpipeExecutionPreflight,
  ): void {
    if (this.current(scopeKey, request)) this.preflight.set(value);
  }

  private resetForScope(scopeKey: string | null): void {
    this.cancelScope();
    this.activeScopeKey = scopeKey;
    this.preflightRequest++;
    this.preflight.set({...idlePreflight(), scopeKey});
    this.run.set(idleRun());
    this.tracking.set(idleTracking());
    this.nodeRecords.clear();
    this.nodes.set([]);
    this.snapshotRanges.clear();
  }

  private cancelScope(): void {
    this.scopeCancelled.next();
    this.preflightCancelled.next();
    this.stopPolling();
  }

  private stopPolling(): void {
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  private safeNavigationId(value: string): string | null {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) ? value : null;
  }

  private newIdempotencyKey(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `clearpipe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
