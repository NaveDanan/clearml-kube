import {signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {Observable, of} from 'rxjs';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeAdapterOutcome} from '../platform/clearpipe-adapter.service';
import {ClearpipeValidationResponse} from '../clearpipe-api.service';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ClearpipeCodePreviewComponent} from '../editor/clearpipe-code-preview.component';
import {clearpipeSemanticFingerprint} from '../editor/clearpipe-code-preview.model';
import {ClearpipeToolbarComponent} from '../editor/clearpipe-toolbar.component';
import {ClearpipeDocumentTransferService} from '../editor/clearpipe-document-transfer.service';
import {clearpipeToolbarActions} from '../editor/clearpipe-toolbar.model';
import {functionGraph, taskGraph} from './clearpipe-fixtures';

describe('ClearPipe toolbar and code preview', () => {
  const lifecycle = (overrides: Partial<{
    busy: boolean;
    graph: boolean;
    readOnly: boolean;
    canSave: boolean;
    saveDisabledReason: string | null;
    capabilities: null;
  }> = {}) => ({
    busy: signal(overrides.busy ?? false),
    graph: signal(overrides.graph === false ? null : taskGraph()),
    readOnly: signal(overrides.readOnly ?? false),
    canSave: signal(overrides.canSave ?? true),
    saveDisabledReason: signal(overrides.saveDisabledReason ?? null),
    capabilities: signal(overrides.capabilities ?? null),
  }) as unknown as ClearpipeLifecycleService;

  it('exposes lifecycle actions and keeps only execution dependency-owned', () => {
    const actions = clearpipeToolbarActions(lifecycle(), true);
    expect(actions.map(action => action.id)).toEqual([
      'new', 'save', 'open', 'validate', 'import', 'export', 'preview', 'run', 'settings',
    ]);
    expect(actions.find(action => action.id === 'import')?.disabled).toBeFalse();
    expect(actions.find(action => action.id === 'export')?.disabled).toBeFalse();
    expect(actions.find(action => action.id === 'run')).toEqual(jasmine.objectContaining({
      disabled: true,
      disabledReason: jasmine.stringContaining('CP-26'),
    }));
  });

  it('reports a concrete disabled save reason and prevents invalid preview generation', () => {
    const actions = clearpipeToolbarActions(lifecycle({
      canSave: false,
      saveDisabledReason: 'You do not have permission to edit this ClearPipe definition.',
    }), false);
    expect(actions.find(action => action.id === 'save')?.disabledReason).toContain('permission');
    expect(actions.find(action => action.id === 'preview')).toEqual(jasmine.objectContaining({
      disabled: true,
      disabledReason: jasmine.stringContaining('supported ClearPipe graph'),
    }));
  });

  it('keeps primary actions keyboard reachable and moves secondary actions into More', () => {
    const blockedLifecycle = lifecycle({
      canSave: false,
      saveDisabledReason: 'Save requires edit permission.',
    });
    TestBed.configureTestingModule({
      imports: [ClearpipeToolbarComponent],
      providers: [
        {provide: ClearpipeLifecycleService, useValue: blockedLifecycle},
        {provide: ClearpipeDocumentTransferService, useValue: {
          downloadGraph: () => ({status: 'exported'}),
          importGraph: () => Promise.resolve({status: 'imported'}),
        }},
      ],
    });
    const fixture = TestBed.createComponent(ClearpipeToolbarComponent);
    fixture.detectChanges();
    const labels = [...fixture.nativeElement.querySelectorAll('button')]
      .map((button: HTMLButtonElement) => button.textContent.trim() || button.getAttribute('aria-label'));
    const save = fixture.nativeElement.querySelector('button[aria-describedby="clearpipe-action-save"]') as HTMLButtonElement;
    const more = fixture.nativeElement.querySelector('button[aria-label="More ClearPipe actions"]') as HTMLButtonElement;

    expect(labels).toEqual(jasmine.arrayContaining(['New', 'Save', 'Open', 'Validate', 'Code preview', 'More ClearPipe actions']));
    expect(save.disabled).toBeTrue();
    expect(more.tabIndex).toBe(0);
    expect(fixture.nativeElement.querySelector('#clearpipe-action-save').textContent).toContain('permission');
  });

  it('does not regenerate source for visual or transient-only changes', () => {
    const original = functionGraph();
    const visualOnly = structuredClone(original);
    visualOnly.visual.viewport.x = 500;
    visualOnly.nodes[0].visual.position.y = 240;
    const domainChange = structuredClone(original);
    domainChange.nodes[0].configuration.cache = true;

    expect(clearpipeSemanticFingerprint(visualOnly)).toBe(clearpipeSemanticFingerprint(original));
    expect(clearpipeSemanticFingerprint(domainChange)).not.toBe(clearpipeSemanticFingerprint(original));
  });

  it('synchronizes task and function previews from approved compiler output', () => {
    const adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', ['validate']);
    adapter.validate.and.callFake(request => {
      const graph = (request as {graph: ReturnType<typeof taskGraph>}).graph;
      return of(
        {status: 'loading'},
        {status: 'ready', data: {valid: true, issues: [], pipeline: {source: `# ${graph.nodes[0].kind}\n`}}},
      ) as Observable<ClearpipeAdapterOutcome<ClearpipeValidationResponse>>;
    });
    TestBed.configureTestingModule({
      imports: [ClearpipeCodePreviewComponent],
      providers: [{provide: ClearpipeAdapterService, useValue: adapter}],
    });
    const fixture = TestBed.createComponent(ClearpipeCodePreviewComponent);
    fixture.componentRef.setInput('graph', taskGraph());
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('# task');

    fixture.componentRef.setInput('graph', functionGraph());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('# function');
    expect(adapter.validate).toHaveBeenCalledTimes(2);
  });

  it('shows compiler diagnostics instead of inventing source when generation fails', () => {
    const adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', ['validate']);
    adapter.validate.and.returnValue(of(
      {status: 'loading'},
      {
        status: 'validation_failed' as const,
        data: {valid: false, issues: [{code: 'CPSEM008', message: 'A queue is required.', severity: 'error' as const}]},
        problem: {code: 'ValidationError', message: 'ClearPipe validation found issues.', retryable: false, issues: [
          {code: 'CPSEM008', message: 'A queue is required.', severity: 'error'},
        ]},
      },
    ) as Observable<ClearpipeAdapterOutcome<ClearpipeValidationResponse>>);
    TestBed.configureTestingModule({
      imports: [ClearpipeCodePreviewComponent],
      providers: [{provide: ClearpipeAdapterService, useValue: adapter}],
    });
    const fixture = TestBed.createComponent(ClearpipeCodePreviewComponent);
    fixture.componentRef.setInput('graph', taskGraph());
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('CPSEM008');
    expect(fixture.nativeElement.querySelector('code')).toBeNull();
  });

  it('copies and downloads read-only generated source', async () => {
    const adapter = jasmine.createSpyObj<ClearpipeAdapterService>('ClearpipeAdapterService', ['validate']);
    adapter.validate.and.returnValue(of({status: 'ready', data: {
      valid: true, issues: [], pipeline: {source: 'print("clearpipe")\n'},
    }}) as Observable<ClearpipeAdapterOutcome<ClearpipeValidationResponse>>);
    const writeText = jasmine.createSpy('writeText').and.resolveTo();
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    const createObjectURL = spyOn(URL, 'createObjectURL').and.returnValue('blob:clearpipe');
    spyOn(URL, 'revokeObjectURL');
    const click = spyOn(HTMLAnchorElement.prototype, 'click');
    TestBed.configureTestingModule({
      imports: [ClearpipeCodePreviewComponent],
      providers: [{provide: ClearpipeAdapterService, useValue: adapter}],
    });
    const fixture = TestBed.createComponent(ClearpipeCodePreviewComponent);
    fixture.componentRef.setInput('graph', taskGraph());
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    const component = fixture.componentInstance;

    await component.copy();
    component.download();

    expect(writeText).toHaveBeenCalledWith('print("clearpipe")\n');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
  });
});
