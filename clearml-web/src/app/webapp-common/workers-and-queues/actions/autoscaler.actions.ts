import {createActionGroup, emptyProps, props} from '@ngrx/store';

export interface AutoscalerSettingsData {
  connection_method?: 'openshift' | 'runai_application';
  openshift_login_mode?: 'fields' | 'command';
  openshift_api_url?: string;
  openshift_token?: string;
  openshift_login_command?: string;
  runai_cp_url?: string;
  runai_access_key?: string;
  runai_secret_key?: string;
  runai_cluster?: string;
  runai_project?: string;
  runai_cli_version?: 'auto' | 'v1' | 'v2';
  workload_logs_method?: 'api' | 'cli';
  user?: string;
  worker?: string;
}

export interface AutoscalerConnectionResult {
  connected: boolean;
  projects_count?: number;
  error?: string;
}

export interface AutoscalerComputeResource {
  name: string;
  gpu_devices_request?: string;
  gpu_memory_request?: string;
  gpu_portion_request?: string;
  cpu_core_request?: string;
  cpu_memory_request?: string;
}

export interface AutoscalerEnvironmentResource {
  name: string;
  image?: string;
  command?: string;
  args?: string;
  working_dir?: string;
  environment_variables?: string;
  run_as_uid?: string;
  run_as_gid?: string;
  supplemental_groups?: string;
}

export interface AutoscalerDataSourceResource {
  name: string;
  type?: string;
  existing_pvc?: string;
  path?: string;
}

export interface AutoscalerProjectResources {
  connected?: boolean;
  error?: string;
  refreshing?: boolean;
  execution_id?: string;
  project?: string;
  projects?: string[];
  compute?: AutoscalerComputeResource[];
  environments?: AutoscalerEnvironmentResource[];
  data_sources?: AutoscalerDataSourceResource[];
  node_pools?: string[];
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
  compute?: string;
  environment?: string;
  data_sources?: string;
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
  run_as_uid?: string;
  run_as_gid?: string;
  supplemental_groups?: string;
  existing_pvc?: string;
  working_dir?: string;
  large_shm?: boolean;
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
  projects_count?: number;
  result_data?: any;
}

export interface AutoscalerWorkloadLogs {
  connected?: boolean;
  error?: string;
  refreshing?: boolean;
  execution_id?: string;
  workload_name?: string;
  project?: string;
  source?: string;
  timestamp?: string;
  lines?: string[];
}

export interface AutoscalerWorkloadInfo {
  connected?: boolean;
  partial?: boolean;
  error?: string;
  errors?: Partial<Record<'details' | 'events' | 'logs' | 'metrics', string>>;
  workload_id?: string;
  details?: {
    name?: string;
    type?: string;
    status?: string;
    project?: string;
    cluster?: string;
    image?: string;
    gpus?: number;
    node_pool?: string;
    command?: string;
    created?: string;
    submitted_by?: string;
  };
  events?: Array<{
    time?: string;
    message?: string;
    reason?: string;
    level?: string;
    event_type?: string;
    issuer?: string;
    component?: string;
  }>;
  logs?: {lines?: string[]; source?: string};
  metrics?: {
    series?: Array<{
      id?: string;
      type?: string;
      labels?: Record<string, string>;
      points?: Array<{t?: string; v?: number | null}>;
    }>;
    averages?: Record<string, number>;
    range?: {start?: string; end?: string};
  };
}

export interface AutoscalerDashboardData {
  connected?: boolean;
  error?: string;
  refreshing?: boolean;
  execution_id?: string;
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
    workload_id?: string;
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
    'Get Project Resources': props<{project: string}>(),
    'Set Project Resources Loading': props<{loading: boolean}>(),
    'Set Project Resources': props<{resources: AutoscalerProjectResources}>(),
    'Delete Workload': props<{workload: {instance_id?: string; workload_name: string; workload_type?: string; project?: string}}>(),
    'Stop Workload': props<{workload: {instance_id?: string; workload_name: string; workload_type?: string; project?: string}}>(),
    'Get Workload Logs': props<{workload: {instance_id?: string; workload_name: string; workload_type?: string; project?: string}}>(),
    'Set Workload Logs Loading': props<{loading: boolean}>(),
    'Set Workload Logs': props<{logs: AutoscalerWorkloadLogs}>(),
    'Clear Workload Logs': emptyProps(),
    'Get Workload Info': props<{workloadId: string}>(),
    'Set Workload Info Loading': props<{loading: boolean}>(),
    'Set Workload Info': props<{info: AutoscalerWorkloadInfo}>(),
    'Clear Workload Info': emptyProps(),
    'Reset Settings': emptyProps(),
  }
});
