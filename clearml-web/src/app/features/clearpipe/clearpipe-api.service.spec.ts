import {TestBed} from '@angular/core/testing';
import {of} from 'rxjs';
import {ClearpipeApiService} from './clearpipe-api.service';
import {SmApiRequestsService} from '~/business-logic/api-services/api-requests.service';
import {HTTP} from '~/app.constants';
import {emptyClearpipeDefinition} from './clearpipe.models';

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
});
