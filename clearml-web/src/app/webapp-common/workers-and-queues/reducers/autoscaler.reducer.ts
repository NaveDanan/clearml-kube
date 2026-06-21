import {createReducer, on} from '@ngrx/store';
import {
  AutoscalerDashboardData,
  AutoscalerConnectionResult,
  autoscalerActions,
  AutoscalerExecution,
  AutoscalerProjectResources,
  AutoscalerSettingsData
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
  on(autoscalerActions.resetSettings, () => ({...initialState})),
);
