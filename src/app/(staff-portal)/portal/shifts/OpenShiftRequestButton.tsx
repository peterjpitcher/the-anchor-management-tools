'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
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
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
        Requested
      </span>
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
      <button
        type="button"
        onClick={() => setRequesting(true)}
        className="rounded-md border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
      >
        Request shift
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <label htmlFor={`open-shift-note-${shiftId}`} className="text-xs font-medium text-amber-900">
        Note for manager (optional)
      </label>
      <textarea
        id={`open-shift-note-${shiftId}`}
        value={note}
        onChange={event => setNote(event.target.value)}
        maxLength={500}
        rows={3}
        className="mt-1 w-full rounded-md border border-amber-100 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-amber-300"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submitRequest}
          disabled={isPending}
          className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
        >
          {isPending ? 'Sending...' : 'Send request'}
        </button>
        <button
          type="button"
          onClick={() => { setRequesting(false); setNote(''); }}
          disabled={isPending}
          className="rounded-md border border-amber-100 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
