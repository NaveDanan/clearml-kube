import {ClearpipeResourceOption} from '../clearpipe.models';

export type ClearpipeResourceKind =
  | 'project'
  | 'task'
  | 'dataset'
  | 'dataset-version'
  | 'queue'
  | 'model'
  | 'template'
  | 'component'
  | 'credential';

export type ClearpipeAdapterResourceType = Extract<
  ClearpipeResourceOption['type'],
  'project' | 'task' | 'dataset' | 'queue' | 'model'
>;

export type ClearpipeResourceQueryStatus =
  | 'idle'
  | 'loading'
  | 'refreshing'
  | 'ready'
  | 'empty'
  | 'error'
  | 'stale'
  | 'deleted'
  | 'denied'
  | 'unavailable';

export type ClearpipeResourceResolutionStatus =
  | 'available'
  | 'missing'
  | 'denied'
  | 'stale'
  | 'pending'
  | 'unavailable';

export interface ClearpipeResourceRegistration {
  readonly kind: ClearpipeResourceKind;
  readonly label: string;
  readonly adapterType?: ClearpipeAdapterResourceType;
  readonly supportsManagement: boolean;
  readonly unavailableMessage?: string;
}

/**
 * Only these adapter-backed resource kinds have a verified ClearML inventory
 * operation. The unavailable registrations intentionally fail closed instead
 * of inventing a client or a fake selector.
 */
export const CLEARPIPE_RESOURCE_REGISTRATIONS: Readonly<Record<ClearpipeResourceKind, ClearpipeResourceRegistration>> = {
  project: {kind: 'project', label: 'Project', adapterType: 'project', supportsManagement: true},
  task: {kind: 'task', label: 'Task', adapterType: 'task', supportsManagement: true},
  dataset: {kind: 'dataset', label: 'Dataset', adapterType: 'dataset', supportsManagement: true},
  'dataset-version': {
    kind: 'dataset-version',
    label: 'Dataset version',
    supportsManagement: false,
    unavailableMessage: 'Dataset versions are not available through the authorized ClearPipe resource adapter.',
  },
  queue: {kind: 'queue', label: 'Queue', adapterType: 'queue', supportsManagement: true},
  model: {kind: 'model', label: 'Model', adapterType: 'model', supportsManagement: true},
  template: {
    kind: 'template',
    label: 'Template',
    supportsManagement: false,
    unavailableMessage: 'Templates are not available through the authorized ClearPipe resource adapter.',
  },
  component: {
    kind: 'component',
    label: 'Component',
    supportsManagement: false,
    unavailableMessage: 'Components are not available through the authorized ClearPipe resource adapter.',
  },
  credential: {
    kind: 'credential',
    label: 'Credential',
    supportsManagement: false,
    unavailableMessage: 'Credentials may only be supplied as existing opaque references.',
  },
};

export interface ClearpipeResourceSummary {
  /** Server-authoritative immutable ClearML identity. */
  readonly id: string;
  readonly kind: ClearpipeResourceKind;
  readonly name: string;
  readonly project?: string;
  readonly version?: string;
  readonly type?: string;
  readonly status?: string;
  readonly tags?: readonly string[];
  readonly updatedAt?: string;
}

export interface ClearpipeResourceFilter {
  readonly search?: string;
  readonly project?: string;
  readonly tags?: readonly string[];
  readonly pageSize?: number;
}

export interface ClearpipeResourceProblem {
  readonly code: 'denied' | 'unavailable' | 'request_failed' | 'unsupported';
  readonly retryable: boolean;
}

export interface ClearpipeResourceQueryState {
  readonly kind: ClearpipeResourceKind;
  readonly status: ClearpipeResourceQueryStatus;
  readonly filter: ClearpipeResourceFilter;
  readonly items: readonly ClearpipeResourceSummary[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly updatedAt?: number;
  readonly problem?: ClearpipeResourceProblem;
}

export interface ClearpipeResourceSelection {
  readonly resource: ClearpipeResourceSummary;
  readonly reference: ClearpipeResourceReference;
}

/** Safe for graph/form state: it contains an identity and optional display label only. */
export interface ClearpipeResourceReference {
  readonly kind: ClearpipeResourceKind;
  readonly resource_id: string;
  readonly label?: string;
}

export interface ClearpipeResourceManagementLink {
  readonly commands: readonly string[];
  readonly label: string;
}

/**
 * A credential reference is intentionally opaque. Values, connection strings,
 * URLs with credentials, and browser-persisted credential state are excluded.
 */
export interface ClearpipeCredentialReference {
  readonly reference: string;
  readonly label: string;
  readonly management?: ClearpipeResourceManagementLink;
}

export interface ClearpipeResourceResolverRequest {
  readonly kind: ClearpipeResourceKind;
  readonly resource_id: string;
  readonly lookup?: Readonly<Record<'name' | 'project', string>>;
}

/** Mirrors CP-11's value-safe ResourceResolution: status only, never details. */
export interface ClearpipeResourceResolverOutput {
  readonly status: ClearpipeResourceResolutionStatus;
}

export interface ClearpipeResourceSelectionState {
  readonly status: 'selected' | 'none' | 'deleted' | 'denied' | 'stale' | 'pending' | 'unavailable';
  readonly resource?: ClearpipeResourceSummary;
}

export const clearpipeResourceReference = (resource: ClearpipeResourceSummary): ClearpipeResourceReference => ({
  kind: resource.kind,
  resource_id: resource.id,
  ...(resource.name ? {label: resource.name} : {}),
});

export const normalizeClearpipeResource = (
  kind: ClearpipeResourceKind,
  resource: Pick<ClearpipeResourceOption, 'id' | 'name' | 'project'>
): ClearpipeResourceSummary => ({
  id: String(resource.id),
  kind,
  name: String(resource.name),
  ...(resource.project ? {project: String(resource.project)} : {}),
  type: kind,
});

export const isSafeCredentialReference = (reference: ClearpipeCredentialReference): boolean => {
  const value = reference.reference.trim();
  if (!value || value.length > 256) return false;
  if (/^https?:\/\/[^/]+:[^@]+@/i.test(value)) return false;
  if (/(?:^|[_-])(password|passwd|api[_-]?key|access[_-]?key|private[_-]?key)(?:$|[_-])/i.test(value)) return false;
  return !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
};
