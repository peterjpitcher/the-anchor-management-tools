'use client';

import { XCircleIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import type { RejectedShiftRecord } from '@/app/actions/rota';

interface EmployeeRejectedShiftsTabProps {
  rejectedShifts: RejectedShiftRecord[];
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function EmployeeRejectedShiftsTab({ rejectedShifts }: EmployeeRejectedShiftsTabProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900">Rejected shifts</h3>
        <p className="mt-1 text-sm text-gray-600">
          Shifts this employee rejected in the portal.
        </p>
      </div>

      {rejectedShifts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-gray-400">
          <XCircleIcon className="mb-2 h-8 w-8 text-gray-300" />
          No rejected shifts recorded.
        </div>
      ) : (
        <div className="space-y-2">
          {rejectedShifts.map(shift => (
            <div key={shift.id} className="flex items-start justify-between gap-4 border-b border-gray-100 py-2.5 last:border-0">
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-900">
                  {formatDate(shift.shift_date)} · {formatTime12Hour(shift.start_time)}–{formatTime12Hour(shift.end_time)}
                  {shift.is_overnight ? ' (+1)' : ''}
                </p>
                <p className="text-xs text-gray-500">
                  {shift.name ? `${shift.name} · ` : ''}
                  {shift.department}
                  {shift.unpaid_break_minutes > 0 ? ` · ${shift.unpaid_break_minutes} min break` : ''}
                </p>
                {shift.rejection_note && (
                  <p className="mt-1 text-xs text-gray-600">{shift.rejection_note}</p>
                )}
                {shift.notes && (
                  <p className="mt-1 text-xs text-gray-500">Shift note: {shift.notes}</p>
                )}
              </div>
              <div className="shrink-0 text-right">
                <Badge variant="error" size="sm">Rejected</Badge>
                <p className="mt-1 text-xs text-gray-500">{formatDateTime(shift.rejected_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
