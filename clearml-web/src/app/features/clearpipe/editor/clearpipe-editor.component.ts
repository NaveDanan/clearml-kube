import {ChangeDetectionStrategy, Component, HostListener, inject, Signal, signal} from '@angular/core';
import {ActivatedRoute, Router, RouterLink} from '@angular/router';
import {ClearpipeStateService} from '../clearpipe-state.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {
  ClearpipeDefinition,
  ClearpipeValidationResult,
  emptyClearpipeDefinition,
  graphContainsSecret,
  findSecretPaths,
  findUnsafeObjectPaths,
  normalizeDefinition
} from '../clearpipe.models';
import {ClearpipeCanvasComponent} from './clearpipe-canvas.component';
import {ClearpipeConfigPanelComponent} from './clearpipe-config-panel.component';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatMenuModule} from '@angular/material/menu';
import {MatDialog} from '@angular/material/dialog';
import {ClearpipeNameDialogComponent, ClearpipeRunDialogComponent} from './clearpipe-dialogs.component';
import {ConfirmDialogComponent} from '@common/shared/ui-components/overlay/confirm-dialog/confirm-dialog.component';
import {Store} from '@ngrx/store';
import {addMessage} from '@common/core/actions/layout.actions';
import {HttpErrorResponse} from '@angular/common/http';
import {finalize} from 'rxjs';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';

@Component({
  selector: 'sm-clearpipe-editor',
  templateUrl: './clearpipe-editor.component.html',
  styleUrl: './clearpipe-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [ClearpipeStateService],
  imports: [
    RouterLink,
    ClearpipeCanvasComponent,
    ClearpipeConfigPanelComponent,
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

  readonly isDirty: Signal<boolean> = this.state.dirty;
  protected validation = signal<ClearpipeValidationResult | null>(null);
  protected validationOpen = signal(false);
  protected saving = signal(false);
  protected loading = this.state.loading;
  protected readOnly = signal(false);
  protected lastRunTask = signal<string | null>(null);
  protected running = signal(false);
  private currentTaskId: string | null = null;

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      const taskId = params.get('taskId');
      if (taskId) this.handleRouteTask(taskId);
      else {
        this.currentTaskId = null;
        this.state.load(emptyClearpipeDefinition());
      }
    });
  }

  @HostListener('window:beforeunload', ['$event'])
  protected beforeUnload(event: BeforeUnloadEvent): void {
    if (this.isDirty()) event.preventDefault();
  }

  @HostListener('window:keydown', ['$event'])
  protected keydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!this.readOnly()) this.save();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) this.state.redo();
      else this.state.undo();
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.state.redo();
    } else if (!editing && ['Delete', 'Backspace'].includes(event.key) && this.state.selectedNodeId() && !this.readOnly()) {
      event.preventDefault();
      this.state.removeNode(this.state.selectedNodeId()!);
    } else if (event.key === 'Escape') {
      this.state.connectionSource.set(null);
      this.state.selectedNodeId.set(null);
    }
  }

  protected save(): void {
    if (this.readOnly() || this.saving()) return;
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
    if (!this.readOnly()) this.openNameDialog(true);
  }

  protected validate(): void {
    this.api.validate(this.state.definition()).subscribe({
      next: result => {
        this.validation.set(result);
        this.validationOpen.set(true);
        this.store.dispatch(addMessage(result.valid ? 'success' : 'warn', result.valid ? 'ClearPipe graph is valid' : 'ClearPipe validation found issues'));
      },
      error: () => this.store.dispatch(addMessage('error', 'ClearPipe validation failed')),
    });
  }

  protected run(): void {
    const definition = this.state.definition();
    const taskId = definition.task_id ?? definition.id;
    if (this.running()) return;
    if (!taskId) {
      this.store.dispatch(addMessage('warn', 'Save the ClearPipe definition before running it'));
      return;
    }
    if (this.isDirty()) {
      this.store.dispatch(addMessage('warn', 'Save your changes before running the pipeline'));
      return;
    }
    this.api.validate(definition).subscribe({
      next: result => {
        this.validation.set(result);
        if (!result.valid) {
          this.validationOpen.set(true);
          this.store.dispatch(addMessage('error', 'Resolve validation errors before running'));
          return;
        }
        this.api.getResources('queue').subscribe({
          next: queues => this.dialog.open(ClearpipeRunDialogComponent, {data: {queues}, width: '500px'})
            .afterClosed().subscribe(options => options && this.startRun(taskId, options.queueId, options.parameters)),
          error: () => this.store.dispatch(addMessage('error', 'Failed to load ClearML queues')),
        });
      },
      error: () => this.store.dispatch(addMessage('error', 'Could not validate the ClearPipe definition')),
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
    if (!id) return;
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
    if (!id) return;
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
    this.loading.set(true);
    this.api.getById(taskId).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: definition => {
        const unsafePaths = findUnsafeObjectPaths(definition);
        if (unsafePaths.length) {
          this.store.dispatch(addMessage('error', `Server definition rejected because it contains an unsafe key at ${unsafePaths[0]}`));
          this.restoreCurrentRoute(taskId);
          return;
        }
        const secretPaths = findSecretPaths({nodes: definition.nodes});
        if (secretPaths.length) {
          this.store.dispatch(addMessage('error', `Server definition rejected because it contains a secret-like field at ${secretPaths[0]}`));
          this.restoreCurrentRoute(taskId);
          return;
        }
        this.state.load(definition);
        this.currentTaskId = taskId;
        this.readOnly.set(definition.can_edit === false);
      },
      error: () => {
        this.store.dispatch(addMessage('error', 'Failed to load ClearPipe definition'));
        this.restoreCurrentRoute(taskId);
      },
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

  private startRun(taskId: string, queueId: string, parameters: Record<string, unknown>): void {
    if (this.running()) return;
    if (graphContainsSecret(parameters)) {
      this.store.dispatch(addMessage('error', 'Run parameter overrides cannot contain credentials or secrets'));
      return;
    }
    this.running.set(true);
    this.api.start(taskId, queueId, parameters, this.state.definition().revision).pipe(finalize(() => this.running.set(false))).subscribe({
      next: response => {
        this.lastRunTask.set(response.run_task_id);
        this.store.dispatch(addMessage('success', 'ClearPipe run enqueued'));
      },
      error: () => this.store.dispatch(addMessage('error', 'Failed to start ClearPipe run')),
    });
  }

  private confirm(title: string, body: string, yes: string, action: () => void): void {
    this.dialog.open(ConfirmDialogComponent, {
      data: {title, body, yes, no: 'CANCEL', iconClass: 'al-ico-alert', iconColor: 'var(--color-warning)', centerText: true, width: 440}
    }).afterClosed().subscribe(confirmed => confirmed && action());
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

  private restoreCurrentRoute(failedTaskId: string): void {
    if (this.currentTaskId && this.currentTaskId !== failedTaskId) {
      this.router.navigate(['/clearpipe', this.currentTaskId], {replaceUrl: true});
    } else if (!this.currentTaskId) {
      this.router.navigate(['/clearpipe']);
    }
  }
}
