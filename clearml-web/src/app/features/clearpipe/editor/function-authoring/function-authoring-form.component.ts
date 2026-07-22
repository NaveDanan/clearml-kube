import {ChangeDetectionStrategy, Component, computed, effect, inject, signal, Signal} from '@angular/core';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {FunctionNode} from '../../domain/graph-v2.types';
import {CLEARPIPE_INSPECTOR_FORM_CONTEXT, ClearpipeInspectorFormContext, ClearpipeInspectorFormContract} from '../framework/clearpipe-ui.types';
import {
  FUNCTION_AUTHORING_TASK_TYPES,
  FunctionAuthoringDefinition,
  FunctionAuthoringDiagnostic,
  FunctionAuthoringOutput,
  FunctionAuthoringPort,
} from './function-authoring.models';
import {ClearpipeFunctionAuthoringService} from './function-authoring.service';
import {validateFunctionAuthoringDefinition} from './function-authoring.validation';

type PortForm = FormGroup<{
  id: FormControl<string>;
  name: FormControl<string>;
  type: FormControl<'data' | 'artifact' | 'parameter'>;
  required: FormControl<boolean>;
  defaultJson: FormControl<string>;
}>;
type OutputForm = FormGroup<{
  id: FormControl<string>;
  name: FormControl<string>;
  type: FormControl<'data' | 'artifact'>;
}>;

@Component({
  selector: 'sm-clearpipe-function-authoring-form',
  templateUrl: './function-authoring-form.component.html',
  styleUrl: './function-authoring-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatSelectModule],
})
export class ClearpipeFunctionAuthoringFormComponent implements ClearpipeInspectorFormContract<FunctionNode> {
  readonly clearpipeInspectorContext = inject(CLEARPIPE_INSPECTOR_FORM_CONTEXT) as Signal<ClearpipeInspectorFormContext<FunctionNode>>;
  private readonly authoring = inject(ClearpipeFunctionAuthoringService);
  protected readonly taskTypes = FUNCTION_AUTHORING_TASK_TYPES;
  protected readonly form = new FormGroup({
    label: new FormControl('', {nonNullable: true}),
    description: new FormControl('', {nonNullable: true}),
    taskType: new FormControl('data_processing', {nonNullable: true}),
    queueResourceId: new FormControl('', {nonNullable: true}),
    cache: new FormControl(false, {nonNullable: true}),
    packages: new FormControl('', {nonNullable: true}),
    retryOnFailure: new FormControl('', {nonNullable: true}),
    inputs: new FormArray<PortForm>([]),
    outputs: new FormArray<OutputForm>([]),
  });
  protected readonly diagnostics = computed(() => validateFunctionAuthoringDefinition(this.definition()).diagnostics);
  protected readonly saveMessage = signal<string | null>(null);

  constructor() {
    effect(() => this.load(this.clearpipeInspectorContext().node));
  }

  protected addInput(): void {
    this.form.controls.inputs.push(this.inputForm(`input_${this.form.controls.inputs.length + 1}`, `input_${this.form.controls.inputs.length + 1}`));
  }

  protected addOutput(): void {
    this.form.controls.outputs.push(this.outputForm(`output_${this.form.controls.outputs.length + 1}`, `result_${this.form.controls.outputs.length + 1}`));
  }

  protected removeInput(index: number): void {
    const port = this.form.controls.inputs.at(index);
    if (this.isBound(port.controls.id.value)) {
      this.saveMessage.set('Disconnect or remap this bound port through the edge controller before removing it.');
      return;
    }
    if (!this.clearpipeInspectorContext().readOnly) this.form.controls.inputs.removeAt(index);
  }

  protected removeOutput(index: number): void {
    const port = this.form.controls.outputs.at(index);
    if (this.isBound(port.controls.id.value)) {
      this.saveMessage.set('Disconnect or remap this bound port through the edge controller before removing it.');
      return;
    }
    if (!this.clearpipeInspectorContext().readOnly) this.form.controls.outputs.removeAt(index);
  }

  protected save(): void {
    const node = this.clearpipeInspectorContext().node;
    if (this.clearpipeInspectorContext().readOnly || node.kind !== 'function') return;
    const result = this.authoring.update(node, this.definition());
    this.saveMessage.set(result.ok ? null : result.errors[0]?.message ?? 'The function definition could not be saved.');
  }

  protected isBound(portId: string): boolean {
    return this.authoring.isPortBound(this.clearpipeInspectorContext().node.id, portId);
  }

  protected diagnosticId(index: number): string {
    return `clearpipe-function-diagnostic-${this.clearpipeInspectorContext().node.id}-${index}`;
  }

  protected diagnosticIds(...fields: readonly string[]): string | null {
    const ids = this.diagnostics()
      .flatMap((diagnostic, index) => fields.includes(diagnostic.field) ? [this.diagnosticId(index)] : []);
    return ids.length ? ids.join(' ') : null;
  }

  protected hasDiagnostic(...fields: readonly string[]): boolean {
    return this.diagnostics().some(diagnostic => fields.includes(diagnostic.field));
  }

  protected formDescriptionIds(): string | null {
    const ids = this.diagnostics().map((_, index) => this.diagnosticId(index));
    if (this.saveMessage()) ids.push('clearpipe-function-save-message');
    return ids.length ? ids.join(' ') : null;
  }

  protected diagnosticLabel(diagnostic: FunctionAuthoringDiagnostic): string {
    return `${diagnostic.code}: ${diagnostic.message}`;
  }

  private load(node: FunctionNode): void {
    this.form.patchValue({
      label: node.label,
      description: node.description ?? '',
      taskType: node.configuration.task_type,
      queueResourceId: node.configuration.queue_resource_id ?? '',
      cache: !!node.configuration.cache,
      packages: node.configuration.packages?.join('\n') ?? '',
      retryOnFailure: node.configuration.retry_on_failure?.toString() ?? '',
    }, {emitEvent: false});
    this.form.controls.inputs.clear({emitEvent: false});
    this.form.controls.outputs.clear({emitEvent: false});
    node.ports.filter(port => port.direction === 'input').forEach(port => this.form.controls.inputs.push(this.inputForm(
      port.id, port.name, port.role, port.required, typeof port.default === 'undefined' ? '' : JSON.stringify(port.default),
    ), {emitEvent: false}));
    node.ports.filter(port => port.direction === 'output').forEach(port => this.form.controls.outputs.push(this.outputForm(
      port.id, port.name, port.role === 'artifact' ? 'artifact' : 'data',
    ), {emitEvent: false}));
    if (this.clearpipeInspectorContext().readOnly) this.form.disable({emitEvent: false});
    else this.form.enable({emitEvent: false});
  }

  private definition(): FunctionAuthoringDefinition {
    const node = this.clearpipeInspectorContext().node;
    return {
      name: node.name,
      label: this.form.controls.label.value,
      description: this.form.controls.description.value || undefined,
      signature: node.signature,
      source: node.source,
      taskType: this.form.controls.taskType.value,
      queueResourceId: this.form.controls.queueResourceId.value || undefined,
      cache: this.form.controls.cache.value,
      packages: this.packages(),
      retryOnFailure: this.retryOnFailure(),
      inputs: this.form.controls.inputs.controls.map(control => ({
        id: control.controls.id.value,
        name: control.controls.name.value,
        type: control.controls.type.value,
        required: control.controls.required.value,
        ...this.parseDefault(control.controls.defaultJson.value),
      }) as FunctionAuthoringPort),
      outputs: this.form.controls.outputs.controls.map(control => ({
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
    const values = this.form.controls.packages.value.split('\n').map(value => value.trim()).filter(Boolean);
    return values.length ? values : undefined;
  }

  private retryOnFailure(): number | undefined {
    const value = this.form.controls.retryOnFailure.value.trim();
    return value ? Number(value) : undefined;
  }

  private inputForm(id: string, name: string, type: 'data' | 'artifact' | 'parameter' = 'data', required = false, defaultJson = ''): PortForm {
    return new FormGroup({
      id: new FormControl(id, {nonNullable: true}),
      name: new FormControl(name, {nonNullable: true}),
      type: new FormControl(type, {nonNullable: true}),
      required: new FormControl(required, {nonNullable: true}),
      defaultJson: new FormControl(defaultJson, {nonNullable: true}),
    });
  }

  private outputForm(id: string, name: string, type: 'data' | 'artifact' = 'data'): OutputForm {
    return new FormGroup({
      id: new FormControl(id, {nonNullable: true}),
      name: new FormControl(name, {nonNullable: true}),
      type: new FormControl(type, {nonNullable: true}),
    });
  }
}
