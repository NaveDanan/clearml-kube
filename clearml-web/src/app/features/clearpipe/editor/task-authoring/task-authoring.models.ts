import {ClearpipeTaskDescriptor} from '../../clearpipe-api.service';
import {JsonValue, Point} from '../../domain/graph-v2.types';
import {ClearpipeResourceSummary} from '../../resources/clearpipe-resource.models';

export interface TaskAuthoringDefinition {
  /** The authorized inventory identity selected by the user, never a runtime child ID. */
  readonly selectedTaskId: string;
  /** Safe server descriptor returned for the selected immutable base task. */
  readonly descriptor: ClearpipeTaskDescriptor;
  readonly name: string;
  readonly label: string;
  readonly cloneBaseTask: boolean;
  readonly cache: boolean;
  readonly retryOnFailure?: number;
  /** Existing canonical graph resource ID, retained when the queue is unchanged. */
  readonly queueResourceId?: string;
  /** An authorized queue summary selected through CP-18, if the queue changed. */
  readonly queue?: ClearpipeResourceSummary;
  /** Explicit task-parameter overrides keyed by stable descriptor-derived port ID. */
  readonly parameterDefaults: Readonly<Record<string, JsonValue | undefined>>;
  readonly placement?: Point;
}

export interface TaskAuthoringDiagnostic {
  readonly code: string;
  readonly field: string;
  readonly message: string;
}

export interface TaskAuthoringValidation {
  readonly valid: boolean;
  readonly diagnostics: readonly TaskAuthoringDiagnostic[];
}

export type TaskAuthoringDescriptorState =
  | {readonly status: 'idle' | 'loading'}
  | {readonly status: 'available' | 'stale'; readonly descriptor: ClearpipeTaskDescriptor}
  | {readonly status: 'unavailable'; readonly message: string; readonly retryable: boolean};

/** CP-14 designates this server-projected flag as the base-task authority. */
export const isEligibleTaskDescriptor = (descriptor: ClearpipeTaskDescriptor): boolean =>
  descriptor.base_task_eligible === true && Boolean(descriptor.identity.task_id.trim());

/** Inventory pages contain only eligible tasks; fail closed for any other source. */
export const isEligibleTaskSummary = (
  resource: Pick<ClearpipeResourceSummary, 'kind' | 'taskBaseEligible'>,
): boolean => resource.kind === 'task' && resource.taskBaseEligible === true;

/**
 * A stale descriptor is usable only after the user acknowledges this exact
 * server-returned timestamp. Missing timestamps fail closed for stale input.
 */
export const taskDescriptorConfirmationToken = (descriptor: ClearpipeTaskDescriptor): string | null => {
  const updatedAt = descriptor.context.updated_at?.trim();
  return updatedAt ? `${descriptor.identity.task_id}\u0000${updatedAt}` : null;
};

export const isStaleDescriptorConfirmed = (
  state: TaskAuthoringDescriptorState,
  confirmationToken: string | null,
): boolean => state.status === 'stale'
  && confirmationToken !== null
  && confirmationToken === taskDescriptorConfirmationToken(state.descriptor);

export interface TaskArtifactSuggestion {
  readonly nodeId: string;
  readonly portId: string;
  readonly label: string;
}

export interface TaskExecutionParentSuggestion {
  readonly nodeId: string;
  readonly label: string;
}

const encodeStableToken = (value: string): string =>
  Array.from(value).map(character => character.codePointAt(0)!.toString(16).padStart(6, '0')).join('_');

/** Stable graph-port IDs are derived from descriptor identity, never display labels. */
export const taskParameterPortId = (section: string, name: string): string =>
  `parameter_${encodeStableToken(section)}_${encodeStableToken(name)}`;

/** Artifact port IDs likewise retain the immutable descriptor artifact key. */
export const taskArtifactPortId = (artifactId: string): string => `artifact_${encodeStableToken(artifactId)}`;

/** Resource IDs are graph-local stable IDs; the ClearML ID remains resource_id. */
export const taskQueueResourceId = (queueId: string): string => `queue_${encodeStableToken(queueId)}`;

export const taskParameterPortName = (section: string, name: string): string => `${section}/${name}`;

export const taskStepName = (taskName: string): string => {
  const normalized = taskName.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const safe = normalized.replace(/^[^A-Za-z]+/, '');
  return safe ? `task_${safe}` : 'task_step';
};
