import {ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';

import {
  AUTOSCALER_MODE_LABELS,
  ClearpipeAutoscalerMode,
  ClearpipeDatasetMode,
  ClearpipeDatasetSourceType,
  clearpipeFlowNodeMeta,
  DATASET_MODE_LABELS,
  DATASET_SOURCE_TYPE_LABELS,
  incrementDatasetVersion,
  TaskExpectedOutput,
  TASK_EXPECTED_OUTPUT_KIND_LABELS,
  expectedOutputId,
} from './clearpipe-flow.models';
import {ClearpipeFlowStoreService} from './clearpipe-flow-store.service';
import {
  clearpipeAutoscalerIssues,
  AUTOSCALER_WORKLOAD_STRING_FIELDS,
} from './clearpipe-autoscaler';
import {
  AutoscalerComputeResource,
  AutoscalerDataSourceResource,
  AutoscalerEnvironmentResource,
  AutoscalerTemplateResource,
  AutoscalerTemplateResult,
  ClearpipeFlowResourcesService,
  FlowArtifact,
  FlowAutoscaler,
  FlowDatasetInfo,
  FlowDatasetVersion,
  FlowReportSource,
  FlowResourceOption,
} from './clearpipe-flow-resources.service';
import {
  computeTemplateFingerprint,
  parseReportTemplate,
  ReportMapping,
  ReportTemplateSlot,
} from './clearpipe-report-template';
import {
  expectedOutputsToSources,
  mappingFromOutput,
  mappingIdentity,
  mergeReportSources,
  reconcileTaskMetadataMappings,
  ReportSlotMapping,
  ReportSourceOutput,
  reportSourceIdentity,
  slotAcceptsOutput,
  suggestReportMatches,
  taskMetadataSources,
  validateReportMappings,
} from './clearpipe-report-mapping';

/**
 * Backend-connected node inspector. Mirrors the reference `node-config-panel`
 * styling and loads real ClearML resources (projects, queues, datasets, training
 * tasks, reports, autoscalers) for the selected node, then performs real actions
 * (create workload, create dataset, run command inside an autoscaler).
 */
@Component({
  selector: 'sm-clearpipe-flow-config-panel',
  templateUrl: './clearpipe-flow-config-panel.component.html',
  styleUrls: ['./clearpipe-flow-config-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule, MatProgressSpinnerModule],
})
export class ClearpipeFlowConfigPanelComponent {
  protected readonly store = inject(ClearpipeFlowStoreService);
  private readonly resources = inject(ClearpipeFlowResourcesService);

  protected readonly node = this.store.selectedNode;
  protected readonly boundary = this.store.selectedBoundary;
  protected readonly meta = computed(() => {
    const node = this.node();
    return node ? clearpipeFlowNodeMeta(node.type) : null;
  });

  /** Header badge text: Dataset nodes show their Create/Sync/Use mode instead of
   *  the generic category label. */
  protected readonly headerBadge = computed(() => {
    const node = this.node();
    const meta = this.meta();
    if (!node || !meta) return '';
    if (node.type === 'dataset') {
      const mode = String(node.config['mode'] ?? 'use') as ClearpipeDatasetMode;
      return DATASET_MODE_LABELS[mode] ?? DATASET_MODE_LABELS.use;
    }
    if (node.type === 'autoscaler') {
      const mode = String(node.config['mode'] ?? 'spinup') as ClearpipeAutoscalerMode;
      return AUTOSCALER_MODE_LABELS[mode] ?? AUTOSCALER_MODE_LABELS.spinup;
    }
    return meta.categoryLabel;
  });

  /** Node color for status dots shown in the boundary contents list. */
  protected readonly statusColors: Record<string, string> = {
    idle: '#9aa0a6',
    running: '#3b82f6',
    completed: '#22c55e',
    error: '#ef4444',
    warning: '#f59e0b',
  };

  /** Miniature cards for the nodes currently inside the selected boundary. */
  protected readonly boundaryNodes = computed(() =>
    this.store.nodesInsideBoundary(this.boundary()?.id ?? null).map((node) => ({
      id: node.id,
      label: node.label,
      status: node.status,
      meta: clearpipeFlowNodeMeta(node.type),
    })),
  );

  // Resource option lists loaded from the backend.
  protected readonly projects = signal<FlowResourceOption[]>([]);
  protected readonly queues = signal<FlowResourceOption[]>([]);
  protected readonly autoscalers = signal<FlowAutoscaler[]>([]);
  protected readonly autoscalerMessage = signal('');
  protected readonly autoscalerConnected = signal(false);
  protected readonly autoscalersLoading = signal(false);
  protected readonly datasets = signal<FlowResourceOption[]>([]);
  protected readonly trainingTasks = signal<FlowResourceOption[]>([]);
  protected readonly reports = signal<FlowResourceOption[]>([]);
  protected readonly artifacts = signal<FlowArtifact[]>([]);
  // Report node: template placeholders/embeds + mappable source-task items.
  protected readonly templateSlots = signal<ReportTemplateSlot[]>([]);
  protected readonly reportSources = signal<FlowReportSource[]>([]);

  // Graph-aware Report authoring state.
  protected readonly TASK_OUTPUT_LABELS = TASK_EXPECTED_OUTPUT_KIND_LABELS;
  /** Full markdown of the currently selected template (for preview + fingerprint). */
  protected readonly templateMarkdown = signal('');
  protected readonly templateParseErrors = signal<string[]>([]);
  /** Whether the wide mapping workspace overlay is open. */
  protected readonly mappingOpen = signal(false);
  /** Searchable template selector filter. */
  protected readonly templateFilter = signal('');
  /** Mapping workspace search + type filters. */
  protected readonly mappingSearch = signal('');
  protected readonly mappingTypeFilter = signal<'all' | 'text' | 'scalar' | 'plot' | 'sample'>('all');
  /** Mapping workspace tab: mapping table or sanitized preview. */
  protected readonly mappingTab = signal<'map' | 'preview'>('map');
  /** Discovering expected outputs for the Task node's base task. */
  protected readonly outputsLoading = signal(false);
  /** Metadata/hyperparameter outputs discovered from connected base tasks. */
  private readonly discoveredReportSourceOutputs = signal<ReportSourceOutput[]>([]);

  protected readonly listLoading = signal(false);
  protected readonly actionBusy = signal(false);
  protected readonly actionOutput = signal('');

  // Dataset node - mode toggle + per-tab state.
  protected readonly datasetModes: readonly ClearpipeDatasetMode[] = ['use', 'create', 'sync'];
  protected readonly sourceTypes: readonly ClearpipeDatasetSourceType[] = ['local', 'nfs', 's3'];
  protected readonly DATASET_MODE_LABELS = DATASET_MODE_LABELS;
  protected readonly SOURCE_TYPE_LABELS = DATASET_SOURCE_TYPE_LABELS;

  // AutoScaler node - Spin-up / Spin-down mode toggle.
  protected readonly autoscalerModes: readonly ClearpipeAutoscalerMode[] = ['spinup', 'spindown'];
  protected readonly AUTOSCALER_MODE_LABELS = AUTOSCALER_MODE_LABELS;
  /** Nearest upstream Spin-up AutoScaler node feeding this one (Spin-down source). */
  protected readonly upstreamAutoscaler = computed(() => {
    const node = this.node();
    if (!node || node.type !== 'autoscaler') return null;
    return (
      this.store
        .ancestorNodes(node.id)
        .find(
          (item) =>
            item.type === 'autoscaler' && String(item.config['mode'] ?? 'spinup') === 'spinup',
        ) ?? null
    );
  });
  /** Workload name the upstream Spin-up node started (used to tear it down). */
  protected readonly upstreamWorkloadName = computed(() => {
    const up = this.upstreamAutoscaler();
    if (!up) return '';
    return String(up.config['workloadName'] ?? '').trim() || up.label;
  });
  protected readonly datasetVersions = signal<FlowDatasetVersion[]>([]);
  protected readonly versionsLoading = signal(false);
  protected readonly syncDatasetInfo = signal<FlowDatasetInfo | null>(null);
  protected readonly syncInfoLoading = signal(false);

  // Run:ai project assets (Submit Workload parity): templates / compute /
  // environments / data sources / node pools for the selected project.
  protected readonly runaiProjects = signal<string[]>([]);
  protected readonly templateResources = signal<AutoscalerTemplateResource[]>([]);
  protected readonly computeResources = signal<AutoscalerComputeResource[]>([]);
  protected readonly environmentResources = signal<AutoscalerEnvironmentResource[]>([]);
  protected readonly dataSourceResources = signal<AutoscalerDataSourceResource[]>([]);
  protected readonly nodePools = signal<string[]>([]);
  protected readonly assetsLoading = signal(false);
  protected readonly assetsMessage = signal('');
  protected readonly templateLoading = signal(false);
  protected readonly templateMessage = signal('');
  protected readonly autoscalerIssues = computed(() => {
    const node = this.node();
    return node?.type === 'autoscaler' && String(node.config['mode'] ?? 'spinup') === 'spinup'
      ? clearpipeAutoscalerIssues(node)
      : [];
  });

  private lastNodeKey = '';
  private lastProject = '';
  private lastAssetProject = '';
  private lastGraphReportSourceKey = '';

  constructor() {
    // Base lists that do not depend on the selected node.
    this.resources.listProjects().subscribe((items) => this.projects.set(items));
    this.resources.listQueues().subscribe((items) => this.queues.set(items));
    this.resources.listReports().subscribe((items) => this.reports.set(items));
    this.loadAutoscalers();

    // Reload node-specific lists when the selection or its project changes.
    effect(() => {
      const node = this.node();
      if (!node) return;
      const project = String(node.config['project'] ?? '');
      const key = `${node.id}:${node.type}`;
      if (key === this.lastNodeKey && project === this.lastProject) return;
      this.lastNodeKey = key;
      this.lastProject = project;
      untracked(() => this.loadForNode(node.type, project));
    });

    // Move focus into the mapping workspace when it opens (keyboard access).
    effect(() => {
      if (!this.mappingOpen()) return;
      setTimeout(() => {
        document.querySelector<HTMLElement>('.mapping-overlay input[type=search]')?.focus();
      });
    });

    // A graph-aware Report binds to Task nodes, while design-time metadata and
    // hyperparameter names come from each Task node's selected base task.
    effect(() => {
      const report = this.node();
      const sources = report?.type === 'report'
        ? this.connectedTaskNodes().map((task) => ({
          nodeId: task.id,
          label: task.label,
          baseTaskId: String(task.config['baseTaskId'] ?? ''),
        }))
        : [];
      const key = sources.map((source) => `${source.nodeId}:${source.baseTaskId}`).join('|');
      if (key === this.lastGraphReportSourceKey) return;
      this.lastGraphReportSourceKey = key;
      untracked(() => this.loadGraphReportSources(sources, key));
    });
  }

  private loadForNode(type: string, project: string): void {
    this.actionOutput.set('');
    if (type === 'autoscaler') {
      this.loadProjectResources(project);
    } else if (type === 'dataset') {
      this.listLoading.set(true);
      this.datasetVersions.set([]);
      this.syncDatasetInfo.set(null);
      this.resources.listDatasets(project).subscribe((items) => {
        this.datasets.set(items);
        this.listLoading.set(false);
        const useDatasetId = this.cfg('useDatasetId');
        if (useDatasetId) this.loadUseVersions(useDatasetId);
      });
      const syncDatasetId = this.cfg('syncDatasetId');
      if (syncDatasetId) this.setSyncDataset(syncDatasetId);
    } else if (type === 'task') {
      this.listLoading.set(true);
      this.resources.listTrainingTasks(project).subscribe((items) => {
        this.trainingTasks.set(items);
        this.listLoading.set(false);
      });
    } else if (type === 'report') {
      this.listLoading.set(true);
      this.resources.listTrainingTasks(project).subscribe((items) => {
        this.trainingTasks.set(items);
        this.listLoading.set(false);
        this.refreshReportSources();
      });
      this.loadReportTemplate(this.cfg('templateReportId'));
    }
  }

  protected loadAutoscalers(): void {
    this.autoscalersLoading.set(true);
    this.resources.listAutoscalers().subscribe((result) => {
      this.autoscalers.set(result.items);
      this.autoscalerMessage.set(result.message ?? '');
      this.autoscalerConnected.set(result.connected);
      this.autoscalersLoading.set(false);
    });
  }

  /** Fetch the Run:ai project assets (compute / environments / data sources). */
  loadProjectResources(project: string, force = false): void {
    const trimmed = (project ?? '').trim();
    if (!force && trimmed === this.lastAssetProject) return;
    this.lastAssetProject = trimmed;
    if (!trimmed) {
      this.templateResources.set([]);
      this.computeResources.set([]);
      this.environmentResources.set([]);
      this.dataSourceResources.set([]);
      this.nodePools.set([]);
      this.assetsMessage.set('Select a project to load its Run:ai assets.');
      return;
    }
    this.assetsLoading.set(true);
    this.assetsMessage.set('');
    this.resources.getProjectResources(trimmed).subscribe((resources) => {
      this.assetsLoading.set(false);
      this.templateResources.set(resources?.templates ?? []);
      this.computeResources.set(resources?.compute ?? []);
      this.environmentResources.set(resources?.environments ?? []);
      this.dataSourceResources.set(resources?.data_sources ?? []);
      this.nodePools.set(resources?.node_pools ?? []);
      if (resources?.projects?.length) this.runaiProjects.set(resources.projects);
      if (!resources || resources.connected === false) {
        this.assetsMessage.set(resources?.error || 'Could not load Run:ai assets. Enter values manually below.');
      } else if (!(resources.templates?.length || resources.compute?.length || resources.environments?.length || resources.data_sources?.length)) {
        this.assetsMessage.set('No assets found for this project. Enter values manually below.');
      }
    });
  }

  // --- Run:ai asset selection (auto-fills the workload config) --------------
  protected isTemplateSelected(resource: AutoscalerTemplateResource): boolean {
    return this.cfg('template') === resource.name;
  }

  protected selectTemplate(resource: AutoscalerTemplateResource): void {
    const node = this.node();
    if (!node) return;
    if (this.isTemplateSelected(resource)) {
      this.store.updateNodeConfig(node.id, 'template', '');
      this.templateLoading.set(false);
      this.templateMessage.set('');
      return;
    }

    const project = this.cfg('project');
    this.store.updateNodeConfig(node.id, 'template', resource.name);
    this.templateLoading.set(true);
    this.templateMessage.set('');
    this.resources.getTemplate(resource.name, project).subscribe((result) => {
      const current = this.node();
      if (!current || current.id !== node.id || this.cfg('template') !== resource.name) return;
      this.templateLoading.set(false);
      if (!result?.connected || !result.workload) {
        this.templateMessage.set(result?.error || `Could not load Run:ai template "${resource.name}".`);
        return;
      }
      this.applyTemplateWorkload(result);
    });
  }

  private applyTemplateWorkload(result: AutoscalerTemplateResult): void {
    const node = this.node();
    const workload = result.workload;
    if (!node || !workload) return;
    const config: Record<string, unknown> = {
      ...node.config,
      template: result.name,
      workload_type: ['training', 'workspace', 'inference'].includes(workload.workload_type || '')
        ? workload.workload_type
        : 'training',
      large_shm: workload.large_shm === true,
    };
    for (const field of AUTOSCALER_WORKLOAD_STRING_FIELDS) {
      if (field === 'project' || field === 'template' || field === 'data_sources') continue;
      config[field] = workload[field] ?? '';
    }
    config['data_sources'] = this.templateDataSourceNames(workload.data_sources);
    this.store.updateNode(node.id, {config});
  }

  private templateDataSourceNames(value?: string): string[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => typeof item === 'string' ? item : item?.name)
          .filter((name): name is string => typeof name === 'string' && !!name.trim())
          .map((name) => name.trim());
      }
    } catch {
      // Older Run:ai outputs and saved workloads may use comma-separated names.
    }
    return value.split(',').map((name) => name.trim()).filter(Boolean);
  }

  protected isComputeSelected(resource: AutoscalerComputeResource): boolean {
    return this.cfg('compute') === resource.name;
  }

  protected selectCompute(resource: AutoscalerComputeResource): void {
    const node = this.node();
    if (!node) return;
    const selected = this.isComputeSelected(resource);
    this.store.updateNodeConfig(node.id, 'compute', selected ? '' : resource.name);
    if (!selected) {
      this.fill('gpu_devices_request', resource.gpu_devices_request);
      this.fill('gpu_memory_request', resource.gpu_memory_request);
      this.fill('gpu_portion_request', resource.gpu_portion_request);
      this.fill('cpu_core_request', resource.cpu_core_request);
      this.fill('cpu_memory_request', resource.cpu_memory_request);
    }
  }

  protected isEnvironmentSelected(resource: AutoscalerEnvironmentResource): boolean {
    return this.cfg('environment') === resource.name;
  }

  protected selectEnvironment(resource: AutoscalerEnvironmentResource): void {
    const node = this.node();
    if (!node) return;
    const selected = this.isEnvironmentSelected(resource);
    this.store.updateNodeConfig(node.id, 'environment', selected ? '' : resource.name);
    if (!selected) {
      this.fill('image', resource.image);
      this.fill('command', resource.command);
      this.fill('args', resource.args);
      this.fill('working_dir', resource.working_dir);
      this.fill('environment_variables', resource.environment_variables);
    }
  }

  protected isDataSourceSelected(resource: AutoscalerDataSourceResource): boolean {
    return this.selected('data_sources').includes(resource.name);
  }

  protected toggleDataSource(resource: AutoscalerDataSourceResource): void {
    const node = this.node();
    if (!node) return;
    const current = this.selected('data_sources');
    const next = current.includes(resource.name)
      ? current.filter((name) => name !== resource.name)
      : [...current, resource.name];
    this.store.updateNodeConfig(node.id, 'data_sources', next);
    const pvc = resource.existing_pvc || (resource.path ? `claimname=${resource.name},path=${resource.path}` : '');
    if (!current.includes(resource.name) && pvc && !this.cfg('existing_pvc')) {
      this.store.updateNodeConfig(node.id, 'existing_pvc', pvc);
    }
  }

  private fill(key: string, value?: string): void {
    const node = this.node();
    if (node && value) this.store.updateNodeConfig(node.id, key, value);
  }

  // --- boundary helpers ----------------------------------------------------
  protected setBoundaryLabel(label: string): void {
    const boundary = this.boundary();
    if (boundary) this.store.updateBoundary(boundary.id, {label});
  }

  protected setBoundaryOnReach(onReach: string): void {
    const boundary = this.boundary();
    if (boundary) this.store.updateBoundary(boundary.id, {onReach});
  }

  protected removeSelectedBoundary(): void {
    const boundary = this.boundary();
    if (boundary) this.store.removeBoundary(boundary.id);
  }

  protected focusNode(nodeId: string): void {
    this.store.selectNode(nodeId);
  }

  // --- generic field helpers ----------------------------------------------
  protected label(): string {
    return this.node()?.label ?? '';
  }

  protected setLabel(label: string): void {
    const node = this.node();
    if (node) this.store.updateNode(node.id, {label});
  }

  protected desc(): string {
    return this.node()?.description ?? '';
  }

  protected setDesc(description: string): void {
    const node = this.node();
    if (node) this.store.updateNode(node.id, {description});
  }

  protected cfg(key: string): string {
    const value = this.node()?.config[key];
    return value == null ? '' : String(value);
  }

  protected setCfg(key: string, value: string | number): void {
    const node = this.node();
    if (node) this.store.updateNodeConfig(node.id, key, value);
  }

  // --- boolean flag helpers -----------------------------------------------
  protected flag(key: string): boolean {
    return this.node()?.config[key] === true;
  }

  protected setFlag(key: string, value: boolean): void {
    const node = this.node();
    if (node) this.store.updateNodeConfig(node.id, key, value);
  }

  /** Human-readable summary of the current schedule for the inspector hint. */
  protected scheduleSummary(): string {
    const node = this.node();
    if (!node) return '';
    const config = node.config;
    if (config['scheduleMode'] === 'cron') {
      return `Cron: ${String(config['cron'] || '').trim() || '(not set)'}`;
    }
    const value = Number(config['intervalValue']) || 0;
    const unit = String(config['intervalUnit'] || 'hours');
    const plural = value === 1 ? unit.replace(/s$/, '') : unit;
    return `Every ${value} ${plural}`;
  }

  // --- multi-select helpers (arrays stored in config) ---------------------
  protected selected(key: string): string[] {
    const value = this.node()?.config[key];
    return Array.isArray(value) ? (value as string[]) : [];
  }

  protected isSelected(key: string, id: string): boolean {
    return this.selected(key).includes(id);
  }

  protected toggle(key: string, id: string): void {
    const node = this.node();
    if (!node) return;
    const current = this.selected(key);
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    this.store.updateNodeConfig(node.id, key, next);
    if (key === 'artifactSources') this.refreshReportSources();
  }

  // --- autoscaler selection ------------------------------------------------
  protected setAutoscaler(name: string): void {
    const node = this.node();
    if (!node) return;
    const autoscaler = this.autoscalers().find((item) => item.name === name);
    this.store.updateNodeConfig(node.id, 'autoscaler', name);
    if (autoscaler?.project) {
      if (this.cfg('project') !== autoscaler.project) {
        this.store.updateNodeConfig(node.id, 'template', '');
        this.templateMessage.set('');
      }
      this.store.updateNodeConfig(node.id, 'project', autoscaler.project);
      this.loadProjectResources(autoscaler.project, true);
    }
  }

  protected setAutoscalerProject(project: string): void {
    if (this.cfg('project') !== project) {
      this.setCfg('template', '');
      this.templateMessage.set('');
      this.templateLoading.set(false);
    }
    this.setCfg('project', project);
    this.loadProjectResources(project, true);
  }

  // --- autoscaler Spin-up / Spin-down mode ---------------------------------
  protected setAutoscalerMode(mode: ClearpipeAutoscalerMode): void {
    this.setCfg('mode', mode);
  }

  // --- actions -------------------------------------------------------------
  protected runCommand(): void {
    const node = this.node();
    if (!node || this.actionBusy()) return;
    const project = String(node.config['target'] || '');
    const command = String(node.config['command'] || '');
    if (!project || !command) {
      this.actionOutput.set('Select a target autoscaler and enter a command.');
      return;
    }
    this.actionBusy.set(true);
    this.store.setNodeStatus(node.id, 'running', 'Running command...');
    this.resources.runCommand(project, command).subscribe((result) => {
      this.actionBusy.set(false);
      if (!result) {
        this.store.setNodeStatus(node.id, 'error', 'Command failed');
        this.actionOutput.set('Command failed.');
        return;
      }
      this.store.setNodeStatus(node.id, 'completed', 'Command executed');
      this.actionOutput.set(this.summarize(result, 'Command executed.'));
    });
  }

  // --- Dataset node: Use tab -----------------------------------------------
  protected setDatasetMode(mode: ClearpipeDatasetMode): void {
    this.setCfg('mode', mode);
  }

  protected setUseDataset(datasetId: string): void {
    this.setCfg('useDatasetId', datasetId);
    this.setCfg('useVersion', 'latest');
    this.loadUseVersions(datasetId);
  }

  private loadUseVersions(datasetId: string): void {
    if (!datasetId) {
      this.datasetVersions.set([]);
      return;
    }
    this.versionsLoading.set(true);
    this.resources.listDatasetVersions(datasetId).subscribe((items) => {
      this.datasetVersions.set(items);
      this.versionsLoading.set(false);
    });
  }

  // --- Dataset node: Create tab ---------------------------------------------
  protected sourcePathPlaceholder(): string {
    const type = this.cfg('createSourceType') || 'local';
    if (type === 's3') return 's3://bucket/path';
    if (type === 'nfs') return 'nfs-server:/export/path';
    return '/local/path/to/data';
  }

  protected createFromForm(): void {
    const node = this.node();
    const name = this.cfg('createDatasetName').trim();
    if (!node || !name || this.actionBusy()) return;
    this.actionBusy.set(true);
    this.store.setNodeStatus(node.id, 'running', 'Creating dataset...');
    this.resources
      .createDatasetVersion({
        name,
        project: this.cfg('createProject').trim(),
        version: '1.0.0',
        alias: this.cfg('createAlias').trim() || undefined,
        sourcePath: this.cfg('createSourcePath').trim() || undefined,
        sourceType: this.cfg('createSourceType') || 'local',
        queue: this.cfg('createQueue') || undefined,
      })
      .subscribe((id) => {
        this.actionBusy.set(false);
        if (!id) {
          this.store.setNodeStatus(node.id, 'error', 'Dataset creation failed');
          this.actionOutput.set('Could not create dataset.');
          return;
        }
        this.store.setNodeStatus(node.id, 'completed', 'Dataset created');
        this.actionOutput.set(`Dataset created (${id}).`);
      });
  }

  // --- Dataset node: Sync tab -----------------------------------------------
  protected setSyncDataset(datasetId: string): void {
    this.setCfg('syncDatasetId', datasetId);
    this.syncDatasetInfo.set(null);
    if (!datasetId) return;
    this.syncInfoLoading.set(true);
    this.resources.getDatasetInfo(datasetId).subscribe((info) => {
      this.syncInfoLoading.set(false);
      this.syncDatasetInfo.set(info);
      if (info?.sourcePath && this.cfg('syncPathMode') !== 'new') {
        this.setCfg('syncPath', info.sourcePath);
      }
    });
  }

  protected setSyncPathMode(mode: 'same' | 'new'): void {
    this.setCfg('syncPathMode', mode);
    const info = this.syncDatasetInfo();
    this.setCfg('syncPath', mode === 'same' ? info?.sourcePath ?? '' : '');
  }

  /** The version the synced dataset will get: a custom tag, or the "normal
   *  increment" (major +1, minor/patch reset to 0). */
  protected nextSyncVersion(): string {
    if (this.cfg('syncVersionMode') === 'tag') return this.cfg('syncVersionTag').trim() || 'untagged';
    return incrementDatasetVersion(this.syncDatasetInfo()?.version);
  }

  protected syncDataset(): void {
    const node = this.node();
    const datasetId = this.cfg('syncDatasetId');
    if (!node || !datasetId || this.actionBusy()) return;
    const info = this.syncDatasetInfo();
    const version = this.nextSyncVersion();
    const path = this.cfg('syncPathMode') === 'new' ? this.cfg('syncPath').trim() : info?.sourcePath ?? this.cfg('syncPath').trim();
    this.actionBusy.set(true);
    this.store.setNodeStatus(node.id, 'running', 'Syncing dataset...');
    this.resources
      .createDatasetVersion({
        name: info?.name || 'dataset',
        // The dataset already exists as a hidden project - create the new
        // version task directly inside it, linked to the latest existing
        // version task as its ClearML lineage parent.
        project: datasetId,
        parentId: info?.id,
        version,
        sourcePath: path || undefined,
        sourceType: info?.sourceType,
      })
      .subscribe((id) => {
        this.actionBusy.set(false);
        if (!id) {
          this.store.setNodeStatus(node.id, 'error', 'Dataset sync failed');
          this.actionOutput.set('Could not sync dataset.');
          return;
        }
        this.store.setNodeStatus(node.id, 'completed', `Synced to v${version}`);
        this.actionOutput.set(`Dataset synced (${id}) — v${version}.`);
        this.setCfg('syncVersionTag', '');
        this.setSyncDataset(id);
      });
  }

  private refreshReportSources(): void {
    const taskIds = this.selected('artifactSources');
    if (!taskIds.length) {
      this.artifacts.set([]);
      this.reportSources.set([]);
      return;
    }
    this.resources.listTaskArtifacts(taskIds).subscribe((items) => this.artifacts.set(items));
    this.resources.getReportSources(taskIds).subscribe((items) => {
      this.reportSources.set(items);
      this.autoMapReport();
    });
  }

  // --- Report node: template slots + source mapping ------------------------
  protected setReportTemplate(reportId: string): void {
    this.setCfg('templateReportId', reportId);
    this.loadReportTemplate(reportId);
  }

  private loadReportTemplate(reportId: string): void {
    this.templateSlots.set([]);
    this.templateMarkdown.set('');
    this.templateParseErrors.set([]);
    if (!reportId) return;
    this.resources.getReportMarkdown(reportId).subscribe((markdown) => {
      const node = this.node();
      if (!node || node.type !== 'report' || this.cfg('templateReportId') !== reportId) return;
      const parsed = parseReportTemplate(markdown);
      this.templateMarkdown.set(markdown);
      this.templateSlots.set(parsed.slots);
      this.templateParseErrors.set(parsed.errors);
      const persistedSlots = Array.isArray(node.config['templateSlots'])
        ? (node.config['templateSlots'] as ReportTemplateSlot[])
        : [];
      if (JSON.stringify(persistedSlots) !== JSON.stringify(parsed.slots)) {
        this.store.updateNodeConfig(node.id, 'templateSlots', parsed.slots);
      }
      if (String(node.config['templateFingerprint'] ?? '') !== parsed.fingerprint) {
        this.store.updateNodeConfig(node.id, 'templateFingerprint', parsed.fingerprint);
      }
      this.reconcileGraphReportMappings();
      this.autoMapReport();
    });
  }

  protected reportMappings(): Record<string, ReportMapping> {
    const value = this.node()?.config['mappings'];
    return value && typeof value === 'object' ? (value as Record<string, ReportMapping>) : {};
  }

  protected mappingRef(slotKey: string): string {
    return this.reportMappings()[slotKey]?.ref ?? '';
  }

  /** Source items offered for a slot. Media slots are filtered by the embed's
   *  `type=` (scalar -> scalar curves, plot -> plots, sample/other -> both),
   *  falling back to all scalar+plot items when the typed subset is empty. Text
   *  slots accept any single-valued item. */
  protected sourceOptionsFor(slot: ReportTemplateSlot): FlowReportSource[] {
    const all = this.reportSources();
    if (slot.kind !== 'media') return all;
    const media = all.filter((s) => s.kind === 'scalar' || s.kind === 'plot');
    const typed =
      slot.mediaType === 'scalar'
        ? media.filter((s) => s.kind === 'scalar')
        : slot.mediaType === 'plot'
          ? media.filter((s) => s.kind === 'plot')
          : media;
    return typed.length ? typed : media;
  }

  protected setMapping(slotKey: string, sourceRef: string): void {
    const node = this.node();
    if (!node) return;
    const next: Record<string, ReportMapping> = {...this.reportMappings()};
    if (!sourceRef) {
      delete next[slotKey];
    } else {
      const src = this.reportSources().find((s) => s.ref === sourceRef);
      if (!src) return;
      next[slotKey] = {
        taskId: src.taskId,
        kind: src.kind,
        ref: src.ref,
        ...(src.metric ? {metric: src.metric} : {}),
        ...(src.variant !== undefined ? {variant: src.variant} : {}),
      };
    }
    this.store.updateNodeConfig(node.id, 'mappings', next);
  }

  /** Auto-fill common task-field slots when exactly one source task is selected. */
  private autoMapReport(): void {
    const node = this.node();
    if (!node || node.type !== 'report') return;
    const slots = this.templateSlots();
    const sources = this.reportSources();
    if (!slots.length || !sources.length) return;
    if (new Set(sources.map((s) => s.taskId)).size !== 1) return;
    const fieldForToken: Record<string, string> = {
      TASK_NAME: 'name', TASK_ID: 'id', PROJECT: 'project', STATUS: 'status',
    };
    const next: Record<string, ReportMapping> = {...this.reportMappings()};
    let changed = false;
    for (const slot of slots) {
      if (next[slot.key] || slot.kind !== 'text' || !slot.token) continue;
      const ref = fieldForToken[slot.token];
      const src = ref ? sources.find((s) => s.ref === ref) : undefined;
      if (src) {
        next[slot.key] = {taskId: src.taskId, kind: src.kind, ref: src.ref};
        changed = true;
      }
    }
    if (changed) this.store.updateNodeConfig(node.id, 'mappings', next);
  }

  // --- Graph-aware Task + Report authoring --------------------------------

  private taskExpectedOutputs(config: Record<string, unknown>): TaskExpectedOutput[] {
    const value = config['expectedOutputs'];
    return Array.isArray(value) ? (value as TaskExpectedOutput[]) : [];
  }

  /** The selected Task node's declared expected outputs. */
  protected expectedOutputs(): TaskExpectedOutput[] {
    return this.taskExpectedOutputs(this.node()?.config ?? {});
  }

  /** Task node: pick the single base task and discover its expected outputs. */
  protected setBaseTask(taskId: string): void {
    const node = this.node();
    if (!node) return;
    this.store.updateNodeConfig(node.id, 'baseTaskId', taskId);
    if (taskId) this.discoverExpectedOutputs(taskId);
  }

  protected discoverExpectedOutputs(taskId?: string): void {
    const node = this.node();
    const baseId = taskId ?? String(node?.config['baseTaskId'] ?? '');
    if (!node || !baseId) return;
    this.outputsLoading.set(true);
    this.resources.getTaskReportOutputs(baseId).subscribe((outputs) => {
      this.outputsLoading.set(false);
      // Keep any manual outputs the author added for never-observed telemetry.
      const merged = this.taskExpectedOutputs(node.config).filter((o) => o.manual);
      const seen = new Set(merged.map(expectedOutputId));
      for (const output of outputs) {
        const id = expectedOutputId(output);
        if (!seen.has(id)) {
          seen.add(id);
          merged.push(output);
        }
      }
      this.store.updateNodeConfig(node.id, 'expectedOutputs', merged);
    });
  }

  /** Task nodes directly connected as sources of the selected Report node. */
  protected readonly connectedTaskNodes = computed(() => {
    const report = this.node();
    if (!report || report.type !== 'report') return [];
    const nodes = this.store.nodes();
    return this.store
      .edges()
      .filter((edge) => edge.target === report.id)
      .map((edge) => nodes.find((n) => n.id === edge.source))
      .filter((n): n is NonNullable<typeof n> => !!n && n.type === 'task');
  });

  /** Selectable source outputs derived from each connected Task node's contract. */
  protected readonly reportSourceOutputs = computed<ReportSourceOutput[]>(() =>
    mergeReportSources(
      this.connectedTaskNodes().flatMap((node) => taskMetadataSources(node.id, node.label)),
      this.connectedTaskNodes().flatMap((node) =>
        expectedOutputsToSources(node.id, node.label, this.taskExpectedOutputs(node.config)),
      ),
      this.discoveredReportSourceOutputs(),
    ),
  );

  private loadGraphReportSources(
    sources: {nodeId: string; label: string; baseTaskId: string}[],
    key: string,
  ): void {
    const selected = sources.filter((source) => source.baseTaskId);
    if (!selected.length) {
      this.discoveredReportSourceOutputs.set([]);
      this.reconcileGraphReportMappings();
      return;
    }
    const taskIds = [...new Set(selected.map((source) => source.baseTaskId))];
    this.resources.getReportSources(taskIds).subscribe((items) => {
      if (this.lastGraphReportSourceKey !== key) return;
      const outputs: ReportSourceOutput[] = [];
      for (const source of selected) {
        for (const item of items.filter((candidate) => candidate.taskId === source.baseTaskId)) {
          let outputKind: ReportSourceOutput['outputKind'];
          let selector: ReportSourceOutput['selector'];
          if (item.kind === 'field') {
            outputKind = 'field';
            selector = {field: item.ref};
          } else if (item.kind === 'hyperparam') {
            const separator = item.ref.indexOf('/');
            if (separator <= 0 || separator === item.ref.length - 1) continue;
            outputKind = 'hyperparam';
            selector = {
              section: item.ref.slice(0, separator),
              parameter: item.ref.slice(separator + 1),
            };
          } else if (item.kind === 'artifact') {
            outputKind = 'artifact';
            selector = {artifactKey: item.ref.replace(/^artifact\u0000/, '')};
          } else {
            outputKind = item.kind === 'plot'
              ? 'plot'
              : item.variant
                ? 'scalar'
                : 'scalar_graph';
            selector = {metric: item.metric, variant: item.variant};
          }
          const mappingSource = {sourceNodeId: source.nodeId};
          outputs.push({
            sourceNodeId: source.nodeId,
            sourceLabel: source.label,
            outputKind,
            selector,
            label: item.label,
            identity: reportSourceIdentity(mappingSource, outputKind, selector),
          });
        }
      }
      this.discoveredReportSourceOutputs.set(outputs);
      this.reconcileGraphReportMappings();
    });
  }

  private reconcileGraphReportMappings(): void {
    const node = this.node();
    if (!node || node.type !== 'report' || !this.templateSlots().length) return;
    const current = this.graphMappings();
    const next = reconcileTaskMetadataMappings(
      this.templateSlots(),
      current,
      this.reportSourceOutputs(),
    );
    if (next.length !== current.length) {
      this.store.updateNodeConfig(node.id, 'reportMappings', next);
    }
  }

  /** The Report node's persisted graph-aware mappings. */
  protected graphMappings(): ReportSlotMapping[] {
    const value = this.node()?.config['reportMappings'];
    return Array.isArray(value) ? (value as ReportSlotMapping[]) : [];
  }

  protected readonly reportValidation = computed(() => {
    const report = this.node();
    if (!report || report.type !== 'report') return null;
    const connected = new Set(this.connectedTaskNodes().map((n) => n.id));
    const available = new Set(this.reportSourceOutputs().map((o) => o.identity));
    const fingerprint = String(report.config['templateFingerprint'] ?? '');
    const markdown = this.templateMarkdown();
    const drifted = !!fingerprint && !!markdown && computeTemplateFingerprint(markdown) !== fingerprint;
    return validateReportMappings({
      slots: this.templateSlots(),
      mappings: this.graphMappings(),
      connectedSourceNodeIds: connected,
      availableIdentities: available,
      templateSelected: !!report.config['templateReportId'],
      templateDrifted: drifted,
    });
  });

  protected readonly mappingProgress = computed(() => {
    const validation = this.reportValidation();
    return validation ? `${validation.mappedCount} / ${validation.totalRequired} mapped` : '';
  });

  protected readonly reportSuggestions = computed(() =>
    suggestReportMatches(this.templateSlots(), this.reportSourceOutputs()),
  );

  protected filteredReports(): FlowResourceOption[] {
    const term = this.templateFilter().trim().toLowerCase();
    const all = this.reports();
    return term ? all.filter((report) => report.name.toLowerCase().includes(term)) : all;
  }

  protected openMappings(): void {
    this.mappingOpen.set(true);
    this.mappingTab.set('map');
    const reportId = String(this.node()?.config['templateReportId'] ?? '');
    if (reportId && !this.templateSlots().length) this.loadReportTemplate(reportId);
  }

  protected closeMappings(): void {
    this.mappingOpen.set(false);
  }

  protected slotGroup(slot: ReportTemplateSlot): string {
    if (slot.kind === 'text') return 'Text';
    const type = (slot.mediaType ?? 'scalar').toLowerCase();
    return type === 'plot' ? 'Plots' : type === 'sample' ? 'Images' : 'Scalars';
  }

  protected groupedSlots(): {group: string; slots: ReportTemplateSlot[]}[] {
    const search = this.mappingSearch().trim().toLowerCase();
    const typeFilter = this.mappingTypeFilter();
    const order = ['Text', 'Scalars', 'Plots', 'Images'];
    const groups = new Map<string, ReportTemplateSlot[]>();
    for (const slot of this.templateSlots()) {
      if (search && !slot.label.toLowerCase().includes(search)) continue;
      if (typeFilter === 'text' && slot.kind !== 'text') continue;
      if (typeFilter !== 'all' && typeFilter !== 'text' && (slot.mediaType ?? 'scalar') !== typeFilter) continue;
      const group = this.slotGroup(slot);
      const bucket = groups.get(group);
      if (bucket) bucket.push(slot);
      else groups.set(group, [slot]);
    }
    return order.filter((group) => groups.has(group)).map((group) => ({group, slots: groups.get(group)!}));
  }

  protected mappingFor(slotKey: string): ReportSlotMapping | undefined {
    return this.graphMappings().find((mapping) => mapping.slotKey === slotKey);
  }

  /** Source outputs compatible with a slot (per-row dropdown options). */
  protected sourceOptionsForSlot(slot: ReportTemplateSlot): ReportSourceOutput[] {
    return this.reportSourceOutputs().filter((output) => slotAcceptsOutput(slot, output.outputKind));
  }

  protected currentIdentity(slotKey: string): string {
    const mapping = this.mappingFor(slotKey);
    return mapping ? mappingIdentity(mapping) : '';
  }

  protected slotSuggestion(slotKey: string): ReportSourceOutput | undefined {
    return this.reportSuggestions().find((suggestion) => suggestion.slotKey === slotKey)?.output;
  }

  protected setSlotSource(slot: ReportTemplateSlot, identity: string): void {
    const node = this.node();
    if (!node) return;
    const next = this.graphMappings().filter((mapping) => mapping.slotKey !== slot.key);
    if (identity) {
      const output = this.reportSourceOutputs().find((item) => item.identity === identity);
      if (output) {
        next.push(mappingFromOutput(slot, output, {required: this.mappingFor(slot.key)?.required ?? true, confirmed: true}));
      }
    }
    this.store.updateNodeConfig(node.id, 'reportMappings', next);
  }

  protected toggleSlotRequired(slotKey: string): void {
    const node = this.node();
    if (!node) return;
    const next = this.graphMappings().map((mapping) =>
      mapping.slotKey === slotKey ? {...mapping, required: !mapping.required, ignored: false} : mapping,
    );
    this.store.updateNodeConfig(node.id, 'reportMappings', next);
  }

  protected ignoreSlot(slot: ReportTemplateSlot): void {
    const node = this.node();
    if (!node) return;
    const existing = this.mappingFor(slot.key);
    const next = this.graphMappings().filter((mapping) => mapping.slotKey !== slot.key);
    next.push({
      slotKey: slot.key,
      source: existing?.source ?? {},
      outputKind: existing?.outputKind ?? 'field',
      selector: existing?.selector ?? {},
      required: false,
      confirmed: true,
      ignored: true,
    });
    this.store.updateNodeConfig(node.id, 'reportMappings', next);
  }

  protected acceptSuggestions(): void {
    const node = this.node();
    if (!node) return;
    const slotByKey = new Map(this.templateSlots().map((slot) => [slot.key, slot]));
    const mapped = new Set(this.graphMappings().map((mapping) => mapping.slotKey));
    const next = [...this.graphMappings()];
    for (const suggestion of this.reportSuggestions()) {
      const slot = slotByKey.get(suggestion.slotKey);
      if (!slot || mapped.has(suggestion.slotKey)) continue;
      next.push(mappingFromOutput(slot, suggestion.output, {required: true, confirmed: true}));
    }
    this.store.updateNodeConfig(node.id, 'reportMappings', next);
  }

  protected applyMappings(): void {
    const node = this.node();
    if (!node) return;
    // Persist the template slot manifest + fingerprint alongside the mappings.
    this.store.updateNodeConfig(node.id, 'templateSlots', this.templateSlots());
    this.store.updateNodeConfig(node.id, 'templateFingerprint', computeTemplateFingerprint(this.templateMarkdown()));
    this.mappingOpen.set(false);
  }

  /** Sanitized template preview: text tokens replaced by their mapped label,
   *  iframes collapsed to a compact chip (no external widget loads). */
  protected previewText(): string {
    let markdown = this.templateMarkdown();
    for (const slot of this.templateSlots()) {
      if (slot.kind === 'text' && slot.token) {
        const mapping = this.mappingFor(slot.key);
        const label = mapping && !mapping.ignored
          ? (mapping.selector.field ?? mapping.selector.metric ?? mapping.selector.artifactKey ?? 'mapped')
          : '(unmapped)';
        markdown = markdown.split(`<${slot.token}>`).join(`[${label}]`);
      }
    }
    return markdown.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '⟦ embed ⟧');
  }

  // --- Legacy multi-task node: blocking "Split into Task nodes" migration ---

  protected requiresSplit(): boolean {
    const node = this.node();
    return !!node && node.type === 'task' && !!node.config['requiresSplit'];
  }

  protected legacyTaskIds(): string[] {
    const value = this.node()?.config['taskIds'];
    return Array.isArray(value) ? (value as unknown[]).filter((v): v is string => typeof v === 'string') : [];
  }

  protected splitTaskNode(): void {
    const node = this.node();
    if (!node) return;
    this.store.splitTaskNode(node.id);
  }

  // --- Advanced: fixed external-task Report sources ------------------------

  protected isSlotExternal(slotKey: string): boolean {
    return !!this.mappingFor(slotKey)?.source.externalTaskId;
  }

  protected slotExternalId(slotKey: string): string {
    return this.mappingFor(slotKey)?.source.externalTaskId ?? '';
  }

  /** Toggle a slot between pipeline-source binding and an advanced fixed external task. */
  protected toggleSlotAdvanced(slot: ReportTemplateSlot): void {
    const node = this.node();
    if (!node) return;
    const existing = this.mappingFor(slot.key);
    const next = this.graphMappings().filter((mapping) => mapping.slotKey !== slot.key);
    if (this.isSlotExternal(slot.key)) {
      // Switch back to unmapped pipeline source.
      this.store.updateNodeConfig(node.id, 'reportMappings', next);
      return;
    }
    next.push({
      slotKey: slot.key,
      source: {externalTaskId: existing?.source.externalTaskId ?? ''},
      outputKind: existing?.outputKind ?? (slot.kind === 'text' ? 'field' : 'scalar'),
      selector: existing?.selector ?? (slot.kind === 'text' ? {field: 'name'} : {}),
      required: existing?.required ?? true,
      confirmed: true,
    });
    this.store.updateNodeConfig(node.id, 'reportMappings', next);
  }

  /** Set the fixed external task id for an advanced slot source. */
  protected setSlotExternalId(slot: ReportTemplateSlot, taskId: string): void {
    const node = this.node();
    if (!node) return;
    const next = this.graphMappings().map((mapping) =>
      mapping.slotKey === slot.key
        ? {...mapping, source: {externalTaskId: taskId.trim()}, broken: !taskId.trim()}
        : mapping,
    );
    this.store.updateNodeConfig(node.id, 'reportMappings', next);
  }

  // --- Mapping workspace keyboard + focus management ----------------------

  /** Roving focus across slot rows with ArrowUp/ArrowDown; Escape closes. */
  protected onMappingKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.closeMappings();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const container = event.currentTarget as HTMLElement;
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.slot-row select'));
    if (!rows.length) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? rows.indexOf(active) : -1;
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(rows.length - 1, index + 1)
      : Math.max(0, index - 1);
    if (nextIndex !== index && nextIndex >= 0) {
      event.preventDefault();
      rows[nextIndex].focus();
    }
  }

  private summarize(result: Record<string, unknown>, fallback: string): string {
    if (typeof result['console_log'] === 'string' && result['console_log']) return result['console_log'] as string;
    if (result['execution_id']) return `${fallback} Execution: ${result['execution_id']}`;
    try {
      return JSON.stringify(result, null, 2);
    } catch {
      return fallback;
    }
  }
}
