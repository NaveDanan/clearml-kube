import {ChangeDetectionStrategy, Component, computed, ElementRef, inject, output, signal, viewChild} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatMenuModule} from '@angular/material/menu';
import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';
import {ClearpipeDocumentTransferService} from './clearpipe-document-transfer.service';
import {clearpipeToolbarActions, ClearpipeToolbarAction, ClearpipeToolbarActionId} from './clearpipe-toolbar.model';

@Component({
  selector: 'sm-clearpipe-toolbar',
  templateUrl: './clearpipe-toolbar.component.html',
  styleUrl: './clearpipe-toolbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatIconModule, MatMenuModule],
})
export class ClearpipeToolbarComponent {
  protected readonly lifecycle = inject(ClearpipeLifecycleService);
  private readonly transfer = inject(ClearpipeDocumentTransferService);
  private readonly importInput = viewChild<ElementRef<HTMLInputElement>>('importInput');
  readonly openRequested = output<void>();
  readonly validateRequested = output<void>();
  readonly previewRequested = output<void>();
  readonly settingsRequested = output<void>();
  protected readonly transferMessage = signal('');

  protected readonly actions = computed(() =>
    clearpipeToolbarActions(this.lifecycle, this.lifecycle.graph() !== null && !this.lifecycle.readOnly()));

  protected action(id: ClearpipeToolbarActionId): ClearpipeToolbarAction {
    return this.actions().find(action => action.id === id)!;
  }

  protected async invoke(id: ClearpipeToolbarActionId): Promise<void> {
    const action = this.action(id);
    if (action.disabled) return;
    switch (id) {
      case 'new':
        this.lifecycle.new();
        return;
      case 'save':
        await this.lifecycle.save();
        return;
      case 'open':
        this.openRequested.emit();
        return;
      case 'validate':
        this.validateRequested.emit();
        return;
      case 'preview':
        this.previewRequested.emit();
        return;
      case 'import':
        this.importInput()?.nativeElement.click();
        return;
      case 'export':
        this.reportTransfer(this.transfer.downloadGraph());
        return;
      case 'settings':
        this.settingsRequested.emit();
        return;
      default:
        return;
    }
  }

  protected async importGraph(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.reportTransfer(await this.transfer.importGraph(await file.text()));
  }

  private reportTransfer(result: {status: string; code?: string; errors?: readonly {message: string}[]}): void {
    this.transferMessage.set(result.status === 'exported'
      ? 'ClearPipe definition exported.'
      : result.status === 'imported'
        ? 'ClearPipe definition imported.'
        : result.errors?.[0]?.message ?? result.code ?? 'ClearPipe document transfer was not completed.');
  }
}
