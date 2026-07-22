import {EnvironmentProviders, inject, Injectable, makeEnvironmentProviders, provideEnvironmentInitializer} from '@angular/core';
import {GraphNode} from '../../domain/graph-v2.types';
import {ClearpipeExtensionRegistry} from '../framework/clearpipe-extension-registry';
import {defineClearpipeNodeExtension} from '../framework/clearpipe-ui.types';
import {ClearpipeDatasetInspectorFormComponent} from './clearpipe-dataset-inspector-form.component';

export const clearpipeDatasetInspectorExtension = defineClearpipeNodeExtension<GraphNode>({
  nodeKind: 'task',
  form: {
    id: 'clearpipe-dataset-binding-inspector',
    component: ClearpipeDatasetInspectorFormComponent,
  },
});

/**
 * CP-17 permits exactly one form per node kind. Hosts should install this only
 * when no other task inspector form is registered.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeDatasetInspectorExtensionRegistration {
  private readonly registry = inject(ClearpipeExtensionRegistry);
  private unregister?: () => void;

  register(): void {
    if (!this.unregister) this.unregister = this.registry.register(clearpipeDatasetInspectorExtension);
  }
}

export const provideClearpipeDatasetInspectorExtension = (): EnvironmentProviders =>
  makeEnvironmentProviders([
    provideEnvironmentInitializer(() => inject(ClearpipeDatasetInspectorExtensionRegistration).register()),
  ]);
