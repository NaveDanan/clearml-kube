import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  Signal,
  signal,
  viewChild
} from '@angular/core';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {ClearpipeStateService} from '../clearpipe-state.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {
  ClearpipeDefinition,
  ClearpipeValidationResult,
  emptyClearpipeDefinition,
  findSecretPaths,
  findUnsafeObjectPaths,
  graphContainsSecret,
  normalizeDefinition
} from '../clearpipe.models';
import {GRAPH_V2_SCHEMA_VERSION} from '../domain/graph-v2.types';
import {ClearpipeCanvasComponent} from './clearpipe-canvas.component';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatMenuModule} from '@angular/material/menu';
import {MatDialog} from '@angular/material/dialog';
import {ClearpipeNameDialogComponent} from './clearpipe-dialogs.component';
import {ConfirmDialogComponent} from '@common/shared/ui-components/overlay/confirm-dialog/confirm-dialog.component';
import {Store} from '@ngrx/store';
import {addMessage} from '@common/core/actions/layout.actions';
import {HttpErrorResponse} from '@angular/common/http';
import {finalize} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ClearpipeWorkspaceSlotDirective, WorkspacePanel, WorkspaceRouteSurface} from './clearpipe-workspace-slots';

@Component({
  selector: 'sm-clearpipe-editor',
  templateUrl: './clearpipe-editor.component.html',
  styleUrl: './clearpipe-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ClearpipeStateService],
  imports: [
    RouterLink,
    ClearpipeCanvasComponent,
    ClearpipeWorkspaceSlotDirective,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
  ],
})
export class ClearpipeEditorComponent {
  protected state = inject(ClearpipeStateService);
  private api = inject(ClearpipeApiService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private store = inject(Store);
  private host = inject(ElementRef<HTMLElement>);
  private canvasRegion = viewChild<ElementRef<HTMLElement>>('canvasRegion');
  private paletteHeading = viewChild<ElementRef<HTMLElement>>('paletteHeading');
  private inspectorHeading = viewChild<ElementRef<HTMLElement>>('inspectorHeading');

  readonly isDirty: Signal<boolean> = this.state.dirty;
  protected validation = signal<ClearpipeValidationResult | null>(null);
  protected validationOpen = signal(false);
  protected saving = signal(false);
  protected readOnly = signal(false);
  protected routeSurface = signal<WorkspaceRouteSurface>('loading');
  protected routeError = signal('');
  protected activeDrawer = signal<WorkspacePanel | null>(null);
  protected paletteOpen = signal(true);
  protected inspectorOpen = signal(true);
  protected paletteWidth = signal(280);
  protected inspectorWidth = signal(360);
  protected isNarrow = signal(typeof window !== 'undefined' && window.innerWidth < 960);
  protected announcement = signal('');
  protected readonly canEdit = computed(() => this.routeSurface() === 'ready' && !this.readOnly());
  protected readonly firstUse = computed(() => this.routeSurface() === 'ready' && !this.readOnly() && !this.state.definition().nodes.length);
  protected readonly panelTracks = computed(() => ({
    palette: this.paletteOpen() ? `${this.paletteWidth()}px` : '0px',
    inspector: this.inspectorOpen() ? `${this.inspectorWidth()}px` : '0px',
  }));
  private currentTaskId: string | null = null;
  private requestedTaskId: string | null = null;
  private resizingPanel: WorkspacePanel | null = null;
  private focusReturnTarget: HTMLElement | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const taskId = params.get('taskId');
      if (taskId) {
        this.handleRouteTask(taskId);
      } else {
        this.currentTaskId = null;
        this.requestedTaskId = null;
        this.state.load({...emptyClearpipeDefinition(), schema_version: GRAPH_V2_SCHEMA_VERSION});
        this.readOnly.set(false);
        this.routeSurface.set('ready');
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
    const width = this.resizingPanel === 'palette'
      ? event.clientX - bounds.left
      : bounds.right - event.clientX;
    this.setPanelWidth(this.resizingPanel, width);
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
      if (this.canEdit()) this.save();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.state.redo();
      else this.state.undo();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.state.redo();
    } else if (!editing && ['Delete', 'Backspace'].includes(event.key) && this.state.selectedNodeId() && this.canEdit()) {
      event.preventDefault();
      this.state.removeNode(this.state.selectedNodeId()!);
    } else if (!editing && event.key === 'Escape') {
      this.state.connectionSource.set(null);
      this.state.selectedNodeId.set(null);
    }
  }

  protected togglePanel(panel: WorkspacePanel, invoker?: HTMLElement): void {
    if (this.isNarrow()) {
      if (this.activeDrawer() === panel) {
        this.closeDrawer();
      } else {
        this.openDrawer(panel, invoker);
      }
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
    this.announce(`${panel === 'palette' ? 'Authoring catalog' : 'Inspector'} expanded`);
  }

  protected closeDrawer(): void {
    if (!this.activeDrawer()) return;
    const closed = this.activeDrawer();
    this.activeDrawer.set(null);
    this.announce(`${closed === 'palette' ? 'Authoring catalog' : 'Inspector'} drawer closed`);
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
    const current = panel === 'palette' ? this.paletteWidth() : this.inspectorWidth();
    const width = event.key === 'Home' ? 240 : event.key === 'End' ? 480 : current + (event.key === 'ArrowRight' ? 24 : -24);
    this.setPanelWidth(panel, width);
    this.announce(`${panel === 'palette' ? 'Authoring catalog' : 'Inspector'} width ${this.panelWidth(panel)} pixels`);
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

  protected save(): void {
    if (!this.canEdit() || this.saving()) return;
    const definition = this.state.definition();
    const secretPaths = findSecretPaths({nodes: definition.nodes});
    if (secretPaths.length) {
      this.store.dispatch(addMessage('error', `ClearPipe graphs cannot contain credentials or secret values (${secretPaths[0]})`));
      return;
    }
    if (!definition.task_id && !definition.id && definition.name === 'Untitled ClearPipe') {
      this.openNameDialog(false);
      return;
    }
    this.persist(definition, false);
  }

  protected saveAs(): void {
    if (this.canEdit()) this.openNameDialog(true);
  }

  protected validate(): void {
    if (this.routeSurface() !== 'ready') return;
    this.api.validate(this.state.definition()).subscribe({
      next: result => {
        this.validation.set(result);
        this.validationOpen.set(true);
        this.announce(result.valid ? 'ClearPipe graph is valid' : `ClearPipe validation found ${result.errors.length} errors`);
        this.store.dispatch(addMessage(result.valid ? 'success' : 'warn', result.valid ? 'ClearPipe graph is valid' : 'ClearPipe validation found issues'));
      },
      error: () => this.store.dispatch(addMessage('error', 'ClearPipe validation failed')),
    });
  }

  protected exportJson(): void {
    const definition = this.state.definition();
    const unsafePaths = findUnsafeObjectPaths(definition);
    if (unsafePaths.length) {
      this.store.dispatch(addMessage('error', `Export blocked because an unsafe key exists at ${unsafePaths[0]}`));
      return;
    }
    const secretPaths = findSecretPaths({nodes: definition.nodes});
    if (secretPaths.length) {
      this.store.dispatch(addMessage('error', `Export blocked because a secret-like field exists at ${secretPaths[0]}`));
      return;
    }
    const data = JSON.stringify(definition, null, 2);
    const url = URL.createObjectURL(new Blob([data], {type: 'application/json'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${definition.name.replace(/[^a-z0-9_-]+/gi, '-') || 'clearpipe'}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  protected importJson(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      this.store.dispatch(addMessage('error', 'ClearPipe import is larger than the 4 MiB server graph limit'));
      return;
    }
    file.text().then(text => {
      try {
        const parsed = JSON.parse(text);
        const unsafePaths = findUnsafeObjectPaths(parsed);
        if (unsafePaths.length) throw new Error(`contains an unsafe object key at ${unsafePaths[0]}`);
        if (graphContainsSecret(parsed)) throw new Error('contains credentials or secrets');
        const definition = normalizeDefinition(parsed);
        if (definition.schema_version !== GRAPH_V2_SCHEMA_VERSION) throw new Error('is not a supported ClearPipe v2 definition');
        if (!Array.isArray(definition.nodes) || !Array.isArray(definition.edges)) throw new Error('does not contain a valid graph');
        definition.id = undefined;
        definition.task_id = undefined;
        definition.revision = 0;
        definition.name = `${definition.name} (imported)`;
        this.state.load(definition);
        this.state.updateMetadata({name: definition.name});
        this.store.dispatch(addMessage('success', 'ClearPipe JSON imported'));
      } catch (error) {
        this.store.dispatch(addMessage('error', `Invalid ClearPipe import: ${(error as Error).message}`));
      }
    });
  }

  protected archive(): void {
    const definition = this.state.definition();
    const id = definition.task_id ?? definition.id;
    if (!id || !this.canEdit()) return;
    this.confirm('Archive ClearPipe definition?', `“${definition.name}” will move to the archive.`, 'ARCHIVE', () => {
      this.api.archive(id, true, definition.revision).subscribe({
        next: () => {
          this.store.dispatch(addMessage('success', 'ClearPipe definition archived'));
          this.router.navigate(['/clearpipe']);
        },
        error: () => this.store.dispatch(addMessage('error', 'Failed to archive ClearPipe definition')),
      });
    });
  }

  protected delete(): void {
    const definition = this.state.definition();
    const id = definition.task_id ?? definition.id;
    if (!id || !this.canEdit()) return;
    this.confirm('Delete ClearPipe definition?', `“${definition.name}” will be permanently deleted.`, 'DELETE', () => {
      this.api.delete(id, definition.revision).subscribe({
        next: () => {
          this.store.dispatch(addMessage('success', 'ClearPipe definition deleted'));
          this.router.navigate(['/clearpipe']);
        },
        error: () => this.store.dispatch(addMessage('error', 'Failed to delete ClearPipe definition')),
      });
    });
  }

  private load(taskId: string): void {
    this.requestedTaskId = taskId;
    this.routeSurface.set('loading');
    this.routeError.set('');
    this.state.loading.set(true);
    this.api.getById(taskId).pipe(finalize(() => this.state.loading.set(false))).subscribe({
      next: definition => {
        const unsafePaths = findUnsafeObjectPaths(definition);
        if (unsafePaths.length) {
          this.showRouteFailure('error', `The requested definition cannot be displayed safely (${unsafePaths[0]}).`);
          return;
        }
        const secretPaths = findSecretPaths({nodes: definition.nodes});
        if (secretPaths.length) {
          this.showRouteFailure('error', `The requested definition cannot be displayed safely (${secretPaths[0]}).`);
          return;
        }
        this.state.load(definition);
        this.currentTaskId = taskId;
        if (definition.schema_version !== GRAPH_V2_SCHEMA_VERSION) {
          this.readOnly.set(true);
          this.showRouteFailure('unsupported', 'This definition is unsupported for ClearPipe editing. Its source remains unchanged.');
          return;
        }
        this.readOnly.set(definition.can_edit === false);
        this.routeSurface.set('ready');
        this.announce(this.readOnly() ? 'ClearPipe definition loaded read-only' : 'ClearPipe definition loaded');
      },
      error: error => this.handleLoadError(error),
    });
  }

  private openNameDialog(saveAs: boolean): void {
    const definition = this.state.definition();
    this.dialog.open(ClearpipeNameDialogComponent, {
      data: {title: saveAs ? 'Save ClearPipe as' : 'Name ClearPipe definition', name: saveAs ? `${definition.name} copy` : definition.name, description: definition.description},
      width: '500px',
    }).afterClosed().subscribe(result => {
      if (!result) return;
      const candidate = {...definition, ...result};
      if (saveAs) {
        candidate.id = undefined;
        candidate.task_id = undefined;
        candidate.revision = 0;
      }
      this.persist(candidate, saveAs);
    });
  }

  private persist(definition: ClearpipeDefinition, create: boolean): void {
    const unsafePaths = findUnsafeObjectPaths(definition);
    if (unsafePaths.length) {
      this.store.dispatch(addMessage('error', `Save blocked because an unsafe key exists at ${unsafePaths[0]}`));
      return;
    }
    const secretPaths = findSecretPaths({nodes: definition.nodes});
    if (secretPaths.length) {
      this.store.dispatch(addMessage('error', `Save blocked because a secret-like field exists at ${secretPaths[0]}`));
      return;
    }
    this.saving.set(true);
    const request = create || !(definition.task_id ?? definition.id) ? this.api.create(definition) : this.api.update(definition);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: saved => {
        this.state.markSaved(saved);
        this.store.dispatch(addMessage('success', 'ClearPipe definition saved'));
        this.announce('ClearPipe definition saved');
        const id = saved.task_id ?? saved.id;
        if (id) this.router.navigate(['/clearpipe', id], {replaceUrl: true});
      },
      error: error => this.handleSaveError(error, definition),
    });
  }

  private handleSaveError(error: HttpErrorResponse, attempted: ClearpipeDefinition): void {
    if (error.status !== 409) {
      this.store.dispatch(addMessage('error', 'Failed to save ClearPipe definition'));
      return;
    }
    const id = attempted.task_id ?? attempted.id;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'ClearPipe revision conflict',
        body: 'This definition was updated in another session. Reload the latest server revision? Your local unsaved changes will be discarded.',
        yes: 'RELOAD LATEST',
        no: 'KEEP EDITING',
        iconClass: 'al-ico-alert',
        iconColor: 'var(--color-warning)',
        width: 480,
        centerText: true,
      }
    }).afterClosed().subscribe(reload => reload && id && this.load(id));
  }

  private handleRouteTask(taskId: string): void {
    if (!this.currentTaskId || this.currentTaskId === taskId || !this.isDirty()) {
      this.load(taskId);
      return;
    }
    const previousTaskId = this.currentTaskId;
    this.dialog.open(ConfirmDialogComponent, {
      disableClose: true,
      data: {
        title: 'Unsaved ClearPipe changes',
        body: 'Loading another definition will discard your unsaved changes. Continue?',
        yes: 'LEAVE AND LOAD',
        no: 'STAY',
        iconClass: 'al-ico-alert',
        iconColor: 'var(--color-warning)',
        centerText: true,
        width: 460,
      }
    }).afterClosed().subscribe(leave => {
      if (leave) this.load(taskId);
      else this.router.navigate(['/clearpipe', previousTaskId], {replaceUrl: true});
    });
  }

  private handleLoadError(error: unknown): void {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    if (status === 401 || status === 403) {
      this.showRouteFailure('denied', 'You do not have access to this ClearPipe definition.');
    } else if (status === 404) {
      this.showRouteFailure('not-found', 'This ClearPipe definition no longer exists or is unavailable.');
    } else {
      this.showRouteFailure('error', 'ClearPipe could not load this definition. Your current local work has not been changed.');
    }
  }

  private showRouteFailure(surface: Exclude<WorkspaceRouteSurface, 'ready' | 'loading'>, message: string): void {
    this.routeSurface.set(surface);
    this.routeError.set(message);
    this.announce(message);
  }

  private openDrawer(panel: WorkspacePanel, invoker?: HTMLElement): void {
    this.focusReturnTarget = invoker ?? document.activeElement as HTMLElement;
    this.activeDrawer.set(panel);
    this.announce(`${panel === 'palette' ? 'Authoring catalog' : 'Inspector'} drawer opened`);
    queueMicrotask(() => (panel === 'palette' ? this.paletteHeading() : this.inspectorHeading())?.nativeElement.focus());
  }

  private setPanelWidth(panel: WorkspacePanel, width: number): void {
    const clamped = Math.max(240, Math.min(480, Math.round(width)));
    if (panel === 'palette') this.paletteWidth.set(clamped);
    else this.inspectorWidth.set(clamped);
  }

  private announce(message: string): void {
    this.announcement.set('');
    queueMicrotask(() => this.announcement.set(message));
  }

  private confirm(title: string, body: string, yes: string, action: () => void): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {title, body, yes, no: 'CANCEL', iconClass: 'al-ico-alert', iconColor: 'var(--color-warning)', centerText: true, width: 440}
    }).afterClosed().subscribe(confirmed => confirmed && action());
  }
}
