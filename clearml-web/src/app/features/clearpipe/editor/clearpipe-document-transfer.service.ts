import {inject, Injectable} from '@angular/core';
import {decodeGraphV2, serializeGraphV2} from '../domain/graph-v2-codec';
import {GraphCodecIssue, GraphV2, UnsupportedGraph} from '../domain/graph-v2.types';
import {GraphStoreService} from '../domain/graph-store.service';
import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';
import {ClearpipeUnsavedWorkResult, ClearpipeUnsavedWorkService} from './clearpipe-unsaved-work.service';

export interface ClearpipeGraphExport {
  kind: 'graph';
  filename: string;
  mediaType: 'application/json';
  text: string;
}

export type ClearpipeDocumentTransferResult =
  | {status: 'exported'; document: ClearpipeGraphExport}
  | {status: 'imported'; graph: GraphV2; guard: ClearpipeUnsavedWorkResult}
  | {status: 'cancelled'; guard: ClearpipeUnsavedWorkResult}
  | {status: 'invalid'; errors: GraphCodecIssue[]}
  | {status: 'unsupported'; unsupported: UnsupportedGraph; migration: 'read-only'}
  | {status: 'unavailable'; code: 'no_graph_loaded' | 'code_generation_unavailable' | 'code_import_unsupported'};

const maxImportBytes = 4 * 1024 * 1024;

const filename = (name: string, extension: string): string => {
  const safe = name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'clearpipe';
  return `${safe}.${extension}`;
};

const portableGraph = (graph: GraphV2): GraphV2 => {
  const result = structuredClone(graph);
  delete result.document.id;
  delete result.document.revision;
  return result;
};

/**
 * Typed toolbar-facing transfer boundary. It only handles canonical graph JSON;
 * code source is fail-closed until CP-14 exposes a server generation endpoint.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeDocumentTransferService {
  private readonly graphStore = inject(GraphStoreService);
  private readonly lifecycle = inject(ClearpipeLifecycleService);
  private readonly unsavedWork = inject(ClearpipeUnsavedWorkService);

  exportGraph(): ClearpipeDocumentTransferResult {
    const graph = this.graphStore.graph();
    if (!graph) return {status: 'unavailable', code: 'no_graph_loaded'};

    try {
      const document = portableGraph(graph);
      return {
        status: 'exported',
        document: {
          kind: 'graph',
          filename: filename(document.document.name, 'clearpipe.json'),
          mediaType: 'application/json',
          text: serializeGraphV2(document),
        },
      };
    } catch {
      return {status: 'invalid', errors: [{code: 'invalid_graph', path: 'graph', message: 'The ClearPipe graph cannot be exported.'}]};
    }
  }

  downloadGraph(): ClearpipeDocumentTransferResult {
    const result = this.exportGraph();
    if (result.status !== 'exported' || typeof document === 'undefined' || typeof URL === 'undefined') return result;
    const url = URL.createObjectURL(new Blob([result.document.text], {type: result.document.mediaType}));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.document.filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return result;
  }

  async importGraph(text: string): Promise<ClearpipeDocumentTransferResult> {
    if (new TextEncoder().encode(text).byteLength > maxImportBytes) {
      return {status: 'invalid', errors: [{code: 'import_too_large', path: 'graph', message: 'The ClearPipe import exceeds 4 MiB.'}]};
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return {status: 'invalid', errors: [{code: 'invalid_json', path: 'graph', message: 'The graph document is not valid JSON.'}]};
    }

    const decoded = decodeGraphV2(raw);
    if (decoded.status === 'invalid') return {status: 'invalid', errors: decoded.errors};
    if (decoded.status === 'unsupported') return {status: 'unsupported', unsupported: decoded.unsupported, migration: 'read-only'};

    const imported = portableGraph(decoded.graph);
    const guard = await this.unsavedWork.protect('import', () => {
      if (!this.lifecycle.new(imported.document)) return false;
      return this.graphStore.load(imported).status === 'ok';
    });
    if (!guard.proceeded) return {status: 'cancelled', guard};
    return {status: 'imported', graph: this.graphStore.graph()!, guard};
  }

  exportGeneratedCode(): ClearpipeDocumentTransferResult {
    return {status: 'unavailable', code: 'code_generation_unavailable'};
  }

  importGeneratedCode(source: string): ClearpipeDocumentTransferResult {
    void source;
    return {status: 'unavailable', code: 'code_import_unsupported'};
  }
}
