import {Injectable} from '@angular/core';
import {Actions, createEffect, ofType} from '@ngrx/effects';
import {concat, of, timer} from 'rxjs';
import {catchError, exhaustMap, map, startWith, switchMap, takeWhile} from 'rxjs/operators';
import {AutoscalerExecution, autoscalerActions} from '../actions/autoscaler.actions';
import {addMessage} from '@common/core/actions/layout.actions';
import {ApiAutoscalerService} from '~/business-logic/api-services/autoscaler.service';

const EXECUTION_POLL_INTERVAL = 2000;
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'pending', 'running']);

@Injectable()
export class AutoscalerEffects {

  constructor(
    private actions$: Actions,
    private autoscalerApi: ApiAutoscalerService,
  ) {
  }

  getSettings = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getSettings),
    switchMap(() => this.autoscalerApi.autoscalerGetSettings({}).pipe(
      map((res: any) => autoscalerActions.setSettings({settings: res.settings ?? {}})),
      catchError(() => [
        addMessage('error', 'Failed to load autoscaler settings'),
      ]),
    )),
  ));

  getDashboard = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getDashboard),
    exhaustMap(() => this.autoscalerApi.autoscalerGetDashboard({}).pipe(
      switchMap((res: any) => [
        autoscalerActions.setDashboard({dashboard: res}),
      ]),
      catchError(() => [
        autoscalerActions.setDashboardError({error: 'Failed to refresh Run:ai dashboard'}),
      ]),
    )),
  ));

  updateSettings = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.updateSettings),
    switchMap(action => this.autoscalerApi.autoscalerSetSettings(action.settings).pipe(
      switchMap(() => [
        autoscalerActions.setSettings({settings: action.settings}),
        addMessage('success', 'Autoscaler settings saved'),
      ]),
      catchError(() => [
        addMessage('error', 'Failed to save autoscaler settings'),
      ]),
    )),
  ));

  testConnection = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.testConnection),
    switchMap(action => {
      return this.autoscalerApi.autoscalerTestConnection(action.settings).pipe(
        switchMap((res: any) => [
          autoscalerActions.setConnectionResult({result: res}),
          autoscalerActions.setConnectionStatus({status: res.connected ? 'success' : 'error'}),
        ]),
        catchError(() => [
          autoscalerActions.setConnectionResult({result: {connected: false, error: 'Connection request failed'}}),
          autoscalerActions.setConnectionStatus({status: 'error'}),
        ]),
        startWith(
          autoscalerActions.setConnectionResult({result: null}),
          autoscalerActions.setConnectionStatus({status: 'testing'}),
        ),
      );
    }),
  ));

  submitWorkload = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.submitWorkload),
    switchMap(action => this.autoscalerApi.autoscalerSubmitWorkload({
      workload: action.workload,
    }).pipe(
      switchMap(res => this.trackExecution(res, {
        queued: 'Workload queued for execution',
        success: 'Workload submitted successfully',
        error: 'Workload submission failed',
      })),
      catchError(() => [
        autoscalerActions.setLastExecution({
          execution: {status: 'error', stderr: 'Request failed', timestamp: new Date().toISOString()},
        }),
        addMessage('error', 'Workload submission failed'),
      ]),
    )),
  ));

  saveAppInstance = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.saveAppInstance),
    switchMap(action => this.autoscalerApi.autoscalerSaveAppInstance({workload: action.workload}).pipe(
      switchMap((res: any) => [
        autoscalerActions.getDashboard(),
        ...(res.status === 'error' ? [addMessage('error', 'Failed to save app instance')] : []),
      ]),
      catchError(() => [
        addMessage('error', 'Failed to save app instance'),
      ]),
    )),
  ));

  deleteWorkload = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.deleteWorkload),
    switchMap(action => this.autoscalerApi.autoscalerDeleteWorkload(action.workload).pipe(
      switchMap(res => this.trackExecution(res, {
        queued: 'Workload deletion queued',
        success: 'Workload deleted successfully',
        error: 'Failed to delete workload',
      })),
      catchError(() => [
        addMessage('error', 'Failed to delete workload'),
      ]),
    )),
  ));

  resetSettings = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.resetSettings),
    switchMap(() => this.autoscalerApi.autoscalerResetSettings({}).pipe(
      map(() => autoscalerActions.setSettings({settings: {}})),
      catchError(() => [
        addMessage('error', 'Failed to reset autoscaler settings'),
      ]),
    )),
  ));

  private trackExecution(
    result: any,
    messages: {queued: string; success: string; error: string},
  ) {
    const execution = this.normalizeExecution(result);
    const initialActions = [
      autoscalerActions.setLastExecution({execution}),
      autoscalerActions.getDashboard(),
    ];

    if (!result.execution_id || !this.isExecutionActive(result.status)) {
      return of(
        ...initialActions,
        this.executionMessage(result.status, messages.success, messages.error),
      );
    }

    return concat(
      of(
        ...initialActions,
        addMessage('success', messages.queued),
      ),
      timer(EXECUTION_POLL_INTERVAL, EXECUTION_POLL_INTERVAL).pipe(
        switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: result.execution_id})),
        takeWhile((response: any) => this.isExecutionActive(response.status), true),
        switchMap((response: any) => {
          const actions: any[] = [
            autoscalerActions.setLastExecution({execution: this.normalizeExecution(response)}),
          ];

          if (!this.isExecutionActive(response.status)) {
            actions.push(autoscalerActions.getDashboard());
            actions.push(this.executionMessage(response.status, messages.success, messages.error));
          }

          return actions;
        }),
        catchError(() => [
          autoscalerActions.setLastExecution({
            execution: {
              status: 'error',
              stderr: 'Execution polling failed',
              execution_id: result.execution_id,
              timestamp: new Date().toISOString(),
            },
          }),
          addMessage('error', messages.error),
        ]),
      ),
    );
  }

  private normalizeExecution(result: any): AutoscalerExecution {
    return {
      status: (result.status || 'success') as AutoscalerExecution['status'],
      stdout: result.stdout,
      stderr: result.stderr,
      timestamp: result.timestamp || new Date().toISOString(),
      execution_id: result.execution_id,
      return_code: result.return_code,
    };
  }

  private isExecutionActive(status?: string): boolean {
    return ACTIVE_EXECUTION_STATUSES.has((status || '').toLowerCase());
  }

  private executionMessage(status: string | undefined, success: string, error: string) {
    return addMessage(
      (status || '').toLowerCase() === 'error' ? 'error' : 'success',
      (status || '').toLowerCase() === 'error' ? error : success,
    );
  }
}
