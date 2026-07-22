import {EnvironmentProviders, inject, Injectable, makeEnvironmentProviders, provideEnvironmentInitializer} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {FunctionNode} from '../../domain/graph-v2.types';
import {GraphStoreService} from '../../domain/graph-store.service';
import {ClearpipeExtensionRegistry} from '../framework/clearpipe-extension-registry';
import {ClearpipeCatalogActionRegistration, ClearpipeCatalogActionRequest, defineClearpipeNodeExtension} from '../framework/clearpipe-ui.types';
import {ClearpipeFunctionAuthoringFormComponent} from './function-authoring-form.component';
import {ClearpipeFunctionAuthoringCreateComponent} from './function-authoring-create.component';

export const clearpipeFunctionAuthoringCatalogAction = (
  openCreateFlow: (request: ClearpipeCatalogActionRequest) => void | Promise<void>,
): ClearpipeCatalogActionRegistration => ({
  catalogEntryId: 'explicit-function',
  execute: openCreateFlow,
});

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
export class FunctionAuthoringExtensionRegistration {
  private registered = false;
  private readonly registry = inject(ClearpipeExtensionRegistry);
  private readonly dialog = inject(MatDialog);
  private readonly graphStore = inject(GraphStoreService);

  register(): void {
    if (this.registered || this.registry.get('function')) return;
    this.registry.register(clearpipeFunctionAuthoringExtension);
    this.registry.registerCatalogAction(clearpipeFunctionAuthoringExtension,
      clearpipeFunctionAuthoringCatalogAction(request => this.openCreateFlow(request)));
    this.registered = true;
  }

  private openCreateFlow(request: ClearpipeCatalogActionRequest): void {
    void request;
    const dialog = this.dialog.open(ClearpipeFunctionAuthoringCreateComponent, {
      width: 'min(720px, calc(100vw - 32px))',
      maxHeight: 'calc(100vh - 32px)',
      autoFocus: 'dialog',
    });
    dialog.componentInstance.created.subscribe(nodeId => {
      this.graphStore.selectNode(nodeId);
      dialog.close();
    });
  }
}

/** Register at the application feature-provider boundary; generic CP-17 stays domain-neutral. */
export const provideClearpipeFunctionAuthoring = (): EnvironmentProviders => makeEnvironmentProviders([
  FunctionAuthoringExtensionRegistration,
  provideEnvironmentInitializer(() => inject(FunctionAuthoringExtensionRegistration).register()),
]);
