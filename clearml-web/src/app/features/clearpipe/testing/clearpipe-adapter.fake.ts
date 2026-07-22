import {DefinitionFixture, DeterministicClock, DeterministicIds, GraphFixture} from './clearpipe-fixtures';

export type ClearpipeOperation = 'load' | 'create' | 'update' | 'save-as' | 'validate' | 'archive' | 'delete' | 'start' | 'status';

export type ClearpipeOutcomeKind =
  | 'feature-disabled'
  | 'forbidden'
  | 'not-found'
  | 'stale-revision'
  | 'validation-failed'
  | 'resource-unavailable'
  | 'unsupported-representation'
  | 'execution-unavailable';

export interface AdapterError {
  kind: ClearpipeOutcomeKind;
  message: string;
  diagnosticTargets?: string[];
}

export type AdapterResult<T> = {ok: true; value: T} | {ok: false; error: AdapterError};

export interface ValidationFixture {
  valid: boolean;
  diagnostics: {code: string; target: string; severity: 'error' | 'warning'; message: string}[];
}

export interface ExecutionFixture {
  runId: string;
  definitionId: string;
  revision: number;
  queue: string;
  queueWatched: boolean;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'stopped';
  updatedAt: string;
}

export interface AdapterPermissionFixture {
  canView: boolean;
  canEdit: boolean;
  canRun: boolean;
  featureEnabled: boolean;
}

export interface AdapterCall {
  operation: ClearpipeOperation;
  arguments: unknown[];
}

export interface ClearpipeAdapterFakeOptions {
  definitions?: DefinitionFixture[];
  permissions?: Partial<AdapterPermissionFixture>;
  ids?: DeterministicIds;
  clock?: DeterministicClock;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const defaultPermissions: AdapterPermissionFixture = {
  canView: true,
  canEdit: true,
  canRun: true,
  featureEnabled: true,
};

export class ClearpipeAdapterFake {
  readonly calls: AdapterCall[] = [];
  private readonly definitions = new Map<string, DefinitionFixture>();
  private readonly executions = new Map<string, ExecutionFixture>();
  private readonly failures = new Map<ClearpipeOperation, AdapterError>();
  private readonly ids: DeterministicIds;
  private readonly clock: DeterministicClock;
  private permissions: AdapterPermissionFixture;

  constructor(options: ClearpipeAdapterFakeOptions = {}) {
    this.ids = options.ids ?? new DeterministicIds();
    this.clock = options.clock ?? new DeterministicClock();
    this.permissions = {...defaultPermissions, ...options.permissions};
    (options.definitions ?? []).forEach(definition => this.definitions.set(definition.id, clone(definition)));
  }

  failNext(operation: ClearpipeOperation, error: AdapterError): void {
    this.failures.set(operation, clone(error));
  }

  setPermissions(permissions: Partial<AdapterPermissionFixture>): void {
    this.permissions = {...this.permissions, ...permissions};
  }

  async load(definitionId: string): Promise<AdapterResult<DefinitionFixture>> {
    this.record('load', definitionId);
    const failure = this.failureFor('load') ?? this.viewFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    return this.definitionResult(definitionId);
  }

  async create(document: GraphFixture): Promise<AdapterResult<DefinitionFixture>> {
    this.record('create', document);
    const failure = this.failureFor('create') ?? this.editFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    const timestamp = this.clock.now();
    const definition: DefinitionFixture = {
      id: this.nextDefinitionId(),
      revision: 1,
      document: clone(document),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.definitions.set(definition.id, clone(definition));
    return {ok: true, value: clone(definition)};
  }

  async update(definitionId: string, expectedRevision: number, document: GraphFixture): Promise<AdapterResult<DefinitionFixture>> {
    this.record('update', definitionId, expectedRevision, document);
    const failure = this.failureFor('update') ?? this.editFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    const existing = this.definitions.get(definitionId);
    if (!existing) {
      return {ok: false, error: notFound()};
    }
    if (existing.revision !== expectedRevision) {
      return {ok: false, error: staleRevision()};
    }
    const updated: DefinitionFixture = {
      ...existing,
      revision: existing.revision + 1,
      document: clone(document),
      updatedAt: this.clock.now(),
    };
    this.definitions.set(definitionId, clone(updated));
    return {ok: true, value: clone(updated)};
  }

  async saveAs(sourceDefinitionId: string, document: GraphFixture): Promise<AdapterResult<DefinitionFixture>> {
    this.record('save-as', sourceDefinitionId, document);
    const failure = this.failureFor('save-as') ?? this.editFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    if (!this.definitions.has(sourceDefinitionId)) {
      return {ok: false, error: notFound()};
    }
    const timestamp = this.clock.now();
    const definition: DefinitionFixture = {
      id: this.nextDefinitionId(),
      revision: 1,
      document: clone(document),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.definitions.set(definition.id, clone(definition));
    return {ok: true, value: clone(definition)};
  }

  async validate(document: GraphFixture): Promise<AdapterResult<ValidationFixture>> {
    this.record('validate', document);
    const failure = this.failureFor('validate') ?? this.viewFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    return {ok: true, value: {valid: true, diagnostics: []}};
  }

  async archive(definitionId: string, expectedRevision: number): Promise<AdapterResult<DefinitionFixture>> {
    this.record('archive', definitionId, expectedRevision);
    const existing = await this.updateArchiveState('archive', definitionId, expectedRevision, true);
    return existing;
  }

  async delete(definitionId: string, expectedRevision: number): Promise<AdapterResult<{deleted: true}>> {
    this.record('delete', definitionId, expectedRevision);
    const failure = this.failureFor('delete') ?? this.editFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    const existing = this.definitions.get(definitionId);
    if (!existing) {
      return {ok: false, error: notFound()};
    }
    if (existing.revision !== expectedRevision) {
      return {ok: false, error: staleRevision()};
    }
    this.definitions.delete(definitionId);
    return {ok: true, value: {deleted: true}};
  }

  async start(definitionId: string, expectedRevision: number, queue: string): Promise<AdapterResult<ExecutionFixture>> {
    this.record('start', definitionId, expectedRevision, queue);
    const failure = this.failureFor('start') ?? this.runFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    const definition = this.definitions.get(definitionId);
    if (!definition) {
      return {ok: false, error: notFound()};
    }
    if (definition.revision !== expectedRevision) {
      return {ok: false, error: staleRevision()};
    }
    const execution: ExecutionFixture = {
      runId: this.ids.next('run'),
      definitionId,
      revision: expectedRevision,
      queue,
      queueWatched: true,
      state: 'queued',
      updatedAt: this.clock.now(),
    };
    this.executions.set(execution.runId, clone(execution));
    return {ok: true, value: clone(execution)};
  }

  async status(runId: string): Promise<AdapterResult<ExecutionFixture>> {
    this.record('status', runId);
    const failure = this.failureFor('status') ?? this.viewFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    const execution = this.executions.get(runId);
    return execution ? {ok: true, value: clone(execution)} : {ok: false, error: notFound()};
  }

  private async updateArchiveState(
    operation: 'archive',
    definitionId: string,
    expectedRevision: number,
    archived: boolean,
  ): Promise<AdapterResult<DefinitionFixture>> {
    const failure = this.failureFor(operation) ?? this.editFailure();
    if (failure) {
      return {ok: false, error: failure};
    }
    const existing = this.definitions.get(definitionId);
    if (!existing) {
      return {ok: false, error: notFound()};
    }
    if (existing.revision !== expectedRevision) {
      return {ok: false, error: staleRevision()};
    }
    const updated: DefinitionFixture = {
      ...existing,
      archived,
      revision: existing.revision + 1,
      updatedAt: this.clock.now(),
    };
    this.definitions.set(definitionId, clone(updated));
    return {ok: true, value: clone(updated)};
  }

  private definitionResult(definitionId: string): AdapterResult<DefinitionFixture> {
    const definition = this.definitions.get(definitionId);
    return definition ? {ok: true, value: clone(definition)} : {ok: false, error: notFound()};
  }

  private failureFor(operation: ClearpipeOperation): AdapterError | undefined {
    const failure = this.failures.get(operation);
    this.failures.delete(operation);
    return failure;
  }

  private viewFailure(): AdapterError | undefined {
    if (!this.permissions.featureEnabled) {
      return {kind: 'feature-disabled', message: 'ClearPipe is disabled'};
    }
    return this.permissions.canView ? undefined : {kind: 'forbidden', message: 'View permission is required'};
  }

  private editFailure(): AdapterError | undefined {
    const viewFailure = this.viewFailure();
    return viewFailure ?? (this.permissions.canEdit ? undefined : {kind: 'forbidden', message: 'Edit permission is required'});
  }

  private runFailure(): AdapterError | undefined {
    const editFailure = this.editFailure();
    return editFailure ?? (this.permissions.canRun ? undefined : {kind: 'execution-unavailable', message: 'Run permission is required'});
  }

  private record(operation: ClearpipeOperation, ...arguments_: unknown[]): void {
    this.calls.push({operation, arguments: clone(arguments_)});
  }

  private nextDefinitionId(): string {
    let id = this.ids.next('definition');
    while (this.definitions.has(id)) {
      id = this.ids.next('definition');
    }
    return id;
  }
}

const notFound = (): AdapterError => ({kind: 'not-found', message: 'Definition was not found'});
const staleRevision = (): AdapterError => ({kind: 'stale-revision', message: 'Definition revision is stale'});
