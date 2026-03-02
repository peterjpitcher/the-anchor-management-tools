'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { submitLeaveRequest } from '@/app/actions/leave';

interface LeaveRequestFormProps {
  employeeId: string;
}

function daysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime();
  return ms < 0 ? 0 : Math.round(ms / 86400000) + 1;
}

export default function LeaveRequestForm({ employeeId }: LeaveRequestFormProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const days = daysBetween(startDate, endDate);

  const handleSubmit = () => {
    if (!startDate) { setError('Start date is required'); return; }
    if (!endDate) { setError('End date is required'); return; }
    if (new Date(endDate) < new Date(startDate)) { setError('End date must be on or after start date'); return; }
    setError('');

    startTransition(async () => {
      const result = await submitLeaveRequest({ employeeId, startDate, endDate, note: note || null });
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Holiday request submitted');
      router.push('/portal/leave');
    });
  };

  return (
    <div className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-3">
        <FormGroup label="First day" htmlFor="lr-start" required>
          <Input
            id="lr-start"
            type="date"
            value={startDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={e => setStartDate(e.target.value)}
          />
        </FormGroup>
        <FormGroup label="Last day" htmlFor="lr-end" required>
          <Input
            id="lr-end"
            type="date"
            value={endDate}
            min={startDate || new Date().toISOString().split('T')[0]}
            onChange={e => setEndDate(e.target.value)}
          />
        </FormGroup>
      </div>

      {days > 0 && (
        <div className="rounded-lg border px-3 py-2 text-sm bg-blue-50 border-blue-100 text-blue-800">
          <strong>{days} day{days !== 1 ? 's' : ''}</strong> requested
        </div>
      )}

      <FormGroup label="Note (optional)" htmlFor="lr-note">
        <Input
          id="lr-note"
          placeholder="Any context for your manager…"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </FormGroup>

      <div className="flex gap-2">
        <Button type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Submitting…' : 'Submit request'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push('/portal/leave')}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
