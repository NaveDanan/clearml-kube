import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {
  CLEARPIPE_INSPECTOR_FORM_CONTEXT,
  ClearpipeInspectorFormContract,
  ClearpipeInspectorFormContext,
} from '../framework/clearpipe-ui.types';
import {GraphNode} from '../../domain/graph-v2.types';
import {ClearpipeResourceSelection} from '../../resources/clearpipe-resource.models';
import {ClearpipeDatasetBindingHandoffService} from '../../resources/datasets/clearpipe-dataset-binding-handoff.service';
import {ClearpipeDatasetBrowserComponent} from './clearpipe-dataset-browser.component';
import {ClearpipeDatasetSummaryComponent} from './clearpipe-dataset-summary.component';

@Component({
  selector: 'sm-clearpipe-dataset-inspector-form',
  standalone: true,
  imports: [ClearpipeDatasetBrowserComponent, ClearpipeDatasetSummaryComponent],
  template: `
    <section class="clearpipe-dataset-inspector-form">
      <sm-clearpipe-dataset-browser (datasetSelected)="select($event)"/>
      <sm-clearpipe-dataset-summary [selection]="selection()"/>
      @if (targets().length) {
        <label for="clearpipe-dataset-target">Bind to artifact input</label>
        <select id="clearpipe-dataset-target" [value]="selectedPortId()" (change)="selectedPortId.set($any($event.target).value)">
          @for (port of targets(); track port.id) {
            <option [value]="port.id">{{ port.name }}</option>
          }
        </select>
        <button type="button" (click)="bind()" [disabled]="!selection() || context().readOnly">Use selected dataset</button>
      } @else {
        <p>This node has no approved artifact input for a dataset binding.</p>
      }
      @if (message()) { <p role="status">{{ message() }}</p> }
    </section>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClearpipeDatasetInspectorFormComponent implements ClearpipeInspectorFormContract<GraphNode> {
  readonly clearpipeInspectorContext = inject(CLEARPIPE_INSPECTOR_FORM_CONTEXT);
  private readonly handoff = inject(ClearpipeDatasetBindingHandoffService);
  readonly context = this.clearpipeInspectorContext as () => ClearpipeInspectorFormContext<GraphNode>;
  readonly selection = signal<ClearpipeResourceSelection | null>(null);
  readonly selectedPortId = signal('');
  readonly targets = computed(() => this.handoff.targets(this.context().node));
  readonly message = signal('');

  select(selection: ClearpipeResourceSelection): void {
    this.selection.set(selection);
    if (!this.targets().some((port) => port.id === this.selectedPortId())) {
      this.selectedPortId.set(this.targets()[0]?.id ?? '');
    }
    this.message.set('');
  }

  bind(): void {
    const selection = this.selection();
    if (!selection || this.context().readOnly) return;
    const result = this.handoff.bind(selection, this.context().node, this.selectedPortId());
    this.message.set(result.status === 'bound'
      ? 'Dataset reference is bound through the canonical graph resource and artifact binding.'
      : result.status === 'already-bound'
        ? 'This artifact input already has a binding. Remove that binding before replacing it.'
        : result.status === 'unsupported-target'
          ? 'This port cannot accept a dataset artifact binding.'
          : 'The dataset reference could not be added to this graph.');
  }
}
