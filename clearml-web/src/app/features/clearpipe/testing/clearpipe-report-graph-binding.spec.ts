/**
 * Foundation unit tests for the graph-aware Report node contracts:
 *  - template parsing (fingerprint, commented iframes, duplicate slot ids,
 *    unsupported widgets),
 *  - graph-aware mapping identities / compatibility / auto-match / validation,
 *  - legacy migration (taskIds -> baseTaskId, multi-task split, taskId ->
 *    sourceNodeId bindings, external-source review, source-edge creation),
 *  - codec round-trip proving the contracts survive save/reload without
 *    persisting a runtime task id.
 */
import {createEmptyGraphV2} from '../domain/graph-store.service';
import {GraphV2} from '../domain/graph-v2.types';
import {flowToGraphNodes, graphV2ToFlow} from '../editor/flow/clearpipe-flow-codec';
import {
  ClearpipeFlowGraph,
  ClearpipeFlowNode,
  emptyClearpipeFlowGraph,
  expectedOutputId,
  TaskExpectedOutput,
} from '../editor/flow/clearpipe-flow.models';
import {
  computeTemplateFingerprint,
  parseReportTemplate,
} from '../editor/flow/clearpipe-report-template';
import {
  expectedOutputsToSources,
  mappingIdentity,
  reconcileTaskMetadataMappings,
  reportMappingProgress,
  ReportSlotMapping,
  reportSourceIdentity,
  slotAcceptsOutput,
  suggestReportMatches,
  taskMetadataSources,
  validateReportMappings,
} from '../editor/flow/clearpipe-report-mapping';
import {migrateFlowGraph} from '../editor/flow/clearpipe-flow-migration';

const node = (partial: Partial<ClearpipeFlowNode> & Pick<ClearpipeFlowNode, 'id' | 'type'>): ClearpipeFlowNode => ({
  position: {x: 0, y: 0},
  label: partial.id,
  status: 'idle',
  config: {},
  ...partial,
});

const graph = (nodes: ClearpipeFlowNode[], edges: ClearpipeFlowGraph['edges'] = []): ClearpipeFlowGraph => ({
  ...emptyClearpipeFlowGraph(),
  nodes,
  edges,
});

// ---------------------------------------------------------------------------
// Template parsing
// ---------------------------------------------------------------------------

describe('parseReportTemplate', () => {
  it('extracts text + media slots and ignores media-only tokens', () => {
    const md = `# <TASK_NAME>\nStatus <STATUS>\n<iframe src="/widgets/?type=plot&metrics=<PLOT_METRIC>" name="pr-curve"></iframe>`;
    const {slots} = parseReportTemplate(md);
    expect(slots.map((s) => s.key).sort()).toEqual(['media:pr-curve', 'text:STATUS', 'text:TASK_NAME']);
    expect(slots.find((s) => s.key === 'media:pr-curve')?.mediaType).toBe('plot');
  });

  it('ignores commented example iframes and tokens (HTML comments + fenced code)', () => {
    const md = [
      '<!-- <iframe src="/widgets/?type=scalar" name="commented"></iframe> <SECRET_TOKEN> -->',
      '```',
      '<iframe src="/widgets/?type=scalar" name="fenced"></iframe>',
      '<FENCED_TOKEN>',
      '```',
      '<iframe src="/widgets/?type=scalar" name="live"></iframe>',
      '<LIVE_TOKEN>',
    ].join('\n');
    const {slots} = parseReportTemplate(md);
    const keys = slots.map((s) => s.key);
    expect(keys).toContain('media:live');
    expect(keys).toContain('text:LIVE_TOKEN');
    expect(keys).not.toContain('media:commented');
    expect(keys).not.toContain('media:fenced');
    expect(keys).not.toContain('text:SECRET_TOKEN');
    expect(keys).not.toContain('text:FENCED_TOKEN');
  });

  it('reports duplicate live iframe names as authoring errors', () => {
    const md = `<iframe src="/widgets/?type=scalar" name="dup"></iframe><iframe src="/widgets/?type=scalar" name="dup"></iframe>`;
    const {slots, errors} = parseReportTemplate(md);
    expect(slots.filter((s) => s.key === 'media:dup').length).toBe(1);
    expect(errors.some((e) => e.includes('dup'))).toBeTrue();
  });

  it('skips iframes with unsupported widget types', () => {
    const md = `<iframe src="/widgets/?type=weird" name="nope"></iframe><iframe src="/widgets/?type=scalar" name="ok"></iframe>`;
    const {slots} = parseReportTemplate(md);
    expect(slots.map((s) => s.key)).toEqual(['media:ok']);
  });
});

describe('computeTemplateFingerprint', () => {
  it('is stable across whitespace-only edits but changes with content', () => {
    const a = computeTemplateFingerprint('# Title\n<TASK_NAME>');
    const b = computeTemplateFingerprint('#   Title\n\n<TASK_NAME>  ');
    const c = computeTemplateFingerprint('# Title\n<PROJECT>');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('ignores commented regions', () => {
    const a = computeTemplateFingerprint('<LIVE>');
    const b = computeTemplateFingerprint('<LIVE><!-- <COMMENTED> -->');
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Mapping identities + compatibility + auto-match
// ---------------------------------------------------------------------------

describe('reportSourceIdentity', () => {
  it('is unique per source node even for identically named metrics', () => {
    const sel = {metric: 'loss', variant: 'train'};
    const a = reportSourceIdentity({sourceNodeId: 'task-a'}, 'scalar', sel);
    const b = reportSourceIdentity({sourceNodeId: 'task-b'}, 'scalar', sel);
    expect(a).not.toBe(b);
  });

  it('distinguishes node vs external task binding', () => {
    const sel = {artifactKey: 'model'};
    expect(reportSourceIdentity({sourceNodeId: 't'}, 'artifact', sel))
      .not.toBe(reportSourceIdentity({externalTaskId: 't'}, 'artifact', sel));
  });

  it('exposes stable metadata identities including author and company', () => {
    const fields = taskMetadataSources('task-1', 'Train').map((source) => source.selector.field);
    expect(fields).toContain('name');
    expect(fields).toContain('author');
    expect(fields).toContain('company_id');
  });

  it('distinguishes sectioned hyperparameters', () => {
    const weights = reportSourceIdentity(
      {sourceNodeId: 'task-1'},
      'hyperparam',
      {section: 'training', parameter: 'weights'},
    );
    const dataset = reportSourceIdentity(
      {sourceNodeId: 'task-1'},
      'hyperparam',
      {section: 'training', parameter: 'clearml_dataset_name'},
    );
    expect(weights).not.toBe(dataset);
  });
});

describe('slotAcceptsOutput', () => {
  it('constrains media slots by widget type', () => {
    const plotSlot = {key: 'media:p', kind: 'media' as const, label: 'p', iframeName: 'p', mediaType: 'plot'};
    const scalarSlot = {key: 'media:s', kind: 'media' as const, label: 's', iframeName: 's', mediaType: 'scalar'};
    const textSlot = {key: 'text:X', kind: 'text' as const, label: 'X', token: 'X'};
    expect(slotAcceptsOutput(plotSlot, 'plot')).toBeTrue();
    expect(slotAcceptsOutput(plotSlot, 'scalar')).toBeFalse();
    expect(slotAcceptsOutput(scalarSlot, 'scalar_graph')).toBeTrue();
    expect(slotAcceptsOutput(textSlot, 'field')).toBeTrue();
    expect(slotAcceptsOutput(textSlot, 'hyperparam')).toBeTrue();
    expect(slotAcceptsOutput(textSlot, 'plot')).toBeFalse();
  });
});

describe('reconcileTaskMetadataMappings', () => {
  it('maps deterministic author/company fields without changing authored mappings', () => {
    const slots = parseReportTemplate('<TASK_NAME> <AUTHOR> <COMPANY_ID>').slots;
    const sources = taskMetadataSources('task-1', 'Train');
    const existing: ReportSlotMapping[] = [{
      slotKey: 'text:TASK_NAME',
      source: {sourceNodeId: 'task-1'},
      outputKind: 'field',
      selector: {field: 'name'},
      required: true,
      confirmed: true,
    }];
    const mappings = reconcileTaskMetadataMappings(slots, existing, sources);
    expect(mappings.length).toBe(3);
    expect(mappings.find((mapping) => mapping.slotKey === 'text:AUTHOR')?.selector.field).toBe('author');
    expect(mappings.find((mapping) => mapping.slotKey === 'text:COMPANY_ID')?.selector.field).toBe('company_id');
    expect(mappings.every((mapping) => mapping.confirmed)).toBeTrue();
  });
});

describe('suggestReportMatches', () => {
  const outputs: TaskExpectedOutput[] = [
    {kind: 'scalar', metric: 'loss', variant: 'train'},
    {kind: 'plot', metric: 'ROC', variant: 'plot image'},
    {kind: 'artifact', artifactKey: 'model'},
  ];
  const sources = expectedOutputsToSources('task-1', 'Train', outputs);

  it('produces exact + high-confidence suggestions', () => {
    const slots = parseReportTemplate(
      `<iframe src="/widgets/?type=plot" name="ROC"></iframe><MODEL>`,
    ).slots;
    const suggestions = suggestReportMatches(slots, sources);
    const roc = suggestions.find((s) => s.slotKey === 'media:ROC');
    expect(roc?.confidence).toBe('exact');
    const model = suggestions.find((s) => s.slotKey === 'text:MODEL');
    expect(model?.output.selector.artifactKey).toBe('model');
  });

  it('does not suggest incompatible outputs', () => {
    const slots = parseReportTemplate(`<iframe src="/widgets/?type=sample" name="ROC"></iframe>`).slots;
    // ROC is a plot, sample slot needs an image -> no suggestion.
    expect(suggestReportMatches(slots, sources).length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('validateReportMappings', () => {
  const slots = parseReportTemplate('<TASK_NAME>').slots;
  const identity = reportSourceIdentity({sourceNodeId: 'task-1'}, 'field', {field: 'name'});
  const base = {
    slots,
    connectedSourceNodeIds: new Set(['task-1']),
    availableIdentities: new Set([identity]),
    templateSelected: true,
  };

  it('is valid when required slots have confirmed connected mappings', () => {
    const mappings: ReportSlotMapping[] = [
      {slotKey: 'text:TASK_NAME', source: {sourceNodeId: 'task-1'}, outputKind: 'field', selector: {field: 'name'}, required: true, confirmed: true},
    ];
    expect(validateReportMappings({...base, mappings}).valid).toBeTrue();
  });

  it('blocks on no template', () => {
    const res = validateReportMappings({...base, templateSelected: false, mappings: []});
    expect(res.errors.some((e) => e.includes('template'))).toBeTrue();
  });

  it('blocks on unconfirmed suggestion', () => {
    const mappings: ReportSlotMapping[] = [
      {slotKey: 'text:TASK_NAME', source: {sourceNodeId: 'task-1'}, outputKind: 'field', selector: {field: 'name'}, required: true, confirmed: false},
    ];
    expect(validateReportMappings({...base, mappings}).valid).toBeFalse();
  });

  it('blocks when the source node is not directly connected', () => {
    const mappings: ReportSlotMapping[] = [
      {slotKey: 'text:TASK_NAME', source: {sourceNodeId: 'task-x'}, outputKind: 'field', selector: {field: 'name'}, required: true, confirmed: true},
    ];
    expect(validateReportMappings({...base, mappings}).valid).toBeFalse();
  });

  it('blocks on template drift', () => {
    const mappings: ReportSlotMapping[] = [
      {slotKey: 'text:TASK_NAME', source: {sourceNodeId: 'task-1'}, outputKind: 'field', selector: {field: 'name'}, required: true, confirmed: true},
    ];
    expect(validateReportMappings({...base, mappings, templateDrifted: true}).valid).toBeFalse();
  });

  it('does not require an ignored optional slot', () => {
    const mappings: ReportSlotMapping[] = [
      {slotKey: 'text:TASK_NAME', source: {}, outputKind: 'field', selector: {}, required: false, confirmed: true, ignored: true},
    ];
    expect(validateReportMappings({...base, mappings}).valid).toBeTrue();
  });

  it('accepts connected metadata and hyperparameter mappings in one contract', () => {
    const contractSlots = parseReportTemplate('<AUTHOR> <COMPANY_ID> <ARCHITECTURE>').slots;
    const metadata = taskMetadataSources('task-1', 'Train');
    const architectureIdentity = reportSourceIdentity(
      {sourceNodeId: 'task-1'},
      'hyperparam',
      {section: 'training', parameter: 'weights'},
    );
    const mappings = reconcileTaskMetadataMappings(contractSlots, [], metadata);
    mappings.push({
      slotKey: 'text:ARCHITECTURE',
      source: {sourceNodeId: 'task-1'},
      outputKind: 'hyperparam',
      selector: {section: 'training', parameter: 'weights'},
      required: true,
      confirmed: true,
    });
    const result = validateReportMappings({
      slots: contractSlots,
      mappings,
      connectedSourceNodeIds: new Set(['task-1']),
      availableIdentities: new Set([
        ...metadata.map((source) => source.identity),
        architectureIdentity,
      ]),
      templateSelected: true,
    });
    expect(result.valid).toBeTrue();
    expect(result.mappedCount).toBe(3);
    expect(result.totalRequired).toBe(3);
  });
});

describe('reportMappingProgress', () => {
  it('counts only required mappings and never exceeds the required total', () => {
    const slots = parseReportTemplate('<TASK_NAME> <ARCHITECTURE>').slots;
    const mappings: ReportSlotMapping[] = [
      {
        slotKey: 'text:TASK_NAME',
        source: {sourceNodeId: 'task-1'},
        outputKind: 'field',
        selector: {field: 'name'},
        required: true,
        confirmed: true,
      },
      {
        slotKey: 'text:ARCHITECTURE',
        source: {sourceNodeId: 'task-1'},
        outputKind: 'hyperparam',
        selector: {section: 'training', parameter: 'weights'},
        required: false,
        confirmed: true,
      },
      {
        slotKey: 'text:STALE_OPTIONAL',
        source: {sourceNodeId: 'task-1'},
        outputKind: 'field',
        selector: {field: 'name'},
        required: false,
        confirmed: true,
      },
    ];
    expect(reportMappingProgress(slots, mappings)).toEqual({
      valid: true,
      mappedCount: 1,
      totalRequired: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Expected output identity
// ---------------------------------------------------------------------------

describe('expectedOutputId', () => {
  it('is stable and distinguishes kinds/selectors', () => {
    expect(expectedOutputId({kind: 'scalar', metric: 'loss', variant: 'train'}))
      .toBe(expectedOutputId({kind: 'scalar', metric: 'loss', variant: 'train'}));
    expect(expectedOutputId({kind: 'artifact', artifactKey: 'model'}))
      .not.toBe(expectedOutputId({kind: 'scalar', metric: 'model'}));
  });
});

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

describe('migrateFlowGraph', () => {
  it('migrates a one-item taskIds array to baseTaskId', () => {
    const {graph: out, changed} = migrateFlowGraph(graph([
      node({id: 'task-1', type: 'task', config: {taskIds: ['base-abc']}}),
    ]));
    expect(changed).toBeTrue();
    expect(out.nodes[0].config['baseTaskId']).toBe('base-abc');
    expect(out.nodes[0].config['taskIds']).toBeUndefined();
  });

  it('flags multi-task Task nodes for a blocking split', () => {
    const res = migrateFlowGraph(graph([
      node({id: 'task-1', type: 'task', config: {taskIds: ['a', 'b']}}),
    ]));
    expect(res.taskNodesNeedingSplit).toEqual(['task-1']);
    expect(res.graph.nodes[0].config['requiresSplit']).toBeTrue();
    expect(res.graph.nodes[0].config['baseTaskId']).toBeFalsy();
  });

  it('rewrites legacy report mappings to sourceNodeId bindings and adds source edges', () => {
    const res = migrateFlowGraph(graph([
      node({id: 'task-1', type: 'task', config: {taskIds: ['base-abc']}}),
      node({id: 'report-1', type: 'report', config: {
        templateReportId: 'tmpl',
        mappings: {'text:TASK_NAME': {taskId: 'base-abc', kind: 'field', ref: 'name'}},
      }}),
    ]));
    const report = res.graph.nodes.find((n) => n.id === 'report-1')!;
    const mappings = report.config['reportMappings'] as ReportSlotMapping[];
    expect(mappings[0].source.sourceNodeId).toBe('task-1');
    expect(mappings[0].source.externalTaskId).toBeUndefined();
    expect(res.graph.edges.some((e) => e.source === 'task-1' && e.target === 'report-1')).toBeTrue();
    expect(res.reportsWithExternalSources).toEqual([]);
  });

  it('preserves unmatched task ids as external sources marked for review', () => {
    const res = migrateFlowGraph(graph([
      node({id: 'report-1', type: 'report', config: {
        mappings: {'text:TASK_NAME': {taskId: 'external-999', kind: 'field', ref: 'name'}},
      }}),
    ]));
    const report = res.graph.nodes.find((n) => n.id === 'report-1')!;
    const mappings = report.config['reportMappings'] as ReportSlotMapping[];
    expect(mappings[0].source.externalTaskId).toBe('external-999');
    expect(report.config['migrationReview']).toBeTrue();
    expect(res.reportsWithExternalSources).toEqual(['report-1']);
  });

  it('is idempotent when graph-aware mappings already exist', () => {
    const existing = graph([
      node({id: 'report-1', type: 'report', config: {reportMappings: [
        {slotKey: 'text:X', source: {sourceNodeId: 'task-1'}, outputKind: 'field', selector: {field: 'name'}, required: true, confirmed: true},
      ]}}),
    ]);
    const res = migrateFlowGraph(existing);
    expect(res.changed).toBeFalse();
    expect(res.graph).toBe(existing);
  });
});

// ---------------------------------------------------------------------------
// Codec round-trip: contracts survive save/reload, no runtime task id persisted
// ---------------------------------------------------------------------------

describe('flow codec round-trip (graph-aware contracts)', () => {
  const toGraphV2 = (flow: ClearpipeFlowGraph): GraphV2 => {
    const {nodes, bindings} = flowToGraphNodes(flow);
    return {...createEmptyGraphV2({name: flow.name}), nodes, bindings};
  };

  it('round-trips baseTaskId + reportMappings without persisting a runtime task id', () => {
    const expected: TaskExpectedOutput[] = [{kind: 'scalar', metric: 'loss', variant: 'train'}];
    const mappings: ReportSlotMapping[] = [
      {slotKey: 'media:loss', source: {sourceNodeId: 'task-1'}, outputKind: 'scalar', selector: {metric: 'loss', variant: 'train'}, required: true, confirmed: true},
    ];
    const flow = graph(
      [
        node({id: 'task-1', type: 'task', config: {baseTaskId: 'base-abc', expectedOutputs: expected}}),
        node({id: 'report-1', type: 'report', config: {templateReportId: 'tmpl', reportMappings: mappings, templateFingerprint: 'abc12345'}}),
      ],
      [{id: 'e1', source: 'task-1', target: 'report-1'}],
    );

    const restored = graphV2ToFlow(toGraphV2(flow));
    const task = restored.nodes.find((n) => n.id === 'task-1')!;
    const report = restored.nodes.find((n) => n.id === 'report-1')!;

    expect(task.config['baseTaskId']).toBe('base-abc');
    expect(mappingIdentity((report.config['reportMappings'] as ReportSlotMapping[])[0]))
      .toBe(reportSourceIdentity({sourceNodeId: 'task-1'}, 'scalar', {metric: 'loss', variant: 'train'}));

    // No runtime/base task id must be baked into the report mapping source.
    const serialized = JSON.stringify(report.config['reportMappings']);
    expect(serialized).not.toContain('base-abc');
    expect(restored.edges.some((e) => e.source === 'task-1' && e.target === 'report-1')).toBeTrue();
  });
});
