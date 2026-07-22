import {
  ClearpipeExecutionNodeSnapshot,
  ClearpipeExecutionSnapshot,
} from '../../clearpipe-api.service';
import {
  ClearpipeExecutionArtifact,
  ClearpipeExecutionController,
  ClearpipeExecutionDataset,
  ClearpipeExecutionModel,
  ClearpipeExecutionNodeState,
  ClearpipeNodeExecution,
  ClearpipeRuntimeEvidence,
  ClearpipeRuntimeStep,
} from './clearpipe-execution.models';
import {ClearpipeStatusPresentation} from '../framework/clearpipe-ui.types';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_TEXT_LENGTH = 160;

const safeId = (value: unknown): string | undefined =>
  typeof value === 'string' && SAFE_ID.test(value) ? value : undefined;

const safeText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= SAFE_TEXT_LENGTH ? value.trim() : undefined;

const safeTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value.length > 80 || Number.isNaN(Date.parse(value))) return undefined;
  return value;
};

const stateFrom = (status: unknown, result: unknown): ClearpipeExecutionNodeState | undefined => {
  const normalized = typeof status === 'string' ? status.toLowerCase() : '';
  if (result === 'failure' || normalized === 'failed') return 'failed';
  if (normalized === 'created' || normalized === 'queued' || normalized === 'pending') return 'queued';
  if (normalized === 'in_progress' || normalized === 'running') return 'running';
  if (normalized === 'completed' || normalized === 'published' || normalized === 'closed') return 'completed';
  if (normalized === 'stopped' || normalized === 'aborted') return 'aborted';
  if (normalized === 'skipped') return 'skipped';
  if (normalized === 'cached') return 'cached';
  return undefined;
};

const artifactsFrom = (value: ClearpipeExecutionNodeSnapshot['artifacts']): readonly ClearpipeExecutionArtifact[] =>
  (value ?? []).flatMap(item => {
    const id = safeId(item.id);
    const name = safeText(item.name);
    return id && name ? [{
      id,
      name,
      ...(safeText(item.type) ? {type: safeText(item.type)} : {}),
      ...(item.direction ? {direction: item.direction} : {}),
    }] : [];
  });

const modelsFrom = (value: {id: string; name?: string}[] | undefined): readonly ClearpipeExecutionModel[] =>
  (value ?? []).flatMap(item => {
    const id = safeId(item.id);
    return id ? [{id, ...(safeText(item.name) ? {name: safeText(item.name)} : {})}] : [];
  });

const datasetsFrom = (value: ClearpipeExecutionNodeSnapshot['datasets']): readonly ClearpipeExecutionDataset[] =>
  (value ?? []).flatMap(item => {
    const taskId = safeId(item.task_id);
    const name = safeText(item.name);
    return taskId && name ? [{taskId, name}] : [];
  });

const emptyNode = (graphNodeId: string): Omit<ClearpipeNodeExecution, 'availability'> => ({
  graphNodeId,
  artifacts: [],
  artifactsTruncated: false,
  models: {input: [], output: []},
  datasets: [],
});

/**
 * Requires a one-to-one server compiler runtime map for every current graph
 * node. No source text or browser-generated identifiers participate.
 */
export const runtimeEvidenceFrom = (
  pipeline: unknown,
  graphNodeIds: readonly string[],
): ClearpipeRuntimeEvidence | null => {
  if (!pipeline || typeof pipeline !== 'object') return null;
  const output = pipeline as Record<string, unknown>;
  const manifest = output['manifest'];
  if (typeof output['source'] !== 'string' || !output['source'].trim() || !manifest || typeof manifest !== 'object') return null;
  const manifestRecord = manifest as Record<string, unknown>;
  const graphDigest = safeText(manifestRecord['graph_digest']);
  const runtimeSteps = manifestRecord['runtime_steps'];
  if (!graphDigest || !graphDigest.startsWith('sha256:') || !Array.isArray(runtimeSteps)) return null;

  const expected = new Set(graphNodeIds);
  const nodes = new Set<string>();
  const steps = new Set<string>();
  const mapped: ClearpipeRuntimeStep[] = [];
  for (const raw of runtimeSteps) {
    if (!raw || typeof raw !== 'object') return null;
    const record = raw as Record<string, unknown>;
    const graphNodeId = safeId(record['graph_node_id']);
    const pipelineStepName = safeId(record['pipeline_step_name']);
    if (!graphNodeId || !pipelineStepName || !expected.has(graphNodeId)
      || nodes.has(graphNodeId) || steps.has(pipelineStepName)) return null;
    nodes.add(graphNodeId);
    steps.add(pipelineStepName);
    mapped.push({graphNodeId, pipelineStepName});
  }
  return nodes.size === expected.size ? {graphDigest, steps: mapped} : null;
};

export const snapshotMatchesScope = (
  snapshot: ClearpipeExecutionSnapshot,
  runTaskId: string,
  definitionTaskId: string,
  revision: number,
  graphDigest: string,
): boolean => snapshot.run_task_id === runTaskId
  && snapshot.definition_task_id === definitionTaskId
  && snapshot.definition_revision === revision
  && snapshot.graph_digest === graphDigest;

export const controllerFrom = (
  snapshot: ClearpipeExecutionSnapshot,
): ClearpipeExecutionController | null => {
  const taskId = safeId(snapshot.controller.task_id);
  const status = safeText(snapshot.controller.status);
  return taskId && status ? {
    taskId,
    status,
    ...(safeTimestamp(snapshot.controller.started_at) ? {startedAt: safeTimestamp(snapshot.controller.started_at)} : {}),
    ...(safeTimestamp(snapshot.controller.completed_at) ? {completedAt: safeTimestamp(snapshot.controller.completed_at)} : {}),
    ...(safeTimestamp(snapshot.controller.updated_at) ? {updatedAt: safeTimestamp(snapshot.controller.updated_at)} : {}),
  } : null;
};

/**
 * Convert only one CP-14 runtime record whose server-assigned stable mapping
 * matches the compiler evidence. The caller ignores all unmatched records.
 */
export const nodeExecutionFrom = (
  record: ClearpipeExecutionNodeSnapshot,
  evidence: ClearpipeRuntimeEvidence,
): ClearpipeNodeExecution | null => {
  const graphNodeId = safeId(record.graph_node_id);
  const expectedStep = graphNodeId
    ? evidence.steps.find(step => step.graphNodeId === graphNodeId)?.pipelineStepName
    : undefined;
  if (!graphNodeId || !expectedStep || record.pipeline_step_name !== expectedStep) return null;

  const base = emptyNode(graphNodeId);
  if (record.record_status === 'unavailable') {
    return {...base, availability: 'unavailable'};
  }

  const taskId = safeId(record.task_id);
  const logTaskId = safeId(record.log_task_id);
  const backendStatus = safeText(record.status);
  const result = record.result;
  const state = stateFrom(backendStatus, result);
  return {
    ...base,
    availability: 'available',
    ...(state ? {state} : {}),
    ...(backendStatus ? {backendStatus} : {}),
    ...(taskId ? {taskId} : {}),
    ...(logTaskId ? {logTaskId} : {}),
    ...(safeTimestamp(record.started_at) ? {startedAt: safeTimestamp(record.started_at)} : {}),
    ...(safeTimestamp(record.completed_at) ? {completedAt: safeTimestamp(record.completed_at)} : {}),
    ...(safeTimestamp(record.updated_at) ? {updatedAt: safeTimestamp(record.updated_at)} : {}),
    ...(result ? {result} : {}),
    ...(state === 'failed' ? {failureDetail: 'ClearML reported a failure. Open the authorized task details or logs for details.'} : {}),
    artifacts: artifactsFrom(record.artifacts),
    artifactsTruncated: record.artifacts_truncated === true,
    models: {
      input: modelsFrom(record.models?.input),
      output: modelsFrom(record.models?.output),
    },
    datasets: datasetsFrom(record.datasets),
  };
};

/**
 * Snapshot timestamps are server data. Older updates cannot replace a newer
 * node projection; an undated record never replaces a dated one.
 */
export const mergeNodeExecution = (
  current: ClearpipeNodeExecution | undefined,
  incoming: ClearpipeNodeExecution,
): ClearpipeNodeExecution => {
  if (!current || incoming.availability === 'unavailable') return incoming;
  if (current.availability === 'unavailable') return incoming;
  const currentTime = current.updatedAt ? Date.parse(current.updatedAt) : Number.NaN;
  const incomingTime = incoming.updatedAt ? Date.parse(incoming.updatedAt) : Number.NaN;
  if (!Number.isNaN(currentTime) && (Number.isNaN(incomingTime) || incomingTime < currentTime)) return current;
  return incoming;
};

const stateTone: Record<ClearpipeExecutionNodeState, ClearpipeStatusPresentation['tone']> = {
  submitted: 'info',
  queued: 'info',
  running: 'running',
  completed: 'success',
  failed: 'error',
  aborted: 'warning',
  skipped: 'warning',
  cached: 'neutral',
};

export const nodeStatusPresentation = (
  node: ClearpipeNodeExecution | undefined,
): readonly ClearpipeStatusPresentation[] => {
  if (!node) return [];
  if (node.availability === 'unavailable') {
    return [{tone: 'unavailable', label: 'Runtime record unavailable', detail: 'No authorized task record is currently available for this node.'}];
  }
  if (!node.state) {
    return [{tone: 'info', label: 'Runtime record received', detail: 'The reported task status is not mapped to a ClearPipe node state.'}];
  }
  return [{
    tone: stateTone[node.state],
    label: node.state[0].toUpperCase() + node.state.slice(1),
    ...(node.failureDetail ? {detail: node.failureDetail} : node.updatedAt ? {detail: `Updated ${node.updatedAt}`} : {}),
  }];
};
