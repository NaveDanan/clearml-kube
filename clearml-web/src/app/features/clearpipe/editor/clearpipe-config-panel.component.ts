import {ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal} from '@angular/core';
import {ClearpipeStateService} from '../clearpipe-state.service';
import {ClearpipeApiService} from '../clearpipe-api.service';
import {ClearpipeResourceOption} from '../clearpipe.models';
import {FormsModule} from '@angular/forms';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatSelectModule} from '@angular/material/select';
import {MatCheckboxModule} from '@angular/material/checkbox';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {RouterLink} from '@angular/router';
import {forkJoin, of} from 'rxjs';
import {catchError} from 'rxjs/operators';

@Component({
  selector: 'sm-clearpipe-config-panel',
  templateUrl: './clearpipe-config-panel.component.html',
  styleUrl: './clearpipe-config-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatIconModule,
    RouterLink,
  ],
})
export class ClearpipeConfigPanelComponent implements OnInit {
  protected state = inject(ClearpipeStateService);
  private api = inject(ClearpipeApiService);
  readonly readonly = input(false);
  protected node = this.state.selectedNode;
  protected resources = signal<Record<string, ClearpipeResourceOption[]>>({});
  protected resourceLoading = signal(true);
  protected resourceType = computed<ClearpipeResourceOption['type']>(() => {
    switch (this.node()?.type) {
      case 'dataset': return 'dataset';
      case 'training': return 'task';
      case 'report': return 'report';
      default: return 'project';
    }
  });

  ngOnInit(): void {
    forkJoin({
      project: this.safeResources('project'),
      task: this.safeResources('task'),
      dataset: this.safeResources('dataset'),
      model: this.safeResources('model'),
      queue: this.safeResources('queue'),
      report: this.safeResources('report'),
      endpoint: this.safeResources('endpoint'),
      storage: this.safeResources('storage'),
    }).subscribe(resources => {
      this.resources.set(resources);
      this.resourceLoading.set(false);
    });
  }

  protected updateLabel(value: string): void {
    const node = this.node();
    if (node) this.state.updateNode(node.id, {label: value});
  }

  protected updateConfig(key: string, value: unknown): void {
    const node = this.node();
    if (node) this.state.updateNodeConfig(node.id, key, value);
  }

  protected configValue(key: string): unknown {
    return this.node()?.config?.[key];
  }

  protected options(type: ClearpipeResourceOption['type']): ClearpipeResourceOption[] {
    return this.resources()[type] ?? [];
  }

  protected updateInlineScript(value: string): void {
    this.updateConfig('steps', [{id: 'step-1', name: 'Script', enabled: true, inlineScript: value}]);
  }

  protected inlineScript(): string {
    const steps = this.configValue('steps');
    return Array.isArray(steps) && typeof steps[0]?.inlineScript === 'string' ? steps[0].inlineScript : '';
  }

  protected updateSource(value: string): void {
    this.updateConfig('source', value);
    this.updateConfig('scriptSource', value);
  }

  protected updateProject(projectId: string): void {
    const project = this.options('project').find(option => option.id === projectId);
    this.updateConfig('projectId', projectId);
    this.updateConfig('projectName', project?.name ?? projectId);
  }

  protected resourceLink(option: ClearpipeResourceOption): string[] {
    switch (option.type) {
      case 'dataset': return ['/datasets/simple', '*', 'tasks', option.id];
      case 'task': return ['/projects', '*', 'tasks', option.id];
      case 'model': return ['/projects', '*', 'models', option.id];
      case 'queue': return ['/workers-and-queues'];
      case 'report': return ['/reports', option.id];
      case 'endpoint': return ['/endpoints', 'active'];
      default: return ['/projects', option.id];
    }
  }

  private safeResources(type: ClearpipeResourceOption['type']) {
    return this.api.getResources(type).pipe(catchError(() => of([] as ClearpipeResourceOption[])));
  }
}
