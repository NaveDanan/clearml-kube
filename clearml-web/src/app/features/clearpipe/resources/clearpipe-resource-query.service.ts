import {inject, Injectable, signal} from '@angular/core';
import {Observable, Subscription} from 'rxjs';
import {ClearpipeResourceOption} from '../clearpipe.models';
import {ClearpipeTaskInventoryResponse} from '../clearpipe-api.service';
import {
  ClearpipeAdapterOutcome,
  ClearpipeAdapterService,
  ClearpipeNavigationTarget,
} from '../platform/clearpipe-adapter.service';
import {
  CLEARPIPE_RESOURCE_REGISTRATIONS,
  ClearpipeAdapterResourceType,
  ClearpipeResourceFilter,
  ClearpipeResourceKind,
  ClearpipeResourceManagementLink,
  ClearpipeResourceProblem,
  ClearpipeResourceQueryState,
  ClearpipeResourceResolverOutput,
  ClearpipeResourceResolverRequest,
  ClearpipeResourceSelectionState,
  ClearpipeResourceSummary,
  normalizeClearpipeResource,
} from './clearpipe-resource.models';

export interface ClearpipeAuthorizedResourceGateway {
  resources(type: ClearpipeAdapterResourceType): Observable<ClearpipeAdapterOutcome<ClearpipeResourceOption[]>>;
  taskInventory?(request: {page?: number; page_size?: number; cursor?: string}): Observable<ClearpipeAdapterOutcome<ClearpipeTaskInventoryResponse>>;
  routeFor(target: ClearpipeNavigationTarget): string[] | null;
}

const defaultFilter: Required<Pick<ClearpipeResourceFilter, 'pageSize'>> = {pageSize: 50};

const normalizeFilter = (filter: ClearpipeResourceFilter = {}): ClearpipeResourceFilter => ({
  ...(filter.search?.trim() ? {search: filter.search.trim()} : {}),
  ...(filter.project?.trim() ? {project: filter.project.trim()} : {}),
  ...(filter.tags?.length ? {tags: [...filter.tags]} : {}),
  pageSize: Math.min(100, Math.max(1, Math.floor(filter.pageSize ?? defaultFilter.pageSize))),
});

const initialState = (kind: ClearpipeResourceKind): ClearpipeResourceQueryState => ({
  kind,
  status: 'idle',
  filter: defaultFilter,
  items: [],
  total: 0,
  page: 0,
  pageSize: defaultFilter.pageSize,
  hasMore: false,
  complete: false,
});

const safeProblem = (code: ClearpipeResourceProblem['code'], retryable: boolean): ClearpipeResourceProblem => ({code, retryable});

type PagedResourceQueryStatus = Extract<ClearpipeResourceQueryState['status'], 'ready' | 'empty' | 'stale' | 'deleted'>;

const isPagedResourceQueryStatus = (status: ClearpipeResourceQueryState['status']): status is PagedResourceQueryStatus =>
  status === 'ready' || status === 'empty' || status === 'stale' || status === 'deleted';

/**
 * Cancels obsolete adapter subscriptions. Task inventories use the typed
 * server cursor while other approved resource kinds retain their local
 * authorized-inventory pagination; no production client is bypassed here.
 */
export class ClearpipeResourceQueryController {
  readonly state;
  private knownItems: readonly ClearpipeResourceSummary[] = [];
  private hasKnownInventory = false;
  private readonly deletedIds = new Set<string>();
  private request?: Subscription;
  private requestVersion = 0;
  private filter: ClearpipeResourceFilter = defaultFilter;
  private taskNextCursor?: string;
  private inventoryComplete = false;
  private inventoryTotal = 0;

  constructor(
    readonly kind: ClearpipeResourceKind,
    private readonly adapter: ClearpipeAuthorizedResourceGateway
  ) {
    this.state = signal(initialState(kind));
  }

  load(filter: ClearpipeResourceFilter = this.filter): void {
    this.filter = normalizeFilter(filter);
    this.request?.unsubscribe();
    const version = ++this.requestVersion;
    const registration = CLEARPIPE_RESOURCE_REGISTRATIONS[this.kind];
    const previous = this.state();
    if (!registration.adapterType) {
      this.clearKnownInventory();
      this.state.set({
        ...initialState(this.kind),
        filter: this.filter,
        pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
        status: 'unavailable',
        problem: safeProblem('unsupported', false),
      });
      return;
    }

    this.state.set({
      ...previous,
      filter: this.filter,
      page: 0,
      pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
      status: this.hasKnownInventory ? 'refreshing' : 'loading',
      problem: undefined,
    });
    if (this.kind === 'task' && this.adapter.taskInventory) {
      this.clearKnownInventory();
      this.taskNextCursor = undefined;
      this.inventoryComplete = false;
      this.request = this.adapter.taskInventory({
        page: 0,
        page_size: this.filter.pageSize,
      }).subscribe(outcome => {
        if (version !== this.requestVersion || outcome.status === 'loading') return;
        this.applyTaskInventoryOutcome(outcome, false);
      });
      return;
    }
    this.request = this.adapter.resources(registration.adapterType).subscribe(outcome => {
      if (version !== this.requestVersion || outcome.status === 'loading') return;
      this.applyOutcome(outcome);
    });
  }

  refresh(): void {
    this.load(this.filter);
  }

  retry(): void {
    this.load(this.filter);
  }

  /**
   * Changes the selector view without issuing another authorized inventory
   * request. Resolver and selection lookups remain bound to knownItems.
   */
  setFilter(filter: ClearpipeResourceFilter): void {
    this.filter = normalizeFilter(filter);
    const current = this.state();
    if (!this.hasKnownInventory) {
      this.state.set({
        ...current,
        filter: this.filter,
        page: 0,
        pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
      });
      return;
    }
    const status = current.status === 'stale' || current.status === 'deleted'
      ? current.status
      : undefined;
    this.setPage(0, status, current.problem);
  }

  loadMore(): void {
    const current = this.state();
    if (this.kind === 'task' && this.adapter.taskInventory && !this.inventoryComplete && this.taskNextCursor) {
      this.request?.unsubscribe();
      const version = ++this.requestVersion;
      this.state.set({...current, status: 'refreshing', problem: undefined});
      this.request = this.adapter.taskInventory({
        page: current.page + 1,
        page_size: current.pageSize,
        cursor: this.taskNextCursor,
      }).subscribe(outcome => {
        if (version !== this.requestVersion || outcome.status === 'loading') return;
        this.applyTaskInventoryOutcome(outcome, true);
      });
      return;
    }
    if (!current.hasMore || !isPagedResourceQueryStatus(current.status)) return;
    this.setPage(current.page + 1, current.status, current.problem);
  }

  cancel(): void {
    this.requestVersion++;
    this.request?.unsubscribe();
    this.request = undefined;
  }

  /**
   * Lets an owner that has received an authoritative deletion outcome remove a
   * confirmed selection without reclassifying a denied lookup as deleted.
   */
  markDeleted(resourceId: string): void {
    if (!this.knownItems.some(item => item.id === resourceId)) return;
    this.deletedIds.add(resourceId);
    this.knownItems = this.knownItems.filter(item => item.id !== resourceId);
    const current = this.state();
    this.setPage(current.page, 'deleted');
  }

  selection(resourceId: string | null | undefined): ClearpipeResourceSelectionState {
    if (!resourceId) return {status: 'none'};
    if (this.deletedIds.has(resourceId)) return {status: 'deleted'};
    const state = this.state();
    if (state.status === 'denied') return {status: 'denied'};
    if (state.status === 'stale') return {status: 'stale'};
    if (state.status === 'loading' || state.status === 'refreshing' || state.status === 'idle') return {status: 'pending'};
    if (state.status === 'error' || state.status === 'unavailable') return {status: 'unavailable'};
    const resource = this.knownItems.find(item => item.id === resourceId);
    return resource
      ? {status: 'selected', resource}
      : !this.inventoryComplete ? {status: 'pending'} : {status: 'deleted'};
  }

  managementLink(resource: ClearpipeResourceSummary): ClearpipeResourceManagementLink | undefined {
    const registration = CLEARPIPE_RESOURCE_REGISTRATIONS[resource.kind];
    if (!registration.supportsManagement || !registration.adapterType) return undefined;
    const commands = this.adapter.routeFor({
      kind: 'resource-details',
      resourceType: registration.adapterType,
      resourceId: resource.id,
    });
    return commands ? {commands, label: `Manage ${registration.label}`} : undefined;
  }

  resolve(request: ClearpipeResourceResolverRequest): ClearpipeResourceResolverOutput {
    const state = this.state();
    if (state.status === 'idle' || state.status === 'loading' || state.status === 'refreshing') return {status: 'pending'};
    if (state.status === 'denied') return {status: 'denied'};
    if (state.status === 'stale') return {status: 'stale'};
    if (state.status === 'error' || state.status === 'unavailable') return {status: 'unavailable'};
    if (this.deletedIds.has(request.resource_id)) return {status: 'missing'};
    const matched = this.knownItems.some(item =>
      item.id === request.resource_id ||
      (request.lookup?.name === item.name && (!request.lookup.project || request.lookup.project === item.project))
    );
    return {status: matched ? 'available' : !this.inventoryComplete ? 'pending' : 'missing'};
  }

  private applyOutcome(outcome: Exclude<ClearpipeAdapterOutcome<ClearpipeResourceOption[]>, {status: 'loading'}>): void {
    if (outcome.status === 'ready') {
      this.deletedIds.clear();
      this.knownItems = this.normalizeInventory(outcome.data);
      this.hasKnownInventory = true;
      this.inventoryComplete = true;
      this.inventoryTotal = this.knownItems.length;
      this.setPage(0);
      return;
    }
    if (outcome.status === 'denied_or_missing') {
      this.clearKnownInventory();
      this.state.set({
        ...initialState(this.kind),
        filter: this.filter,
        pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
        status: 'denied',
        problem: safeProblem('denied', false),
      });
      return;
    }
    if (outcome.status === 'stale_revision') {
      this.setFailureState(safeProblem('request_failed', false));
      return;
    }
    if (outcome.status === 'resource_unavailable') {
      if (outcome.problem.retryable) {
        this.setFailureState(safeProblem('unavailable', true));
      } else {
        this.setUnavailableState(false);
      }
      return;
    }
    if (outcome.status === 'unsupported_representation'
      || outcome.status === 'execution_unavailable') {
      this.setUnavailableState(outcome.problem.retryable);
      return;
    }
    this.setFailureState(safeProblem('request_failed', true));
  }

  private setFailureState(problem: ClearpipeResourceProblem): void {
    if (this.hasKnownInventory) {
      this.setPage(this.state().page, 'stale', problem);
    } else {
      this.state.set({
        ...initialState(this.kind),
        filter: this.filter,
        pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
        status: 'error',
        problem,
      });
    }
  }

  private setUnavailableState(retryable: boolean): void {
    this.clearKnownInventory();
    this.state.set({
      ...initialState(this.kind),
      filter: this.filter,
      pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
      status: 'unavailable',
      problem: safeProblem('unavailable', retryable),
    });
  }

  private clearKnownInventory(): void {
    this.knownItems = [];
    this.hasKnownInventory = false;
    this.deletedIds.clear();
    this.inventoryComplete = false;
    this.taskNextCursor = undefined;
    this.inventoryTotal = 0;
  }

  private applyTaskInventoryOutcome(
    outcome: Exclude<ClearpipeAdapterOutcome<ClearpipeTaskInventoryResponse>, {status: 'loading'}>,
    append: boolean
  ): void {
    if (outcome.status !== 'ready') {
      this.applyOutcome(outcome as unknown as Exclude<ClearpipeAdapterOutcome<ClearpipeResourceOption[]>, {status: 'loading'}>);
      return;
    }
    const page = this.normalizeInventory(outcome.data.tasks);
    this.knownItems = append
      ? [...new Map([...this.knownItems, ...page].map(item => [item.id, item])).values()]
      : page;
    this.hasKnownInventory = true;
    this.inventoryComplete = !outcome.data.next_cursor;
    this.taskNextCursor = outcome.data.next_cursor;
    this.inventoryTotal = outcome.data.total;
    this.setPage(append ? this.state().page + 1 : 0);
  }

  private normalizeInventory(resources: readonly ClearpipeResourceOption[]): readonly ClearpipeResourceSummary[] {
    return resources
      .map(resource => normalizeClearpipeResource(this.kind, resource))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  private filteredItems(): readonly ClearpipeResourceSummary[] {
    const search = this.filter.search?.toLocaleLowerCase();
    const project = this.filter.project;
    const tags = this.filter.tags ?? [];
    return this.knownItems
      .filter(resource => !search || [resource.name, resource.id, resource.project, resource.version, resource.type, resource.status]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLocaleLowerCase().includes(search)))
      .filter(resource => !project || resource.project === project)
      .filter(resource => !tags.length || tags.every(tag => resource.tags?.includes(tag)));
  }

  private setPage(
    page: number,
    status?: PagedResourceQueryStatus,
    problem?: ClearpipeResourceProblem
  ): void {
    const pageSize = this.filter.pageSize ?? defaultFilter.pageSize;
    const items = this.filteredItems();
    const visible = items.slice(0, (page + 1) * pageSize);
    this.state.set({
      kind: this.kind,
      status: status ?? (items.length ? 'ready' : 'empty'),
      filter: this.filter,
      items: visible,
      total: this.kind === 'task' && !this.inventoryComplete
        ? this.inventoryTotal
        : items.length,
      page,
      pageSize,
      hasMore: !this.inventoryComplete || visible.length < items.length,
      complete: this.inventoryComplete,
      updatedAt: Date.now(),
      ...(problem ? {problem} : {}),
    });
  }
}

/**
 * Synchronous CP-11-compatible resolver projection. It observes queried
 * resource state only; validation must decide when and how to issue network
 * requests and this resolver never triggers one.
 */
export class ClearpipeResourceResolver {
  constructor(private readonly controllerFor: (kind: ClearpipeResourceKind) => ClearpipeResourceQueryController) {}

  resolve(request: ClearpipeResourceResolverRequest): ClearpipeResourceResolverOutput {
    return this.controllerFor(request.kind).resolve(request);
  }
}

@Injectable({providedIn: 'root'})
export class ClearpipeResourceQueryService {
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly controllers = new Map<ClearpipeResourceKind, ClearpipeResourceQueryController>();

  for(kind: ClearpipeResourceKind): ClearpipeResourceQueryController {
    let controller = this.controllers.get(kind);
    if (!controller) {
      controller = new ClearpipeResourceQueryController(kind, this.adapter);
      this.controllers.set(kind, controller);
    }
    return controller;
  }

  resolver(): ClearpipeResourceResolver {
    return new ClearpipeResourceResolver(kind => this.for(kind));
  }
}
