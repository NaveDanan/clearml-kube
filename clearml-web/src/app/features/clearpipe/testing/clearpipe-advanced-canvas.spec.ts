import {ComponentFixture, TestBed} from '@angular/core/testing';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {CanvasNodePlacement} from '../editor/clearpipe-canvas.adapter';
import {ClearpipeCanvasComponent} from '../editor/clearpipe-canvas.component';
import {ClearpipeAdvancedEditorOperationsService} from '../editor/advanced/clearpipe-advanced-editor-operations.service';
import {GraphPort} from '../domain/graph-v2.types';

const placement: CanvasNodePlacement = {
  kind: 'function',
  node: {label: 'Keyboard node', signature: 'def keyboard_node()', source: 'def keyboard_node():\n return 1', ports: [], configuration: {task_type: 'data_processing'}},
};
const port = (id: string, direction: 'input' | 'output'): GraphPort => ({
  id, kind: 'port', name: id, direction, role: 'data', required: false, multiplicity: 'single',
  accepted_binding_kinds: ['data'], order: 0,
});
const sourcePlacement: CanvasNodePlacement = {
  kind: 'function',
  node: {label: 'Source', signature: 'def source()', source: 'def source():\n return 1', ports: [port('out', 'output')], configuration: {task_type: 'data_processing'}},
};
const targetPlacement: CanvasNodePlacement = {
  kind: 'function',
  node: {label: 'Target', signature: 'def target()', source: 'def target():\n return 1', ports: [port('in', 'input')], configuration: {task_type: 'data_processing'}},
};

describe('CP-27 canvas keyboard workflow', () => {
  let fixture: ComponentFixture<ClearpipeCanvasComponent>;
  let store: GraphStoreService;
  let advanced: ClearpipeAdvancedEditorOperationsService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ClearpipeCanvasComponent], providers: [GraphStoreService]}).compileComponents();
    store = TestBed.inject(GraphStoreService);
    advanced = TestBed.inject(ClearpipeAdvancedEditorOperationsService);
    store.load(createEmptyGraphV2());
    fixture = TestBed.createComponent(ClearpipeCanvasComponent);
    fixture.detectChanges();
  });

  it('selects, moves, duplicates, and documents shortcuts without drag', () => {
    fixture.componentInstance.placeNode(placement, {clientX: 20, clientY: 20});
    fixture.componentInstance.placeNode(placement, {clientX: 120, clientY: 20});
    fixture.detectChanges();
    const surface = fixture.nativeElement.querySelector('.canvas-surface') as HTMLElement;

    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', ctrlKey: true, bubbles: true, cancelable: true}));
    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));
    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'd', ctrlKey: true, bubbles: true, cancelable: true}));

    expect(store.nodes()).toHaveSize(4);
    expect(store.nodes().filter(node => node.visual.position.x >= 44)).toHaveSize(4);
    expect(fixture.nativeElement.textContent).toContain('Keyboard shortcuts');
  });

  it('leaves shortcuts inert for dialog and editable targets inside the canvas', () => {
    fixture.componentInstance.placeNode(placement, {clientX: 20, clientY: 20});
    fixture.detectChanges();
    const surface = fixture.nativeElement.querySelector('.canvas-surface') as HTMLElement;
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const input = document.createElement('input');
    dialog.appendChild(input);
    surface.appendChild(dialog);

    input.dispatchEvent(new KeyboardEvent('keydown', {key: 'd', ctrlKey: true, bubbles: true, cancelable: true}));
    expect(store.nodes()).toHaveSize(1);
  });

  it('records fallback port creation through CP-20 for undo and redo', () => {
    fixture.componentInstance.placeNode(sourcePlacement, {clientX: 20, clientY: 20});
    fixture.componentInstance.placeNode(targetPlacement, {clientX: 260, clientY: 20});
    const [source, target] = store.nodes();
    const selectPort = fixture.componentInstance as unknown as {selectPortForEdge(nodeId: string, portId: string): void};

    selectPort.selectPortForEdge(source.id, 'out');
    selectPort.selectPortForEdge(target.id, 'in');
    expect(store.bindings()).toHaveSize(1);

    advanced.undo();
    expect(store.bindings()).toHaveSize(0);
    advanced.redo();
    expect(store.bindings()).toHaveSize(1);
  });
});
