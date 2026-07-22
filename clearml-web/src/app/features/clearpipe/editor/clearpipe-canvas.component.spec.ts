import {ComponentFixture, TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {CdkDrag} from '@angular/cdk/drag-drop';
import {ClearpipeCanvasComponent} from './clearpipe-canvas.component';
import {CanvasNodePlacement} from './clearpipe-canvas.adapter';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {GraphNode, GraphV2} from '../domain/graph-v2.types';

interface CanvasHarness {
  changeZoom(delta: number, event: MouseEvent): void;
  clearSelection(event?: Event): void;
  handleCanvasKeydown(event: KeyboardEvent): void;
  minimapNavigate(event: MouseEvent): void;
  nodeDragEnd(node: GraphNode, event: {distance: {x: number; y: number}; source: {reset(): void}}): void;
  selectNode(event: Event, nodeId: string): void;
}

const functionPlacement: CanvasNodePlacement = {
  kind: 'function',
  node: {
    label: 'Placed function',
    signature: 'def placed_function() -> int',
    source: 'def placed_function() -> int:\n    return 1\n',
    ports: [],
    configuration: {task_type: 'data_processing'},
  },
};

const largeGraph = (): GraphV2 => {
  const graph = createEmptyGraphV2({name: 'large_canvas_fixture'});
  return {
    ...graph,
    nodes: Array.from({length: 180}, (_, index) => ({
      id: `node-${index}`,
      kind: 'function' as const,
      name: `node_${index}`,
      label: `Node ${index}`,
      signature: 'def canvas_step() -> int',
      source: 'def canvas_step() -> int:\n    return 1\n',
      ports: [],
      configuration: {task_type: 'data_processing'},
      visual: {position: {x: (index % 18) * 220, y: Math.floor(index / 18) * 120}},
    })),
  };
};

describe('ClearpipeCanvasComponent', () => {
  let fixture: ComponentFixture<ClearpipeCanvasComponent>;
  let graphStore: GraphStoreService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClearpipeCanvasComponent],
      providers: [GraphStoreService],
    }).compileComponents();
    graphStore = TestBed.inject(GraphStoreService);
    expect(graphStore.load(createEmptyGraphV2()).status).toBe('ok');
    fixture = TestBed.createComponent(ClearpipeCanvasComponent);
    fixture.detectChanges();
    spyOn(fixture.nativeElement.querySelector('.canvas-surface'), 'getBoundingClientRect').and.returnValue({
      left: 100,
      top: 50,
      right: 900,
      bottom: 650,
      width: 800,
      height: 600,
      x: 100,
      y: 50,
      toJSON: () => ({}),
    });
  });

  it('renders an accessible empty canonical graph', () => {
    expect(fixture.nativeElement.querySelector('.canvas-surface')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Build a ClearPipe graph');
    expect(fixture.nativeElement.querySelector('[aria-label="Canvas controls"]')).not.toBeNull();
  });

  it('places a canonical node through a CP-10 command without retaining the library event', () => {
    const libraryEvent = {
      clientX: 340,
      clientY: 210,
      cdkDropPayload: {opaque: 'must-not-persist'},
    };

    fixture.componentInstance.placeNode(functionPlacement, libraryEvent);

    const node = graphStore.nodes()[0];
    expect(node.kind).toBe('function');
    expect(node.visual.position).toEqual({x: 240, y: 160});
    expect(graphStore.selectedNodeId()).toBe(node.id);
    expect(graphStore.serialize()).not.toContain('cdkDropPayload');
    expect(graphStore.serialize()).not.toContain('must-not-persist');
  });

  it('compensates CDK live drag at non-default zoom and commits the matching graph delta', () => {
    fixture.componentInstance.placeNode(functionPlacement, {clientX: 200, clientY: 150});
    const node = graphStore.nodes()[0];
    graphStore.setViewport({viewport: {x: 0, y: 0}, zoom: .5});
    fixture.detectChanges();
    const reset = jasmine.createSpy('reset');

    expect(fixture.debugElement.query(By.directive(CdkDrag)).injector.get(CdkDrag).scale).toBe(.5);
    (fixture.componentInstance as unknown as CanvasHarness).nodeDragEnd(node, {
      distance: {x: 50, y: 30},
      source: {reset},
    });

    expect(graphStore.node(node.id)?.visual.position).toEqual({x: 200, y: 160});
    expect(graphStore.draggingNodeId()).toBeNull();
    expect(reset).toHaveBeenCalled();
    expect(graphStore.serialize()).not.toContain('distance');
    expect(graphStore.load(graphStore.serialize()!).status).toBe('ok');
    expect(graphStore.node(node.id)?.visual.position).toEqual({x: 200, y: 160});
  });

  it('maps a click on a rendered minimap node through its content bounds', () => {
    fixture.componentInstance.placeNode(functionPlacement, {clientX: 200, clientY: 150});
    fixture.componentInstance.placeNode(functionPlacement, {clientX: 500, clientY: 250});
    fixture.detectChanges();
    const minimapContent = fixture.nativeElement.querySelector('.canvas-minimap__content') as HTMLElement;
    spyOn(minimapContent, 'getBoundingClientRect').and.returnValue({
      left: 20,
      top: 30,
      right: 148,
      bottom: 102,
      width: 128,
      height: 72,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    });
    const marker = fixture.nativeElement.querySelectorAll('.canvas-minimap__node')[1] as HTMLElement;
    const target = graphStore.nodes()[1];

    (fixture.componentInstance as unknown as CanvasHarness).minimapNavigate({
      clientX: 20 + Number.parseFloat(marker.style.left),
      clientY: 30 + Number.parseFloat(marker.style.top),
    } as MouseEvent);

    expect(graphStore.graph()?.visual.viewport.x).toBeCloseTo(400 - target.visual.position.x);
    expect(graphStore.graph()?.visual.viewport.y).toBeCloseTo(300 - target.visual.position.y);
  });

  it('uses CP-10 transient selection and supports clearing it', () => {
    fixture.componentInstance.placeNode(functionPlacement, {clientX: 200, clientY: 150});
    const node = graphStore.nodes()[0];
    const event = {stopPropagation: jasmine.createSpy('stopPropagation')} as unknown as Event;

    (fixture.componentInstance as unknown as CanvasHarness).selectNode(event, node.id);
    expect(graphStore.selectedNodeId()).toBe(node.id);

    (fixture.componentInstance as unknown as CanvasHarness).clearSelection();
    expect(graphStore.selectedNodeId()).toBeNull();
  });

  it('returns canvas focus after a pointer node selection without stealing form control focus', () => {
    fixture.componentInstance.placeNode(functionPlacement, {clientX: 200, clientY: 150});
    fixture.detectChanges();
    const surface = fixture.nativeElement.querySelector('.canvas-surface') as HTMLDivElement;
    const node = fixture.nativeElement.querySelector('.canvas-node-position') as HTMLDivElement;
    const focus = spyOn(surface, 'focus');
    const input = document.createElement('input');
    node.appendChild(input);

    input.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(focus).not.toHaveBeenCalled();
    node.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    expect(focus).toHaveBeenCalledWith({preventScroll: true});

    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true, cancelable: true}));
    expect(graphStore.nodes()).toHaveSize(0);
  });

  it('returns canvas focus after background panning so arrow keys remain reachable', () => {
    const surface = fixture.nativeElement.querySelector('.canvas-surface') as HTMLDivElement;
    const focus = spyOn(surface, 'focus');

    surface.dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0, clientX: 200, clientY: 150}));
    surface.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0, clientX: 200, clientY: 150}));
    expect(focus).toHaveBeenCalledWith({preventScroll: true});

    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft', bubbles: true, cancelable: true}));
    expect(graphStore.graph()?.visual.viewport.x).toBe(24);
  });

  it('persists viewport controls through the graph command', () => {
    const event = {stopPropagation: jasmine.createSpy('stopPropagation')} as unknown as MouseEvent;

    (fixture.componentInstance as unknown as CanvasHarness).changeZoom(.1, event);

    expect(graphStore.graph()?.visual.zoom).toBeCloseTo(1.1);
    expect(graphStore.graph()?.visual.viewport.x).toBeCloseTo(-40);
    expect(graphStore.graph()?.visual.viewport.y).toBeCloseTo(-30);
    expect(graphStore.serialize()).toContain('"visual"');
  });

  it('renders a representative large fixture without retaining a rendered-node copy', () => {
    expect(graphStore.load(largeGraph()).status).toBe('ok');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('[data-node-id]').length).toBe(180);
    expect(graphStore.nodes().length).toBe(180);
    expect((fixture.componentInstance as unknown as {nodeViews: () => unknown[]}).nodeViews().length).toBe(180);
  });
});
