'use client';

import { useState, useTransition } from 'react';
import { Alert, Button, Field, Modal, Textarea, toast } from '@/ds';
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

// A shift date is a plain day: read as a UTC midnight and formatted in UTC, so it never moves.
function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
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
  const dateIso = shift?.shift_date ?? shiftDate;

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
    <Modal
      open
      onClose={onClose}
      title="Mark as Couldn't Work"
      description={dateIso ? `${employeeName}, ${formatDate(dateIso)}` : employeeName}
      width="md"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} loading={isPending}>
            Mark as Couldn&apos;t Work
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-text-muted">
          {shift
            ? `Shift ${formatTime12Hour(shift.start_time)} to ${formatTime12Hour(shift.end_time)}`
            : 'No shift scheduled'}
        </p>

        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Reason" htmlFor="sick-reason" required>
          <Textarea
            id="sick-reason"
            value={reason}
            onChange={event => setReason(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="e.g. Unable to work, flu symptoms"
          />
        </Field>
      </div>
    </Modal>
  );
}
