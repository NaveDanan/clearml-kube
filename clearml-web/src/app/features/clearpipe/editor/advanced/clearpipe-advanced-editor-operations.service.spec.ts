import {TestBed} from '@angular/core/testing';
import {createEmptyGraphV2, GraphStoreService} from '../../domain/graph-store.service';
import {FunctionNode, GraphPort} from '../../domain/graph-v2.types';
import {ClearpipeSemanticEdgeController} from '../edges/clearpipe-semantic-edge.controller';
import {ClearpipeAdvancedEditorOperationsService} from './clearpipe-advanced-editor-operations.service';
import {assistedLayout} from './deterministic-layout';
import {canvasShortcut, isShortcutSuppressed, shortcutModifierLabel} from './shortcut-scope';

const port = (id: string, direction: 'input' | 'output'): GraphPort => ({
  id, kind: 'port', name: id, direction, role: 'data', required: false, multiplicity: 'single',
  accepted_binding_kinds: ['data'], order: 0,
});
const node = (id: string, x = 0, ports: GraphPort[] = []): FunctionNode => ({
  id, kind: 'function', name: id, label: id, signature: `def ${id}()`, source: `def ${id}():\n return 1`, ports,
  configuration: {task_type: 'data_processing'}, visual: {position: {x, y: 0}},
});

describe('ClearpipeAdvancedEditorOperationsService', () => {
  let store: GraphStoreService;
  let operations: ClearpipeAdvancedEditorOperationsService;
  let edges: ClearpipeSemanticEdgeController;

  beforeEach(() => {
    TestBed.configureTestingModule({providers: [GraphStoreService, ClearpipeSemanticEdgeController, ClearpipeAdvancedEditorOperationsService]});
    store = TestBed.inject(GraphStoreService);
    operations = TestBed.inject(ClearpipeAdvancedEditorOperationsService);
    edges = TestBed.inject(ClearpipeSemanticEdgeController);
    expect(store.load(createEmptyGraphV2()).status).toBe('ok');
  });

  it('coalesces a long keyboard move history and restores the saved dirty baseline', () => {
    expect(store.addNode(node('one')).ok).toBeTrue();
    store.markSaved();
    operations.select('one');
    for (let index = 0; index < 40; index++) operations.moveNodes(['one'], {x: 1, y: 0}, false, 'keyboard-move');

    expect(store.node('one')?.visual.position.x).toBe(40);
    expect(operations.canUndo()).toBeTrue();
    operations.undo();
    expect(store.node('one')?.visual.position.x).toBe(0);
    expect(store.dirty()).toBeFalse();
    operations.redo();
    expect(store.node('one')?.visual.position.x).toBe(40);
    expect(store.dirty()).toBeTrue();
  });

  it('restores a long sequence of add and configuration commands', () => {
    store.markSaved();
    for (let index = 0; index < 12; index++) {
      operations.perform('add-node', () => store.addNode(node(`step_${index}`)));
    }
    expect(operations.configureNode('step_0', {task_type: 'training'}).ok).toBeTrue();
    const configured = store.node('step_0');
    expect(configured?.kind === 'function' && configured.configuration.task_type).toBe('training');
    for (let index = 0; index < 13; index++) operations.undo();
    expect(store.nodes()).toHaveSize(0);
    expect(store.dirty()).toBeFalse();
    for (let index = 0; index < 13; index++) operations.redo();
    expect(store.nodes()).toHaveSize(12);
    const redone = store.node('step_0');
    expect(redone?.kind === 'function' && redone.configuration.task_type).toBe('training');
  });

  it('duplicates with stable IDs and keeps only internal bindings', () => {
    store.addNode(node('source', 0, [port('out', 'output')]));
    store.addNode(node('target', 300, [port('in', 'input')]));
    expect(edges.create({kind: 'data', source: {kind: 'port', node_id: 'source', port_id: 'out'}, target: {kind: 'port', node_id: 'target', port_id: 'in'}}).eligible).toBeTrue();
    operations.select('source');

    operations.duplicate();

    expect(store.nodes().map(item => item.id)).toContain('source_copy');
    expect(store.bindings()).toHaveSize(1);
    expect(store.bindings()[0].source.kind).toBe('port');
    expect(store.bindings()[0].target.kind).toBe('port');
  });

  it('remaps internal bindings when a complete subgraph is duplicated', () => {
    store.addNode(node('source', 0, [port('out', 'output')]));
    store.addNode(node('target', 300, [port('in', 'input')]));
    edges.create({kind: 'data', source: {kind: 'port', node_id: 'source', port_id: 'out'}, target: {kind: 'port', node_id: 'target', port_id: 'in'}});
    operations.select('source');
    operations.select('target', true);

    expect(operations.duplicate().ok).toBeTrue();
    const copied = store.bindings().find(binding =>
      binding.source.kind === 'port' && binding.target.kind === 'port'
      && binding.source.node_id === 'source_copy' && binding.target.node_id === 'target_copy');
    expect(copied).toBeDefined();
    expect(copied?.id).toBe('binding_1_copy');
  });

  it('replays CP-20 create, reconnect and remove edge mutations through undo and redo', () => {
    store.addNode(node('left', 0, [port('out', 'output')]));
    store.addNode(node('right', 300, [port('in', 'input')]));
    store.addNode(node('replacement', 600, [port('in', 'input')]));
    const created = operations.performSemantic('create-edge', () => edges.create({
      kind: 'data', source: {kind: 'port', node_id: 'left', port_id: 'out'}, target: {kind: 'port', node_id: 'right', port_id: 'in'},
    }));
    expect(created.eligible).toBeTrue();
    const id = created.id!;
    expect(operations.performSemantic('reconnect-edge', () => edges.reconnect(id, {
      kind: 'data', source: {kind: 'port', node_id: 'left', port_id: 'out'}, target: {kind: 'port', node_id: 'replacement', port_id: 'in'},
    })).eligible).toBeTrue();
    operations.performSemantic('remove-edge', () => edges.remove(id));
    expect(store.bindings()).toHaveSize(0);
    operations.undo();
    expect(store.bindings()[0].target.kind === 'port' && store.bindings()[0].target.node_id).toBe('replacement');
    operations.undo();
    expect(store.bindings()[0].target.kind === 'port' && store.bindings()[0].target.node_id).toBe('right');
    operations.redo();
    expect(store.bindings()[0].target.kind === 'port' && store.bindings()[0].target.node_id).toBe('replacement');
  });

  it('lays out visual positions deterministically without changing graph semantics', () => {
    store.addNode(node('z', 19));
    store.addNode(node('a', 71));
    const before = store.serialize();
    operations.layout();
    const after = store.graph()!;

    expect(after.nodes.map(item => item.id)).toEqual(['a', 'z']);
    expect(after.nodes.map(item => item.visual.position)).toEqual([{x: 64, y: 64}, {x: 304, y: 64}]);
    const semanticNode = (item: FunctionNode) => ({
      id: item.id, kind: item.kind, name: item.name, label: item.label, ports: item.ports,
      signature: item.signature, source: item.source, configuration: item.configuration,
    });
    expect(after.nodes.map(item => semanticNode(item as FunctionNode)))
      .toEqual(JSON.parse(before!).nodes.map(semanticNode));
    expect(assistedLayout(['z', 'a']).get('a')).toEqual({x: 64, y: 64});
  });
});

describe('CP-27 shortcut scope', () => {
  it('suppresses editor and dialog shortcuts and exposes platform labels', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    dialog.appendChild(input);
    expect(isShortcutSuppressed(input)).toBeTrue();
    expect(isShortcutSuppressed(document.createElement('textarea'))).toBeTrue();
    expect(isShortcutSuppressed(document.createElement('div'))).toBeFalse();
    expect(shortcutModifierLabel('MacIntel')).toBe('⌘');
    expect(shortcutModifierLabel('Win32')).toBe('Ctrl');
  });

  it('maps only scoped modifier shortcuts', () => {
    expect(canvasShortcut(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true}))).toBe('undo');
    expect(canvasShortcut(new KeyboardEvent('keydown', {key: 'z', ctrlKey: true, shiftKey: true}))).toBe('redo');
    expect(canvasShortcut(new KeyboardEvent('keydown', {key: 'a'}))).toBeNull();
  });
});
