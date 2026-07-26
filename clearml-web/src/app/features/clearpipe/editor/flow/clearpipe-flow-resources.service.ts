import {inject, Injectable} from '@angular/core';
import {forkJoin, Observable, of, timer} from 'rxjs';
import {catchError, filter, map, switchMap, take, takeWhile, timeout} from 'rxjs/operators';
import {HTTP} from '~/app.constants';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {TaskExpectedOutput} from './clearpipe-flow.models';
import {
  AutoscalerComputeResource,
  AutoscalerDataSourceResource,
  AutoscalerEnvironmentResource,
  AutoscalerProjectResources,
  AutoscalerTemplateResource,
  AutoscalerTemplateResult,
} from '@common/workers-and-queues/actions/autoscaler.actions';

export type {
  AutoscalerComputeResource,
  AutoscalerDataSourceResource,
  AutoscalerEnvironmentResource,
  AutoscalerProjectResources,
  AutoscalerTemplateResource,
  AutoscalerTemplateResult,
};

export interface FlowResourceOption {
  id: string;
  name: string;
  project?: string;
  status?: string;
}

export interface FlowAutoscaler {
  name: string;
  project?: string;
  status?: string;
  connected?: boolean;
}

export interface FlowAutoscalerResult {
  items: FlowAutoscaler[];
  connected: boolean;
  configured: boolean;
  message?: string;
}

export interface FlowArtifact {
  key: string;
  taskId: string;
  taskName?: string;
  type?: string;
  uri?: string;
}

/** Shape of the `clearpipe.task_report_outputs` response (names only). */
interface ReportOutputsPayload {
  scalars?: {metric: string; variant: string}[];
  scalar_graphs?: {metric: string}[];
  plots?: {metric: string; variant: string}[];
  debug_images?: {metric: string; variant: string}[];
  artifacts?: {key: string}[];
}

/** Map the names-only endpoint payload into the TaskExpectedOutput contract. */
const reportOutputsToExpected = (outputs?: ReportOutputsPayload): TaskExpectedOutput[] => {
  if (!outputs) return [];
  const result: TaskExpectedOutput[] = [];
  for (const item of outputs.scalars ?? []) result.push({kind: 'scalar', metric: item.metric, variant: item.variant});
  for (const item of outputs.scalar_graphs ?? []) result.push({kind: 'scalar_graph', metric: item.metric});
  for (const item of outputs.plots ?? []) result.push({kind: 'plot', metric: item.metric, variant: item.variant});
  for (const item of outputs.debug_images ?? []) result.push({kind: 'debug_image', metric: item.metric, variant: item.variant});
  for (const item of outputs.artifacts ?? []) result.push({kind: 'artifact', artifactKey: item.key});
  return result;
};

/** A single mappable item discovered on a Report node's source task: a task
 *  field, a hyperparameter, a scalar metric, an artifact, or a plot. Used to
 *  fill a report template's placeholders / embed slots. */
export interface FlowReportSource {
  taskId: string;
  taskName: string;
  kind: 'field' | 'hyperparam' | 'scalar' | 'artifact' | 'plot';
  ref: string;
  label: string;
  value?: string;
  metric?: string;
  variant?: string;
}

/** Shape of a source task as fetched for report mapping (internal). */
interface ReportSourceTask {
  id: string;
  name?: string;
  status?: string;
  project?: {id: string; name: string} | string;
  started?: string;
  completed?: string;
  last_iteration?: number;
  last_metrics?: Record<string, Record<string, {metric?: string; variant?: string; value?: number; max_value?: number; min_value?: number}>>;
  hyperparams?: Record<string, Record<string, {name?: string; value?: string}>>;
  execution?: {artifacts?: {key: string; type?: string; uri?: string}[]};
}

export interface FlowDatasetVersion {
  id: string;
  version: string;
  created?: string;
}

export interface FlowDatasetInfo {
  id: string;
  name: string;
  version?: string;
  sourcePath?: string;
  sourceType?: string;
  alias?: string;
}

export interface FlowExecutionResult {
  execution_id?: string;
  status?: string;
  refreshing?: boolean;
  result_data?: unknown;
  console_log?: string;
  [key: string]: unknown;
}

/**
 * Real ClearML backend access for the flow editor nodes. Wraps the low-level
 * apiserver endpoints (projects/queues/tasks/reports/autoscaler) that back the
 * AutoScaler, Dataset, Train, Execute and Report node config panels.
 */
@Injectable()
export class ClearpipeFlowResourcesService {
  private readonly requests = inject(SmApiRequestsService);

  private url(action: string): string {
    return `${HTTP.API_BASE_URL}/${action}`;
  }

  // --- projects / queues ---------------------------------------------------
  listProjects(search = ''): Observable<FlowResourceOption[]> {
    return this.requests
      .post<{projects?: {id: string; name: string}[]}>(this.url('projects.get_all_ex'), {
        page: 0,
        page_size: 500,
        only_fields: ['id', 'name'],
        order_by: ['name'],
        ...(search ? {_any_: {pattern: search, fields: ['name']}} : {}),
      })
      .pipe(
        map((response) => (response?.projects ?? []).map((project) => ({id: project.id, name: project.name}))),
        catchError(() => of([])),
      );
  }

  listQueues(): Observable<FlowResourceOption[]> {
    return this.requests
      .post<{queues?: {id: string; name: string}[]}>(this.url('queues.get_all_ex'), {
        page: 0,
        page_size: 500,
        only_fields: ['id', 'name'],
        order_by: ['name'],
      })
      .pipe(
        map((response) => (response?.queues ?? []).map((queue) => ({id: queue.id, name: queue.name}))),
        catchError(() => of([])),
      );
  }

  // --- datasets ------------------------------------------------------------
  /**
   * Lists real ClearML datasets. Datasets are NOT flat tasks under a project -
   * each dataset is its own hidden nested project at
   * `<dataset-project>/.datasets/<dataset-name>` (with `system_tags: ['dataset']`
   * on the project itself, see `Dataset._build_hidden_project_name` /
   * `_set_project_system_tags` in the Python SDK). So listing datasets means
   * querying `projects.get_all_ex` with `children_type: 'dataset'`, not
   * `tasks.get_all_ex`. Each result's `id`/`name` is the hidden dataset-project's
   * id/basename (the real dataset-name); `project` is the plain outer
   * dataset-project the user picked (derived by stripping the `/.datasets/...`
   * suffix from the hidden project's full path).
   */
  listDatasets(project = '', search = ''): Observable<FlowResourceOption[]> {
    return this.requests
      .post<{projects?: {id: string; name: string; basename?: string}[]}>(this.url('projects.get_all_ex'), {
        page: 0,
        page_size: 500,
        // Query the actual dataset projects directly (the flat "datasets page" query),
        // NOT `children_type: 'dataset'` - that returns the *parent folder* projects
        // (e.g. `.datasets`, `datasets`) that merely contain datasets, rather than the
        // datasets themselves. Real datasets are hidden projects tagged `dataset` that
        // live under `<project>/.datasets/<name>`, matched here by name + system_tags.
        search_hidden: true,
        shallow_search: false,
        name: '/\\.datasets/',
        system_tags: ['dataset'],
        only_fields: ['id', 'name', 'basename'],
        order_by: ['basename'],
        ...(project ? {parent: [project]} : {}),
        ...(search ? {_any_: {pattern: search, fields: ['basename']}} : {}),
      })
      .pipe(
        map((response) =>
          (response?.projects ?? []).map((proj) => ({
            id: proj.id,
            name: proj.basename || proj.name,
            project: this.datasetParentProject(proj.name),
          })),
        ),
        catchError(() => of([])),
      );
  }

  /** All versions (tasks) living inside a dataset's hidden project, newest first, with their ClearML version tag. */
  listDatasetVersions(datasetProjectId: string): Observable<FlowDatasetVersion[]> {
    if (!datasetProjectId) return of([]);
    return this.requests
      .post<{tasks?: {id: string; created?: string; runtime?: {version?: string}}[]}>(this.url('tasks.get_all_ex'), {
        page: 0,
        page_size: 200,
        project: [datasetProjectId],
        type: ['data_processing'],
        system_tags: ['dataset'],
        search_hidden: true,
        only_fields: ['id', 'created', 'runtime.version'],
        order_by: ['-created'],
      })
      .pipe(
        map((response) =>
          (response?.tasks ?? []).map((task) => ({
            id: task.id,
            version: task.runtime?.version ?? '',
            created: task.created,
          })),
        ),
        catchError(() => of([])),
      );
  }

  /** Fetches lineage details (latest version's task id, version tag, source path/type, alias) for a dataset, given its hidden dataset-project id. */
  getDatasetInfo(datasetProjectId: string): Observable<FlowDatasetInfo | null> {
    if (!datasetProjectId) return of(null);
    return this.requests
      .post<{
        tasks?: {
          id: string;
          name: string;
          runtime?: {version?: string};
          hyperparams?: Record<string, Record<string, {name?: string; value?: string}>>;
        }[];
      }>(this.url('tasks.get_all_ex'), {
        project: [datasetProjectId],
        type: ['data_processing'],
        system_tags: ['dataset'],
        search_hidden: true,
        page: 0,
        page_size: 1,
        order_by: ['-created'],
        only_fields: ['id', 'name', 'runtime.version', 'hyperparams'],
      })
      .pipe(
        map((response) => {
          const task = response?.tasks?.[0];
          if (!task) return null;
          const properties = task.hyperparams?.['Properties'] ?? {};
          return {
            id: task.id,
            name: task.name,
            version: task.runtime?.version,
            sourcePath: properties['source_path']?.value,
            sourceType: properties['source_type']?.value,
            alias: properties['alias']?.value,
          };
        }),
        catchError(() => of(null)),
      );
  }

  /** Strips the `/.datasets/<name>` hidden-project suffix to recover the plain dataset-project name. */
  private datasetParentProject(fullName: string): string {
    const marker = '/.datasets/';
    const idx = fullName.indexOf(marker);
    return idx >= 0 ? fullName.slice(0, idx) : '';
  }

  /**
   * Creates a new dataset version task (used by both the Dataset node's Create and
   * Sync modes). When `parentId` is set the new task is linked to it as its ClearML
   * dataset lineage parent; when `queue` is set the task is enqueued so the
   * clearml-agent listening on that queue performs the actual upload/versioning.
   */
  createDatasetVersion(params: {
    name: string;
    project: string;
    parentId?: string;
    version?: string;
    alias?: string;
    sourcePath?: string;
    sourceType?: string;
    queue?: string;
  }): Observable<string | null> {
    const properties: Record<string, {name: string; value: string}> = {};
    if (params.version) properties['version'] = {name: 'version', value: params.version};
    if (params.alias) properties['alias'] = {name: 'alias', value: params.alias};
    if (params.sourcePath) properties['source_path'] = {name: 'source_path', value: params.sourcePath};
    if (params.sourceType) properties['source_type'] = {name: 'source_type', value: params.sourceType};
    return this.requests
      .post<{id?: string}>(this.url('tasks.create'), {
        name: params.name,
        project: params.project || undefined,
        type: 'data_processing',
        system_tags: ['dataset'],
        parent: params.parentId || undefined,
        comment: 'Created from ClearPipe',
        ...(Object.keys(properties).length ? {hyperparams: {Properties: properties}} : {}),
      })
      .pipe(
        switchMap((response) => {
          const id = response?.id ?? null;
          if (id && params.queue) {
            return this.enqueueTask(id, params.queue).pipe(map(() => id));
          }
          return of(id);
        }),
        catchError(() => of(null)),
      );
  }

  enqueueTask(taskId: string, queue: string): Observable<boolean> {
    return this.requests
      .post<unknown>(this.url('tasks.enqueue'), {task: taskId, queue})
      .pipe(map(() => true), catchError(() => of(false)));
  }

  // --- training tasks ------------------------------------------------------
  listTrainingTasks(project = '', search = ''): Observable<FlowResourceOption[]> {
    return this.requests
      .post<{tasks?: {id: string; name: string; status?: string; project?: {id: string; name: string} | string}[]}>(
        this.url('tasks.get_all_ex'),
        {
          page: 0,
          page_size: 500,
          type: ['training'],
          only_fields: ['id', 'name', 'status', 'project'],
          order_by: ['-last_update'],
          ...(project ? {project: [project]} : {}),
          ...(search ? {_any_: {pattern: search, fields: ['name']}} : {}),
        },
      )
      .pipe(map((response) => this.mapTasks(response?.tasks)), catchError(() => of([])));
  }

  // --- reports -------------------------------------------------------------
  listReports(search = ''): Observable<FlowResourceOption[]> {
    return this.requests
      .post<{tasks?: {id: string; name: string; project?: {id: string; name: string} | string}[]}>(
        this.url('reports.get_all_ex'),
        {
          page: 0,
          page_size: 500,
          only_fields: ['id', 'name', 'project'],
          order_by: ['-last_update'],
          ...(search ? {_any_: {pattern: search, fields: ['name']}} : {}),
        },
      )
      .pipe(map((response) => this.mapTasks(response?.tasks)), catchError(() => of([])));
  }

  /** The raw Markdown body of a report (used as a fill template). */
  getReportMarkdown(reportId: string): Observable<string> {
    if (!reportId) return of('');
    return this.requests
      .post<{tasks?: {report?: string}[]}>(
        this.url('reports.get_all_ex'),
        {id: [reportId], only_fields: ['report'], page: 0, page_size: 1},
      )
      .pipe(map((response) => response?.tasks?.[0]?.report ?? ''), catchError(() => of('')));
  }

  /** Fetch names-only expected-output descriptors for a Task node's base task
   *  via the authorized `clearpipe.task_report_outputs` endpoint, mapped into
   *  the design-time TaskExpectedOutput contract. */
  getTaskReportOutputs(baseTaskId: string): Observable<TaskExpectedOutput[]> {
    if (!baseTaskId) return of([]);
    return this.requests
      .post<{status?: string; outputs?: ReportOutputsPayload}>(
        this.url('clearpipe.task_report_outputs'),
        {task: baseTaskId},
      )
      .pipe(
        map((response) => reportOutputsToExpected(response?.outputs)),
        catchError(() => of([])),
      );
  }

  /** Discover every mappable item (fields, hyperparameters, scalars, artifacts,
   *  plots) across the given source tasks, for filling a report template. */
  getReportSources(taskIds: string[]): Observable<FlowReportSource[]> {
    if (!taskIds.length) return of([]);
    const details$ = this.requests
      .post<{tasks?: ReportSourceTask[]}>(this.url('tasks.get_all_ex'), {
        id: taskIds,
        page: 0,
        page_size: 100,
        only_fields: [
          'id', 'name', 'status', 'project.name', 'started', 'completed',
          'last_iteration', 'last_metrics', 'hyperparams', 'execution.artifacts',
        ],
      })
      .pipe(catchError(() => of({tasks: []})));
    // events.get_task_plots takes a SINGLE `task` and returns a flat array of
    // plot events; fetch per task and key the results by task id.
    const plots$ = forkJoin(
      taskIds.map((taskId) =>
        this.requests
          .post<{plots?: {metric?: string; variant?: string}[]}>(
            this.url('events.get_task_plots'),
            {task: taskId, iters: 1},
          )
          .pipe(
            map((response) => ({taskId, plots: response?.plots ?? []})),
            catchError(() => of({taskId, plots: [] as {metric?: string; variant?: string}[]})),
          ),
      ),
    );
    return forkJoin({details: details$, plots: plots$}).pipe(
      map(({details, plots}) => {
        const plotsByTask: Record<string, {metric?: string; variant?: string}[]> = {};
        for (const entry of plots) plotsByTask[entry.taskId] = entry.plots;
        return this.buildReportSources(details?.tasks ?? [], plotsByTask);
      }),
      catchError(() => of([])),
    );
  }

  private buildReportSources(
    tasks: ReportSourceTask[],
    plotsByTask: Record<string, {metric?: string; variant?: string}[]>,
  ): FlowReportSource[] {
    const items: FlowReportSource[] = [];
    for (const task of tasks) {
      const taskId = task.id;
      const taskName = task.name ?? taskId;
      const push = (kind: FlowReportSource['kind'], ref: string, label: string, extra: Partial<FlowReportSource> = {}) =>
        items.push({taskId, taskName, kind, ref, label, ...extra});
      // Task fields
      push('field', 'name', 'Task name', {value: task.name});
      push('field', 'id', 'Task ID', {value: task.id});
      push('field', 'status', 'Status', {value: task.status});
      const projectName = typeof task.project === 'object' ? task.project?.name : task.project;
      push('field', 'project', 'Project', {value: projectName});
      if (task.started) push('field', 'started', 'Started', {value: task.started});
      if (task.completed) push('field', 'completed', 'Completed', {value: task.completed});
      if (task.last_iteration != null) push('field', 'iteration', 'Iterations', {value: String(task.last_iteration)});
      // Hyperparameters
      for (const [section, params] of Object.entries(task.hyperparams ?? {})) {
        for (const [name, entry] of Object.entries(params ?? {})) {
          push('hyperparam', `${section}/${name}`, `${section}/${name}`, {value: entry?.value});
        }
      }
      // Scalars. Each `last_metrics` group is one metric (as shown as a single
      // graph in the task's SCALARS tab). Offer the whole-metric graph (all
      // variants) AND each individual variant's last value.
      for (const metricEntry of Object.values(task.last_metrics ?? {})) {
        const variants = Object.values(metricEntry ?? {});
        const metricName = variants.find((v) => v?.metric)?.metric;
        if (metricName) {
          push('scalar', `scalar\u0000${metricName}\u0000`, `${metricName} (scalar graph)`, {
            metric: metricName, variant: '',
          });
        }
        for (const variantEntry of variants) {
          const metric = variantEntry?.metric;
          const variant = variantEntry?.variant;
          if (!metric) continue;
          const value = variantEntry?.value ?? variantEntry?.max_value ?? variantEntry?.min_value;
          push('scalar', `scalar\u0000${metric}\u0000${variant ?? ''}`, `${metric} / ${variant ?? ''}`.trim(), {
            metric, variant, value: value != null ? String(value) : undefined,
          });
        }
      }
      // Artifacts
      for (const artifact of task.execution?.artifacts ?? []) {
        if (artifact?.key) push('artifact', `artifact\u0000${artifact.key}`, artifact.key);
      }
      // Plots: events.get_task_plots returns a flat array of plot events;
      // dedupe by metric+variant so each curve/plot appears once.
      const seenPlots = new Set<string>();
      for (const plot of plotsByTask[taskId] ?? []) {
        const metric = plot?.metric;
        const variant = plot?.variant ?? '';
        if (!metric) continue;
        const dedupe = `${metric}\u0000${variant}`;
        if (seenPlots.has(dedupe)) continue;
        seenPlots.add(dedupe);
        push('plot', `plot\u0000${metric}\u0000${variant}`, `${metric} / ${variant}`.trim(), {metric, variant});
      }
    }
    return items;
  }

  // --- task artifacts ------------------------------------------------------
  listTaskArtifacts(taskIds: string[]): Observable<FlowArtifact[]> {
    if (!taskIds.length) return of([]);
    return this.requests
      .post<{tasks?: {id: string; name?: string; execution?: {artifacts?: {key: string; type?: string; uri?: string}[]}}[]}>(
        this.url('tasks.get_all_ex'),
        {
          id: taskIds,
          only_fields: ['id', 'name', 'execution.artifacts'],
          page: 0,
          page_size: 100,
        },
      )
      .pipe(
        map((response) =>
          (response?.tasks ?? []).flatMap((task) =>
            (task.execution?.artifacts ?? []).map((artifact) => ({
              key: artifact.key,
              taskId: task.id,
              taskName: task.name,
              type: artifact.type,
              uri: artifact.uri,
            })),
          ),
        ),
        catchError(() => of([])),
      );
  }

  // --- autoscalers ---------------------------------------------------------
  /**
   * Fetches the configured Run:ai / OpenShift autoscaler. get_dashboard refreshes
   * asynchronously (returns an execution_id + refreshing:true), so we poll
   * get_execution for the real result, then merge queues / live + saved instances.
   * get_settings is consulted so a configured-but-not-connected autoscaler is
   * still surfaced with a helpful status message.
   */
  listAutoscalers(): Observable<FlowAutoscalerResult> {
    const settings$ = this.requests
      .post<{settings?: Record<string, unknown>}>(this.url('autoscaler.get_settings'), {})
      .pipe(catchError(() => of({settings: undefined})));
    const dashboard$ = this.requests
      .post<FlowExecutionResult>(this.url('autoscaler.get_dashboard'), {})
      .pipe(
        switchMap((dashboard) => this.resolveAsync(dashboard)),
        catchError(() => of(null)),
      );
    return forkJoin({settings: settings$, dashboard: dashboard$}).pipe(
      map(({settings, dashboard}) => this.buildAutoscalerResult(dashboard, settings?.settings)),
      catchError(() => of({items: [], connected: false, configured: false})),
    );
  }

  /** Poll get_execution until an async autoscaler refresh completes. */
  private resolveAsync(response: FlowExecutionResult | null): Observable<FlowExecutionResult | null> {
    const executionId = response?.execution_id as string | undefined;
    if (!executionId || !response?.refreshing) return of(response);
    const active = new Set(['queued', 'pending', 'running']);
    return timer(0, 1500).pipe(
      switchMap(() => this.getExecution(executionId)),
      takeWhile((res) => active.has(String(res?.status)), true),
      filter((res) => !active.has(String(res?.status))),
      take(1),
      map((res) => (res?.result_data as FlowExecutionResult) ?? response),
      timeout(20000),
      catchError(() => of(response)),
    );
  }

  /**
   * Fetches a Run:ai project's assets (compute, environments, data sources,
   * node pools, projects) - the same data the autoscaler Submit Workload dialog
   * uses. get_project_resources refreshes asynchronously, so we poll for it.
   */
  getProjectResources(project: string): Observable<AutoscalerProjectResources | null> {
    return this.requests
      .post<FlowExecutionResult>(this.url('autoscaler.get_project_resources'), {project})
      .pipe(
        switchMap((response) => this.resolveAsync(response)),
        map((response) => (response as AutoscalerProjectResources) ?? null),
        catchError(() => of(null)),
      );
  }

  /** Describe one selected template and resolve its complete workload defaults. */
  getTemplate(name: string, project: string): Observable<AutoscalerTemplateResult | null> {
    return this.requests
      .post<FlowExecutionResult>(this.url('autoscaler.get_template'), {name, project})
      .pipe(
        switchMap((response) => this.resolveAsync(response)),
        map((response) => (response as unknown as AutoscalerTemplateResult) ?? null),
        catchError(() => of(null)),
      );
  }

  runCommand(project: string, command: string): Observable<FlowExecutionResult | null> {
    return this.requests
      .post<FlowExecutionResult>(this.url('autoscaler.run_command_playground'), {project, command})
      .pipe(catchError(() => of(null)));
  }

  getExecution(executionId: string): Observable<FlowExecutionResult | null> {
    return this.requests
      .post<FlowExecutionResult>(this.url('autoscaler.get_execution'), {execution_id: executionId})
      .pipe(catchError(() => of(null)));
  }

  // --- helpers -------------------------------------------------------------
  private mapTasks(
    tasks?: {id: string; name: string; status?: string; project?: {id: string; name: string} | string}[],
  ): FlowResourceOption[] {
    return (tasks ?? []).map((task) => ({
      id: task.id,
      name: task.name,
      status: task.status,
      project: typeof task.project === 'object' ? task.project?.name : task.project,
    }));
  }

  private mapAutoscalers(dashboard: FlowExecutionResult | null): FlowAutoscaler[] {
    const queues = (dashboard?.['queues'] as {name?: string; status?: string}[] | undefined) ?? [];
    const instances = (dashboard?.['instances'] as {name?: string; project?: string; status?: string}[] | undefined) ?? [];
    const saved = (dashboard?.['saved_instances'] as {name?: string; project?: string; status?: string}[] | undefined) ?? [];
    const rows: FlowAutoscaler[] = [
      ...queues.map((queue) => ({name: queue.name ?? '', project: queue.name, status: queue.status})),
      ...instances.map((instance) => ({name: instance.project ?? instance.name ?? '', project: instance.project, status: instance.status})),
      ...saved.map((instance) => ({name: instance.project ?? instance.name ?? '', project: instance.project, status: instance.status})),
    ];
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (!row.name || seen.has(row.name)) return false;
      seen.add(row.name);
      return true;
    });
  }

  private buildAutoscalerResult(
    dashboard: FlowExecutionResult | null,
    settings?: Record<string, unknown>,
  ): FlowAutoscalerResult {
    const connected = Boolean(dashboard?.['connected']);
    const items = this.mapAutoscalers(dashboard).map((item) => ({...item, connected}));
    const configured = this.isAutoscalerConfigured(settings);

    // Always surface the configured autoscaler as a selectable entry, even when
    // the Run:ai / OpenShift connection is down - the node stays usable and the
    // UI simply reports Connected / Not connected.
    if (configured && !items.length) {
      const name = this.deriveAutoscalerName(settings);
      const project = String(settings?.['runai_project'] || settings?.['runai_cluster'] || '').trim();
      items.push({name, project: project || undefined, connected, status: connected ? 'connected' : 'not-connected'});
    }

    let message: string | undefined;
    if (!configured) {
      message = 'No autoscaler is configured. Configure one in Workers & Queues → Autoscaler.';
    } else if (!connected) {
      const detail = String(dashboard?.['error'] || '').trim();
      message = detail || 'The Run:ai / OpenShift connection is currently down. Check the autoscaler Settings.';
    }
    return {items, connected, configured, message};
  }

  private deriveAutoscalerName(settings?: Record<string, unknown>): string {
    if (!settings) return 'Run:ai autoscaler';
    // Prefer an explicitly configured Run:ai project / cluster name; otherwise
    // just show the product name. The connection transport (OpenShift oc login or
    // direct Run:ai) is an implementation detail and is not surfaced here.
    const project = String(settings['runai_project'] || '').trim();
    if (project) return project;
    const cluster = String(settings['runai_cluster'] || '').trim();
    if (cluster) return cluster;
    return 'Run:ai autoscaler';
  }

  private isAutoscalerConfigured(settings?: Record<string, unknown>): boolean {
    if (!settings) return false;
    const keys = [
      'openshift_api_url',
      'openshift_login_command',
      'openshift_token',
      'runai_cp_url',
      'runai_access_key',
      'runai_cluster',
      'runai_project',
    ];
    return keys.some((key) => String(settings[key] ?? '').trim().length > 0);
  }
}
