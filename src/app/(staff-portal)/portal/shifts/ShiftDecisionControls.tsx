'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { acceptPortalShift, rejectPortalShift, type ShiftAcceptanceStatus } from '@/app/actions/rota';
import { validateShiftRejectionReason } from '@/lib/rota/shift-rejection-validation';

type Props = {
  shiftId: string;
  acceptanceStatus: ShiftAcceptanceStatus | null;
  acceptedAt: string | null;
  autoAcceptReason: string | null;
  autoAcceptDeadline: string;
};

function formatDateTime(value: string | null): string | null {
  if (!value) return null;
  return new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ShiftDecisionControls({
  shiftId,
  acceptanceStatus,
  acceptedAt,
  autoAcceptReason,
  autoAcceptDeadline,
}: Props) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [isPending, startTransition] = useTransition();

  const acceptedLabel = acceptanceStatus === 'auto_accepted' ? 'Auto-accepted' : 'Accepted';
  const acceptedTime = formatDateTime(acceptedAt);

  if (acceptanceStatus === 'accepted' || acceptanceStatus === 'auto_accepted') {
    return (
      <div className="mt-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-xs text-green-800">
        <p className="font-semibold">
          {acceptedLabel}{acceptedTime ? ` ${acceptedTime}` : ''}
        </p>
        {acceptanceStatus === 'auto_accepted' && autoAcceptReason && (
          <p className="mt-1 text-green-700">{autoAcceptReason}</p>
        )}
        {acceptanceStatus === 'accepted' && (
          <p className="mt-1 text-green-700">Need to change it? Please contact Billy.</p>
        )}
      </div>
    );
  }

  if (acceptanceStatus !== 'pending') return null;

  function onAccept() {
    startTransition(async () => {
      const result = await acceptPortalShift(shiftId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message || 'Shift accepted');
      router.refresh();
    });
  }

  function onReject() {
    const validation = validateShiftRejectionReason(note);
    if (!validation.valid) {
      toast.error(validation.error);
      return;
    }

    startTransition(async () => {
      const result = await rejectPortalShift({ shiftId, note: validation.reason });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message || 'Shift rejected');
      setRejecting(false);
      setNote('');
      router.refresh();
    });
  }

  return (
    <div className="mt-3 space-y-2">
      {!rejecting ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-medium text-amber-900">
              Please accept or reject this shift.
            </p>
            <p className="mt-0.5 text-xs text-amber-800">
              Auto-accepts on {autoAcceptDeadline}.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={onAccept}
              disabled={isPending}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white shadow-xs hover:bg-green-700 disabled:opacity-50"
              aria-label="Accept shift"
              title="Accept shift"
            >
              <CheckIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setRejecting(true)}
              disabled={isPending}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-red-200 bg-white text-red-700 shadow-xs hover:bg-red-50 disabled:opacity-50"
              aria-label="Reject shift"
              title="Reject shift"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3">
          <label htmlFor={`reject-note-${shiftId}`} className="text-xs font-medium text-red-900">
            Reason for manager
          </label>
          <textarea
            id={`reject-note-${shiftId}`}
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={500}
            required
            rows={3}
            className="mt-1 w-full rounded-md border border-red-100 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-red-300"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onReject}
              disabled={isPending}
              className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-50"
            >
              {isPending ? 'Saving...' : 'Confirm reject'}
            </button>
            <button
              type="button"
              onClick={() => { setRejecting(false); setNote(''); }}
              disabled={isPending}
              className="rounded-md border border-red-100 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
