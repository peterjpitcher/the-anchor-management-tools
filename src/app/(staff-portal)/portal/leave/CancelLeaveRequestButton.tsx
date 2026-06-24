'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleCancel}
        disabled={isPending}
        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {isPending ? 'Cancelling...' : 'Cancel request'}
      </button>
    </div>
  );
}
