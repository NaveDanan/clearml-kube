import {GraphV2} from '../domain/graph-v2.types';

export interface ClearpipeCodeDiagnostic {
  code?: string;
  message: string;
  severity: 'error' | 'warning';
  node_id?: string;
}

export interface ClearpipeGeneratedCode {
  source: string;
  semanticFingerprint: string;
}

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stable(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const withoutPresentation = (value: object, fields: readonly string[]): Record<string, unknown> => {
  const copy = structuredClone(value) as Record<string, unknown>;
  fields.forEach(field => delete copy[field]);
  return copy;
};

/**
 * Only compilation-relevant canonical data participates in regeneration.
 * Canvas visual state, document identity, labels, and resource labels cannot
 * alter generated source and are intentionally excluded.
 */
export const clearpipeSemanticFingerprint = (graph: GraphV2): string => stable({
  schema_version: graph.schema_version,
  document: {name: graph.document.name, project: graph.document.project, version: graph.document.version},
  settings: graph.settings,
  parameters: graph.parameters,
  resources: graph.resources.map(resource => withoutPresentation(resource, ['label'])),
  outputs: graph.outputs,
  nodes: graph.nodes.map(node => withoutPresentation(node, ['label', 'visual'])),
  bindings: graph.bindings,
});

export const sourceFromCompilerOutput = (output: unknown): string | null => {
  if (!output || typeof output !== 'object') return null;
  const record = output as Record<string, unknown>;
  return ['source', 'script', 'generated_source', 'code']
    .map(key => record[key])
    .find((value): value is string => typeof value === 'string') ?? null;
};

export const highlightClearpipePython = (source: string): string => source
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/\b(def|return|import|from|for|in|if|else|True|False|None)\b/g, '<span class="cp-keyword">$1</span>')
  .replace(/(#.*)$/gm, '<span class="cp-comment">$1</span>');
