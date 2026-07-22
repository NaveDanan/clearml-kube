/* Imported legacy JSON and server wrappers are normalized at this boundary. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ClearpipeNodeType = 'dataset' | 'versioning' | 'execute' | 'training' | 'experiment' | 'report';

export interface ClearpipePoint { x: number; y: number }

export interface ClearpipeNode {
  id: string;
  type: ClearpipeNodeType;
  position: ClearpipePoint;
  label: string;
  description?: string;
  config: Record<string, unknown>;
}

export interface ClearpipeEdge {
  id: string;
  source: string;
  target: string;
}

export interface ClearpipeViewport extends ClearpipePoint { zoom: number }

export interface ClearpipeDefinition {
  id?: string;
  task_id?: string;
  name: string;
  description?: string;
  revision: number;
  schema_version: number;
  nodes: ClearpipeNode[];
  edges: ClearpipeEdge[];
  viewport: ClearpipeViewport;
  default_queues?: Record<string, string>;
  tags?: string[];
  created?: string;
  last_update?: string;
  owner?: {id?: string; name?: string};
  public?: boolean;
  archived?: boolean;
  can_edit?: boolean;
}

export interface ClearpipeValidationIssue {
  code?: string;
  message: string;
  node_id?: string;
  severity?: 'error' | 'warning';
}

export interface ClearpipeValidationResult {
  valid: boolean;
  errors: ClearpipeValidationIssue[];
  warnings: ClearpipeValidationIssue[];
}

export interface ClearpipeResourceOption {
  id: string;
  name: string;
  project?: string;
  type: 'project' | 'task' | 'dataset' | 'model' | 'queue' | 'report' | 'endpoint' | 'storage';
  /** Safe task display metadata. `type` above remains the resource kind. */
  taskType?: string;
  taskStatus?: string;
  taskUserTags?: string[];
  taskSystemTags?: string[];
  taskLastUpdatedAt?: string;
  taskBaseEligible?: boolean;
}

export const CLEARPIPE_NODE_TYPES: readonly {
  type: ClearpipeNodeType; label: string; description: string; icon: string; defaults: Record<string, unknown>
}[] = [
  {type: 'dataset', label: 'Dataset', description: 'Load a native dataset or artifact', icon: 'al-ico-datasets', defaults: {source: 'clearml'}},
  {type: 'versioning', label: 'Data Versioning', description: 'Create or version managed data', icon: 'al-ico-versions', defaults: {tool: 'clearml-data', action: 'version'}},
  {type: 'execute', label: 'Execute', description: 'Run a repository or uploaded script', icon: 'al-ico-code', defaults: {scriptSource: 'inline', steps: [{id: 'step-1', name: 'Script', enabled: true, inlineScript: ''}]}},
  {type: 'training', label: 'Model Training', description: 'Clone or create a training task', icon: 'al-ico-experiments', defaults: {source: 'task', scriptSource: 'task'}},
  {type: 'experiment', label: 'Experiment Tracking', description: 'Track or synchronize an experiment', icon: 'al-ico-scalars', defaults: {tracker: 'clearml', projectName: 'ClearPipe', experimentName: 'ClearPipe run'}},
  {type: 'report', label: 'Report', description: 'Publish a native ClearML report', icon: 'al-ico-reports', defaults: {outputFormat: 'html', title: 'Pipeline report', includeMetrics: true}},
];

export const emptyClearpipeDefinition = (): ClearpipeDefinition => ({
  name: 'Untitled ClearPipe',
  revision: 0,
  schema_version: 1,
  nodes: [],
  edges: [],
  viewport: {x: 0, y: 0, zoom: 1},
  default_queues: {},
  tags: ['pipeline', 'clearpipe'],
  can_edit: true,
});

const prototypePollutionKeys = new Set(['__proto__', 'prototype', 'constructor']);
const secretKeys = new Set([
  'password', 'passwd', 'secret', 'token', 'apikey', 'accesskey', 'privatekey', 'credential', 'credentials',
  'clientsecret', 'connectionstring', 'accountkey', 'sastoken', 'serviceaccountkey'
]);

const compactKey = (key: string): string => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
const isSecretKey = (key: string): boolean => {
  const compact = compactKey(key);
  if (/^(credential|secret)(id|ref|reference)$/.test(compact)) return false;
  return secretKeys.has(compact) || compact.endsWith('password') || compact.endsWith('apikey') || compact.endsWith('accesstoken');
};
const isSensitiveUrl = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    let sensitiveQuery = false;
    url.searchParams.forEach((_queryValue, key) => sensitiveQuery ||= isSecretKey(key));
    return !!url.username || !!url.password || sensitiveQuery;
  } catch {
    return false;
  }
};

export const graphContainsSecret = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(graphContainsSecret);
  }
  return Object.entries(value as Record<string, unknown>)
    .some(([key, nested]) => isSecretKey(key) || (typeof nested === 'string' && isSensitiveUrl(nested)) || graphContainsSecret(nested));
};

export const findSecretPaths = (value: unknown, path = 'graph'): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSecretPaths(item, `${path}[${index}]`));
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const current = `${path}.${key}`;
    return isSecretKey(key) || (typeof nested === 'string' && isSensitiveUrl(nested)) ? [current] : findSecretPaths(nested, current);
  });
};

export const findUnsafeObjectPaths = (value: unknown, path = 'graph'): string[] => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findUnsafeObjectPaths(item, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const current = `${path}.${key}`;
    return prototypePollutionKeys.has(key) ? [current] : findUnsafeObjectPaths(nested, current);
  });
};

export const normalizeDefinition = (raw: unknown): ClearpipeDefinition => {
  const wrapper = (raw ?? {}) as Record<string, any>;
  const source = (wrapper.definition ?? wrapper) as Record<string, any>;
  const value: Record<string, any> = {...source, id: source.id ?? wrapper.id, revision: wrapper.revision ?? source.revision};
  const configuration = value.configuration?.ClearPipe?.value ?? value.configuration?.ClearPipe ?? {};
  const graph = value.graph ?? (configuration.nodes ? configuration : value);
  const nodes = Array.isArray(graph.nodes) ? graph.nodes.map((node: Record<string, any>) => {
    const data = node.data && typeof node.data === 'object' ? node.data : node;
    return {
      id: String(node.id),
      type: data.type,
      position: node.position ?? {x: 0, y: 0},
      label: data.label ?? data.type ?? 'Node',
      description: data.description,
      config: data.config && typeof data.config === 'object' ? data.config : {},
    } as ClearpipeNode;
  }) : [];
  return {
    name: value.name ?? graph.name ?? 'Untitled ClearPipe',
    description: value.description ?? graph.description,
    schema_version: Number(graph.schema_version ?? 1),
    id: value.task_id ?? value.id ?? graph.task_id ?? graph.id,
    task_id: value.task_id ?? value.id ?? graph.task_id ?? graph.id,
    revision: Number(graph.revision ?? value.revision ?? 0),
    nodes,
    edges: Array.isArray(graph.edges) ? graph.edges : [],
    viewport: graph.viewport ?? {x: 0, y: 0, zoom: 1},
    default_queues: graph.default_queues ?? {},
    tags: Array.isArray(value.tags) ? value.tags : ['pipeline', 'clearpipe'],
    created: value.created,
    last_update: value.last_update,
    owner: typeof value.user === 'object' ? value.user : {id: value.user},
    public: value.public,
    archived: value.archived,
    can_edit: value.can_edit ?? true,
  };
};
