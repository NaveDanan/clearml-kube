import {ChangeDetectionStrategy, Component, EventEmitter, Input, OnInit, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterLink} from '@angular/router';
import {
  clearpipeResourceReference,
  ClearpipeResourceManagementLink,
  ClearpipeResourceSelection,
  ClearpipeResourceSummary,
} from './clearpipe-resource.models';
import {ClearpipeResourceQueryController} from './clearpipe-resource-query.service';

@Component({
  selector: 'sm-clearpipe-resource-selector',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="clearpipe-resource-selector" [attr.aria-busy]="state.status === 'loading' || state.status === 'refreshing'">
      <label [for]="searchId">Search {{ controller.kind }}s</label>
      <input [id]="searchId" type="search" [value]="state.filter.search ?? ''"
             (input)="search($any($event.target).value)" [disabled]="state.status === 'denied' || state.status === 'unavailable'">

      @if (state.status === 'loading') {
        <p role="status">Loading authorized resources…</p>
      } @else if (state.status === 'refreshing') {
        <p role="status">Refreshing authorized resources…</p>
      } @else if (state.status === 'denied') {
        <p role="alert">Resources are unavailable because access could not be verified.</p>
      } @else if (state.status === 'unavailable') {
        <p role="alert">This resource type is unavailable through the authorized ClearPipe service.</p>
      } @else if (state.status === 'error') {
        <p role="alert">{{ state.problem?.code === 'unavailable' ? 'Resources are temporarily unavailable.' : 'Resources could not be loaded.' }}</p>
        <button type="button" (click)="controller.retry()">Retry</button>
      } @else if (state.status === 'stale') {
        <p role="status">Showing stale resource information. Refresh before running.</p>
        <button type="button" (click)="controller.retry()">Refresh</button>
      } @else if (state.status === 'deleted') {
        <p role="alert">A selected resource was deleted. Select another resource.</p>
      } @else if (state.status === 'empty') {
        <p role="status">No authorized resources match this search.</p>
      }

      @if (selection.status === 'deleted') {
        <p role="alert">The selected resource is no longer available. Select another resource.</p>
      }

      @if (state.items.length) {
        <ul>
          @for (resource of state.items; track resource.id) {
            <li>
              <button type="button" (click)="select(resource)" [attr.aria-pressed]="resource.id === selectedId">
                <strong>{{ resource.name }}</strong>
                <span> {{ resource.id }}</span>
                @if (resource.project) { <span> · {{ resource.project }}</span> }
                @if (resource.version) { <span> · {{ resource.version }}</span> }
                @if (resource.type) { <span> · {{ resource.type }}</span> }
                @if (resource.status) { <span> · {{ resource.status }}</span> }
                @if (resource.taskUserTags?.length) { <span> · User tags: {{ resource.taskUserTags?.join(', ') }}</span> }
                @if (resource.taskSystemTags?.length) { <span> · System tags: {{ resource.taskSystemTags?.join(', ') }}</span> }
                @if (!resource.taskUserTags?.length && !resource.taskSystemTags?.length && resource.tags?.length) {
                  <span> · {{ resource.tags?.join(', ') }}</span>
                }
                @if (resource.updatedAt) { <span> · {{ resource.updatedAt }}</span> }
              </button>
              @if (managementLink(resource); as management) {
                <a [routerLink]="management.commands">{{ management.label }}</a>
              }
            </li>
          }
        </ul>
      }

      @if (state.hasMore) {
        <button type="button" (click)="controller.loadMore()">Load more</button>
      }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClearpipeResourceSelectorComponent implements OnInit {
  @Input({required: true}) controller!: ClearpipeResourceQueryController;
  @Input() selectedId: string | null = null;
  @Output() readonly selectedIdChange = new EventEmitter<string | null>();
  @Output() readonly resourceSelected = new EventEmitter<ClearpipeResourceSelection>();

  readonly searchId = `clearpipe-resource-search-${Math.random().toString(36).slice(2)}`;

  get state() {
    return this.controller.state();
  }

  get selection() {
    return this.controller.selection(this.selectedId);
  }

  ngOnInit(): void {
    this.controller.load();
  }

  search(search: string): void {
    this.controller.setFilter({...this.state.filter, search});
  }

  select(resource: ClearpipeResourceSummary): void {
    this.selectedId = resource.id;
    this.selectedIdChange.emit(resource.id);
    this.resourceSelected.emit({resource, reference: clearpipeResourceReference(resource)});
  }

  managementLink(resource: ClearpipeResourceSummary): ClearpipeResourceManagementLink | undefined {
    return this.controller.managementLink(resource);
  }
}
