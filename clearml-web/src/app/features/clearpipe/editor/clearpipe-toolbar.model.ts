import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';

export type ClearpipeToolbarActionId =
  | 'new'
  | 'save'
  | 'open'
  | 'validate'
  | 'import'
  | 'export'
  | 'preview'
  | 'run'
  | 'settings';

export interface ClearpipeToolbarAction {
  id: ClearpipeToolbarActionId;
  label: string;
  disabled: boolean;
  disabledReason: string | null;
}

const unavailable = (label: string, disabledReason: string): ClearpipeToolbarAction => ({
  id: label.toLowerCase().replaceAll(' ', '-') as ClearpipeToolbarActionId,
  label,
  disabled: true,
  disabledReason,
});

export const clearpipeToolbarActions = (
  lifecycle: ClearpipeLifecycleService,
  validationEnabled: boolean,
): readonly ClearpipeToolbarAction[] => [
  {
    id: 'new',
    label: 'New',
    disabled: lifecycle.busy(),
    disabledReason: lifecycle.busy() ? 'A ClearPipe lifecycle operation is already in progress.' : null,
  },
  {
    id: 'save',
    label: 'Save',
    disabled: !lifecycle.canSave(),
    disabledReason: lifecycle.saveDisabledReason(),
  },
  {
    id: 'open',
    label: 'Open',
    disabled: lifecycle.busy(),
    disabledReason: lifecycle.busy() ? 'A ClearPipe lifecycle operation is already in progress.' : null,
  },
  {
    id: 'validate',
    label: 'Validate',
    disabled: !validationEnabled,
    disabledReason: validationEnabled ? null : 'There is no supported ClearPipe graph to validate.',
  },
  unavailable('Import', 'Import is unavailable until CP-22 publishes ClearpipeDocumentTransferService.'),
  unavailable('Export', 'Export is unavailable until CP-22 publishes ClearpipeDocumentTransferService.'),
  {
    id: 'preview',
    label: 'Code preview',
    disabled: !validationEnabled,
    disabledReason: validationEnabled ? null : 'There is no supported ClearPipe graph to generate.',
  },
  unavailable('Run', 'Run is owned by CP-26 and is unavailable until its approved execution hook is delivered.'),
  {
    id: 'settings',
    label: 'Settings',
    disabled: false,
    disabledReason: null,
  },
];
