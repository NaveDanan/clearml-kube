import {JsonValue} from '../../domain/graph-v2.types';

export type FunctionAuthoringPortType = 'data' | 'artifact' | 'parameter';

export interface FunctionAuthoringPort {
  /** Stable graph port identity. It is never derived from source code. */
  readonly id: string;
  readonly name: string;
  readonly type: FunctionAuthoringPortType;
  readonly required: boolean;
  readonly default?: JsonValue;
}

export interface FunctionAuthoringOutput {
  /** Stable graph port identity; output names may change without changing it. */
  readonly id: string;
  readonly name: string;
  readonly type: Extract<FunctionAuthoringPortType, 'data' | 'artifact'>;
}

export interface FunctionAuthoringDefinition {
  readonly name: string;
  readonly label: string;
  readonly signature: string;
  /**
   * Explicit constrained source. It is submitted unchanged to the canonical
   * graph and is never parsed for signature inference or executed in-browser.
   */
  readonly source: string;
  readonly taskType: string;
  readonly queueResourceId?: string;
  readonly cache: boolean;
  readonly inputs: readonly FunctionAuthoringPort[];
  readonly outputs: readonly FunctionAuthoringOutput[];
  /** CP-06 v2 has no persistence field for these settings yet. */
  readonly packages?: readonly string[];
  readonly retryOnFailure?: number;
  /** CP-06 v2 has no safe function reference metadata field yet. */
  readonly reference?: string;
}

export interface FunctionAuthoringDiagnostic {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

export interface FunctionAuthoringValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly FunctionAuthoringDiagnostic[];
}

export const FUNCTION_AUTHORING_TASK_TYPES = [
  'training',
  'testing',
  'inference',
  'data_processing',
  'application',
  'monitor',
  'controller',
  'optimizer',
  'service',
  'qc',
  'custom',
] as const;
