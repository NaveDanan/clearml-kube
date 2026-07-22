import {EnvironmentProviders, inject, Injectable, makeEnvironmentProviders, provideEnvironmentInitializer} from '@angular/core';
import {FunctionNode} from '../../domain/graph-v2.types';
import {ClearpipeExtensionRegistry} from '../framework/clearpipe-extension-registry';
import {defineClearpipeNodeExtension} from '../framework/clearpipe-ui.types';
import {ClearpipeFunctionAuthoringFormComponent} from './function-authoring-form.component';
import {ClearpipeFunctionAuthoringCreateComponent} from './function-authoring-create.component';

/**
 * Structural match for CP-24's forthcoming catalog-action registration.
 * The host owns mounting the create component; CP-25 never reaches into its
 * framework, route, or editor implementation while that work is active.
 */
export interface ClearpipeFunctionAuthoringCatalogAction {
  readonly catalogEntryId: 'explicit-function';
  readonly execute: () => void | Promise<void>;
}

export const clearpipeFunctionAuthoringCatalogAction = (
  openCreateFlow: () => void | Promise<void>,
): ClearpipeFunctionAuthoringCatalogAction => ({
  catalogEntryId: 'explicit-function',
  execute: openCreateFlow,
});

/** The generic extension host uses this public component after its action seam lands. */
export const clearpipeFunctionAuthoringCreateComponent = ClearpipeFunctionAuthoringCreateComponent;

export const clearpipeFunctionAuthoringExtension = defineClearpipeNodeExtension<FunctionNode>({
  nodeKind: 'function',
  catalog: {
    id: 'explicit-function',
    category: 'Code-backed steps',
    label: 'Function component',
    description: 'Define a constrained function with explicit typed inputs and outputs.',
    nodeKind: 'function',
    icon: 'functions',
    keywords: ['function', 'component', 'typed', 'explicit'],
  },
  icon: 'functions',
  summarize: node => ({text: `${node.configuration.task_type} · ${node.ports.filter(port => port.direction === 'output').length} output(s)`}),
  form: {id: 'function-authoring', component: ClearpipeFunctionAuthoringFormComponent},
});

@Injectable()
class FunctionAuthoringExtensionRegistration {
  private registered = false;
  private readonly registry = inject(ClearpipeExtensionRegistry);

  register(): void {
    if (this.registered || this.registry.get('function')) return;
    this.registry.register(clearpipeFunctionAuthoringExtension);
    this.registered = true;
  }
}

/** Register at the application feature-provider boundary; generic CP-17 stays domain-neutral. */
export const provideClearpipeFunctionAuthoring = (): EnvironmentProviders => makeEnvironmentProviders([
  provideEnvironmentInitializer(() => inject(FunctionAuthoringExtensionRegistration).register()),
]);
