import {computed, inject, Injectable, signal} from '@angular/core';
import {lastValueFrom, Observable} from 'rxjs';
import {tap} from 'rxjs/operators';
import {ClearpipeCapabilities} from '../clearpipe-api.service';
import {
  ClearpipeAdapterOutcome,
  ClearpipeAdapterProblem,
  ClearpipeAdapterService,
  ClearpipeDefinitionState,
} from '../platform/clearpipe-adapter.service';
import {DocumentMetadata, GraphV2} from '../domain/graph-v2.types';
import {GraphStoreService} from '../domain/graph-store.service';

export type ClearpipeLifecycleStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'saved'
  | 'failed'
  | 'conflict'
  | 'permission-disabled'
  | 'read-only';

export type ClearpipeLifecycleOperation = 'new' | 'open' | 'create' | 'update' | 'save-as' | 'reload' | 'return';

export interface ClearpipeLifecycleIdentity {
  taskId: string;
  revision: number;
  name: string;
}

const immutableCapabilities = (): ClearpipeCapabilities => ({
  view: false,
  edit: false,
  save_as: false,
  version: false,
  run: false,
  compilation: false,
  execution: false,
  import: false,
  export: false,
  source: false,
  archive: false,
  delete: false,
});

const lifecycleProblem = (message: string, retryable = false): ClearpipeAdapterProblem => ({message, retryable});

/**
 * Coordinates persistence side effects around the sole canonical graph store.
 * It deliberately owns identity and request state only; graph edits remain in
 * GraphStoreService and are persisted through ClearpipeAdapterService.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeLifecycleService {
  readonly graphStore = inject(GraphStoreService);
  private readonly adapter = inject(ClearpipeAdapterService);
  readonly identity = signal<ClearpipeLifecycleIdentity | null>(null);
  readonly capabilities = signal<ClearpipeCapabilities | null>(null);
  readonly status = signal<ClearpipeLifecycleStatus>('idle');
  readonly operation = signal<ClearpipeLifecycleOperation | null>(null);
  readonly problem = signal<ClearpipeAdapterProblem | null>(null);

  readonly graph = this.graphStore.graph;
  readonly dirty = this.graphStore.dirty;
  readonly readOnly = computed(() => this.status() === 'read-only' || this.graphStore.readOnly());
  readonly busy = computed(() => this.operation() !== null);
  readonly canSave = computed(() => {
    if (!this.graph() || this.busy() || this.readOnly()) return false;
    const capabilities = this.capabilities();
    return !capabilities || capabilities.edit;
  });
  readonly saveDisabledReason = computed(() => {
    if (this.busy()) return 'A ClearPipe lifecycle operation is already in progress.';
    if (!this.graph()) return 'There is no valid ClearPipe graph to save.';
    if (this.status() === 'read-only') return this.problem()?.message ?? 'This ClearPipe definition is read-only.';
    if (this.capabilities() && !this.capabilities()!.edit) return 'You do not have permission to edit this ClearPipe definition.';
    return null;
  });

  new(document: Partial<DocumentMetadata> = {}): boolean {
    if (!this.availableForNew()) return false;
    const result = this.graphStore.create(document);
    if (!result.ok) {
      this.fail(lifecycleProblem('The new ClearPipe graph is invalid and cannot be initialized.'));
      return false;
    }
    this.identity.set(null);
    this.capabilities.set(null);
    this.graphStore.setEditable(true);
    this.status.set('ready');
    this.operation.set(null);
    this.problem.set(null);
    return true;
  }

  async open(taskId: string): Promise<void> {
    await this.observe('open', this.adapter.load(taskId), outcome => this.applyLoadOutcome(outcome));
  }

  async reload(): Promise<void> {
    const taskId = this.identity()?.taskId;
    if (!taskId) {
      this.fail(lifecycleProblem('This unsaved ClearPipe graph has no server definition to reload.'));
      return;
    }
    await this.observe('reload', this.adapter.load(taskId), outcome => this.applyLoadOutcome(outcome));
  }

  async save(): Promise<void> {
    const graph = this.graphForMutation();
    if (!graph) return;
    const identity = this.identity();
    if (!identity) {
      await this.create('create', graph);
      return;
    }
    if (!this.capability('edit', 'You do not have permission to update this ClearPipe definition.')) return;
    await this.observe('update', this.adapter.update({
      task: identity.taskId,
      revision: identity.revision,
      ...this.requestMetadata(graph),
      graph,
    }), outcome => this.applyMutationOutcome(outcome));
  }

  async saveAs(name: string): Promise<void> {
    const graph = this.graphForMutation();
    if (!graph) return;
    if (!name.trim()) {
      this.fail(lifecycleProblem('A name is required to create a new ClearPipe definition.'));
      return;
    }
    if (this.identity() && !this.capability('save_as', 'You do not have permission to save this ClearPipe graph as a new definition.')) return;
    const copy = structuredClone(graph);
    copy.document = {...copy.document, name: name.trim()};
    delete copy.document.id;
    delete copy.document.revision;
    await this.create('save-as', copy);
  }

  /**
   * The current service has mutable CAS revisions, not immutable versions.
   * A requested "new version" therefore follows the supported Save As path.
   */
  async createVersion(name: string): Promise<void> {
    await this.saveAs(name);
  }

  async returnToDetails(): Promise<boolean> {
    const target = this.identity()
      ? {kind: 'definition-task-details' as const, taskId: this.identity()!.taskId}
      : {kind: 'clearpipe-library' as const};
    this.begin('return');
    try {
      const navigated = await this.adapter.navigate(target);
      if (!navigated) this.fail(lifecycleProblem('ClearPipe could not navigate to the requested details page.', true));
      return navigated;
    } catch {
      this.fail(lifecycleProblem('ClearPipe could not navigate to the requested details page.', true));
      return false;
    } finally {
      this.operation.set(null);
    }
  }

  private async create(operation: 'create' | 'save-as', graph: GraphV2): Promise<void> {
    await this.observe(operation, this.adapter.create({
      ...this.requestMetadata(graph),
      graph,
    }), outcome => this.applyMutationOutcome(outcome));
  }

  private requestMetadata(graph: GraphV2): Pick<GraphV2['document'], 'name' | 'description' | 'tags'> {
    return {
      name: graph.document.name,
      description: graph.document.description,
      tags: graph.document.tags,
    };
  }

  private graphForMutation(): GraphV2 | null {
    if (!this.canSave()) {
      this.fail(lifecycleProblem(this.saveDisabledReason() ?? 'This ClearPipe graph cannot be saved.'));
      return null;
    }
    return this.graph();
  }

  private availableForNew(): boolean {
    if (this.adapter.authentication().featureEnabled) return true;
    this.graphStore.setEditable(false);
    this.status.set('permission-disabled');
    this.problem.set(lifecycleProblem('ClearPipe is disabled for this deployment.'));
    return false;
  }

  private capability(capability: keyof ClearpipeCapabilities, message: string): boolean {
    if (!this.capabilities()?.[capability]) {
      this.graphStore.setEditable(false);
      this.status.set('permission-disabled');
      this.problem.set(lifecycleProblem(message));
      return false;
    }
    return true;
  }

  private async observe<T>(
    operation: ClearpipeLifecycleOperation,
    source: Observable<ClearpipeAdapterOutcome<T>>,
    handle: (outcome: ClearpipeAdapterOutcome<T>) => void,
  ): Promise<void> {
    if (this.busy()) {
      this.fail(lifecycleProblem('A ClearPipe lifecycle operation is already in progress.', true));
      return;
    }
    this.begin(operation);
    try {
      await lastValueFrom(source.pipe(tap(outcome => handle(outcome))));
    } catch {
      this.fail(lifecycleProblem('The ClearPipe request could not be completed. Retry when the service is available.', true));
    } finally {
      this.operation.set(null);
    }
  }

  private begin(operation: ClearpipeLifecycleOperation): void {
    this.operation.set(operation);
    this.problem.set(null);
    this.status.set(operation === 'open' || operation === 'reload' ? 'loading' : 'saving');
  }

  private applyLoadOutcome(outcome: ClearpipeAdapterOutcome<ClearpipeDefinitionState>): void {
    if (outcome.status === 'loading') return;
    if (outcome.status === 'ready') {
      this.applyDefinition(outcome.data);
      if (this.status() === 'loading') this.status.set('ready');
      return;
    }
    if (outcome.status === 'unsupported_representation') {
      this.applyReadOnly(outcome.data, outcome.problem);
      return;
    }
    this.applyFailure(outcome);
  }

  private applyMutationOutcome(outcome: ClearpipeAdapterOutcome<ClearpipeDefinitionState>): void {
    if (outcome.status === 'loading') return;
    if (outcome.status === 'ready') {
      this.applyDefinition(outcome.data);
      if (this.status() === 'saving') this.status.set('saved');
      return;
    }
    if (outcome.status === 'unsupported_representation') {
      this.applyReadOnly(outcome.data, outcome.problem);
      return;
    }
    this.applyFailure(outcome);
  }

  private applyDefinition(state: ClearpipeDefinitionState): void {
    if (!state.graph) {
      this.applyReadOnly(state, lifecycleProblem('This ClearPipe definition has no supported editable graph representation.'));
      return;
    }
    const loaded = this.graphStore.load(state.graph);
    if (loaded.status !== 'ok') {
      this.applyReadOnly(state, lifecycleProblem('This ClearPipe graph cannot be loaded without losing unsupported content.'));
      return;
    }
    const taskId = state.definition.task_id ?? state.definition.id ?? state.graph.document.id;
    if (!taskId) {
      this.fail(lifecycleProblem('The ClearPipe service returned a definition without an identity.'));
      return;
    }
    this.identity.set({
      taskId,
      revision: state.definition.revision,
      name: state.graph.document.name,
    });
    this.capabilities.set(state.capabilities);
    this.graphStore.setEditable(state.capabilities.edit);
    if (!state.capabilities.edit) {
      this.status.set('permission-disabled');
      this.problem.set(lifecycleProblem('You can view this ClearPipe definition but do not have permission to edit it.'));
    } else {
      this.problem.set(null);
    }
  }

  private applyReadOnly(state: ClearpipeDefinitionState | undefined, problem: ClearpipeAdapterProblem): void {
    if (state) {
      const taskId = state.definition.task_id ?? state.definition.id;
      if (taskId) this.identity.set({taskId, revision: state.definition.revision, name: state.definition.name});
      this.capabilities.set({...immutableCapabilities(), ...state.capabilities});
    }
    this.graphStore.setEditable(false);
    this.status.set('read-only');
    this.problem.set(problem);
  }

  private applyFailure<T>(outcome: Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'} | {status: 'ready'; data: T}>): void {
    this.problem.set(outcome.problem);
    if (outcome.status === 'stale_revision') {
      this.status.set('conflict');
    } else if (outcome.status === 'denied_or_missing') {
      this.graphStore.setEditable(false);
      this.status.set('permission-disabled');
    } else {
      this.status.set('failed');
    }
  }

  private fail(problem: ClearpipeAdapterProblem): void {
    this.problem.set(problem);
    this.status.set('failed');
  }
}
