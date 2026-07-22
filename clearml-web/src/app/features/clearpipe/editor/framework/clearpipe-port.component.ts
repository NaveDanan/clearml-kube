import {ChangeDetectionStrategy, Component, computed, input, output} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeValidationComponent} from './clearpipe-validation.component';
import {ClearpipePortPresentation, ClearpipeValidationPresentation} from './clearpipe-ui.types';

const compatibilityLabels = {
  idle: 'Not evaluating compatibility',
  pending: 'Checking compatibility',
  compatible: 'Compatible connection target',
  incompatible: 'Incompatible connection target',
  unavailable: 'Connection unavailable',
} as const;

@Component({
  selector: 'sm-clearpipe-port',
  templateUrl: './clearpipe-port.component.html',
  styleUrl: './clearpipe-port.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule, ClearpipeValidationComponent],
})
export class ClearpipePortComponent {
  readonly presentation = input.required<ClearpipePortPresentation>();
  readonly activated = output<ClearpipePortPresentation>();
  readonly validationFocused = output<ClearpipeValidationPresentation>();

  protected readonly compatibilityText = computed(() => {
    const compatibility = this.presentation().compatibility;
    return compatibility ? compatibility.reason ?? compatibilityLabels[compatibility.state] : undefined;
  });
  protected readonly accessibleLabel = computed(() => {
    const {port, connected} = this.presentation();
    const compatibility = this.compatibilityText();
    return [
      `${port.direction === 'input' ? 'Input' : 'Output'} port ${port.name}`,
      `${port.role} port`,
      `accepts ${port.accepted_binding_kinds.join(', ')}`,
      port.multiplicity === 'single' ? 'one connection' : 'multiple connections',
      connected ? 'connected' : 'not connected',
      compatibility,
    ].filter(Boolean).join('; ');
  });

  protected activate(): void {
    if (!this.presentation().interactionDisabled) this.activated.emit(this.presentation());
  }
}
