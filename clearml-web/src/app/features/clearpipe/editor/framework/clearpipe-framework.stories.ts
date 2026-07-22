import {
  clearpipeFixtureCatalogEntries,
  clearpipeFixtureFailedFunctionCard,
  clearpipeFixtureInspector,
  clearpipeFixtureRunningTaskCard,
} from './clearpipe-ui.fixtures';
import {ClearpipeCatalogPresentation, ClearpipeInspectorPresentation, ClearpipeNodeCardPresentation} from './clearpipe-ui.types';

/**
 * Repository-native visual fixture data. It is intentionally framework-neutral
 * because this application does not include a Storybook target.
 */
export interface ClearpipeFrameworkStory {
  readonly name: string;
  readonly catalog: {
    readonly entries: typeof clearpipeFixtureCatalogEntries;
    readonly presentation: ClearpipeCatalogPresentation;
  };
  readonly cards: readonly ClearpipeNodeCardPresentation[];
  readonly inspector: ClearpipeInspectorPresentation;
}

export const CLEARPIPE_FRAMEWORK_STORIES: readonly ClearpipeFrameworkStory[] = [
  {
    name: 'Task, function, invalid, running, failed, and unavailable states',
    catalog: {entries: clearpipeFixtureCatalogEntries, presentation: {state: 'ready'}},
    cards: [clearpipeFixtureRunningTaskCard, clearpipeFixtureFailedFunctionCard],
    inspector: clearpipeFixtureInspector,
  },
  {
    name: 'Catalog loading state',
    catalog: {entries: clearpipeFixtureCatalogEntries, presentation: {state: 'loading', message: 'Loading authorized starts.'}},
    cards: [],
    inspector: clearpipeFixtureInspector,
  },
  {
    name: 'Catalog unavailable state',
    catalog: {entries: [], presentation: {state: 'disabled', message: 'Authoring is unavailable for this definition.'}},
    cards: [],
    inspector: clearpipeFixtureInspector,
  },
];
