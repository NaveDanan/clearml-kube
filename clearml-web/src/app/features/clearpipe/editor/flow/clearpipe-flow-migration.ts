/**
 * Backward-compatible migration of legacy ClearPipe flow graphs to the
 * graph-aware Task/Report contracts.
 *
 * Runs on load (after decode) and is deliberately ADDITIVE: it populates the new
 * fields (`baseTaskId`, `reportMappings`, source edges) while preserving legacy
 * fields, so an older graph keeps working in the current inspector until the new
 * mapping-workspace UX fully replaces it.
 *
 * Rules:
 *  - Task node with a one-item `taskIds` array  -> `baseTaskId`.
 *  - Task node with a multi-item `taskIds` array -> flagged for a blocking
 *    "Split into Task nodes" migration (kept intact so the split can run).
 *  - Report `mappings` / `artifactSources` fixed task ids matching a pipeline
 *    Task node's base task -> `sourceNodeId` bindings (+ a Task -> Report edge).
 *  - Unmatched ids -> advanced external-task sources, marked for review.
 */
import {
  ClearpipeFlowEdge,
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
} from './clearpipe-flow.models';
import {ReportMapping as LegacyReportMapping} from './clearpipe-report-template';
import {ReportOutputKind, ReportOutputSelector, ReportSlotMapping} from './clearpipe-report-mapping';

export interface FlowMigrationResult {
  graph: ClearpipeFlowGraph;
  /** Task node ids that hold multiple task ids and need a blocking split. */
  taskNodesNeedingSplit: string[];
  /** Report node ids that retained unmatched external-task sources for review. */
  reportsWithExternalSources: string[];
  changed: boolean;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0) : [];

const splitRef = (ref: string): string[] => ref.split('\u0000');

/** Convert a legacy per-slot mapping to a graph-aware output kind + selector. */
const legacyOutput = (legacy: LegacyReportMapping): {kind: ReportOutputKind; selector: ReportOutputSelector} => {
  const parts = splitRef(legacy.ref ?? '');
  switch (legacy.kind) {
    case 'scalar':
      return {kind: 'scalar', selector: {metric: legacy.metric ?? parts[1], variant: legacy.variant ?? parts[2]}};
    case 'plot':
      return {kind: 'plot', selector: {metric: legacy.metric ?? parts[1], variant: legacy.variant ?? parts[2]}};
    case 'artifact':
      return {kind: 'artifact', selector: {artifactKey: parts[1] ?? legacy.ref}};
    case 'field':
    case 'hyperparam':
    default:
      // Legacy hyperparam has no graph-aware equivalent; preserve as a field
      // selector (best-effort) and let the report be flagged for review.
      return {kind: 'field', selector: {field: legacy.ref}};
  }
};

const edgeExists = (edges: readonly ClearpipeFlowEdge[], source: string, target: string): boolean =>
  edges.some((edge) => edge.source === source && edge.target === target);

/** Migrate a decoded flow graph in place-safe, additive fashion. */
export const migrateFlowGraph = (input: ClearpipeFlowGraph): FlowMigrationResult => {
  let changed = false;
  const taskNodesNeedingSplit: string[] = [];
  const reportsWithExternalSources: string[] = [];

  // Pass 1: AutoScaler runtime defaults + Task nodes -> baseTaskId.
  const baseTaskToNode = new Map<string, string>();
  const nodes: ClearpipeFlowNode[] = input.nodes.map((node) => {
    if (node.type === 'autoscaler') {
      const config = {...node.config};
      let autoscalerChanged = false;
      if (!String(config['workload_type'] ?? config['workloadType'] ?? '').trim()) {
        config['workload_type'] = 'training';
        autoscalerChanged = true;
      }
      if (!String(config['command'] ?? '').trim()) {
        config['command'] = 'clearml-agent daemon';
        autoscalerChanged = true;
      }
      if (config['autoscalerTimeoutSeconds'] == null) {
        config['autoscalerTimeoutSeconds'] = 600;
        autoscalerChanged = true;
      }
      if (autoscalerChanged) {
        changed = true;
        return {...node, config};
      }
      return node;
    }
    if (node.type !== 'task') return node;
    const config = {...node.config};
    const legacyIds = asStringArray(config['taskIds']);
    const existingBase = typeof config['baseTaskId'] === 'string' ? (config['baseTaskId'] as string) : '';

    if (existingBase) {
      baseTaskToNode.set(existingBase, node.id);
      return node;
    }
    if (legacyIds.length === 1) {
      config['baseTaskId'] = legacyIds[0];
      delete config['taskIds'];
      baseTaskToNode.set(legacyIds[0], node.id);
      changed = true;
      return {...node, config};
    }
    if (legacyIds.length > 1) {
      config['requiresSplit'] = true;
      taskNodesNeedingSplit.push(node.id);
      changed = true;
      return {...node, config};
    }
    return node;
  });

  const addedEdges: ClearpipeFlowEdge[] = [];
  let edgeSeq = 0;

  // Pass 2: Report nodes -> graph-aware reportMappings + source edges.
  const migratedNodes = nodes.map((node) => {
    if (node.type !== 'report') return node;
    const config = {...node.config};

    // Already migrated (graph-aware mappings present) -> leave as-is.
    if (Array.isArray(config['reportMappings']) && (config['reportMappings'] as unknown[]).length) {
      return node;
    }

    const legacyMappings = (config['mappings'] && typeof config['mappings'] === 'object')
      ? (config['mappings'] as Record<string, LegacyReportMapping>)
      : {};
    const artifactSources = asStringArray(config['artifactSources']);

    const reportMappings: ReportSlotMapping[] = [];
    const externalTaskIds = new Set<string>();
    const matchedNodeIds = new Set<string>();

    for (const [slotKey, legacy] of Object.entries(legacyMappings)) {
      if (!legacy || typeof legacy !== 'object' || !legacy.taskId) continue;
      const {kind, selector} = legacyOutput(legacy);
      const sourceNodeId = baseTaskToNode.get(legacy.taskId);
      if (sourceNodeId) {
        matchedNodeIds.add(sourceNodeId);
        reportMappings.push({slotKey, source: {sourceNodeId}, outputKind: kind, selector, required: true, confirmed: true});
      } else {
        externalTaskIds.add(legacy.taskId);
        reportMappings.push({slotKey, source: {externalTaskId: legacy.taskId}, outputKind: kind, selector, required: true, confirmed: true});
      }
    }

    // artifactSources that matched a Task node become connected sources (edges);
    // unmatched ones are preserved as advanced external sources for review.
    const externalSources: string[] = [];
    for (const taskId of artifactSources) {
      const sourceNodeId = baseTaskToNode.get(taskId);
      if (sourceNodeId) matchedNodeIds.add(sourceNodeId);
      else {
        externalTaskIds.add(taskId);
        externalSources.push(taskId);
      }
    }

    // Ensure a Task -> Report edge exists for every matched pipeline source.
    for (const sourceNodeId of matchedNodeIds) {
      if (!edgeExists(input.edges, sourceNodeId, node.id) && !edgeExists(addedEdges, sourceNodeId, node.id)) {
        addedEdges.push({id: `edge_migrated_${edgeSeq++}`, source: sourceNodeId, target: node.id});
      }
    }

    if (!reportMappings.length && !externalSources.length) return node;

    config['reportMappings'] = reportMappings;
    if (externalSources.length) config['externalSources'] = externalSources;
    if (externalTaskIds.size) {
      config['migrationReview'] = true;
      reportsWithExternalSources.push(node.id);
    }
    changed = true;
    return {...node, config};
  });

  if (!changed && !addedEdges.length) {
    return {graph: input, taskNodesNeedingSplit, reportsWithExternalSources, changed: false};
  }

  return {
    graph: {...input, nodes: migratedNodes, edges: [...input.edges, ...addedEdges]},
    taskNodesNeedingSplit,
    reportsWithExternalSources,
    changed: true,
  };
};
