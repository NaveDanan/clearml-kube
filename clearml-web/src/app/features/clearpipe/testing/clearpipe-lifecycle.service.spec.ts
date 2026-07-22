import {concat, from, Observable, of} from 'rxjs';
import {map} from 'rxjs/operators';
import {TestBed} from '@angular/core/testing';
import {ClearpipeCapabilities, ClearpipeCreateRequest, ClearpipeUpdateRequest} from '../clearpipe-api.service';
import {GraphStoreService, graphV2LogicallyEquals} from '../domain/graph-store.service';
import {GraphV2} from '../domain/graph-v2.types';
import {
  ClearpipeAdapterOutcome,
  ClearpipeAdapterService,
  ClearpipeDefinitionState,
} from '../platform/clearpipe-adapter.service';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ClearpipeAdapterFake, AdapterError} from './clearpipe-adapter.fake';
import {DefinitionFixture, fixtureDefinition, functionGraph, invalidGraphs, taskGraph} from './clearpipe-fixtures';

const capabilities = (overrides: Partial<ClearpipeCapabilities> = {}): ClearpipeCapabilities => ({
  view: true,
  edit: true,
  save_as: true,
  version: false,
  run: false,
  compilation: false,
  execution: false,
  import: false,
  export: false,
  source: false,
  archive: false,
  delete: false,
  ...overrides,
});

class LifecycleAdapterFake {
  readonly navigation: unknown[] = [];
  readonly backend: ClearpipeAdapterFake;
  currentCapabilities = capabilities();
  unsupported = false;
  featureEnabled = true;

  constructor(definitions: DefinitionFixture[] = []) {
    this.backend = new ClearpipeAdapterFake({definitions});
  }

  authentication(): {authenticated: boolean; featureEnabled: boolean} {
    return {authenticated: true, featureEnabled: this.featureEnabled};
  }

  load(task: string): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    if (this.unsupported) {
      return concat(of({status: 'loading'} as const), of({
        status: 'unsupported_representation' as const,
        data: this.state(fixtureDefinition({id: task, document: invalidGraphs()[4].document}), undefined, 'legacy_clearpipe_graph'),
        problem: {message: 'This ClearPipe representation is read-only.', retryable: false},
      }));
    }
    return this.outcomes(from(this.backend.load(task)));
  }

  create(request: ClearpipeCreateRequest): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    return this.outcomes(from(this.backend.create(request.graph)));
  }

  update(request: ClearpipeUpdateRequest): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    return this.outcomes(from(this.backend.update(request.task, request.revision, request.graph)));
  }

  navigate(target: unknown): Promise<boolean> {
    this.navigation.push(target);
    return Promise.resolve(true);
  }

  private outcomes(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    result$: Observable<any>,
  ): Observable<ClearpipeAdapterOutcome<ClearpipeDefinitionState>> {
    return concat(
      of({status: 'loading'} as const),
      result$.pipe(map(result => result.ok
        ? {status: 'ready' as const, data: this.state(result.value)}
        : this.error(result.error)))
    );
  }

  private state(
    fixture: DefinitionFixture,
    document: GraphV2 | undefined = fixture.document,
    representation: ClearpipeDefinitionState['representation'] = 'clearpipe_graph_v2',
  ): ClearpipeDefinitionState {
    return {
      definition: {
        id: fixture.id,
        task_id: fixture.id,
        name: document?.document.name ?? 'Unsupported ClearPipe',
        revision: fixture.revision,
        schema_version: document?.schema_version ?? 1,
        nodes: [],
        edges: [],
        viewport: {x: 0, y: 0, zoom: 1},
      },
      graph: document,
      representation,
      capabilities: capabilities({
        edit: representation === 'clearpipe_graph_v2' && this.currentCapabilities.edit,
        save_as: representation === 'clearpipe_graph_v2' && this.currentCapabilities.save_as,
      }),
    };
  }

  private error(error: AdapterError): Exclude<ClearpipeAdapterOutcome<ClearpipeDefinitionState>, {status: 'loading'} | {status: 'ready'; data: ClearpipeDefinitionState}> {
    const status = error.kind === 'stale-revision'
      ? 'stale_revision'
      : error.kind === 'forbidden' || error.kind === 'not-found' || error.kind === 'feature-disabled'
        ? 'denied_or_missing'
        : error.kind === 'unsupported-representation'
          ? 'unsupported_representation'
          : error.kind === 'resource-unavailable'
            ? 'resource_unavailable'
            : 'failed';
    return {status, problem: {message: error.message, retryable: status === 'resource_unavailable' || status === 'failed'}};
  }
}

describe('ClearpipeLifecycleService', () => {
  let store: GraphStoreService;
  let adapter: LifecycleAdapterFake;
  let lifecycle: ClearpipeLifecycleService;

  beforeEach(() => {
    adapter = new LifecycleAdapterFake([fixtureDefinition({id: 'permission-task', document: functionGraph()})]);
    TestBed.configureTestingModule({
      providers: [
        GraphStoreService,
        ClearpipeLifecycleService,
        {provide: ClearpipeAdapterService, useValue: adapter},
      ],
    });
    store = TestBed.inject(GraphStoreService);
    lifecycle = TestBed.inject(ClearpipeLifecycleService);
  });

  it('creates, updates, reloads, and Save As copies task and function graphs without losing logical content', async () => {
    const task = taskGraph();
    store.load(task);
    const beforeCreate = store.graph()!;

    await lifecycle.save();
    const created = lifecycle.identity()!;
    expect(created.revision).toBe(1);
    expect(adapter.backend.calls[0].operation).toBe('create');
    expect(graphV2LogicallyEquals(beforeCreate, store.graph()!)).toBeTrue();

    store.setNodePosition('task-target', {x: 640, y: 80});
    const beforeUpdate = store.graph()!;
    await lifecycle.save();
    expect(lifecycle.identity()!.revision).toBe(2);
    expect(adapter.backend.calls[1].operation).toBe('update');
    expect(graphV2LogicallyEquals(beforeUpdate, store.graph()!)).toBeTrue();

    await lifecycle.reload();
    expect(graphV2LogicallyEquals(beforeUpdate, store.graph()!)).toBeTrue();

    await lifecycle.createVersion('Task copy');
    expect(lifecycle.identity()!.taskId).not.toBe(created.taskId);
    expect(lifecycle.identity()!.revision).toBe(1);
    expect(adapter.backend.calls.filter(call => call.operation === 'create').length).toBe(2);

    lifecycle.new({name: 'Function graph'});
    store.load(functionGraph());
    const beforeFunctionSave = store.graph()!;
    await lifecycle.save();
    await lifecycle.reload();
    expect(graphV2LogicallyEquals(beforeFunctionSave, store.graph()!)).toBeTrue();
  });

  it('derives dirty exclusively from serialized graph content and excludes transient state from persisted payloads', async () => {
    store.load(functionGraph());
    lifecycle.graphStore.selectedNodeId.set('normalize');
    lifecycle.graphStore.hoveredNodeId.set('normalize');
    lifecycle.graphStore.draggingNodeId.set('normalize');
    lifecycle.graphStore.polling.set(true);
    lifecycle.graphStore.requests.set({save: 'pending'});

    expect(lifecycle.dirty()).toBeFalse();
    await lifecycle.save();
    const payload = adapter.backend.calls[0].arguments[0] as GraphV2;
    const persisted = JSON.stringify(payload);
    expect(persisted).not.toContain('selected_node_id');
    expect(persisted).not.toContain('dragging_node_id');
    expect(persisted).not.toContain('generated_inputs');
    expect(persisted).not.toContain('requests');

    store.setNodePosition('normalize', {x: 48, y: 24});
    expect(lifecycle.dirty()).toBeTrue();
  });

  it('preserves local edits across stale and backend failures and disables mutations for denied permissions', async () => {
    const definition = fixtureDefinition({id: 'permission-task', document: functionGraph()});
    await lifecycle.open(definition.id);

    adapter.backend.failNext('update', {kind: 'stale-revision', message: 'Definition revision is stale'});
    store.setNodePosition('normalize', {x: 99, y: 1});
    await lifecycle.save();
    expect(lifecycle.status()).toBe('conflict');
    expect(lifecycle.dirty()).toBeTrue();

    adapter.backend.failNext('update', {kind: 'resource-unavailable', message: 'ClearPipe service is unavailable'});
    await lifecycle.save();
    expect(lifecycle.status()).toBe('failed');
    expect(lifecycle.problem()!.message).toContain('unavailable');
    expect(lifecycle.dirty()).toBeTrue();

    adapter.currentCapabilities = capabilities({edit: false});
    await lifecycle.open(definition.id);
    expect(lifecycle.status()).toBe('permission-disabled');
    expect(lifecycle.canSave()).toBeFalse();
    expect(lifecycle.saveDisabledReason()).toContain('permission');
  });

  it('keeps unsupported graphs read-only and rejects secret-bearing graphs before persistence', async () => {
    adapter.unsupported = true;
    await lifecycle.open('legacy-task');
    expect(lifecycle.status()).toBe('read-only');
    expect(lifecycle.problem()!.message).toContain('read-only');
    expect(lifecycle.canSave()).toBeFalse();

    const secret = invalidGraphs().find(candidate => candidate.name === 'embedded-secret')!.document;
    expect(store.load(secret).status).toBe('invalid');
    await lifecycle.save();
    expect(lifecycle.problem()!.message).not.toContain('api_key');
    expect(adapter.backend.calls.filter(call => call.operation === 'create' || call.operation === 'update').length).toBe(0);
  });

  it('initializes new drafts through the canonical store and returns persisted definitions to task details', async () => {
    expect(lifecycle.new({name: 'New definition'})).toBeTrue();
    expect(lifecycle.identity()).toBeNull();
    expect(lifecycle.graph()!.document.name).toBe('New definition');
    await lifecycle.save();
    await lifecycle.returnToDetails();
    expect(adapter.navigation).toEqual([{kind: 'definition-task-details', taskId: lifecycle.identity()!.taskId}]);
  });
});
