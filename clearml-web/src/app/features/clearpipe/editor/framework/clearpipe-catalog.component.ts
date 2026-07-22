import {ChangeDetectionStrategy, Component, computed, input, output, signal} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {
  ClearpipeCatalogAddRequest,
  ClearpipeCatalogDragRequest,
  ClearpipeCatalogEntry,
  ClearpipeCatalogPresentation,
} from './clearpipe-ui.types';

interface CatalogCategory {
  readonly label: string;
  readonly entries: readonly ClearpipeCatalogEntry[];
}

@Component({
  selector: 'sm-clearpipe-catalog',
  templateUrl: './clearpipe-catalog.component.html',
  styleUrl: './clearpipe-catalog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
})
export class ClearpipeCatalogComponent {
  readonly entries = input<readonly ClearpipeCatalogEntry[]>([]);
  readonly presentation = input<ClearpipeCatalogPresentation>({state: 'ready'});
  readonly compact = input(false);
  readonly readOnly = input(false);

  readonly addRequested = output<ClearpipeCatalogAddRequest>();
  readonly dragStarted = output<ClearpipeCatalogDragRequest>();
  readonly dragEnded = output<ClearpipeCatalogEntry>();
  readonly retryRequested = output<void>();
  readonly focusCanvasRequested = output<void>();

  readonly query = signal('');
  protected readonly draggingEntryId = signal<string | null>(null);
  protected readonly categories = computed<readonly CatalogCategory[]>(() => {
    const query = this.query().trim().toLocaleLowerCase();
    const matching = this.entries().filter((entry) => {
      const searchable = [entry.label, entry.description, entry.category, ...(entry.keywords ?? [])]
        .join(' ')
        .toLocaleLowerCase();
      return !query || searchable.includes(query);
    });
    const grouped = new Map<string, ClearpipeCatalogEntry[]>();
    matching.forEach((entry) => grouped.set(entry.category, [...(grouped.get(entry.category) ?? []), entry]));
    return [...grouped.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([label, entries]) => ({label, entries: [...entries].sort((left, right) => left.label.localeCompare(right.label))}));
  });
  protected readonly resultSummary = computed(() => {
    const count = this.categories().reduce((total, category) => total + category.entries.length, 0);
    return this.query().trim()
      ? `${count} catalog ${count === 1 ? 'result' : 'results'} for “${this.query().trim()}”`
      : `${count} registered ${count === 1 ? 'capability' : 'capabilities'}`;
  });

  protected setQuery(value: string): void {
    this.query.set(value);
  }

  protected requestAdd(entry: ClearpipeCatalogEntry, method: ClearpipeCatalogAddRequest['method']): void {
    if (this.addDisabled(entry)) return;
    this.addRequested.emit({entry, method});
  }

  protected onEntryKeydown(event: KeyboardEvent, entry: ClearpipeCatalogEntry): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.requestAdd(entry, 'keyboard');
  }

  protected onDragStart(event: DragEvent, entry: ClearpipeCatalogEntry): void {
    if (this.addDisabled(entry)) {
      event.preventDefault();
      return;
    }
    this.draggingEntryId.set(entry.id);
    if (event.dataTransfer) {
      event.dataTransfer.setData('application/x-clearpipe-catalog-entry', entry.id);
      event.dataTransfer.setData('text/plain', entry.id);
      event.dataTransfer.effectAllowed = 'copy';
    }
    this.dragStarted.emit({entry, dataTransfer: event.dataTransfer});
  }

  protected onDragEnd(entry: ClearpipeCatalogEntry): void {
    this.draggingEntryId.set(null);
    this.dragEnded.emit(entry);
  }

  protected addDisabled(entry: ClearpipeCatalogEntry): boolean {
    return this.presentation().state !== 'ready' || this.readOnly() || !!entry.disabled;
  }

  protected disabledReason(entry: ClearpipeCatalogEntry): string | undefined {
    if (entry.disabled) return entry.disabledReason ?? 'This capability is currently unavailable.';
    if (this.readOnly()) return 'This definition is read-only.';
    return undefined;
  }
}
