import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getEmployeeShifts, getOpenShiftsForPortal } from '@/app/actions/rota';
import type { RotaShift } from '@/app/actions/rota';
import { formatTime12Hour, getTodayIsoDate } from '@/lib/dateUtils';
import { generateCalendarToken } from '@/lib/portal/calendar-token';
import { getBatchHourlyRates, calculatePaidHours, calculateActualPaidHours } from '@/lib/rota/pay-calculator';
import type { RateResolver } from '@/lib/rota/pay-calculator';
import { HOLIDAY_PAY_PERCENTAGE } from '@/lib/rota/constants';
import { format, parseISO } from 'date-fns';
import CalendarSubscribeButton from './CalendarSubscribeButton';
import PaySummaryCard from './PaySummaryCard';
import type { PeriodSummary } from './PaySummaryCard';

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
  return iso === getTodayIsoDate();
}

function isTomorrow(iso: string): boolean {
  const todayStr = getTodayIsoDate();
  const d = new Date(todayStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return iso === d.toISOString().split('T')[0];
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

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

interface PayrollPeriod {
  id: string;
  year: number;
  month: number;
  period_start: string;
  period_end: string;
}

async function buildPeriodSummary(
  supabase: SupabaseServerClient,
  employeeId: string,
  period: Pick<PayrollPeriod, 'period_start' | 'period_end'>,
  rateResolver: RateResolver,
  todayIso: string,
): Promise<PeriodSummary> {
  const startLabel = format(parseISO(period.period_start), 'd MMM');
  const endLabel = format(parseISO(period.period_end), 'd MMM');
  const periodLabel = `${startLabel} - ${endLabel}`;

  // Fetch shifts for this period (assigned to employee, scheduled or sick status)
  const { data: shifts } = await supabase
    .from('rota_shifts')
    .select('shift_date, start_time, end_time, unpaid_break_minutes, is_overnight, status, week_id')
    .eq('employee_id', employeeId)
    .gte('shift_date', period.period_start)
    .lte('shift_date', period.period_end)
    .in('status', ['scheduled', 'sick']);

  // Filter to only shifts from published weeks
  const weekIds = [...new Set((shifts ?? []).map((s: { week_id: string }) => s.week_id))];
  let publishedWeekIds: Set<string> = new Set();
  if (weekIds.length > 0) {
    const { data: weeks } = await supabase
      .from('rota_weeks')
      .select('id')
      .in('id', weekIds)
      .eq('status', 'published');
    publishedWeekIds = new Set((weeks ?? []).map((w: { id: string }) => w.id));
  }

  const publishedShifts = (shifts ?? []).filter(
    (s: { week_id: string }) => publishedWeekIds.has(s.week_id),
  );

  // Calculate planned hours and pay
  let plannedHours = 0;
  let plannedPay: number | null = null;

  for (const shift of publishedShifts) {
    const hours = calculatePaidHours(
      shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight,
    );
    plannedHours += hours;
    const rateInfo = rateResolver.resolve(shift.shift_date);
    if (rateInfo) {
      plannedPay = (plannedPay ?? 0) + hours * rateInfo.rate;
    }
  }

  // Fetch approved timeclock sessions up to today
  const actualCutoff = period.period_end < todayIso ? period.period_end : todayIso;
  const { data: sessions } = await supabase
    .from('timeclock_sessions')
    .select('work_date, clock_in_at, clock_out_at')
    .eq('employee_id', employeeId)
    .gte('work_date', period.period_start)
    .lte('work_date', actualCutoff)
    .eq('is_reviewed', true)
    .not('clock_out_at', 'is', null);

  let actualHours = 0;
  let actualPay: number | null = null;

  for (const session of sessions ?? []) {
    // Note: timeclock_sessions does not store break duration — actual hours are wall-clock time.
    // This may overstate paid time for sessions where an unpaid break was taken.
    const hours = calculateActualPaidHours(session.clock_in_at, session.clock_out_at);
    if (hours !== null) {
      actualHours += hours;
      const rateInfo = rateResolver.resolve(session.work_date);
      if (rateInfo) {
        actualPay = (actualPay ?? 0) + hours * rateInfo.rate;
      }
    }
  }

  const holidayPay = actualPay !== null
    ? Math.round(actualPay * HOLIDAY_PAY_PERCENTAGE * 100) / 100
    : null;

  return {
    periodLabel,
    plannedHours: Math.round(plannedHours * 100) / 100,
    actualHours: Math.round(actualHours * 100) / 100,
    plannedPay: plannedPay !== null ? Math.round(plannedPay * 100) / 100 : null,
    actualPay: actualPay !== null ? Math.round(actualPay * 100) / 100 : null,
    holidayPay,
  };
}

export default async function MyShiftsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/auth/login');

  const { data: employee } = await supabase
    .from('employees')
    .select('employee_id, first_name, last_name')
    .eq('auth_user_id', user.id)
    .in('status', ['Active', 'Started Separation'])
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

  const today = getTodayIsoDate();

  // Pay summary data (hourly employees only)
  let currentSummary: PeriodSummary | null = null;
  let previousSummary: PeriodSummary | null = null;

  const { data: paySettings } = await supabase
    .from('employee_pay_settings')
    .select('pay_type')
    .eq('employee_id', employee.employee_id)
    .single();

  // Default to hourly when no pay settings exist — must match the same default in pay-calculator.ts getBatchHourlyRates()
  const isHourly = !paySettings || paySettings.pay_type === 'hourly';

  if (isHourly) {
    // Current period: must contain today (not just started before today)
    const { data: currentPeriod } = await supabase
      .from('payroll_periods')
      .select('id, year, month, period_start, period_end')
      .lte('period_start', today)
      .gte('period_end', today)
      .single();

    if (currentPeriod) {
      // Previous period: ends before current starts
      const { data: previousPeriod } = await supabase
        .from('payroll_periods')
        .select('id, year, month, period_start, period_end')
        .lt('period_end', currentPeriod.period_start)
        .order('period_start', { ascending: false })
        .limit(1)
        .single();

      const rateResolver = await getBatchHourlyRates(employee.employee_id);

      currentSummary = await buildPeriodSummary(
        supabase, employee.employee_id, currentPeriod, rateResolver, today,
      );

      if (previousPeriod) {
        previousSummary = await buildPeriodSummary(
          supabase, employee.employee_id, previousPeriod, rateResolver, today,
        );
      }
    }
  }

  // Show shifts for today + 5 weeks ahead
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

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const calToken = generateCalendarToken(employee.employee_id);
  const feedUrl = `${baseUrl}/api/portal/calendar-feed?employee_id=${employee.employee_id}&token=${calToken}`;

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">My Shifts</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Hi {empName} — here are your upcoming published shifts.
        </p>
      </div>

      <CalendarSubscribeButton feedUrl={feedUrl} />

      {currentSummary && (
        <PaySummaryCard current={currentSummary} previous={previousSummary} />
      )}

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
                  const ph = calculatePaidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
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
            const ph = calculatePaidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
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

      {currentSummary && (
        <p id="pay-disclaimer" className="text-xs text-gray-400 mt-8 leading-relaxed">
          These figures are provided for guidance only. Your actual pay may differ due to required
          statutory deductions including PAYE income tax, National Insurance contributions, student
          loan repayments, and any other applicable deductions. Please refer to your payslip for
          confirmed net pay.
        </p>
      )}
    </div>
  );
}
