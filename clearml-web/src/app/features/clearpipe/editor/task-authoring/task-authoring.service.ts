import {inject, Injectable} from '@angular/core';
import {map, Observable} from 'rxjs';
import {
  GraphBinding,
  GraphPort,
  TaskNode,
} from '../../domain/graph-v2.types';
import {GraphBindingInput, GraphCommandResult, GraphCommandWithId, GraphStoreService} from '../../domain/graph-store.service';
import {compatiblePortBindingKinds} from '../edges/clearpipe-port-compatibility';
import {ClearpipeSemanticEdgeController, SemanticEdgeCommandResult} from '../edges/clearpipe-semantic-edge.controller';
import {ClearpipeAdapterService} from '../../platform/clearpipe-adapter.service';
import {
  TaskArtifactSuggestion,
  TaskAuthoringDefinition,
  TaskAuthoringDescriptorState,
  TaskExecutionParentSuggestion,
  isEligibleTaskDescriptor,
  taskQueueResourceId,
} from './task-authoring.models';
import {taskAuthoringPorts, validateTaskAuthoringDefinition} from './task-authoring.validation';

const graphError = (command: string, code: string, message: string): GraphCommandResult => ({
  ok: false,
  changed: false,
  command,
  errors: [{code, path: 'task-authoring', message}],
});

const sameBindingKinds = (left: GraphPort['accepted_binding_kinds'], right: GraphPort['accepted_binding_kinds']): boolean => {
  const orderedLeft = [...left].sort();
  const orderedRight = [...right].sort();
  return orderedLeft.length === orderedRight.length
    && orderedLeft.every((kind, index) => kind === orderedRight[index]);
};

const samePortMetadata = (left: GraphPort, right: GraphPort): boolean =>
  left.id === right.id
  && left.name === right.name
  && left.direction === right.direction
  && left.role === right.role
  && left.required === right.required
  && left.multiplicity === right.multiplicity
  && sameBindingKinds(left.accepted_binding_kinds, right.accepted_binding_kinds);

/**
 * CP-24's command and descriptor façade. It keeps no graph or resource copy:
 * all durable changes use CP-10 commands and all semantic edges use CP-20.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeTaskAuthoringService {
  private readonly graphStore = inject(GraphStoreService);
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly semanticEdges = inject(ClearpipeSemanticEdgeController);

  describeTask(taskId: string, knownUpdatedAt?: string): Observable<TaskAuthoringDescriptorState> {
    return this.adapter.taskDescriptor(taskId, knownUpdatedAt).pipe(map(outcome => {
      if (outcome.status === 'loading') return {status: 'loading'} as const;
      if (outcome.status === 'ready') {
        const response = outcome.data;
        if ((response.status === 'available' || response.status === 'stale')
          && response.descriptor?.identity.task_id === taskId) {
          if (!isEligibleTaskDescriptor(response.descriptor)) {
            return {
              status: 'unavailable',
              message: 'The selected task is not eligible as a stable base task. Select a root non-controller task from the authorized task inventory.',
              retryable: false,
            } as TaskAuthoringDescriptorState;
          }
          return {status: response.status, descriptor: response.descriptor} as TaskAuthoringDescriptorState;
        }
      }
      return {
        status: 'unavailable',
        message: 'The selected task is no longer available. Refresh the authorized task list and select another task.',
        retryable: outcome.status === 'failed' || outcome.status === 'resource_unavailable',
      } as TaskAuthoringDescriptorState;
    }));
  }

  create(definition: TaskAuthoringDefinition): GraphCommandWithId {
    const validation = validateTaskAuthoringDefinition(definition);
    if (!validation.valid) {
      const first = validation.diagnostics[0];
      return {...graphError('create-task-node', first.code, first.message), id: undefined};
    }
    let nodeId: string | undefined;
    const result = this.graphStore.transaction('create task authoring node', () => {
      const queueResourceId = this.materializeQueue(definition);
      const created = this.graphStore.createTaskNode({
        name: definition.name.trim(),
        label: definition.label.trim(),
        base_task: {kind: 'task-id', task_id: definition.descriptor.identity.task_id},
        ports: taskAuthoringPorts(definition.descriptor, definition.parameterDefaults),
        configuration: {
          clone_base_task: definition.cloneBaseTask,
          cache: definition.cache,
          ...(queueResourceId ? {queue_resource_id: queueResourceId} : {}),
          ...(definition.retryOnFailure !== undefined ? {retry_on_failure: definition.retryOnFailure} : {}),
        },
        visual: {position: definition.placement ?? {x: 0, y: 0}},
      });
      nodeId = created.id;
    });
    return {...result, id: result.ok ? nodeId : undefined};
  }

  update(node: TaskNode, definition: TaskAuthoringDefinition): GraphCommandResult {
    const current = this.graphStore.node(node.id);
    if (!current || current.kind !== 'task') return graphError('update-task-node', 'CPSEM003', 'A task node is required.');
    const validation = validateTaskAuthoringDefinition(definition);
    if (!validation.valid) {
      const first = validation.diagnostics[0];
      return graphError('update-task-node', first.code, first.message);
    }
    const ports = taskAuthoringPorts(definition.descriptor, definition.parameterDefaults);
    const boundPort = current.ports.find(existing => {
      const desired = ports.find(candidate => candidate.id === existing.id);
      return this.graphStore.bindingsForPort(current.id, existing.id).length
        && (!desired || !samePortMetadata(existing, desired));
    });
    if (boundPort) {
      return graphError(
        'update-task-node',
        'CP24BOUND001',
        `Port "${boundPort.name}" is bound. Disconnect or remap it through the edge controller before replacing this task descriptor.`,
      );
    }
    return this.graphStore.transaction('update task authoring node', () => {
      const queueResourceId = this.materializeQueue(definition);
      this.graphStore.updateNodeMetadata(current.id, {name: definition.name.trim(), label: definition.label.trim()});
      this.graphStore.replaceTaskBaseTask(current.id, {kind: 'task-id', task_id: definition.descriptor.identity.task_id});
      this.graphStore.updateTaskConfiguration(current.id, {
        clone_base_task: definition.cloneBaseTask,
        cache: definition.cache,
        queue_resource_id: queueResourceId,
        retry_on_failure: definition.retryOnFailure,
      });
      this.reconcileDescriptorPorts(current, ports);
    });
  }

  bindingsForPort(nodeId: string, portId: string): readonly GraphBinding[] {
    return this.graphStore.bindingsForPort(nodeId, portId);
  }

  executionBindingsForNode(nodeId: string): readonly Extract<GraphBinding, {kind: 'execution-only'}>[] {
    return this.graphStore.bindingsForNode(nodeId)
      .filter((binding): binding is Extract<GraphBinding, {kind: 'execution-only'}> => binding.kind === 'execution-only');
  }

  queueResourceExternalId(resourceId: string): string | null {
    return this.graphStore.graph()?.resources.find(resource => resource.id === resourceId)?.resource_id ?? null;
  }

  pipelineParameterSuggestions(nodeId: string, portId: string) {
    return this.graphStore.graph()?.parameters.filter(parameter => this.semanticEdges.evaluate({
      kind: 'parameter',
      source: {kind: 'parameter', parameter_id: parameter.id},
      target: {kind: 'port', node_id: nodeId, port_id: portId},
    }).eligible) ?? [];
  }

  artifactSuggestions(nodeId: string, portId: string): readonly TaskArtifactSuggestion[] {
    const graph = this.graphStore.graph();
    if (!graph) return [];
    return graph.nodes.filter(node => node.kind === 'task').flatMap(node =>
      node.ports.filter(port => port.direction === 'output'
        && compatiblePortBindingKinds(graph, {node_id: node.id, port_id: port.id}, {node_id: nodeId, port_id: portId})
          .includes('artifact'))
        .map(port => ({
          nodeId: node.id,
          portId: port.id,
          label: `${node.label || node.name} · ${port.name}`,
        })));
  }

  executionParentSuggestions(nodeId: string): readonly TaskExecutionParentSuggestion[] {
    return this.graphStore.nodes()
      .filter(node => this.semanticEdges.evaluate({
        kind: 'execution-only',
        source: {kind: 'node', node_id: node.id},
        target: {kind: 'node', node_id: nodeId},
      }).eligible)
      .map(node => ({nodeId: node.id, label: node.label || node.name}));
  }

  connectPipelineParameter(nodeId: string, portId: string, parameterId: string): SemanticEdgeCommandResult {
    return this.semanticEdges.create({
      kind: 'parameter',
      source: {kind: 'parameter', parameter_id: parameterId},
      target: {kind: 'port', node_id: nodeId, port_id: portId},
    });
  }

  connectArtifact(sourceNodeId: string, sourcePortId: string, targetNodeId: string, targetPortId: string): SemanticEdgeCommandResult {
    return this.semanticEdges.connectPorts(
      {node_id: sourceNodeId, port_id: sourcePortId},
      {node_id: targetNodeId, port_id: targetPortId},
      'artifact',
    );
  }

  connectExecutionParent(parentNodeId: string, nodeId: string): SemanticEdgeCommandResult {
    return this.semanticEdges.create({
      kind: 'execution-only',
      source: {kind: 'node', node_id: parentNodeId},
      target: {kind: 'node', node_id: nodeId},
    });
  }

  reconnect(bindingId: string, candidate: Omit<GraphBindingInput, 'id'>): SemanticEdgeCommandResult {
    return this.semanticEdges.reconnect(bindingId, candidate);
  }

  disconnect(bindingId: string): SemanticEdgeCommandResult {
    return this.semanticEdges.remove(bindingId);
  }

  private reconcileDescriptorPorts(current: TaskNode, desired: readonly GraphPort[]): void {
    const desiredIds = new Set(desired.map(port => port.id));
    const retained = current.ports.filter(port => desiredIds.has(port.id));
    const retainedIds = new Set(retained.map(port => port.id));

    current.ports
      .filter(port => !desiredIds.has(port.id))
      .forEach(port => this.graphStore.removePort(current.id, port.id));

    (['input', 'output'] as const).forEach(direction => {
      let temporaryOrder = Math.max(
        -1,
        ...current.ports.filter(port => port.direction === direction).map(port => port.order),
        ...desired.filter(port => port.direction === direction).map(port => port.order),
      ) + 1;
      retained
        .filter(port => port.direction === direction)
        .forEach(port => this.graphStore.updatePort(current.id, port.id, {order: temporaryOrder++}));
    });

    desired.forEach(port => {
      if (!retainedIds.has(port.id)) {
        this.graphStore.createPort(current.id, port);
        return;
      }
      const patch: Omit<GraphPort, 'id'> = {...port};
      delete (patch as Partial<GraphPort>).id;
      this.graphStore.updatePort(current.id, port.id, patch);
    });
  }

  private materializeQueue(definition: TaskAuthoringDefinition): string | undefined {
    if (!definition.queue) return definition.queueResourceId;
    const id = taskQueueResourceId(definition.queue.id);
    const existing = this.graphStore.graph()?.resources.find(resource => resource.id === id);
    if (existing && existing.kind !== 'queue') {
      throw new Error('The selected queue conflicts with a non-queue graph resource.');
    }
    if (existing) {
      this.graphStore.updateResource(id, {
        kind: 'queue',
        resource_id: definition.queue.id,
        label: definition.queue.name,
      });
    } else {
      this.graphStore.addResource({
        id,
        kind: 'queue',
        resource_id: definition.queue.id,
        label: definition.queue.name,
      });
    }
    return id;
  }
}
