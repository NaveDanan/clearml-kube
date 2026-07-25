import {ChangeDetectionStrategy, Component, ElementRef, OnDestroy, TemplateRef, computed, effect, inject, signal, untracked, viewChild} from '@angular/core';
import {Store} from '@ngrx/store';
import {DecimalPipe, NgTemplateOutlet, TitleCasePipe} from '@angular/common';
import {AbstractControl, FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators} from '@angular/forms';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {MatAutocompleteModule} from '@angular/material/autocomplete';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatButton, MatIconButton} from '@angular/material/button';
import {MatIcon} from '@angular/material/icon';
import {MatTabsModule} from '@angular/material/tabs';
import {MatExpansionModule} from '@angular/material/expansion';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatMenuModule} from '@angular/material/menu';
import {MatDialog, MatDialogModule} from '@angular/material/dialog';
import {ActivatedRoute, Router} from '@angular/router';
import versionConf from '../../../../../version.json';
import {
  autoscalerActions,
  AutoscalerComputeResource,
  AutoscalerDataSourceResource,
  AutoscalerEnvironmentResource,
} from '../../actions/autoscaler.actions';
import {
  selectAutoscalerSettings,
  selectAutoscalerConnectionStatus,
  selectAutoscalerConnectionResult,
  selectAutoscalerDashboard,
  selectAutoscalerDashboardError,
  selectAutoscalerDashboardLoading,
  selectAutoscalerLastExecution,
  selectAutoscalerProjectResources,
  selectAutoscalerProjectResourcesLoading,
  selectAutoscalerWorkloadLogs,
  selectAutoscalerWorkloadLogsLoading,
  selectAutoscalerWorkloadInfo,
  selectAutoscalerWorkloadInfoLoading
} from '../../reducers/index.reducer';
import {Subscription} from 'rxjs';
import {debounceTime, distinctUntilChanged} from 'rxjs/operators';

export type WorkloadType = 'training' | 'workspace' | 'inference';

const INSTANCE_LOG_REFRESH_INTERVAL = 4000;
const WORKLOAD_INFO_REFRESH_INTERVAL = 5000;
const ASSET_PAGE_SIZE = 6;

type ConnectionMethod = 'openshift' | 'runai_application';
type OpenshiftLoginMode = 'fields' | 'command';
type RunaiCliVersion = 'auto' | 'v1' | 'v2';
type ImportMode = 'command' | 'json';
type AppInstanceSource = 'runai' | 'local';
type AppInstanceFilter = 'type' | 'status' | 'project';

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
  compute: string;
  environment: string;
  data_sources: string;
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
  workload_id?: string;
  source: AppInstanceSource;
  name: string;
  type?: string;
  status?: string;
  project?: string;
  gpus?: number;
  age?: string;
  workload?: WorkloadFormValue;
}

interface EnvVarGroup {
  key: FormControl<string>;
  value: FormControl<string>;
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
    MatAutocompleteModule,
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
    DecimalPipe,
    TitleCasePipe,
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
  protected autoscalerVersion = this.formatAutoscalerVersion(versionConf);

  protected selectedProvider = signal<'runai' | null>(null);
  protected importedWorkloads = signal<WorkloadFormValue[]>([]);
  protected selectedInstanceKey = signal<string | null>(null);
  protected instanceSearchOpen = signal(false);
  protected instanceSearchQuery = signal('');
  protected selectedInstanceTypes = signal<string[]>([]);
  protected selectedInstanceStatuses = signal<string[]>([]);
  protected selectedInstanceProjects = signal<string[]>([]);
  protected importError = signal<string | null>(null);
  protected settings = this.store.selectSignal(selectAutoscalerSettings);
  protected connectionStatus = this.store.selectSignal(selectAutoscalerConnectionStatus);
  protected connectionResult = this.store.selectSignal(selectAutoscalerConnectionResult);
  protected lastExecution = this.store.selectSignal(selectAutoscalerLastExecution);
  protected dashboard = this.store.selectSignal(selectAutoscalerDashboard);
  protected dashboardLoading = this.store.selectSignal(selectAutoscalerDashboardLoading);
  protected dashboardError = this.store.selectSignal(selectAutoscalerDashboardError);
  protected projectResources = this.store.selectSignal(selectAutoscalerProjectResources);
  protected projectResourcesLoading = this.store.selectSignal(selectAutoscalerProjectResourcesLoading);
  protected projectFilter = signal('');
  protected computeResources = computed<AutoscalerComputeResource[]>(() => this.projectResources()?.compute ?? []);
  protected environmentResources = computed<AutoscalerEnvironmentResource[]>(() => this.projectResources()?.environments ?? []);
  protected dataSourceResources = computed<AutoscalerDataSourceResource[]>(() => this.projectResources()?.data_sources ?? []);
  protected nodePoolResources = computed<string[]>(() => this.projectResources()?.node_pools ?? []);
  // Asset-card pagination (Environment / Compute / Data Sources)
  protected environmentPage = signal(0);
  protected computePage = signal(0);
  protected dataSourcePage = signal(0);
  protected environmentPageCount = computed(() => Math.max(1, Math.ceil(this.environmentResources().length / ASSET_PAGE_SIZE)));
  protected computePageCount = computed(() => Math.max(1, Math.ceil(this.computeResources().length / ASSET_PAGE_SIZE)));
  protected dataSourcePageCount = computed(() => Math.max(1, Math.ceil(this.dataSourceResources().length / ASSET_PAGE_SIZE)));
  protected pagedEnvironments = computed(() => {
    const all = this.environmentResources();
    const page = Math.min(this.environmentPage(), this.environmentPageCount() - 1);
    return all.slice(page * ASSET_PAGE_SIZE, (page + 1) * ASSET_PAGE_SIZE);
  });
  protected pagedCompute = computed(() => {
    const all = this.computeResources();
    const page = Math.min(this.computePage(), this.computePageCount() - 1);
    return all.slice(page * ASSET_PAGE_SIZE, (page + 1) * ASSET_PAGE_SIZE);
  });
  protected pagedDataSources = computed(() => {
    const all = this.dataSourceResources();
    const page = Math.min(this.dataSourcePage(), this.dataSourcePageCount() - 1);
    return all.slice(page * ASSET_PAGE_SIZE, (page + 1) * ASSET_PAGE_SIZE);
  });
  protected pageArray(count: number): number[] {
    return Array.from({length: count}, (_, i) => i);
  }
  protected availableProjects = computed<string[]>(() => {
    const names = new Set<string>();
    const add = (value?: string | null) => {
      const cleaned = (value || '').trim();
      if (cleaned) {
        names.add(cleaned);
      }
    };
    (this.projectResources()?.projects ?? []).forEach(add);
    (this.dashboard()?.queues ?? []).forEach(queue => add(queue.name));
    (this.dashboard()?.instances ?? []).forEach(instance => add(instance.project));
    (this.dashboard()?.saved_instances ?? []).forEach(instance => add(instance.project));
    add(this.settings()?.runai_project);
    return [...names].sort((a, b) => a.localeCompare(b));
  });
  protected filteredProjects = computed<string[]>(() => {
    const filter = this.projectFilter().trim().toLowerCase();
    const projects = this.availableProjects();
    if (!filter) {
      return projects;
    }
    return projects.filter(project => project.toLowerCase().includes(filter));
  });
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
    // A single workload (identified by project + name) must appear as exactly one
    // app instance, regardless of how many sources report it. We merge the saved
    // (Mongo) record, the live Run:ai status, and any locally imported draft into
    // one entry keyed by workload identity.
    const merged = new Map<string, AppInstance>();

    // Saved instances from Mongo carry the persistent id + full workload params.
    (this.dashboard()?.saved_instances ?? []).forEach((instance, index) => {
      const name = instance.name || `Saved workload ${index + 1}`;
      const key = this.instanceKey(name, instance.project);
      merged.set(key, {
        key,
        id: instance.id,
        source: 'local',
        name,
        type: instance.type,
        status: instance.status || 'saved',
        project: instance.project,
        gpus: Number(instance.workload?.gpu_devices_request) || 0,
        age: instance.created || '',
        workload: instance.workload as WorkloadFormValue,
      });
    });

    // Live Run:ai workloads reflect the real cluster status; overlay them onto the
    // matching saved record (keeping its id + workload params) or add a new entry.
    (this.dashboard()?.instances ?? []).forEach(instance => {
      const name = instance.name || 'Unnamed workload';
      const key = this.instanceKey(name, instance.project);
      const existing = merged.get(key);
      merged.set(key, {
        ...existing,
        key,
        id: existing?.id,
        workload_id: instance.workload_id || existing?.workload_id,
        source: 'runai',
        name,
        type: instance.type || existing?.type,
        status: instance.status || existing?.status,
        project: instance.project ?? existing?.project,
        gpus: instance.gpus || existing?.gpus || 0,
        age: instance.age || existing?.age || '',
        workload: existing?.workload,
      });
    });

    // Locally imported workloads that have not been persisted/launched yet.
    this.importedWorkloads().forEach((workload, index) => {
      const name = workload.workload_name || `Imported workload ${index + 1}`;
      const key = this.instanceKey(name, workload.project);
      if (merged.has(key)) {
        return;
      }
      merged.set(key, {
        key,
        source: 'local',
        name,
        type: workload.workload_type,
        status: 'imported',
        project: workload.project,
        gpus: Number(workload.gpu_devices_request) || 0,
        age: '',
        workload,
      });
    });

    return [...merged.values()];
  });
  protected instanceTypeOptions = computed(() => this.instanceFilterOptions('type'));
  protected instanceStatusOptions = computed(() => this.instanceFilterOptions('status'));
  protected instanceProjectOptions = computed(() => this.instanceFilterOptions('project'));
  protected filteredAppInstances = computed(() => {
    const query = this.instanceSearchQuery().trim().toLowerCase();
    const types = new Set(this.selectedInstanceTypes());
    const statuses = new Set(this.selectedInstanceStatuses());
    const projects = new Set(this.selectedInstanceProjects());

    return this.appInstances().filter(instance => {
      const type = this.instanceFilterValue(instance.type, 'Unknown');
      const status = this.instanceFilterValue(instance.status, 'Unknown');
      const project = this.instanceFilterValue(instance.project, 'No project');
      const matchesFilters =
        (!types.size || types.has(type)) &&
        (!statuses.size || statuses.has(status)) &&
        (!projects.size || projects.has(project));
      const matchesSearch = !query || [instance.name, type, status, project]
        .some(value => value.toLowerCase().includes(query));
      return matchesFilters && matchesSearch;
    });
  });
  protected instanceFilterLabel = computed(() => {
    const selectedCount = this.selectedInstanceTypes().length +
      this.selectedInstanceStatuses().length + this.selectedInstanceProjects().length;
    return selectedCount ? `${selectedCount} selected` : 'All';
  });

  private formatAutoscalerVersion(version: typeof versionConf): string {
    const tagVersion = (version['webapp-treeish'] || version.version || '').trim();
    const commit = (version['webapp-commit'] || '').trim();
    if (tagVersion && commit) {
      return `${tagVersion} · ${commit.slice(0, 7)}`;
    }
    return tagVersion || commit || version.version;
  }

  protected toggleInstanceSearch() {
    if (this.instanceSearchOpen()) {
      this.instanceSearchQuery.set('');
    }
    this.instanceSearchOpen.update(open => !open);
  }

  protected setInstanceSearchQuery(query: string) {
    this.instanceSearchQuery.set(query);
  }

  protected toggleInstanceFilter(filter: AppInstanceFilter, value: string) {
    const selected = this.instanceFilterSelection(filter);
    selected.update(values => values.includes(value)
      ? values.filter(item => item !== value)
      : [...values, value]);
  }

  protected isInstanceFilterSelected(filter: AppInstanceFilter, value: string): boolean {
    return this.instanceFilterSelection(filter)().includes(value);
  }

  private instanceFilterOptions(filter: AppInstanceFilter): string[] {
    const values = this.appInstances().map(instance => {
      switch (filter) {
        case 'type':
          return this.instanceFilterValue(instance.type, 'Unknown');
        case 'status':
          return this.instanceFilterValue(instance.status, 'Unknown');
        case 'project':
          return this.instanceFilterValue(instance.project, 'No project');
      }
    });
    return [...new Set(values)].sort((a, b) => a.localeCompare(b));
  }

  private instanceFilterSelection(filter: AppInstanceFilter) {
    switch (filter) {
      case 'type':
        return this.selectedInstanceTypes;
      case 'status':
        return this.selectedInstanceStatuses;
      case 'project':
        return this.selectedInstanceProjects;
    }
  }

  private instanceFilterValue(value: string | undefined, fallback: string): string {
    return value?.trim() || fallback;
  }

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
  protected instanceLogs = this.store.selectSignal(selectAutoscalerWorkloadLogs);
  protected instanceLogsLoading = this.store.selectSignal(selectAutoscalerWorkloadLogsLoading);
  protected instanceConsoleLines = computed<string[]>(() => {
    const selected = this.selectedInstance();
    if (!selected) {
      return [];
    }
    const logs = this.instanceLogs();
    if (logs?.error && !(logs?.lines?.length)) {
      return [logs.error];
    }
    const lines = logs?.lines ?? [];
    if (!lines.length) {
      return [this.instanceLogsLoading() ? 'Loading workload logs…' : 'Waiting for workload logs from Run:ai / OpenShift'];
    }
    return lines;
  });
  protected instanceLogSource = computed(() => this.instanceLogs()?.source || '');
  // The selected app instance is identified by name + project; track that as a
  // stable string so the log refresh effect does not restart on every dashboard
  // poll (which recreates the instance objects).
  protected selectedInstanceLogKey = computed<string | null>(() => {
    const instance = this.selectedInstance();
    return instance ? `${instance.name}||${instance.project || ''}` : null;
  });

  // ── Workload info visualizer (REST API: details / events / logs / metrics) ──
  protected workloadInfo = this.store.selectSignal(selectAutoscalerWorkloadInfo);
  protected workloadInfoLoading = this.store.selectSignal(selectAutoscalerWorkloadInfoLoading);
  protected activeWorkloadTab = signal<'metrics' | 'events' | 'logs' | 'details'>('metrics');
  protected selectedWorkloadId = computed(() => this.selectedInstance()?.workload_id || '');
  protected wlDetails = computed(() => this.workloadInfo()?.details ?? null);
  protected wlEvents = computed(() => this.workloadInfo()?.events ?? []);
  protected wlLogLines = computed<string[]>(() => this.workloadInfo()?.logs?.lines ?? []);
  protected workloadStatusText = computed(() => this.wlDetails()?.status || this.selectedInstance()?.status || '');
  protected wlMetricAverages = computed<{label: string; value: number}[]>(() => {
    const avg = this.workloadInfo()?.metrics?.averages ?? {};
    const labels: Record<string, string> = {
      GPU_UTILIZATION: 'GPU compute',
      GPU_MEMORY_USAGE_BYTES: 'GPU memory',
      CPU_USAGE_CORES: 'CPU compute',
      CPU_MEMORY_USAGE_BYTES: 'CPU memory',
    };
    return Object.entries(avg).map(([key, value]) => ({label: labels[key] || key, value: value as number}));
  });
  protected metricSeries = computed(() => {
    const series = this.workloadInfo()?.metrics?.series ?? [];
    const meta: Record<string, {label: string; color: string}> = {
      GPU_UTILIZATION: {label: 'GPU compute utilization', color: '#3b82f6'},
      GPU_MEMORY_USAGE_BYTES: {label: 'GPU memory utilization', color: '#a855f7'},
      CPU_USAGE_CORES: {label: 'CPU compute utilization', color: '#22c55e'},
      CPU_MEMORY_USAGE_BYTES: {label: 'CPU memory utilization', color: '#f97316'},
    };
    const x0 = 40, x1 = 780, yTop = 20, yBottom = 230;
    return series
      .map(s => ({
        type: s.type || '',
        points: (s.points ?? [])
          .map(p => p.v)
          .filter((v): v is number => typeof v === 'number' && isFinite(v)),
      }))
      .filter(s => s.points.length > 0)
      .map(s => {
        const min = Math.min(...s.points);
        const max = Math.max(...s.points);
        const span = max - min || 1;
        const n = s.points.length;
        const path = s.points
          .map((v, i) => {
            const x = n === 1 ? x1 : x0 + (i / (n - 1)) * (x1 - x0);
            const y = yBottom - ((v - min) / span) * (yBottom - yTop);
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(' ');
        const m = meta[s.type] || {label: s.type || 'Metric', color: '#3b82f6'};
        return {type: s.type, label: m.label, color: m.color, path};
      });
  });
  private workloadInfoRefreshId?: ReturnType<typeof setInterval>;
  private activeWorkloadInfoId: string | null = null;

  // Console log panels: the main connection log is collapsed by default and the
  // app-instance-specific log opens when an instance is selected. Only one is
  // expanded at a time so the two logs never appear together.
  protected mainLogExpanded = signal(false);
  protected instanceLogExpanded = signal(false);
  protected mainLogFollow = signal(true);
  protected instanceLogFollow = signal(true);
  private mainLogBody = viewChild<ElementRef<HTMLElement>>('mainLogBody');
  private instanceLogBody = viewChild<ElementRef<HTMLElement>>('instanceLogBody');
  private instanceLogRefreshId?: ReturnType<typeof setInterval>;
  private activeInstanceLogKey: string | null = null;

  connectionForm = this.fb.group({
    connection_method: ['openshift' as ConnectionMethod, Validators.required],
    openshift_login_mode: ['fields' as OpenshiftLoginMode],
    openshift_api_url: [''],
    openshift_token: [''],
    openshift_login_command: [''],
    runai_cp_url: [''],
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
    env_vars: this.fb.array<FormGroup<EnvVarGroup>>([]),
    template: [''],
    compute: [''],
    environment: [''],
    data_sources: [''],
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
    this.formSubscription.add(this.workloadForm.controls.project.valueChanges.subscribe(project => {
      this.projectFilter.set(project || '');
    }));
    this.formSubscription.add(this.workloadForm.controls.project.valueChanges.pipe(
      debounceTime(400),
      distinctUntilChanged(),
    ).subscribe(project => this.loadProjectResources(project || '')));

    effect(() => {
      if (this.selectedProvider() !== 'runai') {
        return;
      }

      this.patchConnectionFormFromSettings();
    });

    // Drive the app-instance-specific console log: fetch + periodically refresh
    // the logs for the selected instance while its panel is expanded.
    effect(() => {
      const key = this.selectedInstanceLogKey();
      const expanded = this.instanceLogExpanded();
      const active = this.selectedProvider() === 'runai' && !!key && expanded;
      untracked(() => this.syncInstanceLogRefresh(key, active));
    });

    // Fetch + refresh the selected workload's info (details/events/logs/metrics)
    // from the Run:ai REST API while a workload is selected.
    effect(() => {
      const workloadId = this.selectedWorkloadId();
      const active = this.selectedProvider() === 'runai' && !!workloadId;
      untracked(() => this.syncWorkloadInfoRefresh(workloadId, active));
    });

    // Auto-scroll the instance log to the bottom while following live output.
    effect(() => {
      const lines = this.instanceConsoleLines();
      const follow = this.instanceLogFollow();
      const expanded = this.instanceLogExpanded();
      if (expanded && follow && lines.length) {
        this.scrollToBottomLater(this.instanceLogBody);
      }
    });

    // Auto-scroll the main connection log to the bottom while following.
    effect(() => {
      const lines = this.consoleLines();
      const follow = this.mainLogFollow();
      const expanded = this.mainLogExpanded();
      if (expanded && follow && lines.length) {
        this.scrollToBottomLater(this.mainLogBody);
      }
    });

    if (this.isRunaiRoute()) {
      this.selectedProvider.set('runai');
      this.refreshDashboard();
      this.startDashboardRefresh();
    }
  }

  ngOnDestroy() {
    this.stopDashboardRefresh();
    this.stopInstanceLogRefresh();
    this.stopWorkloadInfoRefresh();
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
    this.connectionForm.markAsPristine();
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
    this.loadProjectResources(this.workloadForm.controls.project.value || '');
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
    this.activeWorkloadTab.set('metrics');
  }

  protected setWorkloadTab(tab: 'metrics' | 'events' | 'logs' | 'details') {
    this.activeWorkloadTab.set(tab);
  }

  protected statusClassFor(status?: string): 'pending' | 'failed' | '' {
    const s = (status || '').toLowerCase();
    if (['failed', 'error', 'crashed', 'evicted'].includes(s)) {
      return 'failed';
    }
    if (['pending', 'queued', 'initializing', 'creating', 'stopped', 'stopping', 'imported'].includes(s)) {
      return 'pending';
    }
    return '';
  }

  protected instanceTypeIcon(type?: string): string {
    switch ((type || '').toLowerCase()) {
      case 'workspace':
        return 'al-ico-experiment-view';
      case 'inference':
        return 'al-ico-model-endpoints';
      default:
        return 'al-ico-queues';
    }
  }

  private syncWorkloadInfoRefresh(workloadId: string, active: boolean) {
    if (!active || !workloadId) {
      this.stopWorkloadInfoRefresh();
      return;
    }
    if (workloadId === this.activeWorkloadInfoId && this.workloadInfoRefreshId) {
      return;
    }
    this.stopWorkloadInfoRefresh();
    this.activeWorkloadInfoId = workloadId;
    this.store.dispatch(autoscalerActions.setWorkloadInfoLoading({loading: true}));
    this.store.dispatch(autoscalerActions.getWorkloadInfo({workloadId}));
    this.workloadInfoRefreshId = setInterval(
      () => this.store.dispatch(autoscalerActions.getWorkloadInfo({workloadId})),
      WORKLOAD_INFO_REFRESH_INTERVAL
    );
  }

  private stopWorkloadInfoRefresh() {
    if (this.workloadInfoRefreshId) {
      clearInterval(this.workloadInfoRefreshId);
      this.workloadInfoRefreshId = undefined;
    }
    this.activeWorkloadInfoId = null;
  }

  // --- Console log panels (collapse + follow/resume) ---

  protected toggleMainLog() {
    const next = !this.mainLogExpanded();
    this.mainLogExpanded.set(next);
    if (next) {
      this.instanceLogExpanded.set(false);
      this.mainLogFollow.set(true);
      this.scrollToBottomLater(this.mainLogBody);
    }
  }

  protected toggleInstanceLog() {
    const next = !this.instanceLogExpanded();
    this.instanceLogExpanded.set(next);
    if (next) {
      this.mainLogExpanded.set(false);
      this.instanceLogFollow.set(true);
      this.scrollToBottomLater(this.instanceLogBody);
    }
  }

  protected onLogScroll(event: Event, which: 'main' | 'instance') {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (which === 'instance') {
      this.instanceLogFollow.set(atBottom);
    } else {
      this.mainLogFollow.set(atBottom);
    }
  }

  protected resumeLogs(which: 'main' | 'instance') {
    if (which === 'instance') {
      this.instanceLogFollow.set(true);
      this.scrollToBottomLater(this.instanceLogBody);
    } else {
      this.mainLogFollow.set(true);
      this.scrollToBottomLater(this.mainLogBody);
    }
  }

  private scrollToBottomLater(ref: () => ElementRef<HTMLElement> | undefined) {
    setTimeout(() => {
      const el = ref()?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  private syncInstanceLogRefresh(key: string | null, active: boolean) {
    if (!active || !key) {
      this.stopInstanceLogRefresh();
      return;
    }
    if (key === this.activeInstanceLogKey && this.instanceLogRefreshId) {
      return;
    }
    this.stopInstanceLogRefresh();
    this.activeInstanceLogKey = key;
    this.store.dispatch(autoscalerActions.setWorkloadLogsLoading({loading: true}));
    this.dispatchInstanceLogs();
    this.instanceLogRefreshId = setInterval(() => this.dispatchInstanceLogs(), INSTANCE_LOG_REFRESH_INTERVAL);
  }

  private stopInstanceLogRefresh() {
    if (this.instanceLogRefreshId) {
      clearInterval(this.instanceLogRefreshId);
      this.instanceLogRefreshId = undefined;
    }
    this.activeInstanceLogKey = null;
  }

  private dispatchInstanceLogs() {
    const instance = this.selectedInstance();
    if (!instance) {
      return;
    }
    this.store.dispatch(autoscalerActions.getWorkloadLogs({
      workload: {
        instance_id: instance.id,
        workload_name: instance.name,
        workload_type: instance.type,
        project: instance.project,
      },
    }));
  }

  protected canStopInstance(instance: AppInstance): boolean {
    const status = (instance.status || '').toLowerCase();
    return instance.source === 'runai' || !['imported', 'stopped', 'stopping'].includes(status);
  }

  stopInstance(event: Event, instance: AppInstance) {
    event.stopPropagation();
    this.store.dispatch(autoscalerActions.stopWorkload({
      workload: {
        instance_id: instance.id,
        workload_name: instance.name,
        workload_type: instance.type,
        project: instance.project,
      },
    }));
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
    const workload = this.getWorkloadValue();
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
    const project = this.settings()?.runai_project || '';
    this.workloadForm.reset({workload_type: 'training', project}, {emitEvent: false});
    this.projectFilter.set(project);
    this.setEnvVars([]);
    this.addEnvVar('', '', false);
    this.workloadForm.markAsPristine();
  }

  // --- Environment variables (one row per variable + .env upload) ---

  protected get envVars(): FormArray<FormGroup<EnvVarGroup>> {
    return this.workloadForm.controls.env_vars;
  }

  protected addEnvVar(key = '', value = '', markDirty = true) {
    this.envVars.push(this.fb.group({
      key: this.fb.nonNullable.control(key),
      value: this.fb.nonNullable.control(value),
    }));
    if (markDirty) {
      this.workloadForm.markAsDirty();
    }
  }

  protected removeEnvVar(index: number) {
    this.envVars.removeAt(index);
    this.workloadForm.markAsDirty();
  }

  protected uploadEnvFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const pairs = this.parseEnvFile(String(reader.result ?? ''));
      if (pairs.length) {
        const existing = this.serializeEnvVars();
        this.setEnvVars([...this.deserializeEnvVars(existing), ...pairs]);
        this.workloadForm.markAsDirty();
      }
      input.value = '';
    };
    reader.onerror = () => this.importError.set('Could not read the selected .env file');
    reader.readAsText(file);
  }

  private parseEnvFile(content: string): {key: string; value: string}[] {
    const pairs: {key: string; value: string}[] = [];
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }
      const withoutExport = line.replace(/^export\s+/, '');
      const separator = withoutExport.indexOf('=');
      if (separator < 0) {
        continue;
      }
      const key = withoutExport.slice(0, separator).trim();
      if (!key) {
        continue;
      }
      let value = withoutExport.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      pairs.push({key, value});
    }
    return pairs;
  }

  private setEnvVars(pairs: {key: string; value: string}[]) {
    this.envVars.clear();
    pairs.forEach(pair => this.addEnvVar(pair.key, pair.value, false));
  }

  private setEnvVarsFromString(value?: string | null) {
    this.setEnvVars(this.deserializeEnvVars(value));
  }

  private deserializeEnvVars(value?: string | null): {key: string; value: string}[] {
    if (!value) {
      return [];
    }
    return value.split(',')
      .map(pair => pair.trim())
      .filter(Boolean)
      .map(pair => {
        const separator = pair.indexOf('=');
        if (separator < 0) {
          return {key: pair, value: ''};
        }
        return {key: pair.slice(0, separator).trim(), value: pair.slice(separator + 1).trim()};
      });
  }

  private serializeEnvVars(): string {
    return this.envVars.controls
      .map(group => ({key: (group.controls.key.value || '').trim(), value: (group.controls.value.value || '').trim()}))
      .filter(pair => pair.key)
      .map(pair => `${pair.key}=${pair.value}`)
      .join(',');
  }

  // --- Project resources (interactive compute / data source / environment) ---

  protected loadProjectResources(project: string) {
    if (this.selectedProvider() !== 'runai') {
      return;
    }
    project = project.trim();
    this.environmentPage.set(0);
    this.computePage.set(0);
    this.dataSourcePage.set(0);
    if (!project) {
      this.store.dispatch(autoscalerActions.setProjectResources({
        resources: {
          project: '',
          projects: [],
          compute: [],
          environments: [],
          data_sources: [],
          node_pools: [],
        },
      }));
      return;
    }
    this.store.dispatch(autoscalerActions.setProjectResourcesLoading({loading: true}));
    this.store.dispatch(autoscalerActions.getProjectResources({project}));
  }

  protected assetEmptyLabel(): string {
    if (this.projectResourcesLoading()) {
      return 'Loading assets…';
    }
    const resources = this.projectResources();
    if (resources && resources.connected === false) {
      return resources.error || 'Could not load Run:ai assets. Enter values manually below.';
    }
    if (!this.workloadForm.controls.project.value) {
      return 'Select a project to load its Run:ai assets.';
    }
    return 'No assets found for this project. Enter values manually below.';
  }

  protected selectProject(project: string) {
    this.workloadForm.controls.project.setValue(project);
    this.workloadForm.markAsDirty();
  }

  protected selectCompute(resource: AutoscalerComputeResource) {
    const isSelected = this.workloadForm.controls.compute.value === resource.name;
    this.workloadForm.patchValue({
      compute: isSelected ? '' : resource.name,
      ...(isSelected ? {} : {
        gpu_devices_request: resource.gpu_devices_request || this.workloadForm.controls.gpu_devices_request.value || '',
        gpu_memory_request: resource.gpu_memory_request || this.workloadForm.controls.gpu_memory_request.value || '',
        gpu_portion_request: resource.gpu_portion_request || this.workloadForm.controls.gpu_portion_request.value || '',
        cpu_core_request: resource.cpu_core_request || this.workloadForm.controls.cpu_core_request.value || '',
        cpu_memory_request: resource.cpu_memory_request || this.workloadForm.controls.cpu_memory_request.value || '',
      }),
    });
    this.workloadForm.markAsDirty();
  }

  protected toggleEnvironment(resource: AutoscalerEnvironmentResource) {
    const selected = this.selectedEnvironments();
    const adding = !selected.includes(resource.name);
    const next = adding
      ? [...selected, resource.name]
      : selected.filter(name => name !== resource.name);
    this.workloadForm.controls.environment.setValue(next.join(','));
    if (adding) {
      this.workloadForm.patchValue({
        image: resource.image || this.workloadForm.controls.image.value || '',
        command_override: resource.command ? true : this.workloadForm.controls.command_override.value,
        command: resource.command || this.workloadForm.controls.command.value || '',
        args: resource.args || this.workloadForm.controls.args.value || '',
        working_dir: resource.working_dir || this.workloadForm.controls.working_dir.value || '',
      });
    }
    this.workloadForm.markAsDirty();
  }

  protected toggleDataSource(resource: AutoscalerDataSourceResource) {
    const selected = this.dataSourceSelections();
    const adding = !selected.some(item => item.name === resource.name);
    const next = adding
      ? [...selected, {name: resource.name, type: resource.type || ''}]
      : selected.filter(item => item.name !== resource.name);
    this.workloadForm.controls.data_sources.setValue(JSON.stringify(next));
    const pvc = resource.existing_pvc || (resource.path ? `claimname=${resource.name},path=${resource.path}` : '');
    if (adding && pvc && !this.workloadForm.controls.existing_pvc.value) {
      this.workloadForm.controls.existing_pvc.setValue(pvc);
    }
    this.workloadForm.markAsDirty();
  }

  protected selectedDataSources(): string[] {
    return this.dataSourceSelections().map(item => item.name);
  }

  private dataSourceSelections(): Array<{name: string; type?: string}> {
    const value = this.workloadForm.controls.data_sources.value || '';
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map(item => typeof item === 'string' ? {name: item} : item)
          .filter(item => item && typeof item.name === 'string' && item.name.trim())
          .map(item => ({name: item.name.trim(), type: typeof item.type === 'string' ? item.type.trim() : ''}));
      }
    } catch {
      // Older saved/imported workloads store a comma-separated list of names.
    }
    return value
      .split(',')
      .map(name => name.trim())
      .filter(Boolean)
      .map(name => ({name}));
  }

  protected isComputeSelected(resource: AutoscalerComputeResource) {
    return this.workloadForm.controls.compute.value === resource.name;
  }

  protected selectedEnvironments(): string[] {
    return (this.workloadForm.controls.environment.value || '')
      .split(',')
      .map(name => name.trim())
      .filter(Boolean);
  }

  protected isEnvironmentSelected(resource: AutoscalerEnvironmentResource) {
    return this.selectedEnvironments().includes(resource.name);
  }

  protected isDataSourceSelected(resource: AutoscalerDataSourceResource) {
    return this.selectedDataSources().includes(resource.name);
  }

  private getWorkloadValue(): WorkloadFormValue {
    const {env_vars, ...rest} = this.workloadForm.getRawValue();
    return {
      ...rest,
      environment_variables: this.serializeEnvVars(),
    } as WorkloadFormValue;
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
      runai_cp_url: settings.runai_cp_url || '',
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
      template: workload.template || '',
      compute: workload.compute || '',
      environment: workload.environment || '',
      data_sources: workload.data_sources || '',
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
    this.setEnvVarsFromString(workload.environment_variables);
    const normalized = this.getWorkloadValue();
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
    this.selectedInstanceKey.set(this.instanceKey(workload.workload_name || 'imported', workload.project));
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
      compute: value('compute', 'compute_resource', 'computeResource'),
      environment: value('environment_asset', 'environmentAsset', 'environment_name'),
      data_sources: value('data_sources', 'dataSources', 'data_source', 'dataSource'),
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

  private instanceKey(name?: string, project?: string) {
    return [project || 'default', name || 'unnamed'].join(':');
  }
}
