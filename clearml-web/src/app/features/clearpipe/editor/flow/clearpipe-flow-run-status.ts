import {ClearpipeExecutionNodeSnapshot} from '../../clearpipe-api.service';
import {ClearpipeFlowStatus} from './clearpipe-flow.models';

export interface FlowRunNodeStatus {
  status: ClearpipeFlowStatus;
  message?: string;
}

/**
 * Map one backend execution-snapshot node record to the flow canvas status.
 * Returns null when the record carries no usable state, so the caller leaves the
 * node's current status untouched (e.g. still "pending" until it starts).
 */
export const mapSnapshotNodeStatus = (
  record: ClearpipeExecutionNodeSnapshot,
): FlowRunNodeStatus | null => {
  if (record.record_status === 'unavailable') return null;
  const status = (record.status ?? '').toLowerCase();
  if (record.result === 'failure' || status === 'failed') return {status: 'error', message: 'Failed'};
  switch (status) {
    case 'created':
    case 'queued':
    case 'pending':
      return {status: 'pending', message: 'Pending'};
    case 'in_progress':
    case 'running':
      return {status: 'running', message: 'Running'};
    case 'completed':
    case 'published':
    case 'closed':
    case 'cached':
      return {status: 'completed', message: 'Completed'};
    case 'stopped':
    case 'aborted':
      return {status: 'stopped', message: 'Stopped'};
    case 'skipped':
      return {status: 'warning', message: 'Skipped'};
    default:
      return null;
  }
};

/** Controller statuses that mean the run is finished (polling can stop). */
export const TERMINAL_CONTROLLER_STATUSES = new Set([
  'completed',
  'failed',
  'stopped',
  'aborted',
  'closed',
  'published',
]);
