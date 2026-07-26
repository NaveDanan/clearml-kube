import {AutoscalerWorkloadData} from '@common/workers-and-queues/actions/autoscaler.actions';
import {ClearpipeFlowNode} from './clearpipe-flow.models';

const STRING_FIELDS: readonly (keyof AutoscalerWorkloadData)[] = [
  'project',
  'image',
  'command',
  'args',
  'environment_variables',
  'template',
  'compute',
  'environment',
  'data_sources',
  'cpu_core_request',
  'cpu_core_limit',
  'cpu_memory_request',
  'cpu_memory_limit',
  'gpu_devices_request',
  'gpu_memory_request',
  'gpu_portion_request',
  'gpu_request_type',
  'node_pools',
  'node_type',
  'priority',
  'preemptibility',
  'run_as_uid',
  'run_as_gid',
  'supplemental_groups',
  'existing_pvc',
  'working_dir',
  'parallelism',
  'runs',
  'restart_policy',
  'backoff_limit',
  'external_url',
  'serving_port',
  'min_replicas',
  'max_replicas',
  'initial_replicas',
  'metric',
  'metric_threshold',
  'scale_to_zero_retention',
];

const text = (value: unknown): string => value == null ? '' : String(value).trim();

/**
 * Produce the exact autoscaler.submit_workload payload used by the RunAI
 * Submit Workload dialog. Queue is intentionally absent: the RunAI platform
 * owns the spawned ClearML agent's hard-coded `runai` queue assignment.
 */
export const clearpipeAutoscalerWorkload = (node: ClearpipeFlowNode): AutoscalerWorkloadData => {
  const config = node.config;
  const workloadType = text(config['workload_type'] ?? config['workloadType']) || 'training';
  const dataSources = Array.isArray(config['data_sources'])
    ? config['data_sources'].map(text).filter(Boolean).join(',')
    : text(config['data_sources']);
  const workload: AutoscalerWorkloadData = {
    workload_type: workloadType,
    workload_name: text(config['workloadName'] ?? config['workload_name']) || node.label,
    image: text(config['image']),
    command: text(config['command']) || 'clearml-agent daemon',
  };

  for (const field of STRING_FIELDS) {
    if (field === 'image' || field === 'command' || field === 'data_sources') continue;
    const value = text(config[field]);
    if (value) (workload as unknown as Record<string, unknown>)[field] = value;
  }
  if (dataSources) workload.data_sources = dataSources;
  if (config['large_shm'] === true) workload.large_shm = true;
  return workload;
};

export const clearpipeAutoscalerIssues = (node: ClearpipeFlowNode): string[] => {
  const workload = clearpipeAutoscalerWorkload(node);
  const issues: string[] = [];
  if (!['training', 'workspace', 'inference'].includes(workload.workload_type)) {
    issues.push('Select a valid RunAI workload type.');
  }
  if (!workload.workload_name.trim()) issues.push('Enter a workload name.');
  if (!workload.image.trim() && !text(node.config['environment'])) {
    issues.push('Select a RunAI environment or enter its container image.');
  }
  return issues;
};
