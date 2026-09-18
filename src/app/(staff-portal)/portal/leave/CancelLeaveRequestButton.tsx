'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/ds';
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
        <p role="alert" className="rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger-fg">
          {error}
        </p>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={handleCancel}
        disabled={isPending}
        className="border-danger-border text-danger-fg hover:bg-danger-soft"
      >
        {isPending ? 'Cancelling...' : 'Cancel request'}
      </Button>
    </div>
  );
}
