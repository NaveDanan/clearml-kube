import {ComponentFixture, TestBed} from '@angular/core/testing';
import {RouterTestingModule} from '@angular/router/testing';
import {of} from 'rxjs';
import {ClearpipeResourceOption} from '../../clearpipe.models';
import {ClearpipeAdapterOutcome} from '../../platform/clearpipe-adapter.service';
import {ClearpipeResourceSelection, ClearpipeResourceSummary} from '../../resources/clearpipe-resource.models';
import {
  ClearpipeAuthorizedResourceGateway,
  ClearpipeResourceQueryController,
  ClearpipeResourceQueryService,
} from '../../resources/clearpipe-resource-query.service';
import {ClearpipeDatasetBrowserComponent} from './clearpipe-dataset-browser.component';
import {
  ClearpipeDatasetInspectorExtensionRegistration,
  clearpipeDatasetInspectorExtension,
} from './clearpipe-dataset-inspector-extension.provider';
import {ClearpipeExtensionRegistry} from '../framework/clearpipe-extension-registry';

describe('ClearpipeDatasetBrowserComponent', () => {
  let fixture: ComponentFixture<ClearpipeDatasetBrowserComponent>;
  let component: ClearpipeDatasetBrowserComponent;
  let gateway: jasmine.SpyObj<ClearpipeAuthorizedResourceGateway>;
  let controller: ClearpipeResourceQueryController;

  const dataset = (id: string, name: string, project = 'project-a'): ClearpipeResourceOption => ({
    id, name, project, type: 'dataset',
  });
  const ready = (items: ClearpipeResourceOption[]): ClearpipeAdapterOutcome<ClearpipeResourceOption[]> => ({
    status: 'ready', data: items,
  });

  beforeEach(() => {
    gateway = jasmine.createSpyObj<ClearpipeAuthorizedResourceGateway>('gateway', ['resources', 'routeFor']);
    gateway.routeFor.and.returnValue(['/datasets', 'simple', '*', 'tasks', 'd1']);
    controller = new ClearpipeResourceQueryController('dataset', gateway);
    TestBed.configureTestingModule({
      imports: [ClearpipeDatasetBrowserComponent, RouterTestingModule],
      providers: [
        {provide: ClearpipeResourceQueryService, useValue: {for: () => controller}},
      ],
    });
    fixture = TestBed.createComponent(ClearpipeDatasetBrowserComponent);
    component = fixture.componentInstance;
    component.controller = controller;
  });

  const load = (items: ClearpipeResourceOption[], pageSize = 50): void => {
    gateway.resources.and.returnValue(of(ready(items)));
    controller.load({pageSize});
    fixture.detectChanges();
  };

  it('filters authorized datasets by project and search without requesting another inventory', () => {
    load([dataset('d1', 'Iris', 'research'), dataset('d2', 'MNIST', 'vision'), dataset('d3', 'Iris archive', 'vision')]);

    component.project('vision');
    component.search('iris');

    expect(controller.state().items.map((item) => item.id)).toEqual(['d3']);
    expect(gateway.resources).toHaveBeenCalledTimes(1);
  });

  it('loads local pages and offers load more', () => {
    load([dataset('d1', 'Alpha'), dataset('d2', 'Beta'), dataset('d3', 'Gamma')], 2);

    expect(fixture.nativeElement.textContent).toContain('Load more');
    component.controller.loadMore();
    fixture.detectChanges();

    expect(controller.state().items.map((item) => item.id)).toEqual(['d1', 'd2', 'd3']);
    expect(gateway.resources).toHaveBeenCalledTimes(1);
  });

  it('shows only verified optional metadata and clearly states absent adapter metadata', () => {
    const metadata: ClearpipeResourceSummary = {
      id: 'd1', kind: 'dataset', name: 'Iris', project: 'research', version: 'v2',
      tags: ['approved'], updatedAt: '2026-07-22',
    };
    controller.state.set({
      kind: 'dataset', status: 'ready', filter: {pageSize: 50}, items: [metadata],
      total: 1, page: 0, pageSize: 50, hasMore: false, complete: true,
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('version v2');
    expect(text).toContain('approved');
    expect(text).toContain('updated 2026-07-22');
    expect(text).toContain('File count is not supplied by the authorized adapter.');
    expect(text).not.toContain('Version is not supplied by the authorized adapter.');
  });

  it('reports no results and retries transient resource failures', () => {
    gateway.resources.and.returnValues(
      of({status: 'failed', problem: {message: 'sensitive token', retryable: true}}),
      of(ready([dataset('d1', 'Iris')]))
    );
    controller.load();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Datasets could not be loaded.');
    expect(fixture.nativeElement.textContent).not.toContain('sensitive token');
    component.retry();
    component.search('none');
    fixture.detectChanges();

    expect(controller.state().status).toBe('empty');
    expect(fixture.nativeElement.textContent).toContain('No authorized datasets match this project or search.');
  });

  it('renders denied, stale, and deleted selection outcomes without reclassifying them', () => {
    gateway.resources.and.returnValue(of({status: 'denied_or_missing', problem: {message: 'private', retryable: false}}));
    controller.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('access could not be verified');

    load([dataset('d1', 'Iris')]);
    gateway.resources.and.returnValue(of({status: 'failed', problem: {message: 'temporary', retryable: true}}));
    component.refresh();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Showing stale dataset information');

    controller.markDeleted('d1');
    component.selectedId = 'd1';
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('selected dataset was deleted');
  });

  it('uses adapter management links and emits a credential-free safe reference', () => {
    load([dataset('d1', 'Iris')]);
    let emitted: ClearpipeResourceSelection | undefined;
    component.datasetSelected.subscribe((selection) => emitted = selection);

    component.select(controller.state().items[0]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('a')?.textContent).toContain('Manage Dataset');
    expect(emitted?.reference).toEqual({kind: 'dataset', resource_id: 'd1', label: 'Iris'});
    expect(JSON.stringify(emitted)).not.toContain('token');
    expect(JSON.stringify(emitted)).not.toContain('credential');
  });

  it('registers the dataset inspector form through the CP-17 extension registry', () => {
    const registry = TestBed.inject(ClearpipeExtensionRegistry);
    TestBed.inject(ClearpipeDatasetInspectorExtensionRegistration).register();

    expect(registry.formFor({
      id: 'task-1', kind: 'task', name: 'Consumer', label: 'Consumer',
      base_task: {kind: 'task-id', task_id: 'base-task'}, configuration: {},
      ports: [], visual: {position: {x: 0, y: 0}},
    })?.id).toBe(clearpipeDatasetInspectorExtension.form?.id);
  });
});
