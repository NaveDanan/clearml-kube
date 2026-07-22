import {ChangeDetectionStrategy, Component, inject, signal} from '@angular/core';
import {MAT_DIALOG_DATA, MatDialogActions, MatDialogRef, MatDialogTitle} from '@angular/material/dialog';
import {MatButtonModule} from '@angular/material/button';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {FormsModule} from '@angular/forms';
import {MatSelectModule} from '@angular/material/select';
import {ClearpipeResourceOption} from '../clearpipe.models';

@Component({
  selector: 'sm-clearpipe-name-dialog',
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <div class="dialog-body">
      <mat-form-field>
        <mat-label>Name</mat-label>
        <input matInput [(ngModel)]="name" maxlength="256" cdkFocusInitial (keydown.enter)="submit()">
      </mat-form-field>
      <mat-form-field>
        <mat-label>Description</mat-label>
        <textarea matInput [(ngModel)]="description" rows="3" maxlength="2048"></textarea>
      </mat-form-field>
    </div>
    <mat-dialog-actions align="end">
      <button mat-stroked-button mat-dialog-close>CANCEL</button>
      <button mat-flat-button [disabled]="!name.trim()" (click)="submit()">SAVE</button>
    </mat-dialog-actions>
  `,
  styles: [`.dialog-body{display:flex;flex-direction:column;gap:12px;padding:8px 24px 4px;width:440px;max-width:80vw}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogTitle, MatDialogActions, MatButtonModule, MatFormFieldModule, MatInputModule],
})
export class ClearpipeNameDialogComponent {
  protected data = inject<{title: string; name: string; description?: string}>(MAT_DIALOG_DATA);
  private dialog = inject(MatDialogRef<ClearpipeNameDialogComponent>);
  protected name = this.data.name;
  protected description = this.data.description ?? '';
  protected submit(): void {
    if (this.name.trim()) this.dialog.close({name: this.name.trim(), description: this.description.trim()});
  }
}

@Component({
  selector: 'sm-clearpipe-run-dialog',
  template: `
    <h2 mat-dialog-title>Run ClearPipe</h2>
    <div class="dialog-body">
      <p>Select a ClearML queue. The controller and all child tasks will use native task monitoring.</p>
      <mat-form-field>
        <mat-label>Controller queue</mat-label>
        <mat-select [ngModel]="queueId()" (ngModelChange)="queueId.set($event)">
          @for (queue of data.queues; track queue.id) {
            <mat-option [value]="queue.id">{{ queue.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field>
        <mat-label>Parameter overrides (JSON)</mat-label>
        <textarea matInput [(ngModel)]="parametersText" rows="5" spellcheck="false"></textarea>
        @if (parameterError()) {<mat-error>{{ parameterError() }}</mat-error>}
      </mat-form-field>
    </div>
    <mat-dialog-actions align="end">
      <button mat-stroked-button mat-dialog-close>CANCEL</button>
      <button mat-flat-button [disabled]="!queueId()" (click)="submit()">RUN</button>
    </mat-dialog-actions>
  `,
  styles: [`.dialog-body{padding:8px 24px 4px;width:440px;max-width:80vw}.dialog-body p{color:var(--color-on-surface-variant);margin:0 0 20px}.dialog-body mat-form-field{width:100%}`],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, MatDialogTitle, MatDialogActions, MatButtonModule, MatFormFieldModule, MatSelectModule],
})
export class ClearpipeRunDialogComponent {
  protected data = inject<{queues: ClearpipeResourceOption[]}>(MAT_DIALOG_DATA);
  protected dialog = inject(MatDialogRef<ClearpipeRunDialogComponent>);
  protected queueId = signal(this.data.queues[0]?.id ?? '');
  protected parametersText = '{}';
  protected parameterError = signal('');
  protected submit(): void {
    try {
      const parameters = JSON.parse(this.parametersText);
      if (!parameters || Array.isArray(parameters) || typeof parameters !== 'object') throw new Error('Use a JSON object');
      this.dialog.close({queueId: this.queueId(), parameters});
    } catch (error) {
      this.parameterError.set((error as Error).message);
    }
  }
}
