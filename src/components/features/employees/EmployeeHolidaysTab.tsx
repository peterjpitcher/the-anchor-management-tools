'use client';

import { useState, useTransition } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Field, FormFooter, Icon, Input, ProgressBar, Segmented, SubHeading, toast } from '@/ds';
import {
  HOLIDAY_ALLOWANCE_TEXT_CLASSES,
  holidayAllowanceTone,
} from '@/app/(authenticated)/employees/_shared/status-ui';
import { rotaLeaveStatusLabel, rotaLeaveStatusTone } from '@/lib/rota/status-ui';
import { bookApprovedHoliday, type LeaveRequest } from '@/app/actions/leave';
import type { EmployeePaySettings } from '@/app/actions/pay-bands';
import type { RotaSettings } from '@/app/actions/rota-settings';
import {
  countAllowanceDays,
  countRequestDays,
  formatHolidayDays,
  getHolidayEntitlement,
  getHolidayYear,
  getUntakenHoliday,
} from '@/lib/leave/working-days';
import type { EmployeeLeaveDay } from '@/app/actions/leave';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';
import { leaveTypeLabel, ONBOARDING_LEAVE_ORIGIN_LABEL } from '@/lib/employees/leave-type-labels';

interface EmployeeHolidaysTabProps {
  employeeId: string;
  canCreateLeave: boolean;
  leaveRequests: LeaveRequest[];
  /**
   * Dated leave rows. Totals are computed from these rather than from each request's start and
   * end dates, so a request spanning new year is charged to the year each day falls in, and the
   * figure matches the Holiday column on the employees list.
   */
  leaveDays: EmployeeLeaveDay[];
  paySettings: EmployeePaySettings | null;
  rotaSettings: Pick<RotaSettings, 'holidayYearStartMonth' | 'holidayYearStartDay' | 'defaultHolidayDays'>;
  /** Why the leave or the allowance could not be loaded. The tab then says so. */
  loadError?: string | null;
  /**
   * The starter's onboarding answer to "do you have time off booked?": 'none' or 'has_dates',
   * with when they answered. A "nothing booked" answer leaves no leave rows behind, so without
   * this the tab cannot tell "said nothing booked" from "never asked".
   */
  onboardingTimeOff?: { answer: string; answeredAt: string } | null;
  /**
   * Their first and last working days. A starter or leaver is entitled to the share of the holiday
   * year they are employed for, and a leaver's untaken holiday is worked out to their last day.
   */
  employmentStartDate?: string | null;
  employmentEndDate?: string | null;
}

function formatDate(iso: string) {
  return formatDateInLondon(iso, { day: 'numeric', month: 'short', year: 'numeric' });
}

function yearLabel(year: number) {
  return `${year}/${String(year + 1).slice(2)}`;
}

export default function EmployeeHolidaysTab({
  employeeId,
  canCreateLeave,
  leaveRequests,
  leaveDays,
  paySettings,
  rotaSettings,
  loadError,
  onboardingTimeOff,
  employmentStartDate = null,
  employmentEndDate = null,
}: EmployeeHolidaysTabProps) {
  const { holidayYearStartMonth, holidayYearStartDay, defaultHolidayDays } = rotaSettings;
  const yearlyAllowance = paySettings?.holiday_allowance_days ?? defaultHolidayDays;

  const currentYear = getHolidayYear(getTodayIsoDate(), holidayYearStartMonth, holidayYearStartDay);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookStart, setBookStart] = useState('');
  const [bookEnd, setBookEnd] = useState('');
  const [bookNote, setBookNote] = useState('');
  const [bookError, setBookError] = useState('');
  const [bookIsPending, startBookTransition] = useTransition();

  // Each dated row is attributed to the holiday year its own date falls in.
  const daysByYear = new Map<number, EmployeeLeaveDay[]>();
  for (const day of leaveDays) {
    const year = getHolidayYear(day.leave_date, holidayYearStartMonth, holidayYearStartDay);
    const bucket = daysByYear.get(year) ?? [];
    bucket.push(day);
    daysByYear.set(year, bucket);
  }

  // Years offered in the selector come from the dated rows, so a request that began in the
  // previous year still surfaces the year its days actually land in. The year of a leaver's last
  // working day is always offered: it holds their final-pay figure, even when they took no leave.
  const lastDayYear = employmentEndDate
    ? getHolidayYear(employmentEndDate, holidayYearStartMonth, holidayYearStartDay)
    : null;
  const availableYears = [
    ...new Set([...daysByYear.keys(), currentYear, ...(lastDayYear === null ? [] : [lastDayYear])]),
  ].sort((a, b) => b - a);

  const selectedDays = daysByYear.get(selectedYear) ?? [];
  const approvedDays = countAllowanceDays(selectedDays.filter(d => d.status === 'approved'));
  const pendingDays = countAllowanceDays(selectedDays.filter(d => d.status === 'pending'));

  // The request list still groups by the stored holiday_year, which is what the year filter on
  // the request header means. Totals above deliberately do not use it.
  const yearRequests = leaveRequests.filter(r => r.holiday_year === selectedYear);

  // What they are entitled to in the selected year: the whole allowance, or the share of the year
  // they are employed for when they start or leave part way through it.
  const entitlement = getHolidayEntitlement({
    allowance: yearlyAllowance,
    holidayYear: selectedYear,
    startMonth: holidayYearStartMonth,
    startDay: holidayYearStartDay,
    employmentStartDate,
    employmentEndDate,
  });
  const allowance = entitlement.entitlement;
  const proRatedText = entitlement.proRated
    ? entitlement.employedFrom && entitlement.employedTo
      ? `Pro-rated from ${yearlyAllowance} days a year, for ${formatDate(entitlement.employedFrom)} to ${formatDate(entitlement.employedTo)}.`
      : `They were not employed in ${yearLabel(selectedYear)}, so they had no allowance that year.`
    : null;

  // A leaver's holiday for their final pay: what they earned to their last working day, less what
  // they took up to it. Shown for the year their last day falls in.
  const lastDayInYear = Boolean(
    employmentEndDate && entitlement.employedTo && entitlement.employedTo === employmentEndDate,
  );
  const untakenHoliday = lastDayInYear && employmentEndDate
    ? getUntakenHoliday(
        allowance,
        countAllowanceDays(selectedDays.filter(d => d.status === 'approved' && d.leave_date <= employmentEndDate)),
      )
    : null;
  const untakenHolidayText = untakenHoliday === null || !employmentEndDate
    ? null
    : untakenHoliday > 0
      ? `${formatHolidayDays(untakenHoliday)} earned but not taken by their last working day, ${formatDate(employmentEndDate)}, to include in their final pay.`
      : untakenHoliday === 0
        ? `No untaken holiday at their last working day, ${formatDate(employmentEndDate)}.`
        : `They took ${formatHolidayDays(-untakenHoliday)} more than they had earned by their last working day, ${formatDate(employmentEndDate)}. Check their final pay.`;

  const progressPct = allowance > 0 ? Math.min(100, (approvedDays / allowance) * 100) : 0;
  const overAllowance = allowance > 0 && approvedDays >= allowance;
  // Exactly at the allowance is "used in full", not "0 days over allowance". A pro-rated allowance
  // can be fractional, so the difference is rounded as the allowance is.
  const remainingDays = getUntakenHoliday(allowance, approvedDays);
  const allowanceSummary = remainingDays > 0
    ? `${formatHolidayDays(remainingDays)} remaining`
    : remainingDays === 0
      ? 'Allowance used in full'
      : `${formatHolidayDays(-remainingDays)} over allowance`;
  const onboardingTimeOffText = onboardingTimeOff
    ? `${onboardingTimeOff.answer === 'none'
        ? 'At onboarding they said they had no time off already booked'
        : 'At onboarding they listed time off already booked, shown in the requests below'} (answered ${formatDate(onboardingTimeOff.answeredAt)}).`
    : null;

  const handleBook = () => {
    if (!bookStart) { setBookError('Choose a start date'); return; }
    if (!bookEnd)   { setBookError('Choose an end date'); return; }
    if (bookEnd < bookStart) { setBookError('End date must be on or after start date'); return; }
    setBookError('');

    startBookTransition(async () => {
      const result = await bookApprovedHoliday({
        employeeId,
        startDate: bookStart,
        endDate: bookEnd,
        note: bookNote || null,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Holiday booked');
      setShowBookForm(false);
      setBookStart('');
      setBookEnd('');
      setBookNote('');
    });
  };

  const allowanceTone = holidayAllowanceTone(overAllowance);

  // A failed load says so rather than showing no days used and no requests.
  if (loadError) {
    return (
      <Card>
        <CardHeader title="Holidays" subtitle="Holiday allowance and leave requests" />
        <CardBody>
          <Alert tone="danger" title="Could not load holidays">{loadError}</Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Holidays"
          subtitle="Holiday allowance and leave requests"
          action={canCreateLeave && !showBookForm && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={<Icon name="plus" size={16} />}
              onClick={() => setShowBookForm(true)}
            >
              Book Holiday
            </Button>
          )}
        />

        {/* Book holiday form */}
        {showBookForm && canCreateLeave && (
          <CardBody className="space-y-4 border-b border-border">
            <SubHeading>Book Holiday</SubHeading>
            {bookError && <Alert tone="danger" size="sm">{bookError}</Alert>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start date" required>
                <Input
                  id="book-start"
                  type="date"
                  value={bookStart}
                  onChange={e => setBookStart(e.target.value)}
                />
              </Field>
              <Field label="End date" required>
                <Input
                  id="book-end"
                  type="date"
                  value={bookEnd}
                  onChange={e => setBookEnd(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Note (optional)">
              {/* The server keeps notes to 500 characters; this stops a longer one being typed. */}
              <Input
                id="book-note"
                placeholder="e.g. Annual leave"
                maxLength={500}
                value={bookNote}
                onChange={e => setBookNote(e.target.value)}
              />
            </Field>
            <FormFooter>
              <Button type="button" variant="secondary" onClick={() => { setShowBookForm(false); setBookError(''); }}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleBook} loading={bookIsPending}>
                Book Holiday
              </Button>
            </FormFooter>
          </CardBody>
        )}

        <CardBody className="space-y-4">
          {/* Year selector: the same figures for another holiday year */}
          <div className="max-w-full overflow-x-auto">
            <Segmented
              aria-label="Holiday year"
              options={availableYears.map(y => ({ id: String(y), label: yearLabel(y) }))}
              value={String(selectedYear)}
              onChange={id => setSelectedYear(Number(id))}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-text">Holiday year {yearLabel(selectedYear)}</p>
              <span className={`text-sm font-semibold ${HOLIDAY_ALLOWANCE_TEXT_CLASSES[allowanceTone]}`}>
                {approvedDays} / {allowance} days
              </span>
            </div>
            <ProgressBar value={progressPct} tone={allowanceTone} size="md" label="Holiday allowance used" />
            <div className="flex gap-4 text-xs text-text-muted">
              <span>{allowanceSummary}</span>
              {pendingDays > 0 && <span className="text-warning-fg">{pendingDays} pending</span>}
            </div>
          </div>

          {proRatedText && (
            <p className="text-sm text-text-muted">{proRatedText}</p>
          )}

          {untakenHolidayText && (
            <Alert tone={untakenHoliday !== null && untakenHoliday < 0 ? 'warning' : 'info'} size="sm" role="status" title="Holiday for their final pay">
              {untakenHolidayText}
            </Alert>
          )}

          {onboardingTimeOffText && (
            <p className="text-sm text-text-muted">{onboardingTimeOffText}</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Leave Requests" subtitle={`Holiday year ${yearLabel(selectedYear)}`} />
        {yearRequests.length === 0 ? (
          <Empty
            size="sm"
            icon={<Icon name="calendar" size={32} />}
            title={`No holiday requests for ${yearLabel(selectedYear)}`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {yearRequests.map(r => {
              const days = countRequestDays(r.start_date, r.end_date);
              // Each row says what it is: days a starter cannot work are not holiday, and the
              // allowance above leaves them out, so the list must not read as if they were.
              const details = [
                leaveTypeLabel(r.leave_type),
                `${days} ${days === 1 ? 'day' : 'days'}`,
                r.leave_origin === 'agreed_at_hire' ? ONBOARDING_LEAVE_ORIGIN_LABEL : null,
                r.note,
              ].filter(Boolean).join(' · ');
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-pad-card py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">
                      {formatDate(r.start_date)}
                      {r.start_date !== r.end_date && <> – {formatDate(r.end_date)}</>}
                    </p>
                    <p className="text-xs text-text-muted">{details}</p>
                  </div>
                  <Badge tone={rotaLeaveStatusTone(r.status)} size="sm">
                    {rotaLeaveStatusLabel(r.status)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
