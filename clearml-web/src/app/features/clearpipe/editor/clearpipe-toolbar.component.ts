import {ChangeDetectionStrategy, Component, computed, inject, output} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatMenuModule} from '@angular/material/menu';
import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';
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
  readonly openRequested = output<void>();
  readonly validateRequested = output<void>();
  readonly previewRequested = output<void>();
  readonly settingsRequested = output<void>();

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
      case 'settings':
        this.settingsRequested.emit();
        return;
      default:
        return;
    }
  }
}
