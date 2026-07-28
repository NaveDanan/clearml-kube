import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';

import {
  CLEARPIPE_FLOW_RULE_ACTION_LABELS,
  CLEARPIPE_FLOW_RULE_OPERATOR_LABELS,
  CLEARPIPE_FLOW_RULE_VALUE_OPERATORS,
  ClearpipeFlowBoundary,
  ClearpipeFlowEdge,
  ClearpipeFlowEdgeRule,
  ClearpipeFlowNode,
  ClearpipeFlowRuntimeNode,
  ClearpipeFlowNodeType,
  ClearpipeFlowPoint,
  ClearpipeFlowRuleAction,
  ClearpipeFlowRuleCondition,
  ClearpipeFlowRuleOperator,
  ClearpipeFlowVariable,
  clearpipeFlowNodeMeta,
  flowNodeVariables,
  DATASET_MODE_LABELS,
} from './clearpipe-flow.models';
import {ClearpipeFlowStoreService} from './clearpipe-flow-store.service';
import {reportMappingProgress, ReportSlotMapping} from './clearpipe-report-mapping';
import {ReportTemplateSlot} from './clearpipe-report-template';

const NODE_W = 240;
const NODE_H = 104;
/** On-path length reserved for the arrowhead (world units). The dashed line ends
 *  at the arrow's base and the arrow bridges the remaining gap to the connector,
 *  so the connection stays continuous even when nodes overlap/stack. */
const ARROW_LEN = 12;
const CLICK_THRESHOLD = 4;
/** Delay before a node's live status window appears on hover (ms). */
const HOVER_DELAY_MS = 2000;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.5;
const FIT_VIEW_PADDING = 48;
const BOUNDARY_MIN_W = 140;
const BOUNDARY_MIN_H = 100;
const VALID_TYPES: readonly ClearpipeFlowNodeType[] = [
  'scheduled',
  'autoscaler',
  'dataset',
  'task',
  'execute',
  'report',
];

const STATUS_COLORS: Record<string, string> = {
  idle: '#9aa0a6',
  pending: '#f59e0b',
  running: '#3b82f6',
  completed: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
  stopped: '#6b7280',
};

interface EdgeView {
  id: string;
  path: string;
  accent: string;
  midX: number;
  midY: number;
  ruleCount: number;
}

interface RuleOperatorOption {
  value: ClearpipeFlowRuleOperator;
  label: string;
}

interface RuleActionOption {
  value: ClearpipeFlowRuleAction;
  label: string;
}

/**
 * clearpipe-main-style flow canvas. Nodes drop straight onto the surface (no
 * dialog), drag to move, click to select, and connect output -> input handles to
 * define pipeline order. Pan/zoom + dotted background mirror the reference ReactFlow.
 */
@Component({
  selector: 'sm-clearpipe-flow-canvas',
  templateUrl: './clearpipe-flow-canvas.component.html',
  styleUrls: ['./clearpipe-flow-canvas.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatIconModule, MatButtonModule],
  host: {
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
})
export class ClearpipeFlowCanvasComponent {
  protected readonly store = inject(ClearpipeFlowStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  /** Emitted when the user explicitly asks to open the configuration panel
   *  (double-click a node or the Configure action) — never on plain selection. */
  readonly configureRequested = output<void>();

  protected readonly nodes = this.store.nodes;
  protected readonly edges = this.store.edges;
  protected readonly boundaries = this.store.boundaries;
  protected readonly containedNodeIds = this.store.containedNodeIds;
  protected readonly viewport = this.store.viewport;
  protected readonly selectedNodeId = this.store.selectedNodeId;
  protected readonly selectedNodeIds = this.store.selectedNodeIds;
  protected readonly selectedBoundaryId = this.store.selectedBoundaryId;
  protected readonly hoveredNodeId = this.store.hoveredNodeId;
  protected readonly runtimeNodes = this.store.runtimeNodes;
  protected readonly running = this.store.running;
  protected readonly statusColors = STATUS_COLORS;

  protected readonly panning = signal(false);
  protected readonly connecting = signal(false);
  private readonly pendingCursor = signal<ClearpipeFlowPoint | null>(null);

  /** Live rubber-band marquee rectangle (graph coordinates) or null when idle. */
  protected readonly marquee = signal<{x: number; y: number; width: number; height: number} | null>(null);
  /** Right-click context menu anchored to an edge (canvas-relative pixels). */
  protected readonly edgeMenu = signal<{edgeId: string; x: number; y: number} | null>(null);
  /** Right-click context menu on the node selection (canvas-relative pixels). */
  protected readonly nodeMenu = signal<{x: number; y: number} | null>(null);
  /** Id of the edge whose conditional-rules editor overlay is open. */
  protected readonly rulesEditorEdgeId = signal<string | null>(null);
  /** Whether the "Add rule" dropdown (If / Action) inside the rules editor is open. */
  protected readonly addRuleMenuOpen = signal(false);

  protected readonly hasClipboard = this.store.hasClipboard;
  protected readonly hasGroupedSelection = this.store.hasGroupedSelection;
  protected readonly selectionCount = computed(() => this.selectedNodeIds().size);

  protected readonly operatorOptions: readonly RuleOperatorOption[] =
    (Object.keys(CLEARPIPE_FLOW_RULE_OPERATOR_LABELS) as ClearpipeFlowRuleOperator[])
      .map((value) => ({value, label: CLEARPIPE_FLOW_RULE_OPERATOR_LABELS[value]}));
  protected readonly actionOptions: readonly RuleActionOption[] =
    (Object.keys(CLEARPIPE_FLOW_RULE_ACTION_LABELS) as ClearpipeFlowRuleAction[])
      .map((value) => ({value, label: CLEARPIPE_FLOW_RULE_ACTION_LABELS[value]}));

  protected readonly worldTransform = computed(() => {
    const vp = this.viewport();
    return `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`;
  });

  protected readonly backgroundStyle = computed(() => {
    const vp = this.viewport();
    const size = 15 * vp.zoom;
    return {
      'background-image': 'radial-gradient(circle, var(--cp-dot, #c8ccd1) 1px, transparent 1px)',
      'background-size': `${size}px ${size}px`,
      'background-position': `${vp.x}px ${vp.y}px`,
    } as Record<string, string>;
  });

  protected readonly edgeViews = computed<readonly EdgeView[]>(() => {
    const nodeById = new Map(this.nodes().map((node) => [node.id, node]));
    return this.edges().flatMap((edge) => {
      const source = nodeById.get(edge.source);
      const target = nodeById.get(edge.target);
      if (!source || !target) return [];
      const from = {x: source.position.x + NODE_W, y: source.position.y + NODE_H / 2};
      const to = {x: target.position.x, y: target.position.y + NODE_H / 2};
      // End the visible line at the arrowhead's base (ARROW_LEN before the
      // connector); the marker arrow then fills the gap to the node so the
      // dashed animation always terminates cleanly at the arrow, never overlaps.
      const toLine = {x: to.x - ARROW_LEN, y: to.y};
      return [{
        id: edge.id,
        path: this.edgePath(from, toLine),
        accent: clearpipeFlowNodeMeta(source.type).accent,
        midX: (from.x + to.x) / 2,
        midY: (from.y + to.y) / 2,
        ruleCount: edge.rules?.length ?? 0,
      }];
    });
  });

  /** The edge whose rules editor is currently open (or null). */
  protected readonly rulesEdge = computed<ClearpipeFlowEdge | null>(() => {
    const edgeId = this.rulesEditorEdgeId();
    if (!edgeId) return null;
    return this.edges().find((edge) => edge.id === edgeId) ?? null;
  });

  /** Nodes a rule can read variables from: the edge's source plus its ancestors. */
  protected readonly ruleSourceNodes = computed<readonly ClearpipeFlowNode[]>(() => {
    const edge = this.rulesEdge();
    if (!edge) return [];
    const source = this.nodes().find((node) => node.id === edge.source);
    const ancestors = this.store.ancestorNodes(edge.source);
    return source ? [source, ...ancestors] : ancestors;
  });

  protected readonly pendingPath = computed<string | null>(() => {
    const from = this.store.connectingFrom();
    const cursor = this.pendingCursor();
    if (!from || !cursor) return null;
    const source = this.nodes().find((node) => node.id === from);
    if (!source) return null;
    return this.edgePath({x: source.position.x + NODE_W, y: source.position.y + NODE_H / 2}, cursor);
  });

  // --- gesture state -------------------------------------------------------
  private move: {
    primaryId: string;
    ids: string[];
    additive: boolean;
    startClient: {x: number; y: number};
    startPositions: Map<string, ClearpipeFlowPoint>;
    moved: boolean;
  } | null = null;
  private marqueeGesture: {
    startGraph: ClearpipeFlowPoint;
    additive: boolean;
    base: ReadonlySet<string>;
  } | null = null;
  private pan: {startClient: {x: number; y: number}; startVp: {x: number; y: number}} | null = null;
  private boundaryMove: {
    id: string;
    startClient: {x: number; y: number};
    startPos: ClearpipeFlowPoint;
    moved: boolean;
  } | null = null;
  private boundaryResize: {
    id: string;
    startClient: {x: number; y: number};
    startSize: {width: number; height: number};
  } | null = null;
  private windowListeners: (() => void)[] = [];
  /** Pending timer that reveals the hovered node's status window after a dwell. */
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.detachWindowListeners();
      this.clearHoverTimer();
    });
  }

  protected meta(type: ClearpipeFlowNodeType) {
    return clearpipeFlowNodeMeta(type);
  }

  /** Node footer badge text: Dataset nodes show their Create/Sync/Use mode instead
   *  of the generic category label. */
  protected badgeLabel(node: ClearpipeFlowNode): string {
    if (node.type === 'dataset') {
      const mode = String(node.config['mode'] ?? 'use') as keyof typeof DATASET_MODE_LABELS;
      return DATASET_MODE_LABELS[mode] ?? DATASET_MODE_LABELS.use;
    }
    return clearpipeFlowNodeMeta(node.type).categoryLabel;
  }

  /** Report canvas card summary: template presence + mapping progress + state,
   *  derived from the node's persisted slot manifest and graph-aware mappings. */
  protected reportSummary(node: ClearpipeFlowNode): {progress: string; state: 'ok' | 'warn'} | null {
    if (node.type !== 'report') return null;
    if (!String(node.config['templateReportId'] ?? '')) return {progress: 'no template', state: 'warn'};
    const slots = Array.isArray(node.config['templateSlots'])
      ? (node.config['templateSlots'] as ReportTemplateSlot[])
      : [];
    const mappings = Array.isArray(node.config['reportMappings'])
      ? (node.config['reportMappings'] as ReportSlotMapping[])
      : [];
    const progress = reportMappingProgress(slots, mappings);
    return {
      progress: `${progress.mappedCount}/${progress.totalRequired || '?'} mapped`,
      state: progress.valid ? 'ok' : 'warn',
    };
  }

  protected hoverNode(nodeId: string): void {
    // Suppress the hover runtime popup while a marquee/move/pan gesture is in
    // progress (dragging across nodes must not surface their overlays).
    if (this.marqueeGesture || this.move || this.pan) return;
    // Only reveal the live status window after a short dwell (not immediately).
    this.clearHoverTimer();
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      if (this.marqueeGesture || this.move || this.pan) return;
      this.store.setHoveredNode(nodeId);
    }, HOVER_DELAY_MS);
  }

  protected leaveNode(nodeId: string): void {
    this.clearHoverTimer();
    if (this.hoveredNodeId() === nodeId) this.store.setHoveredNode(null);
  }

  private clearHoverTimer(): void {
    if (this.hoverTimer !== null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
  }

  protected runtimeNode(nodeId: string): ClearpipeFlowRuntimeNode | undefined {
    return this.runtimeNodes().get(nodeId);
  }

  protected runtimeOutputCount(runtime: ClearpipeFlowRuntimeNode): number {
    return (runtime.artifacts?.length ?? 0)
      + (runtime.datasets?.length ?? 0)
      + (runtime.models?.input?.length ?? 0)
      + (runtime.models?.output?.length ?? 0);
  }

  protected runtimeTime(value?: string): string {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString();
  }

  protected trackNode = (_: number, node: ClearpipeFlowNode) => node.id;
  protected trackEdge = (_: number, edge: EdgeView) => edge.id;
  protected trackBoundary = (_: number, boundary: ClearpipeFlowBoundary) => boundary.id;

  // --- coordinate helpers --------------------------------------------------
  /**
   * The effective on-screen scale applied to the canvas by ancestor CSS
   * transforms (the app scales `<body>` to normalise high-DPI displays, e.g.
   * `scale(0.8)`). `getBoundingClientRect()` and pointer `clientX/Y` are in
   * post-scale screen pixels, but the world/graph coordinates are pre-scale CSS
   * pixels, so every screen->world conversion must divide by this factor.
   */
  private canvasScale(): number {
    const el = this.canvasRef().nativeElement;
    const width = el.offsetWidth;
    return width ? el.getBoundingClientRect().width / width : 1;
  }

  private graphPointFromClient(clientX: number, clientY: number): ClearpipeFlowPoint {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const vp = this.viewport();
    const scale = this.canvasScale();
    return {
      x: ((clientX - rect.left) / scale - vp.x) / vp.zoom,
      y: ((clientY - rect.top) / scale - vp.y) / vp.zoom,
    };
  }

  private edgePath(from: ClearpipeFlowPoint, to: ClearpipeFlowPoint): string {
    const offset = Math.max(40, Math.abs(to.x - from.x) / 2);
    return `M ${from.x},${from.y} C ${from.x + offset},${from.y} ${to.x - offset},${to.y} ${to.x},${to.y}`;
  }

  // --- drop (node creation, no dialog) ------------------------------------
  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    const point = this.graphPointFromClient(event.clientX, event.clientY);
    const boundary = event.dataTransfer?.getData('application/x-clearpipe-flow-boundary');
    if (boundary) {
      this.store.addBoundary({x: point.x - 160, y: point.y - 110});
      return;
    }
    const type = event.dataTransfer?.getData('application/x-clearpipe-flow-node') as ClearpipeFlowNodeType;
    if (!type || !VALID_TYPES.includes(type)) return;
    this.store.addNode(type, {x: point.x - NODE_W / 2, y: point.y - NODE_H / 2});
  }

  // --- node move + select --------------------------------------------------
  protected onNodePointerDown(event: PointerEvent, node: ClearpipeFlowNode): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.closeEdgeMenu();
    this.closeNodeMenu();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    // Clicking any grouped node selects/toggles its whole group.
    const members = this.store.groupMemberIds(node.id);
    if (additive) {
      const current = new Set(this.store.selectedNodeIds());
      const allSelected = members.every((id) => current.has(id));
      if (allSelected) {
        members.forEach((id) => current.delete(id));
        this.store.setSelection([...current]);
        return; // group deselected — no drag
      }
      members.forEach((id) => current.add(id));
      this.store.setSelection([...current]);
      this.store.selectedNodeId.set(node.id);
    } else if (!this.store.selectedNodeIds().has(node.id)) {
      // Clicking an unselected node (no modifier) selects just it (or its group).
      this.store.setSelection(members);
      this.store.selectedNodeId.set(node.id);
    } else {
      // Clicking within an existing multi-selection keeps it, but makes this the
      // inspector's primary node.
      this.store.selectedNodeId.set(node.id);
    }

    const ids = [...this.store.selectedNodeIds()];
    const nodeById = new Map(this.nodes().map((item) => [item.id, item]));
    const startPositions = new Map<string, ClearpipeFlowPoint>();
    ids.forEach((id) => {
      const current = nodeById.get(id);
      if (current) startPositions.set(id, {...current.position});
    });
    this.move = {
      primaryId: node.id,
      ids,
      additive,
      startClient: {x: event.clientX, y: event.clientY},
      startPositions,
      moved: false,
    };
    this.attachWindowListeners();
  }

  /** Right-click on a node opens the selection context menu (group/clipboard). */
  protected onNodeContextMenu(event: MouseEvent, node: ClearpipeFlowNode): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeEdgeMenu();
    if (!this.selectedNodeIds().has(node.id)) {
      this.store.setSelection(this.store.groupMemberIds(node.id));
      this.store.selectedNodeId.set(node.id);
    }
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const scale = this.canvasScale();
    this.nodeMenu.set({x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale});
  }

  protected closeNodeMenu(): void {
    if (this.nodeMenu()) this.nodeMenu.set(null);
  }

  protected groupSelection(): void {
    this.store.groupSelectedNodes();
    this.closeNodeMenu();
  }

  protected ungroupSelection(): void {
    this.store.ungroupSelectedNodes();
    this.closeNodeMenu();
  }

  protected copySelection(): void {
    this.store.copySelectedNodes();
    this.closeNodeMenu();
  }

  protected cutSelection(): void {
    this.store.cutSelectedNodes();
    this.closeNodeMenu();
  }

  protected pasteSelection(): void {
    this.store.pasteClipboard();
    this.closeNodeMenu();
  }

  protected duplicateSelection(): void {
    this.store.duplicateSelectedNodes();
    this.closeNodeMenu();
  }

  // --- connection gesture --------------------------------------------------
  protected onOutputPointerDown(event: PointerEvent, node: ClearpipeFlowNode): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.store.beginConnection(node.id);
    this.connecting.set(true);
    this.pendingCursor.set(this.graphPointFromClient(event.clientX, event.clientY));
    this.attachWindowListeners();
  }

  // --- boundary move + resize ---------------------------------------------
  protected onBoundaryPointerDown(event: PointerEvent, boundary: ClearpipeFlowBoundary): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.store.selectBoundary(boundary.id);
    this.boundaryMove = {
      id: boundary.id,
      startClient: {x: event.clientX, y: event.clientY},
      startPos: {...boundary.position},
      moved: false,
    };
    this.attachWindowListeners();
  }

  protected onBoundaryResizePointerDown(event: PointerEvent, boundary: ClearpipeFlowBoundary): void {
    if (event.button !== 0) return;
    event.stopPropagation();
    this.store.selectBoundary(boundary.id);
    this.boundaryResize = {
      id: boundary.id,
      startClient: {x: event.clientX, y: event.clientY},
      startSize: {width: boundary.width, height: boundary.height},
    };
    this.attachWindowListeners();
  }

  protected setBoundaryLabel(boundary: ClearpipeFlowBoundary, label: string): void {
    this.store.updateBoundary(boundary.id, {label});
  }

  protected removeBoundary(event: Event, boundary: ClearpipeFlowBoundary): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.removeBoundary(boundary.id);
  }

  // --- pan / background ----------------------------------------------------
  protected onCanvasPointerDown(event: PointerEvent): void {
    this.closeEdgeMenu();
    this.closeNodeMenu();
    // Middle mouse button (scroll wheel) = pan the canvas.
    if (event.button === 1) {
      event.preventDefault();
      this.pan = {
        startClient: {x: event.clientX, y: event.clientY},
        startVp: {x: this.viewport().x, y: this.viewport().y},
      };
      this.panning.set(true);
      this.store.cancelConnection();
      this.attachWindowListeners();
      return;
    }
    if (event.button !== 0) return;
    // Left button on empty canvas = rubber-band marquee multi-selection.
    this.store.selectBoundary(null);
    this.store.cancelConnection();
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    if (!additive) this.store.selectNode(null);
    const startGraph = this.graphPointFromClient(event.clientX, event.clientY);
    this.marqueeGesture = {startGraph, additive, base: new Set(this.store.selectedNodeIds())};
    this.marquee.set({x: startGraph.x, y: startGraph.y, width: 0, height: 0});
    this.attachWindowListeners();
  }

  private onWindowPointerMove = (event: PointerEvent): void => {
    if (this.move) {
      const factor = this.viewport().zoom * this.canvasScale();
      const dx = (event.clientX - this.move.startClient.x) / factor;
      const dy = (event.clientY - this.move.startClient.y) / factor;
      if (Math.abs(event.clientX - this.move.startClient.x) > CLICK_THRESHOLD ||
          Math.abs(event.clientY - this.move.startClient.y) > CLICK_THRESHOLD) this.move.moved = true;
      const moves = this.move.ids
        .filter((id) => this.move!.startPositions.has(id))
        .map((id) => {
          const start = this.move!.startPositions.get(id)!;
          return {id, position: {x: start.x + dx, y: start.y + dy}};
        });
      this.store.moveNodes(moves);
      return;
    }
    if (this.marqueeGesture) {
      const cursor = this.graphPointFromClient(event.clientX, event.clientY);
      const start = this.marqueeGesture.startGraph;
      const rect = {
        x: Math.min(start.x, cursor.x),
        y: Math.min(start.y, cursor.y),
        width: Math.abs(cursor.x - start.x),
        height: Math.abs(cursor.y - start.y),
      };
      this.marquee.set(rect);
      const hit = this.nodes().filter((node) => this.nodeIntersectsRect(node, rect)).map((node) => node.id);
      const selection = this.marqueeGesture.additive
        ? new Set([...this.marqueeGesture.base, ...hit])
        : new Set(hit);
      this.store.setSelection([...selection]);
      return;
    }
    if (this.boundaryMove) {
      const factor = this.viewport().zoom * this.canvasScale();
      const dx = event.clientX - this.boundaryMove.startClient.x;
      const dy = event.clientY - this.boundaryMove.startClient.y;
      if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) this.boundaryMove.moved = true;
      this.store.moveBoundary(this.boundaryMove.id, {
        x: this.boundaryMove.startPos.x + dx / factor,
        y: this.boundaryMove.startPos.y + dy / factor,
      });
      return;
    }
    if (this.boundaryResize) {
      const factor = this.viewport().zoom * this.canvasScale();
      const dx = event.clientX - this.boundaryResize.startClient.x;
      const dy = event.clientY - this.boundaryResize.startClient.y;
      this.store.resizeBoundary(this.boundaryResize.id, {
        width: Math.max(BOUNDARY_MIN_W, this.boundaryResize.startSize.width + dx / factor),
        height: Math.max(BOUNDARY_MIN_H, this.boundaryResize.startSize.height + dy / factor),
      });
      return;
    }
    if (this.store.connectingFrom()) {
      this.pendingCursor.set(this.graphPointFromClient(event.clientX, event.clientY));
      return;
    }
    if (this.pan) {
      const scale = this.canvasScale();
      const dx = (event.clientX - this.pan.startClient.x) / scale;
      const dy = (event.clientY - this.pan.startClient.y) / scale;
      this.store.setViewport({...this.viewport(), x: this.pan.startVp.x + dx, y: this.pan.startVp.y + dy});
    }
  };

  private onWindowPointerUp = (event: PointerEvent): void => {
    if (this.move) {
      const {primaryId, moved, additive} = this.move;
      this.move = null;
      if (moved) this.store.commitMove();
      // A plain (non-additive) click without a drag collapses a multi-selection
      // down to just the clicked node — desktop file-manager behaviour.
      else if (!additive) this.store.selectNode(primaryId);
    } else if (this.marqueeGesture) {
      this.marqueeGesture = null;
      this.marquee.set(null);
    } else if (this.boundaryMove) {
      const {moved} = this.boundaryMove;
      this.boundaryMove = null;
      if (moved) this.store.commitBoundary();
    } else if (this.boundaryResize) {
      this.boundaryResize = null;
      this.store.commitBoundary();
    } else if (this.store.connectingFrom()) {
      const targetId = this.nodeIdAtPoint(event.clientX, event.clientY);
      if (targetId) this.store.completeConnection(targetId);
      else this.store.cancelConnection();
      this.connecting.set(false);
      this.pendingCursor.set(null);
    } else if (this.pan) {
      this.pan = null;
      this.panning.set(false);
    }
    this.detachWindowListeners();
  };

  private nodeIdAtPoint(clientX: number, clientY: number): string | null {
    let element = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    while (element) {
      const id = element.dataset?.['nodeId'];
      if (id) return id;
      element = element.parentElement;
    }
    return null;
  }

  // --- zoom ----------------------------------------------------------------
  protected onWheel(event: WheelEvent): void {
    if (event.cancelable) event.preventDefault();
    const vp = this.viewport();
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const scale = this.canvasScale();
    const px = (event.clientX - rect.left) / scale;
    const py = (event.clientY - rect.top) / scale;
    const nextZoom = this.clampZoom(vp.zoom * (event.deltaY < 0 ? 1.1 : 0.9));
    const gx = (px - vp.x) / vp.zoom;
    const gy = (py - vp.y) / vp.zoom;
    this.store.setViewport({
      x: px - gx * nextZoom,
      y: py - gy * nextZoom,
      zoom: nextZoom,
    });
  }

  protected zoomBy(factor: number): void {
    const vp = this.viewport();
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const scale = this.canvasScale();
    const cx = rect.width / scale / 2;
    const cy = rect.height / scale / 2;
    const nextZoom = this.clampZoom(vp.zoom * factor);
    const gx = (cx - vp.x) / vp.zoom;
    const gy = (cy - vp.y) / vp.zoom;
    this.store.setViewport({x: cx - gx * nextZoom, y: cy - gy * nextZoom, zoom: nextZoom});
  }

  protected fitView(): void {
    const nodes = this.nodes();
    if (!nodes.length) {
      this.store.setViewport({x: 40, y: 40, zoom: 1});
      return;
    }

    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const scale = this.canvasScale();
    const viewWidth = rect.width / scale;
    const viewHeight = rect.height / scale;
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_W));
    const maxY = Math.max(...nodes.map((node) => node.position.y + NODE_H));
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const availableWidth = Math.max(1, viewWidth - FIT_VIEW_PADDING * 2);
    const availableHeight = Math.max(1, viewHeight - FIT_VIEW_PADDING * 2);
    const zoom = this.clampZoom(Math.min(availableWidth / contentWidth, availableHeight / contentHeight));

    this.store.setViewport({
      x: (viewWidth - contentWidth * zoom) / 2 - minX * zoom,
      y: (viewHeight - contentHeight * zoom) / 2 - minY * zoom,
      zoom,
    });
  }

  private clampZoom(zoom: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  }

  // --- node actions --------------------------------------------------------
  protected configure(event: Event, node: ClearpipeFlowNode): void {
    event.stopPropagation();
    this.store.selectNode(node.id);
    this.configureRequested.emit();
  }

  /** Double-clicking a node selects it and opens its configuration panel. */
  protected onNodeDblClick(event: MouseEvent, node: ClearpipeFlowNode): void {
    event.stopPropagation();
    this.store.selectNode(node.id);
    this.configureRequested.emit();
  }

  protected duplicate(event: Event, node: ClearpipeFlowNode): void {
    event.stopPropagation();
    this.store.duplicateNode(node.id);
  }

  protected remove(event: Event, node: ClearpipeFlowNode): void {
    event.stopPropagation();
    this.store.removeNode(node.id);
  }

  // --- marquee hit-test ----------------------------------------------------
  private nodeIntersectsRect(
    node: ClearpipeFlowNode,
    rect: {x: number; y: number; width: number; height: number},
  ): boolean {
    return (
      node.position.x < rect.x + rect.width &&
      node.position.x + NODE_W > rect.x &&
      node.position.y < rect.y + rect.height &&
      node.position.y + NODE_H > rect.y
    );
  }

  // --- keyboard ------------------------------------------------------------
  protected onDocumentKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key === 'Escape') {
      this.closeEdgeMenu();
      this.closeNodeMenu();
      this.rulesEditorEdgeId.set(null);
      return;
    }
    const hasSelection = this.store.selectedNodeIds().size > 0;
    if (event.ctrlKey || event.metaKey) {
      switch (event.key.toLowerCase()) {
        case 'c':
          if (hasSelection) {
            event.preventDefault();
            this.store.copySelectedNodes();
          }
          return;
        case 'x':
          if (hasSelection) {
            event.preventDefault();
            this.store.cutSelectedNodes();
          }
          return;
        case 'v':
          if (this.store.hasClipboard()) {
            event.preventDefault();
            this.store.pasteClipboard();
          }
          return;
        case 'd':
          if (hasSelection) {
            event.preventDefault();
            this.store.duplicateSelectedNodes();
          }
          return;
        case 'g':
          event.preventDefault();
          if (event.shiftKey) this.store.ungroupSelectedNodes();
          else this.store.groupSelectedNodes();
          return;
      }
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && hasSelection) {
      event.preventDefault();
      this.store.removeSelectedNodes();
    }
  }

  // --- edge context menu ---------------------------------------------------
  protected onEdgeContextMenu(event: MouseEvent, edge: EdgeView): void {
    event.preventDefault();
    event.stopPropagation();
    this.closeNodeMenu();
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const scale = this.canvasScale();
    this.edgeMenu.set({
      edgeId: edge.id,
      x: (event.clientX - rect.left) / scale,
      y: (event.clientY - rect.top) / scale,
    });
  }

  protected closeEdgeMenu(): void {
    if (this.edgeMenu()) this.edgeMenu.set(null);
  }

  /** "Manage rules" menu entry: open the rules editor dialog. */
  protected openRulesEditor(edgeId: string): void {
    this.closeEdgeMenu();
    this.addRuleMenuOpen.set(false);
    this.rulesEditorEdgeId.set(edgeId);
  }

  protected closeRulesEditor(): void {
    this.addRuleMenuOpen.set(false);
    this.rulesEditorEdgeId.set(null);
  }

  /** Toggle the "Add rule" dropdown (If / Action) inside the rules dialog. */
  protected toggleAddRuleMenu(): void {
    this.addRuleMenuOpen.update((open) => !open);
  }

  /** "Disconnect" menu entry (red): remove the edge and its rules. */
  protected disconnectFromMenu(edgeId: string): void {
    this.closeEdgeMenu();
    if (this.rulesEditorEdgeId() === edgeId) this.rulesEditorEdgeId.set(null);
    this.store.removeEdge(edgeId);
  }

  // --- rule editing --------------------------------------------------------
  protected variablesFor(nodeId: string): ClearpipeFlowVariable[] {
    const node = this.nodes().find((item) => item.id === nodeId);
    return node ? flowNodeVariables(node) : [];
  }

  protected nodeLabel(nodeId: string): string {
    return this.nodes().find((item) => item.id === nodeId)?.label ?? nodeId;
  }

  protected isValueOperator(operator: ClearpipeFlowRuleOperator): boolean {
    return CLEARPIPE_FLOW_RULE_VALUE_OPERATORS.includes(operator);
  }

  protected trackRule = (_: number, rule: ClearpipeFlowEdgeRule) => rule.id;
  protected trackCondition = (_: number, condition: ClearpipeFlowRuleCondition) => condition.id;

  protected addRule(edgeId: string): void {
    const defaultSource = this.ruleSourceNodes()[0]?.id ?? '';
    const variable = defaultSource ? this.variablesFor(defaultSource)[0]?.key ?? 'status' : 'status';
    this.store.addEdgeRule(edgeId, {
      action: 'continue',
      conditions: defaultSource
        ? [{id: `cond-${crypto.randomUUID()}`, sourceNodeId: defaultSource, variable, operator: 'eq', value: ''}]
        : [],
    });
    this.addRuleMenuOpen.set(false);
  }

  /** "Action" option: add an unconditional rule (a Then with no If clauses). */
  protected addActionRule(edgeId: string): void {
    this.store.addEdgeRule(edgeId, {action: 'continue', conditions: []});
    this.addRuleMenuOpen.set(false);
  }

  protected removeRule(edgeId: string, ruleId: string): void {
    this.store.removeEdgeRule(edgeId, ruleId);
  }

  protected setRuleAction(edgeId: string, ruleId: string, action: ClearpipeFlowRuleAction): void {
    this.store.updateEdgeRule(edgeId, ruleId, {action});
  }

  protected addCondition(edgeId: string, rule: ClearpipeFlowEdgeRule): void {
    const defaultSource = this.ruleSourceNodes()[0]?.id ?? '';
    const variable = defaultSource ? this.variablesFor(defaultSource)[0]?.key ?? 'status' : 'status';
    const condition: ClearpipeFlowRuleCondition = {
      id: `cond-${crypto.randomUUID()}`,
      sourceNodeId: defaultSource,
      variable,
      operator: 'eq',
      value: '',
      connector: rule.conditions.length ? 'and' : undefined,
    };
    this.store.updateEdgeRule(edgeId, rule.id, {conditions: [...rule.conditions, condition]});
  }

  protected removeCondition(edgeId: string, rule: ClearpipeFlowEdgeRule, conditionId: string): void {
    const conditions = rule.conditions.filter((condition) => condition.id !== conditionId);
    if (conditions.length) conditions[0] = {...conditions[0], connector: undefined};
    this.store.updateEdgeRule(edgeId, rule.id, {conditions});
  }

  protected updateCondition(
    edgeId: string,
    rule: ClearpipeFlowEdgeRule,
    conditionId: string,
    patch: Partial<ClearpipeFlowRuleCondition>,
  ): void {
    const conditions = rule.conditions.map((condition) => {
      if (condition.id !== conditionId) return condition;
      const next = {...condition, ...patch};
      // Switching the source node resets the variable to that node's first one.
      if (patch.sourceNodeId && patch.sourceNodeId !== condition.sourceNodeId) {
        next.variable = this.variablesFor(patch.sourceNodeId)[0]?.key ?? 'status';
      }
      return next;
    });
    this.store.updateEdgeRule(edgeId, rule.id, {conditions});
  }

  // --- window listener lifecycle ------------------------------------------
  private attachWindowListeners(): void {
    if (this.windowListeners.length) return;
    window.addEventListener('pointermove', this.onWindowPointerMove);
    window.addEventListener('pointerup', this.onWindowPointerUp);
    this.windowListeners = [
      () => window.removeEventListener('pointermove', this.onWindowPointerMove),
      () => window.removeEventListener('pointerup', this.onWindowPointerUp),
    ];
  }

  private detachWindowListeners(): void {
    this.windowListeners.forEach((dispose) => dispose());
    this.windowListeners = [];
  }
}
