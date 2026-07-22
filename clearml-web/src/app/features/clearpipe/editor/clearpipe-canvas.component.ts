import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  TemplateRef,
  viewChild,
} from '@angular/core';
import {CdkDrag, CdkDragEnd, CdkDragStart} from '@angular/cdk/drag-drop';
import {DecimalPipe, NgTemplateOutlet} from '@angular/common';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {GraphBinding, GraphNode, GraphPort, GraphVisual, Point} from '../domain/graph-v2.types';
import {GraphBindingInput, GraphStoreService} from '../domain/graph-store.service';
import {ClearpipeSemanticEdgeController, SemanticEdgeCommandResult} from './edges/clearpipe-semantic-edge.controller';
import {compatiblePortBindingKinds, SemanticPortLocation} from './edges/clearpipe-port-compatibility';
import {semanticCanvasEdges} from './edges/clearpipe-semantic-edge.renderer';
import {ClearpipeAdvancedEditorOperationsService} from './advanced/clearpipe-advanced-editor-operations.service';
import {canvasShortcut, isShortcutSuppressed, shortcutModifierLabel} from './advanced/shortcut-scope';
import {
  canvasGraphPointFromMinimapClientPoint,
  canvasGraphTransform,
  canvasMinimapLayout,
  canvasMinimapNode,
  canvasMinimapViewport,
  canvasNodeTransform,
  canvasPointFromClientPoint,
  canvasPositionAfterDrag,
  canvasVisualAtClientZoom,
  CanvasClientPoint, CanvasMinimapNode, CanvasMinimapViewport, CanvasNodeDimensions, CanvasNodePlacement,
  CanvasNodeView, CanvasProfileMark, CanvasProfiler, CanvasSurfaceBounds,
  fitCanvasVisual,
  normalizeCanvasDimensions,
  placementResult,
} from './clearpipe-canvas.adapter';

export interface ClearpipeCanvasNodeContext {
  $implicit: GraphNode;
  node: GraphNode;
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  edge: ClearpipeCanvasEdgeInteraction;
}

export interface ClearpipeCanvasEdgeInteraction {
  selectPort(nodeId: string, portId: string): void;
  compatibility(nodeId: string, portId: string): string;
}

interface CanvasSize {
  width: number;
  height: number;
}

const EMPTY_VIEWPORT: GraphVisual = {viewport: {x: 0, y: 0}, zoom: 1};
const DEFAULT_CANVAS_SIZE: CanvasSize = {width: 800, height: 600};

@Component({
  selector: 'sm-clearpipe-canvas',
  templateUrl: './clearpipe-canvas.component.html',
  styleUrl: './clearpipe-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDrag, DecimalPipe, MatButtonModule, MatIconModule, NgTemplateOutlet],
})
export class ClearpipeCanvasComponent {
  protected readonly commands = inject(GraphStoreService);
  private readonly semanticEdgesController = inject(ClearpipeSemanticEdgeController);
  protected readonly advanced = inject(ClearpipeAdvancedEditorOperationsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  private readonly minimapContent = viewChild<ElementRef<HTMLSpanElement>>('minimapContent');
  private readonly previewViewport = signal<GraphVisual | null>(null);
  private readonly canvasSize = signal<CanvasSize>(DEFAULT_CANVAS_SIZE);
  private viewportCommitTimer: ReturnType<typeof setTimeout> | null = null;
  private panStart: {clientX: number; clientY: number; visual: GraphVisual} | null = null;

  /** CP-17 supplies card/port content through this hook; CP-16 only positions it. */
  readonly nodeTemplate = input<TemplateRef<ClearpipeCanvasNodeContext> | null>(null);
  /** Renderer geometry drives the neutral placement shell and visual binding anchors. */
  readonly nodeDimensions = input<(node: GraphNode) => CanvasNodeDimensions>(
    (node) => normalizeCanvasDimensions(node.visual.dimensions),
  );
  readonly nodeAriaLabel = input<(node: GraphNode) => string>((node) => `${node.label}, ${node.kind} node`);
  readonly readonly = input(false);
  /** Optional CP-30 hook; it receives counts only and never a library event. */
  readonly profiler = input<CanvasProfiler | null>(null);

  protected readonly gridVisible = signal(true);
  protected readonly snapEnabled = signal(false);
  protected readonly panning = signal(false);
  protected readonly graph = this.commands.graph;
  protected readonly nodes = this.commands.nodes;
  protected readonly selectedNodeId = this.commands.selectedNodeId;
  protected readonly selectedNodeIds = this.advanced.selectedNodeIds;
  protected readonly shortcutModifier = shortcutModifierLabel();
  protected readonly hoveredNodeId = this.commands.hoveredNodeId;
  protected readonly draggingNodeId = this.commands.draggingNodeId;
  protected readonly canEdit = computed(() => !this.readonly() && !this.commands.readOnly());
  protected readonly viewport = computed(() => this.previewViewport() ?? this.graph()?.visual ?? EMPTY_VIEWPORT);
  protected readonly transform = computed(() => canvasGraphTransform(this.viewport()));
  protected readonly graphLoaded = computed(() => this.graph() !== null);
  protected readonly nodeViews = computed<readonly CanvasNodeView[]>(() => {
    const dimensions = this.nodeDimensions();
    return this.nodes().map((node) => ({node, dimensions: normalizeCanvasDimensions(dimensions(node))}));
  });
  protected readonly semanticEdges = computed(() =>
    semanticCanvasEdges(this.nodeViews(), this.commands.bindings(), this.nodeDimensions()));
  protected readonly selectedNode = computed(() =>
    this.nodes().find((node) => node.id === this.selectedNodeId()) ?? null);
  protected readonly selectedBindingId = signal<string | null>(null);
  protected readonly selectedBinding = computed(() =>
    this.commands.bindings().find((binding) => binding.id === this.selectedBindingId()) ?? null);
  protected readonly selectedSourcePort = signal<SemanticPortLocation | null>(null);
  protected readonly selectedBindingKind = signal<Extract<GraphBinding['kind'], 'data' | 'artifact'> | null>(null);
  protected readonly reconnectingBindingId = signal<string | null>(null);
  protected readonly edgeFeedback = signal('');
  protected readonly gridSize = computed(() => `${24 * this.viewport().zoom}px ${24 * this.viewport().zoom}px`);
  protected readonly gridPosition = computed(() => `${this.viewport().viewport.x}px ${this.viewport().viewport.y}px`);
  protected readonly minimapLayout = computed(() => canvasMinimapLayout(this.nodeViews()));
  protected readonly minimapNodes = computed<readonly CanvasMinimapNode[]>(() => {
    const layout = this.minimapLayout();
    return layout ? this.nodeViews().map((view) => canvasMinimapNode(view, layout)) : [];
  });
  protected readonly minimapViewport = computed<CanvasMinimapViewport | null>(() => {
    const layout = this.minimapLayout();
    return layout ? canvasMinimapViewport(this.viewport(), this.canvasSize(), layout) : null;
  });

  constructor() {
    afterNextRender(() => {
      this.observeCanvasSize();
    });
    this.destroyRef.onDestroy(() => {
      if (this.viewportCommitTimer !== null) clearTimeout(this.viewportCommitTimer);
    });
  }

  /**
   * The catalog/form owner supplies a complete canonical node request. The canvas
   * translates the pointer to an approved visual position and issues one command.
   */
  placeNode(placement: CanvasNodePlacement, clientPoint: CanvasClientPoint): void {
    if (!this.canEdit()) return;
    const result = this.advanced.perform('add-node', () =>
      placementResult(placement, this.clientPointToGraphPoint(clientPoint), this.commands));
    if (result.ok && result.id) this.advanced.select(result.id);
    this.markProfile('placement');
  }

  protected nodeContext(view: CanvasNodeView): ClearpipeCanvasNodeContext {
    const nodeId = view.node.id;
    return {
      $implicit: view.node,
      node: view.node,
      selected: this.selectedNodeId() === nodeId,
      hovered: this.hoveredNodeId() === nodeId,
      dragging: this.draggingNodeId() === nodeId,
      edge: {
        selectPort: (selectedNodeId, portId) => this.selectPortForEdge(selectedNodeId, portId),
        compatibility: (selectedNodeId, portId) => this.portCompatibilityText(selectedNodeId, portId),
      },
    };
  }

  protected nodeTransform(view: CanvasNodeView): string {
    return canvasNodeTransform(view.node.visual.position);
  }

  protected selectNode(event: Event, nodeId: string): void {
    event.stopPropagation();
    const modifier = event as MouseEvent;
    this.advanced.select(nodeId, modifier.ctrlKey || modifier.metaKey || modifier.shiftKey);
    this.focusCanvasAfterNodeSelection(event.target);
  }

  /** Public CP-24/25 handoff: extensions can issue semantic edge creation without visual adjacency. */
  createSemanticBinding(candidate: GraphBindingInput): SemanticEdgeCommandResult {
    const result = this.advanced.performSemantic('create-binding', () => this.semanticEdgesController.create(candidate));
    this.reportEdgeResult(result);
    return result;
  }

  /** Public CP-24/25 handoff: reconnects an existing canonical binding by its immutable ID. */
  reconnectSemanticBinding(bindingId: string, candidate: Omit<GraphBindingInput, 'id'>): SemanticEdgeCommandResult {
    const result = this.advanced.performSemantic('reconnect-binding', () =>
      this.semanticEdgesController.reconnect(bindingId, candidate));
    this.reportEdgeResult(result);
    return result;
  }

  /** Public CP-24/25 handoff: removes only the selected canonical binding. */
  removeSemanticBinding(bindingId: string): SemanticEdgeCommandResult {
    const result = this.advanced.performSemantic('remove-binding', () => this.semanticEdgesController.remove(bindingId));
    if (result.eligible && this.selectedBindingId() === bindingId) this.selectedBindingId.set(null);
    this.reportEdgeResult(result);
    return result;
  }

  protected activatePort(event: Event, nodeId: string, portId: string): void {
    event.stopPropagation();
    this.selectPortForEdge(nodeId, portId);
  }

  protected selectPortForEdge(nodeId: string, portId: string): void {
    if (!this.canEdit()) return;
    const port = this.commands.port(nodeId, portId);
    if (!port) {
      this.edgeFeedback.set('The selected port no longer exists.');
      return;
    }
    const location = {node_id: nodeId, port_id: portId};
    const source = this.selectedSourcePort();
    if (!source) {
      if (port.direction !== 'output') {
        this.edgeFeedback.set('Select an output port before selecting an input port.');
        return;
      }
      this.commands.selectPort(nodeId, portId);
      this.selectedSourcePort.set(location);
      this.selectedBindingKind.set(null);
      this.edgeFeedback.set(`Output ${port.name} selected. Choose a binding kind, then select a target input port.`);
      return;
    }
    if (source.node_id === nodeId && source.port_id === portId) {
      this.cancelEdgeGesture();
      return;
    }
    if (port.direction !== 'input') {
      this.edgeFeedback.set('Select an input port as the connection target.');
      return;
    }
    const replacementId = this.reconnectingBindingId() ?? undefined;
    const kinds = compatiblePortBindingKinds(this.graph(), source, location, replacementId);
    const selectedKind = this.selectedBindingKind();
    if (!kinds.length) {
      const result = this.semanticEdgesController.evaluate({
        kind: selectedKind ?? 'data',
        source: {kind: 'port', ...source},
        target: {kind: 'port', ...location},
      }, replacementId);
      this.edgeFeedback.set(result.message);
      return;
    }
    const kind = selectedKind && kinds.includes(selectedKind) ? selectedKind : kinds.length === 1 ? kinds[0] : null;
    if (!kind) {
      this.edgeFeedback.set('More than one binding kind is valid. Explicitly choose data or artifact, then select this input again.');
      return;
    }
    const result = this.semanticEdgesController.connectPorts(source, location, kind, replacementId);
    if (result.eligible) {
      this.selectedBindingId.set(result.id ?? replacementId ?? null);
      this.cancelEdgeGesture();
    }
    this.reportEdgeResult(result);
  }

  protected portCompatibilityText(nodeId: string, portId: string): string {
    const source = this.selectedSourcePort();
    if (!source) return 'Select this output port to start a semantic connection.';
    if (source.node_id === nodeId && source.port_id === portId) return 'Selected source output. Select a target input port.';
    const port = this.commands.port(nodeId, portId);
    if (!port) return 'This port is unavailable.';
    if (port.direction !== 'input') return 'Connections require an input target port.';
    const kinds = compatiblePortBindingKinds(this.graph(), source, {node_id: nodeId, port_id: portId}, this.reconnectingBindingId() ?? undefined);
    return kinds.length
      ? `Compatible for ${kinds.join(' or ')} binding.`
      : this.semanticEdgesController.evaluate({
        kind: this.selectedBindingKind() ?? 'data',
        source: {kind: 'port', ...source},
        target: {kind: 'port', node_id: nodeId, port_id: portId},
      }, this.reconnectingBindingId() ?? undefined).message;
  }

  protected portAriaLabel(nodeId: string, port: GraphPort): string {
    const selected = this.selectedSourcePort();
    const status = this.portCompatibilityText(nodeId, port.id);
    return `${port.direction === 'output' ? 'Output' : 'Input'} ${port.name}; ${port.role}; accepts ${
      port.accepted_binding_kinds.join(', ')}; ${selected?.node_id === nodeId && selected.port_id === port.id ? 'selected; ' : ''}${status}`;
  }

  protected chooseBindingKind(kind: Extract<GraphBinding['kind'], 'data' | 'artifact'>): void {
    this.selectedBindingKind.set(kind);
    this.edgeFeedback.set(`${kind} binding selected. Select a target input port.`);
  }

  protected canChooseBindingKind(kind: Extract<GraphBinding['kind'], 'data' | 'artifact'>): boolean {
    const source = this.selectedSourcePort();
    return !!source && !!this.commands.port(source.node_id, source.port_id)?.accepted_binding_kinds.includes(kind);
  }

  protected selectBinding(event: Event, bindingId: string): void {
    event.stopPropagation();
    if (!this.commands.bindings().some((binding) => binding.id === bindingId)) return;
    this.selectedBindingId.set(bindingId);
    this.commands.selectNode(null);
    this.edgeFeedback.set(`Connection ${bindingId} selected. Use Delete to remove it or reconnect it.`);
  }

  protected selectBindingKeydown(event: KeyboardEvent, bindingId: string): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.selectBinding(event, bindingId);
  }

  protected removeSelectedBinding(event: Event): void {
    event.stopPropagation();
    const binding = this.selectedBinding();
    if (binding) this.removeSemanticBinding(binding.id);
  }

  protected beginReconnectSelectedBinding(event: Event): void {
    event.stopPropagation();
    const binding = this.selectedBinding();
    if (!binding || (binding.kind !== 'data' && !(binding.kind === 'artifact' && binding.source.kind === 'port'))) {
      this.edgeFeedback.set('Only port-to-port data and artifact bindings can be reconnected on the canvas.');
      return;
    }
    this.reconnectingBindingId.set(binding.id);
    this.selectedSourcePort.set(null);
    this.selectedBindingKind.set(binding.kind);
    this.edgeFeedback.set(`Reconnect ${binding.kind} binding: select a replacement output port, then an input port.`);
  }

  protected hoverNode(nodeId: string | null): void {
    this.commands.setHoveredNode(nodeId);
  }

  protected beginNodeDrag(nodeId: string, event: CdkDragStart): void {
    if (!this.canEdit()) return;
    // Cdk only provides the drag lifecycle; no Cdk event is retained in graph state.
    void event;
    this.commands.setDraggingNode(nodeId);
  }

  protected nodeDragEnd(node: GraphNode, event: CdkDragEnd): void {
    const distance: Point = {x: event.distance.x, y: event.distance.y};
    event.source.reset();
    this.commands.setDraggingNode(null);
    if (!this.canEdit()) return;
    const position = canvasPositionAfterDrag(node.visual.position, distance, this.viewport().zoom);
    this.advanced.moveNodes(
      [node.id],
      {
        x: position.x - node.visual.position.x,
        y: position.y - node.visual.position.y,
      },
      this.snapEnabled(),
    );
    this.markProfile('move');
  }

  protected beginPan(event: MouseEvent): void {
    if (!this.canEdit() || (event.button !== 1 && !(event.button === 0 && event.target === event.currentTarget))) return;
    event.preventDefault();
    this.focusCanvas();
    this.panStart = {clientX: event.clientX, clientY: event.clientY, visual: this.viewport()};
    this.panning.set(true);
  }

  protected pan(event: MouseEvent): void {
    if (!this.panStart) return;
    this.previewViewport.set({
      ...this.panStart.visual,
      viewport: {
        x: this.panStart.visual.viewport.x + event.clientX - this.panStart.clientX,
        y: this.panStart.visual.viewport.y + event.clientY - this.panStart.clientY,
      },
    });
  }

  protected endPan(): void {
    if (!this.panStart) return;
    this.panStart = null;
    this.panning.set(false);
    this.commitPreviewViewport('pan');
  }

  protected wheel(event: WheelEvent): void {
    if (!this.canEdit()) return;
    if (event.cancelable) event.preventDefault();
    const zoom = this.viewport().zoom * (event.deltaY > 0 ? .9 : 1.1);
    this.previewViewport.set(canvasVisualAtClientZoom(
      this.viewport(),
      {clientX: event.clientX, clientY: event.clientY},
      this.surfaceBounds(),
      zoom,
    ));
    this.scheduleViewportCommit();
  }

  protected changeZoom(delta: number, event: MouseEvent): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    const bounds = this.surfaceBounds();
    const point = {clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2};
    this.previewViewport.set(canvasVisualAtClientZoom(this.viewport(), point, bounds, this.viewport().zoom + delta));
    this.commitPreviewViewport('zoom');
  }

  protected fitGraph(event?: Event): void {
    event?.stopPropagation();
    if (!this.canEdit()) return;
    const visual = fitCanvasVisual(this.nodeViews(), this.surfaceBounds());
    if (!visual) return;
    this.advanced.setViewport(visual, 'fit-graph');
    this.markProfile('fit');
  }

  protected resetViewport(event: Event): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    this.previewViewport.set(EMPTY_VIEWPORT);
    this.commitPreviewViewport('zoom');
  }

  protected toggleGrid(event: Event): void {
    event.stopPropagation();
    this.gridVisible.update((visible) => !visible);
  }

  protected toggleSnap(event: Event): void {
    event.stopPropagation();
    this.snapEnabled.update(enabled => !enabled);
  }

  protected clearSelection(event?: Event): void {
    event?.stopPropagation();
    this.advanced.clearSelection();
    this.selectedBindingId.set(null);
    this.cancelEdgeGesture();
  }

  protected selectCanvasBackground(event: MouseEvent): void {
    this.clearSelection(event);
    this.focusCanvas();
  }

  protected deleteSelectedNode(event: Event): void {
    event.stopPropagation();
    if (!this.canEdit()) return;
    if (!this.selectedNodeIds().length && this.selectedNode()) this.advanced.select(this.selectedNode()!.id);
    this.advanced.deleteSelected();
    this.markProfile('delete');
  }

  protected handleCanvasKeydown(event: KeyboardEvent): void {
    if (isShortcutSuppressed(event.target)) return;
    const shortcut = canvasShortcut(event);
    if (shortcut) {
      event.preventDefault();
      if (shortcut === 'undo') this.advanced.undo();
      else if (shortcut === 'redo') this.advanced.redo();
      else if (shortcut === 'select-all') this.advanced.selectAll();
      else if (shortcut === 'copy') this.advanced.copy();
      else if (shortcut === 'paste') this.advanced.paste();
      else this.advanced.duplicate();
      return;
    }
    if (event.key === 'Escape') {
      this.clearSelection();
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedBinding()) {
      event.preventDefault();
      this.removeSelectedBinding(event);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && this.selectedNode()) {
      event.preventDefault();
      this.deleteSelectedNode(event);
      return;
    }
    const move = event.key === 'ArrowLeft' ? {x: -24, y: 0}
      : event.key === 'ArrowRight' ? {x: 24, y: 0}
        : event.key === 'ArrowUp' ? {x: 0, y: -24}
          : event.key === 'ArrowDown' ? {x: 0, y: 24}
            : null;
    if (move && this.selectedNodeIds().length && this.canEdit()) {
      event.preventDefault();
      this.advanced.moveNodes(this.selectedNodeIds(), move, this.snapEnabled(), 'keyboard-move');
      this.markProfile('move');
      return;
    }
    const pan = event.key === 'ArrowLeft' ? {x: 24, y: 0}
      : event.key === 'ArrowRight' ? {x: -24, y: 0}
        : event.key === 'ArrowUp' ? {x: 0, y: 24}
          : event.key === 'ArrowDown' ? {x: 0, y: -24}
            : null;
    if (!pan || !this.canEdit()) return;
    event.preventDefault();
    const visual = {
      ...this.viewport(),
      viewport: {x: this.viewport().viewport.x + pan.x, y: this.viewport().viewport.y + pan.y},
    };
    this.advanced.setViewport(visual, 'pan-canvas', 'keyboard-pan');
    this.markProfile('pan');
  }

  protected minimapNavigate(event: MouseEvent): void {
    if (!this.canEdit()) return;
    const minimap = this.minimapContent()?.nativeElement;
    const layout = this.minimapLayout();
    if (!minimap || !layout) return;
    const minimapRect = minimap.getBoundingClientRect();
    const surface = this.surfaceBounds();
    const graphPoint = canvasGraphPointFromMinimapClientPoint(
      {clientX: event.clientX, clientY: event.clientY},
      {left: minimapRect.left, top: minimapRect.top, width: minimapRect.width, height: minimapRect.height},
      layout,
    );
    this.previewViewport.set({
      ...this.viewport(),
      viewport: {
        x: surface.width / 2 - graphPoint.x * this.viewport().zoom,
        y: surface.height / 2 - graphPoint.y * this.viewport().zoom,
      },
    });
    this.commitPreviewViewport('pan');
  }

  protected minimapKeyboardNavigate(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const minimap = this.minimapContent()?.nativeElement.getBoundingClientRect();
      if (!minimap) return;
      this.minimapNavigate(new MouseEvent('click', {
        clientX: minimap.left + minimap.width / 2,
        clientY: minimap.top + minimap.height / 2,
      }));
    }
  }

  private clientPointToGraphPoint(point: CanvasClientPoint): Point {
    return canvasPointFromClientPoint(point, this.surfaceBounds(), this.viewport());
  }

  private scheduleViewportCommit(): void {
    if (this.viewportCommitTimer !== null) clearTimeout(this.viewportCommitTimer);
    this.viewportCommitTimer = setTimeout(() => this.commitPreviewViewport('zoom'), 120);
  }

  private commitPreviewViewport(phase: Extract<CanvasProfileMark['phase'], 'pan' | 'zoom' | 'fit'>): void {
    if (this.viewportCommitTimer !== null) {
      clearTimeout(this.viewportCommitTimer);
      this.viewportCommitTimer = null;
    }
    const visual = this.previewViewport();
    this.previewViewport.set(null);
    if (!visual || !this.canEdit()) return;
    this.advanced.setViewport(visual, `canvas-${phase}`, phase === 'pan' ? 'pan' : undefined);
    this.markProfile(phase);
  }

  private surfaceBounds(): CanvasSurfaceBounds {
    const rect = this.canvas()?.nativeElement.getBoundingClientRect();
    return rect
      ? {left: rect.left, top: rect.top, width: rect.width, height: rect.height}
      : {left: 0, top: 0, ...this.canvasSize()};
  }

  private observeCanvasSize(): void {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas) return;
    const updateSize = (): void => {
      const {width, height} = canvas.getBoundingClientRect();
      this.canvasSize.set({width: width || DEFAULT_CANVAS_SIZE.width, height: height || DEFAULT_CANVAS_SIZE.height});
    };
    updateSize();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private focusCanvasAfterNodeSelection(target: EventTarget | null): void {
    const element = target instanceof HTMLElement ? target : null;
    if (element?.closest('a, button, input, select, textarea, [contenteditable="true"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="textbox"]')) {
      return;
    }
    this.focusCanvas();
  }

  private focusCanvas(): void {
    this.canvas()?.nativeElement.focus({preventScroll: true});
  }

  private markProfile(phase: CanvasProfileMark['phase']): void {
    this.profiler()?.mark({
      phase,
      nodeCount: this.nodes().length,
      bindingCount: this.commands.bindings().length,
    });
  }

  private cancelEdgeGesture(): void {
    this.selectedSourcePort.set(null);
    this.selectedBindingKind.set(null);
    this.reconnectingBindingId.set(null);
    this.commands.selectPort(null);
  }

  private reportEdgeResult(result: SemanticEdgeCommandResult): void {
    this.edgeFeedback.set(result.message);
  }
}
