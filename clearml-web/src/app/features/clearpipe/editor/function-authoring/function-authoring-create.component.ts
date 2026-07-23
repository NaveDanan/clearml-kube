import {ChangeDetectionStrategy, Component, inject, output, signal} from '@angular/core';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MAT_DIALOG_DATA} from '@angular/material/dialog';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {FUNCTION_AUTHORING_TASK_TYPES, ClearpipeFunctionAuthoringCreateData, FunctionAuthoringDefinition, FunctionAuthoringOutput, FunctionAuthoringPort} from './function-authoring.models';
import {ClearpipeFunctionAuthoringService} from './function-authoring.service';

type CreateInputForm = FormGroup<{
  id: FormControl<string>;
  name: FormControl<string>;
  type: FormControl<'data' | 'artifact' | 'parameter'>;
  required: FormControl<boolean>;
  defaultJson: FormControl<string>;
}>;
type CreateOutputForm = FormGroup<{
  id: FormControl<string>;
  name: FormControl<string>;
  type: FormControl<'data' | 'artifact'>;
}>;

/**
 * Explicit-definition creation surface. It keeps source and signature as
 * authored values; neither is inspected, evaluated, or synthesized here.
 */
@Component({
  selector: 'sm-clearpipe-function-authoring-create',
  templateUrl: './function-authoring-create.component.html',
  styleUrl: './function-authoring-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
})
export class ClearpipeFunctionAuthoringCreateComponent {
  private readonly authoring = inject(ClearpipeFunctionAuthoringService);
  private readonly preset = inject<ClearpipeFunctionAuthoringCreateData | null>(MAT_DIALOG_DATA, {optional: true});
  readonly created = output<string>();
  readonly createForm = new FormGroup({
    name: new FormControl('', {nonNullable: true}),
    label: new FormControl('', {nonNullable: true}),
    description: new FormControl('', {nonNullable: true}),
    signature: new FormControl('', {nonNullable: true}),
    source: new FormControl('', {nonNullable: true}),
    taskType: new FormControl('data_processing', {nonNullable: true}),
    queueResourceId: new FormControl('', {nonNullable: true}),
    cache: new FormControl(false, {nonNullable: true}),
    packages: new FormControl('', {nonNullable: true}),
    retryOnFailure: new FormControl('', {nonNullable: true}),
    inputs: new FormArray<CreateInputForm>([]),
    outputs: new FormArray<CreateOutputForm>([
      new FormGroup({
        id: new FormControl('output_result', {nonNullable: true}),
        name: new FormControl('result', {nonNullable: true}),
        type: new FormControl<'data' | 'artifact'>('data', {nonNullable: true}),
      }),
    ]),
  });
  readonly error = signal<string | null>(null);
  protected readonly taskTypes = FUNCTION_AUTHORING_TASK_TYPES;

  constructor() {
    if (this.preset) this.applyPreset(this.preset);
  }

  private applyPreset(preset: ClearpipeFunctionAuthoringCreateData): void {
    this.createForm.patchValue({
      ...(preset.name !== undefined ? {name: preset.name} : {}),
      ...(preset.label !== undefined ? {label: preset.label} : {}),
      ...(preset.description !== undefined ? {description: preset.description} : {}),
      ...(preset.signature !== undefined ? {signature: preset.signature} : {}),
      ...(preset.source !== undefined ? {source: preset.source} : {}),
      ...(preset.taskType !== undefined ? {taskType: preset.taskType} : {}),
      ...(preset.cache !== undefined ? {cache: preset.cache} : {}),
    });
    if (preset.inputs?.length) {
      this.createForm.controls.inputs.clear();
      preset.inputs.forEach(input => this.createForm.controls.inputs.push(new FormGroup({
        id: new FormControl(input.id, {nonNullable: true}),
        name: new FormControl(input.name, {nonNullable: true}),
        type: new FormControl<'data' | 'artifact' | 'parameter'>(input.type, {nonNullable: true}),
        required: new FormControl(input.required ?? false, {nonNullable: true}),
        defaultJson: new FormControl('', {nonNullable: true}),
      })));
    }
    if (preset.outputs?.length) {
      this.createForm.controls.outputs.clear();
      preset.outputs.forEach(output => this.createForm.controls.outputs.push(new FormGroup({
        id: new FormControl(output.id, {nonNullable: true}),
        name: new FormControl(output.name, {nonNullable: true}),
        type: new FormControl<'data' | 'artifact'>(output.type, {nonNullable: true}),
      })));
    }
  }

  addInput(): void {
    const index = this.createForm.controls.inputs.length + 1;
    this.createForm.controls.inputs.push(new FormGroup({
      id: new FormControl(`input_${index}`, {nonNullable: true}),
      name: new FormControl(`input_${index}`, {nonNullable: true}),
      type: new FormControl<'data' | 'artifact' | 'parameter'>('data', {nonNullable: true}),
      required: new FormControl(false, {nonNullable: true}),
      defaultJson: new FormControl('', {nonNullable: true}),
    }));
  }

  addOutput(): void {
    const index = this.createForm.controls.outputs.length + 1;
    this.createForm.controls.outputs.push(new FormGroup({
      id: new FormControl(`output_${index}`, {nonNullable: true}),
      name: new FormControl(`result_${index}`, {nonNullable: true}),
      type: new FormControl<'data' | 'artifact'>('data', {nonNullable: true}),
    }));
  }

  removeInput(index: number): void {
    this.createForm.controls.inputs.removeAt(index);
  }

  removeOutput(index: number): void {
    if (this.createForm.controls.outputs.length > 1) this.createForm.controls.outputs.removeAt(index);
  }

  create(): void {
    const result = this.authoring.create(this.definition());
    if (!result.ok || !result.id) {
      this.error.set(result.errors[0]?.message ?? 'The function component could not be created.');
      return;
    }
    this.error.set(null);
    this.created.emit(result.id);
  }

  private definition(): FunctionAuthoringDefinition {
    return {
      name: this.createForm.controls.name.value,
      label: this.createForm.controls.label.value,
      description: this.createForm.controls.description.value || undefined,
      signature: this.createForm.controls.signature.value,
      source: this.createForm.controls.source.value,
      taskType: this.createForm.controls.taskType.value,
      queueResourceId: this.createForm.controls.queueResourceId.value || undefined,
      cache: this.createForm.controls.cache.value,
      packages: this.packages(),
      retryOnFailure: this.retryOnFailure(),
      inputs: this.createForm.controls.inputs.controls.map(control => ({
        id: control.controls.id.value,
        name: control.controls.name.value,
        type: control.controls.type.value,
        required: control.controls.required.value,
        ...this.parseDefault(control.controls.defaultJson.value),
      }) as FunctionAuthoringPort),
      outputs: this.createForm.controls.outputs.controls.map(control => ({
        id: control.controls.id.value,
        name: control.controls.name.value,
        type: control.controls.type.value,
      }) as FunctionAuthoringOutput),
    };
  }

  private parseDefault(value: string): {default?: unknown} {
    if (!value.trim()) return {};
    try {
      return {default: JSON.parse(value)};
    } catch {
      return {default: value};
    }
  }

  private packages(): readonly string[] | undefined {
    const values = this.createForm.controls.packages.value.split('\n').map(value => value.trim()).filter(Boolean);
    return values.length ? values : undefined;
  }

  private retryOnFailure(): number | undefined {
    const value = this.createForm.controls.retryOnFailure.value.trim();
    return value ? Number(value) : undefined;
  }
}
