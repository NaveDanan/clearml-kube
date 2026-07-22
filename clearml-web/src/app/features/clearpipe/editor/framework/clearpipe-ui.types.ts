import {InjectionToken, Signal, TemplateRef, Type} from '@angular/core';
import {BindingKind, FunctionNode, GraphNode, GraphPort, TaskNode} from '../../domain/graph-v2.types';

export type ClearpipeCatalogState = 'ready' | 'loading' | 'empty' | 'error' | 'disabled';
export type ClearpipeNodeStatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'error' | 'running' | 'unavailable';
export type ClearpipeValidationSeverity = 'error' | 'warning' | 'info';
export type ClearpipePortCompatibilityState = 'idle' | 'pending' | 'compatible' | 'incompatible' | 'unavailable';

export interface ClearpipeCatalogEntry {
  readonly id: string;
  /** Assigned by the live extension registry; callers must not retain it across registrations. */
  readonly registrationId?: number;
  readonly category: string;
  readonly label: string;
  readonly description: string;
  readonly nodeKind: GraphNode['kind'];
  readonly icon: string;
  readonly keywords?: readonly string[];
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export interface ClearpipeCatalogPresentation {
  readonly state: ClearpipeCatalogState;
  readonly message?: string;
}

export interface ClearpipeCatalogAddRequest {
  readonly entry: ClearpipeCatalogEntry;
  readonly method: 'click' | 'keyboard';
}

export interface ClearpipeCatalogDropRequest {
  readonly entry: ClearpipeCatalogEntry;
  readonly method: 'drop';
  /** Position local to the editor's canvas region; feature actions own graph placement. */
  readonly placement: {readonly x: number; readonly y: number};
}

export type ClearpipeCatalogActionRequest = ClearpipeCatalogAddRequest | ClearpipeCatalogDropRequest;

/**
 * Catalog actions are feature-owned creation handoffs. The extension host only
 * routes an intent; an action decides whether and how to issue graph commands.
 */
export interface ClearpipeCatalogActionRegistration {
  readonly catalogEntryId: string;
  readonly availability?: () => ClearpipeCatalogActionAvailability;
  readonly execute: (request: ClearpipeCatalogActionRequest) => void | Promise<void>;
}

export interface ClearpipeCatalogActionAvailability {
  readonly available: boolean;
  readonly reason?: string;
}

export type ClearpipeCatalogActionDispatchResult =
  | {readonly status: 'dispatched'}
  | {readonly status: 'missing' | 'disabled' | 'failed'; readonly message: string};

export interface ClearpipeCatalogDragRequest {
  readonly entry: ClearpipeCatalogEntry;
  readonly dataTransfer: DataTransfer | null;
}

export interface ClearpipeStatusPresentation {
  readonly tone: ClearpipeNodeStatusTone;
  readonly label: string;
  readonly detail?: string;
  readonly icon?: string;
}

export interface ClearpipeValidationPresentation {
  readonly severity: ClearpipeValidationSeverity;
  readonly message: string;
  readonly code?: string;
  readonly targetId?: string;
}

export interface ClearpipeNodeActionPresentation {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

/**
 * CP-20 owns compatibility computation. This component contract only displays
 * the state and never derives a connection rule from a visual edge.
 */
export interface ClearpipePortCompatibilityPresentation {
  readonly state: ClearpipePortCompatibilityState;
  readonly reason?: string;
}

export interface ClearpipePortPresentation {
  readonly nodeId: string;
  readonly port: GraphPort;
  readonly connected: boolean;
  /** CP-10 selection projection supplied by the renderer; never cached here. */
  readonly selected?: boolean;
  readonly compatibility?: ClearpipePortCompatibilityPresentation;
  readonly validation?: readonly ClearpipeValidationPresentation[];
  readonly interactionDisabled?: boolean;
  readonly disabledReason?: string;
}

export interface ClearpipeNodeCardPresentation {
  readonly node: GraphNode;
  readonly icon: string;
  readonly typeLabel: string;
  readonly summary: string;
  readonly selected?: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly statuses?: readonly ClearpipeStatusPresentation[];
  readonly validations?: readonly ClearpipeValidationPresentation[];
  readonly ports?: readonly ClearpipePortPresentation[];
  readonly actions?: readonly ClearpipeNodeActionPresentation[];
}

export interface ClearpipeNodeCardInteraction {
  readonly select: (nodeId: string) => void;
  readonly activatePort: (port: ClearpipePortPresentation) => void;
  readonly requestAction: (action: ClearpipeNodeActionPresentation) => void;
  readonly focusValidation: (validation: ClearpipeValidationPresentation) => void;
}

export interface ClearpipeNodeRendererProps {
  readonly card: ClearpipeNodeCardPresentation;
  readonly interaction: ClearpipeNodeCardInteraction;
}

export interface ClearpipeInspectorSourceLink {
  readonly label: string;
  readonly href: string;
}

export interface ClearpipeInspectorSlotContext {
  readonly node: GraphNode;
  readonly readOnly: boolean;
  readonly readOnlyReason?: string;
}

export interface ClearpipeInspectorSlot {
  readonly id: string;
  readonly label: string;
  readonly template: TemplateRef<ClearpipeInspectorSlotContext>;
}

export interface ClearpipeInspectorOptionalSlot {
  readonly template: TemplateRef<ClearpipeInspectorSlotContext>;
}

export interface ClearpipeInspectorPresentation {
  readonly node: GraphNode;
  readonly title: string;
  readonly typeLabel: string;
  readonly summary?: string;
  readonly source?: ClearpipeInspectorSourceLink;
  readonly readOnly?: boolean;
  readonly readOnlyReason?: string;
  readonly statuses?: readonly ClearpipeStatusPresentation[];
  readonly validations?: readonly ClearpipeValidationPresentation[];
  /** Read-only, owner-supplied content. CP-17 does not fetch logs. */
  readonly logs?: ClearpipeInspectorOptionalSlot;
  /** Read-only, owner-supplied content. CP-17 does not derive execution state. */
  readonly execution?: ClearpipeInspectorOptionalSlot;
  /** Read-only, server-derived code content supplied by CP-23. */
  readonly code?: ClearpipeInspectorOptionalSlot;
  readonly slots?: readonly ClearpipeInspectorSlot[];
}

export interface ClearpipeInspectorFormContext<TNode extends GraphNode = GraphNode> {
  readonly node: TNode;
  readonly readOnly: boolean;
  readonly readOnlyReason?: string;
  readonly validations: readonly ClearpipeValidationPresentation[];
}

export interface ClearpipeInspectorFormContract<TNode extends GraphNode> {
  readonly clearpipeInspectorContext: Signal<ClearpipeInspectorFormContext<TNode>>;
}

export const CLEARPIPE_INSPECTOR_FORM_CONTEXT =
  new InjectionToken<Signal<ClearpipeInspectorFormContext<GraphNode>>>('CLEARPIPE_INSPECTOR_FORM_CONTEXT');

export interface ClearpipeInspectorFormRegistration<TNode extends GraphNode> {
  readonly id: string;
  readonly component: Type<ClearpipeInspectorFormContract<TNode>>;
}

export interface ClearpipeNodeSummary {
  readonly text: string;
}

export interface ClearpipeTypedNodeExtension<TNode extends GraphNode> {
  readonly nodeKind: TNode['kind'];
  readonly catalog?: Omit<ClearpipeCatalogEntry, 'nodeKind'> & {readonly nodeKind: TNode['kind']};
  readonly icon?: string;
  readonly summarize?: (node: TNode) => ClearpipeNodeSummary;
  readonly form?: ClearpipeInspectorFormRegistration<TNode>;
  readonly actions?: readonly ClearpipeNodeActionPresentation[];
  /**
   * Statuses are already-authoritative state props. Mapping service/runtime
   * data to these props remains with the state and execution owners.
   */
  readonly statusPresentation?: readonly ClearpipeStatusPresentation[];
}

export type ClearpipeNodeExtension =
  | ClearpipeTypedNodeExtension<TaskNode>
  | ClearpipeTypedNodeExtension<FunctionNode>;

export type ClearpipeBindingKinds = readonly BindingKind[];

export const defineClearpipeNodeExtension = <TNode extends GraphNode>(
  extension: ClearpipeTypedNodeExtension<TNode>,
): ClearpipeTypedNodeExtension<TNode> => extension;
