import {FUNCTION_AUTHORING_TASK_TYPES, FunctionAuthoringDefinition, FunctionAuthoringDiagnostic, FunctionAuthoringValidation} from './function-authoring.models';

const generatedName = /^[A-Za-z][A-Za-z0-9_]*$/;
const stableId = /^[A-Za-z][A-Za-z0-9_-]*$/;
const safeReference = /^(?:[A-Za-z0-9][A-Za-z0-9._/-]{0,255})$/;
const secretName = /(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;
const credentialUrl = /https?:\/\/[^/\s:@]+:[^@\s]+@|[?&](?:password|passwd|secret|token|api[_-]?key|access[_-]?key)=/i;
const forbiddenSource = [
  /^\s*(?:from\s+\S+\s+import|import\s+)/m,
  /^\s*(?:async\s+def|class\s+)/m,
  /^\s+(?:def|class)\s+/m,
  /\b(?:lambda|yield|await|eval|exec|compile|__import__|globals|locals)\b/,
  /\b(?:global|nonlocal)\b/,
  /\b(?:start|start_locally|run_locally|debug_pipeline)\s*\(/,
] as const;

const diagnostic = (code: string, field: string, message: string): FunctionAuthoringDiagnostic => ({code, field, message});

const containsSecret = (value: unknown): boolean => {
  if (typeof value === 'string') return credentialUrl.test(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => secretName.test(key) || containsSecret(nested));
};

/**
 * A bounded admission check for the CP-13 subset. The server-side CP-11/CP-13
 * contracts remain authoritative; this function does not parse or execute code.
 */
export const validateFunctionAuthoringDefinition = (
  definition: FunctionAuthoringDefinition,
): FunctionAuthoringValidation => {
  const diagnostics: FunctionAuthoringDiagnostic[] = [];
  if (!generatedName.test(definition.name)) {
    diagnostics.push(diagnostic('CPSEM003', 'name', 'Function name must be a generator-safe identifier.'));
  }
  if (!definition.label.trim()) diagnostics.push(diagnostic('CPSEM003', 'label', 'Component name is required.'));
  if (definition.description && (secretName.test(definition.description) || credentialUrl.test(definition.description))) {
    diagnostics.push(diagnostic('CPSEM010', 'description', 'Secret-bearing description is not allowed.'));
  }
  if (definition.source.length > 32_768 || definition.source.split('\n').length > 500) {
    diagnostics.push(diagnostic('CPSEM003', 'source', 'Function source exceeds the constrained authoring limit.'));
  } else {
    if (!new RegExp(`^\\s*def\\s+${definition.name}\\s*\\(`).test(definition.source)) {
      diagnostics.push(diagnostic('CPSEM003', 'source', 'Source must declare the explicitly named top-level function.'));
    }
    if (!definition.signature.trim().startsWith(`def ${definition.name}(`)) {
      diagnostics.push(diagnostic('CPSEM003', 'signature', 'Signature must explicitly declare the same function name.'));
    }
    if (forbiddenSource.some(pattern => pattern.test(definition.source))) {
      diagnostics.push(diagnostic('CPSEM003', 'source', 'Imports and dynamic, nested, async, or launch constructs are not supported.'));
    }
    if (secretName.test(definition.source) || credentialUrl.test(definition.source)) {
      diagnostics.push(diagnostic('CPSEM010', 'source', 'Secret-bearing source is not allowed.'));
    }
  }
  if (!(FUNCTION_AUTHORING_TASK_TYPES as readonly string[]).includes(definition.taskType)) {
    diagnostics.push(diagnostic('CPSEM009', 'taskType', 'Choose a supported task type.'));
  }
  if (definition.queueResourceId && (!stableId.test(definition.queueResourceId) || containsSecret(definition.queueResourceId))) {
    diagnostics.push(diagnostic('CPSEM010', 'queueResourceId', 'Queue reference is not safe.'));
  }
  if (definition.reference && (!safeReference.test(definition.reference) || secretName.test(definition.reference) || containsSecret(definition.reference))) {
    diagnostics.push(diagnostic('CPSEM010', 'reference', 'Component reference is not safe.'));
  }
  const portIds = [...definition.inputs, ...definition.outputs].map(port => port.id);
  if (portIds.some(id => !stableId.test(id)) || new Set(portIds).size !== portIds.length) {
    diagnostics.push(diagnostic('CPSEM005', 'ports', 'Every input and output needs a unique stable port ID.'));
  }
  if (definition.inputs.some(port => !generatedName.test(port.name) || containsSecret(port.default))) {
    diagnostics.push(diagnostic('CPSEM004', 'inputs', 'Input names and defaults must be generator-safe JSON values without secrets.'));
  }
  if (!definition.outputs.length || definition.outputs.some(port => !generatedName.test(port.name))) {
    diagnostics.push(diagnostic('CPSEM005', 'outputs', 'Declare one or more generator-safe output return names.'));
  }
  if (definition.packages?.some(packageName => !packageName.trim() || packageName.length > 512 || credentialUrl.test(packageName))) {
    diagnostics.push(diagnostic('CPSEM010', 'packages', 'Package requirements must not contain credentials or empty values.'));
  }
  if (definition.retryOnFailure !== undefined
    && (!Number.isInteger(definition.retryOnFailure) || definition.retryOnFailure < 0)) {
    diagnostics.push(diagnostic('CPSEM009', 'retryOnFailure', 'Retry count must be a non-negative integer.'));
  }
  if (definition.reference) {
    diagnostics.push(diagnostic(
      'CP25CONTRACT001',
      'execution-settings',
      'Packages, retry settings, and component references await a CP-06 v2 persistence contract.',
    ));
  }
  return {valid: !diagnostics.length, diagnostics};
};
