import {ComponentFixture, TestBed} from '@angular/core/testing';
import {GraphBindingInput, GraphStoreService} from '../domain/graph-store.service';
import {GraphPort, GraphV2} from '../domain/graph-v2.types';
import {ClearpipeSemanticEdgeController} from '../editor/edges/clearpipe-semantic-edge.controller';
import {evaluateSemanticEdge} from '../editor/edges/clearpipe-port-compatibility';
import {semanticCanvasEdges} from '../editor/edges/clearpipe-semantic-edge.renderer';
import {ClearpipeCanvasComponent} from '../editor/clearpipe-canvas.component';
import {createEmptyGraphV2} from '../domain/graph-store.service';

const port = (
  id: string,
  direction: GraphPort['direction'],
  accepted: GraphPort['accepted_binding_kinds'],
  multiplicity: GraphPort['multiplicity'] = 'many',
  order = 0,
): GraphPort => ({
  id,
  kind: 'port',
  name: id,
  direction,
  role: id.includes('param') ? 'parameter' : 'data',
  required: false,
  multiplicity,
  accepted_binding_kinds: accepted,
  order,
});

const graphFixture = (): GraphV2 => ({
  ...createEmptyGraphV2({name: 'semantic_edge_fixture'}),
  parameters: [{id: 'parameter-1', name: 'parameter_1', required: false, order: 0}],
  resources: [{id: 'resource-1', kind: 'dataset', resource_id: 'dataset-1'}],
  nodes: [
    {
      id: 'a', name: 'a', label: 'Source A', kind: 'function', signature: 'def a() -> int', source: 'def a() -> int:\n return 1',
      configuration: {task_type: 'data_processing'}, visual: {position: {x: 0, y: 0}},
      ports: [port('a-out', 'output', ['data', 'artifact']), port('a-in', 'input', ['data'])],
    },
    {
      id: 'b', name: 'b', label: 'Target B', kind: 'function', signature: 'def b() -> int', source: 'def b() -> int:\n return 1',
      configuration: {task_type: 'data_processing'}, visual: {position: {x: 260, y: 0}},
      ports: [port('b-in', 'input', ['data'], 'single'), port('b-out', 'output', ['data'])],
    },
    {
      id: 'c', name: 'c', label: 'Target C', kind: 'function', signature: 'def c() -> int', source: 'def c() -> int:\n return 1',
      configuration: {task_type: 'data_processing'}, visual: {position: {x: 520, y: 0}},
      ports: [
        port('c-in', 'input', ['data', 'artifact']),
        port('c-out', 'output', ['data']),
        port('c-param', 'input', ['parameter'], 'many', 1),
      ],
    },
  ],
});

const data = (sourceNode = 'a', sourcePort = 'a-out', targetNode = 'b', targetPort = 'b-in'): GraphBindingInput => ({
  kind: 'data',
  source: {kind: 'port', node_id: sourceNode, port_id: sourcePort},
  target: {kind: 'port', node_id: targetNode, port_id: targetPort},
});

describe('ClearPipe semantic edges', () => {
  let store: GraphStoreService;
  let controller: ClearpipeSemanticEdgeController;
  let fixture: ComponentFixture<ClearpipeCanvasComponent>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [ClearpipeCanvasComponent],
      providers: [GraphStoreService, ClearpipeSemanticEdgeController],
    }).compileComponents();
    store = TestBed.inject(GraphStoreService);
    controller = TestBed.inject(ClearpipeSemanticEdgeController);
    expect(store.load(graphFixture()).status).toBe('ok');
    fixture = TestBed.createComponent(ClearpipeCanvasComponent);
    fixture.detectChanges();
  });

  it('creates, selects, labels, and removes an accessible canonical edge without persisting gesture state', () => {
    expect(fixture.componentInstance.createSemanticBinding(data()).eligible).toBeTrue();
    fixture.detectChanges();

    const edge = fixture.nativeElement.querySelector('path[role="button"]') as SVGPathElement;
    expect(store.bindings()).toHaveSize(1);
    expect(edge.getAttribute('aria-label')).toContain('Source A output a-out to Target B input b-in; data binding');
    edge.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    fixture.detectChanges();
    const remove = fixture.nativeElement.querySelector('[aria-label="Delete selected binding"]') as HTMLButtonElement;
    expect(remove).not.toBeNull();
    expect(store.serialize()).not.toContain('Output a-out selected');
    expect(store.serialize()).not.toContain('semanticEdges');
    remove.click();
    expect(store.bindings()).toHaveSize(0);
  });

  it('accepts every canonical binding kind through the shared compatibility API', () => {
    const graph = store.graph()!;
    expect(evaluateSemanticEdge(graph, data()).eligible).toBeTrue();
    expect(evaluateSemanticEdge(graph, {
      kind: 'artifact',
      source: {kind: 'port', node_id: 'a', port_id: 'a-out'},
      target: {kind: 'port', node_id: 'c', port_id: 'c-in'},
    }).eligible).toBeTrue();
    expect(evaluateSemanticEdge(graph, {
      kind: 'artifact',
      source: {kind: 'resource', resource_id: 'resource-1'},
      target: {kind: 'port', node_id: 'c', port_id: 'c-in'},
    }).eligible).toBeTrue();
    expect(evaluateSemanticEdge(graph, {
      kind: 'parameter',
      source: {kind: 'parameter', parameter_id: 'parameter-1'},
      target: {kind: 'port', node_id: 'c', port_id: 'c-param'},
    }).eligible).toBeTrue();
    expect(evaluateSemanticEdge(graph, {
      kind: 'inferred',
      source: {kind: 'node', node_id: 'a'},
      target: {kind: 'node', node_id: 'b'},
      derived_from: {kind: 'port', node_id: 'a', port_id: 'a-out'},
    }).eligible).toBeTrue();
    expect(evaluateSemanticEdge(graph, {
      kind: 'execution-only',
      source: {kind: 'node', node_id: 'a'},
      target: {kind: 'node', node_id: 'b'},
    }).eligible).toBeTrue();
  });

  it('reports a textual reason for every rejected edge class', () => {
    const graph = store.graph()!;
    const rejected = (candidate: GraphBindingInput, reason: string): void => {
      const result = evaluateSemanticEdge(graph, candidate);
      expect(result.eligible).withContext(reason).toBeFalse();
      expect(result.reason).withContext(reason).toBe(reason);
      expect(result.message.length).withContext(reason).toBeGreaterThan(10);
    };

    rejected(data('missing', 'a-out'), 'unknown_port');
    rejected({
      kind: 'execution-only',
      source: {kind: 'node', node_id: 'missing'},
      target: {kind: 'node', node_id: 'b'},
    }, 'unknown_node');
    rejected(data('a', 'missing'), 'unknown_port');
    rejected({
      kind: 'artifact',
      source: {kind: 'resource', resource_id: 'missing'},
      target: {kind: 'port', node_id: 'c', port_id: 'c-in'},
    }, 'unknown_resource');
    rejected({
      kind: 'parameter',
      source: {kind: 'parameter', parameter_id: 'missing'},
      target: {kind: 'port', node_id: 'c', port_id: 'c-param'},
    }, 'unknown_parameter');
    rejected(data('b', 'b-in', 'c', 'c-in'), 'invalid_port_direction');
    rejected({
      kind: 'artifact',
      source: {kind: 'port', node_id: 'a', port_id: 'a-out'},
      target: {kind: 'port', node_id: 'b', port_id: 'b-in'},
    }, 'binding_not_accepted');
    rejected(data('a', 'a-out', 'a', 'a-in'), 'self_connection');
    rejected({
      kind: 'control' as GraphBindingInput['kind'],
      source: {kind: 'port', node_id: 'a', port_id: 'a-out'},
      target: {kind: 'port', node_id: 'b', port_id: 'b-in'},
    } as unknown as GraphBindingInput, 'invalid_binding_kind');
  });

  it('prevents duplicate and single-input multiplicity with a reason', () => {
    expect(controller.create(data()).eligible).toBeTrue();
    expect(controller.create(data()).reason).toBe('duplicate_binding');
    expect(controller.create(data('c', 'c-out')).reason).toBe('port_multiplicity_exceeded');
  });

  it('creates, reconnects, removes, and reloads exact canonical metadata', () => {
    const created = controller.create(data());
    expect(created.eligible).toBeTrue();
    expect(created.id).toBeDefined();
    const bindingId = created.id!;

    const reconnected = controller.reconnect(bindingId, data('a', 'a-out', 'c', 'c-in'));
    expect(reconnected.eligible).toBeTrue();
    expect(store.bindings()[0]).toEqual(jasmine.objectContaining({
      id: bindingId,
      kind: 'data',
      source: {kind: 'port', node_id: 'a', port_id: 'a-out'},
      target: {kind: 'port', node_id: 'c', port_id: 'c-in'},
    }));
    const serialized = store.serialize()!;
    expect(serialized).not.toContain('gesture');
    expect(store.load(serialized).status).toBe('ok');
    expect(store.bindings()[0].id).toBe(bindingId);
    expect(controller.remove(bindingId).eligible).toBeTrue();
    expect(store.bindings()).toHaveSize(0);
  });

  it('blocks cycles through both create and reconnection paths', () => {
    expect(controller.create(data('a', 'a-out', 'b', 'b-in')).eligible).toBeTrue();
    expect(controller.create(data('b', 'b-out', 'c', 'c-in')).eligible).toBeTrue();
    expect(controller.create(data('c', 'c-out', 'a', 'a-in')).reason).toBe('graph_cycle');

    const direct = controller.create(data('a', 'a-out', 'c', 'c-in'));
    expect(direct.eligible).toBeTrue();
    expect(controller.reconnect(direct.id!, data('c', 'c-out', 'a', 'a-in')).reason).toBe('graph_cycle');
  });

  it('removes deleted endpoints and rejects stale endpoint connections', () => {
    const created = controller.create(data());
    expect(created.eligible).toBeTrue();
    expect(store.removePort('a', 'a-out').ok).toBeTrue();
    expect(store.bindings()).toHaveSize(0);
    expect(controller.create(data()).reason).toBe('unknown_port');
  });

  it('renders accessible source output, target input, and binding-kind labels without persisting render state', () => {
    const created = controller.create(data());
    const graph = store.graph()!;
    const views = graph.nodes.map((node) => ({node, dimensions: {width: 180, height: 80}}));
    const edge = semanticCanvasEdges(views, store.bindings(), () => ({width: 180, height: 80}))[0];

    expect(edge.label).toContain('Source A output a-out');
    expect(edge.label).toContain('Target B input b-in');
    expect(edge.label).toContain('data binding');
    expect(store.serialize()).not.toContain(edge.path);
    expect(created.id).toBe(edge.id);
  });
});
