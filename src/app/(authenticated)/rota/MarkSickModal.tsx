'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Alert, Button, FormGroup } from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import { markEmployeeCouldntWork, markShiftSick } from '@/app/actions/rota';
import type { RotaShift } from '@/app/actions/rota';

interface MarkSickModalProps {
  shift?: RotaShift | null;
  weekId?: string;
  employeeId?: string;
  shiftDate?: string;
  employeeName: string;
  onClose: () => void;
  onMarked: (shift: RotaShift) => void;
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function MarkSickModal({
  shift,
  weekId,
  employeeId,
  shiftDate,
  employeeName,
  onClose,
  onMarked,
}: MarkSickModalProps) {
  const [reason, setReason] = useState(shift?.sick_reason ?? '');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleSubmit = () => {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setError("Couldn't Work reason is required");
      return;
    }

    setError('');
    startTransition(async () => {
      const result = shift
        ? await markShiftSick(shift.id, trimmedReason)
        : await markEmployeeCouldntWork({
            weekId: weekId ?? '',
            employeeId: employeeId ?? '',
            shiftDate: shiftDate ?? '',
            reason: trimmedReason,
          });
      if (!result.success) {
        toast.error(result.error);
        return;
      }

      toast.success("Shift marked as Couldn't Work");
      onMarked(result.data);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-xl bg-surface shadow-xl"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-border p-5">
          <div>
            <h2 className="text-lg font-semibold text-text-strong">Mark as Couldn&apos;t Work</h2>
            <p className="text-sm text-text-muted">{formatDate(shift?.shift_date ?? shiftDate ?? '')}</p>
            <p className="mt-0.5 text-sm font-medium text-text-strong">{employeeName}</p>
            {shift ? (
              <p className="mt-1 text-sm text-text-muted">
                {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
              </p>
            ) : (
              <p className="mt-1 text-sm text-text-muted">No shift scheduled</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-text-subtle hover:text-text-muted"
            aria-label="Close"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <Alert variant="error">{error}</Alert>}

          <FormGroup label="Reason" htmlFor="sick-reason" required>
            <textarea
              id="sick-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              maxLength={500}
              rows={4}
              className="w-full rounded-default border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-[border-color,box-shadow] focus:border-border-focus focus:shadow-ring"
              placeholder="e.g. Unable to work, flu symptoms"
            />
          </FormGroup>

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Saving...' : "Mark Couldn't Work"}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
