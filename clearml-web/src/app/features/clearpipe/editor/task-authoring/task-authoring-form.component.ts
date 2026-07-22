import {ChangeDetectionStrategy, Component, computed, effect, inject, OnDestroy, OnInit, signal, Signal} from '@angular/core';
import {FormArray, FormControl, FormGroup, ReactiveFormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {Subscription} from 'rxjs';
import {TaskNode} from '../../domain/graph-v2.types';
import {CLEARPIPE_INSPECTOR_FORM_CONTEXT, ClearpipeInspectorFormContext, ClearpipeInspectorFormContract} from '../framework/clearpipe-ui.types';
import {ClearpipeResourceSelection, ClearpipeResourceSummary} from '../../resources/clearpipe-resource.models';
import {ClearpipeResourceQueryService} from '../../resources/clearpipe-resource-query.service';
import {ClearpipeResourceSelectorComponent} from '../../resources/clearpipe-resource-selector.component';
import {
  isStaleDescriptorConfirmed,
  TaskAuthoringDescriptorState,
  taskDescriptorConfirmationToken,
  taskParameterPortId,
} from './task-authoring.models';
import {ClearpipeTaskAuthoringService} from './task-authoring.service';

type ParameterOverrideForm = FormGroup<{
  portId: FormControl<string>;
  name: FormControl<string>;
  defaultJson: FormControl<string>;
}>;

@Component({
  selector: 'sm-clearpipe-task-authoring-form',
  templateUrl: './task-authoring-form.component.html',
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
export class ClearpipeTaskAuthoringFormComponent implements ClearpipeInspectorFormContract<TaskNode>, OnInit, OnDestroy {
  readonly clearpipeInspectorContext = inject(CLEARPIPE_INSPECTOR_FORM_CONTEXT) as Signal<ClearpipeInspectorFormContext<TaskNode>>;
  private readonly authoring = inject(ClearpipeTaskAuthoringService);
  private readonly resources = inject(ClearpipeResourceQueryService);
  readonly taskController = this.resources.for('task');
  readonly queueController = this.resources.for('queue');
  readonly descriptor = signal<TaskAuthoringDescriptorState>({status: 'idle'});
  readonly selectedTask = signal<ClearpipeResourceSummary | null>(null);
  readonly selectedQueue = signal<ClearpipeResourceSummary | null>(null);
  private readonly staleConfirmationToken = signal<string | null>(null);
  readonly staleConfirmed = () => isStaleDescriptorConfirmed(this.descriptor(), this.staleConfirmationToken());
  readonly saveMessage = signal<string | null>(null);
  private descriptorRequest?: Subscription;
  private descriptorRequestVersion = 0;
  protected readonly node = computed(() => this.clearpipeInspectorContext().node);
  protected readonly taskAvailability = computed(() => {
    const node = this.node();
    return this.taskController.selection(node.base_task.kind === 'task-id' ? node.base_task.task_id : null);
  });
  protected readonly form = new FormGroup({
    name: new FormControl('', {nonNullable: true}),
    label: new FormControl('', {nonNullable: true}),
    cloneBaseTask: new FormControl(true, {nonNullable: true}),
    cache: new FormControl(false, {nonNullable: true}),
    retryOnFailure: new FormControl('', {nonNullable: true}),
    parameters: new FormArray<ParameterOverrideForm>([]),
  });

  constructor() {
    effect(() => this.load(this.clearpipeInspectorContext().node));
  }

  ngOnInit(): void {
    if (this.taskController.state().status === 'idle') this.taskController.load();
    if (this.queueController.state().status === 'idle') this.queueController.load();
  }

  ngOnDestroy(): void {
    this.descriptorRequest?.unsubscribe();
  }

  protected selectTask(selection: ClearpipeResourceSelection): void {
    if (this.clearpipeInspectorContext().readOnly) return;
    this.selectedTask.set(selection.resource);
    this.selectedQueue.set(null);
    this.loadDescriptor(selection.resource.id, selection.resource.updatedAt);
  }

  protected selectQueue(selection: ClearpipeResourceSelection): void {
    if (!this.clearpipeInspectorContext().readOnly) this.selectedQueue.set(selection.resource);
  }

  protected confirmStaleDescriptor(): void {
    const state = this.descriptor();
    const token = state.status === 'stale' ? taskDescriptorConfirmationToken(state.descriptor) : null;
    if (!token) {
      this.saveMessage.set('The refreshed task descriptor has no update timestamp. Refresh the authorized task list and select the task again.');
      return;
    }
    this.staleConfirmationToken.set(token);
  }

  protected refreshDescriptor(): void {
    const node = this.node();
    const taskId = this.selectedTask()?.id ?? (node.base_task.kind === 'task-id' ? node.base_task.task_id : null);
    const knownUpdatedAt = this.selectedTask()?.updatedAt
      ?? (this.taskAvailability().status === 'selected' ? this.taskAvailability().resource?.updatedAt : undefined);
    if (taskId) this.loadDescriptor(taskId, knownUpdatedAt);
  }

  protected save(): void {
    const node = this.node();
    const descriptor = this.descriptor();
    const selectedTaskId = this.selectedTask()?.id ?? (node.base_task.kind === 'task-id' ? node.base_task.task_id : '');
    if (this.clearpipeInspectorContext().readOnly || (descriptor.status !== 'available' && descriptor.status !== 'stale')) return;
    if (descriptor.status === 'stale' && !this.staleConfirmed()) {
      this.saveMessage.set('This descriptor changed since the inventory was loaded. Review it and confirm before applying it.');
      return;
    }
    const defaults = this.parameterDefaults();
    if (!defaults) return;
    const result = this.authoring.update(node, {
      selectedTaskId,
      descriptor: descriptor.descriptor,
      name: this.form.controls.name.value,
      label: this.form.controls.label.value,
      cloneBaseTask: this.form.controls.cloneBaseTask.value,
      cache: this.form.controls.cache.value,
      retryOnFailure: this.retryOnFailure(),
      queueResourceId: node.configuration.queue_resource_id,
      ...(this.selectedQueue() ? {queue: this.selectedQueue()!} : {}),
      parameterDefaults: defaults,
    });
    this.saveMessage.set(result.ok ? null : result.errors[0]?.message ?? 'The task step could not be saved.');
  }

  protected bindingsForPort(portId: string) {
    return this.authoring.bindingsForPort(this.node().id, portId);
  }

  protected pipelineParameters(portId: string) {
    return this.authoring.pipelineParameterSuggestions(this.node().id, portId);
  }

  protected artifacts(portId: string) {
    return this.authoring.artifactSuggestions(this.node().id, portId);
  }

  protected executionParents() {
    return this.authoring.executionParentSuggestions(this.node().id);
  }

  protected executionBindings() {
    return this.authoring.executionBindingsForNode(this.node().id);
  }

  protected bindPipelineParameter(portId: string, parameterId: string): void {
    this.edgeMessage(this.authoring.connectPipelineParameter(this.node().id, portId, parameterId));
  }

  protected bindArtifact(portId: string, encodedSource: string): void {
    const [sourceNodeId, sourcePortId] = encodedSource.split('\u0000');
    if (!sourceNodeId || !sourcePortId) return;
    this.edgeMessage(this.authoring.connectArtifact(sourceNodeId, sourcePortId, this.node().id, portId));
  }

  protected addExecutionParent(parentNodeId: string): void {
    if (parentNodeId) this.edgeMessage(this.authoring.connectExecutionParent(parentNodeId, this.node().id));
  }

  protected disconnect(bindingId: string): void {
    this.edgeMessage(this.authoring.disconnect(bindingId));
  }

  protected currentQueueSelectionId(): string | null {
    const queueId = this.node().configuration.queue_resource_id;
    return queueId ? this.nodeResourceId(queueId) : null;
  }

  private load(node: TaskNode): void {
    this.form.patchValue({
      name: node.name,
      label: node.label,
      cloneBaseTask: node.configuration.clone_base_task !== false,
      cache: !!node.configuration.cache,
      retryOnFailure: node.configuration.retry_on_failure?.toString() ?? '',
    }, {emitEvent: false});
    this.selectedTask.set(null);
    this.selectedQueue.set(null);
    this.staleConfirmationToken.set(null);
    if (this.clearpipeInspectorContext().readOnly) this.form.disable({emitEvent: false});
    else this.form.enable({emitEvent: false});
    if (node.base_task.kind === 'task-id') this.loadDescriptor(node.base_task.task_id);
    else this.descriptor.set({
      status: 'unavailable',
      message: 'This task uses a project/name reference. Select an authorized immutable task ID before editing it.',
      retryable: false,
    });
  }

  private loadDescriptor(taskId: string, knownUpdatedAt?: string): void {
    this.staleConfirmationToken.set(null);
    this.descriptorRequest?.unsubscribe();
    const version = ++this.descriptorRequestVersion;
    this.descriptor.set({status: 'loading'});
    this.descriptorRequest = this.authoring.describeTask(taskId, knownUpdatedAt).subscribe(state => {
      if (version !== this.descriptorRequestVersion) return;
      this.descriptor.set(state);
      if (state.status === 'available' || state.status === 'stale') this.loadParameters(state.descriptor);
    });
  }

  private loadParameters(descriptor: Extract<TaskAuthoringDescriptorState, {status: 'available' | 'stale'}>['descriptor']): void {
    const current = this.node();
    this.form.controls.parameters.clear({emitEvent: false});
    descriptor.parameters.forEach(parameter => {
      const portId = taskParameterPortId(parameter.section, parameter.name);
      const existing = current.ports.find(port => port.id === portId);
      this.form.controls.parameters.push(new FormGroup({
        portId: new FormControl(portId, {nonNullable: true}),
        name: new FormControl(`${parameter.section}/${parameter.name}`, {nonNullable: true}),
        defaultJson: new FormControl(typeof existing?.default === 'undefined' ? '' : JSON.stringify(existing.default), {nonNullable: true}),
      }), {emitEvent: false});
    });
  }

  private parameterDefaults(): Readonly<Record<string, import('../../domain/graph-v2.types').JsonValue | undefined>> | null {
    const defaults: Record<string, import('../../domain/graph-v2.types').JsonValue | undefined> = {};
    for (const control of this.form.controls.parameters.controls) {
      const value = control.controls.defaultJson.value.trim();
      if (!value) continue;
      try {
        defaults[control.controls.portId.value] = JSON.parse(value);
      } catch {
        this.saveMessage.set(`Parameter "${control.controls.name.value}" must be valid JSON.`);
        return null;
      }
    }
    return defaults;
  }

  private retryOnFailure(): number | undefined {
    const value = this.form.controls.retryOnFailure.value.trim();
    return value ? Number(value) : undefined;
  }

  private nodeResourceId(resourceId: string): string | null {
    return this.authoring.queueResourceExternalId(resourceId);
  }

  private edgeMessage(result: {readonly eligible: boolean; readonly message: string}): void {
    this.saveMessage.set(result.eligible ? null : result.message);
  }
}
