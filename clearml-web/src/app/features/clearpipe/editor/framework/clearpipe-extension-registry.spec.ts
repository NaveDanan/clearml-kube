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
    const unregisterExtension = registry.register(clearpipeFixtureTaskExtension);
    const entry = registry.catalogEntry('task')!;
    const unregister = registry.registerCatalogAction(clearpipeFixtureTaskExtension, {
      catalogEntryId: 'task',
      execute,
    });

    await expectAsync(registry.dispatchCatalogAction({
      entry,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo({status: 'dispatched'});
    expect(execute).toHaveBeenCalledWith(jasmine.objectContaining({
      entry: jasmine.objectContaining({id: 'task'}),
      method: 'click',
    }));

    unregister();
    await expectAsync(registry.dispatchCatalogAction({
      entry,
      method: 'keyboard',
    }, {readOnly: false})).toBeResolvedTo(jasmine.objectContaining({status: 'missing'}));
    unregisterExtension();
  });

  it('fails disabled, read-only, and throwing catalog actions safely', async () => {
    const registry = new ClearpipeExtensionRegistry();
    const disabled = jasmine.createSpy('disabled');
    const unregisterExtension = registry.register(clearpipeFixtureTaskExtension);
    const entry = registry.catalogEntry('task')!;
    registry.registerCatalogAction(clearpipeFixtureTaskExtension, {
      catalogEntryId: 'task',
      availability: () => ({available: false, reason: 'Task authoring is unavailable.'}),
      execute: disabled,
    });

    await expectAsync(registry.dispatchCatalogAction({
      entry,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo({status: 'disabled', message: 'Task authoring is unavailable.'});
    await expectAsync(registry.dispatchCatalogAction({
      entry,
      method: 'click',
    }, {readOnly: true})).toBeResolvedTo({status: 'disabled', message: 'This definition is read-only.'});
    expect(disabled).not.toHaveBeenCalled();
    unregisterExtension();

    const failedRegistry = new ClearpipeExtensionRegistry();
    failedRegistry.register(clearpipeFixtureTaskExtension);
    const failedEntry = failedRegistry.catalogEntry('task')!;
    failedRegistry.registerCatalogAction(clearpipeFixtureTaskExtension, {
      catalogEntryId: 'task',
      execute: () => { throw new Error('feature failure'); },
    });
    await expectAsync(failedRegistry.dispatchCatalogAction({
      entry: failedEntry,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo(jasmine.objectContaining({
      status: 'failed',
      message: jasmine.stringMatching(/could not be started/i),
    }));
  });

  it('keeps catalog entry IDs unique and disposes actions when their extension is removed', async () => {
    const registry = new ClearpipeExtensionRegistry();
    const unregister = registry.register(clearpipeFixtureTaskExtension);
    const staleEntry = registry.catalogEntry('task')!;
    const execute = jasmine.createSpy('execute');
    registry.registerCatalogAction(clearpipeFixtureTaskExtension, {catalogEntryId: 'task', execute});
    const conflictingFunctionExtension = {
      ...clearpipeFixtureFunctionExtension,
      catalog: {...clearpipeFixtureFunctionExtension.catalog!, id: 'task'},
    };

    expect(() => registry.register(conflictingFunctionExtension)).toThrowError(/catalog entry is already registered/);

    unregister();
    expect(registry.catalogActionAvailability('task').available).toBeFalse();
    await expectAsync(registry.dispatchCatalogAction({
      entry: staleEntry,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo(jasmine.objectContaining({status: 'missing'}));
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not dispatch a stale catalog registration after an entry ID is reused', async () => {
    const registry = new ClearpipeExtensionRegistry();
    const unregisterFirst = registry.register(clearpipeFixtureTaskExtension);
    const staleEntry = registry.catalogEntry('task')!;
    unregisterFirst();

    registry.register(clearpipeFixtureTaskExtension);
    const execute = jasmine.createSpy('execute');
    registry.registerCatalogAction(clearpipeFixtureTaskExtension, {catalogEntryId: 'task', execute});
    await expectAsync(registry.dispatchCatalogAction({
      entry: staleEntry,
      method: 'click',
    }, {readOnly: false})).toBeResolvedTo(jasmine.objectContaining({status: 'missing'}));
    expect(execute).not.toHaveBeenCalled();
  });
});
