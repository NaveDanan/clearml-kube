import {Routes} from '@angular/router';
import {clearpipeUnsavedWorkGuard} from './editor/clearpipe-unsaved-work.guard';
import {provideClearpipeFunctionAuthoring} from './editor/function-authoring';
import {provideClearpipeTaskAuthoring} from './editor/task-authoring';

export const clearpipeRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/clearpipe-library.component').then(m => m.ClearpipeLibraryComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./editor/flow/clearpipe-flow-editor.component').then(m => m.ClearpipeFlowEditorComponent),
  },
  {
    path: ':taskId/edit',
    loadComponent: () => import('./existing-pipeline/clearpipe-existing-pipeline.component').then(m => m.ClearpipeExistingPipelineComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring(), provideClearpipeTaskAuthoring()],
    data: {clearpipeVisualEdit: true, existingPipeline: true},
  },
  {
    path: ':taskId',
    loadComponent: () => import('./existing-pipeline/clearpipe-existing-pipeline.component').then(m => m.ClearpipeExistingPipelineComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring(), provideClearpipeTaskAuthoring()],
    data: {existingPipeline: true},
  },
];
