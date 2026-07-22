import {ClearpipeAdapterProblem, ClearpipeDefinitionState} from '../platform/clearpipe-adapter.service';
import {GraphV2, ResourceKind} from '../domain/graph-v2.types';

export type ExistingPipelineBlockerAction = 'details' | 'source' | 'return';

export interface ExistingPipelineBlocker {
  code: string;
  path: string;
  message: string;
  action: ExistingPipelineBlockerAction;
  resource?: {kind: ResourceKind; id: string};
}

export interface ExistingPipelineVisualMetadata {
  layout: 'preserved' | 'deterministic';
  graph: GraphV2;
}

export type ExistingPipelineReview =
  | {
    status: 'editable';
    state: ClearpipeDefinitionState;
    graph: GraphV2;
    visual: ExistingPipelineVisualMetadata;
  }
  | {
    status: 'unsupported';
    state?: ClearpipeDefinitionState;
    blockers: readonly ExistingPipelineBlocker[];
    problem: ClearpipeAdapterProblem;
  };

export type ExistingPipelineLoadResult =
  | {status: 'loading'}
  | ExistingPipelineReview
  | {status: 'denied'; problem: ClearpipeAdapterProblem}
  | {status: 'error'; problem: ClearpipeAdapterProblem};
