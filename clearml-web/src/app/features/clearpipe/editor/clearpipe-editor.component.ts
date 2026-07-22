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

@Component({
  selector: 'sm-clearpipe-editor',
  templateUrl: './clearpipe-editor.component.html',
  styleUrl: './clearpipe-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ClearpipeCanvasComponent,
    ClearpipeCodePreviewComponent,
    ClearpipeToolbarComponent,
    ClearpipeWorkspaceSlotDirective,
    MatButtonModule,
    MatIconModule,
  ],
})
export class ClearpipeEditorComponent {
  protected readonly lifecycle = inject(ClearpipeLifecycleService);
  protected readonly state = this.lifecycle.graphStore;
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly canvasRegion = viewChild<ElementRef<HTMLElement>>('canvasRegion');
  private readonly paletteHeading = viewChild<ElementRef<HTMLElement>>('paletteHeading');
  private readonly inspectorHeading = viewChild<ElementRef<HTMLElement>>('inspectorHeading');

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
  protected readonly readOnly = this.lifecycle.readOnly;
  protected readonly canEdit = computed(() => this.routeSurface() === 'ready' && !this.readOnly());
  protected readonly firstUse = computed(() => this.routeSurface() === 'ready' && !this.readOnly() && !this.graph()?.nodes.length);
  protected readonly panelTracks = computed(() => ({
    palette: this.paletteOpen() ? `${this.paletteWidth()}px` : '0px',
    inspector: this.inspectorOpen() ? `${this.inspectorWidth()}px` : '0px',
  }));
  private requestedTaskId: string | null = null;
  private resizingPanel: WorkspacePanel | null = null;
  private focusReturnTarget: HTMLElement | null = null;

  constructor() {
    this.route.paramMap.subscribe(params => {
      const taskId = params.get('taskId');
      if (taskId && taskId !== 'new') this.load(taskId);
      else {
        this.lifecycle.new();
        this.routeSurface.set('ready');
        this.routeError.set('');
        this.announce('New ClearPipe draft');
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
      void this.lifecycle.save();
    } else if (!editing && ['Delete', 'Backspace'].includes(event.key) && this.state.selectedNodeId() && this.canEdit()) {
      event.preventDefault();
      this.state.removeNode(this.state.selectedNodeId()!);
    } else if (!editing && event.key === 'Escape') {
      this.state.selectedNodeId.set(null);
    }
  }

  protected togglePanel(panel: WorkspacePanel, invoker?: HTMLElement): void {
    if (this.isNarrow()) {
      this.activeDrawer() === panel ? this.closeDrawer() : this.openDrawer(panel, invoker);
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
    if (!this.activeDrawer()) return;
    this.activeDrawer.set(null);
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
      this.announce(outcome.status === 'ready' ? 'ClearPipe graph is valid' : 'ClearPipe validation found issues');
    });
  }

  private async load(taskId: string): Promise<void> {
    this.requestedTaskId = taskId;
    this.routeSurface.set('loading');
    this.routeError.set('');
    await this.lifecycle.open(taskId);
    const status = this.lifecycle.status();
    if (status === 'read-only') {
      this.routeSurface.set('unsupported');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'This definition is read-only.');
    } else if (status === 'permission-disabled') {
      this.routeSurface.set('denied');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'You do not have access to this ClearPipe definition.');
    } else if (status === 'failed') {
      this.routeSurface.set('error');
      this.routeError.set(this.lifecycle.problem()?.message ?? 'ClearPipe could not load this definition.');
    } else {
      this.routeSurface.set('ready');
      this.announce(this.readOnly() ? 'ClearPipe definition loaded read-only' : 'ClearPipe definition loaded');
    }
  }

  private openDrawer(panel: WorkspacePanel, invoker?: HTMLElement): void {
    this.focusReturnTarget = invoker ?? document.activeElement as HTMLElement;
    this.activeDrawer.set(panel);
    queueMicrotask(() => (panel === 'palette' ? this.paletteHeading() : this.inspectorHeading())?.nativeElement.focus());
  }

  private setPanelWidth(panel: WorkspacePanel, width: number): void {
    const clamped = Math.max(240, Math.min(480, Math.round(width)));
    panel === 'palette' ? this.paletteWidth.set(clamped) : this.inspectorWidth.set(clamped);
  }

  private announce(message: string): void {
    this.announcement.set('');
    queueMicrotask(() => this.announcement.set(message));
  }
}
