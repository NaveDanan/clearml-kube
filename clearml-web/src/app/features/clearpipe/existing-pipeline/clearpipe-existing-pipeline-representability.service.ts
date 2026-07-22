import {Injectable} from '@angular/core';
import {ClearpipeAdapterProblem, ClearpipeDefinitionState} from '../platform/clearpipe-adapter.service';
import {GraphNode, GraphV2, ResourceKind} from '../domain/graph-v2.types';
import {
  ExistingPipelineBlocker,
  ExistingPipelineReview,
  ExistingPipelineVisualMetadata,
} from './clearpipe-existing-pipeline.models';

const unsupportedProblem = (blockers: readonly ExistingPipelineBlocker[]): ClearpipeAdapterProblem => ({
  code: blockers[0]?.code ?? 'existing_pipeline_unsupported',
  message: blockers.length === 1
    ? blockers[0].message
    : 'This pipeline has constructs that cannot be represented losslessly for ClearPipe editing.',
  retryable: false,
});

const nodePath = (index: number): string => `graph.nodes[${index}]`;

const functionHasDynamicSource = (node: Extract<GraphNode, {kind: 'function'}>): boolean =>
  /(^|\n)\s*@|(^|\n)\s*(?:async\s+def|class\s)|\b(?:lambda|yield)\b/.test(node.source);

/**
 * ClearPipe edits only canonical, homogeneous task or function graphs with
 * immutable task references. The function intentionally returns every reason
 * so callers never present a partial graph as editable.
 */
export const existingPipelineBlockers = (state: ClearpipeDefinitionState): readonly ExistingPipelineBlocker[] => {
  const blockers: ExistingPipelineBlocker[] = [];
  if (state.representation !== 'clearpipe_graph_v2') {
    blockers.push({
      code: state.representation,
      path: 'representation',
      message: 'The stored pipeline representation is not the canonical ClearPipe v2 graph.',
      action: 'source',
    });
    return blockers;
  }

  const graph = state.graph;
  if (!graph) {
    blockers.push({
      code: 'missing_canonical_graph',
      path: 'graph',
      message: 'The pipeline has no supported canonical graph to edit.',
      action: 'source',
    });
    return blockers;
  }

  const kinds = new Set(graph.nodes.map(node => node.kind));
  if (kinds.size > 1) {
    blockers.push({
      code: 'mixed_node_styles',
      path: 'graph.nodes',
      message: 'This pipeline mixes task-backed and code-backed nodes; that source style is not losslessly editable as one existing pipeline.',
      action: 'source',
    });
  }

  graph.nodes.forEach((node, index) => {
    const path = nodePath(index);
    if (node.kind === 'task' && node.base_task.kind !== 'task-id') {
      blockers.push({
        code: 'mutable_task_reference',
        path: `${path}.base_task`,
        message: `Task node "${node.label}" uses a mutable project/name reference instead of an immutable task ID.`,
        action: 'details',
      });
    }
    if (node.kind === 'function' && functionHasDynamicSource(node)) {
      blockers.push({
        code: 'dynamic_function_source',
        path: `${path}.source`,
        message: `Function node "${node.label}" uses decorators, async/class code, lambda, or yield and cannot be losslessly re-authored.`,
        action: 'source',
      });
    }
  });
  return blockers;
};

/**
 * Keeps all semantic graph values intact. Only legacy missing visual metadata
 * receives a stable, index-based layout so a later save cannot invent meaning.
 */
export const existingPipelineVisualMetadata = (graph: GraphV2): ExistingPipelineVisualMetadata => {
  if (graph.visual?.viewport && Number.isFinite(graph.visual.zoom) && graph.visual.zoom > 0) {
    return {layout: 'preserved', graph: structuredClone(graph)};
  }
  return {
    layout: 'deterministic',
    graph: {
      ...structuredClone(graph),
      nodes: graph.nodes.map((node, index) => ({
        ...node,
        visual: {
          ...node.visual,
          position: {x: (index % 4) * 320, y: Math.floor(index / 4) * 220},
        },
      })),
      visual: {viewport: {x: 0, y: 0}, zoom: 1},
    },
  };
};

export const reviewExistingPipeline = (state: ClearpipeDefinitionState): ExistingPipelineReview => {
  const blockers = existingPipelineBlockers(state);
  if (blockers.length) {
    return {status: 'unsupported', state, blockers, problem: unsupportedProblem(blockers)};
  }
  const graph = state.graph!;
  const visual = existingPipelineVisualMetadata(graph);
  return {status: 'editable', state, graph: visual.graph, visual};
};

export const unavailableResourceBlocker = (
  kind: ResourceKind,
  id: string,
  path: string,
  status: 'stale' | 'unavailable' | 'denied',
): ExistingPipelineBlocker => ({
  code: `resource_${status}`,
  path,
  message: `The referenced ${kind} "${id}" is ${status === 'stale' ? 'stale' : 'unavailable or inaccessible'}; ClearPipe will not replace it.`,
  action: 'details',
  resource: {kind, id},
});

@Injectable({providedIn: 'root'})
export class ClearpipeExistingPipelineRepresentabilityService {
  review(state: ClearpipeDefinitionState): ExistingPipelineReview {
    return reviewExistingPipeline(state);
  }
}
