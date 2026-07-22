import {Injectable, signal} from '@angular/core';
import {GraphNode} from '../../domain/graph-v2.types';
import {
  ClearpipeCatalogActionAvailability,
  ClearpipeCatalogActionDispatchResult,
  ClearpipeCatalogActionRegistration,
  ClearpipeCatalogActionRequest,
  ClearpipeCatalogEntry,
  ClearpipeInspectorFormRegistration,
  ClearpipeNodeExtension,
  ClearpipeTypedNodeExtension,
} from './clearpipe-ui.types';

interface RegisteredExtension {
  readonly extension: ClearpipeNodeExtension;
  readonly catalog?: ClearpipeCatalogEntry;
}

interface RegisteredCatalogAction {
  readonly extension: ClearpipeNodeExtension;
  readonly action: ClearpipeCatalogActionRegistration;
}

/**
 * A presentation-only extension registry. It never holds a graph, requests,
 * resource data, or execution state.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeExtensionRegistry {
  private readonly extensions = new Map<GraphNode['kind'], RegisteredExtension>();
  private readonly catalogActions = new Map<string, RegisteredCatalogAction>();
  private readonly revisionState = signal(0);
  private catalogRegistrationSequence = 0;

  readonly revision = this.revisionState.asReadonly();

  register<TNode extends GraphNode>(extension: ClearpipeTypedNodeExtension<TNode>): () => void {
    const nodeKind = extension.nodeKind;
    if (this.extensions.has(nodeKind)) {
      throw new Error(`A ClearPipe extension is already registered for ${nodeKind}`);
    }
    if (extension.catalog && this.catalogEntry(extension.catalog.id)) {
      throw new Error(`A ClearPipe catalog entry is already registered for ${extension.catalog.id}`);
    }
    const registeredExtension = extension as ClearpipeNodeExtension;
    const catalog = extension.catalog
      ? {...extension.catalog, registrationId: ++this.catalogRegistrationSequence}
      : undefined;
    this.extensions.set(nodeKind, {extension: registeredExtension, catalog});
    this.revisionState.update((revision) => revision + 1);

    return () => {
      if (this.extensions.get(nodeKind)?.extension !== extension) return;
      this.extensions.delete(nodeKind);
      if (catalog) this.catalogActions.delete(catalog.id);
      this.revisionState.update((revision) => revision + 1);
    };
  }

  get<TKind extends GraphNode['kind']>(
    nodeKind: TKind,
  ): ClearpipeTypedNodeExtension<Extract<GraphNode, {kind: TKind}>> | undefined {
    this.revisionState();
    return this.extensions.get(nodeKind)?.extension as ClearpipeTypedNodeExtension<Extract<GraphNode, {kind: TKind}>> | undefined;
  }

  catalogEntries(): readonly ClearpipeCatalogEntry[] {
    this.revisionState();
    return [...this.extensions.values()]
      .flatMap(({catalog}) => catalog ? [catalog] : [])
      .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label));
  }

  registerCatalogAction<TNode extends GraphNode>(
    extension: ClearpipeTypedNodeExtension<TNode>,
    action: ClearpipeCatalogActionRegistration,
  ): () => void {
    const owner = this.extensions.get(extension.nodeKind);
    if (owner?.extension !== extension || owner.catalog?.id !== action.catalogEntryId) {
      throw new Error(`A ClearPipe catalog action must belong to its active catalog extension: ${action.catalogEntryId}`);
    }
    if (this.catalogActions.has(action.catalogEntryId)) {
      throw new Error(`A ClearPipe catalog action is already registered for ${action.catalogEntryId}`);
    }
    const registeredAction = {extension: owner.extension, action};
    this.catalogActions.set(action.catalogEntryId, registeredAction);
    this.revisionState.update((revision) => revision + 1);

    return () => {
      if (this.catalogActions.get(action.catalogEntryId) !== registeredAction) return;
      this.catalogActions.delete(action.catalogEntryId);
      this.revisionState.update((revision) => revision + 1);
    };
  }

  catalogActionAvailability(catalogEntryId: string): ClearpipeCatalogActionAvailability {
    this.revisionState();
    const action = this.catalogActions.get(catalogEntryId);
    const entry = this.catalogEntry(catalogEntryId);
    if (!action || !entry || action.extension !== this.extensions.get(entry.nodeKind)?.extension) {
      return {
        available: false,
        reason: 'This authoring capability is not available in the current workspace.',
      };
    }
    try {
      return action.action.availability?.() ?? {available: true};
    } catch {
      return {
        available: false,
        reason: 'This authoring capability could not be prepared safely.',
      };
    }
  }

  async dispatchCatalogAction(
    request: ClearpipeCatalogActionRequest,
    options: {readonly readOnly: boolean},
  ): Promise<ClearpipeCatalogActionDispatchResult> {
    if (options.readOnly) {
      return {status: 'disabled', message: 'This definition is read-only.'};
    }
    const entry = this.catalogEntry(request.entry.id);
    const action = this.catalogActions.get(request.entry.id);
    if (!entry || entry.registrationId !== request.entry.registrationId || !action
      || action.extension !== this.extensions.get(entry.nodeKind)?.extension) {
      return {
        status: 'missing',
        message: 'This authoring capability is not available in the current workspace.',
      };
    }
    const availability = this.catalogActionAvailability(request.entry.id);
    if (!availability.available) {
      return {
        status: 'disabled',
        message: availability.reason ?? 'This authoring capability is currently unavailable.',
      };
    }
    try {
      await action.action.execute({...request, entry});
      return {status: 'dispatched'};
    } catch {
      return {
        status: 'failed',
        message: 'This authoring capability could not be started. Try again or choose another capability.',
      };
    }
  }

  formFor<TNode extends GraphNode>(node: TNode): ClearpipeInspectorFormRegistration<TNode> | undefined {
    const extension = this.get(node.kind);
    return extension?.form as ClearpipeInspectorFormRegistration<TNode> | undefined;
  }

  catalogEntry(id: string): ClearpipeCatalogEntry | undefined {
    this.revisionState();
    return [...this.extensions.values()].find(({catalog}) => catalog?.id === id)?.catalog;
  }
}
