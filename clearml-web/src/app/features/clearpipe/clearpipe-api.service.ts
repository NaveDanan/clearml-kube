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

@Injectable({providedIn: 'root'})
export class ClearpipeApiService {
  private requests = inject(SmApiRequestsService);

  private endpoint(action: string): string {
    return `${HTTP.API_BASE_URL_NO_VERSION}/v2.35/clearpipe.${action}`;
  }

  getAll(search = '', archived = false): Observable<ClearpipeDefinition[]> {
    return this.requests.post<any>(this.endpoint('get_all'), {
      search,
      include_archived: archived,
      page: 0,
      page_size: 500,
      order_by: ['-last_update']
    }).pipe(map(response => {
      const items = response?.definitions ?? response?.pipelines ?? response?.tasks ?? response ?? [];
      return (Array.isArray(items) ? items : []).map(normalizeDefinition);
    }));
  }

  getById(taskId: string): Observable<ClearpipeDefinition> {
    return this.requests.post<any>(this.endpoint('get_by_id'), {task: taskId})
      .pipe(map(normalizeDefinition));
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
    return this.requests.post<any>(this.endpoint('parse_script'), {script, filename})
      .pipe(map(response => ({parameters: response?.parameters ?? response?.detected_parameters ?? []})));
  }

  getResources(type: ClearpipeResourceOption['type']): Observable<ClearpipeResourceOption[]> {
    const requests: Record<ClearpipeResourceOption['type'], {endpoint: string; body: Record<string, unknown>; key: string}> = {
      project: {endpoint: 'projects.get_all', body: {page: 0, page_size: 500, only_fields: ['id', 'name']}, key: 'projects'},
      task: {endpoint: 'tasks.get_all', body: {page: 0, page_size: 500, only_fields: ['id', 'name', 'project']}, key: 'tasks'},
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
      })))
    );
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
      nodes: definition.nodes,
      edges: definition.edges,
      viewport: definition.viewport,
      default_queues: definition.default_queues,
    };
  }

  private normalizeIssue(issue: unknown) {
    return typeof issue === 'string' ? {message: issue} : issue;
  }
}
