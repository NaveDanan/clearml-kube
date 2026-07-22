import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeNodeActionComponent} from './clearpipe-node-action.component';
import {ClearpipePortComponent} from './clearpipe-port.component';
import {ClearpipeStatusComponent} from './clearpipe-status.component';
import {ClearpipeValidationComponent} from './clearpipe-validation.component';
import {
  ClearpipeNodeActionPresentation,
  ClearpipeNodeCardPresentation,
  ClearpipePortPresentation,
  ClearpipeValidationPresentation,
} from './clearpipe-ui.types';

@Component({
  selector: 'sm-clearpipe-node-card',
  templateUrl: './clearpipe-node-card.component.html',
  styleUrl: './clearpipe-node-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    ClearpipeNodeActionComponent,
    ClearpipePortComponent,
    ClearpipeStatusComponent,
    ClearpipeValidationComponent,
  ],
})
export class ClearpipeNodeCardComponent {
  readonly presentation = input.required<ClearpipeNodeCardPresentation>();
  readonly selected = output<string>();
  readonly actionRequested = output<ClearpipeNodeActionPresentation>();
  readonly portActivated = output<ClearpipePortPresentation>();
  readonly validationFocused = output<ClearpipeValidationPresentation>();

  protected select(): void {
    this.selected.emit(this.presentation().node.id);
  }
}
