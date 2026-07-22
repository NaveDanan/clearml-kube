import datasetFixture from './fixtures/dataset-bound-graph.v2.json';
import functionFixture from './fixtures/function-graph.v2.json';
import invalidSecretFixture from './fixtures/invalid-secret-graph.v2.json';
import taskFixture from './fixtures/task-graph.v2.json';
import {decodeGraphV2, serializeGraphV2} from './graph-v2-codec';

describe('ClearPipe canonical graph v2 codec', () => {
  const decodeFixture = (fixture: unknown) => {
    const result = decodeGraphV2(fixture);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('fixture must decode');
    return result.graph;
  };

  it('accepts shared task, function, and dataset-bound fixtures from the CP-03 semantics', () => {
    const task = decodeFixture(taskFixture);
    const functionGraph = decodeFixture(functionFixture);
    const dataset = decodeFixture(datasetFixture);

    expect(task.nodes.map((node) => node.name)).toEqual(['stage_data', 'stage_process']);
    expect(task.bindings.map((binding) => binding.kind).sort()).toEqual(['artifact', 'execution-only', 'parameter']);
    expect(functionGraph.nodes.map((node) => node.name)).toEqual(['normalize', 'format_result']);
    expect(functionGraph.bindings.map((binding) => binding.kind).sort()).toEqual(['data', 'inferred']);
    expect(dataset.resources.some((resource) => resource.kind === 'dataset')).toBeTrue();
    expect(dataset.nodes[0].kind).toBe('task');
  });

  it('round-trips deterministically regardless of collection ordering', () => {
    const graph = decodeFixture(taskFixture);
    const reordered = structuredClone(taskFixture);
    reordered.document.tags.reverse();
    reordered.nodes.reverse();
    reordered.bindings.reverse();
    const reorderedGraph = decodeFixture(reordered);

    expect(serializeGraphV2(graph)).toBe(serializeGraphV2(reorderedGraph));
    expect(decodeGraphV2(serializeGraphV2(graph)).status).toBe('ok');
  });

  it('rejects secrets without returning their values', () => {
    const result = decodeGraphV2(invalidSecretFixture);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('fixture must be invalid');
    expect(result.errors[0].code).toBe('secret_not_allowed');
    expect(JSON.stringify(result.errors)).not.toContain('must-not-persist');

    const sourceSecret = structuredClone(functionFixture);
    sourceSecret.nodes[0].source = 'def normalize():\n    api_key = \'must-not-persist\'\n';
    expect(decodeGraphV2(sourceSecret).status).toBe('invalid');
  });

  it('preserves legacy, newer, and unknown structures as read-only unsupported documents', () => {
    const legacy = {schema_version: 1, nodes: [{id: 'legacy'}], edges: []};
    const legacyResult = decodeGraphV2(legacy);
    expect(legacyResult.status).toBe('unsupported');
    if (legacyResult.status !== 'unsupported') throw new Error('legacy graph must be unsupported');
    expect(legacyResult.unsupported.reason).toBe('legacy_v1_not_losslessly_representable');
    expect(JSON.stringify(legacyResult.unsupported.raw)).toBe(JSON.stringify(legacy));

    const unknown = structuredClone(taskFixture);
    unknown.nodes[0].kind = 'component';
    const unknownResult = decodeGraphV2(unknown);
    expect(unknownResult.status).toBe('unsupported');
    if (unknownResult.status !== 'unsupported') throw new Error('unknown graph must be unsupported');
    expect(unknownResult.unsupported.reason).toBe('unsupported_node_kind');

    const unknownPort = structuredClone(taskFixture);
    unknownPort.nodes[0].ports[0].kind = 'future-port';
    const unknownPortResult = decodeGraphV2(unknownPort);
    expect(unknownPortResult.status).toBe('unsupported');
    if (unknownPortResult.status !== 'unsupported') throw new Error('unknown port must be unsupported');
    expect(unknownPortResult.unsupported.reason).toBe('unsupported_port_kind');
  });

  it('reports dangling ports as invalid instead of dropping their binding', () => {
    const dangling = structuredClone(functionFixture);
    dangling.bindings[0].target.port_id = 'missing-port';
    const result = decodeGraphV2(dangling);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('dangling binding must be invalid');
    expect(result.errors[0].code).toBe('unknown_port');
  });
});
