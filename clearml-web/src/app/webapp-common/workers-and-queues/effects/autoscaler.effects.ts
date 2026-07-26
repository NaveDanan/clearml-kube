import {Injectable} from '@angular/core';
import {Actions, createEffect, ofType} from '@ngrx/effects';
import {concat, of, timer} from 'rxjs';
import {catchError, exhaustMap, map, startWith, switchMap, takeUntil, takeWhile} from 'rxjs/operators';
import {AutoscalerExecution, autoscalerActions} from '../actions/autoscaler.actions';
import {addMessage, setNotificationDialog, setServerError} from '@common/core/actions/layout.actions';
import {ApiAutoscalerService} from '~/business-logic/api-services/autoscaler.service';
import {ErrorService} from '@common/shared/services/error.service';
import {inject} from '@angular/core';
import {escape} from 'lodash-es';

const EXECUTION_POLL_INTERVAL = 2000;
const ACTIVE_EXECUTION_STATUSES = new Set(['queued', 'pending', 'running']);

@Injectable()
export class AutoscalerEffects {
  private errService = inject(ErrorService);

  constructor(
    private actions$: Actions,
    private autoscalerApi: ApiAutoscalerService,
  ) {
  }

  getSettings = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getSettings),
    switchMap(() => this.autoscalerApi.autoscalerGetSettings({}).pipe(
      map((res: any) => autoscalerActions.setSettings({settings: res.settings ?? {}})),
      catchError(error => this.requestErrorActions(error, 'Failed to load autoscaler settings')),
    )),
  ));

  getDashboard = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getDashboard),
    exhaustMap(() => this.autoscalerApi.autoscalerGetDashboard({}).pipe(
      switchMap((res: any) => res?.connected
        ? concat(of(autoscalerActions.setDashboard({dashboard: res})), this.pollDashboard(res))
        : this.pollDashboard(res)),
      catchError(error => this.requestErrorActions(error, 'Failed to refresh Run:ai dashboard', [
        autoscalerActions.setDashboardError({error: this.errorMessage(error, 'Failed to refresh Run:ai dashboard')}),
      ])),
    )),
  ));

  getWorkloadInfo = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getWorkloadInfo),
    switchMap(action => this.autoscalerApi.autoscalerGetWorkloadInfo({workload_id: action.workloadId}).pipe(
      map((res: any) => autoscalerActions.setWorkloadInfo({
        info: res ?? {connected: false, workload_id: action.workloadId},
      })),
      catchError(error => of(autoscalerActions.setWorkloadInfo({
        info: {connected: false, workload_id: action.workloadId, error: this.errorMessage(error, 'Failed to load workload info')},
      }))),
    )),
  ));

  updateSettings = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.updateSettings),
    switchMap(action => this.autoscalerApi.autoscalerSetSettings(action.settings).pipe(
      switchMap(() => [
        autoscalerActions.setSettings({settings: action.settings}),
        addMessage('success', 'Autoscaler settings saved'),
      ]),
      catchError(error => this.requestErrorActions(error, 'Failed to save autoscaler settings')),
    )),
  ));

  testConnection = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.testConnection),
    switchMap(action => this.autoscalerApi.autoscalerSetSettings(action.settings).pipe(
        switchMap(() => this.autoscalerApi.autoscalerTestConnection({})),
        switchMap(res => this.trackConnectionTest(res, action.settings)),
        catchError(error => this.requestErrorActions(error, 'Run:ai connection failed', [
          autoscalerActions.setConnectionResult({result: {connected: false, error: this.errorMessage(error, 'Connection request failed')}}),
          autoscalerActions.setConnectionStatus({status: 'error'}),
        ])),
        startWith(
          autoscalerActions.setConnectionResult({result: null}),
          autoscalerActions.setConnectionStatus({status: 'testing'}),
        ),
      )),
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
      catchError(error => this.requestErrorActions(error, 'Workload submission failed', [
        autoscalerActions.setLastExecution({
          execution: {status: 'error', stderr: this.errorMessage(error, 'Request failed'), timestamp: new Date().toISOString()},
        }),
      ])),
    )),
  ));

  saveAppInstance = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.saveAppInstance),
    switchMap(action => this.autoscalerApi.autoscalerSaveAppInstance({workload: action.workload}).pipe(
      switchMap((res: any) => [
        autoscalerActions.getDashboard(),
        ...(res.status === 'error' ? [addMessage('error', 'Failed to save app instance')] : []),
      ]),
      catchError(error => this.requestErrorActions(error, 'Failed to save app instance')),
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
      catchError(error => this.requestErrorActions(error, 'Failed to delete workload')),
    )),
  ));

  stopWorkload = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.stopWorkload),
    switchMap(action => this.autoscalerApi.autoscalerStopWorkload(action.workload).pipe(
      switchMap(res => this.trackExecution(res, {
        queued: 'Workload stop queued',
        success: 'Workload stopped successfully',
        error: 'Failed to stop workload',
      })),
      catchError(error => this.requestErrorActions(error, 'Failed to stop workload')),
    )),
  ));

  resetSettings = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.resetSettings),
    switchMap(() => this.autoscalerApi.autoscalerResetSettings({}).pipe(
      map(() => autoscalerActions.setSettings({settings: {}})),
      catchError(error => this.requestErrorActions(error, 'Failed to reset autoscaler settings')),
    )),
  ));

  getProjectResources = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getProjectResources),
    switchMap(action => this.autoscalerApi.autoscalerGetProjectResources({project: action.project}).pipe(
      switchMap((res: any) => res?.connected
        ? concat(of(autoscalerActions.setProjectResources({resources: res})), this.pollProjectResources(res))
        : this.pollProjectResources(res)),
      catchError(error => this.requestErrorActions(error, 'Failed to load Run:ai project resources', [
        autoscalerActions.setProjectResources({
          resources: {connected: false, error: this.errorMessage(error, 'Failed to load Run:ai project resources')},
        }),
      ])),
    )),
  ));

  getTemplate = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getTemplate),
    switchMap(action => this.autoscalerApi.autoscalerGetTemplate({
      name: action.name,
      project: action.project,
    }).pipe(
      switchMap((res: any) => res?.connected
        ? concat(of(autoscalerActions.setTemplate({template: res})), this.pollTemplate(res))
        : this.pollTemplate(res)),
      catchError(error => this.requestErrorActions(error, 'Failed to load Run:ai workload template', [
        autoscalerActions.setTemplate({
          template: {
            connected: false,
            name: action.name,
            project: action.project,
            error: this.errorMessage(error, 'Failed to load Run:ai workload template'),
          },
        }),
      ])),
      takeUntil(this.actions$.pipe(ofType(autoscalerActions.clearTemplate))),
    )),
  ));

  getWorkloadLogs = createEffect(() => this.actions$.pipe(
    ofType(autoscalerActions.getWorkloadLogs),
    switchMap(action => this.autoscalerApi.autoscalerGetWorkloadLogs(action.workload).pipe(
      switchMap((res: any) => res?.connected
        ? concat(of(autoscalerActions.setWorkloadLogs({logs: res})), this.pollWorkloadLogs(res))
        : this.pollWorkloadLogs(res)),
      catchError(error => [
        autoscalerActions.setWorkloadLogs({
          logs: {
            connected: false,
            workload_name: action.workload.workload_name,
            project: action.workload.project,
            error: this.errorMessage(error, 'Failed to load workload logs'),
          },
        }),
      ]),
    )),
  ));

  private pollWorkloadLogs(res: any) {
    if (!res?.execution_id) {
      return of(autoscalerActions.setWorkloadLogs({logs: res ?? {}}));
    }
    return timer(EXECUTION_POLL_INTERVAL, EXECUTION_POLL_INTERVAL).pipe(
      switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: res.execution_id})),
      takeWhile((response: any) => this.isExecutionActive(response.status), true),
      switchMap((response: any) => {
        if (this.isExecutionActive(response.status)) {
          return [];
        }
        if (response.result_data) {
          return [autoscalerActions.setWorkloadLogs({logs: response.result_data})];
        }
        return [autoscalerActions.setWorkloadLogs({
          logs: {
            connected: false,
            workload_name: res.workload_name,
            project: res.project,
            error: response.stderr || 'Failed to load workload logs',
          },
        })];
      }),
      catchError(error => [
        autoscalerActions.setWorkloadLogs({
          logs: {connected: false, workload_name: res.workload_name, project: res.project, error: this.errorMessage(error, 'Failed to load workload logs')},
        }),
      ]),
    );
  }

  private pollDashboard(res: any) {
    if (!res?.execution_id) {
      // No worker refresh queued (e.g. no settings) - surface whatever we got.
      return of(autoscalerActions.setDashboard({dashboard: res}));
    }
    return timer(EXECUTION_POLL_INTERVAL, EXECUTION_POLL_INTERVAL).pipe(
      switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: res.execution_id})),
      takeWhile((response: any) => this.isExecutionActive(response.status), true),
      switchMap((response: any) => {
        if (this.isExecutionActive(response.status)) {
          return [];
        }
        if (response.result_data) {
          return [autoscalerActions.setDashboard({dashboard: response.result_data})];
        }
        return [autoscalerActions.setDashboardError({
          error: response.stderr || 'Run:ai dashboard refresh failed',
        })];
      }),
      catchError(error => [
        autoscalerActions.setDashboardError({error: this.errorMessage(error, 'Run:ai dashboard refresh failed')}),
      ]),
    );
  }

  private pollProjectResources(res: any) {
    if (!res?.execution_id) {
      return of(autoscalerActions.setProjectResources({resources: res ?? {}}));
    }
    return timer(EXECUTION_POLL_INTERVAL, EXECUTION_POLL_INTERVAL).pipe(
      switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: res.execution_id})),
      takeWhile((response: any) => this.isExecutionActive(response.status), true),
      switchMap((response: any) => {
        if (this.isExecutionActive(response.status)) {
          return [];
        }
        if (response.result_data) {
          return [autoscalerActions.setProjectResources({resources: response.result_data})];
        }
        return [autoscalerActions.setProjectResources({
          resources: {
            connected: false,
            project: res.project,
            error: response.stderr || 'Failed to load Run:ai project resources',
          },
        })];
      }),
      catchError(error => [
        autoscalerActions.setProjectResources({
          resources: {connected: false, project: res.project, error: this.errorMessage(error, 'Failed to load Run:ai project resources')},
        }),
      ]),
    );
  }

  private pollTemplate(res: any) {
    if (!res?.execution_id) {
      return of(autoscalerActions.setTemplate({template: res ?? {name: ''}}));
    }
    return timer(EXECUTION_POLL_INTERVAL, EXECUTION_POLL_INTERVAL).pipe(
      switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: res.execution_id})),
      takeWhile((response: any) => this.isExecutionActive(response.status), true),
      switchMap((response: any) => {
        if (this.isExecutionActive(response.status)) {
          return [];
        }
        if (response.result_data) {
          return [autoscalerActions.setTemplate({template: response.result_data})];
        }
        return [autoscalerActions.setTemplate({
          template: {
            connected: false,
            name: res.name || '',
            project: res.project,
            error: response.stderr || 'Failed to load Run:ai workload template',
          },
        })];
      }),
      catchError(error => [
        autoscalerActions.setTemplate({
          template: {
            connected: false,
            name: res.name || '',
            project: res.project,
            error: this.errorMessage(error, 'Failed to load Run:ai workload template'),
          },
        }),
      ]),
    );
  }

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
        catchError(error => [
          autoscalerActions.setLastExecution({
            execution: {
              status: 'error',
              stderr: this.errorMessage(error, 'Execution polling failed'),
              execution_id: result.execution_id,
              timestamp: new Date().toISOString(),
            },
          }),
          addMessage('error', messages.error),
          this.errorDialogAction(messages.error, this.errorMessage(error, 'Execution polling failed')),
        ]),
      ),
    );
  }

  private trackConnectionTest(result: any, settings: any) {
    const savedSettings = autoscalerActions.setSettings({settings});

    if (!result.execution_id || !this.isExecutionActive(result.status)) {
      return of(savedSettings, ...this.connectionTestResultActions(result));
    }

    return concat(
      of(savedSettings),
      timer(EXECUTION_POLL_INTERVAL, EXECUTION_POLL_INTERVAL).pipe(
        switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: result.execution_id})),
        takeWhile((response: any) => this.isExecutionActive(response.status), true),
        switchMap((response: any) => this.isExecutionActive(response.status)
          ? []
          : this.connectionTestResultActions(response)),
        catchError(error => this.requestErrorActions(error, 'Run:ai connection failed', [
          autoscalerActions.setConnectionResult({
            result: {connected: false, error: this.errorMessage(error, 'Connection test polling failed')},
          }),
          autoscalerActions.setConnectionStatus({status: 'error'}),
        ])),
      ),
    );
  }

  private connectionTestResultActions(result: any): any[] {
    const connected = (result.status || '').toLowerCase() === 'success';
    const error = connected ? undefined : (result.stderr || 'Connection request failed');
    const actions: any[] = [
      autoscalerActions.setConnectionResult({
        result: {connected, projects_count: result.projects_count, error},
      }),
      autoscalerActions.setConnectionStatus({status: connected ? 'success' : 'error'}),
    ];

    if (!connected) {
      actions.push(this.errorDialogAction('Run:ai connection failed', error));
    }

    return actions;
  }

  private normalizeExecution(result: any): AutoscalerExecution {
    return {
      status: (result.status || 'success') as AutoscalerExecution['status'],
      stdout: result.stdout,
      stderr: result.stderr,
      timestamp: result.timestamp || new Date().toISOString(),
      execution_id: result.execution_id,
      return_code: result.return_code,
      projects_count: result.projects_count,
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

  private requestErrorActions(error: any, fallback: string, actions: any[] = []) {
    const message = this.errorMessage(error, fallback);

    return [
      ...actions,
      addMessage('error', `${fallback}: ${message}`),
      error?.error
        ? setServerError(error, null, fallback, true, 'Autoscaler Error')
        : this.errorDialogAction(fallback, message),
    ];
  }

  private errorDialogAction(title: string, message: string) {
    return setNotificationDialog({
      notification: {
        title: 'Autoscaler Error',
        message: `<b>${escape(title)}</b><br><br>${escape(message)}`,
      },
    });
  }

  private errorMessage(error: any, fallback: string): string {
    if (typeof error === 'string') {
      return error;
    }

    if (typeof error?.error === 'string') {
      return error.error;
    }

    return this.errService.getErrorMsg(error?.error) ||
      error?.error?.message ||
      error?.message ||
      error?.statusText ||
      fallback;
  }
}
