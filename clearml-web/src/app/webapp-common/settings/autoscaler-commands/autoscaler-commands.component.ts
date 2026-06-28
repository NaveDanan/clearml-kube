import {Component, inject, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatTabsModule} from '@angular/material/tabs';
import {MatButtonModule} from '@angular/material/button';
import {MatIconModule} from '@angular/material/icon';
import {MatProgressSpinnerModule} from '@angular/material/progress-spinner';
import {ApiAutoscalerService} from '~/business-logic/api-services/autoscaler.service';

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
  ],
})
export class AutoscalerCommandsComponent {
  private autoscalerApi = inject(ApiAutoscalerService);

  protected readonly versions = [
    {id: 'v2', label: 'Run:ai V2 CLI'},
    {id: 'v1', label: 'Run:ai V1 CLI'},
  ];

  protected opened = signal(false);
  protected loading = signal(false);
  protected saving = signal(false);
  protected statusMessage = signal<{type: 'success' | 'error'; text: string} | null>(null);
  protected catalog = signal<CommandCatalog>({v2: [], v1: []});

  private editValues: CommandOverrides = {v2: {}, v1: {}};

  open(): void {
    this.opened.set(true);
    this.load();
  }

  close(): void {
    this.opened.set(false);
    this.statusMessage.set(null);
  }

  private load(): void {
    this.loading.set(true);
    this.statusMessage.set(null);
    this.autoscalerApi.autoscalerGetCommandTemplates({}).subscribe({
      next: (res) => {
        const catalog = (res?.catalog ?? {v2: [], v1: []}) as CommandCatalog;
        const overrides = (res?.overrides ?? {}) as CommandOverrides;
        const values: CommandOverrides = {};
        for (const version of Object.keys(catalog)) {
          values[version] = {};
          for (const entry of catalog[version] ?? []) {
            values[version][entry.key] = overrides?.[version]?.[entry.key] ?? entry.command;
          }
        }
        this.editValues = values;
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

  resetCommand(version: string, entry: CommandEntry): void {
    this.setValue(version, entry.key, entry.command);
  }

  isModified(version: string, entry: CommandEntry): boolean {
    return (this.getValue(version, entry.key) ?? '').trim() !== (entry.command ?? '').trim();
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
}
