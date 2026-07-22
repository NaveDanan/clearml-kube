import {ChangeDetectionStrategy, Component, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {ActivatedRoute} from '@angular/router';
import {MatButtonModule} from '@angular/material/button';
import {ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {ClearpipeEditorComponent} from '../editor/clearpipe-editor.component';
import {ClearpipeLifecycleService} from '../editor/clearpipe-lifecycle.service';
import {ExistingPipelineBlocker, ExistingPipelineLoadResult} from './clearpipe-existing-pipeline.models';
import {ClearpipeExistingPipelineLoaderService} from './clearpipe-existing-pipeline-loader.service';

@Component({
  selector: 'sm-clearpipe-existing-pipeline',
  templateUrl: './clearpipe-existing-pipeline.component.html',
  styleUrl: './clearpipe-existing-pipeline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ClearpipeEditorComponent, MatButtonModule],
})
export class ClearpipeExistingPipelineComponent {
  protected readonly lifecycle = inject(ClearpipeLifecycleService);
  private readonly loader = inject(ClearpipeExistingPipelineLoaderService);
  private readonly adapter = inject(ClearpipeAdapterService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly result = signal<ExistingPipelineLoadResult>({status: 'loading'});
  protected readonly versionMessage = signal('');
  private taskId = '';

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      const taskId = params.get('taskId');
      if (!taskId) return;
      this.taskId = taskId;
      this.versionMessage.set('');
      this.loader.load(taskId).subscribe(result => this.result.set(result));
    });
  }

  protected returnToPipeline(): void {
    void this.adapter.navigate({kind: 'pipeline-details', runTaskId: this.taskId});
  }

  protected editableResult(): Extract<ExistingPipelineLoadResult, {status: 'editable'}> | null {
    const result = this.result();
    return result.status === 'editable' ? result : null;
  }

  protected unsupportedResult(): Extract<ExistingPipelineLoadResult, {status: 'unsupported'}> | null {
    const result = this.result();
    return result.status === 'unsupported' ? result : null;
  }

  protected deniedResult(): Extract<ExistingPipelineLoadResult, {status: 'denied'}> | null {
    const result = this.result();
    return result.status === 'denied' ? result : null;
  }

  protected errorResult(): Extract<ExistingPipelineLoadResult, {status: 'error'}> | null {
    const result = this.result();
    return result.status === 'error' ? result : null;
  }

  protected openBlockerDetails(blocker: ExistingPipelineBlocker): void {
    if (blocker.resource) {
      void this.adapter.navigate({
        kind: 'resource-details',
        resourceType: blocker.resource.kind,
        resourceId: blocker.resource.id,
      });
      return;
    }
    this.returnToPipeline();
  }

  protected async createVersion(name: string): Promise<void> {
    if (!name.trim()) {
      this.versionMessage.set('Enter a name for the new version.');
      return;
    }
    await this.lifecycle.createVersion(name.trim());
    this.versionMessage.set(this.lifecycle.status() === 'saved'
      ? 'A new ClearPipe definition was created.'
      : this.lifecycle.problem()?.message ?? 'The new version was not created.');
  }
}
