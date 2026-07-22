import {inject, Injectable, InjectionToken} from '@angular/core';
import {lastValueFrom} from 'rxjs';
import {MatDialog} from '@angular/material/dialog';
import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';
import {GraphStoreService} from '../domain/graph-store.service';
import {ClearpipeUnsavedWorkDialogComponent} from './clearpipe-unsaved-work-dialog.component';

export type ClearpipeUnsavedWorkAction =
  | 'new'
  | 'open'
  | 'import'
  | 'route-navigation'
  | 'close'
  | 'mode-change';

export type ClearpipeUnsavedWorkDecision = 'save' | 'discard' | 'cancel';

export interface ClearpipeUnsavedWorkContext {
  action: ClearpipeUnsavedWorkAction;
}

export interface ClearpipeUnsavedWorkDecider {
  decide(context: ClearpipeUnsavedWorkContext): Promise<ClearpipeUnsavedWorkDecision>;
}

export const CLEARPIPE_UNSAVED_WORK_DECIDER = new InjectionToken<ClearpipeUnsavedWorkDecider>(
  'CLEARPIPE_UNSAVED_WORK_DECIDER',
  {
    providedIn: 'root',
    factory: (): ClearpipeUnsavedWorkDecider => {
      const dialog = inject(MatDialog);
      return {
        decide: (context) => lastValueFrom(dialog.open(ClearpipeUnsavedWorkDialogComponent, {
          data: context,
          width: '480px',
          disableClose: true,
        }).afterClosed()).then(decision => decision ?? 'cancel'),
      };
    },
  },
);

export interface ClearpipeUnsavedWorkResult {
  proceeded: boolean;
  decision: ClearpipeUnsavedWorkDecision | 'not-dirty';
}

/**
 * The single decision flow used before ClearPipe discards or replaces a graph.
 * The graph store remains the authority for whether work is dirty.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeUnsavedWorkService {
  private readonly graphStore = inject(GraphStoreService);
  private readonly lifecycle = inject(ClearpipeLifecycleService);
  private readonly decider = inject(CLEARPIPE_UNSAVED_WORK_DECIDER);

  async protect(
    action: ClearpipeUnsavedWorkAction,
    operation: () => void | boolean | Promise<void | boolean>,
  ): Promise<ClearpipeUnsavedWorkResult> {
    if (!this.graphStore.dirty()) return this.run(operation, 'not-dirty');

    const decision = await this.decider.decide({action});
    if (decision === 'cancel') return {proceeded: false, decision};

    if (decision === 'save') {
      await this.lifecycle.save();
      if (this.graphStore.dirty()) return {proceeded: false, decision};
    }
    return this.run(operation, decision);
  }

  beforeRouteLeave(): Promise<ClearpipeUnsavedWorkResult> {
    return this.protect('route-navigation', () => true);
  }

  beforeClose(): Promise<ClearpipeUnsavedWorkResult> {
    return this.protect('close', () => true);
  }

  newDocument(): Promise<ClearpipeUnsavedWorkResult> {
    return this.protect('new', () => this.lifecycle.new());
  }

  openDocument(taskId: string): Promise<ClearpipeUnsavedWorkResult> {
    return this.protect('open', async () => {
      await this.lifecycle.open(taskId);
      return true;
    });
  }

  beforeModeChange(): Promise<ClearpipeUnsavedWorkResult> {
    return this.protect('mode-change', () => true);
  }

  private async run(
    operation: () => void | boolean | Promise<void | boolean>,
    decision: ClearpipeUnsavedWorkResult['decision'],
  ): Promise<ClearpipeUnsavedWorkResult> {
    const result = await operation();
    return {proceeded: result !== false, decision};
  }
}
