/* Test-only access verifies private route and workspace-shell boundaries. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {TestBed} from '@angular/core/testing';
import {BehaviorSubject, of, Subject, throwError} from 'rxjs';
import {ActivatedRoute, convertToParamMap, Router} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {Store} from '@ngrx/store';
import {ClearpipeEditorComponent} from './clearpipe-editor.component';
import {CLEARPIPE_WORKSPACE_SLOTS} from './clearpipe-workspace-slots';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {emptyClearpipeDefinition} from '../clearpipe.models';
import {GRAPH_V2_SCHEMA_VERSION} from '../domain/graph-v2.types';
import {HttpErrorResponse} from '@angular/common/http';

describe('ClearpipeEditorComponent workspace shell', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let api: jasmine.SpyObj<ClearpipeApiService>;
  let router: jasmine.SpyObj<Router>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let store: jasmine.SpyObj<Store>;
  let originalInnerWidth: number;

  const v2Definition = (id: string) => ({
    ...emptyClearpipeDefinition(),
    id,
    task_id: id,
    name: id,
    revision: 1,
    schema_version: GRAPH_V2_SCHEMA_VERSION,
  });

  beforeEach(() => {
    originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', {configurable: true, value: 1280, writable: true});
    params = new BehaviorSubject(convertToParamMap({taskId: 'task-a'}));
    api = jasmine.createSpyObj<ClearpipeApiService>('ClearpipeApiService', [
      'archive', 'create', 'delete', 'getById', 'getResources', 'start', 'update', 'validate'
    ]);
    api.getById.and.callFake((id: string) => of(v2Definition(id)));
    router = jasmine.createSpyObj<Router>('Router', ['navigate', 'createUrlTree', 'serializeUrl'], {events: new Subject()});
    router.createUrlTree.and.returnValue({} as any);
    router.serializeUrl.and.returnValue('/clearpipe');
    dialog = jasmine.createSpyObj<MatDialog>('MatDialog', ['open']);
    dialog.open.and.returnValue({afterClosed: () => of(false)} as any);
    store = jasmine.createSpyObj<Store>('Store', ['dispatch']);
    TestBed.configureTestingModule({
      imports: [ClearpipeEditorComponent],
      providers: [
        {provide: ActivatedRoute, useValue: {paramMap: params}},
        {provide: ClearpipeApiService, useValue: api},
        {provide: Router, useValue: router},
        {provide: MatDialog, useValue: dialog},
        {provide: Store, useValue: store},
      ]
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', {configurable: true, value: originalInnerWidth, writable: true});
  });

  it('keeps dirty task A when the reused route changes to task B and the user stays', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    component.state.addNode('dataset', {x: 0, y: 0});

    params.next(convertToParamMap({taskId: 'task-b'}));

    expect(dialog.open).toHaveBeenCalled();
    expect(api.getById).not.toHaveBeenCalledWith('task-b');
    expect(component.state.definition().task_id).toBe('task-a');
    expect(component.state.dirty()).toBeTrue();
    expect(router.navigate).toHaveBeenCalledWith(['/clearpipe', 'task-a'], {replaceUrl: true});
  });

  it('keeps local state when reloading after a conflict fails', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    component.state.addNode('report', {x: 0, y: 0});
    const localNodes = component.state.definition().nodes;
    api.getById.and.returnValue(throwError(() => new Error('network')));

    component.load('task-a');

    expect(component.state.definition().nodes).toEqual(localNodes);
    expect(component.state.dirty()).toBeTrue();
    expect(component.routeSurface()).toBe('error');
  });

  it('rejects an import one byte above the server 4 MiB graph limit', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    store.dispatch.calls.reset();

    component.importJson({target: {files: [{size: 4 * 1024 * 1024 + 1}], value: 'oversized.json'}});

    expect(store.dispatch).toHaveBeenCalledWith(jasmine.objectContaining({
      severity: 'error',
      msg: 'ClearPipe import is larger than the 4 MiB server graph limit',
    }));
  });

  it('preserves graph selection and dirty state while a desktop panel collapses', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    component.state.addNode('dataset', {x: 0, y: 0});
    const nodeId = component.state.selectedNodeId();
    const definition = component.state.definition();

    component.togglePanel('palette');

    expect(component.paletteOpen()).toBeFalse();
    expect(component.state.selectedNodeId()).toBe(nodeId);
    expect(component.state.definition()).toEqual(definition);
    expect(component.state.dirty()).toBeTrue();
  });

  it('provides labelled keyboard resize separators clamped to useful widths', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;
    const resizeCatalog = fixture.nativeElement.querySelector('[aria-label="Resize authoring catalog"]') as HTMLElement;

    expect(resizeCatalog.getAttribute('role')).toBe('separator');
    expect(resizeCatalog.getAttribute('aria-orientation')).toBe('vertical');
    component.resizeWithKeyboard({key: 'End', preventDefault: jasmine.createSpy()} as any, 'palette');
    component.resizeWithKeyboard({key: 'ArrowRight', preventDefault: jasmine.createSpy()} as any, 'palette');

    expect(component.paletteWidth()).toBe(480);
    expect(resizeCatalog.getAttribute('aria-valuemin')).toBe('240');
    expect(resizeCatalog.getAttribute('aria-valuemax')).toBe('480');
  });

  it('uses one narrow drawer at a time and restores focus to its invoker', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;
    const catalogTrigger = fixture.nativeElement.querySelector('[data-panel-trigger="palette"]') as HTMLButtonElement;
    catalogTrigger.focus();
    component.isNarrow.set(true);

    component.openPanel('palette', catalogTrigger);
    fixture.detectChanges();
    expect(component.activeDrawer()).toBe('palette');
    expect(fixture.nativeElement.querySelector('.workspace-panel--palette.workspace-panel--drawer')).not.toBeNull();

    component.openPanel('inspector', catalogTrigger);
    fixture.detectChanges();
    expect(component.activeDrawer()).toBe('inspector');
    expect(fixture.nativeElement.querySelector('.workspace-panel--palette.workspace-panel--hidden')).not.toBeNull();

    component.closeDrawer();
    expect(component.activeDrawer()).toBeNull();
    expect(document.activeElement).toBe(catalogTrigger);
  });

  it('keeps the run entry disabled with a visible, described real gate', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    fixture.detectChanges();
    const run = fixture.nativeElement.querySelector('button[aria-describedby="clearpipe-run-unavailable"]') as HTMLButtonElement;
    const reason = fixture.nativeElement.querySelector('#clearpipe-run-unavailable') as HTMLElement;

    expect(run.disabled).toBeTrue();
    expect(reason.textContent).toContain('approved ClearML Agent path');
    expect(CLEARPIPE_WORKSPACE_SLOTS).toContain('workspace.preview');
    expect(CLEARPIPE_WORKSPACE_SLOTS).toContain('workspace.execution');
  });

  it('renders a distinct permission-denied route surface without a canvas', () => {
    api.getById.and.returnValue(throwError(() => new HttpErrorResponse({status: 403})));
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance as any;

    expect(component.routeSurface()).toBe('denied');
    expect(fixture.nativeElement.querySelector('.route-surface--error h2').textContent).toContain('Access unavailable');
    expect(fixture.nativeElement.querySelector('sm-clearpipe-canvas')).toBeNull();
  });
});
