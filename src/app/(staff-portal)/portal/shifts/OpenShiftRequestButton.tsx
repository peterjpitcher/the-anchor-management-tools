'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, FormFooter, Textarea, toast } from '@/ds';
import { OPEN_SHIFT_REQUESTED_TONE, SHIFT_CONFIRM_PANEL_CLASSES } from '../_shared/status-ui';
import { cn } from '@/lib/utils';
import { requestOpenShift } from '@/app/actions/rota';

type Props = {
  shiftId: string;
  alreadyRequested: boolean;
};

export default function OpenShiftRequestButton({ shiftId, alreadyRequested }: Props) {
  const router = useRouter();
  const [requesting, setRequesting] = useState(false);
  const [note, setNote] = useState('');
  const [isPending, startTransition] = useTransition();

  if (alreadyRequested) {
    return (
      <Badge tone={OPEN_SHIFT_REQUESTED_TONE}>
        Requested
      </Badge>
    );
  }

  function submitRequest() {
    startTransition(async () => {
      const result = await requestOpenShift({ shiftId, note: note.trim() || null });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Request sent to manager');
      setRequesting(false);
      setNote('');
      router.refresh();
    });
  }

  if (!requesting) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setRequesting(true)}>
        Request Shift
      </Button>
    );
  }

  return (
    // Full width, so the wrapping card row drops it onto its own line below the shift details
    // instead of squeezing a textarea beside them on a phone. The row's gap spaces it.
    <div className={cn('w-full space-y-3', SHIFT_CONFIRM_PANEL_CLASSES.request)}>
      <p className="text-xs font-medium text-warning-fg">
        Confirm you want to ask to work this shift.
      </p>
      <Textarea
        id={`open-shift-note-${shiftId}`}
        label="Note for manager (optional)"
        value={note}
        onChange={event => setNote(event.target.value)}
        maxLength={500}
        rows={3}
      />
      <FormFooter>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => { setRequesting(false); setNote(''); }}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={submitRequest} disabled={isPending}>
          {isPending ? 'Sending...' : 'Confirm Request'}
        </Button>
      </FormFooter>
    </div>
  );
}
