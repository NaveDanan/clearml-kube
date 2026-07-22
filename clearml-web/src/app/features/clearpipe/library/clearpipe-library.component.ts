import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {ClearpipeDefinition} from '../clearpipe.models';
import {Router, RouterLink} from '@angular/router';
import {DatePipe} from '@angular/common';
import {FormControl, ReactiveFormsModule} from '@angular/forms';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatIconModule} from '@angular/material/icon';
import {MatButtonModule} from '@angular/material/button';
import {MatMenuModule} from '@angular/material/menu';
import {MatDialog} from '@angular/material/dialog';
import {ConfirmDialogComponent} from '@common/shared/ui-components/overlay/confirm-dialog/confirm-dialog.component';
import {Store} from '@ngrx/store';
import {addMessage} from '@common/core/actions/layout.actions';
import {debounceTime, distinctUntilChanged, startWith} from 'rxjs/operators';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {finalize} from 'rxjs';

@Component({
  selector: 'sm-clearpipe-library',
  templateUrl: './clearpipe-library.component.html',
  styleUrl: './clearpipe-library.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
  ]
})
export class ClearpipeLibraryComponent {
  private api = inject(ClearpipeApiService);
  private router = inject(Router);
  private dialog = inject(MatDialog);
  private store = inject(Store);

  protected pipelines = signal<ClearpipeDefinition[]>([]);
  protected loading = signal(true);
  protected archived = signal(false);
  protected search = new FormControl('', {nonNullable: true});
  protected resultLabel = computed(() => `${this.pipelines().length} definition${this.pipelines().length === 1 ? '' : 's'}`);

  constructor() {
    this.search.valueChanges.pipe(
      startWith(''),
      debounceTime(250),
      distinctUntilChanged(),
      takeUntilDestroyed(),
    ).subscribe(value => this.load(value));
  }

  protected toggleArchived(): void {
    this.archived.update(value => !value);
    this.load(this.search.value);
  }

  protected open(definition: ClearpipeDefinition): void {
    this.router.navigate(['/clearpipe', definition.task_id ?? definition.id]);
  }

  protected archive(definition: ClearpipeDefinition, event: Event): void {
    event.stopPropagation();
    const id = definition.task_id ?? definition.id;
    if (!id) return;
    this.api.archive(id, !definition.archived).subscribe({
      next: () => {
        this.store.dispatch(addMessage('success', definition.archived ? 'ClearPipe definition restored' : 'ClearPipe definition archived'));
        this.load(this.search.value);
      },
      error: () => this.store.dispatch(addMessage('error', 'Failed to update ClearPipe archive state')),
    });
  }

  protected remove(definition: ClearpipeDefinition, event: Event): void {
    event.stopPropagation();
    const id = definition.task_id ?? definition.id;
    if (!id) return;
    this.dialog.open(ConfirmDialogComponent, {
      data: {
        title: 'Delete ClearPipe definition?',
        body: `“${definition.name}” will be permanently deleted.`,
        yes: 'DELETE',
        no: 'CANCEL',
        iconClass: 'al-ico-alert',
        iconColor: 'var(--color-error)',
        centerText: true,
        width: 440,
      }
    }).afterClosed().subscribe(confirmed => {
      if (!confirmed) return;
      this.api.delete(id).subscribe({
        next: () => {
          this.store.dispatch(addMessage('success', 'ClearPipe definition deleted'));
          this.load(this.search.value);
        },
        error: () => this.store.dispatch(addMessage('error', 'Failed to delete ClearPipe definition')),
      });
    });
  }

  private load(search: string): void {
    this.loading.set(true);
    this.api.getAll(search, this.archived()).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: definitions => this.pipelines.set(definitions),
      error: () => {
        this.pipelines.set([]);
        this.store.dispatch(addMessage('error', 'Failed to load ClearPipe definitions'));
      }
    });
  }
}
