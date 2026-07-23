import {computed, Injectable, signal} from '@angular/core';
import {
  CLEARPIPE_FLOW_NODE_SIZE,
  CLEARPIPE_FLOW_NODE_TYPES,
  ClearpipeFlowBoundary,
  ClearpipeFlowEdge,
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
  ClearpipeFlowNodeType,
  ClearpipeFlowPoint,
  ClearpipeFlowStatus,
  ClearpipeFlowViewport,
  clearpipeFlowNodeMeta,
  emptyClearpipeFlowGraph,
} from './clearpipe-flow.models';

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
  readonly selectedBoundaryId = signal<string | null>(null);
  readonly dirty = signal(false);
  /** Output port of an in-progress connection gesture (drag from a node output). */
  readonly connectingFrom = signal<string | null>(null);

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
    this.graph.set(clone);
    this.selectedNodeId.set(null);
    this.selectedBoundaryId.set(null);
    this.connectingFrom.set(null);
    this.dirty.set(false);
    this.history.set([this.snapshot(clone)]);
    this.historyIndex.set(0);
  }

  reset(): void {
    this.load(emptyClearpipeFlowGraph());
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

  selectNode(nodeId: string | null): void {
    this.selectedNodeId.set(nodeId);
    if (nodeId) this.selectedBoundaryId.set(null);
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
   * Start a pipeline run from the scheduled entry points and propagate a
   * "running" status through connected nodes. Scheduled nodes flagged
   * `fireWhenStart` fire immediately; edges that leave a boundary stop there.
   */
  startSequence(): void {
    const graph = this.graph();
    const scheduled = graph.nodes.filter(
      (node) => node.type === 'scheduled' && node.config['enabled'] !== false,
    );
    let entries = scheduled
      .filter((node) => node.config['fireWhenStart'] === true)
      .map((node) => node.id);
    if (!entries.length && scheduled.length) entries = scheduled.map((node) => node.id);
    if (!entries.length) {
      const targets = new Set(graph.edges.map((edge) => edge.target));
      entries = graph.nodes.filter((node) => !targets.has(node.id)).map((node) => node.id);
    }

    const outgoing = new Map<string, string[]>();
    graph.edges.forEach((edge) =>
      outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]),
    );
    const statuses = new Map<string, {status: ClearpipeFlowStatus; message?: string}>();
    graph.nodes.forEach((node) => statuses.set(node.id, {status: 'idle'}));
    entries.forEach((id) => statuses.set(id, {status: 'running', message: 'Triggered by schedule'}));

    const queue = [...entries];
    const visited = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      for (const next of outgoing.get(current) ?? []) {
        if (this.crossesBoundary(current, next)) {
          statuses.set(next, {status: 'warning', message: 'Outside boundary \u2014 pipeline stops here'});
          continue;
        }
        if ((statuses.get(next)?.status ?? 'idle') === 'idle') {
          statuses.set(next, {status: 'running', message: 'Queued by pipeline'});
        }
        queue.push(next);
      }
    }

    this.mutate((current) => ({
      ...current,
      nodes: current.nodes.map((node) => {
        const next = statuses.get(node.id) ?? {status: 'idle' as ClearpipeFlowStatus};
        return {...node, status: next.status, statusMessage: next.message};
      }),
    }));
  }

  /** True when the edge source sits inside a boundary that excludes the target. */
  private crossesBoundary(sourceId: string, targetId: string): boolean {
    const graph = this.graph();
    if (!graph.boundaries.length) return false;
    const source = graph.nodes.find((node) => node.id === sourceId);
    const target = graph.nodes.find((node) => node.id === targetId);
    if (!source || !target) return false;
    return graph.boundaries.some(
      (boundary) => this.boundaryContains(boundary, source) && !this.boundaryContains(boundary, target),
    );
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
