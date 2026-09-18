'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { Alert, Button, FormGroup, Modal, Textarea } from '@/ds';
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
    <Modal
      open
      onClose={onClose}
      title="Mark as Couldn't Work"
      width="md"
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving...' : "Mark Couldn't Work"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
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

        {error && <Alert variant="error">{error}</Alert>}

        <FormGroup label="Reason" htmlFor="sick-reason" required>
          <Textarea
            id="sick-reason"
            value={reason}
            onChange={event => setReason(event.target.value)}
            maxLength={500}
            rows={4}
            placeholder="e.g. Unable to work, flu symptoms"
          />
        </FormGroup>
      </div>
    </Modal>
  );
}
