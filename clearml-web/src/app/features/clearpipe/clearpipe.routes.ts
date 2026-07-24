import {Routes} from '@angular/router';

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
    loadComponent: () => import('./editor/flow/clearpipe-flow-editor.component').then(m => m.ClearpipeFlowEditorComponent),
  },
  {
    path: ':taskId',
    loadComponent: () => import('./editor/flow/clearpipe-flow-editor.component').then(m => m.ClearpipeFlowEditorComponent),
  },
];
