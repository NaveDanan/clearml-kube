import {Observable, of} from 'rxjs';
import {ClearpipeCapabilities, ClearpipeTaskDescriptor} from '../clearpipe-api.service';
import {GraphBinding, GraphV2, TaskNode} from '../domain/graph-v2.types';

interface StoredDefinition {
  id: string;
  revision: number;
  graph: GraphV2;
}

interface StoredRun {
  id: string;
  definitionId: string;
  revision: number;
  graph: GraphV2;
  graphDigest: string;
}

export interface ClearpipeVerticalSliceTransportCall {
  action: string;
  body: unknown;
}

export const clearpipeVerticalSliceCapabilities: ClearpipeCapabilities = {
  view: true,
  edit: true,
  save_as: true,
  version: false,
  run: true,
  compilation: true,
  execution: true,
  import: true,
  export: true,
  source: true,
  archive: true,
  delete: true,
};

const clone = <T>(value: T): T => structuredClone(value);

const descriptor = (
  taskId: string,
  name: string,
  artifacts: ClearpipeTaskDescriptor['artifacts'],
): ClearpipeTaskDescriptor => ({
  identity: {task_id: taskId},
  base_task_eligible: true,
  context: {
    name,
    type: 'training',
    status: 'completed',
    project_name: 'CP-28 integration',
    updated_at: '2026-07-23T00:00:00.000Z',
  },
  parameters: [
    {section: 'General', name: 'threshold', type: 'number'},
    {section: 'General', name: 'model_uri', type: 'string'},
  ],
  artifacts,
});

const descriptors = new Map<string, ClearpipeTaskDescriptor>([
  ['base-train-0001', descriptor('base-train-0001', 'Train model', [
    {id: 'trained-model', name: 'trained model', type: 'model', direction: 'output'},
  ])],
  ['base-publish-0002', descriptor('base-publish-0002', 'Publish model', [
    {id: 'published-model', name: 'published model', type: 'model', direction: 'output'},
  ])],
]);

const endpoint = (binding: GraphBinding['source'] | GraphBinding['target']): string => {
  switch (binding.kind) {
    case 'node':
      return binding.node_id;
    case 'parameter':
      return `parameter:${binding.parameter_id}`;
    case 'port':
      return `${binding.node_id}.${binding.port_id}`;
    case 'resource':
      return `resource:${binding.resource_id}`;
  }
};

const graphDigest = (graph: GraphV2): string =>
  `sha256:cp28-${graph.nodes.map(node => node.id).join('-')}-${graph.bindings.map(binding => binding.id).join('-')}`;

const generatedSource = (graph: GraphV2): string => [
  'from clearml.automation.controller import PipelineController',
  `pipeline = PipelineController(name=${JSON.stringify(graph.document.name)})`,
  ...graph.nodes.map(node => {
    const task = node as TaskNode;
    const baseTask = task.base_task.kind === 'task-id'
      ? task.base_task.task_id
      : `${task.base_task.project}/${task.base_task.name}`;
    return `pipeline.add_step(name=${JSON.stringify(task.name)}, base_task_id=${JSON.stringify(baseTask)})`;
  }),
  ...graph.bindings.map(binding =>
    `pipeline.bind(kind=${JSON.stringify(binding.kind)}, source=${JSON.stringify(endpoint(binding.source))}, target=${JSON.stringify(endpoint(binding.target))})`),
  '',
].join('\n');

/**
 * Deterministic external ClearPipe transport. It keeps server state outside the
 * production services so the vertical slice uses the real API and adapter path.
 */
export class ClearpipeTaskVerticalSliceTransport {
  readonly calls: ClearpipeVerticalSliceTransportCall[] = [];
  private readonly definitions = new Map<string, StoredDefinition>();
  private readonly runs = new Map<string, StoredRun>();
  private readonly deniedDescriptors = new Set<string>();
  private definitionSequence = 1;
  private runSequence = 1;

  denyDescriptor(taskId: string): void {
    this.deniedDescriptors.add(taskId);
  }

  callsFor(action: string): readonly ClearpipeVerticalSliceTransportCall[] {
    return this.calls.filter(call => call.action === action);
  }

  post<T>(url: string, body: unknown): Observable<T> {
    const action = url.split('clearpipe.')[1] ?? '';
    this.calls.push({action, body: clone(body)});
    return of(this.response(action, body) as T);
  }

  private response(action: string, body: unknown): unknown {
    switch (action) {
      case 'task_inventory':
        return {
          tasks: [...descriptors.values()].map(value => ({
            id: value.identity.task_id,
            name: value.context.name,
            project: value.context.project_name,
            type: value.context.type,
            status: value.context.status,
            last_update: value.context.updated_at,
            base_task_eligible: value.base_task_eligible,
          })),
          total: descriptors.size,
        };
      case 'task_descriptor':
        return this.taskDescriptor(body);
      case 'create':
        return this.create(body);
      case 'update':
        return this.update(body);
      case 'get_by_id':
        return this.load(body);
      case 'validate':
        return this.validate(body);
      case 'start':
        return this.start(body);
      case 'execution_snapshot':
        return this.executionSnapshot(body);
      default:
        throw new Error(`Unexpected ClearPipe transport action: ${action}`);
    }
  }

  private taskDescriptor(body: unknown): unknown {
    const taskId = this.text(this.record(body)?.['task']);
    const item = taskId && !this.deniedDescriptors.has(taskId) ? descriptors.get(taskId) : undefined;
    return item ? {status: 'available', descriptor: clone(item)} : {status: 'unavailable'};
  }

  private create(body: unknown): unknown {
    const request = this.record(body);
    const graph = request?.['graph'] as GraphV2 | undefined;
    if (!graph) throw new Error('A ClearPipe graph is required for creation.');
    const id = `definition-cp28-${this.definitionSequence.toString().padStart(4, '0')}`;
    this.definitionSequence++;
    const definition: StoredDefinition = {id, revision: 1, graph: clone(graph)};
    this.definitions.set(id, definition);
    return this.definitionResponse(definition);
  }

  private update(body: unknown): unknown {
    const request = this.record(body);
    const id = this.text(request?.['task']);
    const revision = request?.['revision'];
    const graph = request?.['graph'] as GraphV2 | undefined;
    const existing = id ? this.definitions.get(id) : undefined;
    if (!existing || revision !== existing.revision || !graph) {
      throw new Error('The persisted ClearPipe definition could not be updated.');
    }
    const definition: StoredDefinition = {...existing, revision: existing.revision + 1, graph: clone(graph)};
    this.definitions.set(definition.id, definition);
    return this.definitionResponse(definition);
  }

  private load(body: unknown): unknown {
    const taskId = this.text(this.record(body)?.['task']);
    const definition = taskId ? this.definitions.get(taskId) : undefined;
    if (!definition) throw new Error('The requested ClearPipe definition is not available.');
    return this.definitionResponse(definition);
  }

  private validate(body: unknown): unknown {
    const request = this.record(body);
    const taskId = this.text(request?.['task']);
    const graph = (request?.['graph'] as GraphV2 | undefined) ?? (taskId ? this.definitions.get(taskId)?.graph : undefined);
    if (!graph) return {valid: false, issues: [{code: 'CP28MISSING', message: 'Definition unavailable.', severity: 'error'}]};
    return {
      valid: true,
      issues: [],
      pipeline: {
        source: generatedSource(graph),
        manifest: {
          graph_digest: graphDigest(graph),
          runtime_steps: graph.nodes.map(node => ({
            graph_node_id: node.id,
            pipeline_step_name: node.name,
          })),
        },
      },
    };
  }

  private start(body: unknown): unknown {
    const request = this.record(body);
    const definitionId = this.text(request?.['task']);
    const revision = request?.['revision'];
    const definition = definitionId ? this.definitions.get(definitionId) : undefined;
    if (!definition || revision !== definition.revision || request?.['verify_watched_queue'] !== true) {
      return {enqueued: false};
    }
    const id = `run-cp28-${this.runSequence.toString().padStart(4, '0')}`;
    this.runSequence++;
    this.runs.set(id, {
      id,
      definitionId: definition.id,
      revision: definition.revision,
      graph: clone(definition.graph),
      graphDigest: graphDigest(definition.graph),
    });
    return {task: id, enqueued: true, queue_watched: true};
  }

  private executionSnapshot(body: unknown): unknown {
    const request = this.record(body);
    const run = this.text(request?.['run']);
    const execution = run ? this.runs.get(run) : undefined;
    if (!execution
      || request?.['definition_revision'] !== execution.revision
      || request?.['graph_digest'] !== execution.graphDigest) {
      return {status: 'unavailable'};
    }
    return {
      status: 'available',
      snapshot: {
        run_task_id: execution.id,
        definition_task_id: execution.definitionId,
        definition_revision: execution.revision,
        graph_digest: execution.graphDigest,
        node_offset: 0,
        total_nodes: execution.graph.nodes.length,
        truncated: false,
        controller: {
          task_id: execution.id,
          status: 'completed',
          updated_at: '2026-07-23T00:01:00.000Z',
        },
        nodes: execution.graph.nodes.map((node, index) => ({
          graph_node_id: node.id,
          pipeline_step_name: node.name,
          record_status: 'available',
          task_id: `runtime-cp28-${index + 1}`,
          log_task_id: `runtime-cp28-${index + 1}`,
          status: 'completed',
          updated_at: `2026-07-23T00:01:0${index}.000Z`,
          ...(index === 0 ? {
            artifacts: [{id: 'trained-model', name: 'trained model', type: 'model', direction: 'output'}],
          } : {}),
        })),
      },
    };
  }

  private definitionResponse(definition: StoredDefinition): unknown {
    return {
      id: definition.id,
      task_id: definition.id,
      name: definition.graph.document.name,
      revision: definition.revision,
      schema_version: definition.graph.schema_version,
      graph: clone(definition.graph),
      representation: 'clearpipe_graph_v2',
      capabilities: clone(clearpipeVerticalSliceCapabilities),
    };
  }

  private record(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value ? value : null;
  }
}
