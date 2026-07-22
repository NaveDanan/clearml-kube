import {Directive, input} from '@angular/core';

export const CLEARPIPE_WORKSPACE_SLOTS = [
  'workspace.palette',
  'workspace.canvas',
  'workspace.inspector',
  'workspace.toolbar.primary',
  'workspace.toolbar.overflow',
  'workspace.preview',
  'workspace.execution',
  'workspace.first-use',
  'workspace.status',
] as const;

export type ClearpipeWorkspaceSlot = typeof CLEARPIPE_WORKSPACE_SLOTS[number];
export type WorkspacePanel = 'palette' | 'inspector';
export type WorkspaceRouteSurface = 'loading' | 'ready' | 'denied' | 'not-found' | 'unsupported' | 'error';

/**
 * The shell-only state supplied to a slot. It intentionally excludes graph
 * data, requests, credentials, and execution state; those remain with owners.
 */
export interface ClearpipeWorkspaceSlotContext {
  readonly readOnly: boolean;
  readonly routeSurface: WorkspaceRouteSurface;
  readonly isNarrow: boolean;
  readonly panel: WorkspacePanel | null;
}

/**
 * A slot emits a named intent to its owning command or lifecycle boundary.
 * Slots never reach sibling components or production clients directly.
 */
export type ClearpipeWorkspaceIntent =
  | {type: 'focus-canvas'}
  | {type: 'open-panel'; panel: WorkspacePanel}
  | {type: 'close-panel'; panel: WorkspacePanel}
  | {type: 'add-requested'}
  | {type: 'inspect-requested'}
  | {type: 'preview-requested'}
  | {type: 'execution-requested'};

/**
 * Marker used by the editor template and future contributions. New slot
 * composition is reviewed by CP-15 rather than adding a second workspace.
 */
@Directive({
  selector: '[smClearpipeWorkspaceSlot]',
})
export class ClearpipeWorkspaceSlotDirective {
  readonly slot = input.required<ClearpipeWorkspaceSlot>({alias: 'smClearpipeWorkspaceSlot'});
}
