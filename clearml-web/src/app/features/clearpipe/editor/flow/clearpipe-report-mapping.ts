/**
 * Graph-aware Report mapping contracts.
 *
 * A Report node binds each template slot to an OUTPUT of an upstream pipeline
 * Task node (by `sourceNodeId`) — or, under Advanced, to a fixed external task.
 * At design time we bind to the Task node's expected-output contract; at runtime
 * ClearPipe substitutes the newly cloned task id via `${step_name.id}`, so a
 * mapping never persists a future runtime task id.
 *
 * A source identity combines the source node AND the output selector, so two
 * Task nodes exposing an identically named metric never collide.
 */
import {ReportTemplateSlot} from './clearpipe-report-template';
import {TaskExpectedOutput, TaskExpectedOutputKind} from './clearpipe-flow.models';

/** Output kinds a Report slot can bind to. `image` is a debug-image sample. */
export type ReportOutputKind =
  | 'field'        // a task field for text slots (name/id/status/project/…)
  | 'scalar'       // a single scalar last value
  | 'scalar_graph' // a whole scalar metric graph
  | 'plot'         // a plot
  | 'image'        // a debug image sample
  | 'artifact';    // an output artifact

export interface ReportOutputSelector {
  metric?: string;
  variant?: string;
  artifactKey?: string;
  /** Task field key for `field` outputs (e.g. `name`, `id`, `status`). */
  field?: string;
}

/** Where a mapped value comes from: a pipeline Task node, or a fixed external task. */
export interface ReportMappingSource {
  /** Pipeline Task node id producing this output at runtime (primary path). */
  sourceNodeId?: string;
  /** Advanced: fixed external (historical/non-pipeline) task id. */
  externalTaskId?: string;
}

/** One template slot -> source-output binding stored in `reportMappings`. */
export interface ReportSlotMapping {
  /** Template slot key: `text:<TOKEN>` or `media:<name>`. */
  slotKey: string;
  source: ReportMappingSource;
  outputKind: ReportOutputKind;
  selector: ReportOutputSelector;
  /** Required mappings block save/run when unmapped. Optional can be ignored. */
  required: boolean;
  /** Suggested (false) mappings must be explicitly confirmed (true) before run. */
  confirmed: boolean;
  /** Author explicitly ignored this optional slot. */
  ignored?: boolean;
  /** Source edge/output no longer exists -> mapping broken, Report node invalid. */
  broken?: boolean;
}

/** A concrete output offered by a connected source, for auto-match + selection. */
export interface ReportSourceOutput {
  /** Pipeline Task node id (or external task id when `external` is set). */
  sourceNodeId: string;
  sourceLabel: string;
  outputKind: ReportOutputKind;
  selector: ReportOutputSelector;
  /** Human label, e.g. `metric / variant`, artifact key, or field name. */
  label: string;
  /** Unique identity: source + selector (never collides across tasks). */
  identity: string;
  external?: boolean;
}

/** Confidence of an auto-match suggestion. */
export type ReportMatchConfidence = 'exact' | 'high' | 'none';

// ---------------------------------------------------------------------------
// Identity + selector helpers
// ---------------------------------------------------------------------------

const selectorKey = (kind: ReportOutputKind, selector: ReportOutputSelector): string =>
  kind === 'artifact'
    ? `artifact\u0000${selector.artifactKey ?? ''}`
    : kind === 'field'
      ? `field\u0000${selector.field ?? ''}`
      : `${kind}\u0000${selector.metric ?? ''}\u0000${selector.variant ?? ''}`;

/**
 * Unique identity of a source output: source node/external id + output selector.
 * Eliminates collisions when multiple tasks expose identically named metrics.
 */
export const reportSourceIdentity = (source: ReportMappingSource, kind: ReportOutputKind, selector: ReportOutputSelector): string => {
  const node = source.sourceNodeId ? `node:${source.sourceNodeId}` : source.externalTaskId ? `task:${source.externalTaskId}` : 'unbound';
  return `${node}\u0000${selectorKey(kind, selector)}`;
};

/** The identity of a mapping's currently bound source output. */
export const mappingIdentity = (mapping: ReportSlotMapping): string =>
  reportSourceIdentity(mapping.source, mapping.outputKind, mapping.selector);

// ---------------------------------------------------------------------------
// Expected-output -> source-output projection
// ---------------------------------------------------------------------------

const EXPECTED_TO_OUTPUT_KIND: Record<TaskExpectedOutputKind, ReportOutputKind> = {
  scalar: 'scalar',
  scalar_graph: 'scalar_graph',
  plot: 'plot',
  debug_image: 'image',
  artifact: 'artifact',
};

/** Project a Task node's expected outputs into selectable Report source outputs. */
export const expectedOutputsToSources = (
  sourceNodeId: string,
  sourceLabel: string,
  outputs: readonly TaskExpectedOutput[],
  external = false,
): ReportSourceOutput[] =>
  outputs.map((output) => {
    const outputKind = EXPECTED_TO_OUTPUT_KIND[output.kind];
    const selector: ReportOutputSelector = output.kind === 'artifact'
      ? {artifactKey: output.artifactKey}
      : {metric: output.metric, variant: output.variant};
    const label = output.kind === 'artifact'
      ? (output.artifactKey ?? '')
      : output.variant
        ? `${output.metric ?? ''} / ${output.variant}`
        : (output.metric ?? '');
    const source: ReportMappingSource = external ? {externalTaskId: sourceNodeId} : {sourceNodeId};
    return {
      sourceNodeId,
      sourceLabel,
      outputKind,
      selector,
      label,
      identity: reportSourceIdentity(source, outputKind, selector),
      ...(external ? {external: true} : {}),
    };
  });

// ---------------------------------------------------------------------------
// Slot / output compatibility
// ---------------------------------------------------------------------------

/** Whether a source output can fill a given template slot. */
export const slotAcceptsOutput = (slot: ReportTemplateSlot, kind: ReportOutputKind): boolean => {
  if (slot.kind === 'text') {
    // Text slots resolve to metadata, a last scalar value, or an artifact link.
    return kind === 'field' || kind === 'scalar' || kind === 'artifact';
  }
  const mediaType = (slot.mediaType ?? 'scalar').toLowerCase();
  if (mediaType === 'plot') return kind === 'plot';
  if (mediaType === 'sample') return kind === 'image';
  // scalar widget accepts a single value or a whole graph.
  return kind === 'scalar' || kind === 'scalar_graph';
};

// ---------------------------------------------------------------------------
// Auto-match
// ---------------------------------------------------------------------------

const normalize = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Candidate comparable names for a source output. A plot/scalar output is often
 * embedded under an iframe named after just its metric, so we offer the metric
 * alone AND the `metric variant` combination (plus the variant) as candidates.
 */
const sourceMatchNames = (output: ReportSourceOutput): string[] => {
  const {artifactKey, field, metric, variant} = output.selector;
  if (artifactKey) return [artifactKey];
  if (field) return [field];
  const names: string[] = [];
  if (metric && variant) names.push(`${metric} ${variant}`);
  if (metric) names.push(metric);
  if (variant) names.push(variant);
  return names;
};

/** The comparable name of a slot (its token or iframe name). */
const slotMatchName = (slot: ReportTemplateSlot): string => slot.token ?? slot.iframeName ?? slot.label;

export interface ReportMatchSuggestion {
  slotKey: string;
  output: ReportSourceOutput;
  confidence: Exclude<ReportMatchConfidence, 'none'>;
}

/**
 * Suggest exact / high-confidence source outputs for each slot. Only compatible
 * outputs are considered; exact = a candidate name matches the slot exactly,
 * high = one side contains the other. Ambiguous ties (>1 equally good) yield no
 * suggestion.
 */
export const suggestReportMatches = (
  slots: readonly ReportTemplateSlot[],
  outputs: readonly ReportSourceOutput[],
): ReportMatchSuggestion[] => {
  const suggestions: ReportMatchSuggestion[] = [];
  for (const slot of slots) {
    const slotName = normalize(slotMatchName(slot));
    if (!slotName) continue;
    const compatible = outputs.filter((o) => slotAcceptsOutput(slot, o.outputKind));

    const exact = compatible.filter((o) => sourceMatchNames(o).some((name) => normalize(name) === slotName));
    if (exact.length === 1) {
      suggestions.push({slotKey: slot.key, output: exact[0], confidence: 'exact'});
      continue;
    }
    if (exact.length > 1) continue; // ambiguous

    const high = compatible.filter((o) => sourceMatchNames(o).some((raw) => {
      const name = normalize(raw);
      return !!name && (name.includes(slotName) || slotName.includes(name));
    }));
    if (high.length === 1) {
      suggestions.push({slotKey: slot.key, output: high[0], confidence: 'high'});
    }
  }
  return suggestions;
};

/** Build a confirmed/required mapping from a chosen source output for a slot. */
export const mappingFromOutput = (
  slot: ReportTemplateSlot,
  output: ReportSourceOutput,
  opts: {required?: boolean; confirmed?: boolean} = {},
): ReportSlotMapping => ({
  slotKey: slot.key,
  source: output.external ? {externalTaskId: output.sourceNodeId} : {sourceNodeId: output.sourceNodeId},
  outputKind: output.outputKind,
  selector: output.selector,
  required: opts.required ?? true,
  confirmed: opts.confirmed ?? true,
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ReportValidationContext {
  slots: readonly ReportTemplateSlot[];
  mappings: readonly ReportSlotMapping[];
  /** Task node ids directly connected to this Report node (valid pipeline sources). */
  connectedSourceNodeIds: ReadonlySet<string>;
  /** Available output identities, keyed by source node id -> set of identities. */
  availableIdentities: ReadonlySet<string>;
  templateSelected: boolean;
  /** True when the persisted template fingerprint no longer matches the template. */
  templateDrifted?: boolean;
}

export interface ReportValidationResult {
  valid: boolean;
  errors: string[];
  mappedCount: number;
  totalRequired: number;
}

/**
 * Validate a Report node's mappings. Mirrors the server-side save/run gate:
 * blocks on no template, unmapped required slots, unconfirmed suggestions,
 * non-connected pipeline sources, missing referenced nodes/outputs, and drift.
 */
export const validateReportMappings = (ctx: ReportValidationContext): ReportValidationResult => {
  const errors: string[] = [];
  if (!ctx.templateSelected) errors.push('No report template is selected.');
  if (ctx.templateDrifted) errors.push('The report template changed; re-open mapping to re-sync slots.');

  const byKey = new Map(ctx.mappings.map((m) => [m.slotKey, m]));
  let totalRequired = 0;
  let mappedCount = 0;

  for (const slot of ctx.slots) {
    const mapping = byKey.get(slot.key);
    const isRequired = mapping ? mapping.required && !mapping.ignored : true;
    if (isRequired) totalRequired++;

    if (!mapping || mapping.ignored) {
      if (isRequired) errors.push(`Required slot "${slot.label}" is unmapped.`);
      continue;
    }

    const hasSource = !!(mapping.source.sourceNodeId || mapping.source.externalTaskId);
    if (!hasSource) {
      if (isRequired) errors.push(`Required slot "${slot.label}" has no source.`);
      continue;
    }

    if (mapping.source.sourceNodeId) {
      if (!ctx.connectedSourceNodeIds.has(mapping.source.sourceNodeId)) {
        errors.push(`Slot "${slot.label}" maps to a Task node that is not a directly connected source.`);
        continue;
      }
      if (!ctx.availableIdentities.has(mappingIdentity(mapping))) {
        errors.push(`Slot "${slot.label}" maps to an output that no longer exists.`);
        continue;
      }
    }

    if (mapping.broken) {
      errors.push(`Slot "${slot.label}" mapping is broken (source removed).`);
      continue;
    }

    if (!mapping.confirmed) {
      errors.push(`Slot "${slot.label}" has an unconfirmed suggested mapping.`);
      continue;
    }

    if (isRequired) mappedCount++;
  }

  return {valid: errors.length === 0, errors, mappedCount, totalRequired};
};
