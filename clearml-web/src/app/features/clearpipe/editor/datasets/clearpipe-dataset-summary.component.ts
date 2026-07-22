import {ChangeDetectionStrategy, Component, Input} from '@angular/core';
import {ClearpipeResourceSelection} from '../../resources/clearpipe-resource.models';

@Component({
  selector: 'sm-clearpipe-dataset-summary',
  standalone: true,
  template: `
    @if (selection) {
      <section class="clearpipe-dataset-summary" aria-label="Selected dataset">
        <h3>{{ selection.resource.name }}</h3>
        <dl>
          <div><dt>Dataset ID</dt><dd><code>{{ selection.reference.resource_id }}</code></dd></div>
          @if (selection.resource.project) { <div><dt>Project</dt><dd>{{ selection.resource.project }}</dd></div> }
          @if (selection.resource.version) { <div><dt>Version</dt><dd>{{ selection.resource.version }}</dd></div> }
          @if (selection.resource.tags?.length) { <div><dt>Tags</dt><dd>{{ selection.resource.tags?.join(', ') }}</dd></div> }
          @if (selection.resource.updatedAt) { <div><dt>Updated</dt><dd>{{ selection.resource.updatedAt }}</dd></div> }
        </dl>
        <p>File count and dataset-version actions are unavailable because the authorized adapter does not supply them.</p>
      </section>
    } @else {
      <p class="clearpipe-dataset-summary">Select an authorized dataset to prepare a safe graph reference.</p>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClearpipeDatasetSummaryComponent {
  @Input() selection: ClearpipeResourceSelection | null = null;
}
