import {ChangeDetectionStrategy, Component, OnDestroy, TemplateRef, computed, effect, inject, signal} from '@angular/core';
import {Store} from '@ngrx/store';
import {NgTemplateOutlet} from '@angular/common';
import {AbstractControl, FormBuilder, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatButton, MatIconButton} from '@angular/material/button';
import {MatIcon} from '@angular/material/icon';
import {MatTabsModule} from '@angular/material/tabs';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatMenuModule} from '@angular/material/menu';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {ActivatedRoute, Router} from '@angular/router';
import {autoscalerActions} from '../../actions/autoscaler.actions';
import {
  selectAutoscalerSettings,
  selectAutoscalerConnectionStatus,
  selectAutoscalerConnectionResult,
  selectAutoscalerDashboard,
  selectAutoscalerDashboardError,
  selectAutoscalerDashboardLoading,
  selectAutoscalerLastExecution
} from '../../reducers/index.reducer';
import {Subscription} from 'rxjs';

export type WorkloadType = 'training' | 'workspace' | 'inference';
type ConnectionMethod = 'openshift' | 'runai_application';
type OpenshiftLoginMode = 'fields' | 'command';
type RunaiCliVersion = 'auto' | 'v1' | 'v2';
type ImportMode = 'command' | 'json';
type AppInstanceSource = 'runai' | 'local';

type WorkloadFormValue = Partial<{
  workload_type: WorkloadType;
  workload_name: string;
  project: string;
  image: string;
  command_override: boolean;
  command: string;
  args: string;
  environment_variables: string;
  template: string;
  cpu_core_request: string;
  cpu_core_limit: string;
  cpu_memory_request: string;
  cpu_memory_limit: string;
  gpu_devices_request: string;
  gpu_memory_request: string;
  gpu_portion_request: string;
  gpu_request_type: string;
  node_pools: string;
  node_type: string;
  priority: string;
  preemptibility: string;
  existing_pvc: string;
  working_dir: string;
  parallelism: string;
  runs: string;
  restart_policy: string;
  backoff_limit: string;
  external_url: string;
  serving_port: string;
  min_replicas: string;
  max_replicas: string;
  initial_replicas: string;
  metric: string;
  metric_threshold: string;
  scale_to_zero_retention: string;
}>;

interface AppInstance {
  key: string;
  id?: string;
  source: AppInstanceSource;
  name: string;
  type?: string;
  status?: string;
  project?: string;
  gpus?: number;
  age?: string;
  workload?: WorkloadFormValue;
}

@Component({
  selector: 'sm-autoscaler',
  templateUrl: './autoscaler.component.html',
  styleUrls: ['./autoscaler.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButton,
    MatIconButton,
    MatIcon,
    MatTabsModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatMenuModule,
    MatDialogModule,
    ReactiveFormsModule,
    NgTemplateOutlet,
  ]
})
export class AutoscalerComponent implements OnDestroy {
  private store = inject(Store);
  private fb = inject(FormBuilder);
  private dialog = inject(MatDialog);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private dashboardRefreshId?: ReturnType<typeof setInterval>;
  private formSubscription = new Subscription();

  protected selectedProvider = signal<'runai' | null>(null);
  protected importedWorkloads = signal<WorkloadFormValue[]>([]);
  protected selectedInstanceKey = signal<string | null>(null);
  protected importError = signal<string | null>(null);
  protected settings = this.store.selectSignal(selectAutoscalerSettings);
  protected connectionStatus = this.store.selectSignal(selectAutoscalerConnectionStatus);
  protected connectionResult = this.store.selectSignal(selectAutoscalerConnectionResult);
  protected lastExecution = this.store.selectSignal(selectAutoscalerLastExecution);
  protected dashboard = this.store.selectSignal(selectAutoscalerDashboard);
  protected dashboardLoading = this.store.selectSignal(selectAutoscalerDashboardLoading);
  protected dashboardError = this.store.selectSignal(selectAutoscalerDashboardError);
  protected resourceBars = computed(() => {
    const resources = this.dashboard()?.resources;
    return [
      {
        label: 'Allocated',
        value: resources?.gpu_allocated || 0,
        height: this.barHeight(resources?.gpu_allocated || 0, resources?.gpu_total || 0),
      },
      {
        label: 'Requested',
        value: resources?.gpu_requested || 0,
        height: this.barHeight(resources?.gpu_requested || 0, resources?.gpu_total || 0),
      },
    ];
  });
  protected instanceGaugePercent = computed(() => {
    const dashboard = this.dashboard();
    const total = dashboard?.total_instances || 0;
    if (!total) {
      return 0;
    }
    return Math.min(100, Math.round(((dashboard?.running_instances || 0) / total) * 100));
  });
  protected hasCompletedWorkloads = computed(() => {
    const dashboard = this.dashboard();
    const statusCounts = dashboard?.status_counts ?? {};
    const hasCompletedStatusCount = Object.entries(statusCounts)
      .some(([status, count]) => this.isCompletedWorkloadStatus(status) && count > 0);

    return hasCompletedStatusCount ||
      (dashboard?.instances ?? []).some(instance => this.isCompletedWorkloadStatus(instance.status));
  });
  protected appInstances = computed<AppInstance[]>(() => {
    const savedInstances = (this.dashboard()?.saved_instances ?? []).map((instance, index) => ({
      key: this.instanceKey('local', instance.name, instance.project, index),
      id: instance.id,
      source: 'local' as const,
      name: instance.name || `Saved workload ${index + 1}`,
      type: instance.type,
      status: instance.status || 'saved',
      project: instance.project,
      gpus: Number(instance.workload?.gpu_devices_request) || 0,
      age: instance.created || '',
      workload: instance.workload as WorkloadFormValue,
    }));
    const liveInstances = (this.dashboard()?.instances ?? []).map(instance => ({
      key: this.instanceKey('runai', instance.name, instance.project),
      source: 'runai' as const,
      name: instance.name || 'Unnamed workload',
      type: instance.type,
      status: instance.status,
      project: instance.project,
      gpus: instance.gpus,
      age: instance.age,
    }));
    const localInstances = this.importedWorkloads().map((workload, index) => ({
      key: this.instanceKey('local', workload.workload_name || `imported-${index}`, workload.project),
      source: 'local' as const,
      name: workload.workload_name || `Imported workload ${index + 1}`,
      type: workload.workload_type,
      status: 'imported',
      project: workload.project,
      gpus: Number(workload.gpu_devices_request) || 0,
      age: '',
      workload,
    })).filter(instance => !savedInstances.some(saved => saved.name === instance.name && saved.project === instance.project));
    return [...liveInstances, ...savedInstances, ...localInstances];
  });
  protected selectedInstance = computed(() => {
    const instances = this.appInstances();
    return instances.find(instance => instance.key === this.selectedInstanceKey()) ?? instances[0] ?? null;
  });
  protected consoleLines = computed(() => {
    const logs = this.dashboard()?.console_log || [];
    if (!logs.length) {
      return ['Waiting for live Run:ai refresh data'];
    }
    return logs.map(log => [
      log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : '',
      log.status?.toUpperCase(),
      log.command,
      log.message,
    ].filter(Boolean).join(' | '));
  });
  protected selectedConsoleLines = computed(() => {
    const selected = this.selectedInstance();
    const lines = this.consoleLines();
    if (!selected) {
      return lines;
    }
    const filtered = lines.filter(line => line.includes(selected.name));
    return filtered.length ? filtered : lines;
  });

  connectionForm = this.fb.group({
    connection_method: ['openshift' as ConnectionMethod, Validators.required],
    openshift_login_mode: ['fields' as OpenshiftLoginMode],
    openshift_api_url: [''],
    openshift_token: [''],
    openshift_login_command: [''],
    runai_access_key: [''],
    runai_secret_key: [''],
    runai_cluster: [''],
    runai_project: [''],
    runai_cli_version: ['auto' as RunaiCliVersion],
  });

  workloadForm = this.fb.group({
    workload_type: ['training' as WorkloadType, Validators.required],
    workload_name: ['', Validators.required],
    project: [''],
    image: ['', Validators.required],
    command_override: [false],
    command: [''],
    args: [''],
    environment_variables: [''],
    template: [''],
    // CPU / Memory
    cpu_core_request: [''],
    cpu_core_limit: [''],
    cpu_memory_request: [''],
    cpu_memory_limit: [''],
    // GPU
    gpu_devices_request: [''],
    gpu_memory_request: [''],
    gpu_portion_request: [''],
    gpu_request_type: [''],
    // Scheduling
    node_pools: [''],
    node_type: [''],
    priority: [''],
    preemptibility: [''],
    // Storage
    existing_pvc: [''],
    working_dir: [''],
    // Training-specific
    parallelism: [''],
    runs: [''],
    restart_policy: [''],
    backoff_limit: [''],
    // Workspace-specific
    external_url: [''],
    // Inference-specific
    serving_port: [''],
    min_replicas: [''],
    max_replicas: [''],
    initial_replicas: [''],
    metric: [''],
    metric_threshold: [''],
    scale_to_zero_retention: [''],
  });

  importForm = this.fb.group({
    mode: ['command' as ImportMode, Validators.required],
    command: [''],
    json: [''],
  });

  constructor() {
    this.store.dispatch(autoscalerActions.getSettings());
    this.formSubscription.add(this.connectionForm.controls.connection_method.valueChanges.subscribe(() => this.updateConnectionValidators()));
    this.formSubscription.add(this.connectionForm.controls.openshift_login_mode.valueChanges.subscribe(() => this.updateConnectionValidators()));
    this.updateConnectionValidators();

    effect(() => {
      if (this.selectedProvider() !== 'runai') {
        return;
      }

      this.patchConnectionFormFromSettings();
    });

    if (this.isRunaiRoute()) {
      this.selectedProvider.set('runai');
      this.refreshDashboard();
      this.startDashboardRefresh();
    }
  }

  ngOnDestroy() {
    this.stopDashboardRefresh();
    this.formSubscription.unsubscribe();
  }

  selectProvider(provider: 'runai') {
    if (provider === 'runai') {
      this.router.navigateByUrl('/workers-and-queues/autoscalers/runai-autoscaler');
    }
  }

  back() {
    this.router.navigateByUrl('/workers-and-queues/autoscalers');
  }

  saveConnection() {
    this.store.dispatch(autoscalerActions.updateSettings({settings: this.connectionForm.value}));
    this.connectionForm.markAsPristine();
    this.refreshDashboard();
  }

  testConnection() {
    this.store.dispatch(autoscalerActions.testConnection({settings: this.connectionForm.value}));
  }

  openConnectionDialog(template: TemplateRef<unknown>) {
    this.dialog.open(template, {
      width: '760px',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'runai-connection-dialog',
      autoFocus: false,
    });
  }

  openWorkloadDialog(template: TemplateRef<unknown>, reset = true) {
    if (reset) {
      this.resetWorkload();
    }
    this.dialog.open(template, {
      width: '960px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
      panelClass: 'runai-workload-dialog',
      autoFocus: false,
    });
  }

  openImportDialog(template: TemplateRef<unknown>) {
    this.importForm.reset({mode: 'command', command: '', json: ''});
    this.importError.set(null);
    this.dialog.open(template, {
      width: '760px',
      maxWidth: 'calc(100vw - 32px)',
      panelClass: 'runai-import-dialog',
      autoFocus: false,
    });
  }

  openImportedWorkloadDetails(template: TemplateRef<unknown>) {
    const workload = this.selectedInstance()?.workload;
    if (workload) {
      this.applyImportedWorkload(workload, false);
    }
    this.openWorkloadDialog(template, false);
  }

  openInstanceDetails(event: Event, instance: AppInstance, template: TemplateRef<unknown>) {
    event.stopPropagation();
    this.selectInstance(instance);
    const workload = instance.workload ?? {
      workload_type: (instance.type as WorkloadType) || 'training',
      workload_name: instance.name,
      project: instance.project,
      gpu_devices_request: instance.gpus ? `${instance.gpus}` : '',
    };
    this.applyImportedWorkload(workload, false);
    this.openWorkloadDialog(template, false);
  }

  selectInstance(instance: AppInstance) {
    this.selectedInstanceKey.set(instance.key);
  }

  deleteInstance(event: Event, instance: AppInstance) {
    event.stopPropagation();
    if (instance.source === 'local') {
      this.importedWorkloads.update(workloads => workloads.filter(workload => workload !== instance.workload));
      if (this.selectedInstanceKey() === instance.key) {
        this.selectedInstanceKey.set(null);
      }
      if (instance.id) {
        this.store.dispatch(autoscalerActions.deleteWorkload({
          workload: {
            instance_id: instance.id,
            workload_name: instance.name,
            workload_type: instance.type,
            project: instance.project,
          },
        }));
      }
      return;
    }

    this.store.dispatch(autoscalerActions.deleteWorkload({
      workload: {
        workload_name: instance.name,
        workload_type: instance.type,
        project: instance.project,
        instance_id: instance.id,
      },
    }));
  }

  importConfiguration(template: TemplateRef<unknown>) {
    const mode = this.importForm.controls.mode.value;
    const source = mode === 'json' ? this.importForm.controls.json.value : this.importForm.controls.command.value;
    const workload = mode === 'json' ? this.parseWorkloadJson(source) : this.parseRunaiCommand(source);

    if (!workload) {
      return;
    }

    this.dialog.closeAll();
    this.applyImportedWorkload(workload);
    this.openWorkloadDialog(template, false);
  }

  importJsonFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      this.importForm.patchValue({
        mode: 'json',
        json: String(reader.result ?? ''),
      });
      this.importError.set(null);
      input.value = '';
    };
    reader.onerror = () => this.importError.set('Could not read the selected JSON file');
    reader.readAsText(file);
  }

  submitWorkload() {
    const workload = this.workloadForm.getRawValue() as WorkloadFormValue;
    this.rememberLocalWorkload(workload);
    this.store.dispatch(autoscalerActions.submitWorkload({
      workload
    }));
  }

  resetConnection() {
    this.patchConnectionFormFromSettings();
    this.connectionForm.markAsPristine();
  }

  resetWorkload() {
    this.workloadForm.reset({workload_type: 'training'});
    this.workloadForm.markAsPristine();
  }

  protected importReady() {
    const mode = this.importForm.controls.mode.value;
    return !!(mode === 'json' ? this.importForm.controls.json.value?.trim() : this.importForm.controls.command.value?.trim());
  }

  protected refreshDashboard() {
    this.store.dispatch(autoscalerActions.setDashboardLoading({loading: true}));
    this.store.dispatch(autoscalerActions.getDashboard());
  }

  protected formatNumber(value?: number) {
    return Number.isFinite(value) ? `${value}` : '0';
  }

  protected isConfigured() {
    const settings = this.settings();
    return !!settings?.openshift_api_url || !!settings?.openshift_login_command || !!settings?.runai_access_key;
  }

  protected statusSummary() {
    const dashboard = this.dashboard();
    if (!dashboard?.status_counts) {
      return 'No status data';
    }
    const summary = Object.entries(dashboard.status_counts)
      .filter(([, count]) => count > 0)
      .map(([status, count]) => `${status}: ${count}`)
      .join(' / ');
    return summary || 'No active statuses';
  }

  protected lastRefreshLabel() {
    const timestamp = this.dashboard()?.timestamp;
    return timestamp ? new Date(timestamp).toLocaleTimeString() : 'Not refreshed yet';
  }

  private isRunaiRoute() {
    return this.route.snapshot.routeConfig?.path === 'runai-autoscaler';
  }

  private patchConnectionFormFromSettings() {
    const settings = this.settings();
    if (!settings) {
      return;
    }

    this.connectionForm.patchValue({
      connection_method: (settings.connection_method as ConnectionMethod) || 'openshift',
      openshift_login_mode: (settings.openshift_login_mode as OpenshiftLoginMode) || 'command',
      openshift_api_url: settings.openshift_api_url || '',
      openshift_token: settings.openshift_token || '',
      openshift_login_command: settings.openshift_login_command || '',
      runai_access_key: settings.runai_access_key || '',
      runai_secret_key: settings.runai_secret_key || '',
      runai_cluster: settings.runai_cluster || '',
      runai_project: settings.runai_project || '',
      runai_cli_version: (settings.runai_cli_version as RunaiCliVersion) || 'auto',
    }, {emitEvent: false});
    this.updateConnectionValidators();
  }

  private startDashboardRefresh() {
    this.stopDashboardRefresh();
    this.dashboardRefreshId = setInterval(() => this.refreshDashboard(), 30000);
  }

  private stopDashboardRefresh() {
    if (this.dashboardRefreshId) {
      clearInterval(this.dashboardRefreshId);
      this.dashboardRefreshId = undefined;
    }
  }

  private barHeight(value: number, total: number) {
    if (!total || value <= 0) {
      return 8;
    }
    return Math.max(8, Math.min(110, Math.round((value / total) * 110)));
  }

  private updateConnectionValidators() {
    const method = this.connectionForm.controls.connection_method.value;
    const openshiftMode = this.connectionForm.controls.openshift_login_mode.value;
    this.setRequired(this.connectionForm.controls.openshift_api_url, method === 'openshift' && openshiftMode === 'fields');
    this.setRequired(this.connectionForm.controls.openshift_token, method === 'openshift' && openshiftMode === 'fields');
    this.setRequired(this.connectionForm.controls.openshift_login_command, method === 'openshift' && openshiftMode === 'command');
    this.setRequired(this.connectionForm.controls.runai_access_key, method === 'runai_application');
    this.setRequired(this.connectionForm.controls.runai_secret_key, method === 'runai_application');
  }

  private setRequired(control: AbstractControl, required: boolean) {
    control.setValidators(required ? [Validators.required] : []);
    control.updateValueAndValidity({emitEvent: false});
  }

  private isCompletedWorkloadStatus(status?: string) {
    return ['completed', 'succeeded', 'success', 'finished'].includes((status || '').toLowerCase());
  }

  private applyImportedWorkload(workload: WorkloadFormValue, markDirty = true) {
    this.workloadForm.patchValue({
      workload_type: workload.workload_type || 'training',
      workload_name: workload.workload_name || '',
      project: workload.project || '',
      image: workload.image || '',
      command_override: !!workload.command,
      command: workload.command || '',
      args: workload.args || '',
      environment_variables: workload.environment_variables || '',
      template: workload.template || '',
      cpu_core_request: workload.cpu_core_request || '',
      cpu_core_limit: workload.cpu_core_limit || '',
      cpu_memory_request: workload.cpu_memory_request || '',
      cpu_memory_limit: workload.cpu_memory_limit || '',
      gpu_devices_request: workload.gpu_devices_request || '',
      gpu_memory_request: workload.gpu_memory_request || '',
      gpu_portion_request: workload.gpu_portion_request || '',
      gpu_request_type: workload.gpu_request_type || '',
      node_pools: workload.node_pools || '',
      node_type: workload.node_type || '',
      priority: workload.priority || '',
      preemptibility: workload.preemptibility || '',
      existing_pvc: workload.existing_pvc || '',
      working_dir: workload.working_dir || '',
      parallelism: workload.parallelism || '',
      runs: workload.runs || '',
      restart_policy: workload.restart_policy || '',
      backoff_limit: workload.backoff_limit || '',
      external_url: workload.external_url || '',
      serving_port: workload.serving_port || '',
      min_replicas: workload.min_replicas || '',
      max_replicas: workload.max_replicas || '',
      initial_replicas: workload.initial_replicas || '',
      metric: workload.metric || '',
      metric_threshold: workload.metric_threshold || '',
      scale_to_zero_retention: workload.scale_to_zero_retention || '',
    });
    const normalized = this.workloadForm.getRawValue() as WorkloadFormValue;
    if (markDirty) {
      this.rememberLocalWorkload(normalized);
      this.workloadForm.markAsDirty();
    }
  }

  private rememberLocalWorkload(workload: WorkloadFormValue) {
    if (!workload.workload_name && !workload.image) {
      return;
    }
    this.importedWorkloads.update(workloads => {
      const next = [...workloads];
      const index = next.findIndex(item => item.workload_name === workload.workload_name && item.project === workload.project);
      if (index >= 0) {
        next[index] = {...next[index], ...workload};
      } else {
        next.push({...workload});
      }
      return next;
    });
    this.selectedInstanceKey.set(this.instanceKey('local', workload.workload_name || 'imported', workload.project));
    this.store.dispatch(autoscalerActions.saveAppInstance({workload}));
  }

  private parseWorkloadJson(source?: string | null): WorkloadFormValue | null {
    this.importError.set(null);
    if (!source?.trim()) {
      this.importError.set('Paste JSON or upload a JSON configuration file');
      return null;
    }

    try {
      const data = JSON.parse(source);
      return this.normalizeWorkloadConfig(data?.workload ?? data?.spec ?? data);
    } catch {
      this.importError.set('The selected configuration is not valid JSON');
      return null;
    }
  }

  private parseRunaiCommand(source?: string | null): WorkloadFormValue | null {
    this.importError.set(null);
    const tokens = this.tokenizeCommand(source || '');
    const runaiIndex = tokens.findIndex(token => token === 'runai');
    if (runaiIndex < 0) {
      this.importError.set('Paste a Run:ai command that starts with runai');
      return null;
    }

    const command = tokens.slice(runaiIndex);
    const submitIndex = command.indexOf('submit');
    if (submitIndex < 0) {
      this.importError.set('Only Run:ai submit commands can be imported');
      return null;
    }

    const workloadType = this.detectWorkloadType(command, submitIndex);
    const workload: WorkloadFormValue = {workload_type: workloadType};
    const environments: string[] = [];
    let idx = submitIndex + 1;

    if (command[1] && command[1] !== 'submit' && !command[idx]?.startsWith('-')) {
      workload.workload_name = command[idx++];
    }

    while (idx < command.length) {
      const token = command[idx];
      if (token === '--') {
        this.assignCommand(workload, command.slice(idx + 1));
        break;
      }
      if (!token.startsWith('-')) {
        idx++;
        continue;
      }
      if (token === '--command') {
        idx++;
        if (command[idx] === '--') {
          idx++;
        }
        this.assignCommand(workload, command.slice(idx));
        break;
      }

      const [flag, inlineValue] = token.includes('=') ? token.split(/=(.*)/s, 2) : [token, undefined];
      const flagName = flag.replace(/^--?/, '');
      const value = inlineValue !== undefined ? inlineValue : (this.flagNeedsValue(flagName) ? command[++idx] ?? '' : '');

      switch (flagName) {
        case 'name':
          workload.workload_name = value;
          break;
        case 'p':
        case 'project':
          workload.project = value;
          break;
        case 'i':
        case 'image':
          workload.image = value;
          break;
        case 'e':
        case 'environment':
          if (value) {
            environments.push(value);
          }
          break;
        case 'g':
        case 'gpu':
        case 'gpu-devices-request':
          workload.gpu_devices_request = value;
          break;
        case 'gpu-memory-request':
          workload.gpu_memory_request = value;
          break;
        case 'gpu-portion-request':
          workload.gpu_portion_request = value;
          break;
        case 'gpu-request-type':
          workload.gpu_request_type = value;
          break;
        case 'cpu-core-request':
          workload.cpu_core_request = value;
          break;
        case 'cpu-core-limit':
          workload.cpu_core_limit = value;
          break;
        case 'cpu-memory-request':
          workload.cpu_memory_request = value;
          break;
        case 'cpu-memory-limit':
          workload.cpu_memory_limit = value;
          break;
        case 'template':
          workload.template = value;
          break;
        case 'node-pools':
          workload.node_pools = value;
          break;
        case 'node-type':
          workload.node_type = value;
          break;
        case 'priority':
          workload.priority = value;
          break;
        case 'preemptibility':
          workload.preemptibility = value;
          break;
        case 'pvc-exists':
        case 'existing-pvc':
          workload.existing_pvc = value;
          break;
        case 'working-dir':
          workload.working_dir = value;
          break;
        case 'parallelism':
          workload.parallelism = value;
          break;
        case 'runs':
          workload.runs = value;
          break;
        case 'restart-policy':
          workload.restart_policy = value;
          break;
        case 'backoff-limit':
          workload.backoff_limit = value;
          break;
        case 'external-url':
          workload.external_url = value;
          break;
        case 'serving-port':
          workload.serving_port = value;
          break;
        case 'min-replicas':
          workload.min_replicas = value;
          break;
        case 'max-replicas':
          workload.max_replicas = value;
          break;
        case 'initial-replicas':
          workload.initial_replicas = value;
          break;
        case 'metric':
          workload.metric = value;
          break;
        case 'metric-threshold':
          workload.metric_threshold = value;
          break;
        case 'scale-to-zero-retention':
          workload.scale_to_zero_retention = value;
          break;
      }
      idx++;
    }

    workload.environment_variables = environments.join(',');
    return this.normalizeWorkloadConfig(workload);
  }

  private detectWorkloadType(command: string[], submitIndex: number): WorkloadType {
    const explicitType = command[submitIndex - 1];
    if (explicitType === 'workspace' || explicitType === 'inference' || explicitType === 'training') {
      return explicitType;
    }
    return command.includes('--interactive') ? 'workspace' : 'training';
  }

  private flagNeedsValue(flag: string) {
    return ![
      'attach',
      'interactive',
      'stdin',
      'tty',
      'large-shm',
    ].includes(flag);
  }

  private assignCommand(workload: WorkloadFormValue, parts: string[]) {
    if (!parts.length) {
      return;
    }
    workload.command_override = true;
    workload.command = parts[0] || '';
    workload.args = parts.slice(1).map(part => this.quoteCommandPart(part)).join(' ');
  }

  private normalizeWorkloadConfig(data: Record<string, unknown> | null | undefined): WorkloadFormValue {
    if (!data || typeof data !== 'object') {
      this.importError.set('The configuration file does not contain a workload object');
      return {workload_type: 'training'};
    }
    const value = (key: string, ...aliases: string[]) => {
      for (const candidate of [key, ...aliases]) {
        const item = data?.[candidate];
        if (item !== undefined && item !== null && item !== '') {
          return Array.isArray(item) ? item.join(',') : String(item);
        }
      }
      return '';
    };
    const commandValue = value('command');
    const environmentValue = data?.['environment_variables'] ?? data?.['environment'] ?? data?.['env'];

    return {
      workload_type: (value('workload_type', 'type') as WorkloadType) || 'training',
      workload_name: value('workload_name', 'name'),
      project: value('project'),
      image: value('image'),
      command_override: !!commandValue,
      command: commandValue,
      args: value('args', 'arguments'),
      environment_variables: Array.isArray(environmentValue) ? environmentValue.join(',') : String(environmentValue ?? ''),
      template: value('template'),
      cpu_core_request: value('cpu_core_request', 'cpuCoreRequest'),
      cpu_core_limit: value('cpu_core_limit', 'cpuCoreLimit'),
      cpu_memory_request: value('cpu_memory_request', 'cpuMemoryRequest'),
      cpu_memory_limit: value('cpu_memory_limit', 'cpuMemoryLimit'),
      gpu_devices_request: value('gpu_devices_request', 'gpu', 'gpuDevicesRequest'),
      gpu_memory_request: value('gpu_memory_request', 'gpuMemoryRequest'),
      gpu_portion_request: value('gpu_portion_request', 'gpuPortionRequest'),
      gpu_request_type: value('gpu_request_type', 'gpuRequestType'),
      node_pools: value('node_pools', 'nodePools'),
      node_type: value('node_type', 'nodeType'),
      priority: value('priority'),
      preemptibility: value('preemptibility'),
      existing_pvc: value('existing_pvc', 'existingPvc', 'pvc_exists'),
      working_dir: value('working_dir', 'workingDir'),
      parallelism: value('parallelism'),
      runs: value('runs'),
      restart_policy: value('restart_policy', 'restartPolicy'),
      backoff_limit: value('backoff_limit', 'backoffLimit'),
      external_url: value('external_url', 'externalUrl'),
      serving_port: value('serving_port', 'servingPort'),
      min_replicas: value('min_replicas', 'minReplicas'),
      max_replicas: value('max_replicas', 'maxReplicas'),
      initial_replicas: value('initial_replicas', 'initialReplicas'),
      metric: value('metric'),
      metric_threshold: value('metric_threshold', 'metricThreshold'),
      scale_to_zero_retention: value('scale_to_zero_retention', 'scaleToZeroRetention'),
    };
  }

  private tokenizeCommand(source: string) {
    const command = source
      .replace(/```(?:bash)?/g, '')
      .replace(/```/g, '')
      .replace(/\\\r?\n/g, ' ')
      .trim();
    const tokens: string[] = [];
    let current = '';
    let quote: '"' | "'" | null = null;

    for (let index = 0; index < command.length; index++) {
      const char = command[index];
      if (quote) {
        if (char === quote) {
          quote = null;
        } else if (char === '\\' && quote === '"' && index + 1 < command.length) {
          current += command[++index];
        } else {
          current += char;
        }
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }
      current += char;
    }
    if (current) {
      tokens.push(current);
    }
    return tokens;
  }

  private quoteCommandPart(part: string) {
    return /\s/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part;
  }

  private instanceKey(source: AppInstanceSource, name?: string, project?: string, index?: number) {
    return [source, project || 'default', name || 'unnamed', index ?? ''].join(':');
  }
}
