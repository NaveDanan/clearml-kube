import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeNodeActionPresentation} from './clearpipe-ui.types';

let actionSequence = 0;

@Component({
  selector: 'sm-clearpipe-node-action',
  templateUrl: './clearpipe-node-action.component.html',
  styleUrl: './clearpipe-node-action.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
})
export class ClearpipeNodeActionComponent {
  readonly action = input.required<ClearpipeNodeActionPresentation>();
  readonly idPrefix = input('');
  readonly invoked = output<ClearpipeNodeActionPresentation>();
  private readonly sequence = ++actionSequence;

  protected reasonId(): string {
    const prefix = this.idPrefix() || `clearpipe-action-${this.sequence}`;
    return `${prefix}-${this.action().id.replace(/[^A-Za-z0-9_-]/g, '-')}-reason`;
  }

  protected invoke(): void {
    if (!this.action().disabled) this.invoked.emit(this.action());
  }
}
