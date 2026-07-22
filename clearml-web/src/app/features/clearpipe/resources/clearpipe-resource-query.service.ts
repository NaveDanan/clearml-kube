import {inject, Injectable, signal} from '@angular/core';
import {Observable, Subscription} from 'rxjs';
import {ClearpipeResourceOption} from '../clearpipe.models';
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
});

const safeProblem = (code: ClearpipeResourceProblem['code'], retryable: boolean): ClearpipeResourceProblem => ({code, retryable});

/**
 * Cancels obsolete adapter subscriptions and paginates the authorized adapter
 * result locally. CP-14 currently exposes an authorized inventory, not a
 * server-side cursor; no production resource client is bypassed here.
 */
export class ClearpipeResourceQueryController {
  readonly state;
  private allItems: readonly ClearpipeResourceSummary[] = [];
  private readonly deletedIds = new Set<string>();
  private request?: Subscription;
  private requestVersion = 0;
  private filter: ClearpipeResourceFilter = defaultFilter;

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
      this.allItems = [];
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
      status: previous.items.length ? 'refreshing' : 'loading',
      problem: undefined,
    });
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

  loadMore(): void {
    const current = this.state();
    if (!current.hasMore || (current.status !== 'ready' && current.status !== 'stale')) return;
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
    if (!this.allItems.some(item => item.id === resourceId)) return;
    this.deletedIds.add(resourceId);
    this.allItems = this.allItems.filter(item => item.id !== resourceId);
    const current = this.state();
    const visible = this.allItems.slice(0, (current.page + 1) * current.pageSize);
    this.state.set({
      ...current,
      status: 'deleted',
      items: visible,
      total: this.allItems.length,
      hasMore: visible.length < this.allItems.length,
      problem: undefined,
    });
  }

  selection(resourceId: string | null | undefined): ClearpipeResourceSelectionState {
    if (!resourceId) return {status: 'none'};
    if (this.deletedIds.has(resourceId)) return {status: 'deleted'};
    const state = this.state();
    if (state.status === 'denied') return {status: 'denied'};
    if (state.status === 'stale') return {status: 'stale'};
    if (state.status === 'loading' || state.status === 'refreshing' || state.status === 'idle') return {status: 'pending'};
    if (state.status === 'error' || state.status === 'unavailable') return {status: 'unavailable'};
    const resource = this.allItems.find(item => item.id === resourceId);
    return resource ? {status: 'selected', resource} : {status: 'deleted'};
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
    const matched = this.allItems.some(item =>
      item.id === request.resource_id ||
      (request.lookup?.name === item.name && (!request.lookup.project || request.lookup.project === item.project))
    );
    return {status: matched ? 'available' : 'missing'};
  }

  private applyOutcome(outcome: Exclude<ClearpipeAdapterOutcome<ClearpipeResourceOption[]>, {status: 'loading'}>): void {
    if (outcome.status === 'ready') {
      this.deletedIds.clear();
      this.allItems = this.filterItems(outcome.data);
      const status = this.allItems.length ? 'ready' : 'empty';
      this.setPage(0, status);
      return;
    }
    if (outcome.status === 'denied_or_missing') {
      this.allItems = [];
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
      this.state.set({
        ...this.state(),
        status: 'stale',
        problem: safeProblem('request_failed', false),
      });
      return;
    }
    if (outcome.status === 'resource_unavailable'
      || outcome.status === 'unsupported_representation'
      || outcome.status === 'execution_unavailable') {
      this.allItems = [];
      this.state.set({
        ...initialState(this.kind),
        filter: this.filter,
        pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
        status: 'unavailable',
        problem: safeProblem('unavailable', outcome.problem.retryable),
      });
      return;
    }
    const current = this.state();
    if (current.items.length) {
      this.state.set({...current, status: 'stale', problem: safeProblem('request_failed', true)});
    } else {
      this.state.set({
        ...initialState(this.kind),
        filter: this.filter,
        pageSize: this.filter.pageSize ?? defaultFilter.pageSize,
        status: 'error',
        problem: safeProblem('request_failed', true),
      });
    }
  }

  private filterItems(resources: readonly ClearpipeResourceOption[]): readonly ClearpipeResourceSummary[] {
    const search = this.filter.search?.toLocaleLowerCase();
    const project = this.filter.project;
    const tags = this.filter.tags ?? [];
    return resources
      .map(resource => normalizeClearpipeResource(this.kind, resource))
      .filter(resource => !search || [resource.name, resource.id, resource.project, resource.version, resource.type, resource.status]
        .filter((value): value is string => Boolean(value))
        .some(value => value.toLocaleLowerCase().includes(search)))
      .filter(resource => !project || resource.project === project)
      .filter(resource => !tags.length || tags.every(tag => resource.tags?.includes(tag)))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }

  private setPage(
    page: number,
    status: Extract<ClearpipeResourceQueryState['status'], 'ready' | 'empty' | 'stale'>,
    problem?: ClearpipeResourceProblem
  ): void {
    const pageSize = this.filter.pageSize ?? defaultFilter.pageSize;
    const visible = this.allItems.slice(0, (page + 1) * pageSize);
    this.state.set({
      kind: this.kind,
      status,
      filter: this.filter,
      items: visible,
      total: this.allItems.length,
      page,
      pageSize,
      hasMore: visible.length < this.allItems.length,
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
