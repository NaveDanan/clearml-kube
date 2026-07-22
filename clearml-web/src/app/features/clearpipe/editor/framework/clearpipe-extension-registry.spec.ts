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

  it('dispatches feature-owned catalog actions and unregisters them without mutating graph state', async () => {
    const registry = new ClearpipeExtensionRegistry();
    const execute = jasmine.createSpy('execute');
    const unregister = registry.registerCatalogAction({
      catalogEntryId: 'task',
      execute,
    });

    await expectAsync(registry.dispatchCatalogAction({
      entry: clearpipeFixtureTaskExtension.catalog!,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo({status: 'dispatched'});
    expect(execute).toHaveBeenCalledWith(jasmine.objectContaining({
      entry: jasmine.objectContaining({id: 'task'}),
      method: 'click',
    }));

    unregister();
    await expectAsync(registry.dispatchCatalogAction({
      entry: clearpipeFixtureTaskExtension.catalog!,
      method: 'keyboard',
    }, {readOnly: false})).toBeResolvedTo(jasmine.objectContaining({status: 'missing'}));
  });

  it('fails disabled, read-only, and throwing catalog actions safely', async () => {
    const registry = new ClearpipeExtensionRegistry();
    const disabled = jasmine.createSpy('disabled');
    registry.registerCatalogAction({
      catalogEntryId: 'task',
      availability: () => ({available: false, reason: 'Task authoring is unavailable.'}),
      execute: disabled,
    });

    await expectAsync(registry.dispatchCatalogAction({
      entry: clearpipeFixtureTaskExtension.catalog!,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo({status: 'disabled', message: 'Task authoring is unavailable.'});
    await expectAsync(registry.dispatchCatalogAction({
      entry: clearpipeFixtureTaskExtension.catalog!,
      method: 'click',
    }, {readOnly: true})).toBeResolvedTo({status: 'disabled', message: 'This definition is read-only.'});
    expect(disabled).not.toHaveBeenCalled();

    const failedRegistry = new ClearpipeExtensionRegistry();
    failedRegistry.registerCatalogAction({
      catalogEntryId: 'task',
      execute: () => { throw new Error('feature failure'); },
    });
    await expectAsync(failedRegistry.dispatchCatalogAction({
      entry: clearpipeFixtureTaskExtension.catalog!,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo(jasmine.objectContaining({
      status: 'failed',
      message: jasmine.stringMatching(/could not be started/i),
    }));
  });
});
