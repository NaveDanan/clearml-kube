import {inject} from '@angular/core';
import {CanDeactivateFn} from '@angular/router';
import {ClearpipeUnsavedWorkService} from './clearpipe-unsaved-work.service';

/** Route-level adapter for the reusable ClearPipe Save / Discard / Cancel flow. */
export const clearpipeUnsavedWorkGuard: CanDeactivateFn<unknown> = () =>
  inject(ClearpipeUnsavedWorkService).beforeRouteLeave().then(result => result.proceeded);
