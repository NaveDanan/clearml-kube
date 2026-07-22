import {ChangeDetectionStrategy, Component, EventEmitter, Input, Output} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterLink} from '@angular/router';
import {ClearpipeCredentialReference, isSafeCredentialReference} from './clearpipe-resource.models';

@Component({
  selector: 'sm-clearpipe-credential-selector',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <label [for]="selectId">Credential reference</label>
    <select [id]="selectId" [value]="selectedReference ?? ''" (change)="select($any($event.target).value)">
      <option value="">Select an existing credential reference</option>
      @for (reference of safeReferences; track reference.reference) {
        <option [value]="reference.reference">{{ reference.label }}</option>
      }
    </select>
    @for (reference of safeReferences; track reference.reference) {
      @if (reference.reference === selectedReference && reference.management; as management) {
        <a [routerLink]="management.commands">{{ management.label }}</a>
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClearpipeCredentialSelectorComponent {
  @Input() references: readonly ClearpipeCredentialReference[] = [];
  @Input() selectedReference: string | null = null;
  @Output() readonly selectedReferenceChange = new EventEmitter<string | null>();
  @Output() readonly referenceSelected = new EventEmitter<ClearpipeCredentialReference>();

  readonly selectId = `clearpipe-credential-reference-${Math.random().toString(36).slice(2)}`;

  get safeReferences(): readonly ClearpipeCredentialReference[] {
    return this.references.filter(isSafeCredentialReference);
  }

  select(reference: string): void {
    const selected = this.safeReferences.find(item => item.reference === reference);
    this.selectedReference = selected?.reference ?? null;
    this.selectedReferenceChange.emit(this.selectedReference);
    if (selected) this.referenceSelected.emit(selected);
  }
}
