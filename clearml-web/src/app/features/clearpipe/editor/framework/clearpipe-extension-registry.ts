import {Injectable, signal} from '@angular/core';
import {GraphNode} from '../../domain/graph-v2.types';
import {
  ClearpipeCatalogActionAvailability,
  ClearpipeCatalogActionDispatchResult,
  ClearpipeCatalogActionRegistration,
  ClearpipeCatalogAddRequest,
  ClearpipeCatalogEntry,
  ClearpipeInspectorFormRegistration,
  ClearpipeNodeExtension,
  ClearpipeTypedNodeExtension,
} from './clearpipe-ui.types';

/**
 * A presentation-only extension registry. It never holds a graph, requests,
 * resource data, or execution state.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeExtensionRegistry {
  private readonly extensions = new Map<GraphNode['kind'], ClearpipeNodeExtension>();
  private readonly catalogActions = new Map<string, ClearpipeCatalogActionRegistration>();
  private readonly revisionState = signal(0);

  readonly revision = this.revisionState.asReadonly();

  register<TNode extends GraphNode>(extension: ClearpipeTypedNodeExtension<TNode>): () => void {
    const nodeKind = extension.nodeKind;
    if (this.extensions.has(nodeKind)) {
      throw new Error(`A ClearPipe extension is already registered for ${nodeKind}`);
    }
    this.extensions.set(nodeKind, extension as ClearpipeNodeExtension);
    this.revisionState.update((revision) => revision + 1);

    return () => {
      if (this.extensions.get(nodeKind) !== extension) return;
      this.extensions.delete(nodeKind);
      this.revisionState.update((revision) => revision + 1);
    };
  }

  get<TKind extends GraphNode['kind']>(
    nodeKind: TKind,
  ): ClearpipeTypedNodeExtension<Extract<GraphNode, {kind: TKind}>> | undefined {
    this.revisionState();
    return this.extensions.get(nodeKind) as ClearpipeTypedNodeExtension<Extract<GraphNode, {kind: TKind}>> | undefined;
  }

  catalogEntries(): readonly ClearpipeCatalogEntry[] {
    this.revisionState();
    return [...this.extensions.values()]
      .flatMap((extension) => extension.catalog ? [extension.catalog] : [])
      .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label));
  }

  registerCatalogAction(action: ClearpipeCatalogActionRegistration): () => void {
    if (this.catalogActions.has(action.catalogEntryId)) {
      throw new Error(`A ClearPipe catalog action is already registered for ${action.catalogEntryId}`);
    }
    this.catalogActions.set(action.catalogEntryId, action);
    this.revisionState.update((revision) => revision + 1);

    return () => {
      if (this.catalogActions.get(action.catalogEntryId) !== action) return;
      this.catalogActions.delete(action.catalogEntryId);
      this.revisionState.update((revision) => revision + 1);
    };
  }

  catalogActionAvailability(catalogEntryId: string): ClearpipeCatalogActionAvailability {
    this.revisionState();
    const action = this.catalogActions.get(catalogEntryId);
    if (!action) {
      return {
        available: false,
        reason: 'This authoring capability is not available in the current workspace.',
      };
    }
    try {
      return action.availability?.() ?? {available: true};
    } catch {
      return {
        available: false,
        reason: 'This authoring capability could not be prepared safely.',
      };
    }
  }

  async dispatchCatalogAction(
    request: ClearpipeCatalogAddRequest,
    options: {readonly readOnly: boolean},
  ): Promise<ClearpipeCatalogActionDispatchResult> {
    if (options.readOnly) {
      return {status: 'disabled', message: 'This definition is read-only.'};
    }
    const action = this.catalogActions.get(request.entry.id);
    if (!action) {
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
      await action.execute(request);
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
}
