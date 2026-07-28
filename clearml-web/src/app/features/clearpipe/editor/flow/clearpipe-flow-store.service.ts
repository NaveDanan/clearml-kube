import {computed, Injectable, signal} from '@angular/core';
import {
  CLEARPIPE_FLOW_NODE_SIZE,
  CLEARPIPE_FLOW_NODE_TYPES,
  ClearpipeFlowBoundary,
  ClearpipeFlowEdge,
  ClearpipeFlowEdgeRule,
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
  ClearpipeFlowNodeType,
  ClearpipeFlowPoint,
  ClearpipeFlowRuntimeNode,
  ClearpipeFlowStatus,
  ClearpipeFlowViewport,
  clearpipeFlowNodeMeta,
  emptyClearpipeFlowGraph,
} from './clearpipe-flow.models';
import {ReportSlotMapping} from './clearpipe-report-mapping';
import {flowBoundaryExecutionPlan} from './clearpipe-flow-boundaries';

interface FlowSnapshot {
  nodes: ClearpipeFlowNode[];
  edges: ClearpipeFlowEdge[];
  boundaries: ClearpipeFlowBoundary[];
}

/**
 * Signals-based store for the clearpipe-main-style flow editor. Owns the graph,
 * selection, viewport, connection gesture, dirty flag and undo/redo history.
 */
@Injectable()
export class ClearpipeFlowStoreService {
  readonly graph = signal<ClearpipeFlowGraph>(emptyClearpipeFlowGraph());
  readonly selectedNodeId = signal<string | null>(null);
  /** Full multi-selection set (canvas marquee / ctrl+click). The `selectedNodeId`
   *  above is the "primary" node the inspector configures. */
  readonly selectedNodeIds = signal<ReadonlySet<string>>(new Set());
  readonly selectedBoundaryId = signal<string | null>(null);
  readonly dirty = signal(false);
  /** Output port of an in-progress connection gesture (drag from a node output). */
  readonly connectingFrom = signal<string | null>(null);

  /** When true the pipeline is available to run (schedulers fire as programmed). */
  readonly activated = signal(false);
  /** True while a real backend run is in progress (controller not yet terminal). */
  readonly running = signal(false);
  /** The controller run task id of the in-progress/last run, for status polling. */
  readonly runTaskId = signal<string | null>(null);
  /** Node currently hovered on the canvas; transient and never persisted. */
  readonly hoveredNodeId = signal<string | null>(null);
  /** Last authorized runtime record for each graph node. */
  readonly runtimeNodes = signal<Map<string, ClearpipeFlowRuntimeNode>>(new Map());
  readonly runtimeUpdatedAt = signal<string | null>(null);

  private readonly history = signal<FlowSnapshot[]>([]);
  private readonly historyIndex = signal(-1);

  readonly nodes = computed(() => this.graph().nodes);
  readonly edges = computed(() => this.graph().edges);
  readonly boundaries = computed(() => this.graph().boundaries);
  readonly viewport = computed(() => this.graph().viewport);
  readonly selectedBoundary = computed(
    () => this.graph().boundaries.find((boundary) => boundary.id === this.selectedBoundaryId()) ?? null,
  );
  /** Ids of nodes whose center currently sits inside at least one boundary. */
  readonly containedNodeIds = computed(() => {
    const graph = this.graph();
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (graph.boundaries.some((boundary) => this.boundaryContains(boundary, node))) ids.add(node.id);
    }
    return ids;
  });
  readonly selectedNode = computed(
    () => this.graph().nodes.find((node) => node.id === this.selectedNodeId()) ?? null,
  );
  readonly canUndo = computed(() => this.historyIndex() > 0);
  readonly canRedo = computed(() => this.historyIndex() >= 0 && this.historyIndex() < this.history().length - 1);
  readonly isEmpty = computed(() => this.graph().nodes.length === 0);

  load(graph: ClearpipeFlowGraph): void {
    const clone = structuredClone(graph);
    if (!Array.isArray(clone.boundaries)) clone.boundaries = [];
    this.resetRun();
    this.graph.set(clone);
    this.selectedNodeId.set(null);
    this.selectedNodeIds.set(new Set());
    this.selectedBoundaryId.set(null);
    this.connectingFrom.set(null);
    this.hoveredNodeId.set(null);
    this.activated.set(clone.activated === true);
    this.dirty.set(false);
    this.history.set([this.snapshot(clone)]);
    this.historyIndex.set(0);
  }

  reset(): void {
    this.load(emptyClearpipeFlowGraph());
  }

  /**
   * Set whether the pipeline is available to run. Activation is persisted
   * server-side by the editor (clearpipe.set_activation); it is authoring
   * metadata, not a graph change, so it never marks the graph dirty. The value
   * is mirrored into the graph so JSON export/import carries it too.
   */
  setActivated(value: boolean): void {
    this.activated.set(value);
    if (this.graph().activated === value) return;
    this.graph.update((graph) => ({...graph, activated: value}));
  }

  markSaved(graph?: ClearpipeFlowGraph): void {
    if (graph) this.graph.set(structuredClone(graph));
    this.dirty.set(false);
  }

  updateMetadata(patch: Partial<Pick<ClearpipeFlowGraph, 'name' | 'description'>>): void {
    this.graph.update((graph) => ({...graph, ...patch}));
    this.dirty.set(true);
  }

  addNode(type: ClearpipeFlowNodeType, position: ClearpipeFlowPoint): string {
    const meta = clearpipeFlowNodeMeta(type);
    const id = `${type}-${crypto.randomUUID()}`;
    this.mutate((graph) => ({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id,
          type,
          position,
          label: meta.label,
          description: meta.description,
          status: 'idle' as ClearpipeFlowStatus,
          config: structuredClone(meta.defaults),
        },
      ],
    }));
    this.selectedNodeId.set(id);
    return id;
  }

  moveNode(nodeId: string, position: ClearpipeFlowPoint): void {
    this.mutate(
      (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) => (node.id === nodeId ? {...node, position} : node)),
      }),
      false,
    );
  }

  /** Commit a move gesture into the undo history without re-writing positions. */
  commitMove(): void {
    this.pushSnapshot();
    this.dirty.set(true);
  }

  updateNode(nodeId: string, patch: Partial<ClearpipeFlowNode>): void {
    this.mutate((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === nodeId ? {...node, ...patch} : node)),
    }));
  }

  updateNodeConfig(nodeId: string, key: string, value: unknown): void {
    const node = this.graph().nodes.find((item) => item.id === nodeId);
    if (!node) return;
    this.updateNode(nodeId, {config: {...node.config, [key]: value}});
  }

  setNodeStatus(nodeId: string, status: ClearpipeFlowStatus, statusMessage?: string): void {
    this.updateNode(nodeId, {status, statusMessage});
  }

  removeNode(nodeId: string): void {
    this.mutate((graph) => ({
      ...graph,
      nodes: graph.nodes.filter((node) => node.id !== nodeId),
      edges: graph.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
    }));
    if (this.selectedNodeId() === nodeId) this.selectedNodeId.set(null);
    if (this.selectedNodeIds().has(nodeId)) {
      const next = new Set(this.selectedNodeIds());
      next.delete(nodeId);
      this.selectedNodeIds.set(next);
    }
  }

  duplicateNode(nodeId: string): string | null {
    const node = this.graph().nodes.find((item) => item.id === nodeId);
    if (!node) return null;
    const copy = structuredClone(node);
    copy.id = `${copy.type}-${crypto.randomUUID()}`;
    copy.label = `${copy.label} (copy)`;
    copy.position = {x: copy.position.x + 40, y: copy.position.y + 40};
    this.mutate((graph) => ({...graph, nodes: [...graph.nodes, copy]}));
    this.selectedNodeId.set(copy.id);
    return copy.id;
  }

  /**
   * Split a legacy multi-task Task node into one Task node per base task. Each
   * new node inherits the ordering dependencies (in/out edges) of the original,
   * and Report mappings that referenced one of the split task ids (as advanced
   * external-task sources) are rewritten to bind the matching new pipeline node.
   * Returns the ids of the created nodes.
   */
  splitTaskNode(nodeId: string): string[] {
    const graph = this.graph();
    const original = graph.nodes.find((item) => item.id === nodeId);
    if (!original || original.type !== 'task') return [];
    const taskIds = Array.isArray(original.config['taskIds'])
      ? (original.config['taskIds'] as unknown[]).filter((value): value is string => typeof value === 'string' && !!value)
      : [];
    if (taskIds.length < 2) return [];

    const defaults = clearpipeFlowNodeMeta('task').defaults;
    const newNodes: ClearpipeFlowNode[] = taskIds.map((taskId, index) => ({
      id: `task-${crypto.randomUUID()}`,
      type: 'task',
      position: {
        x: original.position.x,
        y: original.position.y + index * (CLEARPIPE_FLOW_NODE_SIZE.height + 24),
      },
      label: `${original.label} ${index + 1}`,
      status: 'idle' as ClearpipeFlowStatus,
      config: {
        ...structuredClone(defaults),
        baseTaskId: taskId,
        project: original.config['project'] ?? '',
        queue: original.config['queue'] ?? '',
      },
    }));
    const taskIdToNewNode = new Map(taskIds.map((taskId, index) => [taskId, newNodes[index].id]));
    const newNodeIds = new Set(newNodes.map((node) => node.id));

    // Duplicate the original node's ordering edges onto every new node.
    const newEdges: ClearpipeFlowEdge[] = [];
    const edgeExists = (source: string, target: string): boolean =>
      graph.edges.some((edge) => edge.source === source && edge.target === target) ||
      newEdges.some((edge) => edge.source === source && edge.target === target);
    for (const edge of graph.edges) {
      if (edge.source === nodeId) {
        for (const node of newNodes) {
          if (!edgeExists(node.id, edge.target)) newEdges.push({id: `edge-${crypto.randomUUID()}`, source: node.id, target: edge.target});
        }
      } else if (edge.target === nodeId) {
        for (const node of newNodes) {
          if (!edgeExists(edge.source, node.id)) newEdges.push({id: `edge-${crypto.randomUUID()}`, source: edge.source, target: node.id});
        }
      }
    }

    // Rewrite Report mappings that referenced a split task id, and connect them.
    const nodes = graph.nodes.map((node) => {
      if (node.type !== 'report') return node;
      const mappings = Array.isArray(node.config['reportMappings'])
        ? (node.config['reportMappings'] as ReportSlotMapping[])
        : [];
      let changed = false;
      const next = mappings.map((mapping) => {
        const external = mapping.source?.externalTaskId;
        const mappedNode = external ? taskIdToNewNode.get(external) : undefined;
        if (mappedNode) {
          changed = true;
          return {...mapping, source: {sourceNodeId: mappedNode}};
        }
        return mapping;
      });
      for (const mapping of next) {
        const sourceId = mapping.source?.sourceNodeId;
        if (sourceId && newNodeIds.has(sourceId) && !edgeExists(sourceId, node.id)) {
          newEdges.push({id: `edge-${crypto.randomUUID()}`, source: sourceId, target: node.id});
        }
      }
      if (!changed) return node;
      const config = {...node.config, reportMappings: next};
      delete (config as Record<string, unknown>)['migrationReview'];
      return {...node, config};
    });

    this.mutate((current) => ({
      ...current,
      nodes: [...nodes.filter((node) => node.id !== nodeId), ...newNodes],
      edges: [...current.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId), ...newEdges],
    }));
    this.selectedNodeId.set(newNodes[0].id);
    return newNodes.map((node) => node.id);
  }

  selectNode(nodeId: string | null): void {
    this.selectedNodeId.set(nodeId);
    this.selectedNodeIds.set(nodeId ? new Set([nodeId]) : new Set());
    if (nodeId) this.selectedBoundaryId.set(null);
  }

  /** Toggle a node in the multi-selection (ctrl/shift+click). Keeps the toggled
   *  node (or another remaining member) as the inspector's primary selection. */
  toggleNodeSelection(nodeId: string): void {
    const next = new Set(this.selectedNodeIds());
    if (next.has(nodeId)) {
      next.delete(nodeId);
    } else {
      next.add(nodeId);
    }
    this.selectedNodeIds.set(next);
    if (next.has(nodeId)) {
      this.selectedNodeId.set(nodeId);
      this.selectedBoundaryId.set(null);
    } else if (this.selectedNodeId() === nodeId) {
      this.selectedNodeId.set(next.size ? [...next][next.size - 1] : null);
    }
  }

  /** Replace the whole multi-selection (marquee). Primary = last id. */
  setSelection(nodeIds: readonly string[]): void {
    const set = new Set(nodeIds);
    this.selectedNodeIds.set(set);
    this.selectedNodeId.set(nodeIds.length ? nodeIds[nodeIds.length - 1] : null);
    if (nodeIds.length) this.selectedBoundaryId.set(null);
  }

  /** True when the node is part of the current multi-selection. */
  isNodeSelected(nodeId: string): boolean {
    return this.selectedNodeIds().has(nodeId);
  }

  /** Move several nodes at once (used to drag a whole multi-selection). */
  moveNodes(moves: readonly {id: string; position: ClearpipeFlowPoint}[]): void {
    const byId = new Map(moves.map((move) => [move.id, move.position]));
    this.mutate(
      (graph) => ({
        ...graph,
        nodes: graph.nodes.map((node) => (byId.has(node.id) ? {...node, position: byId.get(node.id)!} : node)),
      }),
      false,
    );
  }

  /** Delete every node in the multi-selection (and their edges) in one step. */
  removeSelectedNodes(): void {
    const ids = this.selectedNodeIds();
    if (!ids.size) return;
    this.mutate((graph) => ({
      ...graph,
      nodes: graph.nodes.filter((node) => !ids.has(node.id)),
      edges: graph.edges.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)),
    }));
    this.selectedNodeId.set(null);
    this.selectedNodeIds.set(new Set());
  }

  // --- grouping ------------------------------------------------------------
  /** All node ids sharing a group with the given node (or just itself). */
  groupMemberIds(nodeId: string): string[] {
    const node = this.graph().nodes.find((item) => item.id === nodeId);
    if (!node?.groupId) return [nodeId];
    const groupId = node.groupId;
    return this.graph().nodes.filter((item) => item.groupId === groupId).map((item) => item.id);
  }

  /** True when the current selection contains at least one grouped node. */
  readonly hasGroupedSelection = computed(() => {
    const ids = this.selectedNodeIds();
    return this.graph().nodes.some((node) => ids.has(node.id) && !!node.groupId);
  });

  /** Group all selected nodes under one new shared group id. */
  groupSelectedNodes(): void {
    const ids = this.selectedNodeIds();
    if (ids.size < 2) return;
    const groupId = `group-${crypto.randomUUID()}`;
    this.mutate((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => (ids.has(node.id) ? {...node, groupId} : node)),
    }));
  }

  /** Remove the group binding from every group touched by the selection. */
  ungroupSelectedNodes(): void {
    const ids = this.selectedNodeIds();
    if (!ids.size) return;
    const groups = new Set<string>();
    this.graph().nodes.forEach((node) => {
      if (ids.has(node.id) && node.groupId) groups.add(node.groupId);
    });
    if (!groups.size) return;
    this.mutate((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        if (node.groupId && groups.has(node.groupId)) {
          const {groupId: _drop, ...rest} = node;
          return rest;
        }
        return node;
      }),
    }));
  }

  // --- clipboard (copy / cut / paste / duplicate) --------------------------
  /** In-memory clipboard of copied/cut nodes + their internal edges. */
  readonly clipboard = signal<{nodes: ClearpipeFlowNode[]; edges: ClearpipeFlowEdge[]} | null>(null);
  readonly hasClipboard = computed(() => !!this.clipboard()?.nodes.length);

  /** Copy the selected nodes and the edges wholly contained by that selection. */
  copySelectedNodes(): void {
    const ids = this.selectedNodeIds();
    if (!ids.size) return;
    const nodes = this.graph().nodes.filter((node) => ids.has(node.id));
    const edges = this.graph().edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    this.clipboard.set({nodes: structuredClone(nodes), edges: structuredClone(edges)});
  }

  /** Copy the selection then delete it. */
  cutSelectedNodes(): void {
    this.copySelectedNodes();
    this.removeSelectedNodes();
  }

  /** Paste the clipboard at an offset; the pasted nodes become the selection. */
  pasteClipboard(offset = 40): string[] {
    const clip = this.clipboard();
    if (!clip?.nodes.length) return [];
    return this.insertClones(clip.nodes, clip.edges, offset);
  }

  /** Duplicate the current selection in place (offset); clones become selected. */
  duplicateSelectedNodes(offset = 40): string[] {
    const ids = this.selectedNodeIds();
    if (!ids.size) return [];
    const nodes = this.graph().nodes.filter((node) => ids.has(node.id));
    const edges = this.graph().edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));
    return this.insertClones(nodes, edges, offset);
  }

  /** Clone nodes (fresh ids + remapped groups/edges), insert them, and select them. */
  private insertClones(
    sourceNodes: readonly ClearpipeFlowNode[],
    sourceEdges: readonly ClearpipeFlowEdge[],
    offset: number,
  ): string[] {
    const idMap = new Map<string, string>();
    const groupMap = new Map<string, string>();
    const clones = sourceNodes.map((node) => {
      const id = `${node.type}-${crypto.randomUUID()}`;
      idMap.set(node.id, id);
      const clone: ClearpipeFlowNode = {
        ...structuredClone(node),
        id,
        position: {x: node.position.x + offset, y: node.position.y + offset},
        status: 'idle' as ClearpipeFlowStatus,
        statusMessage: undefined,
      };
      if (node.groupId) {
        if (!groupMap.has(node.groupId)) groupMap.set(node.groupId, `group-${crypto.randomUUID()}`);
        clone.groupId = groupMap.get(node.groupId);
      }
      return clone;
    });
    const newEdges: ClearpipeFlowEdge[] = sourceEdges
      .filter((edge) => idMap.has(edge.source) && idMap.has(edge.target))
      .map((edge) => ({
        id: `edge-${crypto.randomUUID()}`,
        source: idMap.get(edge.source)!,
        target: idMap.get(edge.target)!,
        ...(edge.rules?.length ? {rules: structuredClone(edge.rules)} : {}),
      }));
    this.mutate((graph) => ({...graph, nodes: [...graph.nodes, ...clones], edges: [...graph.edges, ...newEdges]}));
    const newIds = clones.map((clone) => clone.id);
    this.setSelection(newIds);
    return newIds;
  }

  // --- boundaries ----------------------------------------------------------
  /** Create a resizable boundary region at the given top-left position. */
  addBoundary(position: ClearpipeFlowPoint, size?: {width: number; height: number}): string {
    const id = `boundary-${crypto.randomUUID()}`;
    const count = this.graph().boundaries.length + 1;
    this.mutate((graph) => ({
      ...graph,
      boundaries: [
        ...graph.boundaries,
        {
          id,
          position,
          width: size?.width ?? 320,
          height: size?.height ?? 220,
          label: `Boundary ${count}`,
          onReach: 'stop',
        },
      ],
    }));
    this.selectBoundary(id);
    return id;
  }

  /** Nodes whose center currently sits inside the given boundary. */
  nodesInsideBoundary(boundaryId: string | null): ClearpipeFlowNode[] {
    if (!boundaryId) return [];
    const graph = this.graph();
    const boundary = graph.boundaries.find((item) => item.id === boundaryId);
    if (!boundary) return [];
    return graph.nodes.filter((node) => this.boundaryContains(boundary, node));
  }

  moveBoundary(id: string, position: ClearpipeFlowPoint): void {
    this.mutate(
      (graph) => ({
        ...graph,
        boundaries: graph.boundaries.map((b) => (b.id === id ? {...b, position} : b)),
      }),
      false,
    );
  }

  resizeBoundary(id: string, size: {width: number; height: number}): void {
    this.mutate(
      (graph) => ({
        ...graph,
        boundaries: graph.boundaries.map((b) =>
          b.id === id ? {...b, width: Math.max(140, size.width), height: Math.max(100, size.height)} : b,
        ),
      }),
      false,
    );
  }

  /** Commit a boundary move/resize gesture into the undo history. */
  commitBoundary(): void {
    this.pushSnapshot();
    this.dirty.set(true);
  }

  updateBoundary(id: string, patch: Partial<Omit<ClearpipeFlowBoundary, 'id'>>): void {
    this.mutate((graph) => ({
      ...graph,
      boundaries: graph.boundaries.map((b) => (b.id === id ? {...b, ...patch} : b)),
    }));
  }

  removeBoundary(id: string): void {
    this.mutate((graph) => ({...graph, boundaries: graph.boundaries.filter((b) => b.id !== id)}));
    if (this.selectedBoundaryId() === id) this.selectedBoundaryId.set(null);
  }

  selectBoundary(id: string | null): void {
    this.selectedBoundaryId.set(id);
    if (id) this.selectedNodeId.set(null);
  }

  /** Create an ordering edge source -> target if it is valid (no dup, no cycle, no self). */
  connect(source: string, target: string): boolean {
    if (source === target) return false;
    const graph = this.graph();
    const ids = new Set(graph.nodes.map((node) => node.id));
    if (!ids.has(source) || !ids.has(target)) return false;
    if (graph.edges.some((edge) => edge.source === source && edge.target === target)) return false;
    if (this.hasPath(target, source)) return false;
    this.mutate((current) => ({
      ...current,
      edges: [...current.edges, {id: `edge-${crypto.randomUUID()}`, source, target}],
    }));
    return true;
  }

  removeEdge(edgeId: string): void {
    this.mutate((graph) => ({...graph, edges: graph.edges.filter((edge) => edge.id !== edgeId)}));
  }

  // --- edge rules ----------------------------------------------------------
  /** Add a conditional routing rule to an edge and return its id. */
  addEdgeRule(edgeId: string, rule?: Partial<ClearpipeFlowEdgeRule>): string {
    const id = `rule-${crypto.randomUUID()}`;
    const newRule: ClearpipeFlowEdgeRule = {
      id,
      label: rule?.label,
      conditions: rule?.conditions ?? [],
      action: rule?.action ?? 'continue',
    };
    this.mutate((graph) => ({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === edgeId ? {...edge, rules: [...(edge.rules ?? []), newRule]} : edge,
      ),
    }));
    return id;
  }

  /** Patch an existing edge rule (conditions / action / label). */
  updateEdgeRule(edgeId: string, ruleId: string, patch: Partial<Omit<ClearpipeFlowEdgeRule, 'id'>>): void {
    this.mutate((graph) => ({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === edgeId
          ? {...edge, rules: (edge.rules ?? []).map((rule) => (rule.id === ruleId ? {...rule, ...patch} : rule))}
          : edge,
      ),
    }));
  }

  removeEdgeRule(edgeId: string, ruleId: string): void {
    this.mutate((graph) => ({
      ...graph,
      edges: graph.edges.map((edge) =>
        edge.id === edgeId ? {...edge, rules: (edge.rules ?? []).filter((rule) => rule.id !== ruleId)} : edge,
      ),
    }));
  }

  /** All ancestor nodes reachable by following incoming edges, nearest-first (BFS). */
  ancestorNodes(nodeId: string): ClearpipeFlowNode[] {
    const graph = this.graph();
    const incoming = new Map<string, string[]>();
    graph.edges.forEach((edge) =>
      incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]),
    );
    const result: ClearpipeFlowNode[] = [];
    const visited = new Set<string>([nodeId]);
    const queue = [...(incoming.get(nodeId) ?? [])];
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      const node = graph.nodes.find((item) => item.id === current);
      if (node) result.push(node);
      queue.push(...(incoming.get(current) ?? []));
    }
    return result;
  }

  beginConnection(nodeId: string): void {
    this.connectingFrom.set(nodeId);
  }

  completeConnection(target: string): boolean {
    const source = this.connectingFrom();
    this.connectingFrom.set(null);
    if (!source) return false;
    return this.connect(source, target);
  }

  cancelConnection(): void {
    this.connectingFrom.set(null);
  }

  setViewport(viewport: ClearpipeFlowViewport): void {
    this.graph.update((graph) => ({...graph, viewport}));
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.restore(this.historyIndex() - 1);
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.restore(this.historyIndex() + 1);
  }

  /**
   * Begin tracking a real backend run. Marks the pipeline running and sets every
   * node to "pending" until the first execution snapshot arrives. Status updates
   * are transient UI only: they never touch undo history and never mark the graph
   * dirty, so running a pipeline never requires re-saving.
   */
  beginRun(runTaskId: string): void {
    this.runTaskId.set(runTaskId);
    this.running.set(true);
    this.runtimeNodes.set(new Map());
    this.runtimeUpdatedAt.set(null);
    const boundaryPlan = flowBoundaryExecutionPlan(this.graph());
    const pending = new Map<string, {status: ClearpipeFlowStatus; message?: string}>();
    this.graph().nodes.forEach((node) => {
      const boundary = boundaryPlan.excludedByBoundary.get(node.id);
      pending.set(node.id, boundary
        ? {status: 'stopped', message: `Not executed: ${boundary} stops the pipeline.`}
        : {status: 'pending', message: 'Pending'});
    });
    this.applyRunStatuses(pending);
  }

  setHoveredNode(nodeId: string | null): void {
    this.hoveredNodeId.set(nodeId);
  }

  applyRuntimeSnapshot(nodes: readonly ClearpipeFlowRuntimeNode[]): void {
    const next = new Map(this.runtimeNodes());
    for (const node of nodes) next.set(node.graph_node_id, node);
    this.runtimeNodes.set(next);
    this.runtimeUpdatedAt.set(new Date().toISOString());
  }

  /** Re-assert compiler-equivalent boundary stops after a final restored run. */
  applyBoundaryStops(): void {
    const plan = flowBoundaryExecutionPlan(this.graph());
    const stopped = new Map<string, {status: ClearpipeFlowStatus; message?: string}>();
    for (const [nodeId, boundary] of plan.excludedByBoundary) {
      stopped.set(nodeId, {
        status: 'stopped',
        message: `Not executed: ${boundary} stops the pipeline.`,
      });
    }
    if (stopped.size) this.applyRunStatuses(stopped);
  }

  /** Apply real per-node statuses from a backend execution snapshot. */
  applyRunSnapshot(statuses: Map<string, {status: ClearpipeFlowStatus; message?: string}>): void {
    this.applyRunStatuses(statuses);
  }

  /** The controller run reached a terminal state; stop tracking as running. */
  finishRun(): void {
    this.running.set(false);
  }

  /** Mark an interrupted run: any not-yet-finished node becomes "stopped". */
  markRunStopped(): void {
    this.running.set(false);
    const stopped = new Map<string, {status: ClearpipeFlowStatus; message?: string}>();
    this.graph().nodes.forEach((node) => {
      if (node.status === 'pending' || node.status === 'running') {
        stopped.set(node.id, {status: 'stopped', message: 'Stopped'});
      }
    });
    if (stopped.size) this.applyRunStatuses(stopped);
  }

  /** Clear all run state and reset node statuses to idle (on load / new). */
  resetRun(): void {
    this.running.set(false);
    this.runTaskId.set(null);
    this.hoveredNodeId.set(null);
    this.runtimeNodes.set(new Map());
    this.runtimeUpdatedAt.set(null);
    if (this.graph().nodes.every((node) => node.status === 'idle')) return;
    const cleared = new Map<string, {status: ClearpipeFlowStatus}>();
    this.graph().nodes.forEach((node) => cleared.set(node.id, {status: 'idle'}));
    this.applyRunStatuses(cleared);
  }

  /** Apply transient run statuses to the graph without dirtying it or recording
   *  undo history (statuses are never persisted by the save codec). */
  private applyRunStatuses(
    statuses: Map<string, {status: ClearpipeFlowStatus; message?: string}>,
  ): void {
    this.graph.update((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        const next = statuses.get(node.id);
        if (!next) return node;
        return {...node, status: next.status, statusMessage: next.message};
      }),
    }));
  }

  private boundaryContains(boundary: ClearpipeFlowBoundary, node: ClearpipeFlowNode): boolean {
    const cx = node.position.x + CLEARPIPE_FLOW_NODE_SIZE.width / 2;
    const cy = node.position.y + CLEARPIPE_FLOW_NODE_SIZE.height / 2;
    return (
      cx >= boundary.position.x &&
      cx <= boundary.position.x + boundary.width &&
      cy >= boundary.position.y &&
      cy <= boundary.position.y + boundary.height
    );
  }

  private mutate(update: (graph: ClearpipeFlowGraph) => ClearpipeFlowGraph, pushHistory = true): void {
    this.graph.set(update(this.graph()));
    if (pushHistory) this.pushSnapshot();
    this.dirty.set(true);
  }

  private pushSnapshot(): void {
    const graph = this.graph();
    const snapshots = this.history().slice(0, this.historyIndex() + 1);
    snapshots.push(this.snapshot(graph));
    if (snapshots.length > 50) snapshots.shift();
    this.history.set(snapshots);
    this.historyIndex.set(snapshots.length - 1);
  }

  private snapshot(graph: ClearpipeFlowGraph): FlowSnapshot {
    return {
      nodes: structuredClone(graph.nodes),
      edges: structuredClone(graph.edges),
      boundaries: structuredClone(graph.boundaries),
    };
  }

  private restore(index: number): void {
    const snapshot = this.history()[index];
    this.graph.update((graph) => ({
      ...graph,
      nodes: structuredClone(snapshot.nodes),
      edges: structuredClone(snapshot.edges),
      boundaries: structuredClone(snapshot.boundaries),
    }));
    this.historyIndex.set(index);
    this.dirty.set(true);
  }

  private hasPath(source: string, target: string): boolean {
    const outgoing = new Map<string, string[]>();
    this.graph().edges.forEach((edge) =>
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]),
    );
    const pending = [source];
    const visited = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === target) return true;
      if (!visited.has(current)) {
        visited.add(current);
        pending.push(...(outgoing.get(current) ?? []));
      }
    }
    return false;
  }
}

export {CLEARPIPE_FLOW_NODE_TYPES};
