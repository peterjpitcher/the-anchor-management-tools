import { checkUserPermission } from '@/app/actions/rbac';
import { redirect } from 'next/navigation';
import { formatDateTime } from '@/lib/dateUtils';
import {
  getOrCreateRotaWeek,
  getWeekShifts,
  getActiveEmployeesForRota,
  getLeaveDaysForWeek,
} from '@/app/actions/rota';
import type { RotaWeek, RotaShift, RotaEmployee, LeaveDayWithRequest } from '@/app/actions/rota';
import PrintTrigger from './PrintTrigger';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function paidHours(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function empDisplayName(emp: RotaEmployee): string {
  return [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown';
}

function formatTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const period = h < 12 ? 'am' : 'pm';
  const hour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${hour}:${String(m).padStart(2, '0')}${period}`;
}

function formatDayHeader(iso: string): { weekday: string; date: string } {
  const d = new Date(iso + 'T00:00:00Z');
  return {
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
    date: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

function formatWeekRange(days: string[]): string {
  const s = new Date(days[0] + 'T00:00:00Z');
  const e = new Date(days[6] + 'T00:00:00Z');
  const startStr = s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const endStr = e.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${startStr} – ${endStr}`;
}

function empWeekHours(employeeId: string, shifts: RotaShift[]): number {
  return shifts
    .filter(s => s.employee_id === employeeId && s.status !== 'cancelled')
    .reduce((sum, s) => sum + paidHours(s.start_time, s.end_time, s.unpaid_break_minutes, s.is_overnight), 0);
}

// ---------------------------------------------------------------------------
// Shift cell
// ---------------------------------------------------------------------------

function ShiftCell({
  shifts,
  leaveDays,
  employeeId,
  date,
}: {
  shifts: RotaShift[];
  leaveDays: LeaveDayWithRequest[];
  employeeId: string;
  date: string;
}) {
  const cellShifts = shifts.filter(
    s => s.employee_id === employeeId && s.shift_date === date && s.status !== 'cancelled'
  );
  const cellLeave = leaveDays.find(l => l.employee_id === employeeId && l.leave_date === date);

  return (
    <td style={{ padding: '3px 4px', border: '1px solid #d1d5db', verticalAlign: 'top', minWidth: 72 }}>
      {cellLeave && (
        <div style={{
          textAlign: 'center',
          borderRadius: 3,
          fontSize: 9,
          padding: '2px 3px',
          marginBottom: 2,
          fontWeight: 600,
          backgroundColor: cellLeave.status === 'approved' ? '#dcfce7' : '#fef9c3',
          color: cellLeave.status === 'approved' ? '#166534' : '#854d0e',
        }}>
          {cellLeave.status === 'approved' ? 'Holiday' : 'Holiday\u00a0(P)'}
        </div>
      )}
      {cellShifts.map(shift => {
        const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
        const isSick = shift.status === 'sick';
        const isBar = shift.department === 'bar';
        const bg = isSick ? '#fee2e2' : isBar ? '#dbeafe' : '#ffedd5';
        const fg = isSick ? '#991b1b' : isBar ? '#1e40af' : '#9a3412';
        return (
          <div key={shift.id} style={{ backgroundColor: bg, color: fg, borderRadius: 3, padding: '2px 4px', marginBottom: 2, fontSize: 10 }}>
            {shift.name && <div style={{ fontSize: 9, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shift.name}</div>}
            <div style={{ fontWeight: 600 }}>{formatTime(shift.start_time)}–{formatTime(shift.end_time)}</div>
            <div style={{ fontSize: 9, opacity: 0.85 }}>{isSick ? 'Sick' : isBar ? 'Bar' : 'Kitchen'} · {ph.toFixed(1)}h</div>
          </div>
        );
      })}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface PrintPageProps {
  searchParams: Promise<{ week?: string }>;
}

export default async function RotaPrintPage({ searchParams }: PrintPageProps) {
  const canView = await checkUserPermission('rota', 'view');
  if (!canView) redirect('/');

  const resolvedParams = await searchParams;
  const weekParam = resolvedParams?.week;

  const weekStart = (() => {
    if (weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)) {
      return getMondayOfWeek(new Date(weekParam + 'T00:00:00Z')).toISOString().split('T')[0];
    }
    return getMondayOfWeek(new Date()).toISOString().split('T')[0];
  })();

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0];
  });

  const weekEnd = days[6];

  const [weekResult, employeesResult, shiftsResult, leaveDaysResult] = await Promise.all([
    getOrCreateRotaWeek(weekStart),
    getActiveEmployeesForRota(weekStart),
    getWeekShifts(weekStart),
    getLeaveDaysForWeek(weekStart),
  ]);

  if (!weekResult.success) {
    return <div className="p-8 text-red-600">Failed to load rota data.</div>;
  }

  const week: RotaWeek = weekResult.data;
  const employees: RotaEmployee[] = employeesResult.success ? employeesResult.data : [];
  const shifts: RotaShift[] = shiftsResult.success ? shiftsResult.data : [];
  const leaveDays: LeaveDayWithRequest[] = leaveDaysResult.success ? leaveDaysResult.data : [];
  const openShifts = shifts.filter(s => s.is_open_shift || !s.employee_id);

  const generatedAt = formatDateTime(new Date());

  return (
    <>
      {/* Auto-trigger print dialog on load */}
      <PrintTrigger />

      {/*
        The CSS below:
        - In the browser: this div covers the full viewport (position fixed + z-index)
          so the authenticated nav/sidebar is hidden underneath
        - When printing: only .rota-print-content is visible; all other body content is hidden
      */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm 6mm; }
          body * { visibility: hidden; }
          .rota-print-content, .rota-print-content * { visibility: visible; }
          .rota-print-content { position: absolute; inset: 0; overflow: visible; }
          .no-print { display: none !important; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div
        className="rota-print-content"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          backgroundColor: '#fff',
          overflowY: 'auto',
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
          fontSize: 11,
          color: '#111',
          padding: '16px 20px',
        }}
      >
        {/* Toolbar (hidden when printing) */}
        <div className="no-print" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <PrintTrigger />
          <a href="/rota" style={{ fontSize: 13, color: '#6b7280', textDecoration: 'none' }}>
            ← Back to rota
          </a>
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 4 }}>
            Tip: choose <strong>Landscape</strong> orientation for the best fit
          </span>
        </div>

        {/* Page header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Weekly Rota</div>
            <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>{formatWeekRange(days)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{
              display: 'inline-block',
              padding: '2px 10px',
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 600,
              backgroundColor: week.status === 'published' ? '#dcfce7' : '#fef9c3',
              color: week.status === 'published' ? '#166534' : '#854d0e',
              marginBottom: 4,
            }}>
              {week.status === 'published' ? 'Published' : 'Draft'}
            </span>
            <div style={{ fontSize: 10, color: '#9ca3af' }}>Printed {generatedAt}</div>
          </div>
        </div>

        {/* Rota table */}
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontSize: 11 }}>
          <thead>
            <tr style={{ backgroundColor: '#f9fafb' }}>
              <th style={{ width: 100, padding: '4px 6px', border: '1px solid #d1d5db', textAlign: 'left', fontWeight: 600, color: '#374151', fontSize: 10 }}>
                Employee
              </th>
              {days.map(d => {
                const { weekday, date } = formatDayHeader(d);
                return (
                  <th key={d} style={{ padding: '4px 4px', border: '1px solid #d1d5db', textAlign: 'center', fontWeight: 600, color: '#374151', fontSize: 10 }}>
                    <div>{weekday}</div>
                    <div style={{ fontWeight: 400, color: '#6b7280', fontSize: 9 }}>{date}</div>
                  </th>
                );
              })}
              <th style={{ width: 44, padding: '4px 4px', border: '1px solid #d1d5db', textAlign: 'center', fontWeight: 600, color: '#374151', fontSize: 10 }}>
                Hrs
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map(emp => {
              const totalHrs = empWeekHours(emp.employee_id, shifts);
              return (
                <tr key={emp.employee_id}>
                  <td style={{ padding: '4px 6px', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 10, verticalAlign: 'top', wordBreak: 'break-word' }}>
                    {empDisplayName(emp)}
                    {emp.job_title && (
                      <div style={{ fontWeight: 400, color: '#6b7280', fontSize: 9 }}>{emp.job_title}</div>
                    )}
                  </td>
                  {days.map(d => (
                    <ShiftCell key={d} shifts={shifts} leaveDays={leaveDays} employeeId={emp.employee_id} date={d} />
                  ))}
                  <td style={{ padding: '4px 4px', border: '1px solid #d1d5db', textAlign: 'center', fontWeight: 700, fontSize: 10, verticalAlign: 'top', color: totalHrs > 0 ? '#111' : '#d1d5db' }}>
                    {totalHrs > 0 ? `${totalHrs.toFixed(1)}` : '—'}
                  </td>
                </tr>
              );
            })}

            {/* Open shifts */}
            {openShifts.length > 0 && (
              <tr style={{ backgroundColor: '#fffbeb' }}>
                <td style={{ padding: '4px 6px', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 10, verticalAlign: 'top', color: '#92400e' }}>
                  Open shifts
                </td>
                {days.map(d => {
                  const dayOpen = openShifts.filter(s => s.shift_date === d && s.status !== 'cancelled');
                  return (
                    <td key={d} style={{ padding: '3px 4px', border: '1px solid #d1d5db', verticalAlign: 'top' }}>
                      {dayOpen.map(shift => {
                        const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
                        const isBar = shift.department === 'bar';
                        return (
                          <div key={shift.id} style={{
                            borderRadius: 3, padding: '2px 4px', marginBottom: 2, fontSize: 10,
                            backgroundColor: isBar ? '#dbeafe' : '#ffedd5',
                            color: isBar ? '#1e40af' : '#9a3412',
                          }}>
                            <div style={{ fontWeight: 600 }}>{formatTime(shift.start_time)}–{formatTime(shift.end_time)}</div>
                            <div style={{ fontSize: 9, opacity: 0.85 }}>{isBar ? 'Bar' : 'Kitchen'} · {ph.toFixed(1)}h</div>
                          </div>
                        );
                      })}
                    </td>
                  );
                })}
                <td style={{ border: '1px solid #d1d5db' }} />
              </tr>
            )}
          </tbody>
        </table>

        {/* Legend */}
        <div style={{ marginTop: 10, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 600 }}>Legend:</span>
          {[
            { bg: '#dbeafe', label: 'Bar' },
            { bg: '#ffedd5', label: 'Kitchen' },
            { bg: '#fee2e2', label: 'Sick' },
            { bg: '#dcfce7', label: 'Holiday (approved)' },
            { bg: '#fef9c3', label: 'Holiday (pending)' },
          ].map(({ bg, label }) => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#374151' }}>
              <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 2, backgroundColor: bg, border: '1px solid #e5e7eb' }} />
              {label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
