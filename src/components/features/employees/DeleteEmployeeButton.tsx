'use client'

import { useActionState, useState, type ReactNode } from 'react';
import { deleteEmployee } from '@/app/actions/employeeActions';
import { Alert, Button, Icon, Modal } from '@/ds';
import { EmployeeActionButton, type EmployeeHeaderAction } from './employeeHeaderActions';

interface DeleteEmployeeButtonProps {
  employeeId: string;
  employeeName: string;
}

/**
 * The Delete Employee action and its dialog, returned separately so the page can offer the action
 * as a button or as an item in the phone "More" menu while the dialog stays mounted outside it.
 */
export function useDeleteEmployeeAction({
  employeeId,
  employeeName,
}: DeleteEmployeeButtonProps): { action: EmployeeHeaderAction; dialog: ReactNode } {
  const [isOpen, setIsOpen] = useState(false);
  // Success is handled by redirect in the server action; an error is shown inside the dialog.
  const [state, dispatch, pending] = useActionState(deleteEmployee, null);
  const formId = `delete-employee-${employeeId}`;

  const action: EmployeeHeaderAction = {
    key: 'delete',
    label: 'Delete',
    onSelect: () => setIsOpen(true),
    tone: 'danger',
    icon: <Icon name="trash" size={16} />,
  };

  // A DS Modal rather than ConfirmDialog: the delete is a server-action form (it redirects on
  // success). Its footer mirrors ConfirmDialog, and the submit button reaches the form through
  // form=, reading the pending state from useActionState.
  const dialog = (
    <Modal
      open={isOpen}
      onClose={() => setIsOpen(false)}
      title="Delete Employee"
      width="sm"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={pending}>
            Delete
          </Button>
        </>
      }
    >
      <form id={formId} action={dispatch} className="space-y-4">
        <p className="text-sm text-text-muted">
          Are you sure you want to delete {employeeName}? This action cannot be undone.
          All associated data (like notes and attachments if configured with CASCADE delete) might also be removed.
        </p>
        {state?.type === 'error' && (
          <Alert tone="danger" size="sm">
            {state.message}
          </Alert>
        )}
        <input type="hidden" name="employee_id" value={employeeId} />
      </form>
    </Modal>
  );

  return { action, dialog };
}

export default function DeleteEmployeeButton(props: DeleteEmployeeButtonProps): React.JSX.Element {
  const { action, dialog } = useDeleteEmployeeAction(props);
  return (
    <>
      <EmployeeActionButton action={action} />
      {dialog}
    </>
  );
}
