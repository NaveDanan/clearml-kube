import {EnvironmentProviders, inject, Injectable, makeEnvironmentProviders, provideEnvironmentInitializer} from '@angular/core';
import {MatDialog} from '@angular/material/dialog';
import {TaskNode} from '../../domain/graph-v2.types';
import {GraphStoreService} from '../../domain/graph-store.service';
import {ClearpipeExtensionRegistry} from '../framework/clearpipe-extension-registry';
import {ClearpipeCatalogActionRegistration, ClearpipeCatalogActionRequest, defineClearpipeNodeExtension} from '../framework/clearpipe-ui.types';
import {ClearpipeTaskAuthoringCreateComponent, ClearpipeTaskAuthoringCreateData} from './task-authoring-create.component';
import {ClearpipeTaskAuthoringFormComponent} from './task-authoring-form.component';

export const clearpipeTaskAuthoringCatalogAction = (
  openCreateFlow: (request: ClearpipeCatalogActionRequest) => void | Promise<void>,
): ClearpipeCatalogActionRegistration => ({
  catalogEntryId: 'approved-task',
  execute: openCreateFlow,
});

export const clearpipeTaskAuthoringExtension = defineClearpipeNodeExtension<TaskNode>({
  nodeKind: 'task',
  catalog: {
    id: 'approved-task',
    category: 'Task-backed steps',
    label: 'Approved task',
    description: 'Search an authorized ClearML task and configure a safe task-backed pipeline step.',
    nodeKind: 'task',
    icon: 'account_tree',
    keywords: ['task', 'clearml', 'base task', 'artifact', 'parameter'],
  },
  icon: 'account_tree',
  summarize: node => ({
    text: `${node.base_task.kind === 'task-id' ? node.base_task.task_id : `${node.base_task.project}/${node.base_task.name}`} · ${node.ports.filter(port => port.direction === 'output').length} artifact output(s)`,
  }),
  form: {id: 'task-authoring', component: ClearpipeTaskAuthoringFormComponent},
});

@Injectable()
export class TaskAuthoringExtensionRegistration {
  private registered = false;
  private readonly registry = inject(ClearpipeExtensionRegistry);
  private readonly dialog = inject(MatDialog);
  private readonly graphStore = inject(GraphStoreService);

  register(): void {
    if (this.registered || this.registry.get('task')) return;
    this.registry.register(clearpipeTaskAuthoringExtension);
    this.registry.registerCatalogAction(
      clearpipeTaskAuthoringExtension,
      clearpipeTaskAuthoringCatalogAction(request => this.openCreateFlow(request)),
    );
    this.registered = true;
  }

  private openCreateFlow(request: ClearpipeCatalogActionRequest): void {
    const data: ClearpipeTaskAuthoringCreateData = request.method === 'drop' ? {placement: request.placement} : {};
    const dialog = this.dialog.open(ClearpipeTaskAuthoringCreateComponent, {
      width: 'min(820px, calc(100vw - 32px))',
      maxHeight: 'calc(100vh - 32px)',
      autoFocus: 'dialog',
      data,
    });
    dialog.componentInstance.created.subscribe(nodeId => {
      this.graphStore.selectNode(nodeId);
      dialog.close();
    });
  }
}

/** Installed only at the ClearPipe route boundary; CP-17 remains domain-neutral. */
export const provideClearpipeTaskAuthoring = (): EnvironmentProviders => makeEnvironmentProviders([
  TaskAuthoringExtensionRegistration,
  provideEnvironmentInitializer(() => inject(TaskAuthoringExtensionRegistration).register()),
]);
