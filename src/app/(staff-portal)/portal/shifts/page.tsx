import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getOrCreatePayrollPeriod, getOrCreatePayrollPeriodForDate, type PayrollPeriod } from '@/app/actions/payroll';
import { formatTime12Hour, getTodayIsoDate } from '@/lib/dateUtils';
import { generateCalendarToken } from '@/lib/portal/calendar-token';
import { getBatchHourlyRates, calculatePaidHours, calculateActualPaidHours } from '@/lib/rota/pay-calculator';
import type { RateResolver } from '@/lib/rota/pay-calculator';
import { HOLIDAY_PAY_PERCENTAGE } from '@/lib/rota/constants';
import { format, parseISO } from 'date-fns';
import CalendarSubscribeButton from './CalendarSubscribeButton';
import PaySummaryCard from './PaySummaryCard';
import type { PeriodSummary } from './PaySummaryCard';
import ShiftDecisionControls from './ShiftDecisionControls';
import OpenShiftRequestButton from './OpenShiftRequestButton';
import type { ShiftAcceptanceStatus } from '@/app/actions/rota';

export const dynamic = 'force-dynamic';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

type PortalShift = {
  id: string;
  week_id: string;
  employee_id: string | null;
  shift_date: string;
  start_time: string;
  end_time: string;
  unpaid_break_minutes: number;
  department: string;
  status: string;
  notes: string | null;
  is_overnight: boolean;
  is_open_shift: boolean;
  name: string | null;
  acceptance_status: ShiftAcceptanceStatus | null;
  acceptance_decided_at: string | null;
  auto_accept_reason: string | null;
};

type CouldntWorkRecord = {
  id: string;
  shift_date: string;
  sick_reason: string | null;
  created_at: string;
};

const SHIFT_AUTO_ACCEPT_POLICY_NOTE =
  'In line with our policy, all shifts must be accepted or rejected no less than two weeks before the shift.';
const SHIFT_ACCEPTANCE_CUTOFF_DAYS = 14;

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

function formatFullDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
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

function shiftStartTime(shift: Pick<PortalShift, 'shift_date' | 'start_time'>): number {
  return new Date(`${shift.shift_date}T${shift.start_time}`).getTime();
}

function toLocalIsoDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function autoAcceptDeadlineLabel(shift: Pick<PortalShift, 'shift_date' | 'start_time'>): string {
  const deadline = new Date(`${shift.shift_date}T00:00:00`);
  deadline.setDate(deadline.getDate() - SHIFT_ACCEPTANCE_CUTOFF_DAYS);
  return `${formatFullDate(toLocalIsoDate(deadline))} at ${formatTime12Hour(shift.start_time)}`;
}

function resolvePortalAcceptanceStatus(shift: PortalShift, now: Date): ShiftAcceptanceStatus | null {
  if (shift.acceptance_status === 'rejected') return 'rejected';

  const startMs = shiftStartTime(shift);
  if (startMs <= now.getTime()) {
    return shift.acceptance_status === 'accepted' || shift.acceptance_status === 'auto_accepted'
      ? shift.acceptance_status
      : null;
  }

  const cutoffMs = SHIFT_ACCEPTANCE_CUTOFF_DAYS * 24 * 60 * 60 * 1000;
  if (startMs - now.getTime() <= cutoffMs) return 'auto_accepted';

  return shift.acceptance_status ?? 'pending';
}

function periodHref(period: Pick<PayrollPeriod, 'year' | 'month'>): string {
  return `/portal/shifts?year=${period.year}&month=${period.month}`;
}

function parsePeriodParams(params: { year?: string; month?: string }): { year: number; month: number } | null {
  const year = Number(params.year);
  const month = Number(params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month)) return null;
  if (year < 2020 || year > 2100 || month < 1 || month > 12) return null;
  return { year, month };
}

async function periodHasPortalData(
  supabase: SupabaseServerClient,
  employeeId: string,
  period: Pick<PayrollPeriod, 'period_start' | 'period_end'>,
): Promise<boolean> {
  const { count } = await supabase
    .from('rota_published_shifts')
    .select('*', { count: 'exact', head: true })
    .gte('shift_date', period.period_start)
    .lte('shift_date', period.period_end)
    .eq('status', 'scheduled')
    .or(`employee_id.eq.${employeeId},is_open_shift.eq.true`);

  return Boolean(count && count > 0);
}

async function findAdjacentPeriod(
  supabase: SupabaseServerClient,
  employeeId: string,
  current: PayrollPeriod,
  direction: 'previous' | 'next',
): Promise<PayrollPeriod | null> {
  const query = supabase
    .from('payroll_periods')
    .select('id, year, month, period_start, period_end')
    .order('period_start', { ascending: direction === 'next' })
    .limit(12);

  const { data } = direction === 'previous'
    ? await query.lt('period_end', current.period_start)
    : await query.gt('period_start', current.period_end);

  for (const period of (data ?? []) as PayrollPeriod[]) {
    if (await periodHasPortalData(supabase, employeeId, period)) return period;
  }

  return null;
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

  const { data: shifts } = await supabase
    .from('rota_published_shifts')
    .select('shift_date, start_time, end_time, unpaid_break_minutes, is_overnight, status, is_open_shift, acceptance_status')
    .eq('employee_id', employeeId)
    .gte('shift_date', period.period_start)
    .lte('shift_date', period.period_end)
    .eq('status', 'scheduled')
    .eq('is_open_shift', false);

  let plannedHours = 0;
  let plannedPay: number | null = null;

  for (const shift of shifts ?? []) {
    if (shift.acceptance_status === 'rejected') continue;
    const hours = calculatePaidHours(
      shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight,
    );
    plannedHours += hours;
    const rateInfo = rateResolver.resolve(shift.shift_date);
    if (rateInfo) plannedPay = (plannedPay ?? 0) + hours * rateInfo.rate;
  }

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
    const hours = calculateActualPaidHours(session.clock_in_at, session.clock_out_at);
    if (hours !== null) {
      actualHours += hours;
      const rateInfo = rateResolver.resolve(session.work_date);
      if (rateInfo) actualPay = (actualPay ?? 0) + hours * rateInfo.rate;
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

export default async function MyShiftsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
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
  const resolvedParams = await searchParams;
  const requestedPeriod = parsePeriodParams(resolvedParams ?? {});
  const currentPeriod = await getOrCreatePayrollPeriodForDate(today);
  const period = requestedPeriod
    ? await getOrCreatePayrollPeriod(requestedPeriod.year, requestedPeriod.month)
    : currentPeriod;

  const [
    previousPeriod,
    nextPeriod,
    shiftsResult,
    openShiftsResult,
    couldntWorkResult,
    paySettingsResult,
  ] = await Promise.all([
    findAdjacentPeriod(supabase, employee.employee_id, period, 'previous'),
    findAdjacentPeriod(supabase, employee.employee_id, period, 'next'),
    supabase
      .from('rota_published_shifts')
      .select('*')
      .eq('employee_id', employee.employee_id)
      .gte('shift_date', period.period_start)
      .lte('shift_date', period.period_end)
      .eq('status', 'scheduled')
      .eq('is_open_shift', false)
      .order('shift_date')
      .order('start_time'),
    supabase
      .from('rota_published_shifts')
      .select('*')
      .eq('is_open_shift', true)
      .eq('status', 'scheduled')
      .gte('shift_date', period.period_start)
      .lte('shift_date', period.period_end)
      .order('shift_date')
      .order('start_time'),
    supabase
      .from('rota_shifts')
      .select('id, shift_date, sick_reason, created_at')
      .eq('employee_id', employee.employee_id)
      .eq('status', 'sick')
      .gte('shift_date', period.period_start)
      .lte('shift_date', period.period_end)
      .order('shift_date', { ascending: false })
      .limit(31),
    supabase
      .from('employee_pay_settings')
      .select('pay_type')
      .eq('employee_id', employee.employee_id)
      .single(),
  ]);

  const now = new Date();
  const shifts = ((shiftsResult.data ?? []) as PortalShift[])
    .map(shift => {
      const acceptanceStatus = resolvePortalAcceptanceStatus(shift, now);
      return {
        ...shift,
        acceptance_status: acceptanceStatus,
        auto_accept_reason: acceptanceStatus === 'auto_accepted'
          ? shift.auto_accept_reason ?? SHIFT_AUTO_ACCEPT_POLICY_NOTE
          : shift.auto_accept_reason,
      };
    })
    .filter(shift => shift.acceptance_status !== 'rejected');
  const openShifts = (openShiftsResult.data ?? []) as PortalShift[];
  const couldntWorkRecords = (couldntWorkResult.data ?? []) as CouldntWorkRecord[];

  const openShiftIds = openShifts.map(shift => shift.id);
  const { data: openShiftRequests } = openShiftIds.length > 0
    ? await supabase
        .from('rota_open_shift_requests')
        .select('shift_id')
        .eq('employee_id', employee.employee_id)
        .eq('status', 'pending')
        .in('shift_id', openShiftIds)
    : { data: [] as { shift_id: string }[] };
  const requestedOpenShiftIds = new Set((openShiftRequests ?? []).map(request => request.shift_id as string));

  let currentSummary: PeriodSummary | null = null;
  const isHourly = !paySettingsResult.data || paySettingsResult.data.pay_type === 'hourly';
  if (isHourly) {
    const rateResolver = await getBatchHourlyRates(employee.employee_id);
    currentSummary = await buildPeriodSummary(supabase, employee.employee_id, period, rateResolver, today);
  }

  const byDate = shifts.reduce<Record<string, PortalShift[]>>((acc, shift) => {
    if (!acc[shift.shift_date]) acc[shift.shift_date] = [];
    acc[shift.shift_date].push(shift);
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
          Hi {empName} - here are your published shifts for this pay period.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          {previousPeriod ? (
            <a href={periodHref(previousPeriod)} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Previous
            </a>
          ) : (
            <span className="rounded-md border border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-300">Previous</span>
          )}

          <div className="text-center">
            <p className="text-sm font-semibold text-gray-900">
              {format(parseISO(period.period_start), 'd MMM')} - {format(parseISO(period.period_end), 'd MMM yyyy')}
            </p>
            <p className="text-xs text-gray-500">
              {format(parseISO(`${period.year}-${String(period.month).padStart(2, '0')}-01`), 'MMMM yyyy')} payroll
            </p>
          </div>

          {nextPeriod ? (
            <a href={periodHref(nextPeriod)} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
              Next
            </a>
          ) : (
            <span className="rounded-md border border-gray-100 px-3 py-1.5 text-xs font-medium text-gray-300">Next</span>
          )}
        </div>
      </div>

      {currentSummary && <PaySummaryCard current={currentSummary} />}

      {dates.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500">No published shifts in this pay period.</p>
          <p className="text-xs text-gray-400 mt-1">Check another period or wait for your manager to publish the rota.</p>
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
                {!isToday(date) && <p className="text-xs text-gray-500">{formatDate(date)}</p>}
              </div>
              <div className="divide-y divide-gray-50">
                {byDate[date].map(shift => {
                  const paidHours = calculatePaidHours(
                    shift.start_time,
                    shift.end_time,
                    shift.unpaid_break_minutes,
                    shift.is_overnight,
                  );
                  return (
                    <div key={shift.id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {shift.name && <p className="text-sm font-semibold text-gray-900">{shift.name}</p>}
                          <p className="text-sm font-medium text-gray-900">
                            {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                            {shift.is_overnight ? ' (+1)' : ''}
                          </p>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded border ${deptColour(shift.department)} font-medium`}>
                              {shift.department}
                            </span>
                            <span className="text-xs text-gray-500">{paidHours.toFixed(1)}h paid</span>
                            {shift.unpaid_break_minutes > 0 && (
                              <span className="text-xs text-gray-400">{shift.unpaid_break_minutes} min break</span>
                            )}
                          </div>
                          {shift.notes && <p className="mt-1 text-xs text-gray-500">{shift.notes}</p>}
                        </div>
                      </div>
                      <ShiftDecisionControls
                        shiftId={shift.id}
                        acceptanceStatus={shift.acceptance_status}
                        acceptedAt={shift.acceptance_decided_at}
                        autoAcceptReason={shift.auto_accept_reason}
                        autoAcceptDeadline={autoAcceptDeadlineLabel(shift)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Open shifts this pay period</h3>
          <p className="text-xs text-gray-500 mt-0.5">You can ask to work these shifts. A manager still needs to approve it.</p>
        </div>
        {openShifts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-center text-sm text-gray-400">
            No open shifts in this pay period.
          </div>
        ) : (
          openShifts.map(shift => {
            const paidHours = calculatePaidHours(shift.start_time, shift.end_time, shift.unpaid_break_minutes, shift.is_overnight);
            return (
              <div key={shift.id} className="bg-amber-50 rounded-xl border border-amber-200 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {formatFullDate(shift.shift_date)} · {formatTime12Hour(shift.start_time)} - {formatTime12Hour(shift.end_time)}
                      {shift.is_overnight ? ' (+1)' : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${deptColour(shift.department)} font-medium`}>
                        {shift.department}
                      </span>
                      <span className="text-xs text-gray-500">{paidHours.toFixed(1)}h paid</span>
                    </div>
                  </div>
                  <OpenShiftRequestButton shiftId={shift.id} alreadyRequested={requestedOpenShiftIds.has(shift.id)} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="space-y-2">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Couldn&apos;t Work</h3>
          <p className="text-xs text-gray-500 mt-0.5">Records for this pay period, added by your manager in the rota.</p>
        </div>
        {couldntWorkRecords.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-white p-4 text-center text-sm text-gray-400">
            No Couldn&apos;t Work records.
          </div>
        ) : (
          <div className="space-y-2">
            {couldntWorkRecords.map(record => (
              <div key={record.id} className="rounded-xl border border-red-100 bg-red-50 px-4 py-3">
                <p className="text-sm font-medium text-red-950">{formatFullDate(record.shift_date)}</p>
                <p className="mt-0.5 text-xs text-red-800">{record.sick_reason || 'No reason recorded'}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <CalendarSubscribeButton feedUrl={feedUrl} />

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
