import {Routes} from '@angular/router';
import {clearpipeUnsavedWorkGuard} from './editor/clearpipe-unsaved-work.guard';
import {provideClearpipeFunctionAuthoring} from './editor/function-authoring/function-authoring.extension';
import {provideClearpipeTaskAuthoring} from './editor/task-authoring/task-authoring.extension';

const clearpipeEditorProviders = () => [
  provideClearpipeFunctionAuthoring(),
  provideClearpipeTaskAuthoring(),
];

export const clearpipeRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/clearpipe-library.component').then(m => m.ClearpipeLibraryComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./editor/flow/clearpipe-flow-editor.component').then(m => m.ClearpipeFlowEditorComponent),
    providers: clearpipeEditorProviders(),
    canDeactivate: [clearpipeUnsavedWorkGuard],
  },
  {
    path: ':taskId/edit',
    loadComponent: () => import('./editor/flow/clearpipe-flow-editor.component')
      .then(m => m.ClearpipeFlowEditorComponent),
    providers: clearpipeEditorProviders(),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    data: {clearpipeVisualEdit: true, existingPipeline: true},
  },
  {
    path: ':taskId',
    loadComponent: () => import('./editor/flow/clearpipe-flow-editor.component')
      .then(m => m.ClearpipeFlowEditorComponent),
    providers: clearpipeEditorProviders(),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    data: {existingPipeline: true},
  },
];
