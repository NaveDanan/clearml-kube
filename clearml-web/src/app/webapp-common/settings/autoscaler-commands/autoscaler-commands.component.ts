import {Component, DestroyRef, inject, signal} from '@angular/core';
import {takeUntilDestroyed} from '@angular/core/rxjs-interop';
import {FormsModule} from '@angular/forms';
import {MatTabsModule} from '@angular/material/tabs';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatInputModule} from '@angular/material/input';
import {MatProgressBarModule} from '@angular/material/progress-bar';
import {ApiAutoscalerService} from '~/business-logic/api-services/autoscaler.service';
import {of, timer} from 'rxjs';
import {catchError, filter, switchMap, takeWhile} from 'rxjs/operators';

interface CommandPlaceholder {
  name: string;
  description: string;
}

interface CommandEntry {
  key: string;
  label: string;
  description: string;
  command: string;
  placeholders: CommandPlaceholder[];
}

type CommandCatalog = Record<string, CommandEntry[]>;
type CommandOverrides = Record<string, Record<string, string>>;
type PlaceholderValues = Record<string, Record<string, Record<string, string>>>;

interface PlaygroundExecutionResult {
  status?: string;
  stdout?: string;
  stderr?: string;
  return_code?: string;
  execution_id?: string;
  timestamp?: string;
  result_data?: {
    command?: string;
    key?: string;
    version?: string;
    placeholders?: Record<string, string>;
  };
}

@Component({
  selector: 'sm-autoscaler-commands',
  templateUrl: './autoscaler-commands.component.html',
  styleUrls: ['./autoscaler-commands.component.scss'],
  providers: [ApiAutoscalerService],
  imports: [
    FormsModule,
    MatTabsModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
  ],
})
export class AutoscalerCommandsComponent {
  private autoscalerApi = inject(ApiAutoscalerService);
  private destroyRef = inject(DestroyRef);

  protected readonly versions = [
    {id: 'v2', label: 'Run:ai V2 CLI'},
    {id: 'v1', label: 'Run:ai V1 CLI'},
  ];

  protected opened = signal(false);
  protected loading = signal(false);
  protected saving = signal(false);
  protected testingConnection = signal(false);
  protected connectionOk = signal(false);
  protected statusMessage = signal<{type: 'success' | 'error'; text: string} | null>(null);
  protected connectionMessage = signal<{type: 'success' | 'error'; text: string} | null>(null);
  protected catalog = signal<CommandCatalog>({v2: [], v1: []});
  protected playgroundRunning = signal<Record<string, boolean>>({});
  protected playgroundResults = signal<Record<string, PlaygroundExecutionResult>>({});

  private editValues: CommandOverrides = {v2: {}, v1: {}};
  private placeholderValues: PlaceholderValues = {v2: {}, v1: {}};

  open(): void {
    this.opened.set(true);
    this.load();
  }

  close(): void {
    this.opened.set(false);
    this.statusMessage.set(null);
    this.connectionMessage.set(null);
    this.connectionOk.set(false);
    this.playgroundRunning.set({});
    this.playgroundResults.set({});
  }

  private load(): void {
    this.loading.set(true);
    this.statusMessage.set(null);
    this.connectionMessage.set(null);
    this.connectionOk.set(false);
    this.autoscalerApi.autoscalerGetCommandTemplates({}).subscribe({
      next: (res) => {
        const catalog = (res?.catalog ?? {v2: [], v1: []}) as CommandCatalog;
        const overrides = (res?.overrides ?? {}) as CommandOverrides;
        const values: CommandOverrides = {};
        const placeholderValues: PlaceholderValues = {};
        for (const version of Object.keys(catalog)) {
          values[version] = {};
          placeholderValues[version] = {};
          for (const entry of catalog[version] ?? []) {
            values[version][entry.key] = overrides?.[version]?.[entry.key] ?? entry.command;
            placeholderValues[version][entry.key] = this.buildPlaceholderDefaults(entry);
          }
        }
        this.editValues = values;
        this.placeholderValues = placeholderValues;
        this.catalog.set(catalog);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.statusMessage.set({type: 'error', text: 'Failed to load Run:ai commands.'});
      },
    });
  }

  getValue(version: string, key: string): string {
    return this.editValues[version]?.[key] ?? '';
  }

  setValue(version: string, key: string, value: string): void {
    if (!this.editValues[version]) {
      this.editValues[version] = {};
    }
    this.editValues[version][key] = value;
  }

  private buildPlaceholderDefaults(entry: CommandEntry): Record<string, string> {
    const values: Record<string, string> = {};
    for (const placeholder of entry.placeholders ?? []) {
      values[placeholder.name] = '';
    }
    return values;
  }

  getPlaceholders(version: string, entry: CommandEntry): Record<string, string> {
    if (!this.placeholderValues[version]) {
      this.placeholderValues[version] = {};
    }
    if (!this.placeholderValues[version][entry.key]) {
      this.placeholderValues[version][entry.key] = this.buildPlaceholderDefaults(entry);
    }
    for (const placeholder of entry.placeholders ?? []) {
      this.placeholderValues[version][entry.key][placeholder.name] ??= '';
    }
    return this.placeholderValues[version][entry.key];
  }

  getPlaceholderValue(version: string, key: string, name: string): string {
    return this.placeholderValues[version]?.[key]?.[name] ?? '';
  }

  setPlaceholderValue(version: string, key: string, name: string, value: string): void {
    if (!this.placeholderValues[version]) {
      this.placeholderValues[version] = {};
    }
    if (!this.placeholderValues[version][key]) {
      this.placeholderValues[version][key] = {};
    }
    this.placeholderValues[version][key][name] = value;
  }

  private executionKey(version: string, key: string): string {
    return `${version}:${key}`;
  }

  private collectPlaceholderPayload(version: string, entry: CommandEntry): Record<string, string> {
    const values = this.getPlaceholders(version, entry);
    const payload: Record<string, string> = {};
    for (const placeholder of entry.placeholders ?? []) {
      payload[placeholder.name] = (values[placeholder.name] ?? '').trim();
    }
    return payload;
  }

  testConnection(): void {
    this.testingConnection.set(true);
    this.connectionMessage.set(null);
    this.connectionOk.set(false);
    this.autoscalerApi.autoscalerTestConnection({}).subscribe({
      next: (res) => {
        if (res?.status !== 'queued' || !res.execution_id) {
          this.testingConnection.set(false);
          this.connectionMessage.set({type: 'error', text: res?.stderr ?? 'Failed to start connection test.'});
          return;
        }
        this.pollExecution(res.execution_id, (execution) => {
          this.testingConnection.set(false);
          if (execution?.status === 'success') {
            this.connectionOk.set(true);
            this.connectionMessage.set({type: 'success', text: 'Connection test succeeded. Playground commands are enabled.'});
          } else {
            this.connectionOk.set(false);
            this.connectionMessage.set({type: 'error', text: execution?.stderr || 'Connection test failed.'});
          }
        });
      },
      error: () => {
        this.testingConnection.set(false);
        this.connectionMessage.set({type: 'error', text: 'Failed to start connection test.'});
      },
    });
  }

  runCommand(version: string, entry: CommandEntry): void {
    if (!this.connectionOk()) {
      this.connectionMessage.set({type: 'error', text: 'Run a successful connection test before using the playground.'});
      return;
    }
    const missing = this.missingPlaceholders(version, entry);
    if (missing.length) {
      this.connectionMessage.set({
        type: 'error',
        text: `Command is missing required placeholder${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
      });
      return;
    }
    const executionKey = this.executionKey(version, entry.key);
    this.playgroundRunning.update((state) => ({...state, [executionKey]: true}));
    this.playgroundResults.update((state) => ({
      ...state,
      [executionKey]: {
        status: 'running',
        stdout: '',
        stderr: '',
        result_data: {
          command: this.getValue(version, entry.key),
          key: entry.key,
          version,
          placeholders: this.collectPlaceholderPayload(version, entry),
        },
      },
    }));

    this.autoscalerApi.autoscalerRunCommandPlayground({
      version,
      key: entry.key,
      command: this.getValue(version, entry.key),
      placeholders: this.collectPlaceholderPayload(version, entry),
    }).subscribe({
      next: (res) => {
        if (res?.status !== 'queued' || !res.execution_id) {
          this.playgroundRunning.update((state) => ({...state, [executionKey]: false}));
          this.playgroundResults.update((state) => ({
            ...state,
            [executionKey]: {status: 'error', stderr: res?.stderr ?? 'Failed to start command execution.'},
          }));
          return;
        }
        this.pollExecution(res.execution_id, (execution) => {
          this.playgroundRunning.update((state) => ({...state, [executionKey]: false}));
          this.playgroundResults.update((state) => ({...state, [executionKey]: execution ?? {status: 'error', stderr: 'Execution not found'}}));
        });
      },
      error: () => {
        this.playgroundRunning.update((state) => ({...state, [executionKey]: false}));
        this.playgroundResults.update((state) => ({
          ...state,
          [executionKey]: {status: 'error', stderr: 'Failed to start command execution.'},
        }));
      },
    });
  }

  isRunning(version: string, key: string): boolean {
    return !!this.playgroundRunning()[this.executionKey(version, key)];
  }

  getResult(version: string, key: string): PlaygroundExecutionResult | null {
    return this.playgroundResults()[this.executionKey(version, key)] ?? null;
  }

  private pollExecution(executionId: string, onDone: (result: PlaygroundExecutionResult | null) => void): void {
    timer(0, 2000).pipe(
      switchMap(() => this.autoscalerApi.autoscalerGetExecution({execution_id: executionId}).pipe(
        catchError(() => of({status: 'error', stderr: 'Failed to fetch execution result.'})),
      )),
      filter(Boolean),
      takeWhile((result) => ['queued', 'pending', 'running'].includes(result?.status), true),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: (result) => {
        if (!['queued', 'pending', 'running'].includes(result?.status)) {
          onDone(result as PlaygroundExecutionResult);
        }
      },
      error: () => onDone(null),
    });
  }

  resetCommand(version: string, entry: CommandEntry): void {
    this.setValue(version, entry.key, entry.command);
  }

  isModified(version: string, entry: CommandEntry): boolean {
    return (this.getValue(version, entry.key) ?? '').trim() !== (entry.command ?? '').trim();
  }

  missingPlaceholders(version: string, entry: CommandEntry): string[] {
    const command = this.getValue(version, entry.key);
    return (entry.placeholders ?? [])
      .map(placeholder => placeholder.name)
      .filter(name => !command.includes(`{${name}}`));
  }

  private collectOverrides(): CommandOverrides {
    const overrides: CommandOverrides = {};
    const catalog = this.catalog();
    for (const version of Object.keys(catalog)) {
      for (const entry of catalog[version] ?? []) {
        const value = (this.getValue(version, entry.key) ?? '').trim();
        if (value && value !== (entry.command ?? '').trim()) {
          overrides[version] = overrides[version] ?? {};
          overrides[version][entry.key] = value;
        }
      }
    }
    return overrides;
  }

  save(): void {
    const invalid = Object.entries(this.catalog()).flatMap(([version, entries]) =>
      entries
        .filter(entry => this.missingPlaceholders(version, entry).length)
        .map(entry => entry.label)
    );
    if (invalid.length) {
      this.statusMessage.set({
        type: 'error',
        text: `Restore the required placeholders before saving: ${invalid.join(', ')}.`,
      });
      return;
    }
    this.saving.set(true);
    this.statusMessage.set(null);
    this.autoscalerApi.autoscalerSetCommandTemplates({overrides: this.collectOverrides()}).subscribe({
      next: () => {
        this.saving.set(false);
        this.statusMessage.set({type: 'success', text: 'Run:ai commands saved.'});
      },
      error: () => {
        this.saving.set(false);
        this.statusMessage.set({type: 'error', text: 'Failed to save Run:ai commands.'});
      },
    });
  }

  resetAll(): void {
    const catalog = this.catalog();
    for (const version of Object.keys(catalog)) {
      for (const entry of catalog[version] ?? []) {
        this.setValue(version, entry.key, entry.command);
      }
    }
    this.saving.set(true);
    this.statusMessage.set(null);
    this.autoscalerApi.autoscalerSetCommandTemplates({overrides: {}}).subscribe({
      next: () => {
        this.saving.set(false);
        this.statusMessage.set({type: 'success', text: 'Run:ai commands reset to defaults.'});
      },
      error: () => {
        this.saving.set(false);
        this.statusMessage.set({type: 'error', text: 'Failed to reset Run:ai commands.'});
      },
    });
  }

  protected readonly JSON = JSON;
}
