import {Injectable, inject} from '@angular/core';
import {GraphBinding} from '../../domain/graph-v2.types';
import {GraphBindingInput, GraphCommandResult, GraphCommandWithId, GraphStoreService} from '../../domain/graph-store.service';
import {
  evaluateSemanticEdge,
  SemanticEdgeEligibility,
  SemanticPortLocation,
} from './clearpipe-port-compatibility';

export interface SemanticEdgeCommandResult extends SemanticEdgeEligibility {
  readonly command: GraphCommandResult | GraphCommandWithId | null;
  readonly id?: string;
}

const withoutCommand = (eligibility: SemanticEdgeEligibility): SemanticEdgeCommandResult => ({...eligibility, command: null});

/**
 * Issues graph commands only after the pure compatibility gateway accepts the
 * current canonical graph. This service intentionally owns no graph copy.
 */
@Injectable({providedIn: 'root'})
export class ClearpipeSemanticEdgeController {
  private readonly store = inject(GraphStoreService);

  evaluate(candidate: GraphBindingInput, replacingBindingId?: string): SemanticEdgeEligibility {
    return evaluateSemanticEdge(this.store.graph(), candidate, replacingBindingId);
  }

  create(candidate: GraphBindingInput): SemanticEdgeCommandResult {
    const eligibility = this.evaluate(candidate);
    if (!eligibility.eligible) return withoutCommand(eligibility);
    const command = this.store.createBinding(candidate);
    return command.ok
      ? {...eligibility, command, id: command.id}
      : {...this.commandRejection(command), command};
  }

  reconnect(bindingId: string, candidate: Omit<GraphBindingInput, 'id'>): SemanticEdgeCommandResult {
    const existing = this.store.bindings().find((binding) => binding.id === bindingId);
    if (!existing) return withoutCommand({
      eligible: false,
      reason: 'unknown_binding',
      message: 'The selected binding no longer exists.',
    });
    const replacement = {...candidate, id: bindingId} as GraphBinding;
    const eligibility = this.evaluate(replacement, bindingId);
    if (!eligibility.eligible) return withoutCommand(eligibility);
    const command = this.store.replaceBinding(bindingId, replacement);
    return command.ok ? {...eligibility, command, id: bindingId} : {...this.commandRejection(command), command};
  }

  remove(bindingId: string): SemanticEdgeCommandResult {
    const command = this.store.removeBinding(bindingId);
    return command.ok
      ? {eligible: true, reason: null, message: 'Connection removed.', command, id: bindingId}
      : {...this.commandRejection(command), command};
  }

  connectPorts(
    source: SemanticPortLocation,
    target: SemanticPortLocation,
    kind: Extract<GraphBinding['kind'], 'data' | 'artifact'>,
    replacingBindingId?: string,
  ): SemanticEdgeCommandResult {
    const candidate = {
      kind,
      source: {kind: 'port' as const, ...source},
      target: {kind: 'port' as const, ...target},
    };
    return replacingBindingId
      ? this.reconnect(replacingBindingId, candidate)
      : this.create(candidate);
  }

  private commandRejection(command: GraphCommandResult): SemanticEdgeEligibility {
    const issue = command.errors[0];
    return {
      eligible: false,
      reason: issue?.code === 'graph_cycle' ? 'graph_cycle' : 'invalid_binding',
      message: issue?.message || 'The canonical graph rejected this connection.',
    };
  }
}
