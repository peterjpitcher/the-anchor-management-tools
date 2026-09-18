'use client';

import { useEffect, useActionState } from 'react';
import { inviteEmployee } from '@/app/actions/employeeInvite';
import { Button, Input, Modal, toast } from '@/ds';

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

  // The buttons stay inside the form (not the Modal footer) so Send Invite submits it.
  return (
    <Modal open onClose={onClose} title="Invite Employee" width="md">
      <p className="text-sm text-text-muted mb-6">
        Enter the employee&apos;s email address. They will receive an invite to create their account and complete their profile.
      </p>

      <form action={formAction} className="space-y-4">
        <Input
          id="invite-email"
          name="email"
          type="email"
          label="Email address"
          required
          autoFocus
          placeholder="employee@example.com"
        />

        <Input
          id="invite-job-title"
          name="job_title"
          type="text"
          label="Job title"
          placeholder="e.g. Bar Staff"
        />

        <Input
          id="invite-start-date"
          name="employment_start_date"
          type="date"
          label="Employment start date"
          required
          hint="Set now so their length of service is right from day one. Completing onboarding does not ask for it, so this is the only place it gets recorded."
        />

        {state?.type === 'error' && (
          <p className="text-sm text-danger-fg">{state.message}</p>
        )}

        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? 'Sending...' : 'Send Invite'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
