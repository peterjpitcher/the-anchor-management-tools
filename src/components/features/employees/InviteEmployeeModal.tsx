'use client';

import { useEffect, useActionState } from 'react';
import { inviteEmployee } from '@/app/actions/employeeInvite';
import { toast } from '@/components/ui-v2/feedback/Toast';

interface InviteEmployeeModalProps {
  onClose: () => void;
  onSuccess?: (employeeId: string) => void;
}

export default function InviteEmployeeModal({ onClose, onSuccess }: InviteEmployeeModalProps) {
  const [state, formAction, pending] = useActionState(inviteEmployee, null);

  useEffect(() => {
    if (state?.type === 'success') {
      toast.success(state.message || 'Invite sent successfully.');
      if (onSuccess && (state as any).employeeId) {
        onSuccess((state as any).employeeId);
      }
      onClose();
    }
  }, [state, onSuccess, onClose]);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-gray-500 bg-opacity-75" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-md rounded-lg bg-white shadow-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Invite Employee</h2>
          <p className="text-sm text-gray-500 mb-6">
            Enter the employee&apos;s email address. They will receive an invite to create their account and complete their profile.
          </p>

          <form action={formAction} className="space-y-4">
            <div>
              <label htmlFor="invite-email" className="block text-sm font-medium text-gray-700 mb-1">
                Email address
              </label>
              <input
                id="invite-email"
                name="email"
                type="email"
                required
                autoFocus
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
                placeholder="employee@example.com"
              />
            </div>

            {state?.type === 'error' && (
              <p className="text-sm text-red-600">{state.message}</p>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
              >
                {pending ? 'Sending...' : 'Send Invite'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
