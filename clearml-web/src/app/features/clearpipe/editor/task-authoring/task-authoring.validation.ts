import {ClearpipeTaskDescriptor} from '../../clearpipe-api.service';
import {GraphPort, JsonValue} from '../../domain/graph-v2.types';
import {
  TaskAuthoringDefinition,
  TaskAuthoringDiagnostic,
  TaskAuthoringValidation,
  taskArtifactPortId,
  taskParameterPortId,
  taskParameterPortName,
} from './task-authoring.models';

const generatedName = /^[A-Za-z][A-Za-z0-9_]*$/;
const sectionedParameter = /^[^/\r\n]+\/[^/\r\n]+$/;
const artifactReference = /^[A-Za-z0-9_.-]+$/;
const credentialUrl = /https?:\/\/[^/\s:@]+:[^@\s]+@|[?&](?:password|passwd|secret|token|api[_-]?key|access[_-]?key)=/i;
const secretKey = /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;

const diagnostic = (code: string, field: string, message: string): TaskAuthoringDiagnostic => ({code, field, message});

const containsSecret = (value: JsonValue | undefined): boolean => {
  if (typeof value === 'string') return credentialUrl.test(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => secretKey.test(key) || containsSecret(nested));
};

const descriptorIssues = (descriptor: ClearpipeTaskDescriptor): TaskAuthoringDiagnostic[] => {
  const issues: TaskAuthoringDiagnostic[] = [];
  if (!descriptor.identity.task_id || !descriptor.context.name || !descriptor.context.type || !descriptor.context.status) {
    issues.push(diagnostic('CP24DESCRIPTOR001', 'descriptor', 'The selected task descriptor is incomplete. Refresh the authorized task list and select the task again.'));
    return issues;
  }

  const parameterNames = descriptor.parameters.map(parameter => taskParameterPortName(parameter.section, parameter.name));
  if (parameterNames.some(name => !sectionedParameter.test(name)) || new Set(parameterNames).size !== parameterNames.length) {
    issues.push(diagnostic('CP24DESCRIPTOR002', 'parameters', 'The task descriptor contains parameter metadata that cannot be mapped safely to ClearML task overrides.'));
  }

  const outputArtifacts = descriptor.artifacts.filter(artifact => artifact.direction === 'output');
  if (outputArtifacts.some(artifact => !artifactReference.test(artifact.id))
    || new Set(outputArtifacts.map(artifact => artifact.id)).size !== outputArtifacts.length) {
    issues.push(diagnostic('CP24DESCRIPTOR003', 'artifacts', 'The task descriptor contains output artifact metadata that cannot be represented as a ClearML reference.'));
  }
  return issues;
};

/**
 * Converts only safe CP-14 descriptor metadata to CP-06 ports. It never reads
 * task configuration, artifact URLs, parameter values, source, or runtime data.
 */
export const taskAuthoringPorts = (
  descriptor: ClearpipeTaskDescriptor,
  parameterDefaults: Readonly<Record<string, JsonValue | undefined>> = {},
): GraphPort[] => [
  ...descriptor.parameters.map((parameter, order) => {
    const id = taskParameterPortId(parameter.section, parameter.name);
    const value = parameterDefaults[id];
    return {
      id,
      kind: 'port' as const,
      name: taskParameterPortName(parameter.section, parameter.name),
      direction: 'input' as const,
      role: 'parameter' as const,
      required: false,
      multiplicity: 'single' as const,
      accepted_binding_kinds: ['parameter', 'artifact'] as GraphPort['accepted_binding_kinds'],
      order,
      ...(typeof value === 'undefined' ? {} : {default: value}),
    };
  }),
  ...descriptor.artifacts.filter(artifact => artifact.direction === 'output').map((artifact, index) => ({
    id: taskArtifactPortId(artifact.id),
    kind: 'port' as const,
    name: `artifacts.${artifact.id}.url`,
    direction: 'output' as const,
    role: 'artifact' as const,
    required: false,
    multiplicity: 'many' as const,
    accepted_binding_kinds: ['artifact'] as GraphPort['accepted_binding_kinds'],
    order: descriptor.parameters.length + index,
  })),
];

export const validateTaskAuthoringDefinition = (
  definition: TaskAuthoringDefinition,
): TaskAuthoringValidation => {
  const diagnostics: TaskAuthoringDiagnostic[] = [];
  if (!generatedName.test(definition.name.trim())) {
    diagnostics.push(diagnostic('CPSEM003', 'name', 'Step name must be a generator-safe identifier.'));
  }
  if (!definition.label.trim()) diagnostics.push(diagnostic('CPSEM003', 'label', 'Step label is required.'));
  if (credentialUrl.test(definition.label)) {
    diagnostics.push(diagnostic('CPSEM010', 'label', 'Secret-bearing labels are not allowed.'));
  }
  if (definition.selectedTaskId !== definition.descriptor.identity.task_id) {
    diagnostics.push(diagnostic('CP24IDENTITY001', 'baseTask', 'The selected authorized task and descriptor identity do not match. Select the base task again.'));
  }
  diagnostics.push(...descriptorIssues(definition.descriptor));
  if (definition.retryOnFailure !== undefined
    && (!Number.isInteger(definition.retryOnFailure) || definition.retryOnFailure < 0)) {
    diagnostics.push(diagnostic('CPSEM009', 'retryOnFailure', 'Retry count must be a non-negative integer.'));
  }
  if (definition.queue && definition.queue.kind !== 'queue') {
    diagnostics.push(diagnostic('CPSEM008', 'queue', 'Choose a queue through the authorized queue selector.'));
  }
  const allowedPortIds = new Set(definition.descriptor.parameters.map(parameter =>
    taskParameterPortId(parameter.section, parameter.name)));
  Object.entries(definition.parameterDefaults).forEach(([portId, value]) => {
    if (!allowedPortIds.has(portId)) {
      diagnostics.push(diagnostic('CP24PORT001', 'parameterDefaults', 'An override targets a task parameter that is not present in the selected descriptor.'));
    } else if (containsSecret(value)) {
      diagnostics.push(diagnostic('CPSEM010', 'parameterDefaults', 'Task parameter overrides must not contain credentials or secrets.'));
    }
  });
  return {valid: !diagnostics.length, diagnostics};
};
