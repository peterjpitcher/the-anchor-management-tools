import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getEmployeeShifts, getOpenShiftsForPortal } from '@/app/actions/rota';
import type { RotaShift } from '@/app/actions/rota';
import { formatTime12Hour } from '@/lib/dateUtils';

export const dynamic = 'force-dynamic';

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function formatShortDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function isToday(iso: string): boolean {
  return iso === new Date().toISOString().split('T')[0];
}

function isTomorrow(iso: string): boolean {
  const tom = new Date();
  tom.setDate(tom.getDate() + 1);
  return iso === tom.toISOString().split('T')[0];
}

function paidHours(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function dateLabel(iso: string): string {
  if (isToday(iso)) return 'Today';
  if (isTomorrow(iso)) return 'Tomorrow';
  return formatShortDate(iso);
}

function deptColour(dept: string): string {
  return dept === 'bar'
    ? 'bg-blue-50 border-blue-200 text-blue-800'
    : 'bg-orange-50 border-orange-200 text-orange-800';
}

export default async function MyShiftsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name')
    .eq('auth_user_id', user.id)
    .single();

  if (!employee) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">My Shifts</h2>
        <p className="text-sm text-gray-500">
          Your account is not linked to an employee profile. Please contact your manager.
        </p>
      </div>
    );
  }

  // Show shifts for today + 5 weeks ahead
  const today = new Date().toISOString().split('T')[0];
  const fiveWeeksAhead = new Date();
  fiveWeeksAhead.setDate(fiveWeeksAhead.getDate() + 35);
  const toDate = fiveWeeksAhead.toISOString().split('T')[0];

  const [shiftsResult, openShiftsResult] = await Promise.all([
    getEmployeeShifts(employee.employee_id, today, toDate),
    getOpenShiftsForPortal(today, toDate),
  ]);
  const shifts = shiftsResult.success
    ? shiftsResult.data.filter(s => s.status !== 'cancelled')
    : [];
  const openShifts = openShiftsResult.success
    ? openShiftsResult.data.filter(s => s.status !== 'cancelled')
    : [];

  // Group by date
  const byDate = shifts.reduce<Record<string, RotaShift[]>>((acc, s) => {
    if (!acc[s.shift_date]) acc[s.shift_date] = [];
    acc[s.shift_date].push(s);
    return acc;
  }, {});
  const dates = Object.keys(byDate).sort();

  const empName = [employee.first_name, employee.last_name].filter(Boolean).join(' ') || 'there';

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">My Shifts</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Hi {empName} — here are your upcoming published shifts.
        </p>
      </div>

      {dates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">No published shifts in the next 5 weeks.</p>
          <p className="text-xs text-gray-400 mt-1">Check back once your manager publishes the rota.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {dates.map(date => (
            <div key={date} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className={`px-4 py-2 border-b ${isToday(date) ? 'bg-blue-50 border-blue-100' : 'bg-gray-50 border-gray-100'}`}>
                <p className={`text-sm font-semibold ${isToday(date) ? 'text-blue-700' : 'text-gray-700'}`}>
                  {dateLabel(date)}
                  {isToday(date) ? '' : ` · ${formatDate(date).split(',')[0]}`}
                </p>
                {!isToday(date) && (
                  <p className="text-xs text-gray-500">{formatDate(date)}</p>
                )}
              </div>
              <div className="divide-y divide-gray-50">
                {byDate[date].map(shift => {
                  const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
                  return (
                    <div key={shift.id} className="px-4 py-3 flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}
                          {shift.is_overnight ? ' (+1)' : ''}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded border ${deptColour(shift.department)} font-medium`}>
                            {shift.department}
                          </span>
                          <span className="text-xs text-gray-500">{ph.toFixed(1)}h paid</span>
                          {shift.unpaid_break_minutes > 0 && (
                            <span className="text-xs text-gray-400">· {shift.unpaid_break_minutes} min break</span>
                          )}
                        </div>
                      </div>
                      {shift.status === 'sick' && (
                        <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">
                          Sick
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {openShifts.length > 0 && (
        <div className="space-y-2">
          <div>
            <h3 className="text-base font-semibold text-gray-900">Available shifts</h3>
            <p className="text-xs text-gray-500 mt-0.5">These shifts are open — speak to your manager if you can cover one.</p>
          </div>
          {openShifts.map(shift => {
            const ph = paidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
            return (
              <div key={shift.id} className="bg-amber-50 rounded-xl border border-amber-200 px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {dateLabel(shift.shift_date)} · {formatTime12Hour(shift.start_time)} – {formatTime12Hour(shift.end_time)}
                    {shift.is_overnight ? ' (+1)' : ''}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded border ${deptColour(shift.department)} font-medium`}>
                      {shift.department}
                    </span>
                    <span className="text-xs text-gray-500">{ph.toFixed(1)}h paid</span>
                  </div>
                </div>
                <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0 ml-2">Open</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
