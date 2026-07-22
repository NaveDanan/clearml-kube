import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {ClearpipeApiService} from './clearpipe-api.service';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {HTTP} from '~/app.constants';
import {emptyClearpipeDefinition} from './clearpipe.models';
import {GraphV2} from './domain/graph-v2.types';

describe('ClearpipeApiService', () => {
  let api: ClearpipeApiService;
  let requests: jasmine.SpyObj<SmApiRequestsService>;

  beforeEach(() => {
    HTTP.API_BASE_URL_NO_VERSION = '/service/1/api';
    HTTP.API_BASE_URL = '/service/1/api/v999.0';
    requests = jasmine.createSpyObj<SmApiRequestsService>('SmApiRequestsService', ['post']);
    TestBed.configureTestingModule({providers: [ClearpipeApiService, {provide: SmApiRequestsService, useValue: requests}]});
    api = TestBed.inject(ClearpipeApiService);
  });

  it('uses the v2.35 get_all contract and normalizes definitions', () => {
    requests.post.and.returnValue(of({definitions: [{id: 'p1', name: 'Pipe', revision: 2, graph: {nodes: [], edges: []}}], total: 1}));
    api.getAll('pipe', true).subscribe(result => expect(result[0].task_id).toBe('p1'));
    expect(requests.post).toHaveBeenCalledWith('/service/1/api/v2.35/clearpipe.get_all', jasmine.objectContaining({search: 'pipe', include_archived: true, page: 0, page_size: 500}));
  });

  it('sends exact update, validation and start DTO field names', () => {
    const definition = {...emptyClearpipeDefinition(), id: 'p1', task_id: 'p1', revision: 3, name: 'Pipe'};
    requests.post.and.returnValues(
      of({updated: 1, revision: 4, definition: {...definition, graph: {nodes: [], edges: []}}}),
      of({valid: false, issues: [{message: 'Missing queue', severity: 'error'}]}),
      of({task: 'run-1', enqueued: true}),
    );
    api.update(definition).subscribe(result => expect(result.revision).toBe(4));
    expect(requests.post.calls.argsFor(0)[1]).toEqual(jasmine.objectContaining({task: 'p1', revision: 3, graph: jasmine.any(Object)}));
    api.validate(definition).subscribe(result => expect(result.errors[0].message).toBe('Missing queue'));
    expect(requests.post.calls.argsFor(1)[1]).toEqual({graph: jasmine.any(Object)});
    api.start('p1', 'q1', {epochs: 5}, 3).subscribe(result => expect(result.run_task_id).toBe('run-1'));
    expect(requests.post.calls.argsFor(2)[1]).toEqual({task: 'p1', revision: 3, queue: 'q1', parameters: {epochs: 5}, verify_watched_queue: true});
  });

  it('uses task and revision for archive/delete and maps script parameters', () => {
    requests.post.and.returnValues(of({updated: 1, revision: 5}), of({deleted: true}), of({valid: true, parameters: [{name: 'epochs'}]}));
    api.archive('p1', true, 4).subscribe();
    api.delete('p1', 5).subscribe();
    api.parseScript('print(1)', 'train.py').subscribe(result => expect(result.parameters.length).toBe(1));
    expect(requests.post.calls.argsFor(0)[1]).toEqual({task: 'p1', revision: 4});
    expect(requests.post.calls.argsFor(1)[1]).toEqual({task: 'p1', revision: 5});
    expect(requests.post.calls.argsFor(2)[1]).toEqual({script: 'print(1)', filename: 'train.py'});
  });

  it('requests and normalizes only safe task-selection metadata', () => {
    requests.post.and.returnValue(of({
      tasks: [{
        id: 'task-1',
        name: 'Training',
        project: {name: 'Research'},
        type: 'training',
        status: 'completed',
        tags: ['baseline'],
        system_tags: ['archived'],
        last_update: '2026-07-22T15:00:00Z',
        execution: {queue: 'must-not-be-returned'},
        hyperparams: {params: 'must-not-be-returned'},
        script: {repository: 'must-not-be-returned'},
      }],
    }));

    let resources: unknown;
    api.getResources('task').subscribe(result => resources = result);

    expect(requests.post).toHaveBeenCalledWith('/service/1/api/v999.0/tasks.get_all', {
      page: 0,
      page_size: 500,
      only_fields: ['id', 'name', 'project', 'type', 'status', 'tags', 'system_tags', 'last_update'],
    });
    expect(resources).toEqual([{
      id: 'task-1',
      name: 'Training',
      project: 'Research',
      type: 'task',
      taskType: 'training',
      taskStatus: 'completed',
      taskUserTags: ['baseline'],
      taskSystemTags: ['archived'],
      taskLastUpdatedAt: '2026-07-22T15:00:00Z',
    }]);
    expect(JSON.stringify(resources)).not.toContain('must-not-be-returned');
  });

  it('covers each typed CP-07 operation with the v2.35 contract envelopes', () => {
    const graph: GraphV2 = {
      schema_version: 2,
      document: {name: 'Pipe', project: '.pipelines/Pipe', tags: []},
      settings: {},
      parameters: [],
      resources: [],
      outputs: [],
      nodes: [],
      bindings: [],
      visual: {viewport: {x: 0, y: 0}, zoom: 1},
    };
    const responseDefinition = {
      id: 'p1',
      name: 'Pipe',
      revision: 2,
      graph,
      representation: 'clearpipe_graph_v2',
      capabilities: {view: true, edit: true, run: true},
    };
    requests.post.and.returnValues(
      of({definitions: [responseDefinition], total: 1}),
      of({id: 'p1', revision: 1, definition: responseDefinition}),
      of({updated: 1, revision: 3, definition: responseDefinition}),
      of({valid: true, issues: [], pipeline: {steps: []}}),
      of({task: 'run-1', enqueued: true, queue_watched: false}),
      of({updated: 1, revision: 4}),
      of({deleted: true}),
      of({valid: true, parameters: [], environment: ['python=3.11'], imports: ['clearml'], line_count: 1}),
    );

    api.listDefinitions({page: -1, page_size: 1000, tags: ['clearpipe']}).subscribe(result => {
      expect(result.total).toBe(1);
      expect(result.definitions[0].representation).toBe('clearpipe_graph_v2');
    });
    api.createDefinition({name: 'Pipe', graph}).subscribe(result => expect(result.definition.task_id).toBe('p1'));
    api.updateDefinition({task: 'p1', revision: 2, name: 'Pipe', graph}).subscribe();
    api.validateDefinition({task: 'p1'}).subscribe(result => expect(result.pipeline).toEqual({steps: []}));
    api.startDefinition({task: 'p1', revision: 3, node_queues: {node: 'queue'}, parameters: {epochs: 5}}).subscribe(result => {
      expect(result).toEqual({run_task_id: 'run-1', enqueued: true, queue_watched: false});
    });
    api.archiveDefinition('p1', 3).subscribe(result => expect(result.revision).toBe(4));
    api.deleteDefinition('p1', 4, true).subscribe(result => expect(result.deleted).toBeTrue());
    api.parseScriptDefinition('print(1)', 'pipe.py').subscribe(result => expect(result.environment).toEqual(['python=3.11']));

    expect(requests.post.calls.argsFor(0)).toEqual([
      '/service/1/api/v2.35/clearpipe.get_all',
      jasmine.objectContaining({page: 0, page_size: 500, tags: ['clearpipe']}),
    ]);
    expect(requests.post.calls.argsFor(1)[0]).toBe('/service/1/api/v2.35/clearpipe.create');
    expect(requests.post.calls.argsFor(2)[1]).toEqual(jasmine.objectContaining({task: 'p1', revision: 2, graph}));
    expect(requests.post.calls.argsFor(3)[1]).toEqual({task: 'p1'});
    expect(requests.post.calls.argsFor(4)[1]).toEqual(jasmine.objectContaining({
      task: 'p1',
      revision: 3,
      node_queues: {node: 'queue'},
      parameters: {epochs: 5},
    }));
    expect(requests.post.calls.argsFor(5)[1]).toEqual({task: 'p1', revision: 3});
    expect(requests.post.calls.argsFor(6)[1]).toEqual({task: 'p1', revision: 4, force: true});
    expect(requests.post.calls.argsFor(7)[1]).toEqual({script: 'print(1)', filename: 'pipe.py'});
  });

  it('uses safe typed task-descriptor and execution-snapshot DTOs without retaining raw task data', () => {
    requests.post.and.returnValues(
      of({
        status: 'stale',
        descriptor: {
          identity: {task_id: 'base-1'},
          context: {
            name: 'Base task',
            type: 'training',
            status: 'completed',
            project_id: 'project-1',
            project_name: 'Research',
            updated_at: '2026-07-22T16:00:00Z',
          },
          parameters: [
            {section: 'Args', name: 'epochs', type: 'int', default: '10'},
            {section: 'Args', name: 'api_key', type: 'str', default: 'token-value'},
          ],
          artifacts: [{id: 'metrics', name: 'metrics', type: 'json', direction: 'output', uri: 'https://example.invalid?token=token-value'}],
          configuration: {source: 'must-not-be-retained'},
          script: {diff: 'must-not-be-retained'},
        },
      }),
      of({
        status: 'available',
        snapshot: {
          run_task_id: 'run-1',
          definition_task_id: 'definition-1',
          definition_revision: 4,
          graph_digest: 'sha256:digest',
          controller: {task_id: 'run-1', status: 'in_progress'},
          nodes: [{
            graph_node_id: 'node-1',
            pipeline_step_name: 'step_1',
            record_status: 'available',
            task_id: 'child-1',
            status: 'completed',
            result: 'success',
            log_task_id: 'child-1',
            artifacts: [{id: 'result', name: 'result', direction: 'output', uri: 'https://example.invalid?token=token-value'}],
            output_error: 'token-value',
            source: 'must-not-be-retained',
          }],
          configuration: {ClearPipeRuntime: 'must-not-be-retained'},
        },
      }),
    );

    let descriptor: unknown;
    let snapshot: unknown;
    api.taskDescriptor('base-1', '2026-07-22T15:00:00Z').subscribe(result => descriptor = result);
    api.executionSnapshot({
      run: 'run-1',
      definition_revision: 4,
      graph_digest: 'sha256:digest',
    }).subscribe(result => snapshot = result);

    expect(requests.post.calls.argsFor(0)).toEqual([
      '/service/1/api/v2.35/clearpipe.task_descriptor',
      {task: 'base-1', known_updated_at: '2026-07-22T15:00:00Z'},
    ]);
    expect(requests.post.calls.argsFor(1)).toEqual([
      '/service/1/api/v2.35/clearpipe.execution_snapshot',
      {run: 'run-1', definition_revision: 4, graph_digest: 'sha256:digest'},
    ]);
    expect(descriptor).toEqual(jasmine.objectContaining({
      status: 'stale',
      descriptor: jasmine.objectContaining({
        identity: {task_id: 'base-1'},
        parameters: [
          {section: 'Args', name: 'epochs', type: 'int', default: '10'},
          {section: 'Args', name: 'api_key', type: 'str'},
        ],
      }),
    }));
    expect(snapshot).toEqual(jasmine.objectContaining({
      status: 'available',
      snapshot: jasmine.objectContaining({
        run_task_id: 'run-1',
        nodes: [jasmine.objectContaining({
          graph_node_id: 'node-1',
          task_id: 'child-1',
          record_status: 'available',
          result: 'success',
        })],
      }),
    }));
    const encoded = JSON.stringify({descriptor, snapshot});
    expect(encoded).not.toContain('token-value');
    expect(encoded).not.toContain('must-not-be-retained');
    expect(encoded).not.toContain('output_error');
    expect(encoded).not.toContain('uri');
  });
});
