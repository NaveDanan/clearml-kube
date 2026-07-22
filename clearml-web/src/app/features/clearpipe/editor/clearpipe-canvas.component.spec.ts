import {ComponentFixture, TestBed} from '@angular/core/testing';
import {ClearpipeCanvasComponent} from './clearpipe-canvas.component';
import {ClearpipeStateService} from '../clearpipe-state.service';
import {emptyClearpipeDefinition} from '../clearpipe.models';

interface CanvasHarness {
  dropNode(event: {item: {data: string}; dropPoint: {x: number; y: number}}): void;
}

describe('ClearpipeCanvasComponent', () => {
  let fixture: ComponentFixture<ClearpipeCanvasComponent>;
  let state: ClearpipeStateService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ClearpipeCanvasComponent],
      providers: [ClearpipeStateService],
    }).compileComponents();
    fixture = TestBed.createComponent(ClearpipeCanvasComponent);
    state = TestBed.inject(ClearpipeStateService);
    state.load(emptyClearpipeDefinition());
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

  it('creates a palette node at the pointer location at default zoom', () => {
    (fixture.componentInstance as unknown as CanvasHarness).dropNode({
      item: {data: 'dataset'},
      dropPoint: {x: 340, y: 210},
    });

    expect(state.definition().nodes[0].type).toBe('dataset');
    expect(state.definition().nodes[0].position).toEqual({x: 240, y: 160});
  });

  it('converts palette drop coordinates through pan and non-default zoom', () => {
    state.setViewport({x: 40, y: -20, zoom: .5});

    (fixture.componentInstance as unknown as CanvasHarness).dropNode({
      item: {data: 'training'},
      dropPoint: {x: 340, y: 210},
    });

    expect(state.definition().nodes[0].type).toBe('training');
    expect(state.definition().nodes[0].position).toEqual({x: 400, y: 360});
  });
});
