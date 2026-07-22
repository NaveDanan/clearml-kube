import {inject, Injectable} from '@angular/core';
import {FunctionNode, GraphPort, JsonValue} from '../../domain/graph-v2.types';
import {GraphCommandResult, GraphStoreService} from '../../domain/graph-store.service';
import {FunctionAuthoringDefinition, FunctionAuthoringOutput, FunctionAuthoringPort} from './function-authoring.models';
import {validateFunctionAuthoringDefinition} from './function-authoring.validation';

const port = (
  definition: FunctionAuthoringPort | FunctionAuthoringOutput,
  direction: 'input' | 'output',
  order: number,
): GraphPort => ({
  id: definition.id,
  kind: 'port',
  name: definition.name,
  direction,
  role: definition.type,
  required: direction === 'input' && (definition as FunctionAuthoringPort).required,
  multiplicity: direction === 'output' ? 'many' : 'single',
  accepted_binding_kinds: definition.type === 'parameter' ? ['parameter'] : [definition.type],
  order,
  ...(
    direction === 'input' && typeof (definition as FunctionAuthoringPort).default !== 'undefined'
      ? {default: (definition as FunctionAuthoringPort).default as JsonValue}
      : {}
  ),
});

const graphError = (command: string, code: string, message: string): GraphCommandResult => ({
  ok: false,
  changed: false,
  command,
  errors: [{code, path: 'function-authoring', message}],
});

/**
 * Adapts explicit definitions to CP-10 commands only. It never creates edges:
 * CP-20 remains the sole semantic connection controller.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeFunctionAuthoringService {
  private readonly graphStore = inject(GraphStoreService);

  create(definition: FunctionAuthoringDefinition): GraphCommandResult & {id?: string} {
    const validation = validateFunctionAuthoringDefinition(definition);
    if (!validation.valid) {
      const first = validation.diagnostics[0];
      return graphError('create-function-node', first.code, first.message);
    }
    return this.graphStore.createFunctionNode({
      name: definition.name,
      label: definition.label.trim(),
      ...(definition.description?.trim() ? {description: definition.description.trim()} : {}),
      signature: definition.signature,
      source: definition.source,
      ports: [
        ...definition.inputs.map((input, index) => port(input, 'input', index)),
        ...definition.outputs.map((output, index) => port(output, 'output', index)),
      ],
      configuration: {
        task_type: definition.taskType,
        cache: definition.cache,
        ...(definition.queueResourceId ? {queue_resource_id: definition.queueResourceId} : {}),
        ...(definition.packages?.length ? {packages: [...definition.packages]} : {}),
        ...(definition.retryOnFailure !== undefined ? {retry_on_failure: definition.retryOnFailure} : {}),
      },
      visual: {position: {x: 0, y: 0}},
    });
  }

  /**
   * CP-10 does not expose source/signature mutation. Existing function source
   * therefore stays immutable; this updates only fields with graph commands.
   */
  updateConfiguration(node: FunctionNode, definition: Pick<FunctionAuthoringDefinition, 'label' | 'description' | 'taskType' | 'queueResourceId' | 'cache' | 'packages' | 'retryOnFailure'>): GraphCommandResult {
    if (node.kind !== 'function') return graphError('update-function-node', 'CPSEM003', 'A function node is required.');
    const metadata = this.graphStore.updateNodeMetadata(node.id, {label: definition.label.trim()});
    if (!metadata.ok) return metadata;
    const description = this.graphStore.updateFunctionDescription(node.id, definition.description?.trim() || undefined);
    if (!description.ok) return description;
    return this.graphStore.updateFunctionConfiguration(node.id, {
      task_type: definition.taskType,
      cache: definition.cache,
      queue_resource_id: definition.queueResourceId,
      packages: definition.packages?.length ? [...definition.packages] : undefined,
      retry_on_failure: definition.retryOnFailure,
    });
  }

  update(node: FunctionNode, definition: FunctionAuthoringDefinition): GraphCommandResult {
    const validation = validateFunctionAuthoringDefinition(definition);
    if (!validation.valid) {
      const first = validation.diagnostics[0];
      return graphError('update-function-node', first.code, first.message);
    }
    if (node.signature !== definition.signature || node.source !== definition.source) {
      return graphError(
        'update-function-node',
        'CP25CONTRACT002',
        'CP-10 does not expose source or signature mutation; create a new explicit function definition instead.',
      );
    }
    const desiredPorts = [
      ...definition.inputs.map((input, index) => port(input, 'input', index)),
      ...definition.outputs.map((output, index) => port(output, 'output', index)),
    ];
    const boundPort = node.ports.find(existing => {
      const desired = desiredPorts.find(candidate => candidate.id === existing.id);
      return this.graphStore.bindingsForPort(node.id, existing.id).length
        && (!desired || !this.samePort(existing, desired));
    });
    if (boundPort) {
      return graphError(
        'update-function-node',
        'CP25BOUND001',
        `Port "${boundPort.name}" is bound. Disconnect or remap it through the edge controller before editing or removing it.`,
      );
    }
    return this.graphStore.transaction('update function authoring definition', () => {
      this.graphStore.updateNodeMetadata(node.id, {label: definition.label.trim()});
      this.graphStore.updateFunctionDescription(node.id, definition.description?.trim() || undefined);
      this.graphStore.updateFunctionConfiguration(node.id, {
        task_type: definition.taskType,
        cache: definition.cache,
        queue_resource_id: definition.queueResourceId,
        packages: definition.packages?.length ? [...definition.packages] : undefined,
        retry_on_failure: definition.retryOnFailure,
      });
      const knownPortIds = new Set(node.ports.map(port => port.id));
      desiredPorts.forEach(next => {
        if (knownPortIds.has(next.id)) {
          const patch: Omit<GraphPort, 'id'> = {...next};
          delete (patch as Partial<GraphPort>).id;
          this.graphStore.updatePort(node.id, next.id, patch);
        } else {
          this.graphStore.createPort(node.id, next);
        }
      });
      const desiredPortIds = new Set(desiredPorts.map(port => port.id));
      node.ports.filter(existing => !desiredPortIds.has(existing.id))
        .forEach(existing => this.graphStore.removePort(node.id, existing.id));
    });
  }

  isPortBound(nodeId: string, portId: string): boolean {
    return this.graphStore.bindingsForPort(nodeId, portId).length > 0;
  }

  private samePort(left: GraphPort, right: GraphPort): boolean {
    return left.name === right.name
      && left.direction === right.direction
      && left.role === right.role
      && left.required === right.required
      && left.multiplicity === right.multiplicity
      && left.order === right.order
      && JSON.stringify(left.accepted_binding_kinds) === JSON.stringify(right.accepted_binding_kinds)
      && JSON.stringify(left.default) === JSON.stringify(right.default);
  }
}
