import {Routes} from '@angular/router';
import {generalLeavingBeforeSaveAlertGuard} from '@common/shared/guards/general-leaving-before-save-alert.guard';

export const clearpipeRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./library/clearpipe-library.component').then(m => m.ClearpipeLibraryComponent),
  },
  {
    path: 'new',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [generalLeavingBeforeSaveAlertGuard],
  },
  {
    path: ':taskId',
    loadComponent: () => import('./editor/clearpipe-editor.component').then(m => m.ClearpipeEditorComponent),
    canDeactivate: [generalLeavingBeforeSaveAlertGuard],
  },
];
