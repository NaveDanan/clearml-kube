/**
 * Canonical model for the clearpipe-main-style flow editor (/clearpipe/new).
 *
 * Deliberately a small, direct node/edge/config model - mirroring the reference
 * `clearpipe-main` app - so the editor supports drag-drop authoring, click-to-
 * configure, and node-to-node ordering connections without the rigid graph-v2
 * task/function/port semantics.
 */

export type ClearpipeFlowNodeType =
  | 'scheduled'
  | 'autoscaler'
  | 'dataset'
  | 'task'
  | 'execute'
  | 'report';

export type ClearpipeFlowStatus = 'idle' | 'pending' | 'running' | 'completed' | 'error' | 'warning' | 'stopped';

/** The Dataset node's 3-way mode toggle: create a brand-new dataset, sync (re-version)
 *  an existing one, or just use an existing dataset + version as-is. */
export type ClearpipeDatasetMode = 'use' | 'create' | 'sync';

/** The AutoScaler node's 2-way mode toggle: spin a workload up (submit) or tear a
 *  previously-started one down (stop / delete) via the Run:ai CLI. */
export type ClearpipeAutoscalerMode = 'spinup' | 'spindown';

/** What a Spin-down AutoScaler node does to the target workload. */
export type ClearpipeAutoscalerSpinDownAction = 'stop' | 'delete';

export const AUTOSCALER_MODE_LABELS: Record<ClearpipeAutoscalerMode, string> = {
  spinup: 'Spin-up',
  spindown: 'Spin-down',
};

/** Where a newly created dataset's files come from. */
export type ClearpipeDatasetSourceType = 'local' | 'nfs' | 's3';

export const DATASET_MODE_LABELS: Record<ClearpipeDatasetMode, string> = {
  use: 'Use',
  create: 'Create',
  sync: 'Sync',
};

export const DATASET_SOURCE_TYPE_LABELS: Record<ClearpipeDatasetSourceType, string> = {
  local: 'Local path',
  nfs: 'NFS',
  s3: 'S3 bucket',
};

/**
 * ClearPipe's "normal increment" for dataset Sync: bumps the major segment and
 * resets minor/patch to 0 (e.g. 1.0.2 -> 2.0.0). This is intentionally different
 * from the ClearML SDK's own Dataset auto-increment (which only bumps the patch
 * segment, e.g. 1.0.2 -> 1.0.3) - see clearml/clearml/utilities/version.py.
 */
export function incrementDatasetVersion(version: string | undefined): string {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec((version ?? '').trim());
  if (!match) return '1.0.0';
  return `${Number(match[1]) + 1}.0.0`;
}

/** On-canvas node footprint (kept in sync with the canvas component + boundary math). */
export const CLEARPIPE_FLOW_NODE_SIZE = {width: 240, height: 92} as const;

export interface ClearpipeFlowPoint {
  x: number;
  y: number;
}

export interface ClearpipeFlowNode {
  id: string;
  type: ClearpipeFlowNodeType;
  position: ClearpipeFlowPoint;
  label: string;
  description?: string;
  status: ClearpipeFlowStatus;
  statusMessage?: string;
  config: Record<string, unknown>;
}

export interface ClearpipeFlowEdge {
  id: string;
  source: string;
  target: string;
}

/**
 * A boundary is a resizable region (not a node) drawn on the canvas. Only nodes
 * inside a boundary and connected to the pipeline are part of that boundary's
 * sequence; edges that leave the boundary stop the pipeline there.
 */
export interface ClearpipeFlowBoundary {
  id: string;
  position: ClearpipeFlowPoint;
  width: number;
  height: number;
  label: string;
  color?: string;
  /** Placeholder for a future action when the pipeline reaches this boundary. */
  onReach?: string;
}

export interface ClearpipeFlowViewport extends ClearpipeFlowPoint {
  zoom: number;
}

export interface ClearpipeFlowGraph {
  id?: string;
  name: string;
  description?: string;
  /** When true the pipeline is available to run (its schedulers fire as programmed). */
  activated: boolean;
  nodes: ClearpipeFlowNode[];
  edges: ClearpipeFlowEdge[];
  boundaries: ClearpipeFlowBoundary[];
  viewport: ClearpipeFlowViewport;
}

/** Category accent keys map to fixed hues shared by palette, canvas and inspector. */
export type ClearpipeFlowCategory = 'triggers' | 'compute' | 'data' | 'tasks' | 'scripts' | 'output';

export interface ClearpipeFlowNodeTypeMeta {
  readonly type: ClearpipeFlowNodeType;
  readonly label: string;
  readonly description: string;
  /** allegro icon font glyph (fontSet="al"). */
  readonly icon: string;
  readonly category: ClearpipeFlowCategory;
  readonly categoryLabel: string;
  /** Fixed accent hue (works in light + dark themes via color-mix tints). */
  readonly accent: string;
  readonly defaults: Record<string, unknown>;
}

/**
 * The five intuitive ClearPipe node types. Each maps to a real ClearML concept
 * that the inspector wires to (autoscaler flow, datasets, tasks,
 * remote command execution, and template reports).
 */
export const CLEARPIPE_FLOW_NODE_TYPES: readonly ClearpipeFlowNodeTypeMeta[] = [
  {
    type: 'scheduled',
    label: 'Scheduled',
    description: 'Fire the pipeline automatically on a schedule (cron / interval)',
    icon: 'al-ico-schedulers',
    category: 'triggers',
    categoryLabel: 'Triggers',
    accent: '#14b8a6',
    defaults: {
      enabled: true,
      scheduleMode: 'interval',
      intervalValue: 1,
      intervalUnit: 'hours',
      cron: '0 * * * *',
      timezone: '',
      startTime: '',
      endTime: '',
      fireWhenStart: false,
    },
  },
  {
    type: 'autoscaler',
    label: 'AutoScaler',
    description: 'Spin up an autoscaler from the autoscaler flow',
    icon: 'al-ico-queues',
    category: 'compute',
    categoryLabel: 'Compute',
    accent: '#f59e0b',
    defaults: {
      mode: 'spinup' as ClearpipeAutoscalerMode,
      autoscaler: '',
      project: '',
      queue: '',
      workloadName: '',
      image: '',
      command: '',
      gpu: '',
      cpu: '',
      // Spin-down tab - tear down a workload started by an upstream Spin-up node.
      spinDownAction: 'stop' as ClearpipeAutoscalerSpinDownAction,
      spinDownWorkloadName: '',
    },
  },
  {
    type: 'dataset',
    label: 'Dataset',
    description: 'Create, sync or use a ClearML dataset',
    icon: 'al-ico-datasets',
    category: 'data',
    categoryLabel: 'Data',
    accent: '#3b82f6',
    defaults: {
      mode: 'use' as ClearpipeDatasetMode,
      project: '',
      // Use tab - pick an existing dataset + version.
      useDatasetId: '',
      useVersion: 'latest',
      // Create tab - clearml-agent creates a brand-new dataset from a source path.
      createQueue: '',
      createProject: '',
      createAlias: '',
      createDatasetName: '',
      createSourceType: 'local' as ClearpipeDatasetSourceType,
      createSourcePath: '',
      // Sync tab - re-version an already-uploaded dataset.
      syncDatasetId: '',
      syncPathMode: 'same' as 'same' | 'new',
      syncPath: '',
      syncVersionMode: 'increment' as 'increment' | 'tag',
      syncVersionTag: '',
    },
  },
  {
    type: 'task',
    label: 'Task',
    description: 'Connect to tasks to run or clone',
    icon: 'al-ico-type-training',
    category: 'tasks',
    categoryLabel: 'Tasks',
    accent: '#a855f7',
    defaults: {
      project: '',
      taskIds: [] as string[],
      queue: '',
    },
  },
  {
    type: 'execute',
    label: 'Execute',
    description: 'Bash into the AutoScaler and run commands',
    icon: 'al-ico-code',
    category: 'scripts',
    categoryLabel: 'Scripts',
    accent: '#22c55e',
    defaults: {
      target: '',
      command: '',
    },
  },
  {
    type: 'report',
    label: 'Report',
    description: 'Build a report from a template + task artifacts',
    icon: 'al-ico-reports',
    category: 'output',
    categoryLabel: 'Output',
    accent: '#ec4899',
    defaults: {
      templateReportId: '',
      artifactSources: [] as string[],
    },
  },
];

export const clearpipeFlowNodeMeta = (type: ClearpipeFlowNodeType): ClearpipeFlowNodeTypeMeta =>
  CLEARPIPE_FLOW_NODE_TYPES.find((meta) => meta.type === type) ?? CLEARPIPE_FLOW_NODE_TYPES[0];

export const emptyClearpipeFlowGraph = (): ClearpipeFlowGraph => ({
  name: 'Untitled ClearPipe',
  activated: false,
  nodes: [],
  edges: [],
  boundaries: [],
  viewport: {x: 0, y: 0, zoom: 1},
});
