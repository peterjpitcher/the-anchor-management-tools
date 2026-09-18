'use client'

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteEmployee } from '@/app/actions/employeeActions';
import { Button, Modal } from '@/ds';
import { TrashIcon } from '@heroicons/react/24/outline';
import { useState, useEffect } from 'react';

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

export default function DeleteEmployeeButton({ employeeId, employeeName }: DeleteEmployeeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const initialState = null;
  const [state, dispatch] = useActionState(deleteEmployee, initialState);

  useEffect(() => {
    // Success is handled by redirect in the server action.
    // Error is displayed inline inside the modal; no alert needed.
  }, [state]);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        type="button"
        size="sm"
        variant="danger"
        icon={<TrashIcon className="h-4 w-4" aria-hidden="true" />}
      >
        Delete Employee
      </Button>

      {/* A DS Modal rather than ConfirmDialog: the delete is a server-action form (it redirects
          on success), and the buttons stay inside it so the submit button can read the form's
          pending state. The DS Modal also lifts this above the page (it sat in a z-10 layer). */}
      <Modal open={isOpen} onClose={() => setIsOpen(false)} title="Delete Employee" width="md">
        <form action={dispatch}>
          <p className="text-sm text-text-muted">
            Are you sure you want to delete {employeeName}? This action cannot be undone.
            All associated data (like notes and attachments if configured with CASCADE delete) might also be removed.
          </p>
          {state?.type === 'error' && (
            <p className="mt-3 text-sm text-danger-fg">
              {state.message}
            </p>
          )}
          <input type="hidden" name="employee_id" value={employeeId} />
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <SubmitDeleteButton />
          </div>
        </form>
      </Modal>
    </>
  );
}
