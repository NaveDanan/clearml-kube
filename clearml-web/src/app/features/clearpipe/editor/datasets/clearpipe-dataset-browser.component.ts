import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output, inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterLink} from '@angular/router';
import {
  clearpipeResourceReference,
  ClearpipeResourceSelection,
  ClearpipeResourceSummary,
} from '../../resources/clearpipe-resource.models';
import {
  ClearpipeResourceQueryController,
  ClearpipeResourceQueryService,
} from '../../resources/clearpipe-resource-query.service';

@Component({
  selector: 'sm-clearpipe-dataset-browser',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="clearpipe-dataset-browser" [attr.aria-busy]="state.status === 'loading' || state.status === 'refreshing'">
      <header>
        <h3>Datasets</h3>
        <button type="button" (click)="refresh()" [disabled]="state.status === 'loading'">Refresh</button>
      </header>
      <div class="clearpipe-dataset-browser__filters">
        <label [for]="projectId">Project</label>
        <input [id]="projectId" [value]="state.filter.project ?? ''" (input)="project($any($event.target).value)"
               [disabled]="state.status === 'denied' || state.status === 'unavailable'">
        <label [for]="searchId">Search datasets</label>
        <input [id]="searchId" type="search" [value]="state.filter.search ?? ''" (input)="search($any($event.target).value)"
               [disabled]="state.status === 'denied' || state.status === 'unavailable'">
      </div>

      @if (state.status === 'loading') {
        <p role="status">Loading authorized datasets…</p>
      } @else if (state.status === 'refreshing') {
        <p role="status">Refreshing authorized datasets…</p>
      } @else if (state.status === 'denied') {
        <p role="alert">Datasets are unavailable because access could not be verified.</p>
      } @else if (state.status === 'unavailable') {
        <p role="alert">Datasets are unavailable through the authorized ClearPipe resource adapter.</p>
      } @else if (state.status === 'error') {
        <p role="alert">Datasets could not be loaded.</p>
        <button type="button" (click)="retry()">Retry</button>
      } @else if (state.status === 'stale') {
        <p role="status">Showing stale dataset information. Refresh before using it.</p>
        <button type="button" (click)="retry()">Refresh</button>
      } @else if (state.status === 'deleted') {
        <p role="alert">A selected dataset was deleted. Select another dataset.</p>
      } @else if (state.status === 'empty') {
        <p role="status">No authorized datasets match this project or search.</p>
      }

      @if (selectedId && selection.status === 'deleted') {
        <p role="alert">The selected dataset is no longer available. Select another dataset.</p>
      } @else if (selectedId && selection.status === 'denied') {
        <p role="alert">The selected dataset can no longer be accessed.</p>
      } @else if (selectedId && selection.status === 'stale') {
        <p role="status">The selected dataset needs a refresh before it can be verified.</p>
      }

      @if (state.items.length) {
        <ul>
          @for (dataset of state.items; track dataset.id) {
            <li>
              <button type="button" (click)="select(dataset)" [attr.aria-pressed]="dataset.id === selectedId">
                <strong>{{ dataset.name }}</strong>
                <span class="clearpipe-dataset-browser__id">{{ dataset.id }}</span>
                @if (dataset.project) { <span> · {{ dataset.project }}</span> }
                @if (dataset.version) { <span> · version {{ dataset.version }}</span> }
                @if (dataset.tags?.length) { <span> · {{ dataset.tags?.join(', ') }}</span> }
                @if (dataset.updatedAt) { <span> · updated {{ dataset.updatedAt }}</span> }
              </button>
              <p class="clearpipe-dataset-browser__metadata">
                @if (!dataset.version) { Version is not supplied by the authorized adapter. }
                @if (!dataset.tags?.length) { Tags are not supplied by the authorized adapter. }
                @if (!dataset.updatedAt) { Updated time is not supplied by the authorized adapter. }
                File count is not supplied by the authorized adapter.
              </p>
              @if (managementLink(dataset); as management) {
                <a [routerLink]="management.commands">{{ management.label }}</a>
              }
            </li>
          }
        </ul>
      }
      @if (state.hasMore) {
        <button type="button" (click)="controller.loadMore()">Load more</button>
      }
      <p class="clearpipe-dataset-browser__versions">Dataset-version actions are unavailable because the authorized adapter does not expose dataset versions.</p>
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClearpipeDatasetBrowserComponent implements OnInit {
  private readonly resourceQueries = inject(ClearpipeResourceQueryService);

  @Input() controller: ClearpipeResourceQueryController = this.resourceQueries.for('dataset');
  @Input() selectedId: string | null = null;
  @Output() readonly selectedIdChange = new EventEmitter<string | null>();
  @Output() readonly datasetSelected = new EventEmitter<ClearpipeResourceSelection>();

  readonly projectId = `clearpipe-dataset-project-${Math.random().toString(36).slice(2)}`;
  readonly searchId = `clearpipe-dataset-search-${Math.random().toString(36).slice(2)}`;

  get state() {
    return this.controller.state();
  }

  get selection() {
    return this.controller.selection(this.selectedId);
  }

  ngOnInit(): void {
    if (this.controller.state().status === 'idle') {
      this.controller.load(this.controller.state().filter);
    }
  }

  search(search: string): void {
    this.controller.setFilter({...this.state.filter, search});
  }

  project(project: string): void {
    this.controller.setFilter({...this.state.filter, project});
  }

  refresh(): void {
    this.controller.refresh();
  }

  retry(): void {
    this.controller.retry();
  }

  select(resource: ClearpipeResourceSummary): void {
    const selection: ClearpipeResourceSelection = {
      resource,
      reference: clearpipeResourceReference(resource),
    };
    this.selectedId = resource.id;
    this.selectedIdChange.emit(resource.id);
    this.datasetSelected.emit(selection);
  }

  managementLink(resource: ClearpipeResourceSummary) {
    return this.controller.managementLink(resource);
  }
}
