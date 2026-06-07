import {ActionReducerMap, createSelector} from '@ngrx/store';
import {reducer as queuesReducer, State as QueuesState} from './queues.reducer';
import {workersReducer, WorkersState} from './workers.reducer';
import {statsReducer, StatsState} from './stats.reducer';
import {autoscalerReducer, AutoscalerState} from './autoscaler.reducer';
import {selectRouterQueryParams} from '@common/core/reducers/router-reducer';
import {WorkerExt} from '@common/workers-and-queues/actions/workers.actions';
import {sortTable} from '@common/workers-and-queues/workers-and-queues.utils';

interface State {
  workers: WorkersState,
  queues: QueuesState,
  stats: StatsState,
  autoscaler: AutoscalerState,
}

export const reducers: ActionReducerMap<State> = {
  workers: workersReducer,
  queues : queuesReducer,
  stats: statsReducer,
  autoscaler: autoscalerReducer,
};

export const workersAndQueues = state => state['workersAndQueues'];

export const selectQueuesState = createSelector(workersAndQueues, state => state.queues as QueuesState);
export const selectQueues = createSelector(selectQueuesState, state => state.data);
export const selectSelectedQueueId = createSelector(selectRouterQueryParams, params => params?.id);
export const selectSelectedQueue = createSelector(selectQueuesState, (state) => state.selected);
export const selectQueuesTasks = createSelector(selectQueuesState, state => state.tasks);
export const selectQueueStats = createSelector(selectQueuesState, state => state.stats);
export const selectQueuesStatsTimeFrame  = createSelector(selectQueuesState, state => state.selectedStatsTimeFrame);
export const selectQueuesTableSortFields = createSelector(selectQueuesState, state => state.tableSortFields);
export const selectSortedQueues = createSelector(selectQueues, selectQueuesTableSortFields,
  (queues, orderFields) => queues !== null ? sortTable(orderFields, queues) : null);

export const selectWorkersState = createSelector(workersAndQueues, state => state.workers);
export const selectWorkers = createSelector(selectWorkersState, state => state.data as WorkerExt[]);
export const selectStats   = createSelector(selectWorkersState, state => state.stats);
export const selectSelectedWorker  = createSelector(selectWorkers, selectRouterQueryParams,
  (workers, params) => params?.id ? workers?.find(worker => worker.id === params?.id) : null);
export const selectWorkersTableSortFields = createSelector(selectWorkersState, state => state.tableSortFields);

export const selectStatsParams = createSelector(selectWorkersState, state => state.selectedStatsParam);
export const selectStatsTimeFrame = createSelector(selectWorkersState, state => state.selectedStatsTimeFrame);

export const selectStatsState = createSelector(workersAndQueues, state => state.stats);
export const selectStatsErrorNotice = createSelector(selectStatsState, state => state.showNoStatsNotice);

export const selectAutoscalerState = createSelector(workersAndQueues, state => state.autoscaler as AutoscalerState);
export const selectAutoscalerSettings = createSelector(selectAutoscalerState, state => state?.settings);
export const selectAutoscalerConnectionStatus = createSelector(selectAutoscalerState, state => state?.connectionStatus);
export const selectAutoscalerConnectionResult = createSelector(selectAutoscalerState, state => state?.connectionResult);
export const selectAutoscalerLastExecution = createSelector(selectAutoscalerState, state => state?.lastExecution);
export const selectAutoscalerDashboard = createSelector(selectAutoscalerState, state => state?.dashboard);
export const selectAutoscalerDashboardLoading = createSelector(selectAutoscalerState, state => state?.dashboardLoading);
export const selectAutoscalerDashboardError = createSelector(selectAutoscalerState, state => state?.dashboardError);
