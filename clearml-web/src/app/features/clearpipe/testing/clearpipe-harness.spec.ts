import {ClearpipeAdapterFake} from './clearpipe-adapter.fake';
import {DeterministicClock, DeterministicIds, fixtureDefinition, functionGraph, invalidGraphs} from './clearpipe-fixtures';

describe('ClearPipe test harness', () => {
  it('CP09-browser-determinism keeps graph fixtures isolated and scenario names stable', () => {
    const first = functionGraph();
    const second = functionGraph();
    first.nodes[0].label = 'Changed';

    expect(second.nodes[0].label).toBe('Normalize');
    expect(invalidGraphs().map(scenario => scenario.name)).toEqual([
      'duplicate-node-name',
      'cycle',
      'unknown-port',
      'embedded-secret',
      'unsupported-schema',
    ]);
  });

  it('CP09-browser-adapter records deterministic revision and execution outcomes', async () => {
    const adapter = new ClearpipeAdapterFake({
      definitions: [fixtureDefinition()],
      ids: new DeterministicIds(),
      clock: new DeterministicClock(),
    });

    const update = await adapter.update('definition-0001', 1, functionGraph());
    expect(update.ok).toBeTrue();
    if (update.ok === false) {
      throw new Error(update.error.message);
    }
    expect(update.value.revision).toBe(2);

    const run = await adapter.start('definition-0001', update.value.revision, 'cp09-queue');
    expect(run.ok).toBeTrue();
    if (run.ok === false) {
      throw new Error(run.error.message);
    }
    expect(run.value).toEqual(jasmine.objectContaining({runId: 'run-0001', state: 'queued'}));
    expect(adapter.calls.map(call => call.operation)).toEqual(['update', 'start']);
  });

  it('CP09-browser-adapter expresses stale revisions and scripted failures without a production client', async () => {
    const adapter = new ClearpipeAdapterFake({definitions: [fixtureDefinition()]});

    const stale = await adapter.update('definition-0001', 0, functionGraph());
    expect(stale).toEqual(jasmine.objectContaining({ok: false, error: jasmine.objectContaining({kind: 'stale-revision'})}));

    adapter.failNext('load', {kind: 'resource-unavailable', message: 'Resource query failed'});
    const unavailable = await adapter.load('definition-0001');
    expect(unavailable).toEqual(jasmine.objectContaining({ok: false, error: jasmine.objectContaining({kind: 'resource-unavailable'})}));
  });
});
