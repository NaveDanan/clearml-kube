import {ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal} from '@angular/core';
import {MatButtonModule} from '@angular/material/button';
import {ClearpipeAdapterProblem, ClearpipeAdapterService} from '../platform/clearpipe-adapter.service';
import {GraphV2} from '../domain/graph-v2.types';
import {
  clearpipeSemanticFingerprint,
  ClearpipeCodeDiagnostic,
  ClearpipeGeneratedCode,
  highlightClearpipePython,
  sourceFromCompilerOutput,
} from './clearpipe-code-preview.model';

@Component({
  selector: 'sm-clearpipe-code-preview',
  templateUrl: './clearpipe-code-preview.component.html',
  styleUrl: './clearpipe-code-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
})
export class ClearpipeCodePreviewComponent {
  private readonly adapter = inject(ClearpipeAdapterService);
  readonly graph = input<GraphV2 | null>(null);
  readonly open = input(false);
  readonly closeRequested = output<void>();
  readonly closed = signal(false);
  readonly generating = signal(false);
  readonly generated = signal<ClearpipeGeneratedCode | null>(null);
  readonly diagnostics = signal<readonly ClearpipeCodeDiagnostic[]>([]);
  readonly copied = signal(false);
  private requestedFingerprint: string | null = null;

  protected readonly source = computed(() => this.generated()?.source ?? '');
  protected readonly highlightedSource = computed(() => highlightClearpipePython(this.source()));
  protected readonly unavailable = computed(() => this.open() && !this.generating() && !this.source() && this.diagnostics().length > 0);

  constructor() {
    effect(() => {
      const graph = this.graph();
      const fingerprint = graph ? clearpipeSemanticFingerprint(graph) : null;
      if (this.open() && graph && fingerprint !== this.requestedFingerprint) this.regenerate(graph, fingerprint);
    });
  }

  close(): void {
    this.closed.set(true);
    this.closeRequested.emit();
  }

  reopen(): void {
    this.closed.set(false);
  }

  regenerate(graph = this.graph(), fingerprint = graph ? clearpipeSemanticFingerprint(graph) : null): void {
    if (!graph || !fingerprint || this.generating()) return;
    this.requestedFingerprint = fingerprint;
    this.generating.set(true);
    this.diagnostics.set([]);
    this.adapter.validate({graph}).subscribe(outcome => {
      if (outcome.status === 'loading') return;
      this.generating.set(false);
      if (outcome.status === 'ready' || outcome.status === 'validation_failed') {
        const source = sourceFromCompilerOutput(outcome.data.pipeline);
        if (source) {
          this.generated.set({source, semanticFingerprint: fingerprint});
          this.diagnostics.set(outcome.status === 'validation_failed' ? this.issues(outcome.problem) : []);
        } else {
          this.generated.set(null);
          this.diagnostics.set(this.issues(outcome.status === 'validation_failed' ? outcome.problem : {
            code: 'compilation_unavailable',
            message: 'Generated source is unavailable until the approved ClearPipe compiler publishes source output.',
            retryable: false,
          }));
        }
        return;
      }
      this.generated.set(null);
      this.diagnostics.set(this.issues(outcome.problem));
    });
  }

  async copy(): Promise<void> {
    if (!this.source()) return;
    try {
      await navigator.clipboard.writeText(this.source());
      this.copied.set(true);
    } catch {
      this.diagnostics.set([{code: 'copy_failed', severity: 'error', message: 'Copying generated source was blocked by the browser.'}]);
    }
  }

  download(): void {
    if (!this.source()) return;
    const name = this.graph()?.document.name.replace(/[^a-z0-9_-]+/gi, '-') || 'clearpipe';
    const url = URL.createObjectURL(new Blob([this.source()], {type: 'text/x-python;charset=utf-8'}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.py`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private issues(problem: ClearpipeAdapterProblem): ClearpipeCodeDiagnostic[] {
    return problem.issues?.map(issue => ({
      code: issue.code,
      message: issue.message,
      severity: issue.severity,
      node_id: issue.node_id,
    })) ?? [{code: problem.code, message: problem.message, severity: 'error'}];
  }
}
