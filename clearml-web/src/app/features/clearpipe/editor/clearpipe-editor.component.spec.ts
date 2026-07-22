/* Test-only access verifies private route/conflict safety boundaries. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {TestBed} from '@angular/core/testing';
import {BehaviorSubject, of, Subject, throwError} from 'rxjs';
import {ActivatedRoute, convertToParamMap, Router} from '@angular/router';
import {MatDialog} from '@angular/material/dialog';
import {Store} from '@ngrx/store';
import {ClearpipeEditorComponent} from './clearpipe-editor.component';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {emptyClearpipeDefinition} from '../clearpipe.models';
import {HttpErrorResponse} from '@angular/common/http';

describe('ClearpipeEditorComponent navigation safety', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let api: jasmine.SpyObj<ClearpipeApiService>;
  let router: jasmine.SpyObj<Router>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let store: jasmine.SpyObj<Store>;

  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({taskId: 'task-a'}));
    api = jasmine.createSpyObj<ClearpipeApiService>('ClearpipeApiService', ['getById', 'update', 'validate', 'getResources', 'start']);
    api.getById.and.callFake((id: string) => of({...emptyClearpipeDefinition(), id, task_id: id, name: id, revision: 1}));
    router = jasmine.createSpyObj<Router>('Router', ['navigate']);
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

  it('keeps the local graph when a 409 conflict dialog is dismissed', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    component.state.addNode('execute', {x: 0, y: 0});
    const localNodes = component.state.definition().nodes;
    component.handleSaveError(new HttpErrorResponse({status: 409}), component.state.definition());
    expect(component.state.definition().nodes).toEqual(localNodes);
    expect(component.state.dirty()).toBeTrue();
    expect(api.getById.calls.count()).toBe(1);
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

  it('prevents a second run submission while the first request is pending', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    const pending = new Subject<{run_task_id: string}>();
    api.start.and.returnValue(pending);

    component.startRun('task-a', 'queue-a', {});
    component.startRun('task-a', 'queue-a', {});

    expect(api.start).toHaveBeenCalledTimes(1);
    expect(component.running()).toBeTrue();
    pending.next({run_task_id: 'run-a'});
    pending.complete();
    expect(component.running()).toBeFalse();
  });

  it('clears the running lock and reports a failed run request', () => {
    const fixture = TestBed.createComponent(ClearpipeEditorComponent);
    const component = fixture.componentInstance as any;
    api.start.and.returnValue(throwError(() => new Error('network')));
    store.dispatch.calls.reset();

    component.startRun('task-a', 'queue-a', {});

    expect(component.running()).toBeFalse();
    expect(store.dispatch).toHaveBeenCalledWith(jasmine.objectContaining({severity: 'error', msg: 'Failed to start ClearPipe run'}));
  });
});
