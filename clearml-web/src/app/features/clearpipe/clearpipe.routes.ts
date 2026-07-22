import {Routes} from '@angular/router';
import {clearpipeUnsavedWorkGuard} from './editor/clearpipe-unsaved-work.guard';
import {provideClearpipeFunctionAuthoring} from './editor/function-authoring';

export const clearpipeRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/clearpipe-library.component').then(m => m.ClearpipeLibraryComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring()],
  },
  {
    path: ':taskId/edit',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring()],
    data: {clearpipeVisualEdit: true},
  },
  {
    path: ':taskId',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [clearpipeUnsavedWorkGuard],
    providers: [provideClearpipeFunctionAuthoring()],
  },
];
