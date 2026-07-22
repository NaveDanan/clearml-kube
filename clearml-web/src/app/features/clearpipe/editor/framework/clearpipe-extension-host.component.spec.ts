import {TestBed} from '@angular/core/testing';
import {ActivatedRoute, convertToParamMap, Router} from '@angular/router';
import {of, Subject} from 'rxjs';
import {ClearpipeEditorComponent} from '../clearpipe-editor.component';
import {ClearpipeAdapterService} from '../../platform/clearpipe-adapter.service';
import {ClearpipeExtensionRegistry} from './clearpipe-extension-registry';
import {clearpipeFixtureTaskExtension, clearpipeFixtureTaskNode} from './clearpipe-ui.fixtures';

describe('ClearPipe editor extension host', () => {
  let registry: ClearpipeExtensionRegistry;
  let unregisterExtension: () => void;
  let unregisterAction: () => void;

  beforeEach(() => {
    const router = jasmine.createSpyObj<Router>('Router', ['navigate', 'createUrlTree', 'serializeUrl'], {
      events: new Subject(),
    });
    router.createUrlTree.and.returnValue({} as ReturnType<Router['createUrlTree']>);
    router.serializeUrl.and.returnValue('/clearpipe');
    TestBed.configureTestingModule({
      imports: [ClearpipeEditorComponent],
      providers: [
        {provide: ActivatedRoute, useValue: {paramMap: of(convertToParamMap({taskId: 'new'}))}},
        {provide: Router, useValue: router},
        {provide: ClearpipeAdapterService, useValue: {validate: () => of({status: 'ready', data: {valid: true, issues: []}})}},
      ],
    });
    registry = TestBed.inject(ClearpipeExtensionRegistry);
    unregisterExtension = registry.register(clearpipeFixtureTaskExtension);
    unregisterAction = registry.registerCatalogAction({
      catalogEntryId: 'task',
      execute: () => undefined,
    });
  });

  afterEach(() => {
    unregisterAction();
    unregisterExtension();
  });

  it('mounts registered catalog and inspector extensions over the canonical selected node', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as unknown as {
      state: {
        create: () => unknown;
        addNode: (node: typeof clearpipeFixtureTaskNode) => unknown;
        selectedNodeId: {set: (id: string) => void};
      };
      routeSurface: {set: (surface: 'ready') => void};
    };
    component.state.create();
    component.state.addNode(clearpipeFixtureTaskNode);
    component.state.selectedNodeId.set(clearpipeFixtureTaskNode.id);
    component.routeSurface.set('ready');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('sm-clearpipe-catalog')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Task step');
    expect(fixture.nativeElement.querySelector('sm-clearpipe-config-panel')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Train model');
    expect(fixture.nativeElement.textContent).toContain('Base task: base-training-task');
    expect(fixture.nativeElement.textContent).toContain('train-model');
  });

  it('shows a safe visible reason when a catalog extension has no registered action', () => {
    unregisterAction();
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    fixture.detectChanges();

    const taskEntry = fixture.nativeElement.querySelector('.clearpipe-catalog__entry-button') as HTMLButtonElement;
    expect(taskEntry.disabled).toBeTrue();
    expect(fixture.nativeElement.textContent).toContain('not available in the current workspace');
  });
});
