'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { bookApprovedHoliday } from '@/app/actions/leave';

interface BookHolidayModalProps {
  employeeId: string;
  employeeName: string;
  initialDate: string;
  onClose: () => void;
  onBooked: (days: { employee_id: string; leave_date: string; request_id: string; status: 'approved' }[]) => void;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function dayCount(start: string, end: string): number {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  if (e < s) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

export default function BookHolidayModal({
  employeeId,
  employeeName,
  initialDate,
  onClose,
  onBooked,
}: BookHolidayModalProps) {
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const days = dayCount(startDate, endDate);

  const handleSubmit = () => {
    if (!startDate || !endDate) { setError('Start and end date are required'); return; }
    if (endDate < startDate) { setError('End date must be on or after start date'); return; }
    setError('');
    startTransition(async () => {
      const result = await bookApprovedHoliday({
        employeeId,
        startDate,
        endDate,
        note: note || null,
      });
      if (!result.success) { setError(result.error); return; }
      toast.success(`Holiday booked — ${days} day${days !== 1 ? 's' : ''}`);
      onBooked(result.leaveDays);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-500">Book holiday</p>
            <p className="text-lg font-semibold text-gray-900 mt-0.5">{employeeName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && <Alert variant="error">{error}</Alert>}

          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="From" htmlFor="bh-start" required>
              <Input id="bh-start" type="date" value={startDate} onChange={e => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }} />
            </FormGroup>
            <FormGroup label="To" htmlFor="bh-end" required>
              <Input id="bh-end" type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
            </FormGroup>
          </div>

          {days > 0 && (
            <p className="text-sm text-gray-600">
              <strong>{days}</strong> day{days !== 1 ? 's' : ''}
              {startDate !== endDate && (
                <span className="text-gray-400"> ({formatDate(startDate)} – {formatDate(endDate)})</span>
              )}
            </p>
          )}

          <FormGroup label="Note (optional)" htmlFor="bh-note">
            <Input
              id="bh-note"
              placeholder="Optional reason or note"
              value={note}
              onChange={e => setNote(e.target.value)}
            />
          </FormGroup>

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={handleSubmit} disabled={isPending || days === 0}>
              {isPending ? 'Booking…' : 'Book holiday'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
