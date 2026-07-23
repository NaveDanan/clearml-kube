import {signal} from '@angular/core';
import {ComponentFixture, fakeAsync, flushMicrotasks, TestBed} from '@angular/core/testing';
import {ActivatedRoute, convertToParamMap, Router} from '@angular/router';
import {Store} from '@ngrx/store';
import {BehaviorSubject, Observable, of, Subject} from 'rxjs';
import {ConfigurationService} from '@common/shared/services/configuration.service';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeCanvasComponent} from '../editor/clearpipe-canvas.component';
import {CanvasProfiler} from '../editor/clearpipe-canvas.adapter';
import {ClearpipeCodePreviewComponent} from '../editor/clearpipe-code-preview.component';
import {ClearpipeDocumentTransferService} from '../editor/clearpipe-document-transfer.service';
import {ClearpipeEditorComponent} from '../editor/clearpipe-editor.component';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ClearpipeToolbarComponent} from '../editor/clearpipe-toolbar.component';
import {ClearpipeExecutionService} from '../editor/execution/clearpipe-execution.service';
import {ClearpipeExtensionRegistry} from '../editor/framework/clearpipe-extension-registry';
import {ClearpipeFunctionAuthoringCreateComponent} from '../editor/function-authoring/function-authoring-create.component';
import {ClearpipeFunctionAuthoringService} from '../editor/function-authoring/function-authoring.service';
import {createEmptyGraphV2, GraphStoreService} from '../domain/graph-store.service';
import {GraphV2} from '../domain/graph-v2.types';
import {functionGraph} from './clearpipe-fixtures';
import {ClearpipeTaskVerticalSliceTransport} from './clearpipe-task-vertical-slice.fixture';

const representativeGraph = (): GraphV2 => {
  const graph = createEmptyGraphV2({name: 'cp30-representative-graph'});
  return {
    ...graph,
    nodes: Array.from({length: 180}, (_, index) => ({
      id: `cp30-node-${index}`,
      kind: 'function' as const,
      name: `cp30_node_${index}`,
      label: `CP-30 node ${index}`,
      signature: 'def cp30_step() -> int',
      source: 'def cp30_step() -> int:\n    return 1\n',
      ports: [],
      configuration: {task_type: 'data_processing'},
      visual: {position: {x: (index % 18) * 220, y: Math.floor(index / 18) * 120}},
    })),
  };
};

describe('CP-30 accessibility and performance hardening', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('keeps a 180-node keyboard move to one command profile mark', async () => {
    await TestBed.configureTestingModule({
      imports: [ClearpipeCanvasComponent],
      providers: [GraphStoreService],
    }).compileComponents();
    const store = TestBed.inject(GraphStoreService);
    const profiler = jasmine.createSpyObj<CanvasProfiler>('CanvasProfiler', ['mark']);
    const fixture = TestBed.createComponent(ClearpipeCanvasComponent);
    fixture.componentRef.setInput('profiler', profiler);
    expect(store.load(representativeGraph()).status).toBe('ok');
    fixture.detectChanges();
    const surface = fixture.nativeElement.querySelector('.canvas-surface') as HTMLElement;

    expect(fixture.nativeElement.querySelectorAll('[data-node-id]')).toHaveSize(180);
    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', ctrlKey: true, bubbles: true, cancelable: true}));
    surface.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true, cancelable: true}));

    expect(profiler.mark).toHaveBeenCalledTimes(1);
    expect(profiler.mark).toHaveBeenCalledWith({phase: 'move', nodeCount: 180, bindingCount: 0});
  });

  it('does not regenerate code for a visual-only graph change', async () => {
    const adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', ['validate']);
    adapter.validate.and.returnValue(of({status: 'ready', data: {
      valid: true,
      issues: [],
      pipeline: {source: '# ClearPipe\n'},
    }}));
    await TestBed.configureTestingModule({
      imports: [ClearpipeCodePreviewComponent],
      providers: [{provide: ClearpipeAdapterService, useValue: adapter}],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClearpipeCodePreviewComponent);
    const graph = functionGraph();
    fixture.componentRef.setInput('graph', graph);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const visualOnly = structuredClone(graph);
    visualOnly.visual.viewport.x = 360;
    visualOnly.nodes[0].visual.position.y = 240;
    fixture.componentRef.setInput('graph', visualOnly);
    fixture.detectChanges();

    expect(adapter.validate).toHaveBeenCalledTimes(1);
  });

  it('associates an authoring failure with its form', async () => {
    const authoring = jasmine.createSpyObj('ClearpipeFunctionAuthoringService', ['create']);
    authoring.create.and.returnValue({ok: false, errors: [{message: 'Function name is required.'}]});
    await TestBed.configureTestingModule({
      imports: [ClearpipeFunctionAuthoringCreateComponent],
      providers: [{provide: ClearpipeFunctionAuthoringService, useValue: authoring}],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClearpipeFunctionAuthoringCreateComponent);
    fixture.componentInstance.create();
    fixture.detectChanges();
    const form = fixture.nativeElement.querySelector('form') as HTMLFormElement;
    const error = fixture.nativeElement.querySelector('#clearpipe-function-create-error') as HTMLElement;

    expect(form.getAttribute('aria-describedby')).toBe(error.id);
    expect(error.getAttribute('role')).toBe('alert');
  });

  it('keeps one live execution result and traps a narrow drawer until Escape', fakeAsync(() => {
    const params = new BehaviorSubject(convertToParamMap({taskId: 'new'}));
    const lifecycle = {
      graphStore: {
        selectedNode: signal(null),
        selectedNodeId: signal<string | null>(null),
        removeNode: jasmine.createSpy('removeNode'),
      },
      graph: signal(functionGraph()),
      dirty: signal(false),
      readOnly: signal(false),
      status: signal('ready'),
      identity: signal({taskId: 'cp30-editor', revision: 1, name: 'CP-30 editor'}),
      problem: signal(null),
      busy: signal(false),
      canSave: signal(true),
      saveDisabledReason: signal(null),
      capabilities: signal(null),
      open: async () => undefined,
      new: jasmine.createSpy('new'),
      save: async () => undefined,
    } as unknown as ClearpipeLifecycleService;
    const execution = {
      presentation: signal({
        preflight: {scopeKey: null, state: 'idle', reasons: [], evidence: null},
        run: {state: 'idle', runTaskId: null, message: null},
        tracking: {state: 'idle', message: null, controller: null, receivedNodes: 0, totalNodes: null},
        nodes: [],
      }),
      toolbarAction: signal({disabled: true, disabledReason: 'Run is unavailable.'}),
      routeReady: signal(true),
      run: signal({state: 'idle', runTaskId: null, message: null}),
      setRouteContext: jasmine.createSpy('setRouteContext'),
      refresh: async () => undefined,
      submit: async () => undefined,
      nodeStatuses: () => [],
      openPipelineRun: async () => true,
      openTask: async () => true,
      openResource: async () => true,
    } as unknown as ClearpipeExecutionService;
    const extensions = {
      catalogEntries: () => [],
      catalogActionAvailability: () => ({available: true}),
      catalogEntry: () => undefined,
      dispatchCatalogAction: async () => ({status: 'dispatched'}),
      get: () => undefined,
      formFor: () => undefined,
    } as unknown as ClearpipeExtensionRegistry;
    const transport = new ClearpipeTaskVerticalSliceTransport();
    const post = <T>(url: string, body: unknown): Observable<T> => {
      if (url.endsWith('/projects.get_all')) {
        expect(body).toEqual({
          page: 0,
          page_size: 500,
          only_fields: ['id', 'name'],
        });
        return of({projects: []} as T);
      }
      return transport.post<T>(url, body);
    };
    const router = jasmine.createSpyObj<Router>('Router', ['navigate', 'createUrlTree', 'serializeUrl'], {events: new Subject()});
    router.navigate.and.resolveTo(true);
    router.createUrlTree.and.returnValue({} as never);
    router.serializeUrl.and.returnValue('/clearpipe');

    TestBed.overrideComponent(ClearpipeEditorComponent, {
      set: {providers: [{provide: ClearpipeExecutionService, useValue: execution}]},
    });
    TestBed.configureTestingModule({
      imports: [ClearpipeEditorComponent],
      providers: [
        {provide: ActivatedRoute, useValue: {paramMap: params}},
        {provide: Router, useValue: router},
        {provide: ClearpipeLifecycleService, useValue: lifecycle},
        {provide: ClearpipeExecutionService, useValue: execution},
        {provide: ClearpipeExtensionRegistry, useValue: extensions},
        ClearpipeApiService,
        ClearpipeAdapterService,
        {provide: SmApiRequestsService, useValue: {post}},
        {provide: Store, useValue: {select: () => of({id: 'cp30-accessibility-user'})}},
        {provide: ConfigurationService, useValue: {configuration: () => ({clearpipeEnabled: true})}},
        {provide: ClearpipeDocumentTransferService, useValue: {
          downloadGraph: () => ({status: 'exported'}),
          importGraph: async () => ({status: 'imported'}),
        }},
      ],
    });
    const fixture: ComponentFixture<ClearpipeEditorComponent> = TestBed.createComponent(ClearpipeEditorComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('sm-clearpipe-execution-results')).toHaveSize(1);
    const component = fixture.componentInstance as unknown as {isNarrow: {set(value: boolean): void}};
    component.isNarrow.set(true);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector('[data-panel-trigger="palette"]') as HTMLButtonElement;
    trigger.click();
    flushMicrotasks();
    fixture.detectChanges();
    const drawer = fixture.nativeElement.querySelector('#clearpipe-palette') as HTMLElement;
    const heading = drawer.querySelector('#clearpipe-palette-title') as HTMLElement;
    const lastFocusable = drawer.querySelector('.clearpipe-catalog__focus-canvas') as HTMLButtonElement;

    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    heading.focus();
    heading.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}));
    expect(document.activeElement).toBe(lastFocusable);
    window.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as {activeDrawer: () => unknown}).activeDrawer()).toBeNull();
    expect(document.activeElement).toBe(trigger);
  }));

  it('announces a completed toolbar save', async () => {
    const status = signal('ready');
    const lifecycle = {
      graph: signal(functionGraph()),
      readOnly: signal(false),
      busy: signal(false),
      canSave: signal(true),
      saveDisabledReason: signal(null),
      capabilities: signal(null),
      status,
      problem: signal(null),
      save: async () => status.set('saved'),
      new: jasmine.createSpy('new'),
    } as unknown as ClearpipeLifecycleService;
    await TestBed.configureTestingModule({
      imports: [ClearpipeToolbarComponent],
      providers: [
        {provide: ClearpipeLifecycleService, useValue: lifecycle},
        {provide: ClearpipeDocumentTransferService, useValue: {
          downloadGraph: () => ({status: 'exported'}),
          importGraph: async () => ({status: 'imported'}),
        }},
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(ClearpipeToolbarComponent);
    fixture.detectChanges();
    const save = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find(button => button.textContent?.trim() === 'Save')!;
    save.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[aria-live="polite"]').textContent).toContain('ClearPipe definition saved.');
  });
});
