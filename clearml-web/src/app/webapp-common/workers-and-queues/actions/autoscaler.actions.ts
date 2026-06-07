import {createActionGroup, emptyProps, props} from '@ngrx/store';

export interface AutoscalerSettingsData {
  connection_method?: 'openshift' | 'runai_application';
  openshift_login_mode?: 'fields' | 'command';
  openshift_api_url?: string;
  openshift_token?: string;
  openshift_login_command?: string;
  runai_access_key?: string;
  runai_secret_key?: string;
  runai_cluster?: string;
  runai_project?: string;
  runai_cli_version?: 'auto' | 'v1' | 'v2';
  user?: string;
  worker?: string;
}

export interface AutoscalerConnectionResult {
  connected: boolean;
  projects_count?: number;
  error?: string;
}

export interface AutoscalerWorkloadData {
  workload_type: string;
  workload_name: string;
  project?: string;
  image: string;
  command_override?: boolean;
  command?: string;
  args?: string;
  environment_variables?: string;
  template?: string;
  cpu_core_request?: string;
  cpu_core_limit?: string;
  cpu_memory_request?: string;
  cpu_memory_limit?: string;
  gpu_devices_request?: string;
  gpu_memory_request?: string;
  gpu_portion_request?: string;
  gpu_request_type?: string;
  node_pools?: string;
  node_type?: string;
  priority?: string;
  preemptibility?: string;
  existing_pvc?: string;
  working_dir?: string;
  parallelism?: string;
  runs?: string;
  restart_policy?: string;
  backoff_limit?: string;
  external_url?: string;
  serving_port?: string;
  min_replicas?: string;
  max_replicas?: string;
  initial_replicas?: string;
  metric?: string;
  metric_threshold?: string;
  scale_to_zero_retention?: string;
}

export interface AutoscalerExecution {
  status: 'queued' | 'pending' | 'running' | 'success' | 'error';
  stdout?: string;
  stderr?: string;
  timestamp?: string;
  execution_id?: string;
  return_code?: string;
}

export interface AutoscalerDashboardData {
  connected?: boolean;
  error?: string;
  timestamp?: string;
  idle_instances?: number;
  running_instances?: number;
  pending_instances?: number;
  failed_instances?: number;
  total_instances?: number;
  status_counts?: Record<string, number>;
  resources?: {
    gpu_total?: number;
    gpu_allocated?: number;
    gpu_requested?: number;
    cpu_total?: number;
    cpu_allocated?: number;
    node_count?: number;
    project_count?: number;
  };
  queues?: Array<{
    name?: string;
    running?: number;
    pending?: number;
    gpu_allocated?: number;
    gpu_limit?: number;
  }>;
  instances?: Array<{
    name?: string;
    type?: string;
    status?: string;
    project?: string;
    gpus?: number;
    age?: string;
  }>;
  saved_instances?: Array<{
    id?: string;
    name?: string;
    type?: string;
    status?: string;
    project?: string;
    source?: string;
    user?: string;
    worker?: string;
    created?: string;
    last_update?: string;
    workload?: AutoscalerWorkloadData;
  }>;
  console_log?: Array<{
    timestamp?: string;
    command?: string;
    status?: string;
    message?: string;
  }>;
}

export const autoscalerActions = createActionGroup({
  source: 'Autoscaler',
  events: {
    'Get Settings': emptyProps(),
    'Set Settings': props<{settings: AutoscalerSettingsData}>(),
    'Update Settings': props<{settings: any}>(),
    'Test Connection': props<{settings: any}>(),
    'Set Connection Status': props<{status: 'idle' | 'testing' | 'success' | 'error'}>(),
    'Set Connection Result': props<{result: AutoscalerConnectionResult | null}>(),
    'Submit Workload': props<{workload: any}>(),
    'Save App Instance': props<{workload: any}>(),
    'Set Last Execution': props<{execution: AutoscalerExecution}>(),
    'Get Dashboard': emptyProps(),
    'Set Dashboard Loading': props<{loading: boolean}>(),
    'Set Dashboard': props<{dashboard: AutoscalerDashboardData}>(),
    'Set Dashboard Error': props<{error: string}>(),
    'Delete Workload': props<{workload: {instance_id?: string; workload_name: string; workload_type?: string; project?: string}}>(),
    'Reset Settings': emptyProps(),
  }
});
