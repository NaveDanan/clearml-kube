import {computed, Injectable, signal} from '@angular/core';
import {
  ClearpipeDefinition,
  ClearpipeEdge,
  ClearpipeNode,
  ClearpipeNodeType,
  ClearpipePoint,
  CLEARPIPE_NODE_TYPES,
  emptyClearpipeDefinition
} from './clearpipe.models';

interface GraphSnapshot { nodes: ClearpipeNode[]; edges: ClearpipeEdge[] }

@Injectable()
export class ClearpipeStateService {
  readonly definition = signal<ClearpipeDefinition>(emptyClearpipeDefinition());
  readonly selectedNodeId = signal<string | null>(null);
  readonly connectionSource = signal<string | null>(null);
  readonly dirty = signal(false);
  readonly loading = signal(false);
  readonly history = signal<GraphSnapshot[]>([]);
  readonly historyIndex = signal(-1);
  readonly selectedNode = computed(() => this.definition().nodes.find(node => node.id === this.selectedNodeId()) ?? null);
  readonly canUndo = computed(() => this.historyIndex() > 0);
  readonly canRedo = computed(() => this.historyIndex() >= 0 && this.historyIndex() < this.history().length - 1);

  load(definition: ClearpipeDefinition): void {
    const normalized = structuredClone(definition);
    this.definition.set(normalized);
    this.selectedNodeId.set(null);
    this.connectionSource.set(null);
    this.dirty.set(false);
    this.history.set([{nodes: structuredClone(normalized.nodes), edges: structuredClone(normalized.edges)}]);
    this.historyIndex.set(0);
  }

  markSaved(definition: ClearpipeDefinition): void {
    this.definition.set(structuredClone(definition));
    this.dirty.set(false);
  }

  updateMetadata(patch: Partial<ClearpipeDefinition>): void {
    this.definition.update(value => ({...value, ...patch}));
    this.dirty.set(true);
  }

  addNode(type: ClearpipeNodeType, position: ClearpipePoint): string {
    const meta = CLEARPIPE_NODE_TYPES.find(item => item.type === type)!;
    const id = `${type}-${crypto.randomUUID()}`;
    this.mutateGraph(definition => ({
      ...definition,
      nodes: [...definition.nodes, {
        id,
        type,
        position,
        label: meta.label,
        description: meta.description,
        config: structuredClone(meta.defaults),
      }]
    }));
    this.selectedNodeId.set(id);
    return id;
  }

  moveNode(nodeId: string, position: ClearpipePoint): void {
    this.mutateGraph(definition => ({
      ...definition,
      nodes: definition.nodes.map(node => node.id === nodeId ? {...node, position} : node)
    }));
  }

  updateNode(nodeId: string, patch: Partial<ClearpipeNode>): void {
    this.mutateGraph(definition => ({
      ...definition,
      nodes: definition.nodes.map(node => node.id === nodeId ? {...node, ...patch} : node)
    }));
  }

  updateNodeConfig(nodeId: string, key: string, value: unknown): void {
    const node = this.definition().nodes.find(item => item.id === nodeId);
    if (node) {
      this.updateNode(nodeId, {config: {...node.config, [key]: value}});
    }
  }

  removeNode(nodeId: string): void {
    this.mutateGraph(definition => ({
      ...definition,
      nodes: definition.nodes.filter(node => node.id !== nodeId),
      edges: definition.edges.filter(edge => edge.source !== nodeId && edge.target !== nodeId),
    }));
    this.selectedNodeId.set(null);
  }

  duplicateNode(nodeId: string): void {
    const node = this.definition().nodes.find(item => item.id === nodeId);
    if (!node) return;
    const copy = structuredClone(node);
    copy.id = `${copy.type}-${crypto.randomUUID()}`;
    copy.label = `${copy.label} (copy)`;
    copy.position = {x: copy.position.x + 32, y: copy.position.y + 32};
    this.mutateGraph(definition => ({...definition, nodes: [...definition.nodes, copy]}));
    this.selectedNodeId.set(copy.id);
  }

  selectConnectionNode(nodeId: string): void {
    const source = this.connectionSource();
    if (!source) {
      if (this.definition().nodes.some(node => node.id === nodeId)) this.connectionSource.set(nodeId);
      return;
    }
    const nodeIds = new Set(this.definition().nodes.map(node => node.id));
    if (source !== nodeId && nodeIds.has(source) && nodeIds.has(nodeId) &&
      !this.definition().edges.some(edge => edge.source === source && edge.target === nodeId) &&
      !this.hasPath(nodeId, source)) {
      this.mutateGraph(definition => ({...definition, edges: [...definition.edges, {
        id: `edge-${crypto.randomUUID()}`,
        source,
        target: nodeId,
      }]}));
    }
    this.connectionSource.set(null);
  }

  removeEdge(edgeId: string): void {
    this.mutateGraph(definition => ({...definition, edges: definition.edges.filter(edge => edge.id !== edgeId)}));
  }

  setViewport(viewport: ClearpipeDefinition['viewport']): void {
    this.definition.update(value => ({...value, viewport}));
  }

  undo(): void {
    if (!this.canUndo()) return;
    this.restoreSnapshot(this.historyIndex() - 1);
  }

  redo(): void {
    if (!this.canRedo()) return;
    this.restoreSnapshot(this.historyIndex() + 1);
  }

  private mutateGraph(update: (definition: ClearpipeDefinition) => ClearpipeDefinition): void {
    const definition = update(this.definition());
    this.definition.set(definition);
    const snapshots = this.history().slice(0, this.historyIndex() + 1);
    snapshots.push({nodes: structuredClone(definition.nodes), edges: structuredClone(definition.edges)});
    if (snapshots.length > 50) snapshots.shift();
    this.history.set(snapshots);
    this.historyIndex.set(snapshots.length - 1);
    this.dirty.set(true);
  }

  private restoreSnapshot(index: number): void {
    const snapshot = this.history()[index];
    this.definition.update(value => ({...value, nodes: structuredClone(snapshot.nodes), edges: structuredClone(snapshot.edges)}));
    this.historyIndex.set(index);
    this.dirty.set(true);
    this.selectedNodeId.set(null);
  }

  private hasPath(source: string, target: string): boolean {
    const outgoing = new Map<string, string[]>();
    this.definition().edges.forEach(edge => outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]));
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
