import {computed, effect, inject, Injectable, signal} from '@angular/core';
import {GraphCommandResult, GraphStoreService} from '../../domain/graph-store.service';
import {GraphBinding, GraphNode, GraphV2, GraphVisual, JsonValue, Point} from '../../domain/graph-v2.types';
import {ClearpipeSemanticEdgeController, SemanticEdgeCommandResult} from '../edges/clearpipe-semantic-edge.controller';
import {assistedLayout, snapPoint} from './deterministic-layout';

export interface ClearpipeClipboardPayload {
  readonly nodes: readonly GraphNode[];
  readonly bindings: readonly GraphBinding[];
}

interface HistoryEntry {
  readonly label: string;
  readonly before: GraphV2;
  readonly after: GraphV2;
  readonly coalesceKey?: string;
}

const clone = <T>(value: T): T => structuredClone(value);
const isInternalBinding = (binding: GraphBinding, nodeIds: ReadonlySet<string>): boolean => {
  const internalEndpoint = (endpoint: GraphBinding['source'] | GraphBinding['target']): boolean =>
    (endpoint.kind === 'node' || endpoint.kind === 'port') && nodeIds.has(endpoint.node_id);
  return internalEndpoint(binding.source) && internalEndpoint(binding.target)
    && (binding.kind !== 'inferred' || nodeIds.has(binding.derived_from.node_id));
};
const safeConfiguration = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(safeConfiguration);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !/(secret|password|token|credential)/i.test(key))
    .map(([key, item]) => [key, safeConfiguration(item)]));
};
const scrubNode = (node: GraphNode): GraphNode => node.kind === 'task'
  ? {...clone(node), configuration: safeConfiguration(node.configuration) as typeof node.configuration}
  : {...clone(node), configuration: safeConfiguration(node.configuration) as typeof node.configuration};

/**
 * CP-27's in-memory command history. It owns no graph state: every replay uses
 * GraphStore commands and semantic edge operations return through CP-20.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeAdvancedEditorOperationsService {
  private readonly store = inject(GraphStoreService);
  private readonly edges = inject(ClearpipeSemanticEdgeController);
  private readonly history = signal<readonly HistoryEntry[]>([]);
  private readonly cursor = signal(0);
  private readonly clipboardState = signal<ClearpipeClipboardPayload | null>(null);
  private readonly selectionState = signal<readonly string[]>([]);
  private readonly historyStale = signal(false);
  private observedGraph = this.store.graph();

  readonly selectedNodeIds = this.selectionState.asReadonly();
  readonly clipboard = this.clipboardState.asReadonly();
  readonly canUndo = computed(() => !this.historyStale() && this.cursor() > 0);
  readonly canRedo = computed(() => !this.historyStale() && this.cursor() < this.history().length);

  constructor() {
    effect(() => this.invalidateForGraph(this.store.graph()));
  }

  select(nodeId: string, additive = false): void {
    this.synchronizeGraphState();
    if (!this.store.node(nodeId)) return;
    const selected = additive ? new Set(this.selectionState()) : new Set<string>();
    if (additive && selected.has(nodeId)) selected.delete(nodeId);
    else selected.add(nodeId);
    this.setSelection([...selected], nodeId);
  }

  selectAll(): void {
    this.synchronizeGraphState();
    const ids = this.store.nodes().map(node => node.id);
    this.setSelection(ids, ids[0] ?? null);
  }

  clearSelection(): void {
    this.synchronizeGraphState();
    this.setSelection([], null);
  }

  perform<T extends GraphCommandResult>(label: string, operation: () => T, coalesceKey?: string): T {
    this.synchronizeGraphState();
    const before = this.snapshot();
    const result = operation();
    if (result.ok && result.changed) this.record(label, before, coalesceKey);
    return result;
  }

  performSemantic(label: string, operation: () => SemanticEdgeCommandResult): SemanticEdgeCommandResult {
    this.synchronizeGraphState();
    const before = this.snapshot();
    const result = operation();
    if (result.command?.ok && result.command.changed) this.record(label, before);
    return result;
  }

  moveNodes(nodeIds: readonly string[], delta: Point, snap = false, coalesceKey?: string): GraphCommandResult {
    const ids = nodeIds.filter(id => !!this.store.node(id));
    return this.perform('move-nodes', () => this.store.runTransaction('move-nodes', () => {
      ids.forEach(id => {
        const position = this.store.node(id)!.visual.position;
        const next = {x: position.x + delta.x, y: position.y + delta.y};
        this.store.setNodePosition(id, snap ? snapPoint(next) : next);
      });
    }), coalesceKey);
  }

  configureNode(nodeId: string, patch: Record<string, JsonValue | undefined>): GraphCommandResult {
    return this.perform('configure-node', () => this.store.updateNodeConfiguration(nodeId, patch));
  }

  setViewport(viewport: GraphVisual, label = 'set-viewport', coalesceKey?: string): GraphCommandResult {
    return this.perform(label, () => this.store.setViewport(viewport), coalesceKey);
  }

  deleteSelected(): GraphCommandResult {
    const ids = this.selectionState();
    const result = this.perform('delete-nodes', () => this.store.runTransaction('delete-nodes', () => {
      ids.forEach(id => this.store.removeNode(id));
    }));
    if (result.ok) this.clearSelection();
    return result;
  }

  copy(): ClearpipeClipboardPayload | null {
    this.synchronizeGraphState();
    const selected = new Set(this.selectionState());
    const nodes = this.store.nodes().filter(node => selected.has(node.id)).map(scrubNode);
    if (!nodes.length) return null;
    const bindings = this.store.bindings().filter(binding => {
      return isInternalBinding(binding, selected);
    }).map(clone);
    const payload = {nodes, bindings};
    this.clipboardState.set(payload);
    return payload;
  }

  duplicate(): GraphCommandResult {
    return this.paste(this.copy() ?? undefined, {x: 32, y: 32}, 'duplicate');
  }

  paste(payload = this.clipboardState(), offset: Point = {x: 32, y: 32}, label = 'paste'): GraphCommandResult {
    this.synchronizeGraphState();
    if (!payload?.nodes.length) return {ok: true, changed: false, command: label, errors: []};
    const before = this.snapshot();
    const nodeIds = new Set(this.store.nodes().map(node => node.id));
    const names = new Set(this.store.nodes().map(node => node.name));
    const bindingIds = new Set(this.store.bindings().map(binding => binding.id));
    const idMap = new Map<string, string>();
    payload.nodes.forEach(node => idMap.set(node.id, nextStableId(node.id, nodeIds)));
    const bindings = payload.bindings.flatMap(binding => {
      const remapped = remapBinding(binding, idMap, bindingIds);
      return remapped ? [remapped] : [];
    });
    const result = this.store.runTransaction(label, () => {
      payload.nodes.forEach(node => {
        const id = idMap.get(node.id)!;
        const copy = scrubNode(node);
        this.store.addNode({...copy, id, name: nextStableId(copy.name, names), visual: {
          ...copy.visual,
          position: {x: copy.visual.position.x + offset.x, y: copy.visual.position.y + offset.y},
        }});
      });
    });
    if (!result.ok) return result;
    for (const binding of bindings) {
      const bindingResult = this.edges.create(binding).command;
      if (!bindingResult?.ok) {
        this.store.runTransaction('discard-invalid-paste', () => {
          [...idMap.values()].forEach(id => this.store.removeNode(id));
        });
        return bindingResult ?? {ok: false, changed: false, command: label, errors: [{
          code: 'invalid_pasted_binding', path: 'graph.bindings', message: 'The pasted connection is no longer valid.',
        }]};
      }
    }
    if (result.ok && result.changed) {
      this.record(label, before);
      this.setSelection([...idMap.values()], [...idMap.values()][0] ?? null);
    }
    return result;
  }

  layout(): GraphCommandResult {
    const positions = assistedLayout(this.store.nodes().map(node => ({
      id: node.id,
      dimensions: node.visual.dimensions,
    })));
    return this.perform('assisted-layout', () => this.store.runTransaction('assisted-layout', () => {
      positions.forEach((position, id) => this.store.setNodePosition(id, position));
    }));
  }

  undo(): GraphCommandResult {
    if (!this.synchronizeGraphState() || this.historyStale()) return this.historyChanged('undo');
    if (!this.canUndo()) return {ok: true, changed: false, command: 'undo', errors: []};
    const entry = this.history()[this.cursor() - 1];
    const result = this.restore(entry.before);
    if (result.ok) this.cursor.update(value => value - 1);
    return result;
  }

  redo(): GraphCommandResult {
    if (!this.synchronizeGraphState() || this.historyStale()) return this.historyChanged('redo');
    if (!this.canRedo()) return {ok: true, changed: false, command: 'redo', errors: []};
    const entry = this.history()[this.cursor()];
    const result = this.restore(entry.after);
    if (result.ok) this.cursor.update(value => value + 1);
    return result;
  }

  private record(label: string, before: GraphV2, coalesceKey?: string): void {
    const after = this.snapshot();
    const entries = this.history().slice(0, this.cursor());
    const previous = entries.at(-1);
    if (coalesceKey && previous?.coalesceKey === coalesceKey) {
      entries[entries.length - 1] = {...previous, after};
    } else {
      entries.push({label, before, after, coalesceKey});
    }
    this.history.set(entries);
    this.cursor.set(entries.length);
    this.historyStale.set(false);
    this.observedGraph = this.store.graph();
  }

  private restore(snapshot: GraphV2): GraphCommandResult {
    const restored = this.store.restoreGraphSnapshot(clone(snapshot));
    this.observedGraph = this.store.graph();
    return restored;
  }

  private snapshot(): GraphV2 {
    const graph = this.store.graph();
    if (!graph) throw new Error('A canonical graph must be loaded before an editor operation can run.');
    return clone(graph);
  }

  private setSelection(ids: readonly string[], primary: string | null): void {
    const valid = [...new Set(ids)].filter(id => !!this.store.node(id));
    this.selectionState.set(valid);
    this.store.selectNode(primary && valid.includes(primary) ? primary : valid[0] ?? null);
  }

  private synchronizeGraphState(): boolean {
    const graph = this.store.graph();
    if (graph === this.observedGraph) return true;
    this.invalidateForGraph(graph);
    return false;
  }

  private invalidateForGraph(graph: GraphV2 | null): void {
    if (graph === this.observedGraph) return;
    const hadHistory = this.history().length > 0;
    this.observedGraph = graph;
    this.history.set([]);
    this.cursor.set(0);
    this.clipboardState.set(null);
    this.selectionState.set([]);
    this.store.selectNode(null);
    this.historyStale.set(hadHistory);
  }

  private historyChanged(command: 'undo' | 'redo'): GraphCommandResult {
    return {
      ok: false,
      changed: false,
      command,
      errors: [{code: 'history_graph_changed', path: 'graph', message: 'Undo and redo are unavailable after the graph changed outside this editor session.'}],
    };
  }
}

const nextStableId = (base: string, occupied: Set<string>): string => {
  const safeBase = base.replace(/[^A-Za-z0-9_-]/g, '_') || 'item';
  let index = 1;
  let candidate = `${safeBase}_copy`;
  while (occupied.has(candidate)) candidate = `${safeBase}_copy_${++index}`;
  occupied.add(candidate);
  return candidate;
};

const remapEndpoint = <T extends GraphBinding['source'] | GraphBinding['target']>(endpoint: T, ids: Map<string, string>): T | null => {
  if (endpoint.kind !== 'node' && endpoint.kind !== 'port') return null;
  const nodeId = ids.get(endpoint.node_id);
  return nodeId ? {...endpoint, node_id: nodeId} as T : null;
};

const remapBinding = (binding: GraphBinding, ids: Map<string, string>, occupied: Set<string>): GraphBinding | null => {
  const source = remapEndpoint(binding.source, ids);
  const target = remapEndpoint(binding.target, ids);
  if (!source || !target) return null;
  if (binding.kind === 'inferred') {
    const nodeId = ids.get(binding.derived_from.node_id);
    if (!nodeId) return null;
    return {
      ...clone(binding),
      id: nextStableId(binding.id, occupied),
      source: source as typeof binding.source,
      target: target as typeof binding.target,
      derived_from: {...binding.derived_from, node_id: nodeId},
    };
  }
  return {...clone(binding), id: nextStableId(binding.id, occupied), source, target} as GraphBinding;
};
