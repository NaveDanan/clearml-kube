/* API responses deliberately accept multiple compatible server DTO wrappers. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {inject, Injectable} from '@angular/core';
import {Observable} from 'rxjs';
import {HTTP} from '~/app.constants';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {
  ClearpipeDefinition,
  ClearpipeResourceOption,
  ClearpipeValidationResult,
  normalizeDefinition
} from './clearpipe.models';
import {map} from 'rxjs/operators';
import {GraphV2} from './domain/graph-v2.types';

export type ClearpipeRepresentation =
  | 'clearpipe_graph_v2'
  | 'legacy_clearpipe_graph'
  | 'unsupported_clearpipe_graph';

export interface ClearpipeCapabilities {
  view: boolean;
  edit: boolean;
  save_as: boolean;
  version: boolean;
  run: boolean;
  compilation: boolean;
  execution: boolean;
  import: boolean;
  export: boolean;
  source: boolean;
  archive: boolean;
  delete: boolean;
}

export interface ClearpipeDefinitionResponse {
  definition: ClearpipeDefinition;
  graph: unknown;
  representation?: ClearpipeRepresentation;
  capabilities?: Partial<ClearpipeCapabilities>;
}

export interface ClearpipeListRequest {
  page?: number;
  page_size?: number;
  search?: string;
  project?: string[];
  tags?: string[];
  include_archived?: boolean;
  allow_public?: boolean;
}

export interface ClearpipeListResponse {
  definitions: ClearpipeDefinitionResponse[];
  total: number;
}

export interface ClearpipeCreateRequest {
  name: string;
  graph: GraphV2;
  description?: string;
  tags?: string[];
  public?: boolean;
}

export interface ClearpipeUpdateRequest extends ClearpipeCreateRequest {
  task: string;
  revision: number;
}

export type ClearpipeValidateRequest = {task: string} | {graph: GraphV2};

export interface ClearpipeValidationResponse {
  valid: boolean;
  issues: ClearpipeValidationResult['errors'];
  pipeline?: unknown;
}

export interface ClearpipeStartRequest {
  task: string;
  revision?: number;
  queue?: string;
  parameters?: Record<string, unknown>;
  node_queues?: Record<string, string>;
  verify_watched_queue?: boolean;
}

export interface ClearpipeStartResponse {
  run_task_id: string;
  enqueued: boolean;
  queue_watched?: boolean;
}

export interface ClearpipeArchiveResponse {
  updated: number;
  revision: number;
}

export interface ClearpipeParseScriptResponse {
  valid: boolean;
  parameters: unknown[];
  environment: string[];
  imports: string[];
  line_count: number;
}

export type ClearpipeTaskDescriptorStatus = 'available' | 'stale' | 'unavailable';
export type ClearpipeExecutionSnapshotStatus = ClearpipeTaskDescriptorStatus;
export type ClearpipeArtifactDirection = 'input' | 'output';
export type ClearpipeRuntimeRecordStatus = 'available' | 'unavailable';

export interface ClearpipeTaskParameterDescriptor {
  section: string;
  name: string;
  type?: string;
}

export interface ClearpipeTaskArtifactDescriptor {
  id: string;
  name: string;
  type?: string;
  direction?: ClearpipeArtifactDirection;
}

export interface ClearpipeTaskDescriptor {
  identity: {task_id: string};
  context: {
    name: string;
    type: string;
    status: string;
    project_id?: string;
    project_name?: string;
    updated_at?: string;
  };
  parameters: ClearpipeTaskParameterDescriptor[];
  artifacts: ClearpipeTaskArtifactDescriptor[];
}

export interface ClearpipeTaskDescriptorResponse {
  status: ClearpipeTaskDescriptorStatus;
  descriptor?: ClearpipeTaskDescriptor;
}

export interface ClearpipeExecutionNodeSnapshot {
  graph_node_id: string;
  pipeline_step_name: string;
  record_status: ClearpipeRuntimeRecordStatus;
  task_id?: string;
  status?: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
  result?: 'success' | 'failure';
  log_task_id?: string;
  artifacts?: ClearpipeTaskArtifactDescriptor[];
  artifacts_truncated?: boolean;
  models?: {
    input?: {id: string; name?: string}[];
    output?: {id: string; name?: string}[];
  };
  datasets?: {task_id: string; name: string}[];
}

export interface ClearpipeExecutionSnapshot {
  run_task_id: string;
  definition_task_id: string;
  definition_revision: number;
  graph_digest: string;
  node_offset: number;
  total_nodes: number;
  truncated: boolean;
  next_node_offset?: number;
  controller: {
    task_id: string;
    status: string;
    started_at?: string;
    completed_at?: string;
    updated_at?: string;
  };
  nodes: ClearpipeExecutionNodeSnapshot[];
}

export interface ClearpipeExecutionSnapshotRequest {
  run: string;
  definition_revision?: number;
  graph_digest?: string;
  node_offset?: number;
  node_limit?: number;
}

export interface ClearpipeExecutionSnapshotResponse {
  status: ClearpipeExecutionSnapshotStatus;
  snapshot?: ClearpipeExecutionSnapshot;
}

@Injectable({providedIn: 'root'})
export class ClearpipeApiService {
  private requests = inject(SmApiRequestsService);

  private endpoint(action: string): string {
    return `${HTTP.API_BASE_URL_NO_VERSION}/v2.35/clearpipe.${action}`;
  }

  getAll(search = '', archived = false): Observable<ClearpipeDefinition[]> {
    return this.listDefinitions({search, include_archived: archived, page: 0, page_size: 500})
      .pipe(map(response => response.definitions.map(item => item.definition)));
  }

  getById(taskId: string): Observable<ClearpipeDefinition> {
    return this.loadDefinition(taskId).pipe(map(response => response.definition));
  }

  create(definition: ClearpipeDefinition): Observable<ClearpipeDefinition> {
    return this.requests.post<any>(this.endpoint('create'), this.definitionPayload(definition))
      .pipe(map(normalizeDefinition));
  }

  update(definition: ClearpipeDefinition): Observable<ClearpipeDefinition> {
    return this.requests.post<any>(this.endpoint('update'), {
      ...this.definitionPayload(definition),
      task: definition.task_id ?? definition.id,
      revision: definition.revision,
    }).pipe(map(normalizeDefinition));
  }

  validate(definition: ClearpipeDefinition): Observable<ClearpipeValidationResult> {
    return this.requests.post<any>(this.endpoint('validate'), {graph: this.graphPayload(definition)})
      .pipe(map(response => {
        const issues = response?.issues ?? [];
        return {
          valid: response?.valid ?? !issues.some(issue => issue.severity !== 'warning'),
          errors: issues.filter(issue => issue.severity !== 'warning').map(this.normalizeIssue),
          warnings: issues.filter(issue => issue.severity === 'warning').map(this.normalizeIssue),
        };
      }));
  }

  start(taskId: string, queueId?: string, parameterOverrides: Record<string, unknown> = {}, revision?: number): Observable<{run_task_id: string}> {
    return this.requests.post<any>(this.endpoint('start'), {
      task: taskId,
      revision,
      queue: queueId || undefined,
      parameters: parameterOverrides,
      verify_watched_queue: true,
    }).pipe(map(response => ({run_task_id: response?.task})));
  }

  archive(taskId: string, archived = true, revision?: number): Observable<void> {
    if (!archived) {
      return this.requests.post<void>(`${HTTP.API_BASE_URL}/tasks.unarchive`, {task: taskId});
    }
    return this.requests.post<void>(this.endpoint('archive'), {task: taskId, revision});
  }

  delete(taskId: string, revision?: number): Observable<void> {
    return this.requests.post<void>(this.endpoint('delete'), {task: taskId, revision});
  }

  parseScript(script: string, filename?: string): Observable<{parameters: unknown[]}> {
    return this.parseScriptDefinition(script, filename).pipe(map(response => ({parameters: response.parameters})));
  }

  /**
   * Typed CP-07 transport methods. The platform adapter is the only production
   * consumer of these methods; the compatibility methods above remain for the
   * pre-existing shell while its replacement is delivered independently.
   */
  listDefinitions(request: ClearpipeListRequest = {}): Observable<ClearpipeListResponse> {
    const page = Math.max(0, request.page ?? 0);
    const pageSize = Math.min(500, Math.max(1, request.page_size ?? 50));
    return this.requests.post<any>(this.endpoint('get_all'), {
      page,
      page_size: pageSize,
      search: request.search,
      project: request.project,
      tags: request.tags,
      include_archived: request.include_archived ?? false,
      allow_public: request.allow_public ?? true,
    }).pipe(map(response => ({
      definitions: (Array.isArray(response?.definitions) ? response.definitions : [])
        .map(item => this.definitionResponse(item)),
      total: Number(response?.total ?? 0),
    })));
  }

  loadDefinition(task: string): Observable<ClearpipeDefinitionResponse> {
    return this.requests.post<any>(this.endpoint('get_by_id'), {task})
      .pipe(map(response => this.definitionResponse(response?.definition ?? response)));
  }

  createDefinition(request: ClearpipeCreateRequest): Observable<ClearpipeDefinitionResponse> {
    return this.requests.post<any>(this.endpoint('create'), {
      name: request.name,
      description: request.description,
      tags: request.tags,
      public: request.public,
      graph: request.graph,
    }).pipe(map(response => this.definitionResponse(response)));
  }

  updateDefinition(request: ClearpipeUpdateRequest): Observable<ClearpipeDefinitionResponse> {
    return this.requests.post<any>(this.endpoint('update'), {
      task: request.task,
      revision: request.revision,
      name: request.name,
      description: request.description,
      tags: request.tags,
      public: request.public,
      graph: request.graph,
    }).pipe(map(response => this.definitionResponse(response)));
  }

  validateDefinition(request: ClearpipeValidateRequest): Observable<ClearpipeValidationResponse> {
    return this.requests.post<any>(this.endpoint('validate'), request).pipe(map(response => ({
      valid: Boolean(response?.valid),
      issues: Array.isArray(response?.issues) ? response.issues.map(this.normalizeIssue) : [],
      pipeline: response?.pipeline,
    })));
  }

  startDefinition(request: ClearpipeStartRequest): Observable<ClearpipeStartResponse> {
    return this.requests.post<any>(this.endpoint('start'), {
      task: request.task,
      revision: request.revision,
      queue: request.queue,
      parameters: request.parameters ?? {},
      node_queues: request.node_queues,
      verify_watched_queue: request.verify_watched_queue ?? true,
    }).pipe(map(response => ({
      run_task_id: response?.task,
      enqueued: Boolean(response?.enqueued),
      queue_watched: response?.queue_watched,
    })));
  }

  archiveDefinition(task: string, revision?: number): Observable<ClearpipeArchiveResponse> {
    return this.requests.post<any>(this.endpoint('archive'), {task, revision})
      .pipe(map(response => ({updated: Number(response?.updated ?? 0), revision: Number(response?.revision ?? revision ?? 0)})));
  }

  deleteDefinition(task: string, revision?: number, force = false): Observable<{deleted: boolean}> {
    return this.requests.post<any>(this.endpoint('delete'), {task, revision, force})
      .pipe(map(response => ({deleted: Boolean(response?.deleted)})));
  }

  parseScriptDefinition(script: string, filename?: string): Observable<ClearpipeParseScriptResponse> {
    return this.requests.post<any>(this.endpoint('parse_script'), {script, filename}).pipe(map(response => ({
      valid: Boolean(response?.valid),
      parameters: Array.isArray(response?.parameters) ? response.parameters : [],
      environment: Array.isArray(response?.environment) ? response.environment : [],
      imports: Array.isArray(response?.imports) ? response.imports : [],
      line_count: Number(response?.line_count ?? 0),
    })));
  }

  taskDescriptor(task: string, knownUpdatedAt?: string): Observable<ClearpipeTaskDescriptorResponse> {
    return this.requests.post<any>(this.endpoint('task_descriptor'), {
      task,
      known_updated_at: knownUpdatedAt,
    }).pipe(map(response => this.taskDescriptorResponse(response)));
  }

  executionSnapshot(request: ClearpipeExecutionSnapshotRequest): Observable<ClearpipeExecutionSnapshotResponse> {
    return this.requests.post<any>(this.endpoint('execution_snapshot'), {
      run: request.run,
      definition_revision: request.definition_revision,
      graph_digest: request.graph_digest,
      node_offset: request.node_offset,
      node_limit: request.node_limit,
    }).pipe(map(response => this.executionSnapshotResponse(response)));
  }

  getResources(type: ClearpipeResourceOption['type']): Observable<ClearpipeResourceOption[]> {
    const requests: Record<ClearpipeResourceOption['type'], {endpoint: string; body: Record<string, unknown>; key: string}> = {
      project: {endpoint: 'projects.get_all', body: {page: 0, page_size: 500, only_fields: ['id', 'name']}, key: 'projects'},
      task: {
        endpoint: 'tasks.get_all',
        body: {
          page: 0,
          page_size: 500,
          only_fields: ['id', 'name', 'project', 'type', 'status', 'tags', 'system_tags', 'last_update'],
        },
        key: 'tasks',
      },
      dataset: {endpoint: 'tasks.get_all', body: {page: 0, page_size: 500, type: ['data_processing'], system_tags: ['dataset'], only_fields: ['id', 'name', 'project']}, key: 'tasks'},
      model: {endpoint: 'models.get_all', body: {page: 0, page_size: 500, only_fields: ['id', 'name', 'project']}, key: 'models'},
      queue: {endpoint: 'queues.get_all', body: {only_fields: ['id', 'name']}, key: 'queues'},
      report: {endpoint: 'projects.get_all', body: {page: 0, page_size: 500, system_tags: ['report'], only_fields: ['id', 'name']}, key: 'projects'},
      endpoint: {endpoint: 'serving.get_endpoints', body: {}, key: 'endpoints'},
      storage: {endpoint: 'storage.get_all', body: {}, key: 'storage'},
    };
    const request = requests[type];
    return this.requests.post<any>(`${HTTP.API_BASE_URL}/${request.endpoint}`, request.body).pipe(
      map(response => (response?.[request.key] ?? response ?? []).map((item: any) => ({
        id: item.id ?? item.name ?? item.url,
        name: item.name ?? item.id ?? item.url,
        project: item.project?.name ?? item.project,
        type,
        ...(type === 'task' ? this.taskMetadata(item) : {}),
      })))
    );
  }

  private taskMetadata(task: Record<string, unknown>): Pick<ClearpipeResourceOption,
    'taskType' | 'taskStatus' | 'taskUserTags' | 'taskSystemTags' | 'taskLastUpdatedAt'> {
    const text = (value: unknown): string | undefined =>
      typeof value === 'string' && value.trim() ? value : undefined;
    const tags = (value: unknown): string[] | undefined => {
      if (!Array.isArray(value)) return undefined;
      const safeTags = value.flatMap(tag => {
        const normalized = text(tag);
        return normalized ? [normalized] : [];
      });
      return safeTags.length ? safeTags : undefined;
    };

    const taskType = text(task.type);
    const taskStatus = text(task.status);
    const taskUserTags = tags(task.tags);
    const taskSystemTags = tags(task.system_tags);
    const taskLastUpdatedAt = text(task.last_update);
    return {
      ...(taskType ? {taskType} : {}),
      ...(taskStatus ? {taskStatus} : {}),
      ...(taskUserTags ? {taskUserTags} : {}),
      ...(taskSystemTags ? {taskSystemTags} : {}),
      ...(taskLastUpdatedAt ? {taskLastUpdatedAt} : {}),
    };
  }

  private definitionPayload(definition: ClearpipeDefinition): Record<string, unknown> {
    const graph = this.graphPayload(definition);
    return {
      name: definition.name,
      description: definition.description,
      public: definition.public,
      tags: definition.tags,
      graph,
    };
  }

  private graphPayload(definition: ClearpipeDefinition): Record<string, unknown> {
    return {
      schema_version: definition.schema_version,
      nodes: definition.nodes,
      edges: definition.edges,
      viewport: definition.viewport,
      default_queues: definition.default_queues,
    };
  }

  private normalizeIssue(issue: unknown) {
    return typeof issue === 'string' ? {message: issue} : issue;
  }

  private definitionResponse(response: any): ClearpipeDefinitionResponse {
    const definition = response?.definition ?? response ?? {};
    return {
      definition: normalizeDefinition(response),
      graph: definition.graph ?? definition.configuration?.ClearPipe?.value ?? definition.configuration?.ClearPipe ?? {},
      representation: definition.representation,
      capabilities: definition.capabilities,
    };
  }

  private taskDescriptorResponse(response: any): ClearpipeTaskDescriptorResponse {
    const status = this.taskDescriptorStatus(response?.status);
    const descriptor = this.safeTaskDescriptor(response?.descriptor);
    const usable = descriptor && (status === 'available' || status === 'stale');
    return {
      status: usable ? status : status === 'unavailable' ? status : 'unavailable',
      ...(usable ? {descriptor} : {}),
    };
  }

  private executionSnapshotResponse(response: any): ClearpipeExecutionSnapshotResponse {
    const status = this.executionSnapshotStatus(response?.status);
    const snapshot = this.safeExecutionSnapshot(response?.snapshot);
    const usable = snapshot && (status === 'available' || status === 'stale');
    return {
      status: usable ? status : status === 'unavailable' ? status : 'unavailable',
      ...(usable ? {snapshot} : {}),
    };
  }

  private safeTaskDescriptor(value: unknown): ClearpipeTaskDescriptor | undefined {
    const descriptor = this.record(value);
    const identity = this.record(descriptor?.identity);
    const context = this.record(descriptor?.context);
    const taskId = this.text(identity?.task_id);
    const name = this.text(context?.name);
    const type = this.text(context?.type);
    const status = this.text(context?.status);
    if (!taskId || !name || !type || !status) return undefined;
    return {
      identity: {task_id: taskId},
      context: {
        name,
        type,
        status,
        ...(this.text(context?.project_id) ? {project_id: this.text(context?.project_id)!} : {}),
        ...(this.text(context?.project_name) ? {project_name: this.text(context?.project_name)!} : {}),
        ...(this.text(context?.updated_at) ? {updated_at: this.text(context?.updated_at)!} : {}),
      },
      parameters: this.array(descriptor?.parameters).flatMap(item => this.safeParameterDescriptor(item)),
      artifacts: this.array(descriptor?.artifacts).flatMap(item => this.safeArtifactDescriptor(item)),
    };
  }

  private safeExecutionSnapshot(value: unknown): ClearpipeExecutionSnapshot | undefined {
    const snapshot = this.record(value);
    const controller = this.record(snapshot?.controller);
    const runTaskId = this.text(snapshot?.run_task_id);
    const definitionTaskId = this.text(snapshot?.definition_task_id);
    const revision = this.integer(snapshot?.definition_revision);
    const graphDigest = this.text(snapshot?.graph_digest);
    const nodeOffset = this.integer(snapshot?.node_offset);
    const totalNodes = this.integer(snapshot?.total_nodes);
    const truncated = typeof snapshot?.truncated === 'boolean' ? snapshot.truncated : undefined;
    const controllerTaskId = this.text(controller?.task_id);
    const controllerStatus = this.text(controller?.status);
    if (!runTaskId || !definitionTaskId || revision === undefined || !graphDigest
      || nodeOffset === undefined || totalNodes === undefined || truncated === undefined
      || !controllerTaskId || !controllerStatus) {
      return undefined;
    }
    return {
      run_task_id: runTaskId,
      definition_task_id: definitionTaskId,
      definition_revision: revision,
      graph_digest: graphDigest,
      node_offset: nodeOffset,
      total_nodes: totalNodes,
      truncated,
      ...(truncated && this.integer(snapshot?.next_node_offset) !== undefined
        ? {next_node_offset: this.integer(snapshot?.next_node_offset)!}
        : {}),
      controller: {
        task_id: controllerTaskId,
        status: controllerStatus,
        ...(this.text(controller?.started_at) ? {started_at: this.text(controller?.started_at)!} : {}),
        ...(this.text(controller?.completed_at) ? {completed_at: this.text(controller?.completed_at)!} : {}),
        ...(this.text(controller?.updated_at) ? {updated_at: this.text(controller?.updated_at)!} : {}),
      },
      nodes: this.array(snapshot?.nodes).flatMap(item => this.safeExecutionNode(item)),
    };
  }

  private safeParameterDescriptor(value: unknown): ClearpipeTaskParameterDescriptor[] {
    const parameter = this.record(value);
    const section = this.text(parameter?.section);
    const name = this.text(parameter?.name);
    if (!section || !name) return [];
    return [{
      section,
      name,
      ...(this.text(parameter?.type) ? {type: this.text(parameter?.type)!} : {}),
    }];
  }

  private safeArtifactDescriptor(value: unknown): ClearpipeTaskArtifactDescriptor[] {
    const artifact = this.record(value);
    const id = this.text(artifact?.id);
    const name = this.text(artifact?.name);
    if (!id || !name) return [];
    const direction = artifact?.direction === 'input' || artifact?.direction === 'output'
      ? artifact.direction
      : undefined;
    return [{
      id,
      name,
      ...(this.text(artifact?.type) ? {type: this.text(artifact?.type)!} : {}),
      ...(direction ? {direction} : {}),
    }];
  }

  private safeExecutionNode(value: unknown): ClearpipeExecutionNodeSnapshot[] {
    const node = this.record(value);
    const graphNodeId = this.text(node?.graph_node_id);
    const pipelineStepName = this.text(node?.pipeline_step_name);
    const recordStatus = this.runtimeRecordStatus(node?.record_status);
    if (!graphNodeId || !pipelineStepName || !recordStatus) return [];
    const models = this.safeModels(node?.models);
    const result = node?.result === 'success' || node?.result === 'failure' ? node.result : undefined;
    return [{
      graph_node_id: graphNodeId,
      pipeline_step_name: pipelineStepName,
      record_status: recordStatus,
      ...(this.text(node?.task_id) ? {task_id: this.text(node?.task_id)!} : {}),
      ...(this.text(node?.status) ? {status: this.text(node?.status)!} : {}),
      ...(this.text(node?.started_at) ? {started_at: this.text(node?.started_at)!} : {}),
      ...(this.text(node?.completed_at) ? {completed_at: this.text(node?.completed_at)!} : {}),
      ...(this.text(node?.updated_at) ? {updated_at: this.text(node?.updated_at)!} : {}),
      ...(result ? {result} : {}),
      ...(this.text(node?.log_task_id) ? {log_task_id: this.text(node?.log_task_id)!} : {}),
      ...(this.array(node?.artifacts).length ? {artifacts: this.array(node?.artifacts).flatMap(item => this.safeArtifactDescriptor(item))} : {}),
      ...(node?.artifacts_truncated === true ? {artifacts_truncated: true} : {}),
      ...(models ? {models} : {}),
      ...(this.array(node?.datasets).length ? {datasets: this.array(node?.datasets).flatMap(item => this.safeDataset(item))} : {}),
    }];
  }

  private safeModels(value: unknown): ClearpipeExecutionNodeSnapshot['models'] | undefined {
    const models = this.record(value);
    const input = this.safeModelList(models?.input);
    const output = this.safeModelList(models?.output);
    return input.length || output.length
      ? {...(input.length ? {input} : {}), ...(output.length ? {output} : {})}
      : undefined;
  }

  private safeModelList(value: unknown): {id: string; name?: string}[] {
    return this.array(value).flatMap(item => {
      const model = this.record(item);
      const id = this.text(model?.id);
      return id ? [{id, ...(this.text(model?.name) ? {name: this.text(model?.name)!} : {})}] : [];
    });
  }

  private safeDataset(value: unknown): {task_id: string; name: string}[] {
    const dataset = this.record(value);
    const taskId = this.text(dataset?.task_id);
    const name = this.text(dataset?.name);
    return taskId && name ? [{task_id: taskId, name}] : [];
  }

  private taskDescriptorStatus(value: unknown): ClearpipeTaskDescriptorStatus {
    return value === 'available' || value === 'stale' || value === 'unavailable'
      ? value
      : 'unavailable';
  }

  private executionSnapshotStatus(value: unknown): ClearpipeExecutionSnapshotStatus {
    return value === 'available' || value === 'stale' || value === 'unavailable'
      ? value
      : 'unavailable';
  }

  private runtimeRecordStatus(value: unknown): ClearpipeRuntimeRecordStatus | undefined {
    return value === 'available' || value === 'unavailable'
      ? value
      : undefined;
  }

  private record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  }

  private array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }

  private text(value: unknown): string | undefined {
    return typeof value === 'string' && value.length <= 512 ? value : undefined;
  }

  private integer(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
  }
}
