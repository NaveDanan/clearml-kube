import {TestBed} from '@angular/core/testing';
import {ClearpipeDocumentTransferService} from '../editor/clearpipe-document-transfer.service';
import {clearpipeUnsavedWorkGuard} from '../editor/clearpipe-unsaved-work.guard';
import {
  CLEARPIPE_UNSAVED_WORK_DECIDER,
  ClearpipeUnsavedWorkAction,
  ClearpipeUnsavedWorkDecision,
  ClearpipeUnsavedWorkService,
} from '../editor/clearpipe-unsaved-work.service';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {graphV2LogicallyEquals, GraphStoreService} from '../domain/graph-store.service';
import {clearpipeRoutes} from '../clearpipe.routes';
import {functionGraph, taskGraph} from './clearpipe-fixtures';

class LifecycleFake {
  saves = 0;
  news = 0;
  opens: string[] = [];
  store!: GraphStoreService;

  async save(): Promise<void> {
    this.saves += 1;
    this.store.markSaved();
  }

  new(): boolean {
    this.news += 1;
    return true;
  }

  async open(taskId: string): Promise<void> {
    this.opens.push(taskId);
  }
}

describe('ClearpipeDocumentTransferService', () => {
  let store: GraphStoreService;
  let transfer: ClearpipeDocumentTransferService;
  let unsaved: ClearpipeUnsavedWorkService;
  let lifecycle: LifecycleFake;
  let decision: ClearpipeUnsavedWorkDecision;

  beforeEach(() => {
    decision = 'discard';
    lifecycle = new LifecycleFake();
    TestBed.configureTestingModule({
      providers: [
        GraphStoreService,
        ClearpipeDocumentTransferService,
        ClearpipeUnsavedWorkService,
        {provide: ClearpipeLifecycleService, useValue: lifecycle},
        {provide: CLEARPIPE_UNSAVED_WORK_DECIDER, useValue: {decide: async () => decision}},
      ],
    });
    store = TestBed.inject(GraphStoreService);
    lifecycle.store = store;
    transfer = TestBed.inject(ClearpipeDocumentTransferService);
    unsaved = TestBed.inject(ClearpipeUnsavedWorkService);
  });

  it('round-trips deterministic task and function graph exports without identity or transient state', async () => {
    for (const graph of [taskGraph(), functionGraph()]) {
      store.load(graph);
      store.selectedNodeId.set(graph.nodes[0].id);
      store.requests.set({import: 'pending'});

      const first = transfer.exportGraph();
      const second = transfer.exportGraph();
      expect(first.status).toBe('exported');
      expect(second).toEqual(first);
      if (first.status !== 'exported') continue;

      const raw = JSON.parse(first.document.text);
      expect(raw.document.id).toBeUndefined();
      expect(raw.document.revision).toBeUndefined();
      expect(first.document.text).not.toContain('selected_node_id');
      expect(first.document.text).not.toContain('requests');

      const imported = await transfer.importGraph(first.document.text);
      expect(imported.status).toBe('imported');
      expect(graphV2LogicallyEquals(store.graph()!, graph)).toBeTrue();
      expect(store.dirty()).toBeFalse();
    }
  });

  it('does not replace the canonical graph for malformed, unsupported, unknown-node, migration, or secret imports', async () => {
    const original = taskGraph();
    store.load(original);
    const cases = [
      ['{', 'invalid'],
      [JSON.stringify({schema_version: 2}), 'invalid'],
      [JSON.stringify({...taskGraph(), schema_version: 1}), 'unsupported'],
      [JSON.stringify({...taskGraph(), schema_version: 999}), 'unsupported'],
      [JSON.stringify({...taskGraph(), nodes: [{...taskGraph().nodes[0], kind: 'unknown'}]}), 'unsupported'],
      [JSON.stringify({...functionGraph(), nodes: [{...functionGraph().nodes[0], configuration: {api_key: 'do-not-export'}}]}), 'invalid'],
    ] as const;

    for (const [text, status] of cases) {
      const result = await transfer.importGraph(text);
      expect(result.status).toBe(status);
      expect(graphV2LogicallyEquals(store.graph()!, original)).toBeTrue();
    }
  });

  it('rejects code transfer without parsing, evaluating, or replacing the graph', () => {
    store.load(functionGraph());
    const before = store.graph()!;

    expect(transfer.exportGeneratedCode()).toEqual({status: 'unavailable', code: 'code_generation_unavailable'});
    expect(transfer.importGeneratedCode('eval("unsafe")')).toEqual({status: 'unavailable', code: 'code_import_unsupported'});
    expect(graphV2LogicallyEquals(store.graph()!, before)).toBeTrue();
  });

  it('uses cancellation, save, and discard consistently for every destructive path', async () => {
    const actions: ClearpipeUnsavedWorkAction[] = ['new', 'open', 'import', 'route-navigation', 'close', 'mode-change'];
    for (const action of actions) {
      store.load(taskGraph());
      store.updateDocument({description: `changed-${action}`});
      const original = store.graph()!;
      let replaced = false;

      decision = 'cancel';
      expect((await unsaved.protect(action, () => replaced = true)).proceeded).toBeFalse();
      expect(replaced).toBeFalse();
      expect(graphV2LogicallyEquals(store.graph()!, original)).toBeTrue();

      decision = 'save';
      expect((await unsaved.protect(action, () => replaced = true)).proceeded).toBeTrue();
      expect(lifecycle.saves).toBeGreaterThan(0);
      expect(replaced).toBeTrue();

      store.updateDocument({description: `discard-${action}`});
      replaced = false;
      decision = 'discard';
      expect((await unsaved.protect(action, () => replaced = true)).proceeded).toBeTrue();
      expect(replaced).toBeTrue();
    }
  });

  it('guards new, open, import, and route leave through the same decision flow', async () => {
    store.load(taskGraph());
    store.updateDocument({description: 'dirty'});
    decision = 'cancel';
    expect((await unsaved.newDocument()).proceeded).toBeFalse();
    expect((await unsaved.openDocument('next')).proceeded).toBeFalse();
    expect(await TestBed.runInInjectionContext(() =>
      clearpipeUnsavedWorkGuard({} as never, {} as never, {} as never, {} as never)
    )).toBeFalse();

    decision = 'discard';
    expect((await unsaved.newDocument()).proceeded).toBeTrue();
    expect(lifecycle.news).toBe(1);
    expect((await unsaved.openDocument('next')).proceeded).toBeTrue();
    expect(lifecycle.opens).toEqual(['next']);

    store.updateDocument({description: 'dirty-again'});
    decision = 'discard';
    const result = await transfer.importGraph(JSON.stringify(functionGraph()));
    expect(result.status).toBe('imported');
    expect(lifecycle.news).toBe(2);
  });

  it('wires the ClearPipe child editor routes to the reusable leave guard', () => {
    for (const route of clearpipeRoutes.filter(item => ['new', ':taskId/edit', ':taskId'].includes(item.path!))) {
      expect(route.canDeactivate).toEqual([clearpipeUnsavedWorkGuard]);
    }
  });
});
