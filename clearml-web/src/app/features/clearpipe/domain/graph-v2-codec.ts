import {
  ArtifactBinding,
  BindingKind,
  DataBinding,
  DocumentMetadata,
  ExecutionOnlyBinding,
  FunctionConfiguration,
  FunctionNode,
  GraphBinding,
  GraphCodecIssue,
  GraphDecodeResult,
  GraphNode,
  GraphOutput,
  GraphPort,
  GraphSettings,
  GraphV2,
  GRAPH_V2_SCHEMA_VERSION,
  InferredBinding,
  JsonValue,
  NodeEndpoint,
  NodeVisual,
  ParameterBinding,
  ParameterEndpoint,
  PipelineParameter,
  Point,
  PortEndpoint,
  ResourceEndpoint,
  ResourceReference,
  TaskConfiguration,
  TaskNode,
  TaskReference,
} from './graph-v2.types';

type JsonRecord = Record<string, JsonValue>;

const stableIdPattern = /^[A-Za-z][A-Za-z0-9_-]*$/;
const generatedNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
const bindingKinds: readonly BindingKind[] = ['data', 'artifact', 'parameter', 'inferred', 'execution-only'];
const resourceKinds = new Set(['dataset', 'model', 'queue', 'task']);
const portDirections = new Set(['input', 'output']);
const portRoles = new Set(['data', 'artifact', 'parameter']);
const multiplicities = new Set(['single', 'many']);
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const secretKeys = new Set([
  'password', 'passwd', 'secret', 'token', 'apikey', 'accesskey', 'privatekey', 'credential', 'credentials',
  'clientsecret', 'connectionstring', 'accountkey', 'sastoken', 'serviceaccountkey',
]);
const opaqueSecretReferenceKeys = new Set([
  'credentialid', 'credentialref', 'credentialreference', 'secretid', 'secretref', 'secretreference',
]);
const secretAssignmentPattern = /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key)\b\s*=/im;
const secretUrlInSourcePattern = /https?:\/\/[^\s/@:]+(?::[^\s/@]+)?@|https?:\/\/[^\s?#]+[^\s]*[?&](?:password|secret|token|api[_-]?key|access[_-]?key)=/i;

class CodecError extends Error {
  constructor(readonly code: string, readonly path: string, message: string) {
    super(message);
  }
}

class UnsupportedCodecError extends Error {
  constructor(readonly code: string, readonly path: string) {
    super(code);
  }
}

const isRecord = (value: JsonValue): value is JsonRecord => typeof value === 'object' && value !== null && !Array.isArray(value);
const has = (value: JsonRecord, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const compactKey = (key: string): string => key.replace(/[^a-z0-9]/gi, '').toLowerCase();
const isSecretKey = (key: string): boolean => {
  const compact = compactKey(key);
  return !opaqueSecretReferenceKeys.has(compact)
    && (secretKeys.has(compact) || compact.endsWith('password') || compact.endsWith('apikey') || compact.endsWith('accesstoken'));
};

const isSensitiveUrl = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    let sensitiveQuery = false;
    url.searchParams.forEach((_queryValue, key) => sensitiveQuery ||= isSecretKey(key));
    return Boolean(url.username || url.password || sensitiveQuery);
  } catch {
    return false;
  }
};

const normalizeJson = (value: unknown, path = 'graph'): JsonValue => {
  if (value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CodecError('non_json_value', path, 'numbers must be finite JSON values');
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => normalizeJson(item, `${path}[${index}]`));
  if (typeof value === 'object') {
    const result: JsonRecord = {};
    for (const [key, nested] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (unsafeKeys.has(key)) throw new CodecError('unsafe_object_key', childPath, 'unsafe object keys are not allowed');
      if (isSecretKey(key) || (typeof nested === 'string' && isSensitiveUrl(nested))) {
        throw new CodecError('secret_not_allowed', childPath, 'secret-bearing fields are not allowed');
      }
      result[key] = normalizeJson(nested, childPath);
    }
    return result;
  }
  throw new CodecError('non_json_value', path, 'only JSON-safe values are allowed');
};

const record = (value: JsonValue | undefined, path: string): JsonRecord => {
  if (!value || !isRecord(value)) throw new CodecError('invalid_type', path, 'expected an object');
  return value;
};

const array = (value: JsonValue | undefined, path: string): JsonValue[] => {
  if (!Array.isArray(value)) throw new CodecError('invalid_type', path, 'expected an array');
  return value;
};

const assertAllowed = (value: JsonRecord, allowed: readonly string[], path: string): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort()[0];
  if (unknown) throw new UnsupportedCodecError('unsupported_field', `${path}.${unknown}`);
};

const requiredString = (value: JsonRecord, key: string, path: string): string => {
  const result = value[key];
  if (typeof result !== 'string' || !result) throw new CodecError('invalid_string', `${path}.${key}`, 'expected a non-empty string');
  return result;
};

const optionalString = (value: JsonRecord, key: string, path: string): string | undefined => {
  if (!has(value, key)) return undefined;
  if (typeof value[key] !== 'string') throw new CodecError('invalid_string', `${path}.${key}`, 'expected a string');
  return value[key] as string;
};

const requiredBoolean = (value: JsonRecord, key: string, path: string): boolean => {
  if (typeof value[key] !== 'boolean') throw new CodecError('invalid_boolean', `${path}.${key}`, 'expected a boolean');
  return value[key] as boolean;
};

const optionalBoolean = (value: JsonRecord, key: string, path: string, fallback: boolean): boolean =>
  has(value, key) ? requiredBoolean(value, key, path) : fallback;

const requiredInteger = (value: JsonRecord, key: string, path: string, minimum = 0): number => {
  const result = value[key];
  if (typeof result !== 'number' || !Number.isInteger(result) || result < minimum) {
    throw new CodecError('invalid_integer', `${path}.${key}`, 'expected an integer');
  }
  return result;
};

const stableId = (value: string, path: string): string => {
  if (!stableIdPattern.test(value)) throw new CodecError('invalid_stable_id', path, 'expected a stable identifier');
  return value;
};

const generatedName = (value: string, path: string): string => {
  if (!generatedNamePattern.test(value)) throw new CodecError('invalid_generated_name', path, 'expected a generator-safe name');
  return value;
};

const finiteNumber = (value: JsonValue | undefined, path: string, positive = false): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive && value <= 0)) {
    throw new CodecError('invalid_number', path, positive ? 'expected a positive number' : 'expected a finite number');
  }
  return value;
};

const point = (value: JsonValue | undefined, path: string): Point => {
  const raw = record(value, path);
  assertAllowed(raw, ['x', 'y'], path);
  return {x: finiteNumber(raw.x, `${path}.x`), y: finiteNumber(raw.y, `${path}.y`)};
};

const visual = (value: JsonValue | undefined, path: string): NodeVisual => {
  const raw = record(value, path);
  assertAllowed(raw, ['position', 'dimensions'], path);
  const result: NodeVisual = {position: point(raw.position, `${path}.position`)};
  if (has(raw, 'dimensions')) {
    const dimensions = record(raw.dimensions, `${path}.dimensions`);
    assertAllowed(dimensions, ['width', 'height'], `${path}.dimensions`);
    result.dimensions = {
      width: finiteNumber(dimensions.width, `${path}.dimensions.width`, true),
      height: finiteNumber(dimensions.height, `${path}.dimensions.height`, true),
    };
  }
  return result;
};

const documentMetadata = (value: JsonValue | undefined): DocumentMetadata => {
  const path = 'graph.document';
  const raw = record(value, path);
  assertAllowed(raw, ['id', 'revision', 'name', 'project', 'version', 'description', 'tags'], path);
  const tags = has(raw, 'tags') ? array(raw.tags, `${path}.tags`).map((tag, index) => {
    if (typeof tag !== 'string' || !tag) throw new CodecError('invalid_string', `${path}.tags[${index}]`, 'expected a non-empty string');
    return tag;
  }) : [];
  ensureUnique(tags, `${path}.tags`, 'duplicate_tag');
  const result: DocumentMetadata = {
    name: requiredString(raw, 'name', path),
    project: requiredString(raw, 'project', path),
    tags,
  };
  const id = optionalString(raw, 'id', path);
  if (id !== undefined) result.id = stableId(id, `${path}.id`);
  if (has(raw, 'revision')) result.revision = requiredInteger(raw, 'revision', path);
  const version = optionalString(raw, 'version', path);
  const description = optionalString(raw, 'description', path);
  if (version !== undefined) result.version = version;
  if (description !== undefined) result.description = description;
  return result;
};

const settings = (value: JsonValue | undefined): GraphSettings => {
  const path = 'graph.settings';
  const raw = record(value, path);
  assertAllowed(raw, ['default_execution_queue_id'], path);
  const queue = optionalString(raw, 'default_execution_queue_id', path);
  return queue === undefined ? {} : {default_execution_queue_id: stableId(queue, `${path}.default_execution_queue_id`)};
};

const resource = (value: JsonValue, index: number): ResourceReference => {
  const path = `graph.resources[${index}]`;
  const raw = record(value, path);
  assertAllowed(raw, ['id', 'kind', 'resource_id', 'label'], path);
  const kind = requiredString(raw, 'kind', path);
  if (!resourceKinds.has(kind)) throw new UnsupportedCodecError('unsupported_resource_kind', `${path}.kind`);
  const result: ResourceReference = {
    id: stableId(requiredString(raw, 'id', path), `${path}.id`),
    kind: kind as ResourceReference['kind'],
    resource_id: requiredString(raw, 'resource_id', path),
  };
  const label = optionalString(raw, 'label', path);
  if (label !== undefined) result.label = label;
  return result;
};

const parameter = (value: JsonValue, index: number): PipelineParameter => {
  const path = `graph.parameters[${index}]`;
  const raw = record(value, path);
  assertAllowed(raw, ['id', 'name', 'required', 'order', 'default', 'description'], path);
  const result: PipelineParameter = {
    id: stableId(requiredString(raw, 'id', path), `${path}.id`),
    name: generatedName(requiredString(raw, 'name', path), `${path}.name`),
    required: requiredBoolean(raw, 'required', path),
    order: requiredInteger(raw, 'order', path),
  };
  if (has(raw, 'default')) result.default = raw.default;
  const description = optionalString(raw, 'description', path);
  if (description !== undefined) result.description = description;
  return result;
};

const port = (value: JsonValue, path: string): GraphPort => {
  const raw = record(value, path);
  assertAllowed(raw, ['id', 'kind', 'name', 'direction', 'role', 'required', 'multiplicity', 'accepted_binding_kinds', 'order', 'default'], path);
  if (requiredString(raw, 'kind', path) !== 'port') throw new UnsupportedCodecError('unsupported_port_kind', `${path}.kind`);
  const direction = requiredString(raw, 'direction', path);
  const role = requiredString(raw, 'role', path);
  const multiplicity = requiredString(raw, 'multiplicity', path);
  if (!portDirections.has(direction)) throw new UnsupportedCodecError('unsupported_port_direction', `${path}.direction`);
  if (!portRoles.has(role)) throw new UnsupportedCodecError('unsupported_port_role', `${path}.role`);
  if (!multiplicities.has(multiplicity)) throw new UnsupportedCodecError('unsupported_port_multiplicity', `${path}.multiplicity`);
  const accepted = array(raw.accepted_binding_kinds, `${path}.accepted_binding_kinds`).map((item, index) => {
    if (typeof item !== 'string' || !bindingKinds.includes(item as BindingKind)) {
      throw new UnsupportedCodecError('unsupported_binding_kind', `${path}.accepted_binding_kinds[${index}]`);
    }
    return item as BindingKind;
  });
  if (!accepted.length) throw new UnsupportedCodecError('unsupported_binding_kind', `${path}.accepted_binding_kinds`);
  ensureUnique(accepted, `${path}.accepted_binding_kinds`, 'duplicate_binding_kind');
  const result: GraphPort = {
    id: stableId(requiredString(raw, 'id', path), `${path}.id`),
    kind: 'port',
    name: requiredString(raw, 'name', path),
    direction: direction as GraphPort['direction'],
    role: role as GraphPort['role'],
    required: requiredBoolean(raw, 'required', path),
    multiplicity: multiplicity as GraphPort['multiplicity'],
    accepted_binding_kinds: accepted,
    order: requiredInteger(raw, 'order', path),
  };
  if (has(raw, 'default')) result.default = raw.default;
  return result;
};

const taskReference = (value: JsonValue | undefined, path: string): TaskReference => {
  const raw = record(value, path);
  const kind = requiredString(raw, 'kind', path);
  if (kind === 'task-id') {
    assertAllowed(raw, ['kind', 'task_id'], path);
    return {kind, task_id: requiredString(raw, 'task_id', path)};
  }
  if (kind === 'task-name') {
    assertAllowed(raw, ['kind', 'project', 'name'], path);
    return {kind, project: requiredString(raw, 'project', path), name: requiredString(raw, 'name', path)};
  }
  throw new UnsupportedCodecError('unsupported_task_reference', `${path}.kind`);
};

const taskConfiguration = (value: JsonValue | undefined, path: string): TaskConfiguration => {
  const raw = record(value, path);
  assertAllowed(raw, ['clone_base_task', 'cache', 'queue_resource_id'], path);
  const result: TaskConfiguration = {
    clone_base_task: optionalBoolean(raw, 'clone_base_task', path, true),
    cache: optionalBoolean(raw, 'cache', path, false),
  };
  const queue = optionalString(raw, 'queue_resource_id', path);
  if (queue !== undefined) result.queue_resource_id = stableId(queue, `${path}.queue_resource_id`);
  return result;
};

const functionConfiguration = (value: JsonValue | undefined, path: string): FunctionConfiguration => {
  const raw = record(value, path);
  assertAllowed(raw, ['task_type', 'cache', 'queue_resource_id'], path);
  const result: FunctionConfiguration = {
    task_type: generatedName(requiredString(raw, 'task_type', path), `${path}.task_type`),
    cache: optionalBoolean(raw, 'cache', path, false),
  };
  const queue = optionalString(raw, 'queue_resource_id', path);
  if (queue !== undefined) result.queue_resource_id = stableId(queue, `${path}.queue_resource_id`);
  return result;
};

const node = (value: JsonValue, index: number): GraphNode => {
  const path = `graph.nodes[${index}]`;
  const raw = record(value, path);
  const kind = requiredString(raw, 'kind', path);
  const common = ['id', 'kind', 'name', 'label', 'ports', 'configuration', 'visual'];
  const ports = array(raw.ports, `${path}.ports`).map((item, portIndex) => port(item, `${path}.ports[${portIndex}]`));
  ensureUnique(ports.map((item) => item.id), `${path}.ports`, 'duplicate_port_id');
  ensureUnique(ports.map((item) => `${item.direction}:${item.name}`), `${path}.ports`, 'duplicate_port_name');
  ensureUnique(ports.map((item) => `${item.direction}:${item.order}`), `${path}.ports`, 'duplicate_port_order');
  const base = {
    id: stableId(requiredString(raw, 'id', path), `${path}.id`),
    name: generatedName(requiredString(raw, 'name', path), `${path}.name`),
    label: requiredString(raw, 'label', path),
    ports,
    visual: visual(raw.visual, `${path}.visual`),
  };
  if (kind === 'task') {
    assertAllowed(raw, [...common, 'base_task'], path);
    const result: TaskNode = {
      ...base,
      kind,
      base_task: taskReference(raw.base_task, `${path}.base_task`),
      configuration: taskConfiguration(raw.configuration, `${path}.configuration`),
    };
    return result;
  }
  if (kind === 'function') {
    assertAllowed(raw, [...common, 'signature', 'source'], path);
    const source = requiredString(raw, 'source', path);
    if (secretAssignmentPattern.test(source) || secretUrlInSourcePattern.test(source)) {
      throw new CodecError('secret_not_allowed', `${path}.source`, 'secret-bearing source is not allowed');
    }
    const result: FunctionNode = {
      ...base,
      kind,
      signature: requiredString(raw, 'signature', path),
      source,
      configuration: functionConfiguration(raw.configuration, `${path}.configuration`),
    };
    return result;
  }
  throw new UnsupportedCodecError('unsupported_node_kind', `${path}.kind`);
};

const portEndpoint = (value: JsonValue | undefined, path: string): PortEndpoint => {
  const raw = record(value, path);
  assertAllowed(raw, ['kind', 'node_id', 'port_id'], path);
  if (requiredString(raw, 'kind', path) !== 'port') throw new UnsupportedCodecError('unsupported_endpoint_kind', `${path}.kind`);
  return {
    kind: 'port',
    node_id: stableId(requiredString(raw, 'node_id', path), `${path}.node_id`),
    port_id: stableId(requiredString(raw, 'port_id', path), `${path}.port_id`),
  };
};

const parameterEndpoint = (value: JsonValue | undefined, path: string): ParameterEndpoint => {
  const raw = record(value, path);
  assertAllowed(raw, ['kind', 'parameter_id'], path);
  if (requiredString(raw, 'kind', path) !== 'parameter') throw new UnsupportedCodecError('unsupported_endpoint_kind', `${path}.kind`);
  return {kind: 'parameter', parameter_id: stableId(requiredString(raw, 'parameter_id', path), `${path}.parameter_id`)};
};

const resourceEndpoint = (value: JsonValue | undefined, path: string): ResourceEndpoint => {
  const raw = record(value, path);
  assertAllowed(raw, ['kind', 'resource_id'], path);
  if (requiredString(raw, 'kind', path) !== 'resource') throw new UnsupportedCodecError('unsupported_endpoint_kind', `${path}.kind`);
  return {kind: 'resource', resource_id: stableId(requiredString(raw, 'resource_id', path), `${path}.resource_id`)};
};

const nodeEndpoint = (value: JsonValue | undefined, path: string): NodeEndpoint => {
  const raw = record(value, path);
  assertAllowed(raw, ['kind', 'node_id'], path);
  if (requiredString(raw, 'kind', path) !== 'node') throw new UnsupportedCodecError('unsupported_endpoint_kind', `${path}.kind`);
  return {kind: 'node', node_id: stableId(requiredString(raw, 'node_id', path), `${path}.node_id`)};
};

const binding = (value: JsonValue, index: number): GraphBinding => {
  const path = `graph.bindings[${index}]`;
  const raw = record(value, path);
  const id = stableId(requiredString(raw, 'id', path), `${path}.id`);
  const kind = requiredString(raw, 'kind', path);
  if (kind === 'data') {
    assertAllowed(raw, ['id', 'kind', 'source', 'target'], path);
    const result: DataBinding = {id, kind, source: portEndpoint(raw.source, `${path}.source`), target: portEndpoint(raw.target, `${path}.target`)};
    return result;
  }
  if (kind === 'artifact') {
    assertAllowed(raw, ['id', 'kind', 'source', 'target'], path);
    const source = record(raw.source, `${path}.source`);
    const sourceKind = requiredString(source, 'kind', `${path}.source`);
    const result: ArtifactBinding = {
      id,
      kind,
      source: sourceKind === 'port' ? portEndpoint(source, `${path}.source`) : resourceEndpoint(source, `${path}.source`),
      target: portEndpoint(raw.target, `${path}.target`),
    };
    return result;
  }
  if (kind === 'parameter') {
    assertAllowed(raw, ['id', 'kind', 'source', 'target'], path);
    const result: ParameterBinding = {id, kind, source: parameterEndpoint(raw.source, `${path}.source`), target: portEndpoint(raw.target, `${path}.target`)};
    return result;
  }
  if (kind === 'inferred') {
    assertAllowed(raw, ['id', 'kind', 'source', 'target', 'derived_from'], path);
    const result: InferredBinding = {
      id,
      kind,
      source: nodeEndpoint(raw.source, `${path}.source`),
      target: nodeEndpoint(raw.target, `${path}.target`),
      derived_from: portEndpoint(raw.derived_from, `${path}.derived_from`),
    };
    return result;
  }
  if (kind === 'execution-only') {
    assertAllowed(raw, ['id', 'kind', 'source', 'target'], path);
    const result: ExecutionOnlyBinding = {id, kind, source: nodeEndpoint(raw.source, `${path}.source`), target: nodeEndpoint(raw.target, `${path}.target`)};
    return result;
  }
  throw new UnsupportedCodecError('unsupported_binding_kind', `${path}.kind`);
};

const output = (value: JsonValue, index: number): GraphOutput => {
  const path = `graph.outputs[${index}]`;
  const raw = record(value, path);
  assertAllowed(raw, ['id', 'name', 'source'], path);
  return {
    id: stableId(requiredString(raw, 'id', path), `${path}.id`),
    name: generatedName(requiredString(raw, 'name', path), `${path}.name`),
    source: portEndpoint(raw.source, `${path}.source`),
  };
};

const ensureUnique = (values: readonly string[], path: string, code: string): void => {
  if (new Set(values).size !== values.length) throw new CodecError(code, path, 'values must be unique');
};

const validateReferences = (graph: GraphV2): void => {
  ensureUnique(graph.nodes.map((item) => item.id), 'graph.nodes', 'duplicate_node_id');
  ensureUnique(graph.nodes.map((item) => item.name), 'graph.nodes', 'duplicate_node_name');
  ensureUnique(graph.parameters.map((item) => item.id), 'graph.parameters', 'duplicate_parameter_id');
  ensureUnique(graph.resources.map((item) => item.id), 'graph.resources', 'duplicate_resource_id');
  ensureUnique(graph.outputs.map((item) => item.id), 'graph.outputs', 'duplicate_output_id');
  ensureUnique(graph.bindings.map((item) => item.id), 'graph.bindings', 'duplicate_binding_id');
  const nodes = new Map(graph.nodes.map((item) => [item.id, item]));
  const ports = new Map<string, GraphPort>(graph.nodes.flatMap((item) => item.ports.map((entry) => [`${item.id}:${entry.id}`, entry])));
  const parameters = new Set(graph.parameters.map((item) => item.id));
  const resources = new Map(graph.resources.map((item) => [item.id, item]));
  const requirePort = (endpoint: PortEndpoint, path: string): GraphPort => {
    const result = ports.get(`${endpoint.node_id}:${endpoint.port_id}`);
    if (!result) throw new CodecError('unknown_port', path, 'binding references an unknown port');
    return result;
  };
  const requireNode = (endpoint: NodeEndpoint, path: string): void => {
    if (!nodes.has(endpoint.node_id)) throw new CodecError('unknown_node', path, 'binding references an unknown node');
  };
  const inbound = new Map<string, number>();
  graph.bindings.forEach((item, index) => {
    const path = `graph.bindings[${index}]`;
    if (item.kind === 'data' || item.kind === 'artifact' || item.kind === 'parameter') {
      const target = requirePort(item.target, `${path}.target`);
      if (target.direction !== 'input') throw new CodecError('invalid_port_direction', `${path}.target`, 'binding targets must be input ports');
      if (!target.accepted_binding_kinds.includes(item.kind)) throw new CodecError('binding_not_accepted', `${path}.target`, 'target port does not accept this binding');
      const key = `${item.target.node_id}:${item.target.port_id}`;
      inbound.set(key, (inbound.get(key) ?? 0) + 1);
    }
    if (item.kind === 'data') {
      const source = requirePort(item.source, `${path}.source`);
      if (source.direction !== 'output') throw new CodecError('invalid_port_direction', `${path}.source`, 'binding sources must be output ports');
      if (!source.accepted_binding_kinds.includes(item.kind)) throw new CodecError('binding_not_accepted', `${path}.source`, 'source port does not accept this binding');
    } else if (item.kind === 'artifact') {
      if (item.source.kind === 'port') {
        const source = requirePort(item.source, `${path}.source`);
        if (source.direction !== 'output') throw new CodecError('invalid_port_direction', `${path}.source`, 'binding sources must be output ports');
        if (!source.accepted_binding_kinds.includes(item.kind)) throw new CodecError('binding_not_accepted', `${path}.source`, 'source port does not accept this binding');
      } else if (!resources.has(item.source.resource_id)) {
        throw new CodecError('unknown_resource', `${path}.source`, 'binding references an unknown resource');
      }
    } else if (item.kind === 'parameter') {
      if (!parameters.has(item.source.parameter_id)) throw new CodecError('unknown_parameter', `${path}.source`, 'binding references an unknown parameter');
    } else if (item.kind === 'inferred') {
      requireNode(item.source, `${path}.source`);
      requireNode(item.target, `${path}.target`);
      if (requirePort(item.derived_from, `${path}.derived_from`).direction !== 'output') {
        throw new CodecError('invalid_port_direction', `${path}.derived_from`, 'derived port must be an output');
      }
    } else {
      requireNode(item.source, `${path}.source`);
      requireNode(item.target, `${path}.target`);
    }
  });
  inbound.forEach((count, key) => {
    if (count > 1 && ports.get(key)?.multiplicity === 'single') {
      throw new CodecError('port_multiplicity_exceeded', 'graph.bindings', 'single ports accept one binding');
    }
  });
  graph.outputs.forEach((item) => {
    if (requirePort(item.source, 'graph.outputs').direction !== 'output') {
      throw new CodecError('invalid_port_direction', 'graph.outputs', 'graph outputs require output ports');
    }
  });
  const queueId = graph.settings.default_execution_queue_id;
  if (queueId && resources.get(queueId)?.kind !== 'queue') {
    throw new CodecError('invalid_default_queue', 'graph.settings.default_execution_queue_id', 'default queue must reference a queue resource');
  }
  graph.nodes.forEach((item) => {
    const nodeQueue = item.configuration.queue_resource_id;
    if (nodeQueue && resources.get(nodeQueue)?.kind !== 'queue') {
      throw new CodecError('invalid_node_queue', 'graph.nodes', 'node queue must reference a queue resource');
    }
  });
};

export const decodeGraphV2 = (raw: unknown): GraphDecodeResult => {
  let normalized: JsonValue;
  try {
    normalized = normalizeJson(raw);
    const value = record(normalized, 'graph');
    const version = value.schema_version;
    if (version !== GRAPH_V2_SCHEMA_VERSION) {
      const reason = version === 1 ? 'legacy_v1_not_losslessly_representable'
        : typeof version === 'number' && Number.isInteger(version) && version > GRAPH_V2_SCHEMA_VERSION ? 'schema_version_newer_than_supported'
          : typeof version === 'number' && Number.isInteger(version) ? 'schema_version_unrecognized'
          : 'schema_version_missing_or_invalid';
      return {status: 'unsupported', unsupported: {raw: normalized, reason, path: 'graph', read_only: true}};
    }
    assertAllowed(value, ['schema_version', 'document', 'settings', 'parameters', 'resources', 'outputs', 'nodes', 'bindings', 'visual'], 'graph');
    const visualValue = record(value.visual, 'graph.visual');
    assertAllowed(visualValue, ['viewport', 'zoom'], 'graph.visual');
    const graph: GraphV2 = {
      schema_version: GRAPH_V2_SCHEMA_VERSION,
      document: documentMetadata(value.document),
      settings: settings(value.settings),
      parameters: array(value.parameters, 'graph.parameters').map(parameter),
      resources: array(value.resources, 'graph.resources').map(resource),
      outputs: array(value.outputs, 'graph.outputs').map(output),
      nodes: array(value.nodes, 'graph.nodes').map(node),
      bindings: array(value.bindings, 'graph.bindings').map(binding),
      visual: {viewport: point(visualValue.viewport, 'graph.visual.viewport'), zoom: finiteNumber(visualValue.zoom, 'graph.visual.zoom', true)},
    };
    validateReferences(graph);
    return {status: 'ok', graph};
  } catch (error: unknown) {
    if (error instanceof UnsupportedCodecError) {
      return {
        status: 'unsupported',
        unsupported: {
          raw: typeof normalized !== 'undefined' ? normalized : {},
          reason: error.code,
          path: error.path,
          read_only: true,
        },
      };
    }
    if (error instanceof CodecError) {
      const issue: GraphCodecIssue = {code: error.code, path: error.path, message: error.message};
      return {status: 'invalid', errors: [issue]};
    }
    return {status: 'invalid', errors: [{code: 'invalid_graph', path: 'graph', message: 'invalid graph document'}]};
  }
};

const sortJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isRecord(value)) return value;
  const sorted: JsonRecord = {};
  Object.keys(value).sort().forEach((key) => sorted[key] = sortJson(value[key]));
  return sorted;
};

export const canonicalGraphV2 = (graph: GraphV2): GraphV2 => ({
  ...graph,
  document: {...graph.document, tags: [...graph.document.tags].sort()},
  settings: {...graph.settings},
  parameters: [...graph.parameters].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
  resources: [...graph.resources].sort((left, right) => left.id.localeCompare(right.id)),
  outputs: [...graph.outputs].sort((left, right) => left.id.localeCompare(right.id)),
  nodes: graph.nodes
    .map((item) => ({
      ...item,
      ports: item.ports
        .map((port) => ({...port, accepted_binding_kinds: [...port.accepted_binding_kinds].sort()}))
        .sort((left, right) => left.direction.localeCompare(right.direction) || left.order - right.order || left.id.localeCompare(right.id)),
    }) as GraphNode)
    .sort((left, right) => left.id.localeCompare(right.id)),
  bindings: [...graph.bindings].sort((left, right) => left.id.localeCompare(right.id)),
  visual: {...graph.visual, viewport: {...graph.visual.viewport}},
});

export const serializeGraphV2 = (graph: GraphV2): string => {
  const decoded = decodeGraphV2(graph);
  if (decoded.status !== 'ok') throw new Error('Cannot serialize an invalid or unsupported ClearPipe graph');
  return JSON.stringify(sortJson(normalizeJson(canonicalGraphV2(decoded.graph))));
};
