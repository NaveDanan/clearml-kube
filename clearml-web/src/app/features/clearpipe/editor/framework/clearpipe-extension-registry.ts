import {Injectable, signal} from '@angular/core';
import {GraphNode} from '../../domain/graph-v2.types';
import {
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

  formFor<TNode extends GraphNode>(node: TNode): ClearpipeInspectorFormRegistration<TNode> | undefined {
    const extension = this.get(node.kind);
    return extension?.form as ClearpipeInspectorFormRegistration<TNode> | undefined;
  }
}
