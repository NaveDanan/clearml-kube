import {ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal, viewChild} from '@angular/core';
import {CdkDrag, CdkDragDrop, CdkDragEnd, CdkDropList} from '@angular/cdk/drag-drop';
import {ClearpipeStateService} from '../clearpipe-state.service';
import {ClearpipeEdge, ClearpipeNode, ClearpipeNodeType, CLEARPIPE_NODE_TYPES} from '../clearpipe.models';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {DecimalPipe} from '@angular/common';

@Component({
  selector: 'sm-clearpipe-canvas',
  templateUrl: './clearpipe-canvas.component.html',
  styleUrl: './clearpipe-canvas.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkDrag, CdkDropList, MatIconModule, MatButtonModule, DecimalPipe],
})
export class ClearpipeCanvasComponent {
  protected state = inject(ClearpipeStateService);
  protected nodeTypes = CLEARPIPE_NODE_TYPES;
  readonly readonly = input(false);
  private canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  private panStart: {clientX: number; clientY: number; x: number; y: number} | null = null;
  protected panning = signal(false);
  protected viewport = computed(() => this.state.definition().viewport);
  protected transform = computed(() => {
    const viewport = this.viewport();
    return `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`;
  });

  protected addPaletteNode(type: ClearpipeNodeType): void {
    if (!this.readonly()) this.state.addNode(type, {x: 120, y: 120});
  }

  protected dropNode(event: CdkDragDrop<unknown>): void {
    if (this.readonly()) return;
    const type = event.item.data as ClearpipeNodeType;
    if (!this.nodeTypes.some(item => item.type === type)) return;
    const rect = this.canvas()!.nativeElement.getBoundingClientRect();
    const viewport = this.viewport();
    this.state.addNode(type, {
      x: (event.dropPoint.x - rect.left - viewport.x) / viewport.zoom,
      y: (event.dropPoint.y - rect.top - viewport.y) / viewport.zoom,
    });
  }

  protected nodeDragEnd(node: ClearpipeNode, event: CdkDragEnd): void {
    const zoom = this.viewport().zoom;
    this.state.moveNode(node.id, {x: node.position.x + event.distance.x / zoom, y: node.position.y + event.distance.y / zoom});
    event.source.reset();
  }

  protected wheel(event: WheelEvent): void {
    event.preventDefault();
    const viewport = this.viewport();
    const zoom = Math.min(2, Math.max(.35, viewport.zoom * (event.deltaY > 0 ? .9 : 1.1)));
    this.state.setViewport({...viewport, zoom});
  }

  protected beginPan(event: MouseEvent): void {
    if (event.button !== 1 && !(event.button === 0 && (event.target as HTMLElement).classList.contains('canvas-surface'))) return;
    const viewport = this.viewport();
    this.panStart = {clientX: event.clientX, clientY: event.clientY, x: viewport.x, y: viewport.y};
    this.panning.set(true);
  }

  protected pan(event: MouseEvent): void {
    if (!this.panStart) return;
    this.state.setViewport({...this.viewport(), x: this.panStart.x + event.clientX - this.panStart.clientX, y: this.panStart.y + event.clientY - this.panStart.clientY});
  }

  protected endPan(): void {
    this.panStart = null;
    this.panning.set(false);
  }

  protected selectNode(event: MouseEvent, nodeId: string): void {
    event.stopPropagation();
    this.state.selectedNodeId.set(nodeId);
  }

  protected connect(event: MouseEvent, nodeId: string): void {
    event.stopPropagation();
    if (!this.readonly()) this.state.selectConnectionNode(nodeId);
  }

  protected nodeCenter(nodeId: string): {x: number; y: number} {
    const node = this.state.definition().nodes.find(item => item.id === nodeId);
    return node ? {x: node.position.x + 92, y: node.position.y + 36} : {x: 0, y: 0};
  }

  protected edgePath(edge: ClearpipeEdge): string {
    const source = this.nodeCenter(edge.source);
    const target = this.nodeCenter(edge.target);
    const dx = Math.max(60, Math.abs(target.x - source.x) * .5);
    return `M ${source.x + 92} ${source.y} C ${source.x + dx} ${source.y}, ${target.x - dx} ${target.y}, ${target.x - 92} ${target.y}`;
  }

  protected centerGraph(): void {
    this.state.setViewport({x: 60, y: 60, zoom: 1});
  }

  protected changeZoom(delta: number, event: MouseEvent): void {
    event.stopPropagation();
    const viewport = this.viewport();
    this.state.setViewport({...viewport, zoom: Math.min(2, Math.max(.35, viewport.zoom + delta))});
  }

  protected nodeIcon(type: ClearpipeNodeType): string {
    return this.nodeTypes.find(item => item.type === type)?.icon ?? 'al-ico-pipeline';
  }
}
