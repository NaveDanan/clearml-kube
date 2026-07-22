import {ChangeDetectionStrategy, Component, input, output} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {ClearpipeExecutionPresentation} from './clearpipe-execution.models';

@Component({
  selector: 'sm-clearpipe-execution-results',
  templateUrl: './clearpipe-execution-results.component.html',
  styleUrl: './clearpipe-execution-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
})
export class ClearpipeExecutionResultsComponent {
  readonly presentation = input.required<ClearpipeExecutionPresentation>();
  readonly openPipelineRequested = output<void>();
  readonly openTaskRequested = output<string>();
  readonly openDatasetRequested = output<string>();
  readonly openModelRequested = output<string>();
}
