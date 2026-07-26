import {createReducer, on} from '@ngrx/store';
import {
  AutoscalerDashboardData,
  AutoscalerConnectionResult,
  autoscalerActions,
  AutoscalerExecution,
  AutoscalerProjectResources,
  AutoscalerSettingsData,
  AutoscalerTemplateResult,
  AutoscalerWorkloadLogs,
  AutoscalerWorkloadInfo
} from '../actions/autoscaler.actions';

export interface AutoscalerState {
  settings: AutoscalerSettingsData | null;
  connectionStatus: 'idle' | 'testing' | 'success' | 'error';
  connectionResult: AutoscalerConnectionResult | null;
  lastExecution: AutoscalerExecution | null;
  dashboard: AutoscalerDashboardData | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  projectResources: AutoscalerProjectResources | null;
  projectResourcesLoading: boolean;
  template: AutoscalerTemplateResult | null;
  templateLoading: boolean;
  workloadLogs: AutoscalerWorkloadLogs | null;
  workloadLogsLoading: boolean;
  workloadInfo: AutoscalerWorkloadInfo | null;
  workloadInfoLoading: boolean;
}

export const initialState: AutoscalerState = {
  settings: null,
  connectionStatus: 'idle',
  connectionResult: null,
  lastExecution: null,
  dashboard: null,
  dashboardLoading: false,
  dashboardError: null,
  projectResources: null,
  projectResourcesLoading: false,
  template: null,
  templateLoading: false,
  workloadLogs: null,
  workloadLogsLoading: false,
  workloadInfo: null,
  workloadInfoLoading: false,
};

export const autoscalerReducer = createReducer(
  initialState,
  on(autoscalerActions.setSettings, (state, {settings}) => ({
    ...state,
    settings,
  })),
  on(autoscalerActions.setConnectionStatus, (state, {status}) => ({
    ...state,
    connectionStatus: status,
  })),
  on(autoscalerActions.setConnectionResult, (state, {result}) => ({
    ...state,
    connectionResult: result,
  })),
  on(autoscalerActions.setLastExecution, (state, {execution}) => ({
    ...state,
    lastExecution: execution,
  })),
  on(autoscalerActions.setDashboardLoading, (state, {loading}) => ({
    ...state,
    dashboardLoading: loading,
  })),
  on(autoscalerActions.setDashboard, (state, {dashboard}) => ({
    ...state,
    dashboard,
    dashboardLoading: false,
    dashboardError: dashboard.error || null,
  })),
  on(autoscalerActions.setDashboardError, (state, {error}) => ({
    ...state,
    dashboardLoading: false,
    dashboardError: error,
  })),
  on(autoscalerActions.setProjectResourcesLoading, (state, {loading}) => ({
    ...state,
    projectResourcesLoading: loading,
  })),
  on(autoscalerActions.setProjectResources, (state, {resources}) => ({
    ...state,
    projectResources: resources,
    projectResourcesLoading: false,
  })),
  on(autoscalerActions.getTemplate, (state) => ({
    ...state,
    template: null,
    templateLoading: true,
  })),
  on(autoscalerActions.setTemplate, (state, {template}) => ({
    ...state,
    template,
    templateLoading: false,
  })),
  on(autoscalerActions.clearTemplate, (state) => ({
    ...state,
    template: null,
    templateLoading: false,
  })),
  on(autoscalerActions.setWorkloadLogsLoading, (state, {loading}) => ({
    ...state,
    workloadLogsLoading: loading,
  })),
  on(autoscalerActions.setWorkloadLogs, (state, {logs}) => ({
    ...state,
    workloadLogs: logs,
    workloadLogsLoading: false,
  })),
  on(autoscalerActions.clearWorkloadLogs, (state) => ({
    ...state,
    workloadLogs: null,
    workloadLogsLoading: false,
  })),
  on(autoscalerActions.setWorkloadInfoLoading, (state, {loading}) => ({
    ...state,
    workloadInfoLoading: loading,
  })),
  on(autoscalerActions.setWorkloadInfo, (state, {info}) => ({
    ...state,
    workloadInfo: info,
    workloadInfoLoading: false,
  })),
  on(autoscalerActions.clearWorkloadInfo, (state) => ({
    ...state,
    workloadInfo: null,
    workloadInfoLoading: false,
  })),
  on(autoscalerActions.resetSettings, () => ({...initialState})),
);
