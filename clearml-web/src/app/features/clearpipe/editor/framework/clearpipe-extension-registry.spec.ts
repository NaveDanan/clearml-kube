import {ClearpipeExtensionRegistry} from './clearpipe-extension-registry';
import {clearpipeFixtureFunctionExtension, clearpipeFixtureTaskExtension, clearpipeFixtureTaskNode} from './clearpipe-ui.fixtures';

describe('ClearpipeExtensionRegistry', () => {
  it('registers typed task and function presentation extensions without graph state', () => {
    const registry = new ClearpipeExtensionRegistry();
    const unregisterTask = registry.register(clearpipeFixtureTaskExtension);
    const unregisterFunction = registry.register(clearpipeFixtureFunctionExtension);

    expect(registry.catalogEntries().map((entry) => entry.id)).toEqual(['function', 'task']);
    expect(registry.get('task')?.summarize?.(clearpipeFixtureTaskNode)).toEqual({text: 'Base task: base-training-task'});
    expect(registry.formFor(clearpipeFixtureTaskNode)).toBeUndefined();
    expect(() => registry.register(clearpipeFixtureTaskExtension)).toThrowError(/already registered/);

    unregisterTask();
    unregisterFunction();
    expect(registry.catalogEntries()).toEqual([]);
  });
});
