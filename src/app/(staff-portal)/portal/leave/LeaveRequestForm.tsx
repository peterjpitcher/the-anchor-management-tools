'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Field, FormFooter, Input, LinkButton, toast } from '@/ds';
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

  // Compute today's London date client-side using Intl, which avoids UTC offset bugs
  const todayLocal = useMemo(() => {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
  }, []);

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
      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First day" htmlFor="lr-start" required>
          <Input
            id="lr-start"
            type="date"
            value={startDate}
            min={todayLocal}
            onChange={e => setStartDate(e.target.value)}
          />
        </Field>
        <Field label="Last day" htmlFor="lr-end" required>
          <Input
            id="lr-end"
            type="date"
            value={endDate}
            min={startDate || todayLocal}
            onChange={e => setEndDate(e.target.value)}
          />
        </Field>
      </div>

      {days > 0 && (
        <Alert tone="info" role="status" size="sm">
          <strong>{days} day{days !== 1 ? 's' : ''}</strong> requested
        </Alert>
      )}

      <Field label="Note (optional)" htmlFor="lr-note">
        <Input
          id="lr-note"
          placeholder="Any context for your manager…"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </Field>

      <FormFooter>
        <LinkButton href="/portal/leave" variant="secondary">
          Cancel
        </LinkButton>
        <Button type="button" variant="primary" onClick={handleSubmit} loading={isPending}>
          Request Holiday
        </Button>
      </FormFooter>
    </div>
  );
}
