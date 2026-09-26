'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, ConfirmDialog } from '@/ds';
import { cancelOwnLeaveRequest } from '@/app/actions/leave';

interface CancelLeaveRequestButtonProps {
  requestId: string;
}

/**
 * Withdraws a pending holiday request. Cancelling deletes the request, so it asks first; a
 * failure shows beside the button once the dialog has closed.
 */
export function CancelLeaveRequestButton({ requestId }: CancelLeaveRequestButtonProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = async (): Promise<void> => {
    setError('');
    const result = await cancelOwnLeaveRequest(requestId);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  };

  return (
    <div className="mt-3 space-y-2">
      {error && (
        <Alert tone="danger" size="sm">
          {error}
        </Alert>
      )}
      <Button type="button" variant="danger" size="sm" onClick={() => setConfirmOpen(true)}>
        Cancel Request
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        title="Cancel Request"
        message="Your request is withdrawn and your manager will no longer see it. To take this time off, send a new request."
        confirmLabel="Cancel Request"
        cancelLabel="Keep Request"
        tone="danger"
      />
    </div>
  );
}
