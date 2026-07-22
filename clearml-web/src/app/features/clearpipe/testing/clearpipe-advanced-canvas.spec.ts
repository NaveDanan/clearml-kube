import {ComponentFixture, TestBed} from '@angular/core/testing';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {CanvasNodePlacement} from '../editor/clearpipe-canvas.adapter';
import {ClearpipeCanvasComponent} from '../editor/clearpipe-canvas.component';

const placement: CanvasNodePlacement = {
  kind: 'function',
  node: {label: 'Keyboard node', signature: 'def keyboard_node()', source: 'def keyboard_node():\n return 1', ports: [], configuration: {task_type: 'data_processing'}},
};

describe('CP-27 canvas keyboard workflow', () => {
  let fixture: ComponentFixture<ClearpipeCanvasComponent>;
  let store: GraphStoreService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({imports: [ClearpipeCanvasComponent], providers: [GraphStoreService]}).compileComponents();
    store = TestBed.inject(GraphStoreService);
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
});
