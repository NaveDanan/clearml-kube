import {inject, Injectable} from '@angular/core';
import {forkJoin, Observable, of} from 'rxjs';
import {filter, map, switchMap, take} from 'rxjs/operators';
import {
  ClearpipeAdapterOutcome,
  ClearpipeAdapterService,
  ClearpipeDefinitionState,
} from '../platform/clearpipe-adapter.service';
import {ExistingPipelineBlocker, ExistingPipelineLoadResult} from './clearpipe-existing-pipeline.models';
import {
  ClearpipeExistingPipelineRepresentabilityService,
  unavailableResourceBlocker,
} from './clearpipe-existing-pipeline-representability.service';

const completed = <T>(source: Observable<ClearpipeAdapterOutcome<T>>): Observable<Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'}>> =>
  source.pipe(
    filter((outcome): outcome is Exclude<ClearpipeAdapterOutcome<T>, {status: 'loading'}> => outcome.status !== 'loading'),
    take(1),
  );

@Injectable({providedIn: 'root'})
export class ClearpipeExistingPipelineLoaderService {
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly representability = inject(ClearpipeExistingPipelineRepresentabilityService);

  load(taskId: string): Observable<ExistingPipelineLoadResult> {
    return this.adapter.load(taskId).pipe(
      switchMap(outcome => this.loadOutcome(outcome)),
    );
  }

  private loadOutcome(outcome: ClearpipeAdapterOutcome<ClearpipeDefinitionState>): Observable<ExistingPipelineLoadResult> {
    if (outcome.status === 'loading') return of(outcome);
    if (outcome.status === 'denied_or_missing') return of({status: 'denied', problem: outcome.problem});
    if (outcome.status !== 'ready') {
      if (outcome.status === 'unsupported_representation') {
        return of({
          status: 'unsupported',
          state: outcome.data,
          blockers: [{
            code: outcome.problem.code ?? 'unsupported_representation',
            path: 'graph',
            message: outcome.problem.message,
            action: 'source',
          }],
          problem: outcome.problem,
        });
      }
      return of({status: 'error', problem: outcome.problem});
    }

    const review = this.representability.review(outcome.data);
    if (review.status === 'unsupported') return of(review);
    return this.referenceBlockers(review.state).pipe(map(blockers => blockers.length
      ? {
        status: 'unsupported' as const,
        state: review.state,
        blockers,
        problem: {
          code: blockers[0].code,
          message: 'This pipeline has stale or inaccessible references and cannot be edited safely.',
          retryable: false,
        },
      }
      : review));
  }

  private referenceBlockers(state: ClearpipeDefinitionState): Observable<ExistingPipelineBlocker[]> {
    const graph = state.graph!;
    const taskChecks = graph.nodes.flatMap((node, index) => {
      if (node.kind !== 'task' || node.base_task.kind !== 'task-id') return [];
      const taskId = node.base_task.task_id;
      return [completed(this.adapter.taskDescriptor(taskId)).pipe(map(outcome => {
        if (outcome.status === 'ready' && outcome.data.status === 'available') return null;
        const status = outcome.status === 'ready' && outcome.data.status === 'stale' ? 'stale' : 'unavailable';
        return unavailableResourceBlocker('task', taskId, `graph.nodes[${index}].base_task`, status);
      }))];
    });

    const resourceKinds = [...new Set(graph.resources.map(resource => resource.kind))];
    const resourceChecks = resourceKinds.map(kind => completed(this.adapter.resources(kind)).pipe(map(outcome => {
      const resources = graph.resources.filter(resource => resource.kind === kind);
      if (outcome.status !== 'ready') {
        return resources.map(resource => unavailableResourceBlocker(kind, resource.resource_id, `graph.resources.${resource.id}`, 'unavailable'));
      }
      const visible = new Set(outcome.data.map(resource => resource.id));
      return resources
        .filter(resource => !visible.has(resource.resource_id))
        .map(resource => unavailableResourceBlocker(kind, resource.resource_id, `graph.resources.${resource.id}`, 'unavailable'));
    })));

    if (!taskChecks.length && !resourceChecks.length) return of([]);
    return forkJoin([...taskChecks, ...resourceChecks]).pipe(map(results => results.flat().filter(Boolean) as ExistingPipelineBlocker[]));
  }
}
