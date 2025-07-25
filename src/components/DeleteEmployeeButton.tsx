'use client'

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { deleteEmployee } from '@/app/actions/employeeActions';
import { TrashIcon } from '@heroicons/react/24/outline';
import { useState, useEffect } from 'react';

interface DeleteEmployeeButtonProps {
  employeeId: string;
  employeeName: string;
}

function SubmitDeleteButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-500 sm:ml-3 sm:w-auto disabled:opacity-50"
    >
      {pending ? 'Deleting...' : 'Delete'}
    </button>
  );
}

export default function DeleteEmployeeButton({ employeeId, employeeName }: DeleteEmployeeButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const initialState = null;
  const [state, dispatch] = useActionState(deleteEmployee, initialState);

  useEffect(() => {
    if (state?.type === 'error') {
      // If there was an error (e.g. RLS, network), close modal and alert user.
      // The redirect in the action handles success.
      setIsOpen(false);
      alert(`Error: ${state.message}`); // Simple alert for now, consider a toast notification
    }
    // Success case is handled by redirect in server action, so no client-side redirect needed here.
  }, [state]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        type="button"
        className="inline-flex items-center rounded-md px-3 py-2 text-sm font-semibold text-white hover:text-white/80 hover:bg-white/10 transition-colors"
      >
        <TrashIcon className="-ml-0.5 mr-1.5 h-5 w-5" aria-hidden="true" />
        Delete Employee
      </button>

      {isOpen && (
        <div className="relative z-10" aria-labelledby="modal-title" role="dialog" aria-modal="true">
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
          <div className="fixed inset-0 z-10 overflow-y-auto">
            <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
              <form action={dispatch} className="relative transform overflow-hidden rounded-lg bg-white px-4 pt-5 pb-4 text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-lg sm:p-6">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <TrashIcon className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg font-medium leading-6 text-gray-900" id="modal-title">
                      Delete Employee
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete {employeeName}? This action cannot be undone.
                        All associated data (like notes and attachments if configured with CASCADE delete) might also be removed.
                      </p>
                    </div>
                  </div>
                </div>
                {state?.type === 'error' && (
                    <p className="mt-3 text-sm text-red-600 text-center sm:text-left sm:ml-14">
                        {state.message}
                    </p>
                )}
                <input type="hidden" name="employee_id" value={employeeId} />
                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <SubmitDeleteButton />
                  <button
                    type="button"
                    onClick={() => setIsOpen(false)}
                    className="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
} 