import {ChangeDetectionStrategy, Component, inject, OnDestroy, output, signal} from '@angular/core';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {MAT_DIALOG_DATA} from '@angular/material/dialog';
import {Subscription} from 'rxjs';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {ClearpipeResourceSelection, ClearpipeResourceSummary} from '../../resources/clearpipe-resource.models';
import {ClearpipeResourceQueryService} from '../../resources/clearpipe-resource-query.service';
import {ClearpipeResourceSelectorComponent} from '../../resources/clearpipe-resource-selector.component';
import {JsonValue, Point} from '../../domain/graph-v2.types';
import {TaskAuthoringDescriptorState, taskParameterPortId, taskStepName} from './task-authoring.models';
import {ClearpipeTaskAuthoringService} from './task-authoring.service';

type ParameterOverrideForm = FormGroup<{
  portId: FormControl<string>;
  name: FormControl<string>;
  defaultJson: FormControl<string>;
}>;

export interface ClearpipeTaskAuthoringCreateData {
  readonly placement?: Point;
}

@Component({
  selector: 'sm-clearpipe-task-authoring-create',
  templateUrl: './task-authoring-create.component.html',
  styleUrl: './task-authoring-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    ClearpipeResourceSelectorComponent,
  ],
})
export class ClearpipeTaskAuthoringCreateComponent implements OnDestroy {
  private readonly authoring = inject(ClearpipeTaskAuthoringService);
  private readonly resourceQueries = inject(ClearpipeResourceQueryService);
  private readonly dialogData = inject<ClearpipeTaskAuthoringCreateData | null>(MAT_DIALOG_DATA, {optional: true});
  readonly created = output<string>();
  readonly taskController = this.resourceQueries.for('task');
  readonly queueController = this.resourceQueries.for('queue');
  readonly selectedTask = signal<ClearpipeResourceSummary | null>(null);
  readonly selectedQueue = signal<ClearpipeResourceSummary | null>(null);
  readonly descriptor = signal<TaskAuthoringDescriptorState>({status: 'idle'});
  readonly staleConfirmed = signal(false);
  readonly error = signal<string | null>(null);
  private descriptorRequest?: Subscription;
  private descriptorRequestVersion = 0;
  readonly createForm = new FormGroup({
    name: new FormControl('', {nonNullable: true}),
    label: new FormControl('', {nonNullable: true}),
    cloneBaseTask: new FormControl(true, {nonNullable: true}),
    cache: new FormControl(false, {nonNullable: true}),
    retryOnFailure: new FormControl('', {nonNullable: true}),
    parameters: new FormArray<ParameterOverrideForm>([]),
  });

  selectTask(selection: ClearpipeResourceSelection): void {
    this.selectedTask.set(selection.resource);
    this.selectedQueue.set(null);
    this.staleConfirmed.set(false);
    this.error.set(null);
    this.createForm.patchValue({
      name: taskStepName(selection.resource.name),
      label: selection.resource.name,
    });
    this.loadDescriptor(selection.resource);
  }

  selectQueue(selection: ClearpipeResourceSelection): void {
    this.selectedQueue.set(selection.resource);
  }

  confirmStaleDescriptor(): void {
    this.staleConfirmed.set(true);
  }

  retryDescriptor(): void {
    const selected = this.selectedTask();
    if (selected) this.loadDescriptor(selected);
  }

  create(): void {
    const selected = this.selectedTask();
    const descriptor = this.descriptor();
    if (!selected || (descriptor.status !== 'available' && descriptor.status !== 'stale')) {
      this.error.set('Select an available authorized task and wait for its descriptor before creating a step.');
      return;
    }
    if (descriptor.status === 'stale' && !this.staleConfirmed()) {
      this.error.set('This task changed since the inventory was loaded. Review the refreshed descriptor and confirm before using it.');
      return;
    }
    const defaults = this.parameterDefaults();
    if (!defaults) return;
    const result = this.authoring.create({
      selectedTaskId: selected.id,
      descriptor: descriptor.descriptor,
      name: this.createForm.controls.name.value,
      label: this.createForm.controls.label.value,
      cloneBaseTask: this.createForm.controls.cloneBaseTask.value,
      cache: this.createForm.controls.cache.value,
      retryOnFailure: this.retryOnFailure(),
      ...(this.selectedQueue() ? {queue: this.selectedQueue()!} : {}),
      parameterDefaults: defaults,
      placement: this.dialogData?.placement,
    });
    if (!result.ok || !result.id) {
      this.error.set(result.errors[0]?.message ?? 'The task step could not be created.');
      return;
    }
    this.error.set(null);
    this.created.emit(result.id);
  }

  ngOnDestroy(): void {
    this.descriptorRequest?.unsubscribe();
  }

  private loadDescriptor(resource: ClearpipeResourceSummary): void {
    this.descriptorRequest?.unsubscribe();
    const version = ++this.descriptorRequestVersion;
    this.descriptor.set({status: 'loading'});
    this.descriptorRequest = this.authoring.describeTask(resource.id, resource.updatedAt).subscribe(state => {
      if (version !== this.descriptorRequestVersion) return;
      this.descriptor.set(state);
      if (state.status === 'available' || state.status === 'stale') this.loadParameters(state.descriptor);
    });
  }

  private loadParameters(descriptor: Extract<TaskAuthoringDescriptorState, {status: 'available' | 'stale'}>['descriptor']): void {
    this.createForm.controls.parameters.clear();
    descriptor.parameters.forEach(parameter => this.createForm.controls.parameters.push(new FormGroup({
      portId: new FormControl(taskParameterPortId(parameter.section, parameter.name), {nonNullable: true}),
      name: new FormControl(`${parameter.section}/${parameter.name}`, {nonNullable: true}),
      defaultJson: new FormControl('', {nonNullable: true}),
    })));
  }

  private parameterDefaults(): Readonly<Record<string, JsonValue | undefined>> | null {
    const defaults: Record<string, JsonValue | undefined> = {};
    for (const control of this.createForm.controls.parameters.controls) {
      const value = control.controls.defaultJson.value.trim();
      if (!value) continue;
      try {
        defaults[control.controls.portId.value] = JSON.parse(value) as JsonValue;
      } catch {
        this.error.set(`Parameter "${control.controls.name.value}" must be valid JSON.`);
        return null;
      }
    }
    return defaults;
  }

  private retryOnFailure(): number | undefined {
    const value = this.createForm.controls.retryOnFailure.value.trim();
    return value ? Number(value) : undefined;
  }
}
