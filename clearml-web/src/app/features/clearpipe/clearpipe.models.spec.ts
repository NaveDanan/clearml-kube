import {findSecretPaths, findUnsafeObjectPaths, graphContainsSecret, normalizeDefinition} from './clearpipe.models';

describe('ClearPipe graph utilities', () => {
  it('finds nested secret-like fields without returning their values', () => {
    const graph = {nodes: [{config: {safe: 'x', nested: [{api_key: 'do-not-echo'}]}}]};
    expect(graphContainsSecret(graph)).toBeTrue();
    expect(findSecretPaths(graph)).toEqual(['graph.nodes[0].config.nested[0].api_key']);
    expect(findSecretPaths(graph).join(' ')).not.toContain('do-not-echo');
  });

  it('allows opaque secret references but blocks key variants and sensitive URLs', () => {
    expect(graphContainsSecret({credentialId: 'credential-reference-1', secret_ref: 'secret-reference-1'})).toBeFalse();
    expect(findSecretPaths({'API-KEY': 'hidden'})).toEqual(['graph.API-KEY']);
    expect(findSecretPaths({url: 'https://user:password@example.test/data'})).toEqual(['graph.url']);
    expect(findSecretPaths({url: 'https://example.test/data?access_token=hidden'})).toEqual(['graph.url']);
  });

  it('rejects prototype pollution keys at any depth', () => {
    const parsed = JSON.parse('{"nodes":[{"config":{"__proto__":{"polluted":true}}}]}');
    expect(findUnsafeObjectPaths(parsed)).toEqual(['graph.nodes[0].config.__proto__']);
  });

  it('normalizes server definition wrappers and preserves response revision', () => {
    const definition = normalizeDefinition({
      id: 'task-1',
      revision: 7,
      definition: {
        name: 'Six node pipeline',
        user: 'user-1',
        graph: {nodes: [{id: 'n1', type: 'dataset', label: 'Dataset', position: {x: 0, y: 0}, config: {}}], edges: [], viewport: {x: 4, y: 5, zoom: .8}}
      }
    });
    expect(definition.task_id).toBe('task-1');
    expect(definition.revision).toBe(7);
    expect(definition.nodes.length).toBe(1);
    expect(definition.viewport.zoom).toBe(.8);
  });
});
