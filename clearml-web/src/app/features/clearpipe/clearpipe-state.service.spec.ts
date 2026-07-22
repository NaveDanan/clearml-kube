import {ClearpipeStateService} from './clearpipe-state.service';
import {emptyClearpipeDefinition} from './clearpipe.models';
import {TestBed} from '@angular/core/testing';

describe('ClearpipeStateService', () => {
  let state: ClearpipeStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({providers: [ClearpipeStateService]});
    state = TestBed.inject(ClearpipeStateService);
    state.load(emptyClearpipeDefinition());
  });

  it('adds, connects and removes nodes with incident edges', () => {
    const first = state.addNode('dataset', {x: 10, y: 20});
    const second = state.addNode('training', {x: 220, y: 20});
    state.selectConnectionNode(first);
    state.selectConnectionNode(second);
    expect(state.definition().edges.length).toBe(1);

    state.removeNode(first);
    expect(state.definition().nodes.map(node => node.id)).not.toContain(first);
    expect(state.definition().edges).toEqual([]);
  });

  it('rejects duplicate edges and graph cycles', () => {
    const first = state.addNode('dataset', {x: 0, y: 0});
    const second = state.addNode('execute', {x: 200, y: 0});
    state.selectConnectionNode(first);
    state.selectConnectionNode(second);
    state.selectConnectionNode(first);
    state.selectConnectionNode(second);
    expect(state.definition().edges.length).toBe(1);

    state.selectConnectionNode(second);
    state.selectConnectionNode(first);
    expect(state.definition().edges.length).toBe(1);
  });

  it('tracks configuration changes in undo and redo history', () => {
    const id = state.addNode('execute', {x: 0, y: 0});
    state.updateNodeConfig(id, 'script', 'print(1)');
    expect(state.selectedNode()?.config['script']).toBe('print(1)');

    state.undo();
    expect(state.definition().nodes.find(node => node.id === id)?.config['script']).toBeUndefined();
    state.redo();
    expect(state.definition().nodes.find(node => node.id === id)?.config['script']).toBe('print(1)');
  });

  it('resets dirty state and history when a different route definition loads', () => {
    state.addNode('report', {x: 0, y: 0});
    expect(state.dirty()).toBeTrue();
    state.load({...emptyClearpipeDefinition(), id: 'other', task_id: 'other', name: 'Other', revision: 4});
    expect(state.dirty()).toBeFalse();
    expect(state.definition().id).toBe('other');
    expect(state.history().length).toBe(1);
  });
});
