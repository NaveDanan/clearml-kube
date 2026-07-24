import {ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, signal, viewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {Store} from '@ngrx/store';
import {filter, finalize, Subscription, switchMap, take, timer} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {addMessage} from '@common/core/actions/layout.actions';

import {ClearpipeApiService} from '../../clearpipe-api.service';
import {ClearpipeAdapterService} from '../../platform/clearpipe-adapter.service';
import {createEmptyGraphV2} from '../../domain/graph-store.service';
import {ClearpipeFlowPaletteComponent} from './clearpipe-flow-palette.component';
import {ClearpipeFlowCanvasComponent} from './clearpipe-flow-canvas.component';
import {ClearpipeFlowConfigPanelComponent} from './clearpipe-flow-config-panel.component';
import {ClearpipeFlowStoreService} from './clearpipe-flow-store.service';
import {ClearpipeFlowResourcesService, FlowResourceOption} from './clearpipe-flow-resources.service';
import {mapSnapshotNodeStatus, TERMINAL_CONTROLLER_STATUSES} from './clearpipe-flow-run-status';
import {flowToGraphNodes, graphV2ToFlow} from './clearpipe-flow-codec';
import {ClearpipeFlowGraph, ClearpipeFlowStatus, emptyClearpipeFlowGraph} from './clearpipe-flow.models';

const RUN_POLL_INTERVAL_MS = 5000;

/**
 * clearpipe-main-style flow editor shell for both /clearpipe/new and existing
 * pipelines (/clearpipe/:taskId). Hosts the drag-only palette, the flow canvas,
 * and the node inspector, and owns the toolbar + shared theme tokens. All graph
 * state lives in ClearpipeFlowStoreService.
 */
@Component({
  selector: 'sm-clearpipe-flow-editor',
  templateUrl: './clearpipe-flow-editor.component.html',
  styleUrls: ['./clearpipe-flow-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ClearpipeFlowStoreService, ClearpipeFlowResourcesService],
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    ClearpipeFlowPaletteComponent,
    ClearpipeFlowCanvasComponent,
    ClearpipeFlowConfigPanelComponent,
  ],
})
export class ClearpipeFlowEditorComponent {
  protected readonly store = inject(ClearpipeFlowStoreService);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly api = inject(ClearpipeApiService);
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly resources = inject(ClearpipeFlowResourcesService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly appStore = inject(Store);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly graph = this.store.graph;
  protected readonly dirty = this.store.dirty;
  protected readonly activated = this.store.activated;
  protected readonly running = this.store.running;
  protected readonly saving = signal(false);
  /** True while an activation toggle or run submission request is in flight. */
  protected readonly busy = signal(false);

  /** Live polling subscription for the current run's execution snapshots. */
  private pollSub: Subscription | null = null;

  /** When editing an existing definition, its task id + last-known revision. */
  protected readonly editingTaskId = signal<string | null>(null);
  protected readonly loadingExisting = signal(false);
  private editingRevision = 0;

  /** Execution queues used to satisfy the compiler's default-queue requirement. */
  private readonly queues = signal<FlowResourceOption[]>([]);

  /** Collapsed state for the left palette and right configuration panels. */
  protected readonly paletteCollapsed = signal(false);
  protected readonly inspectorCollapsed = signal(true);

  constructor() {
    this.resources.listQueues().subscribe(items => this.queues.set(items));

    const taskId = this.route.snapshot.paramMap.get('taskId');
    if (taskId) {
      this.loadExisting(taskId);
    } else if (this.store.isEmpty()) {
      this.store.reset();
    }

    // Mirror the configuration panel to the canvas selection: expand when a node
    // or a boundary is selected, collapse when the selection is cleared.
    effect(() => {
      const nothingSelected =
        this.store.selectedNodeId() === null && this.store.selectedBoundaryId() === null;
      this.inspectorCollapsed.set(nothingSelected);
    });
  }

  /** Load an existing definition and rebuild the visual flow graph from it. */
  private loadExisting(taskId: string): void {
    this.loadingExisting.set(true);
    this.adapter.load(taskId).pipe(
      filter(outcome => outcome.status !== 'loading'),
      take(1),
      finalize(() => this.loadingExisting.set(false)),
    ).subscribe(outcome => {
      const state = outcome.data;
      if (!state?.graph) {
        this.appStore.dispatch(addMessage(
          'error',
          outcome.status === 'ready' ? 'This pipeline has no editable ClearPipe graph.' : (outcome.problem?.message ?? 'Failed to load ClearPipe definition'),
        ));
        void this.router.navigate(['/clearpipe']);
        return;
      }
      const flow = graphV2ToFlow(state.graph);
      flow.name = state.definition.name ?? flow.name;
      this.store.load(flow);
      this.store.markSaved(this.store.graph());
      const definitionId = state.definition.task_id ?? state.definition.id ?? taskId;
      this.editingTaskId.set(definitionId);
      this.editingRevision = state.definition.revision ?? 0;
      // Activation is authoritative from the backend definition.
      this.store.setActivated(state.definition.activated === true);
      // Restore live run state (if a run is in progress) after a refresh.
      this.restoreRun(definitionId);
    });
  }

  /** After loading, resume tracking the definition's most recent run. */
  private restoreRun(definitionId: string): void {
    this.api.latestRun(definitionId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: latest => {
        if (!latest.run) return;
        this.store.runTaskId.set(latest.run);
        if (latest.running) {
          this.store.beginRun(latest.run);
          this.startPolling(latest.run);
        } else {
          // Show the finished run's final node states without tracking as running.
          this.fetchSnapshotOnce(latest.run);
        }
      },
      error: () => undefined,
    });
  }

  protected togglePalette(): void {
    this.paletteCollapsed.update(collapsed => !collapsed);
  }

  protected toggleInspector(): void {
    this.inspectorCollapsed.update(collapsed => !collapsed);
  }

  protected name(): string {
    return this.graph().name;
  }

  protected setName(name: string): void {
    this.store.updateMetadata({name});
  }

  protected newPipeline(): void {
    this.stopPolling();
    this.editingTaskId.set(null);
    this.editingRevision = 0;
    this.store.reset();
    void this.router.navigate(['/clearpipe/new']);
  }

  protected save(afterSave?: () => void): void {
    if (this.saving()) return;
    const flow = this.graph();
    const queueId = this.resolveExecutionQueue(flow);
    if (!queueId) {
      this.appStore.dispatch(addMessage(
        'error',
        'Cannot save: select an execution queue on a node, or create a queue in Workers & Queues first.',
      ));
      return;
    }
    const name = flow.name.trim() || 'Untitled ClearPipe';
    const graph = createEmptyGraphV2({
      name: this.generatedName(name),
      description: flow.description,
    });
    // Every generated step needs a resolvable execution queue; expose the chosen
    // queue as a graph resource and set it as the graph's default (CPSEM008).
    graph.settings = {default_execution_queue_id: 'queue_default'};
    graph.resources = [{
      id: 'queue_default',
      kind: 'queue',
      resource_id: queueId,
      ...(this.queues().find(queue => queue.id === queueId)?.name
        ? {label: this.queues().find(queue => queue.id === queueId)!.name}
        : {}),
    }];
    const {nodes, bindings} = flowToGraphNodes(flow);
    graph.nodes = nodes;
    graph.bindings = bindings;

    const editingTaskId = this.editingTaskId();
    this.saving.set(true);
    const request$ = editingTaskId
      ? this.api.updateDefinition({task: editingTaskId, revision: this.editingRevision, name, description: flow.description, graph})
      : this.api.createDefinition({name, description: flow.description, graph});
    request$.pipe(
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: response => {
        this.store.markSaved(flow);
        this.appStore.dispatch(addMessage('success', 'ClearPipe definition saved'));
        if (editingTaskId) {
          const revision = response?.definition?.revision;
          if (typeof revision === 'number') this.editingRevision = revision;
          afterSave?.();
        } else {
          void this.router.navigate(['/clearpipe']);
        }
      },
      error: () => this.appStore.dispatch(addMessage('error', 'Failed to save ClearPipe definition')),
    });
  }

  private generatedName(name: string): string {
    const normalized = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return /^[A-Za-z]/.test(normalized) ? normalized : `clearpipe_${normalized || 'flow'}`;
  }

  /** Prefer a queue explicitly configured on a node, else the first available queue. */
  private resolveExecutionQueue(flow: ClearpipeFlowGraph): string | undefined {
    const fromNodes = flow.nodes
      .flatMap(node => [node.config['queue'], node.config['createQueue']])
      .find((value): value is string => typeof value === 'string' && value.length > 0);
    return fromNodes ?? this.queues()[0]?.id;
  }

  /** Toggle whether the pipeline is available to run (schedulers fire when on). */
  /** Toggle whether the pipeline is available to run; persisted server-side so
   *  the scheduler and the /clearpipe library see the same state. */
  protected toggleActivated(): void {
    const id = this.editingTaskId();
    if (!id) {
      this.appStore.dispatch(addMessage('info', 'Save the pipeline before activating it.'));
      return;
    }
    if (this.busy()) return;
    const next = !this.activated();
    this.busy.set(true);
    this.api.setActivation(id, next).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: result => {
        this.store.setActivated(result.activated);
        if (!result.activated && this.running()) this.stop();
        this.appStore.dispatch(addMessage('success', result.activated ? 'Pipeline activated' : 'Pipeline deactivated'));
      },
      error: () => this.appStore.dispatch(addMessage('error', 'Failed to update activation state')),
    });
  }

  protected run(): void {
    if (this.running()) {
      this.stop();
      return;
    }
    const id = this.editingTaskId();
    if (!id) {
      this.appStore.dispatch(addMessage('info', 'Save the pipeline before running it.'));
      return;
    }
    if (!this.activated()) {
      this.appStore.dispatch(addMessage('info', 'Activate the pipeline to run it.'));
      return;
    }
    // A run needs the latest saved revision; persist first when there are edits.
    if (this.dirty()) {
      this.save(() => this.startRun(id));
      return;
    }
    this.startRun(id);
  }

  /** Submit a real backend run and begin polling its execution snapshots. */
  private startRun(id: string): void {
    if (this.busy()) return;
    this.busy.set(true);
    this.api.startDefinition({
      task: id,
      revision: this.editingRevision,
      idempotency_key: crypto.randomUUID(),
      verify_watched_queue: true,
    }).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: response => {
        if (!response.run_task_id) {
          this.appStore.dispatch(addMessage('error', 'Pipeline run was not confirmed with a run id.'));
          return;
        }
        this.store.beginRun(response.run_task_id);
        this.appStore.dispatch(addMessage(
          response.queue_watched === false ? 'info' : 'success',
          response.queue_watched === false
            ? 'Pipeline run started, but no worker is watching its queue yet.'
            : 'Pipeline run started',
        ));
        this.startPolling(response.run_task_id);
      },
      error: (err: {error?: {meta?: {result_msg?: string}}}) => this.appStore.dispatch(addMessage(
        'error', err?.error?.meta?.result_msg ?? 'Failed to start pipeline run')),
    });
  }

  protected stop(): void {
    const runId = this.store.runTaskId();
    if (!runId) {
      this.store.markRunStopped();
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    this.api.stopRun(runId).pipe(finalize(() => this.busy.set(false))).subscribe({
      next: () => {
        this.stopPolling();
        this.store.markRunStopped();
        this.appStore.dispatch(addMessage('success', 'Pipeline run stopped'));
      },
      error: () => this.appStore.dispatch(addMessage('error', 'Failed to stop pipeline run')),
    });
  }

  /** Poll the run's execution snapshot and drive the canvas node statuses. */
  private startPolling(runId: string): void {
    this.stopPolling();
    this.pollSub = timer(0, RUN_POLL_INTERVAL_MS).pipe(
      switchMap(() => this.api.executionSnapshot({
        run: runId,
        definition_revision: this.editingRevision,
        node_limit: 200,
      })),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: response => this.consumeSnapshot(runId, response),
      // Transient snapshot failures keep the last known statuses; polling continues.
      error: () => undefined,
    });
  }

  private fetchSnapshotOnce(runId: string): void {
    this.api.executionSnapshot({run: runId, definition_revision: this.editingRevision, node_limit: 200})
      .pipe(take(1), takeUntilDestroyed(this.destroyRef))
      .subscribe(response => this.consumeSnapshot(runId, response, false));
  }

  private consumeSnapshot(
    runId: string,
    response: {status: string; snapshot?: {nodes: {graph_node_id: string}[]; controller?: {status?: string}}},
    track = true,
  ): void {
    if (this.store.runTaskId() !== runId) return;
    const snapshot = response.snapshot;
    if (response.status === 'unavailable' || !snapshot) return;
    const statuses = new Map<string, {status: ClearpipeFlowStatus; message?: string}>();
    for (const node of snapshot.nodes) {
      const mapped = mapSnapshotNodeStatus(node as never);
      if (mapped) statuses.set(node.graph_node_id, mapped);
    }
    if (statuses.size) this.store.applyRunSnapshot(statuses);
    if (!track) return;
    const controllerStatus = (snapshot.controller?.status ?? '').toLowerCase();
    if (TERMINAL_CONTROLLER_STATUSES.has(controllerStatus)) {
      this.stopPolling();
      this.store.finishRun();
      const failed = controllerStatus === 'failed';
      const stopped = controllerStatus === 'stopped' || controllerStatus === 'aborted';
      this.appStore.dispatch(addMessage(
        failed ? 'error' : 'success',
        failed ? 'Pipeline run failed' : stopped ? 'Pipeline run stopped' : 'Pipeline run completed',
      ));
    }
  }

  private stopPolling(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = null;
  }

  protected exportPipeline(): void {
    const blob = new Blob([JSON.stringify(this.graph(), null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.graph().name || 'clearpipe'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected triggerImport(): void {
    this.fileInput().nativeElement.click();
  }

  protected async importPipeline(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ClearpipeFlowGraph>;
      this.store.load({...emptyClearpipeFlowGraph(), ...parsed} as ClearpipeFlowGraph);
    } catch {
      // Ignore malformed files; the current graph is preserved.
    } finally {
      input.value = '';
    }
  }
}
