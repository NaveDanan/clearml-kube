import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {MatTooltipModule} from '@angular/material/tooltip';
import {GraphStoreService} from '../domain/graph-store.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {ClearpipeResourceOption} from '../clearpipe.models';

/**
 * Graph-level pipeline settings surfaced in the editor inspector.
 *
 * Exposes the pipeline name and the default execution queue. Both are required
 * before a pipeline can be saved: the name must be a generator-safe identifier
 * and unique in the workspace, and every step without its own queue inherits the
 * default execution queue. Selecting a queue ensures a matching `queue` resource
 * entry exists in the graph and points `settings.default_execution_queue_id` at it.
 */
@Component({
  selector: 'sm-clearpipe-pipeline-settings',
  templateUrl: './clearpipe-pipeline-settings.component.html',
  styleUrl: './clearpipe-pipeline-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatFormFieldModule, MatInputModule, MatSelectModule, MatTooltipModule],
})
export class ClearpipePipelineSettingsComponent {
  private readonly store = inject(GraphStoreService);
  private readonly api = inject(ClearpipeApiService);

  /** Mirrors the backend `_GENERATED_NAME` rule (compiler.py) that gates saves. */
  private static readonly SAFE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

  protected readonly readOnly = this.store.readOnly;
  protected readonly queues = signal<readonly ClearpipeResourceOption[]>([]);
  protected readonly queuesLoaded = signal(false);

  /** Whether a graph is loaded; settings only apply to a real graph. */
  protected readonly hasGraph = computed<boolean>(() => this.store.graph() !== null);

  /** The persisted pipeline name (empty until a graph is loaded). */
  protected readonly pipelineName = computed<string>(() => this.store.graph()?.document?.name ?? '');

  /** Live draft of the name field; null means "show the persisted name". */
  private readonly nameDraft = signal<string | null>(null);

  /** What the name input should display (draft while editing, else persisted). */
  protected readonly nameValue = computed<string>(() => this.nameDraft() ?? this.pipelineName());

  /** True when the current name text would be rejected by the backend. */
  protected readonly nameInvalid = computed<boolean>(() => {
    const value = this.nameValue().trim();
    return value.length > 0 && !ClearpipePipelineSettingsComponent.SAFE_NAME.test(value);
  });

  /** The real ClearML queue id currently used as the graph default (or ''). */
  protected readonly selectedQueueId = computed<string>(() => {
    const graph = this.store.graph();
    const resourceId = graph?.settings?.default_execution_queue_id;
    if (!graph || !resourceId) {
      return '';
    }
    const resource = graph.resources.find((item) => item.id === resourceId && item.kind === 'queue');
    return resource?.resource_id ?? '';
  });

  constructor() {
    this.api.getResources('queue').subscribe({
      next: (queues) => {
        this.queues.set(queues);
        this.queuesLoaded.set(true);
      },
      error: () => this.queuesLoaded.set(true),
    });
  }

  protected onNameInput(value: string): void {
    this.nameDraft.set(value);
  }

  protected renamePipeline(value: string): void {
    if (this.readOnly()) {
      this.nameDraft.set(null);
      return;
    }
    const name = value.trim();
    if (!name || !ClearpipePipelineSettingsComponent.SAFE_NAME.test(name)) {
      // Keep the draft so the inline error stays visible for correction.
      this.nameDraft.set(value);
      return;
    }
    if (name !== this.pipelineName()) {
      this.store.updateDocument({name});
    }
    this.nameDraft.set(null);
  }

  protected selectQueue(queueId: string): void {
    if (this.readOnly()) {
      return;
    }
    const graph = this.store.graph();
    if (!graph) {
      return;
    }

    if (!queueId) {
      this.store.updateSettings({default_execution_queue_id: undefined});
      return;
    }

    const existing = graph.resources.find((item) => item.kind === 'queue' && item.resource_id === queueId);
    let resourceId = existing?.id;
    if (!resourceId) {
      resourceId = `queue-${queueId}`;
      const label = this.queues().find((queue) => queue.id === queueId)?.name ?? queueId;
      this.store.addResource({id: resourceId, kind: 'queue', resource_id: queueId, label});
    }
    this.store.updateSettings({default_execution_queue_id: resourceId});
  }
}
