import {inject, Injectable} from '@angular/core';
import {GraphCommandResult, GraphStoreService} from '../../domain/graph-store.service';
import {GraphPort, GraphNode, ResourceReference} from '../../domain/graph-v2.types';
import {ClearpipeResourceReference, ClearpipeResourceSelection} from '../clearpipe-resource.models';

export interface ClearpipeDatasetBindingResult {
  readonly status: 'bound' | 'unsupported-target' | 'already-bound' | 'failed';
  readonly reference: ClearpipeResourceReference;
  readonly graphResourceId?: string;
  readonly result?: GraphCommandResult;
}

const graphResourceId = (resourceId: string): string =>
  `dataset-${[...resourceId].map((character) => character.charCodeAt(0).toString(16).padStart(4, '0')).join('')}`;

export const isDatasetBindingTarget = (port: GraphPort): boolean =>
  port.direction === 'input'
  && port.role === 'artifact'
  && port.accepted_binding_kinds.includes('artifact');

/**
 * Composes CP-18's safe dataset reference with CP-06's existing resource and
 * artifact-binding representation. It neither queries nor validates resources.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeDatasetBindingHandoffService {
  private readonly graphStore = inject(GraphStoreService);

  targets(node: GraphNode): readonly GraphPort[] {
    return node.ports.filter(isDatasetBindingTarget);
  }

  bind(selection: ClearpipeResourceSelection, node: GraphNode, portId: string): ClearpipeDatasetBindingResult {
    const reference = selection.reference;
    const port = node.ports.find((candidate) => candidate.id === portId);
    if (reference.kind !== 'dataset' || !port || !isDatasetBindingTarget(port)) {
      return {status: 'unsupported-target', reference};
    }

    const graph = this.graphStore.graph();
    if (!graph) return {status: 'failed', reference};
    if (graph.bindings.some((binding) =>
      binding.kind === 'artifact'
      && binding.target.node_id === node.id
      && binding.target.port_id === port.id)) {
      return {status: 'already-bound', reference};
    }

    const existing = graph.resources.find((resource) =>
      resource.kind === 'dataset' && resource.resource_id === reference.resource_id);
    const resourceId = existing?.id ?? graphResourceId(reference.resource_id);
    const result = this.graphStore.transaction('bind-dataset-resource', () => {
      if (!existing) {
        const resource: ResourceReference = {
          id: resourceId,
          kind: 'dataset',
          resource_id: reference.resource_id,
          ...(reference.label ? {label: reference.label} : {}),
        };
        this.graphStore.addResource(resource);
      }
      this.graphStore.createBinding({
        kind: 'artifact',
        source: {kind: 'resource', resource_id: resourceId},
        target: {kind: 'port', node_id: node.id, port_id: port.id},
      });
    });

    return result.ok
      ? {status: 'bound', reference, graphResourceId: resourceId, result}
      : {status: 'failed', reference, result};
  }
}
