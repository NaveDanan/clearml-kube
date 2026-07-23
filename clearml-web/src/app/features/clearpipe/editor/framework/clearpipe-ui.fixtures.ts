import {FunctionNode, GraphPort, TaskNode} from '../../domain/graph-v2.types';
import {defineClearpipeNodeExtension} from './clearpipe-ui.types';
import {
  ClearpipeCatalogEntry,
  ClearpipeInspectorPresentation,
  ClearpipeNodeCardPresentation,
  ClearpipePortPresentation,
} from './clearpipe-ui.types';

export const clearpipeFixtureInputPort: GraphPort = {
  id: 'dataset_input',
  kind: 'port',
  name: 'dataset_url',
  direction: 'input',
  role: 'artifact',
  required: true,
  multiplicity: 'single',
  accepted_binding_kinds: ['artifact', 'parameter'],
  order: 0,
};

export const clearpipeFixtureOutputPort: GraphPort = {
  id: 'model_output',
  kind: 'port',
  name: 'model',
  direction: 'output',
  role: 'artifact',
  required: false,
  multiplicity: 'many',
  accepted_binding_kinds: ['artifact'],
  order: 1,
};

export const clearpipeFixtureTaskNode: TaskNode = {
  id: 'train-model',
  kind: 'task',
  name: 'Train_Model',
  label: 'Train model',
  base_task: {kind: 'task-id', task_id: 'base-training-task'},
  configuration: {cache: true},
  ports: [clearpipeFixtureInputPort, clearpipeFixtureOutputPort],
  visual: {position: {x: 120, y: 96}},
};

export const clearpipeFixtureFunctionNode: FunctionNode = {
  id: 'score-model',
  kind: 'function',
  name: 'Score_Model',
  label: 'Score model',
  signature: 'def score_model(model, data):',
  source: 'def score_model(model, data):\n    return model',
  configuration: {task_type: 'testing'},
  ports: [
    {...clearpipeFixtureInputPort, id: 'model_input', name: 'model', order: 0},
    {...clearpipeFixtureOutputPort, id: 'scores_output', name: 'scores', role: 'data', accepted_binding_kinds: ['data']},
  ],
  visual: {position: {x: 460, y: 96}},
};

export const clearpipeFixtureTaskCatalogEntry = {
  id: 'task',
  category: 'Run approved tasks',
  label: 'Task step',
  description: 'Reference an authorized ClearML task as a pipeline step.',
  nodeKind: 'task',
  icon: 'al-ico-pipelines',
  keywords: ['task', 'base task', 'clearml'],
} as const satisfies ClearpipeCatalogEntry;

export const clearpipeFixtureFunctionCatalogEntry = {
  id: 'function',
  category: 'Run approved tasks',
  label: 'Function step',
  description: 'Add a constrained code-backed function step.',
  nodeKind: 'function',
  icon: 'al-ico-code-square',
  keywords: ['function', 'code'],
} as const satisfies ClearpipeCatalogEntry;

export const clearpipeFixtureUnavailableTaskCatalogEntry = {
  id: 'unavailable-task',
  category: 'Unavailable',
  label: 'Restricted task step',
  description: 'A task capability without current permission.',
  nodeKind: 'task',
  icon: 'al-ico-lock',
  disabled: true,
  disabledReason: 'You do not have permission to use this task capability.',
} as const satisfies ClearpipeCatalogEntry;

export const clearpipeFixtureCatalogEntries: readonly ClearpipeCatalogEntry[] = [
  clearpipeFixtureTaskCatalogEntry,
  clearpipeFixtureFunctionCatalogEntry,
  clearpipeFixtureUnavailableTaskCatalogEntry,
];

export const clearpipeFixturePorts: readonly ClearpipePortPresentation[] = [
  {
    nodeId: clearpipeFixtureTaskNode.id,
    port: clearpipeFixtureInputPort,
    connected: false,
    compatibility: {state: 'incompatible', reason: 'An artifact or parameter source is required.'},
    validation: [{severity: 'error', message: 'A required input is not connected.', code: 'CPSEM003', targetId: 'dataset_url'}],
  },
  {
    nodeId: clearpipeFixtureTaskNode.id,
    port: clearpipeFixtureOutputPort,
    connected: true,
    compatibility: {state: 'compatible'},
  },
];

export const clearpipeFixtureRunningTaskCard: ClearpipeNodeCardPresentation = {
  node: clearpipeFixtureTaskNode,
  icon: 'al-ico-pipelines',
  typeLabel: 'Task',
  summary: 'Base task: base-training-task',
  selected: true,
  statuses: [{tone: 'running', label: 'Running', detail: 'State supplied by execution owner'}],
  ports: clearpipeFixturePorts,
  actions: [{id: 'inspect', label: 'Inspect', icon: 'al-ico-eye-outline'}],
};

export const clearpipeFixtureFailedFunctionCard: ClearpipeNodeCardPresentation = {
  node: clearpipeFixtureFunctionNode,
  icon: 'al-ico-code-square',
  typeLabel: 'Function',
  summary: 'Code-backed function with declared outputs',
  statuses: [{tone: 'error', label: 'Failed', detail: 'Reported by the execution owner'}],
  validations: [{severity: 'warning', message: 'Review the failed execution before running again.', code: 'CPWARN011'}],
  disabled: true,
  disabledReason: 'This definition is read-only.',
};

export const clearpipeFixtureInspector: ClearpipeInspectorPresentation = {
  node: clearpipeFixtureTaskNode,
  title: 'Train model',
  typeLabel: 'Task',
  summary: 'Base task: base-training-task',
  source: {label: 'Open base task', href: '/projects/*/tasks/base-training-task'},
  readOnly: true,
  readOnlyReason: 'This definition is read-only.',
  statuses: [{tone: 'unavailable', label: 'Unavailable', detail: 'Execution data is not available in this view.'}],
  validations: [{severity: 'error', message: 'A required input is not connected.', code: 'CPSEM003', targetId: 'dataset_url'}],
};

export const clearpipeFixtureTaskExtension = defineClearpipeNodeExtension<TaskNode>({
  nodeKind: 'task',
  catalog: clearpipeFixtureTaskCatalogEntry,
  icon: 'al-ico-pipelines',
  summarize: (node) => ({text: `Base task: ${node.base_task.kind === 'task-id' ? node.base_task.task_id : node.base_task.name}`}),
});

export const clearpipeFixtureFunctionExtension = defineClearpipeNodeExtension<FunctionNode>({
  nodeKind: 'function',
  catalog: clearpipeFixtureFunctionCatalogEntry,
  icon: 'al-ico-code-square',
  summarize: (node) => ({text: node.signature}),
});
