'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, FormFooter, IconButton, Textarea, toast, Icon } from '@/ds';
import { acceptPortalShift, rejectPortalShift, type ShiftAcceptanceStatus } from '@/app/actions/rota';
import { rotaShiftStatusClasses } from '@/lib/rota/status-ui';
import { validateShiftRejectionReason } from '@/lib/rota/shift-rejection-validation';
import { cn } from '@/lib/utils';
import { SHIFT_CONFIRM_PANEL_CLASSES } from '../_shared/status-ui';

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
      <div className={`mt-2 rounded-lg border px-3 py-2 text-xs ${rotaShiftStatusClasses(acceptanceStatus)}`}>
        <p className="font-semibold">
          {acceptedLabel}{acceptedTime ? ` ${acceptedTime}` : ''}
        </p>
        {acceptanceStatus === 'auto_accepted' && autoAcceptReason && (
          <p className="mt-1">{autoAcceptReason}</p>
        )}
        {acceptanceStatus === 'accepted' && (
          <p className="mt-1">Need to change it? Please contact Billy.</p>
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
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2 ${rotaShiftStatusClasses('pending')}`}>
          <div className="min-w-0">
            <p className="text-xs font-medium">
              Please accept or reject this shift.
            </p>
            <p className="mt-0.5 text-xs">
              Auto-accepts on {autoAcceptDeadline}.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <IconButton
              type="button"
              variant="primary"
              onClick={onAccept}
              disabled={isPending}
              label="Accept Shift"
              title="Accept Shift"
              icon={<Icon name="check" size={16} />}
            />
            <IconButton
              type="button"
              variant="secondary"
              onClick={() => setRejecting(true)}
              disabled={isPending}
              label="Reject Shift"
              title="Reject Shift"
              icon={<Icon name="x" size={16} />}
            />
          </div>
        </div>
      ) : (
        <div className={cn('space-y-3', SHIFT_CONFIRM_PANEL_CLASSES.reject)}>
          <Textarea
            id={`reject-note-${shiftId}`}
            label="Reason for manager"
            value={note}
            onChange={event => setNote(event.target.value)}
            maxLength={500}
            required
            rows={3}
          />
          <FormFooter>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => { setRejecting(false); setNote(''); }}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={onReject} disabled={isPending}>
              {isPending ? 'Saving...' : 'Confirm Reject'}
            </Button>
          </FormFooter>
        </div>
      )}
    </div>
  );
}
