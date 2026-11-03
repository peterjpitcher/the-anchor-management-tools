'use client'

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { deleteEmployee } from '@/app/actions/employeeActions';
import { Alert, Button, Icon, Modal, toast } from '@/ds';
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
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  // The action returns its result rather than redirecting: on success this hook closes the
  // dialog and goes to the list (the employee's own page no longer exists); an error is shown
  // inside the dialog.
  const [state, dispatch, pending] = useActionState(deleteEmployee, null);
  const formId = `delete-employee-${employeeId}`;
  const handledState = useRef<typeof state>(null);

  useEffect(() => {
    if (state?.type !== 'success' || handledState.current === state) return;
    handledState.current = state;
    setIsOpen(false);
    if (state.warning) {
      toast.warning(state.warning, { duration: 10000 });
    } else {
      toast.success(state.message ?? 'Employee deleted.');
    }
    router.push('/employees');
  }, [state, router]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Once it has gone, a second click would only fail.
    if (pending || state?.type === 'success') return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => dispatch(formData));
  };

  const action: EmployeeHeaderAction = {
    key: 'delete',
    label: 'Delete',
    onSelect: () => setIsOpen(true),
    tone: 'danger',
    icon: <Icon name="trash" size={16} />,
  };

  // A DS Modal rather than ConfirmDialog: the delete is a server-action form. Its footer mirrors
  // ConfirmDialog, and the submit button reaches the form through form=, reading the pending
  // state from useActionState.
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
          <Button
            type="submit"
            form={formId}
            variant="danger"
            loading={pending}
            disabled={state?.type === 'success'}
          >
            Delete
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-text-muted">
          Delete {employeeName}? This removes their record, documents, notes, contacts, bank and
          health details, any rota shifts, clock times and holiday already set up for them, their
          pay settings, and their login if they have one. It cannot be undone.
        </p>
        <p className="text-sm text-text-muted">
          Only a new starter who is still onboarding can be deleted. For anyone who has worked here,
          use Begin Separation instead, so their shifts, hours and pay history are kept.
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
