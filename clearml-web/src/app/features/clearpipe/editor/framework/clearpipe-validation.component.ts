import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeValidationPresentation} from './clearpipe-ui.types';

const validationIcons: Record<ClearpipeValidationPresentation['severity'], string> = {
  error: 'al-ico-error-circle',
  warning: 'al-ico-alert',
  info: 'al-ico-info-circle-outline',
};

@Component({
  selector: 'sm-clearpipe-validation',
  templateUrl: './clearpipe-validation.component.html',
  styleUrl: './clearpipe-validation.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
})
export class ClearpipeValidationComponent {
  readonly validation = input.required<ClearpipeValidationPresentation>();
  readonly focusRequested = output<ClearpipeValidationPresentation>();
  protected readonly icons = validationIcons;

  protected focus(): void {
    if (this.validation().targetId) this.focusRequested.emit(this.validation());
  }
}
