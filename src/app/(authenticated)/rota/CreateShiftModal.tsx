'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { createShift } from '@/app/actions/rota';
import type { RotaShift } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';

interface CreateShiftModalProps {
  weekId: string;
  employeeId: string;
  employeeName: string;
  shiftDate: string;
  departments: Department[];
  onClose: () => void;
  onCreated: (shift: RotaShift) => void;
}

function paidHoursNum(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export default function CreateShiftModal({
  weekId,
  employeeId,
  employeeName,
  shiftDate,
  departments,
  onClose,
  onCreated,
}: CreateShiftModalProps) {
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakMins, setBreakMins] = useState('0');
  const [department, setDepartment] = useState<string>(departments[0]?.name ?? 'bar');
  const [overnight, setOvernight] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const isOpenShift = employeeId === '__open__';

  const handleSubmit = () => {
    if (!startTime || !endTime) { setError('Start and end time are required'); return; }
    setError('');
    startTransition(async () => {
      const result = await createShift(
        isOpenShift
          ? { weekId, isOpenShift: true, name: name || null, shiftDate, startTime, endTime, unpaidBreakMinutes: parseInt(breakMins) || 0, department, isOvernight: overnight, notes: notes || null }
          : { weekId, isOpenShift: false, employeeId, name: name || null, shiftDate, startTime, endTime, unpaidBreakMinutes: parseInt(breakMins) || 0, department, isOvernight: overnight, notes: notes || null },
      );
      if (!result.success) { toast.error(result.error); return; }
      onCreated(result.data);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-500">{formatDate(shiftDate)}</p>
            <p className="text-lg font-semibold text-gray-900 mt-0.5">{employeeName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && <Alert variant="error">{error}</Alert>}

          <FormGroup label="Shift name (optional)" htmlFor="cs-name">
            <Input
              id="cs-name"
              placeholder='e.g. "Evening Bar"'
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </FormGroup>

          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Start time" htmlFor="cs-start" required>
              <Input id="cs-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </FormGroup>
            <FormGroup label="End time" htmlFor="cs-end" required>
              <Input id="cs-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </FormGroup>
            <FormGroup label="Break (mins)" htmlFor="cs-break">
              <Input id="cs-break" type="number" min="0" max="120" value={breakMins} onChange={e => setBreakMins(e.target.value)} />
            </FormGroup>
            <FormGroup label="Department" htmlFor="cs-dept">
              <Select
                id="cs-dept"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                options={departments.map(d => ({ value: d.name, label: d.label }))}
              />
            </FormGroup>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <input
              id="cs-overnight"
              type="checkbox"
              checked={overnight}
              onChange={e => setOvernight(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <label htmlFor="cs-overnight" className="text-gray-700">Overnight shift</label>
          </div>

          <FormGroup label="Notes (optional)" htmlFor="cs-notes">
            <Input
              id="cs-notes"
              placeholder="Optional notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </FormGroup>

          {startTime && endTime && (
            <p className="text-sm text-gray-600">
              Paid: <strong>{paidHoursNum(startTime, endTime, parseInt(breakMins) || 0, overnight).toFixed(1)}h</strong>
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Creating…' : 'Create shift'}
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
