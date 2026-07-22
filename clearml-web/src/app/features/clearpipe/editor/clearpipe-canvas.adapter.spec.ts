import {
  basicCanvasBindingPath,
  canvasGraphPointFromMinimapClientPoint,
  canvasMinimapLayout,
  canvasMinimapNode,
  canvasPointFromClientPoint,
  canvasPositionAfterDrag,
  canvasVisualAtClientZoom,
  fitCanvasVisual,
} from './clearpipe-canvas.adapter';
import {GraphNode} from '../domain/graph-v2.types';

const node = (id: string, x: number, y: number): GraphNode => ({
  id,
  kind: 'function',
  name: id,
  label: id,
  signature: `def ${id}() -> int`,
  source: `def ${id}() -> int:\n    return 1\n`,
  ports: [],
  configuration: {task_type: 'data_processing'},
  visual: {position: {x, y}},
});

describe('ClearPipe canvas adapter', () => {
  it('translates only client coordinates through the persisted visual transform', () => {
    expect(canvasPointFromClientPoint(
      {clientX: 340, clientY: 210},
      {left: 100, top: 50, width: 800, height: 600},
      {viewport: {x: 40, y: -20}, zoom: .5},
    )).toEqual({x: 400, y: 360});
  });

  it('converts drag distance outside the canonical graph', () => {
    expect(canvasPositionAfterDrag({x: 20, y: 30}, {x: 40, y: -20}, .5)).toEqual({x: 100, y: -10});
  });

  it('keeps the graph point under the pointer when zooming', () => {
    expect(canvasVisualAtClientZoom(
      {viewport: {x: 0, y: 0}, zoom: 1},
      {clientX: 500, clientY: 350},
      {left: 100, top: 50, width: 800, height: 600},
      2,
    )).toEqual({viewport: {x: -400, y: -300}, zoom: 2});
  });

  it('produces neutral visual binding paths and a fitted viewport', () => {
    const source = {node: node('source', 0, 0), dimensions: {width: 176, height: 72}};
    const target = {node: node('target', 400, 120), dimensions: {width: 176, height: 72}};

    expect(basicCanvasBindingPath({id: 'binding', source, target})).toContain('M 176 36');
    expect(fitCanvasVisual([source, target], {width: 800, height: 600})?.zoom).toBeGreaterThan(.35);
  });

  it('maps a rendered minimap extremity through the same inset content scale', () => {
    const source = {node: node('source', 0, 0), dimensions: {width: 176, height: 72}};
    const target = {node: node('target', 400, 120), dimensions: {width: 176, height: 72}};
    const layout = canvasMinimapLayout([source, target])!;
    const marker = canvasMinimapNode(target, layout);

    expect(canvasGraphPointFromMinimapClientPoint(
      {clientX: 32 + marker.left, clientY: 24 + marker.top},
      {left: 32, top: 24, width: 128, height: 72},
      layout,
    )).toEqual(target.node.visual.position);
  });
});
