import {ChangeDetectionStrategy, Component} from '@angular/core';
import {MatIconModule} from '@angular/material/icon';

import {ClearpipeFlowNodeType, CLEARPIPE_FLOW_NODE_TYPES} from './clearpipe-flow.models';

@Component({
  selector: 'sm-clearpipe-flow-palette',
  templateUrl: './clearpipe-flow-palette.component.html',
  styleUrl: './clearpipe-flow-palette.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatIconModule],
})
export class ClearpipeFlowPaletteComponent {
  protected readonly nodeTypes = CLEARPIPE_FLOW_NODE_TYPES;

  protected onDragStart(event: DragEvent, type: ClearpipeFlowNodeType): void {
    if (!event.dataTransfer) {
      return;
    }
    event.dataTransfer.setData('application/x-clearpipe-flow-node', type);
    event.dataTransfer.setData('text/plain', type);
    event.dataTransfer.effectAllowed = 'copy';
  }

  protected onBoundaryDragStart(event: DragEvent): void {
    if (!event.dataTransfer) {
      return;
    }
    event.dataTransfer.setData('application/x-clearpipe-flow-boundary', 'boundary');
    event.dataTransfer.setData('text/plain', 'boundary');
    event.dataTransfer.effectAllowed = 'copy';
  }
}
