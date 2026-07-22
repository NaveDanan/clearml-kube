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
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring(), provideClearpipeTaskAuthoring()],
  },
  {
    path: ':taskId/edit',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring(), provideClearpipeTaskAuthoring()],
    data: {clearpipeVisualEdit: true},
  },
  {
    path: ':taskId',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring(), provideClearpipeTaskAuthoring()],
  },
];
