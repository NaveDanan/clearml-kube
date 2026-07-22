import {ENVIRONMENT_INITIALIZER, EnvironmentProviders, inject, Injectable, makeEnvironmentProviders} from '@angular/core';
import {FunctionNode} from '../../domain/graph-v2.types';
import {ClearpipeExtensionRegistry} from '../framework/clearpipe-extension-registry';
import {defineClearpipeNodeExtension} from '../framework/clearpipe-ui.types';
import {ClearpipeFunctionAuthoringFormComponent} from './function-authoring-form.component';

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
  FunctionAuthoringExtensionRegistration,
  {
    provide: ENVIRONMENT_INITIALIZER,
    multi: true,
    useValue: () => inject(FunctionAuthoringExtensionRegistration).register(),
  },
]);
