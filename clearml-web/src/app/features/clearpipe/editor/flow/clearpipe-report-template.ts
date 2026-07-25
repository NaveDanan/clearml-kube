/**
 * Parses a report Markdown template into "slots" that a ClearPipe Report node
 * can fill from a source task:
 *
 *  - text slots  — distinct named `<UPPER_SNAKE>` placeholders (e.g. `<TASK_NAME>`,
 *    `<PROJECT>`, `<STATUS>`, `<TASK_ID>`). Generic tokens like `<value>` and the
 *    per-embed metric/variant tokens are intentionally NOT surfaced as text slots.
 *  - media slots — each `<iframe …>` embed (scalar curve / plot / debug image),
 *    keyed by its `name="…"` attribute and carrying the widget `type=`.
 */

export interface ReportTemplateSlot {
  /** Stable key stored in the node mapping: `text:<TOKEN>` or `media:<name>`. */
  key: string;
  kind: 'text' | 'media';
  label: string;
  /** For text slots: the placeholder token without angle brackets. */
  token?: string;
  /** For media slots: the iframe `name` and widget `type` (scalar|plot|sample). */
  iframeName?: string;
  mediaType?: string;
}

/**
 * Legacy slot -> source-item binding, stored in the Report node's `mappings`
 * config by the current inspector. Superseded by the graph-aware `ReportMapping`
 * in clearpipe-report-mapping.ts; kept here for backward-compatible load + the
 * existing config panel until the mapping-workspace UX lands.
 */
export interface ReportMapping {
  taskId: string;
  kind: 'field' | 'hyperparam' | 'scalar' | 'artifact' | 'plot';
  ref: string;
  metric?: string;
  variant?: string;
}

/** Structured result of parsing a report template. */
export interface ReportTemplateParseResult {
  slots: ReportTemplateSlot[];
  /** Authoring errors, e.g. duplicate slot ids among live (non-commented) slots. */
  errors: string[];
  /** Stable fingerprint of the sanitized template used to detect drift. */
  fingerprint: string;
}

/** Named tokens that only ever parameterize an embed's metric/variant selection,
 *  so they are handled per media slot rather than as global text slots. */
const MEDIA_ONLY_TOKENS = new Set([
  'METRIC', 'VARIANT', 'PLOT_METRIC', 'PLOT_VARIANT', 'IMAGE_METRIC', 'IMAGE_VARIANT',
  'SCALAR_METRIC', 'SCALAR_VARIANT',
]);

/** Widget `type=` values ClearPipe knows how to fill at runtime. */
const SUPPORTED_WIDGET_TYPES = new Set(['scalar', 'plot', 'sample']);

/**
 * Remove commented example regions so their placeholder tokens and sample
 * iframes are not surfaced as real slots: HTML comments (`<!-- … -->`) and
 * fenced code blocks (``` … ``` and ~~~ … ~~~).
 */
const stripCommentedRegions = (markdown: string): string =>
  markdown
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ');

/**
 * Deterministic 32-bit FNV-1a hash rendered as an 8-char hex string. Used only
 * to fingerprint template content for drift detection (no security use).
 */
const fnv1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

/**
 * Fingerprint of the template's meaningful content. Commented regions are
 * stripped and whitespace collapsed so cosmetic edits don't spuriously trip
 * drift detection, while any change to live tokens/iframes changes the value.
 */
export const computeTemplateFingerprint = (markdown: string): string =>
  fnv1a(stripCommentedRegions(markdown || '').replace(/\s+/g, ' ').trim());

/**
 * Parse a template into slots + authoring errors + a fingerprint. Commented
 * regions are ignored; duplicate live slot ids are reported as errors.
 */
export const parseReportTemplate = (markdown: string): ReportTemplateParseResult => {
  const raw = markdown || '';
  const md = stripCommentedRegions(raw);
  const slots: ReportTemplateSlot[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  // Media slots: every live <iframe …></iframe>. Match the WHOLE element (not
  // just `<iframe …>`) because the src carries `<TASK_ID>`/`<METRIC>` tokens
  // whose `>` would truncate an attribute-only match and hide the `name` attr.
  const iframeRe = /<iframe\b[\s\S]*?<\/iframe>/gi;
  let match: RegExpExecArray | null;
  let autoIndex = 0;
  while ((match = iframeRe.exec(md)) !== null) {
    const block = match[0];
    // `src="([^"]*)"` stops at the closing quote, so the `<…>` tokens inside are captured.
    const src = /src\s*=\s*"([^"]*)"/i.exec(block)?.[1] ?? '';
    const mediaType = /[?&]type=([^&"']+)/i.exec(src)?.[1] ?? 'scalar';
    // Skip iframes whose widget type ClearPipe can't fill (unsupported widgets).
    if (!SUPPORTED_WIDGET_TYPES.has(mediaType.toLowerCase())) continue;
    const name = /name\s*=\s*"([^"]+)"/i.exec(block)?.[1] ?? `embed-${++autoIndex}`;
    const key = `media:${name}`;
    if (seen.has(key)) {
      errors.push(`Duplicate slot id "${name}" — iframe names must be unique.`);
      continue;
    }
    seen.add(key);
    slots.push({key, kind: 'media', label: name, iframeName: name, mediaType});
  }

  // Text slots: distinct named UPPER_SNAKE tokens (len >= 3), minus media-only
  // ones. Generic lowercase HTML-like tokens (e.g. `<value>`) never match.
  const tokenRe = /<([A-Z][A-Z0-9_]{2,})>/g;
  while ((match = tokenRe.exec(md)) !== null) {
    const token = match[1];
    if (MEDIA_ONLY_TOKENS.has(token)) continue;
    const key = `text:${token}`;
    if (seen.has(key)) continue; // repeated text tokens are one slot, not an error
    seen.add(key);
    slots.push({key, kind: 'text', label: token, token});
  }

  return {slots, errors, fingerprint: computeTemplateFingerprint(raw)};
};

/** Backward-compatible slot extraction (drops errors + fingerprint). */
export const extractReportTemplateSlots = (markdown: string): ReportTemplateSlot[] =>
  parseReportTemplate(markdown).slots;
