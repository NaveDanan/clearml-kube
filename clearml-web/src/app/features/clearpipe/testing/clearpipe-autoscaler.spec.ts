import {
  clearpipeAutoscalerIssues,
  clearpipeAutoscalerWorkload,
} from '../editor/flow/clearpipe-autoscaler';
import {migrateFlowGraph} from '../editor/flow/clearpipe-flow-migration';
import {ClearpipeFlowGraph, ClearpipeFlowNode} from '../editor/flow/clearpipe-flow.models';

const autoscalerNode = (config: Record<string, unknown> = {}): ClearpipeFlowNode => ({
  id: 'autoscaler-1',
  type: 'autoscaler',
  position: {x: 0, y: 0},
  label: 'RunAI Agent',
  status: 'idle',
  config,
});

const graph = (node: ClearpipeFlowNode): ClearpipeFlowGraph => ({
  name: 'autoscaler-contract',
  activated: true,
  nodes: [node],
  edges: [],
  boundaries: [],
  viewport: {x: 0, y: 0, zoom: 1},
});

describe('ClearPipe AutoScaler Submit Workload contract', () => {
  it('uses the working dialog payload and never sends a ClearML queue', () => {
    const workload = clearpipeAutoscalerWorkload(autoscalerNode({
      queue: 'runai',
      workload_type: 'training',
      workloadName: 'agent-worker',
      project: 'ml-platform',
      image: 'registry.example/clearml-agent:latest',
      command: 'clearml-agent daemon',
      args: '--foreground',
      environment_variables: 'WORKER_NAME=runai-agent',
      environment: 'clearml-agent-environment',
      compute: 'gpu-small',
      data_sources: ['datasets', 'models'],
      gpu_devices_request: '1',
      cpu_core_request: '4',
      large_shm: true,
    }));

    expect(workload).toEqual(jasmine.objectContaining({
      workload_type: 'training',
      workload_name: 'agent-worker',
      project: 'ml-platform',
      image: 'registry.example/clearml-agent:latest',
      command: 'clearml-agent daemon',
      args: '--foreground',
      environment_variables: 'WORKER_NAME=runai-agent',
      environment: 'clearml-agent-environment',
      compute: 'gpu-small',
      data_sources: 'datasets,models',
      gpu_devices_request: '1',
      cpu_core_request: '4',
      large_shm: true,
    }));
    expect('queue' in workload).toBeFalse();
  });

  it('defaults the runtime command to a ClearML agent daemon', () => {
    const workload = clearpipeAutoscalerWorkload(autoscalerNode({
      workloadName: 'agent-worker',
      image: 'registry.example/clearml-agent:latest',
    }));

    expect(workload.command).toBe('clearml-agent daemon');
    expect(workload.workload_type).toBe('training');
    expect(clearpipeAutoscalerIssues(autoscalerNode({
      workloadName: 'agent-worker',
      image: 'registry.example/clearml-agent:latest',
    }))).toEqual([]);
  });

  it('accepts a RunAI template or environment without requiring a duplicate image', () => {
    expect(clearpipeAutoscalerIssues(autoscalerNode({
      workloadName: 'agent-worker',
      template: 'managed-agent-template',
    }))).toEqual([]);

    expect(clearpipeAutoscalerIssues(autoscalerNode({
      workloadName: 'agent-worker',
      environment: 'managed-agent-environment',
    }))).toEqual([]);

    expect(clearpipeAutoscalerIssues(autoscalerNode({
      workloadName: 'agent-worker',
    }))).toContain('Select a RunAI template or environment, or enter a container image.');
  });

  it('upgrades legacy saved nodes to the runtime defaults without persisting runtime state', () => {
    const result = migrateFlowGraph(graph(autoscalerNode({
      workloadName: 'legacy-agent',
      image: 'registry.example/clearml-agent:old',
      queue: 'runai',
    })));
    const config = result.graph.nodes[0].config;

    expect(result.changed).toBeTrue();
    expect(config['workload_type']).toBe('training');
    expect(config['command']).toBe('clearml-agent daemon');
    expect(config['autoscalerTimeoutSeconds']).toBe(600);
    expect(config['execution_id']).toBeUndefined();
  });
});
