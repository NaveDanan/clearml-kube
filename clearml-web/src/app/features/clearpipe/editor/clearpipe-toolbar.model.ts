import {ClearpipeLifecycleService} from './clearpipe-lifecycle.service';
import {ClearpipeExecutionAction} from './execution/clearpipe-execution.models';

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

export const clearpipeToolbarActions = (
  lifecycle: ClearpipeLifecycleService,
  validationEnabled: boolean,
  runAction: ClearpipeExecutionAction = {
    disabled: true,
    disabledReason: 'Run checks are not available for this ClearPipe definition.',
  },
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
  {
    id: 'import',
    label: 'Import',
    disabled: lifecycle.busy() || lifecycle.readOnly() || lifecycle.capabilities()?.import === false,
    disabledReason: lifecycle.busy()
      ? 'A ClearPipe lifecycle operation is already in progress.'
      : lifecycle.readOnly()
        ? 'This read-only ClearPipe definition cannot be replaced by an import.'
        : lifecycle.capabilities()?.import === false
          ? 'You do not have permission to import a ClearPipe definition.'
          : null,
  },
  {
    id: 'export',
    label: 'Export',
    disabled: lifecycle.graph() === null || lifecycle.capabilities()?.export === false,
    disabledReason: lifecycle.graph() === null
      ? 'There is no ClearPipe graph to export.'
      : lifecycle.capabilities()?.export === false
        ? 'You do not have permission to export this ClearPipe definition.'
        : null,
  },
  {
    id: 'preview',
    label: 'Code preview',
    disabled: !validationEnabled,
    disabledReason: validationEnabled ? null : 'There is no supported ClearPipe graph to generate.',
  },
  {
    id: 'run',
    label: runAction.label ?? 'Run',
    disabled: runAction.disabled,
    disabledReason: runAction.disabledReason,
  },
  {
    id: 'settings',
    label: 'Settings',
    disabled: false,
    disabledReason: null,
  },
];
