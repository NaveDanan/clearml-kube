// Node components and their execution functions
export { DatasetNode, checkDatasetConnection, fetchClearMLDataset, executeDataset } from './dataset';
export type { DatasetExecutionResult } from './dataset';
export { VersioningNode, executeVersioning, listClearMLDatasets } from './versioning';
export type { VersioningExecutionResult } from './versioning';
export { ExecuteNode, runExecute } from './execute';
export type { ExecuteExecutionResult } from './execute';
export { TrainingNode, executeTraining } from './training';
export { ExperimentNode, executeExperiment } from './experiment';
export { ReportNode, executeReport } from './report';

// Base component
export { BaseNodeComponent } from './base-node-component';

// Shared utilities and types
export * from './shared';

// Node types mapping for React Flow
import { DatasetNode } from './dataset';
import { VersioningNode } from './versioning';
import { ExecuteNode } from './execute';
import { TrainingNode } from './training';
import { ExperimentNode } from './experiment';
import { ReportNode } from './report';

export const nodeTypes = {
  dataset: DatasetNode,
  versioning: VersioningNode,
  execute: ExecuteNode,
  training: TrainingNode,
  experiment: ExperimentNode,
  report: ReportNode,
};
