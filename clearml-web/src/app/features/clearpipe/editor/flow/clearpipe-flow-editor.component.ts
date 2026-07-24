import {ChangeDetectionStrategy, Component, effect, ElementRef, inject, signal, viewChild} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {Router, RouterLink} from '@angular/router';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {Store} from '@ngrx/store';
import {finalize} from 'rxjs';
import {addMessage} from '@common/core/actions/layout.actions';

import {ClearpipeApiService} from '../../clearpipe-api.service';
import {createEmptyGraphV2} from '../../domain/graph-store.service';
import {ClearpipeFlowPaletteComponent} from './clearpipe-flow-palette.component';
import {ClearpipeFlowCanvasComponent} from './clearpipe-flow-canvas.component';
import {ClearpipeFlowConfigPanelComponent} from './clearpipe-flow-config-panel.component';
import {ClearpipeFlowStoreService} from './clearpipe-flow-store.service';
import {ClearpipeFlowResourcesService, FlowResourceOption} from './clearpipe-flow-resources.service';
import {ClearpipeFlowGraph, emptyClearpipeFlowGraph} from './clearpipe-flow.models';

/**
 * clearpipe-main-style flow editor shell for /clearpipe/new. Hosts the drag-only
 * palette, the flow canvas, and the node inspector, and owns the toolbar + shared
 * theme tokens. All graph state lives in ClearpipeFlowStoreService.
 */
@Component({
  selector: 'sm-clearpipe-flow-editor',
  templateUrl: './clearpipe-flow-editor.component.html',
  styleUrls: ['./clearpipe-flow-editor.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ClearpipeFlowStoreService, ClearpipeFlowResourcesService],
  imports: [
    FormsModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    ClearpipeFlowPaletteComponent,
    ClearpipeFlowCanvasComponent,
    ClearpipeFlowConfigPanelComponent,
  ],
})
export class ClearpipeFlowEditorComponent {
  protected readonly store = inject(ClearpipeFlowStoreService);
  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  private readonly api = inject(ClearpipeApiService);
  private readonly resources = inject(ClearpipeFlowResourcesService);
  private readonly router = inject(Router);
  private readonly appStore = inject(Store);

  protected readonly graph = this.store.graph;
  protected readonly dirty = this.store.dirty;
  protected readonly saving = signal(false);

  /** Execution queues used to satisfy the compiler's default-queue requirement. */
  private readonly queues = signal<FlowResourceOption[]>([]);

  /** Collapsed state for the left palette and right configuration panels. */
  protected readonly paletteCollapsed = signal(false);
  protected readonly inspectorCollapsed = signal(true);

  constructor() {
    if (this.store.isEmpty()) this.store.reset();

    this.resources.listQueues().subscribe(items => this.queues.set(items));

    // Mirror the configuration panel to the canvas selection: expand when a node
    // or a boundary is selected, collapse when the selection is cleared.
    effect(() => {
      const nothingSelected =
        this.store.selectedNodeId() === null && this.store.selectedBoundaryId() === null;
      this.inspectorCollapsed.set(nothingSelected);
    });
  }

  protected togglePalette(): void {
    this.paletteCollapsed.update(collapsed => !collapsed);
  }

  protected toggleInspector(): void {
    this.inspectorCollapsed.update(collapsed => !collapsed);
  }

  protected name(): string {
    return this.graph().name;
  }

  protected setName(name: string): void {
    this.store.updateMetadata({name});
  }

  protected newPipeline(): void {
    this.store.reset();
  }

  protected save(): void {
    if (this.saving()) return;
    const flow = this.graph();
    const queueId = this.resolveExecutionQueue(flow);
    if (!queueId) {
      this.appStore.dispatch(addMessage(
        'error',
        'Cannot save: select an execution queue on a node, or create a queue in Workers & Queues first.',
      ));
      return;
    }
    const name = flow.name.trim() || 'Untitled ClearPipe';
    const graph = createEmptyGraphV2({
      name: this.generatedName(name),
      description: flow.description,
    });
    // Every generated step needs a resolvable execution queue; expose the chosen
    // queue as a graph resource and set it as the graph's default (CPSEM008).
    graph.settings = {default_execution_queue_id: 'queue_default'};
    graph.resources = [{
      id: 'queue_default',
      kind: 'queue',
      resource_id: queueId,
      ...(this.queues().find(queue => queue.id === queueId)?.name
        ? {label: this.queues().find(queue => queue.id === queueId)!.name}
        : {}),
    }];
    graph.nodes = [{
      id: 'clearpipe_flow',
      kind: 'function',
      name: 'clearpipe_flow',
      label: name,
      ports: [{
        id: 'result',
        kind: 'port',
        name: 'result',
        direction: 'output',
        role: 'data',
        required: false,
        multiplicity: 'many',
        accepted_binding_kinds: ['data'],
        order: 0,
      }],
      visual: {position: {x: 0, y: 0}},
      signature: 'def clearpipe_flow() -> object',
      source: 'def clearpipe_flow() -> object:\n    return None\n',
      configuration: {task_type: 'application'},
    }];

    this.saving.set(true);
    this.api.createDefinition({name, description: flow.description, graph}).pipe(
      finalize(() => this.saving.set(false)),
    ).subscribe({
      next: () => {
        this.store.markSaved(flow);
        this.appStore.dispatch(addMessage('success', 'ClearPipe definition saved'));
        this.router.navigate(['/clearpipe']);
      },
      error: () => this.appStore.dispatch(addMessage('error', 'Failed to save ClearPipe definition')),
    });
  }

  private generatedName(name: string): string {
    const normalized = name.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    return /^[A-Za-z]/.test(normalized) ? normalized : `clearpipe_${normalized || 'flow'}`;
  }

  /** Prefer a queue explicitly configured on a node, else the first available queue. */
  private resolveExecutionQueue(flow: ClearpipeFlowGraph): string | undefined {
    const fromNodes = flow.nodes
      .flatMap(node => [node.config['queue'], node.config['createQueue']])
      .find((value): value is string => typeof value === 'string' && value.length > 0);
    return fromNodes ?? this.queues()[0]?.id;
  }

  protected run(): void {
    // Start a new pipeline sequence from the scheduled entry points (firing any
    // scheduled node flagged "fire when started"), honoring boundary scope.
    this.store.startSequence();
  }

  protected exportPipeline(): void {
    const blob = new Blob([JSON.stringify(this.graph(), null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${this.graph().name || 'clearpipe'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected triggerImport(): void {
    this.fileInput().nativeElement.click();
  }

  protected async importPipeline(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Partial<ClearpipeFlowGraph>;
      this.store.load({...emptyClearpipeFlowGraph(), ...parsed} as ClearpipeFlowGraph);
    } catch {
      // Ignore malformed files; the current graph is preserved.
    } finally {
      input.value = '';
    }
  }
}
