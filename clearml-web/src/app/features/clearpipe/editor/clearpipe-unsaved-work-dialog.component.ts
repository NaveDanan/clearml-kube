import {Component, inject} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import {MatButton} from '@angular/material/button';
import type {ClearpipeUnsavedWorkContext} from './clearpipe-unsaved-work.service';

@Component({
  selector: 'sm-clearpipe-unsaved-work-dialog',
  template: `
    <h2 mat-dialog-title>Unsaved ClearPipe changes</h2>
    <mat-dialog-content>
      Save your changes before {{ actionLabel }}? Choosing Discard cannot be undone.
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="'cancel'">Cancel</button>
      <button mat-button [mat-dialog-close]="'discard'">Discard</button>
      <button mat-flat-button color="primary" [mat-dialog-close]="'save'">Save</button>
    </mat-dialog-actions>
  `,
  imports: [MatDialogTitle, MatDialogContent, MatDialogActions, MatDialogClose, MatButton],
})
export class ClearpipeUnsavedWorkDialogComponent {
  private readonly context = inject<ClearpipeUnsavedWorkContext>(MAT_DIALOG_DATA);

  protected get actionLabel(): string {
    return {
      new: 'creating a new document',
      open: 'opening another document',
      import: 'importing a document',
      'route-navigation': 'leaving this page',
      close: 'closing ClearPipe',
      'mode-change': 'changing editor mode',
    }[this.context.action];
  }
}
