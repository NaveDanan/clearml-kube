import canonicalGoldenFixture from './fixtures/canonical-serialization.golden.json';
import canonicalFixture from './fixtures/canonical-serialization.v2.json';
import cyclicFixture from './fixtures/cyclic-graph.v2.json';
import datasetFixture from './fixtures/dataset-bound-graph.v2.json';
import encodedSecretUrlFixture from './fixtures/encoded-secret-url-graph.v2.json';
import functionFixture from './fixtures/function-graph.v2.json';
import invalidSecretFixture from './fixtures/invalid-secret-graph.v2.json';
import taskFixture from './fixtures/task-graph.v2.json';
import {decodeGraphV2, deriveGraphV2Dependencies, serializeGraphV2} from './graph-v2-codec';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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
    expect(deriveGraphV2Dependencies(task)).toEqual([{source_node_id: 'stage-data', target_node_id: 'stage-process'}]);
    expect(functionGraph.nodes.map((node) => node.name)).toEqual(['normalize', 'format_result']);
    expect(functionGraph.bindings.map((binding) => binding.kind).sort()).toEqual(['data', 'inferred']);
    expect(deriveGraphV2Dependencies(functionGraph)).toEqual([{source_node_id: 'normalize', target_node_id: 'format-result'}]);
    expect(dataset.resources.some((resource) => resource.kind === 'dataset')).toBeTrue();
    expect(dataset.nodes[0].kind).toBe('task');
  });

  it('round-trips deterministically regardless of collection ordering', () => {
    const graph = decodeFixture(taskFixture);
    const reordered = clone(taskFixture);
    reordered.document.tags.reverse();
    reordered.nodes.reverse();
    reordered.bindings.reverse();
    const reorderedGraph = decodeFixture(reordered);

    expect(serializeGraphV2(graph)).toBe(serializeGraphV2(reorderedGraph));
    expect(decodeGraphV2(JSON.parse(serializeGraphV2(graph))).status).toBe('ok');
  });

  it('round-trips a non-negative task retry setting', () => {
    const retrying = clone(taskFixture);
    (retrying.nodes[0].configuration as Record<string, unknown>).retry_on_failure = 2;

    const graph = decodeFixture(retrying);
    const firstNode = graph.nodes[0];
    if (firstNode.kind !== 'task') throw new Error('fixture must contain a task node');
    expect(firstNode.configuration.retry_on_failure).toBe(2);

    const roundTripped = decodeFixture(JSON.parse(serializeGraphV2(graph)));
    const roundTrippedNode = roundTripped.nodes[0];
    if (roundTrippedNode.kind !== 'task') throw new Error('fixture must contain a task node');
    expect(roundTrippedNode.configuration.retry_on_failure).toBe(2);
  });

  it('round-trips declarative function description, packages, and retry settings', () => {
    const configured = clone(functionFixture);
    (configured.nodes[0] as Record<string, unknown>).description = 'Normalize an input value.';
    const configuration = configured.nodes[0].configuration as Record<string, unknown>;
    configuration.packages = ['pandas==2.2.3', 'scikit-learn==1.5.2'];
    configuration.retry_on_failure = 2;

    const graph = decodeFixture(configured);
    const node = graph.nodes.find((item) => item.id === 'normalize');
    if (!node || node.kind !== 'function') throw new Error('fixture must contain a function node');
    expect(node.description).toBe('Normalize an input value.');
    expect(node.configuration).toEqual(jasmine.objectContaining({
      packages: ['pandas==2.2.3', 'scikit-learn==1.5.2'],
      retry_on_failure: 2,
    }));

    const roundTripped = decodeFixture(JSON.parse(serializeGraphV2(graph)));
    const roundTrippedNode = roundTripped.nodes.find((item) => item.id === 'normalize');
    if (!roundTrippedNode || roundTrippedNode.kind !== 'function') throw new Error('fixture must contain a function node');
    expect(roundTrippedNode).toEqual(jasmine.objectContaining({
      description: 'Normalize an input value.',
      configuration: jasmine.objectContaining({
        packages: ['pandas==2.2.3', 'scikit-learn==1.5.2'],
        retry_on_failure: 2,
      }),
    }));
  });

  it('rejects invalid and secret function execution settings', () => {
    const invalidRetry = clone(functionFixture);
    (invalidRetry.nodes[0].configuration as Record<string, unknown>).retry_on_failure = -1;
    expect(decodeGraphV2(invalidRetry)).toEqual(jasmine.objectContaining({
      status: 'invalid',
      errors: [jasmine.objectContaining({
        code: 'invalid_integer',
        path: 'graph.nodes[0].configuration.retry_on_failure',
      })],
    }));

    const invalidPackages = clone(functionFixture);
    (invalidPackages.nodes[0].configuration as Record<string, unknown>).packages = [''];
    expect(decodeGraphV2(invalidPackages)).toEqual(jasmine.objectContaining({
      status: 'invalid',
      errors: [jasmine.objectContaining({
        code: 'invalid_string',
        path: 'graph.nodes[0].configuration.packages[0]',
      })],
    }));

    [
      'https://packages.example.invalid/private?api_key=must-not-persist',
      'git+https://user:pass@example.invalid/repository.git',
      'git+https://example.invalid/repository.git?%61pi_key=must-not-persist',
    ].forEach((packageUrl) => {
      const secretPackage = clone(functionFixture);
      (secretPackage.nodes[0].configuration as Record<string, unknown>).packages = [packageUrl];
      const secretResult = decodeGraphV2(secretPackage);
      expect(secretResult.status).toBe('invalid');
      if (secretResult.status !== 'invalid') throw new Error('secret package must be invalid');
      expect(secretResult.errors[0]).toEqual(jasmine.objectContaining({
        code: 'secret_not_allowed',
        path: 'graph.nodes[0].configuration.packages[0]',
      }));
      expect(JSON.stringify(secretResult.errors)).not.toContain('must-not-persist');
      expect(JSON.stringify(secretResult.errors)).not.toContain('user:pass');
    });

    const unknown = clone(functionFixture);
    (unknown.nodes[0].configuration as Record<string, unknown>).unsupported_option = true;
    expect(decodeGraphV2(unknown)).toEqual(jasmine.objectContaining({
      status: 'unsupported',
      unsupported: jasmine.objectContaining({
        reason: 'unsupported_field',
        path: 'graph.nodes[0].configuration.unsupported_option',
      }),
    }));
  });

  it('rejects invalid, unknown, and secret task configuration fields', () => {
    [-1, 1.5, true, '2'].forEach((retry) => {
      const invalid = clone(taskFixture);
      (invalid.nodes[0].configuration as Record<string, unknown>).retry_on_failure = retry;
      const result = decodeGraphV2(invalid);
      expect(result.status).toBe('invalid');
      if (result.status !== 'invalid') throw new Error('retry setting must be invalid');
      expect(result.errors[0]).toEqual(jasmine.objectContaining({
        code: 'invalid_integer',
        path: 'graph.nodes[0].configuration.retry_on_failure',
      }));
    });

    const unknown = clone(taskFixture);
    (unknown.nodes[0].configuration as Record<string, unknown>).unsupported_option = true;
    expect(decodeGraphV2(unknown)).toEqual(jasmine.objectContaining({
      status: 'unsupported',
      unsupported: jasmine.objectContaining({
        reason: 'unsupported_field',
        path: 'graph.nodes[0].configuration.unsupported_option',
      }),
    }));

    const secret = clone(taskFixture);
    (secret.nodes[0].configuration as Record<string, unknown>).api_key = 'must-not-persist';
    const secretResult = decodeGraphV2(secret);
    expect(secretResult.status).toBe('invalid');
    if (secretResult.status !== 'invalid') throw new Error('secret field must be invalid');
    expect(secretResult.errors[0].code).toBe('secret_not_allowed');
    expect(JSON.stringify(secretResult.errors)).not.toContain('must-not-persist');
  });

  it('rejects secrets without returning their values', () => {
    const result = decodeGraphV2(invalidSecretFixture);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('fixture must be invalid');
    expect(result.errors[0].code).toBe('secret_not_allowed');
    expect(JSON.stringify(result.errors)).not.toContain('must-not-persist');

    const sourceSecret = clone(functionFixture);
    sourceSecret.nodes[0].source = 'def normalize():\n    api_key = \'must-not-persist\'\n';
    expect(decodeGraphV2(sourceSecret).status).toBe('invalid');

    const encodedUrl = decodeGraphV2(encodedSecretUrlFixture);
    expect(encodedUrl.status).toBe('invalid');
    if (encodedUrl.status !== 'invalid') throw new Error('encoded URL must be invalid');
    expect(encodedUrl.errors[0].code).toBe('secret_not_allowed');
    expect(JSON.stringify(encodedUrl.errors)).not.toContain('must-not-persist');
  });

  it('rejects cycles derived from data and artifact port bindings', () => {
    const result = decodeGraphV2(cyclicFixture);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('cycle fixture must be invalid');
    expect(result.errors[0]).toEqual({
      code: 'graph_cycle',
      path: 'graph.bindings',
      message: 'graph dependencies must be acyclic',
    });
  });

  it('matches the server/browser canonical serialization golden', () => {
    expect(serializeGraphV2(decodeFixture(canonicalFixture))).toBe(canonicalGoldenFixture.canonical_json);
  });

  it('preserves legacy, newer, and unknown structures as read-only unsupported documents', () => {
    const legacy = {schema_version: 1, nodes: [{id: 'legacy'}], edges: []};
    const legacyResult = decodeGraphV2(legacy);
    expect(legacyResult.status).toBe('unsupported');
    if (legacyResult.status !== 'unsupported') throw new Error('legacy graph must be unsupported');
    expect(legacyResult.unsupported.reason).toBe('legacy_v1_not_losslessly_representable');
    expect(JSON.stringify(legacyResult.unsupported.raw)).toBe(JSON.stringify(legacy));

    const unknown = clone(taskFixture);
    unknown.nodes[0].kind = 'component';
    const unknownResult = decodeGraphV2(unknown);
    expect(unknownResult.status).toBe('unsupported');
    if (unknownResult.status !== 'unsupported') throw new Error('unknown graph must be unsupported');
    expect(unknownResult.unsupported.reason).toBe('unsupported_node_kind');

    const unknownPort = clone(taskFixture);
    unknownPort.nodes[0].ports[0].kind = 'future-port';
    const unknownPortResult = decodeGraphV2(unknownPort);
    expect(unknownPortResult.status).toBe('unsupported');
    if (unknownPortResult.status !== 'unsupported') throw new Error('unknown port must be unsupported');
    expect(unknownPortResult.unsupported.reason).toBe('unsupported_port_kind');
  });

  it('reports dangling ports as invalid instead of dropping their binding', () => {
    const dangling = clone(functionFixture);
    dangling.bindings[0].target.port_id = 'missing-port';
    const result = decodeGraphV2(dangling);
    expect(result.status).toBe('invalid');
    if (result.status !== 'invalid') throw new Error('dangling binding must be invalid');
    expect(result.errors[0].code).toBe('unknown_port');
  });
});
