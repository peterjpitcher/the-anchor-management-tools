'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Badge, Button, Textarea } from '@/ds';
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
      <Badge tone="warning">
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
        Request shift
      </Button>
    );
  }

  return (
    // Full width, so the wrapping card row drops it onto its own line below the shift details
    // instead of squeezing a textarea beside them on a phone. The row's gap spaces it.
    <div className="w-full rounded-lg border border-warning-border bg-warning-soft p-3">
      <p className="mb-2 text-xs font-medium text-warning-fg">
        Confirm you want to ask to work this shift.
      </p>
      <label htmlFor={`open-shift-note-${shiftId}`} className="text-xs font-medium text-warning-fg">
        Note for manager (optional)
      </label>
      <Textarea
        id={`open-shift-note-${shiftId}`}
        value={note}
        onChange={event => setNote(event.target.value)}
        maxLength={500}
        rows={3}
        className="mt-1"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" variant="primary" size="sm" onClick={submitRequest} disabled={isPending}>
          {isPending ? 'Sending...' : 'Confirm request'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => { setRequesting(false); setNote(''); }}
          disabled={isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
