import {of} from 'rxjs';
import {ClearpipeResourceOption} from '../clearpipe.models';
import {ClearpipeAdapterOutcome} from '../platform/clearpipe-adapter.service';
import {
  clearpipeResourceReference,
  isSafeCredentialReference,
  normalizeClearpipeResource,
} from './clearpipe-resource.models';
import {
  ClearpipeAuthorizedResourceGateway,
  ClearpipeResourceQueryController,
  ClearpipeResourceResolver,
} from './clearpipe-resource-query.service';
import {ClearpipeResourceSelectorComponent} from './clearpipe-resource-selector.component';
import {ClearpipeCredentialSelectorComponent} from './clearpipe-credential-selector.component';

describe('ClearpipeResourceQueryController', () => {
  let gateway: jasmine.SpyObj<ClearpipeAuthorizedResourceGateway>;
  let controller: ClearpipeResourceQueryController;

  const resource = (id: string, name: string, project = 'project-a'): ClearpipeResourceOption => ({
    id,
    name,
    project,
    type: 'task',
  });

  const ready = (items: ClearpipeResourceOption[]): ClearpipeAdapterOutcome<ClearpipeResourceOption[]> => ({
    status: 'ready',
    data: items,
  });

  const failure = (message = 'request failed'): ClearpipeAdapterOutcome<ClearpipeResourceOption[]> => ({
    status: 'failed',
    problem: {message, retryable: true},
  });

  beforeEach(() => {
    gateway = jasmine.createSpyObj<ClearpipeAuthorizedResourceGateway>('ClearpipeAuthorizedResourceGateway', ['resources', 'routeFor']);
    gateway.routeFor.and.returnValue(['/projects', '*', 'tasks', 'task-1']);
    controller = new ClearpipeResourceQueryController('task', gateway);
  });

  it('searches authorized summaries locally and incrementally reveals pages without a second client call', () => {
    gateway.resources.and.returnValue(of(ready([
      resource('task-3', 'Zulu'),
      resource('task-2', 'Beta'),
      resource('task-1', 'Alpha'),
    ])));

    controller.load({pageSize: 2});

    expect(controller.state().status).toBe('ready');
    expect(controller.state().items.map(item => item.id)).toEqual(['task-1', 'task-2']);
    expect(controller.state().hasMore).toBeTrue();
    controller.loadMore();
    expect(controller.state().items.map(item => item.id)).toEqual(['task-1', 'task-2', 'task-3']);
    expect(gateway.resources).toHaveBeenCalledTimes(1);

    controller.setFilter({search: 'beta'});
    expect(controller.state().items.map(item => item.id)).toEqual(['task-2']);
    expect(gateway.resources).toHaveBeenCalledTimes(1);
  });

  it('reports an explicit empty state when search has no authorized result', () => {
    gateway.resources.and.returnValue(of(ready([resource('task-1', 'Alpha')])));

    controller.load();
    controller.setFilter({search: 'not-present'});

    expect(controller.state().status).toBe('empty');
    expect(controller.state().items).toEqual([]);
    expect(controller.state().total).toBe(0);
    expect(gateway.resources).toHaveBeenCalledTimes(1);
  });

  it('keeps canonical selection and CP-11 resolution valid when local filters hide a resource', () => {
    gateway.resources.and.returnValue(of(ready([
      resource('task-1', 'Alpha', 'project-a'),
      resource('task-2', 'Beta', 'project-b'),
    ])));
    controller.load();
    const resolver = new ClearpipeResourceResolver(() => controller);
    const selector = new ClearpipeResourceSelectorComponent();
    selector.controller = controller;

    selector.search('beta');
    expect(controller.state().items.map(item => item.id)).toEqual(['task-2']);
    controller.setFilter({search: 'beta', project: 'project-b'});
    controller.setFilter({search: 'alpha', tags: ['not-present']});
    expect(controller.state().status).toBe('empty');
    expect(controller.selection('task-1')).toEqual(jasmine.objectContaining({status: 'selected'}));
    expect(resolver.resolve({kind: 'task', resource_id: 'task-1'})).toEqual({status: 'available'});

    controller.setFilter({search: 'a'});
    controller.setFilter({search: 'al'});
    controller.setFilter({search: 'alp'});
    expect(gateway.resources).toHaveBeenCalledTimes(1);
  });

  it('keeps transient failures retryable without retaining adapter error text', () => {
    gateway.resources.and.returnValues(
      of(failure('token-value must never be shown')),
      of(ready([resource('task-1', 'Alpha')]))
    );

    controller.load();

    expect(controller.state().status).toBe('error');
    expect(controller.state().problem).toEqual({code: 'request_failed', retryable: true});
    expect(JSON.stringify(controller.state())).not.toContain('token-value');

    controller.retry();
    expect(controller.state().status).toBe('ready');
    expect(controller.state().items[0].id).toBe('task-1');
    expect(gateway.resources).toHaveBeenCalledTimes(2);
  });

  it('keeps retryable resource-unavailable outcomes actionable while unsupported kinds remain terminal', () => {
    gateway.resources.and.returnValues(
      of({
        status: 'resource_unavailable',
        problem: {message: 'temporary outage', retryable: true},
      }),
      of(ready([resource('task-1', 'Alpha')])),
      of({
        status: 'resource_unavailable',
        problem: {message: 'temporary outage', retryable: true},
      })
    );

    controller.load();
    expect(controller.state().status).toBe('error');
    expect(controller.state().problem).toEqual({code: 'unavailable', retryable: true});
    controller.retry();
    expect(controller.state().status).toBe('ready');
    expect(gateway.resources).toHaveBeenCalledTimes(2);
    controller.refresh();
    expect(controller.state().status).toBe('stale');
    expect(controller.state().problem).toEqual({code: 'unavailable', retryable: true});
    expect(gateway.resources).toHaveBeenCalledTimes(3);

    const unsupported = new ClearpipeResourceQueryController('template', gateway);
    unsupported.load();
    expect(unsupported.state().status).toBe('unavailable');
    expect(unsupported.state().problem).toEqual({code: 'unsupported', retryable: false});
    expect(gateway.resources).toHaveBeenCalledTimes(3);
  });

  it('fails closed on denied inventory and only exposes links for returned authorized resources', () => {
    gateway.resources.and.returnValue(of({
      status: 'denied_or_missing',
      problem: {message: 'private-task', retryable: false},
    }));

    controller.load();

    expect(controller.state().status).toBe('denied');
    expect(controller.state().items).toEqual([]);
    expect(JSON.stringify(controller.state())).not.toContain('private-task');

    gateway.resources.and.returnValue(of(ready([resource('task-1', 'Alpha')])));
    controller.retry();
    const link = controller.managementLink(controller.state().items[0]);
    expect(link?.commands).toEqual(['/projects', '*', 'tasks', 'task-1']);
  });

  it('retains confirmed summaries as stale after refresh failure and represents known deletion explicitly', () => {
    gateway.resources.and.returnValues(
      of(ready([resource('task-1', 'Alpha'), resource('task-2', 'Beta')])),
      of(failure())
    );
    controller.load();
    controller.refresh();

    expect(controller.state().status).toBe('stale');
    expect(controller.state().items.map(item => item.id)).toEqual(['task-1', 'task-2']);

    controller.markDeleted('task-1');
    expect(controller.state().status).toBe('deleted');
    expect(controller.selection('task-1').status).toBe('deleted');
    expect(controller.resolve({kind: 'task', resource_id: 'task-2'})).toEqual({status: 'available'});
    expect(controller.resolve({kind: 'task', resource_id: 'task-1'})).toEqual({status: 'missing'});
  });

  it('provides CP-11 resolver status from cached data without triggering network activity', () => {
    gateway.resources.and.returnValue(of(ready([resource('task-1', 'Alpha')])));
    controller.load();
    const resolver = new ClearpipeResourceResolver(() => controller);
    const callsBeforeResolve = gateway.resources.calls.count();

    expect(resolver.resolve({kind: 'task', resource_id: 'task-1'})).toEqual({status: 'available'});
    expect(resolver.resolve({kind: 'task', resource_id: 'missing'})).toEqual({status: 'missing'});
    expect(gateway.resources.calls.count()).toBe(callsBeforeResolve);
  });

  it('emits only safe server IDs and opaque credential references for graph/form payloads', () => {
    const summary = normalizeClearpipeResource('task', {
      id: 'task-1',
      name: 'Alpha',
      project: 'project-a',
    });

    const payload = JSON.stringify({resources: [clearpipeResourceReference(summary)]});

    expect(payload).toContain('task-1');
    expect(payload).not.toContain('token-value');
    expect(payload).not.toContain('password');
    expect(isSafeCredentialReference({reference: 'credential-reference-1', label: 'Configured credential'})).toBeTrue();
    expect(isSafeCredentialReference({reference: 'api-key-inline-value', label: 'Unsafe'})).toBeFalse();
  });

  it('normalizes task metadata without replacing the resource kind or resolver inventory', () => {
    gateway.resources.and.returnValue(of(ready([{
      ...resource('task-1', 'Training'),
      taskType: 'training',
      taskStatus: 'completed',
      taskUserTags: ['baseline'],
      taskSystemTags: ['archived'],
      taskLastUpdatedAt: '2026-07-22T15:00:00Z',
    }])));

    controller.load();

    expect(controller.state().items).toEqual([jasmine.objectContaining({
      id: 'task-1',
      kind: 'task',
      type: 'training',
      status: 'completed',
      tags: ['baseline', 'archived'],
      taskUserTags: ['baseline'],
      taskSystemTags: ['archived'],
      updatedAt: '2026-07-22T15:00:00Z',
    })]);
    controller.setFilter({tags: ['archived']});
    expect(controller.state().items.map(item => item.id)).toEqual(['task-1']);
    expect(controller.resolve({kind: 'task', resource_id: 'task-1'})).toEqual({status: 'available'});
  });

  it('publishes standalone selector components for downstream inspector consumers', () => {
    expect(ClearpipeResourceSelectorComponent).toBeDefined();
    expect(ClearpipeCredentialSelectorComponent).toBeDefined();
  });
});
