import {flowBoundaryExecutionPlan} from '../editor/flow/clearpipe-flow-boundaries';
import {ClearpipeFlowGraph, ClearpipeFlowNode} from '../editor/flow/clearpipe-flow.models';
import {ClearpipeFlowStoreService} from '../editor/flow/clearpipe-flow-store.service';

const node = (id: string, x: number): ClearpipeFlowNode => ({
  id,
  type: id === 'report' ? 'report' : id === 'task' ? 'task' : id === 'dataset' ? 'dataset' : 'scheduled',
  position: {x, y: 40},
  label: id,
  status: 'idle',
  config: {},
});

const boundedGraph = (): ClearpipeFlowGraph => ({
  name: 'boundary-test',
  activated: true,
  nodes: [
    node('scheduled', 20),
    node('dataset', 330),
    node('task', 650),
    node('report', 970),
  ],
  edges: [
    {id: 'edge-1', source: 'scheduled', target: 'dataset'},
    {id: 'edge-2', source: 'dataset', target: 'task'},
    {id: 'edge-3', source: 'task', target: 'report'},
  ],
  boundaries: [{
    id: 'boundary-1',
    position: {x: 0, y: 0},
    width: 620,
    height: 260,
    label: 'Dataset boundary',
    onReach: 'stop',
  }],
  viewport: {x: 0, y: 0, zoom: 1},
});

describe('ClearPipe flow boundary execution', () => {
  it('cuts an exit edge and excludes every downstream node from the runtime plan', () => {
    const plan = flowBoundaryExecutionPlan(boundedGraph());

    expect([...plan.activeNodeIds]).toEqual(['scheduled', 'dataset']);
    expect([...plan.cutEdgeIds]).toEqual(['edge-2']);
    expect([...plan.excludedNodeIds]).toEqual(['task', 'report']);
    expect(plan.excludedByBoundary.get('task')).toBe('Dataset boundary');
    expect(plan.excludedByBoundary.get('report')).toBe('Dataset boundary');
  });

  it('shows boundary-excluded nodes as stopped and keeps hover/runtime updates transient', () => {
    const store = new ClearpipeFlowStoreService();
    store.load(boundedGraph());
    store.beginRun('run-1');

    expect(store.nodes().find(item => item.id === 'dataset')?.status).toBe('pending');
    expect(store.nodes().find(item => item.id === 'task')?.status).toBe('stopped');
    expect(store.nodes().find(item => item.id === 'report')?.statusMessage).toContain('Dataset boundary');

    store.setHoveredNode('dataset');
    store.applyRuntimeSnapshot([{
      graph_node_id: 'dataset',
      pipeline_step_name: 'Dataset',
      record_status: 'available',
      task_id: 'task-1',
      status: 'in_progress',
      artifacts: [{id: 'artifact-1', name: 'dataset'}],
    }]);

    expect(store.hoveredNodeId()).toBe('dataset');
    expect(store.runtimeNodes().get('dataset')?.task_id).toBe('task-1');
    expect(store.dirty()).toBeFalse();
  });
});
