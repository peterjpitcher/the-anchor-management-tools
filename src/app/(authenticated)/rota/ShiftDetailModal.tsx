'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { formatTime12Hour } from '@/lib/dateUtils';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { updateShift, deleteShift, markShiftSick } from '@/app/actions/rota';
import type { RotaShift, RotaEmployee } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';

interface ShiftDetailModalProps {
  shift: RotaShift;
  employee: RotaEmployee | undefined;
  canEdit: boolean;
  departments: Department[];
  onClose: () => void;
  onUpdated: (shift: RotaShift) => void;
  onDeleted: (shiftId: string) => void;
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
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

const DEPT_BADGE: Record<string, 'info' | 'warning'> = { bar: 'info', kitchen: 'warning' };
const STATUS_BADGE: Record<string, 'success' | 'error' | 'default'> = {
  scheduled: 'success',
  sick: 'error',
  cancelled: 'default',
};

export default function ShiftDetailModal({
  shift: initialShift,
  employee,
  canEdit,
  departments,
  onClose,
  onUpdated,
  onDeleted,
}: ShiftDetailModalProps) {
  const [shift, setShift] = useState(initialShift);
  const [editing, setEditing] = useState(false);
  const [startTime, setStartTime] = useState(shift.start_time);
  const [endTime, setEndTime] = useState(shift.end_time);
  const [breakMins, setBreakMins] = useState(shift.unpaid_break_minutes.toString());
  const [department, setDepartment] = useState<string>(shift.department);
  const [notes, setNotes] = useState(shift.notes ?? '');
  const [overnight, setOvernight] = useState(shift.is_overnight);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const empName = employee
    ? [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'Unknown'
    : 'Unknown employee';

  const paidH = paidHoursNum(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);

  const handleSaveEdit = () => {
    if (!startTime || !endTime) { setError('Start and end time are required'); return; }
    setError('');
    startTransition(async () => {
      const result = await updateShift(shift.id, {
        start_time: startTime,
        end_time: endTime,
        unpaid_break_minutes: parseInt(breakMins) || 0,
        department,
        notes: notes || null,
        is_overnight: overnight,
      });
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Shift updated');
      setShift(result.data);
      onUpdated(result.data);
      setEditing(false);
    });
  };

  const handleMarkSick = () => {
    startTransition(async () => {
      const result = await markShiftSick(shift.id);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      const updated = { ...shift, status: 'sick' as const };
      setShift(updated);
      onUpdated(updated);
      toast.success('Marked as sick');
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteShift(shift.id);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      toast.success('Shift deleted');
      onDeleted(shift.id);
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-500">{formatDate(shift.shift_date)}</p>
            <p className="text-lg font-semibold text-gray-900 mt-0.5">{empName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {!editing ? (
            /* Read view */
            <>
              <div className="flex flex-wrap gap-2">
                <Badge variant={DEPT_BADGE[shift.department] ?? 'default'} size="sm">
                  {shift.department}
                </Badge>
                <Badge variant={STATUS_BADGE[shift.status] ?? 'default'} size="sm">
                  {shift.status}
                </Badge>
              </div>

              <dl className="space-y-2">
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-500">Time</dt>
                  <dd className="text-gray-900 font-medium">{formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}{shift.is_overnight ? ' (+1)' : ''}</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-500">Break</dt>
                  <dd className="text-gray-900">{shift.unpaid_break_minutes} min</dd>
                </div>
                <div className="flex justify-between text-sm">
                  <dt className="text-gray-500">Paid hours</dt>
                  <dd className="text-gray-900 font-medium">{paidH.toFixed(1)}h</dd>
                </div>
                {shift.notes && (
                  <div className="flex justify-between text-sm">
                    <dt className="text-gray-500">Notes</dt>
                    <dd className="text-gray-900 text-right max-w-[240px]">{shift.notes}</dd>
                  </div>
                )}
              </dl>

              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button type="button" size="sm" onClick={() => setEditing(true)} disabled={isPending}>
                    Edit
                  </Button>
                  {shift.status === 'scheduled' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={handleMarkSick}
                      disabled={isPending}
                    >
                      Mark sick
                    </Button>
                  )}
                  {!confirmDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmDelete(true)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      Delete
                    </Button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-red-600">Delete this shift?</span>
                      <Button type="button" size="sm" onClick={handleDelete} disabled={isPending}
                        className="!bg-red-600 !text-white hover:!bg-red-700">
                        {isPending ? 'Deleting…' : 'Confirm'}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            /* Edit view */
            <div className="space-y-3">
              {error && <Alert variant="error">{error}</Alert>}

              <div className="grid grid-cols-2 gap-3">
                <FormGroup label="Start time" htmlFor="sd-start" required>
                  <Input id="sd-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
                </FormGroup>
                <FormGroup label="End time" htmlFor="sd-end" required>
                  <Input id="sd-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
                </FormGroup>
                <FormGroup label="Break (mins)" htmlFor="sd-break">
                  <Input id="sd-break" type="number" min="0" max="120" value={breakMins} onChange={e => setBreakMins(e.target.value)} />
                </FormGroup>
                <FormGroup label="Department" htmlFor="sd-dept">
                  <Select
                    id="sd-dept"
                    value={department}
                    onChange={e => setDepartment(e.target.value)}
                    options={departments.map(d => ({ value: d.name, label: d.label }))}
                  />
                </FormGroup>
              </div>

              <div className="flex items-center gap-2 text-sm">
                <input
                  id="sd-overnight"
                  type="checkbox"
                  checked={overnight}
                  onChange={e => setOvernight(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600"
                />
                <label htmlFor="sd-overnight" className="text-gray-700">Overnight shift</label>
              </div>

              <FormGroup label="Notes (optional)" htmlFor="sd-notes">
                <Input
                  id="sd-notes"
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
                <Button type="button" onClick={handleSaveEdit} disabled={isPending}>
                  {isPending ? 'Saving…' : 'Save changes'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => { setEditing(false); setError(''); }}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
