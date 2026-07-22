import {ChangeDetectionStrategy, Component, computed, input} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';
import {ClearpipeStatusPresentation} from './clearpipe-ui.types';

const defaultIcons: Record<ClearpipeStatusPresentation['tone'], string> = {
  neutral: 'info',
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
  running: 'progress_activity',
  unavailable: 'block',
};

@Component({
  selector: 'sm-clearpipe-status',
  templateUrl: './clearpipe-status.component.html',
  styleUrl: './clearpipe-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
})
export class ClearpipeStatusComponent {
  readonly status = input.required<ClearpipeStatusPresentation>();
  protected readonly icon = computed(() => this.status().icon ?? defaultIcons[this.status().tone]);
}
