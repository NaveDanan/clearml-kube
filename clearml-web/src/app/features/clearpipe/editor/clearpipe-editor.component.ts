import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeCanvasComponent} from './clearpipe-canvas.component';
import {ClearpipeCodePreviewComponent} from './clearpipe-code-preview.component';
import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';
import {ClearpipeToolbarComponent} from './clearpipe-toolbar.component';
import {ClearpipeWorkspaceSlotDirective, WorkspacePanel, WorkspaceRouteSurface} from './clearpipe-workspace-slots';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeValidationResult} from '../clearpipe.models';
import {ClearpipeCatalogComponent} from './framework/clearpipe-catalog.component';
import {ClearpipeExtensionRegistry} from './framework/clearpipe-extension-registry';
import {
  ClearpipeCatalogActionRequest,
  ClearpipeCatalogDropRequest,
  ClearpipeCatalogEntry,
  ClearpipeCatalogPresentation,
  ClearpipeInspectorPresentation,
  ClearpipeValidationPresentation,
} from './framework/clearpipe-ui.types';
import {ClearpipeConfigPanelComponent} from './clearpipe-config-panel.component';
import {ClearpipeExecutionService} from './execution/clearpipe-execution.service';
import {ClearpipeExecutionResultsComponent} from './execution/clearpipe-execution-results.component';

@Component({
  selector: 'sm-clearpipe-editor',
  templateUrl: './clearpipe-editor.component.html',
  styleUrl: './clearpipe-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ClearpipeExecutionService],
  imports: [
    RouterLink,
    ClearpipeCanvasComponent,
    ClearpipeCodePreviewComponent,
    ClearpipeCatalogComponent,
    ClearpipeConfigPanelComponent,
    ClearpipeToolbarComponent,
    ClearpipeExecutionResultsComponent,
    ClearpipeWorkspaceSlotDirective,
    MatButtonModule,
    MatIconModule,
  ],
})
export class ClearpipeEditorComponent {
  protected readonly lifecycle = inject(ClearpipeLifecycleService);
  protected readonly state = this.lifecycle.graphStore;
  protected readonly extensionRegistry = inject(ClearpipeExtensionRegistry);
  private readonly adapter = inject(ClearpipeAdapterService);
  protected readonly execution = inject(ClearpipeExecutionService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly canvasRegion = viewChild<ElementRef<HTMLElement>>('canvasRegion');
  private readonly paletteHeading = viewChild<ElementRef<HTMLElement>>('paletteHeading');
  private readonly inspectorHeading = viewChild<ElementRef<HTMLElement>>('inspectorHeading');
  private readonly paletteDrawer = viewChild<ElementRef<HTMLElement>>('paletteDrawer');
  private readonly inspectorDrawer = viewChild<ElementRef<HTMLElement>>('inspectorDrawer');

  protected readonly graph = this.lifecycle.graph;
  protected readonly isDirty = this.lifecycle.dirty;
  protected readonly validation = signal<ClearpipeValidationResult | null>(null);
  protected readonly validationOpen = signal(false);
  protected readonly previewOpen = signal(false);
  protected readonly routeSurface = signal<WorkspaceRouteSurface>('loading');
  protected readonly routeError = signal('');
  protected readonly activeDrawer = signal<WorkspacePanel | null>(null);
  protected readonly paletteOpen = signal(true);
  protected readonly inspectorOpen = signal(true);
  protected readonly paletteWidth = signal(280);
  protected readonly inspectorWidth = signal(360);
  protected readonly isNarrow = signal(typeof window !== 'undefined' && window.innerWidth < 960);
  protected readonly announcement = signal('');
  protected readonly catalogActionMessage = signal('');
  protected readonly readOnly = this.lifecycle.readOnly;
  protected readonly canEdit = computed(() => this.routeSurface() === 'ready' && !this.readOnly());
  protected readonly firstUse = computed(() => this.routeSurface() === 'ready' && !this.readOnly() && !this.graph()?.nodes.length);
  protected readonly panelTracks = computed(() => ({
    palette: this.paletteOpen() ? `${this.paletteWidth()}px` : '0px',
    inspector: this.inspectorOpen() ? `${this.inspectorWidth()}px` : '0px',
  }));
  protected readonly catalogEntries = computed<readonly ClearpipeCatalogEntry[]>(() =>
    this.extensionRegistry.catalogEntries().map((entry) => {
      if (entry.disabled) return entry;
      if (this.readOnly()) {
        return {...entry, disabled: true, disabledReason: 'This definition is read-only.'};
      }
      const availability = this.extensionRegistry.catalogActionAvailability(entry.id);
      return availability.available
        ? entry
        : {...entry, disabled: true, disabledReason: availability.reason};
    }));
  protected readonly catalogPresentation = computed<ClearpipeCatalogPresentation>(() =>
    this.catalogEntries().length
      ? {state: 'ready'}
      : {state: 'empty', message: 'Task and function capabilities appear here when their feature registrations are available.'});
  protected readonly inspectorPresentation = computed<ClearpipeInspectorPresentation | null>(() => {
    const node = this.state.selectedNode();
    if (!node) return null;
    const extension = this.extensionRegistry.get(node.kind);
    const catalog = this.extensionRegistry.catalogEntries().find((entry) => entry.nodeKind === node.kind);
    return {
      node,
      title: node.label || node.name,
      typeLabel: catalog?.label ?? `${node.kind[0].toUpperCase()}${node.kind.slice(1)} node`,
      summary: extension?.summarize?.(node as never)?.text,
      readOnly: this.readOnly(),
      readOnlyReason: this.readOnly() ? 'This definition is read-only. Values remain available for review.' : undefined,
      statuses: [...(extension?.statusPresentation ?? []), ...this.execution.nodeStatuses(node.id)],
      validations: this.inspectorValidations(node.id),
    };
  });
  private requestedTaskId: string | null = null;
  private resizingPanel: WorkspacePanel | null = null;
  private focusReturnTarget: HTMLElement | null = null;

  constructor() {
    this.route.paramMap.subscribe(params => {
      const taskId = params.get('taskId');
      if (taskId && taskId !== 'new') this.load(taskId);
      else {
        this.requestedTaskId = null;
        this.execution.setRouteContext(null, false);
        this.lifecycle.new();
        this.routeSurface.set('ready');
        this.routeError.set('');
        this.announce('New ClearPipe draft');
        this.execution.setRouteContext(null, true);
        void this.execution.refresh();
      }
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.isDirty()) event.preventDefault();
  }

  @HostListener('window:resize')
  protected updateResponsiveLayout(): void {
    const narrow = window.innerWidth < 960;
    if (this.isNarrow() === narrow) return;
    this.isNarrow.set(narrow);
    this.activeDrawer.set(null);
    this.announce(narrow ? 'Compact workspace layout enabled' : 'Desktop workspace layout enabled');
  }

  @HostListener('window:pointermove', ['$event'])
  protected resizeFromPointer(event: PointerEvent): void {
    if (!this.resizingPanel || this.isNarrow()) return;
    const bounds = this.host.nativeElement.getBoundingClientRect();
    this.setPanelWidth(this.resizingPanel, this.resizingPanel === 'palette'
      ? event.clientX - bounds.left
      : bounds.right - event.clientX);
  }

  @HostListener('window:pointerup')
  protected endResize(): void {
    this.resizingPanel = null;
  }

  @HostListener('window:keydown', ['$event'])
  protected keydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
    if (event.key === 'Escape' && this.activeDrawer()) {
      event.preventDefault();
      this.closeDrawer();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.saveAndRefresh();
    } else if (!editing && ['Delete', 'Backspace'].includes(event.key) && this.state.selectedNodeId() && this.canEdit()) {
      event.preventDefault();
      this.state.removeNode(this.state.selectedNodeId()!);
    } else if (!editing && event.key === 'Escape') {
      this.state.selectedNodeId.set(null);
    }
  }

  protected togglePanel(panel: WorkspacePanel, invoker?: HTMLElement): void {
    if (this.isNarrow()) {
      if (this.activeDrawer() === panel) this.closeDrawer();
      else this.openDrawer(panel, invoker);
      return;
    }
    const open = panel === 'palette' ? this.paletteOpen : this.inspectorOpen;
    open.update(value => !value);
    this.announce(`${panel === 'palette' ? 'Authoring catalog' : 'Inspector'} ${open() ? 'expanded' : 'collapsed'}`);
  }

  protected openPanel(panel: WorkspacePanel, invoker?: HTMLElement): void {
    if (this.isNarrow()) {
      this.openDrawer(panel, invoker);
      return;
    }
    const open = panel === 'palette' ? this.paletteOpen : this.inspectorOpen;
    if (!open()) open.set(true);
  }

  protected closeDrawer(): void {
    const drawer = this.activeDrawer();
    if (!drawer) return;
    this.activeDrawer.set(null);
    this.announce(`${drawer === 'palette' ? 'Authoring catalog' : 'Inspector'} closed`);
    this.focusReturnTarget?.focus();
    this.focusReturnTarget = null;
  }

  protected beginResize(event: PointerEvent, panel: WorkspacePanel): void {
    if (this.isNarrow()) return;
    event.preventDefault();
    this.resizingPanel = panel;
    (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
  }

  protected resizeWithKeyboard(event: KeyboardEvent, panel: WorkspacePanel): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = this.panelWidth(panel);
    this.setPanelWidth(panel, event.key === 'Home' ? 240 : event.key === 'End' ? 480 : current + (event.key === 'ArrowRight' ? 24 : -24));
  }

  protected panelWidth(panel: WorkspacePanel): number {
    return panel === 'palette' ? this.paletteWidth() : this.inspectorWidth();
  }

  protected focusCanvas(): void {
    this.canvasRegion()?.nativeElement.focus();
  }

  protected trapDrawerFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.isNarrow()) return;
    const drawer = this.activeDrawer() === 'palette' ? this.paletteDrawer()?.nativeElement : this.inspectorDrawer()?.nativeElement;
    const heading = this.activeDrawer() === 'palette' ? this.paletteHeading()?.nativeElement : this.inspectorHeading()?.nativeElement;
    if (!drawer) return;
    const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === heading || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected async dispatchCatalogAction(request: ClearpipeCatalogActionRequest): Promise<void> {
    this.catalogActionMessage.set('');
    const result = await this.extensionRegistry.dispatchCatalogAction(request, {readOnly: this.readOnly()});
    if (result.status === 'dispatched') {
      this.announce(`${request.entry.label} authoring started`);
      return;
    }
    this.catalogActionMessage.set(result.message);
    this.announce(result.message);
  }

  protected allowCatalogDrop(event: DragEvent): void {
    if (this.readOnly() || !event.dataTransfer?.types.includes('application/x-clearpipe-catalog-entry')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }

  protected async dispatchCatalogDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const request = this.catalogDropRequest(event);
    if (!request) {
      const message = 'This catalog drop is no longer available. Start the drag again.';
      this.catalogActionMessage.set(message);
      this.announce(message);
      return;
    }
    await this.dispatchCatalogAction(request);
  }

  protected retryLoad(): void {
    if (this.requestedTaskId) this.load(this.requestedTaskId);
  }

  protected openLibrary(): void {
    void this.router.navigate(['/clearpipe']);
  }

  protected validate(): void {
    const graph = this.graph();
    if (!graph || this.readOnly()) return;
    this.adapter.validate({graph}).subscribe(outcome => {
      if (outcome.status === 'loading') return;
      const issues = outcome.status === 'ready' || outcome.status === 'validation_failed'
        ? outcome.data.issues
        : outcome.problem.issues ?? [{
          code: outcome.problem.code,
          message: outcome.problem.message,
          severity: 'error' as const,
        }];
      this.validation.set({
        valid: outcome.status === 'ready' && outcome.data.valid,
        errors: issues.filter(issue => issue.severity !== 'warning'),
        warnings: issues.filter(issue => issue.severity === 'warning'),
      });
      this.validationOpen.set(true);
      this.announce(outcome.status === 'ready' && outcome.data.valid
        ? 'ClearPipe graph is valid'
        : `ClearPipe validation found ${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`);
    });
  }

  protected submitExecution(): void {
    this.announce('Submitting ClearPipe run');
    void this.execution.submit().then(() => {
      const run = this.execution.run();
      this.announce(run.state === 'submitted' || run.state === 'submitted_unwatched'
        ? `ClearPipe run${run.runTaskId ? ` ${run.runTaskId}` : ''} submitted${run.state === 'submitted_unwatched' ? ' without an observed queue worker' : ''}`
        : run.message ?? 'ClearPipe run was not submitted. Check run availability.');
    });
  }

  protected async saveAndRefresh(): Promise<void> {
    await this.lifecycle.save();
    this.announce(this.lifecycle.status() === 'saved'
      ? 'ClearPipe definition saved'
      : this.lifecycle.problem()?.message ?? 'ClearPipe definition was not saved');
    if (this.execution.routeReady()) await this.execution.refresh();
  }

  protected handleToolbarSave(): void {
    void this.execution.refresh();
  }

  protected openExecutionTask(taskId: string): void {
    void this.execution.openTask(taskId);
  }

  protected openExecutionDataset(datasetId: string): void {
    void this.execution.openResource('dataset', datasetId);
  }

  protected openExecutionModel(modelId: string): void {
    void this.execution.openResource('model', modelId);
  }

  private async load(taskId: string): Promise<void> {
    this.requestedTaskId = taskId;
    this.execution.setRouteContext(taskId, false);
    this.routeSurface.set('loading');
    this.routeError.set('');
    await this.lifecycle.open(taskId);
    if (this.requestedTaskId !== taskId) return;
    const status = this.lifecycle.status();
    const identity = this.lifecycle.identity();
    if (status === 'ready' && identity?.taskId === taskId) {
      this.routeSurface.set('ready');
      this.execution.setRouteContext(taskId, true);
      this.announce(this.readOnly() ? 'ClearPipe definition loaded read-only' : 'ClearPipe definition loaded');
      await this.execution.refresh();
      return;
    } else if (status === 'read-only') {
      this.routeSurface.set('unsupported');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'This definition is read-only.');
    } else if (status === 'permission-disabled') {
      this.routeSurface.set('denied');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'You do not have access to this ClearPipe definition.');
    } else if (status === 'failed') {
      this.routeSurface.set('error');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'ClearPipe could not load this definition.');
    } else {
      this.routeSurface.set('error');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'ClearPipe could not load this definition.');
    }
    this.execution.setRouteContext(taskId, false);
  }

  private openDrawer(panel: WorkspacePanel, invoker?: HTMLElement): void {
    this.focusReturnTarget = invoker ?? document.activeElement as HTMLElement;
    this.activeDrawer.set(panel);
    this.announce(`${panel === 'palette' ? 'Authoring catalog' : 'Inspector'} opened`);
    queueMicrotask(() => (panel === 'palette' ? this.paletteHeading() : this.inspectorHeading())?.nativeElement.focus());
  }

  private setPanelWidth(panel: WorkspacePanel, width: number): void {
    const clamped = Math.max(240, Math.min(480, Math.round(width)));
    if (panel === 'palette') this.paletteWidth.set(clamped);
    else this.inspectorWidth.set(clamped);
  }

  private inspectorValidations(nodeId: string): readonly ClearpipeValidationPresentation[] {
    const validation = this.validation();
    if (!validation) return [];
    return [...validation.errors, ...validation.warnings]
      .filter((issue) => !issue.node_id || issue.node_id === nodeId)
      .map((issue) => ({
        severity: issue.severity === 'warning' ? 'warning' : 'error',
        message: issue.message,
        code: issue.code,
        targetId: issue.node_id,
      }));
  }

  private catalogDropRequest(event: DragEvent): ClearpipeCatalogDropRequest | null {
    const raw = event.dataTransfer?.getData('application/x-clearpipe-catalog-entry');
    if (!raw) return null;
    try {
      const candidate = JSON.parse(raw) as {
        entry?: {id?: unknown; registrationId?: unknown};
        method?: unknown;
      };
      if (candidate.method !== 'drop' || typeof candidate.entry?.id !== 'string'
        || typeof candidate.entry.registrationId !== 'number') return null;
      const entry = this.extensionRegistry.catalogEntry(candidate.entry.id);
      if (!entry || entry.registrationId !== candidate.entry.registrationId) return null;
      const bounds = this.canvasRegion()?.nativeElement.getBoundingClientRect();
      return {
        entry,
        method: 'drop',
        placement: {
          x: Math.max(0, Math.round(event.clientX - (bounds?.left ?? 0))),
          y: Math.max(0, Math.round(event.clientY - (bounds?.top ?? 0))),
        },
      };
    } catch {
      return null;
    }
  }

  private announce(message: string): void {
    this.announcement.set('');
    queueMicrotask(() => this.announcement.set(message));
  }
}
