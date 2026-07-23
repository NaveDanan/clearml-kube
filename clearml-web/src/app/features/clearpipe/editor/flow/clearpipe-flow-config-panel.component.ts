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
} from './clearpipe-flow.models';
import {ClearpipeFlowStoreService} from './clearpipe-flow-store.service';
import {
  AutoscalerComputeResource,
  AutoscalerDataSourceResource,
  AutoscalerEnvironmentResource,
  ClearpipeFlowResourcesService,
  FlowArtifact,
  FlowAutoscaler,
  FlowDatasetInfo,
  FlowDatasetVersion,
  FlowResourceOption,
} from './clearpipe-flow-resources.service';

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

  // Run:ai project assets (Submit Workload parity): compute / environments /
  // data sources / node pools / project list for the selected autoscaler project.
  protected readonly runaiProjects = signal<string[]>([]);
  protected readonly computeResources = signal<AutoscalerComputeResource[]>([]);
  protected readonly environmentResources = signal<AutoscalerEnvironmentResource[]>([]);
  protected readonly dataSourceResources = signal<AutoscalerDataSourceResource[]>([]);
  protected readonly nodePools = signal<string[]>([]);
  protected readonly assetsLoading = signal(false);
  protected readonly assetsMessage = signal('');

  private lastNodeKey = '';
  private lastProject = '';
  private lastAssetProject = '';

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
        this.refreshArtifacts();
      });
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
      this.computeResources.set(resources?.compute ?? []);
      this.environmentResources.set(resources?.environments ?? []);
      this.dataSourceResources.set(resources?.data_sources ?? []);
      this.nodePools.set(resources?.node_pools ?? []);
      if (resources?.projects?.length) this.runaiProjects.set(resources.projects);
      if (!resources || resources.connected === false) {
        this.assetsMessage.set(resources?.error || 'Could not load Run:ai assets. Enter values manually below.');
      } else if (!(resources.compute?.length || resources.environments?.length || resources.data_sources?.length)) {
        this.assetsMessage.set('No assets found for this project. Enter values manually below.');
      }
    });
  }

  // --- Run:ai asset selection (auto-fills the workload config) --------------
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
    if (key === 'artifactSources') this.refreshArtifacts();
  }

  // --- autoscaler selection ------------------------------------------------
  protected setAutoscaler(name: string): void {
    const node = this.node();
    if (!node) return;
    const autoscaler = this.autoscalers().find((item) => item.name === name);
    this.store.updateNodeConfig(node.id, 'autoscaler', name);
    if (autoscaler?.project) {
      this.store.updateNodeConfig(node.id, 'project', autoscaler.project);
      this.loadProjectResources(autoscaler.project, true);
    }
  }

  protected setAutoscalerProject(project: string): void {
    this.setCfg('project', project);
    this.loadProjectResources(project, true);
  }

  // --- autoscaler Spin-up / Spin-down mode ---------------------------------
  protected setAutoscalerMode(mode: ClearpipeAutoscalerMode): void {
    this.setCfg('mode', mode);
  }

  /**
   * Spin-down action: tears down the workload a connected upstream Spin-up
   * AutoScaler node started, by running a `runai workspace stop|delete` command
   * inside the target autoscaler. Falls back to a manually entered workload name.
   */
  protected spinDownWorkload(): void {
    const node = this.node();
    if (!node || this.actionBusy()) return;
    const manual = this.cfg('spinDownWorkloadName').trim();
    const workload = manual || this.upstreamWorkloadName();
    if (!this.upstreamAutoscaler() && !manual) {
      this.actionOutput.set(
        'No upstream Spin-up AutoScaler found in the pipeline. Connect one, or enter a workload name to tear down.',
      );
      return;
    }
    const project = String(node.config['project'] || node.config['autoscaler'] || '');
    if (!project) {
      this.actionOutput.set('Select a configured autoscaler / project first.');
      return;
    }
    if (!workload) {
      this.actionOutput.set('No workload name to tear down.');
      return;
    }
    const isDelete = (this.cfg('spinDownAction') || 'stop') === 'delete';
    const command = `runai workspace ${isDelete ? 'delete' : 'suspend'} ${workload} -p ${project}`;
    this.actionBusy.set(true);
    this.store.setNodeStatus(node.id, 'running', isDelete ? 'Deleting workload...' : 'Stopping workload...');
    this.resources.runCommand(project, command).subscribe((result) => {
      this.actionBusy.set(false);
      if (!result) {
        this.store.setNodeStatus(node.id, 'error', 'Spin-down failed');
        this.actionOutput.set('Spin-down failed.');
        return;
      }
      this.store.setNodeStatus(node.id, 'completed', isDelete ? 'Workload deleted' : 'Workload stopped');
      this.actionOutput.set(this.summarize(result, `Workload ${isDelete ? 'deleted' : 'stopped'}.`));
    });
  }

  // --- actions -------------------------------------------------------------
  protected createWorkload(): void {
    const node = this.node();
    if (!node || this.actionBusy()) return;
    const config = node.config;
    const str = (key: string): string | undefined => String(config[key] ?? '') || undefined;
    const project = String(config['project'] || config['autoscaler'] || '');
    if (!project) {
      this.actionOutput.set('Select a configured autoscaler first.');
      return;
    }
    const dataSources = this.selected('data_sources');
    this.actionBusy.set(true);
    this.store.setNodeStatus(node.id, 'running', 'Submitting workload...');
    this.resources
      .submitWorkload({
        project,
        queue: str('queue'),
        workload_name: String(config['workloadName'] || node.label),
        image: str('image'),
        command: str('command'),
        args: str('args'),
        working_dir: str('working_dir'),
        environment_variables: str('environment_variables'),
        environment: str('environment'),
        compute: str('compute'),
        template: str('template'),
        data_sources: dataSources.length ? dataSources.join(',') : undefined,
        node_pools: str('node_pools'),
        existing_pvc: str('existing_pvc'),
        gpu_devices_request: str('gpu_devices_request'),
        gpu_memory_request: str('gpu_memory_request'),
        gpu_portion_request: str('gpu_portion_request'),
        cpu_core_request: str('cpu_core_request'),
        cpu_memory_request: str('cpu_memory_request'),
      })
      .subscribe((result) => {
        this.actionBusy.set(false);
        if (!result) {
          this.store.setNodeStatus(node.id, 'error', 'Workload submission failed');
          this.actionOutput.set('Workload submission failed.');
          return;
        }
        this.store.setNodeStatus(node.id, 'running', 'Workload submitted');
        this.actionOutput.set(this.summarize(result, 'Workload submitted.'));
      });
  }

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

  private refreshArtifacts(): void {
    const taskIds = this.selected('artifactSources');
    if (!taskIds.length) {
      this.artifacts.set([]);
      return;
    }
    this.resources.listTaskArtifacts(taskIds).subscribe((items) => this.artifacts.set(items));
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
