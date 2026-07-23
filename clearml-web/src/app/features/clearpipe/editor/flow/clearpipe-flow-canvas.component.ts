import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';

import {
  ClearpipeFlowBoundary,
  ClearpipeFlowNode,
  ClearpipeFlowNodeType,
  ClearpipeFlowPoint,
  clearpipeFlowNodeMeta,
  DATASET_MODE_LABELS,
} from './clearpipe-flow.models';
import {ClearpipeFlowStoreService} from './clearpipe-flow-store.service';

const NODE_W = 240;
const NODE_H = 92;
const CLICK_THRESHOLD = 4;
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
  running: '#3b82f6',
  completed: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
};

interface EdgeView {
  id: string;
  path: string;
  accent: string;
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
})
export class ClearpipeFlowCanvasComponent {
  protected readonly store = inject(ClearpipeFlowStoreService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly canvasRef = viewChild.required<ElementRef<HTMLDivElement>>('canvas');

  protected readonly nodes = this.store.nodes;
  protected readonly edges = this.store.edges;
  protected readonly boundaries = this.store.boundaries;
  protected readonly containedNodeIds = this.store.containedNodeIds;
  protected readonly viewport = this.store.viewport;
  protected readonly selectedNodeId = this.store.selectedNodeId;
  protected readonly selectedBoundaryId = this.store.selectedBoundaryId;
  protected readonly statusColors = STATUS_COLORS;

  protected readonly panning = signal(false);
  protected readonly connecting = signal(false);
  private readonly pendingCursor = signal<ClearpipeFlowPoint | null>(null);

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
      return [{
        id: edge.id,
        path: this.edgePath(
          {x: source.position.x + NODE_W, y: source.position.y + NODE_H / 2},
          {x: target.position.x, y: target.position.y + NODE_H / 2},
        ),
        accent: clearpipeFlowNodeMeta(source.type).accent,
      }];
    });
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
    nodeId: string;
    startClient: {x: number; y: number};
    startPos: ClearpipeFlowPoint;
    moved: boolean;
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

  constructor() {
    this.destroyRef.onDestroy(() => this.detachWindowListeners());
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

  protected trackNode = (_: number, node: ClearpipeFlowNode) => node.id;
  protected trackEdge = (_: number, edge: EdgeView) => edge.id;
  protected trackBoundary = (_: number, boundary: ClearpipeFlowBoundary) => boundary.id;

  // --- coordinate helpers --------------------------------------------------
  private graphPointFromClient(clientX: number, clientY: number): ClearpipeFlowPoint {
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const vp = this.viewport();
    return {x: (clientX - rect.left - vp.x) / vp.zoom, y: (clientY - rect.top - vp.y) / vp.zoom};
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
    this.move = {
      nodeId: node.id,
      startClient: {x: event.clientX, y: event.clientY},
      startPos: {...node.position},
      moved: false,
    };
    this.attachWindowListeners();
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
    if (event.button !== 0) return;
    this.pan = {
      startClient: {x: event.clientX, y: event.clientY},
      startVp: {x: this.viewport().x, y: this.viewport().y},
    };
    this.panning.set(true);
    this.store.selectNode(null);
    this.store.selectBoundary(null);
    this.store.cancelConnection();
    this.attachWindowListeners();
  }

  private onWindowPointerMove = (event: PointerEvent): void => {
    if (this.move) {
      const zoom = this.viewport().zoom;
      const dx = event.clientX - this.move.startClient.x;
      const dy = event.clientY - this.move.startClient.y;
      if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) this.move.moved = true;
      this.store.moveNode(this.move.nodeId, {
        x: this.move.startPos.x + dx / zoom,
        y: this.move.startPos.y + dy / zoom,
      });
      return;
    }
    if (this.boundaryMove) {
      const zoom = this.viewport().zoom;
      const dx = event.clientX - this.boundaryMove.startClient.x;
      const dy = event.clientY - this.boundaryMove.startClient.y;
      if (Math.abs(dx) > CLICK_THRESHOLD || Math.abs(dy) > CLICK_THRESHOLD) this.boundaryMove.moved = true;
      this.store.moveBoundary(this.boundaryMove.id, {
        x: this.boundaryMove.startPos.x + dx / zoom,
        y: this.boundaryMove.startPos.y + dy / zoom,
      });
      return;
    }
    if (this.boundaryResize) {
      const zoom = this.viewport().zoom;
      const dx = event.clientX - this.boundaryResize.startClient.x;
      const dy = event.clientY - this.boundaryResize.startClient.y;
      this.store.resizeBoundary(this.boundaryResize.id, {
        width: Math.max(BOUNDARY_MIN_W, this.boundaryResize.startSize.width + dx / zoom),
        height: Math.max(BOUNDARY_MIN_H, this.boundaryResize.startSize.height + dy / zoom),
      });
      return;
    }
    if (this.store.connectingFrom()) {
      this.pendingCursor.set(this.graphPointFromClient(event.clientX, event.clientY));
      return;
    }
    if (this.pan) {
      const dx = event.clientX - this.pan.startClient.x;
      const dy = event.clientY - this.pan.startClient.y;
      this.store.setViewport({...this.viewport(), x: this.pan.startVp.x + dx, y: this.pan.startVp.y + dy});
    }
  };

  private onWindowPointerUp = (event: PointerEvent): void => {
    if (this.move) {
      const {nodeId, moved} = this.move;
      this.move = null;
      if (moved) this.store.commitMove();
      else this.store.selectNode(nodeId);
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
    const nextZoom = this.clampZoom(vp.zoom * (event.deltaY < 0 ? 1.1 : 0.9));
    const gx = (event.clientX - rect.left - vp.x) / vp.zoom;
    const gy = (event.clientY - rect.top - vp.y) / vp.zoom;
    this.store.setViewport({
      x: event.clientX - rect.left - gx * nextZoom,
      y: event.clientY - rect.top - gy * nextZoom,
      zoom: nextZoom,
    });
  }

  protected zoomBy(factor: number): void {
    const vp = this.viewport();
    const rect = this.canvasRef().nativeElement.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
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
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + NODE_W));
    const maxY = Math.max(...nodes.map((node) => node.position.y + NODE_H));
    const contentWidth = maxX - minX;
    const contentHeight = maxY - minY;
    const availableWidth = Math.max(1, rect.width - FIT_VIEW_PADDING * 2);
    const availableHeight = Math.max(1, rect.height - FIT_VIEW_PADDING * 2);
    const zoom = this.clampZoom(Math.min(availableWidth / contentWidth, availableHeight / contentHeight));

    this.store.setViewport({
      x: (rect.width - contentWidth * zoom) / 2 - minX * zoom,
      y: (rect.height - contentHeight * zoom) / 2 - minY * zoom,
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
  }

  protected duplicate(event: Event, node: ClearpipeFlowNode): void {
    event.stopPropagation();
    this.store.duplicateNode(node.id);
  }

  protected remove(event: Event, node: ClearpipeFlowNode): void {
    event.stopPropagation();
    this.store.removeNode(node.id);
  }

  protected removeEdge(event: Event, edgeId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.store.removeEdge(edgeId);
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
