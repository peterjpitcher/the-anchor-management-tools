'use client'

import { useActionState, useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteEmployee } from '@/app/actions/employeeActions';
import { Alert, Button, FormFooter, Icon, Modal } from '@/ds';
import { EmployeeActionButton, type EmployeeHeaderAction } from './employeeHeaderActions';

interface DeleteEmployeeButtonProps {
  employeeId: string;
  employeeName: string;
}

function SubmitDeleteButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? 'Deleting...' : 'Delete'}
    </Button>
  );
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
  const [state, dispatch] = useActionState(deleteEmployee, null);

  const action: EmployeeHeaderAction = {
    key: 'delete',
    label: 'Delete Employee',
    onSelect: () => setIsOpen(true),
    tone: 'danger',
    icon: <Icon name="trash" size={16} />,
  };

  // A DS Modal rather than ConfirmDialog: the delete is a server-action form (it redirects on
  // success), and the buttons stay inside it so the submit button can read the form's pending
  // state.
  const dialog = (
    <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Delete Employee" width="md">
      <form action={dispatch} className="space-y-4">
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
        <FormFooter>
          <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
            Cancel
          </Button>
          <SubmitDeleteButton />
        </FormFooter>
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
