import {ClearpipeDefinitionState} from '../platform/clearpipe-adapter.service';
import {serializeGraphV2} from '../domain/graph-v2-codec';
import {GraphV2} from '../domain/graph-v2.types';
import {functionGraph, functionNode, graphFixture, taskGraph, taskNode} from './clearpipe-fixtures';
import {
  existingPipelineVisualMetadata,
  reviewExistingPipeline,
} from '../existing-pipeline/clearpipe-existing-pipeline-representability.service';

const capabilities = {
  view: true,
  edit: true,
  save_as: true,
  version: false,
  run: true,
  compilation: true,
  execution: true,
  import: true,
  export: true,
  source: false,
  archive: true,
  delete: true,
};

const state = (graph: GraphV2): ClearpipeDefinitionState => ({
  definition: {
    id: 'existing-pipeline',
    task_id: 'existing-pipeline',
    name: 'Existing pipeline',
    revision: 7,
    schema_version: 2,
    nodes: [],
    edges: [],
    viewport: {x: 0, y: 0, zoom: 1},
  },
  graph,
  representation: 'clearpipe_graph_v2',
  capabilities,
});

describe('existing pipeline representability', () => {
  it('keeps a supported task pipeline byte-for-byte canonical and preserves identity metadata', () => {
    const graph = taskGraph();
    graph.document = {
      ...graph.document,
      id: 'existing-pipeline',
      revision: 7,
      project: 'research/.pipelines',
      version: '2.4.0',
    };

    const result = reviewExistingPipeline(state(graph));

    expect(result.status).toBe('editable');
    if (result.status !== 'editable') return;
    expect(serializeGraphV2(result.graph)).toBe(serializeGraphV2(graph));
    expect(result.graph.document).toEqual(graph.document);
    expect(result.visual.layout).toBe('preserved');
  });

  it('accepts the constrained code-backed subset without converting function source or ports', () => {
    const graph = functionGraph();

    const result = reviewExistingPipeline(state(graph));

    expect(result.status).toBe('editable');
    if (result.status !== 'editable') return;
    expect(result.graph.nodes).toEqual(graph.nodes);
    expect(result.graph.bindings).toEqual(graph.bindings);
  });

  it('names every mixed and lossy construct instead of exposing a partial canvas', () => {
    const task = taskNode('task-stage');
    const codeNode = functionGraph().nodes[0];
    const graph = graphFixture({nodes: [task, codeNode]});
    const mutableTask = taskNode('named-task', {
      base_task: {kind: 'task-name', project: 'research', name: 'mutable'},
    });
    const dynamicFunction = functionNode('dynamic-function', {
      source: '@decorator\ndef dynamic_function(value: int) -> int:\n    return value\n',
    });
    graph.nodes.push(mutableTask, dynamicFunction);

    const result = reviewExistingPipeline(state(graph));

    expect(result.status).toBe('unsupported');
    if (result.status !== 'unsupported') return;
    expect(result.blockers.map(blocker => blocker.code)).toEqual([
      'mixed_node_styles',
      'mutable_task_reference',
      'dynamic_function_source',
    ]);
    expect('graph' in result).toBeFalse();
  });

  it('creates only a deterministic visual fallback when legacy layout is absent', () => {
    const graph = taskGraph() as GraphV2 & {visual?: GraphV2['visual']};
    delete graph.visual;

    const visual = existingPipelineVisualMetadata(graph as GraphV2);

    expect(visual.layout).toBe('deterministic');
    expect(visual.graph.nodes.map(node => node.id)).toEqual(taskGraph().nodes.map(node => node.id));
    expect(visual.graph.bindings).toEqual(taskGraph().bindings);
    expect(visual.graph.visual).toEqual({viewport: {x: 0, y: 0}, zoom: 1});
    expect(visual.graph.nodes[1].visual.position).toEqual({x: 320, y: 0});
  });
});
