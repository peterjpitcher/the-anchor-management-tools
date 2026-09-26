'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@/ds';
import { cancelOwnLeaveRequest } from '@/app/actions/leave';

interface CancelLeaveRequestButtonProps {
  requestId: string;
}

export function CancelLeaveRequestButton({ requestId }: CancelLeaveRequestButtonProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleCancel = () => {
    setError('');
    startTransition(async () => {
      const result = await cancelOwnLeaveRequest(requestId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="mt-3 space-y-2">
      {error && (
        <Alert tone="danger" size="sm">
          {error}
        </Alert>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleCancel}
        disabled={isPending}
      >
        {isPending ? 'Cancelling...' : 'Cancel Request'}
      </Button>
    </div>
  );
}
