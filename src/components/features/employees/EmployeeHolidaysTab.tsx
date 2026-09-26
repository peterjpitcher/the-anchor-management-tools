'use client';

import { useState, useTransition } from 'react';
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Field, FormFooter, Icon, Input, ProgressBar, Segmented, toast } from '@/ds';
import {
  HOLIDAY_ALLOWANCE_TEXT_CLASSES,
  holidayAllowanceTone,
  leaveStatusTone,
} from '@/app/(authenticated)/employees/_shared/status-ui';
import { bookApprovedHoliday, type LeaveRequest } from '@/app/actions/leave';
import type { EmployeePaySettings } from '@/app/actions/pay-bands';
import type { RotaSettings } from '@/app/actions/rota-settings';
import {
  countAllowanceDays,
  countRequestDays,
  getHolidayYear,
} from '@/lib/leave/working-days';
import type { EmployeeLeaveDay } from '@/app/actions/leave';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';

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
}: EmployeeHolidaysTabProps) {
  const { holidayYearStartMonth, holidayYearStartDay, defaultHolidayDays } = rotaSettings;
  const allowance = paySettings?.holiday_allowance_days ?? defaultHolidayDays;

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
  // previous year still surfaces the year its days actually land in.
  const availableYears = [...new Set([...daysByYear.keys(), currentYear])].sort((a, b) => b - a);

  const selectedDays = daysByYear.get(selectedYear) ?? [];
  const approvedDays = countAllowanceDays(selectedDays.filter(d => d.status === 'approved'));
  const pendingDays = countAllowanceDays(selectedDays.filter(d => d.status === 'pending'));

  // The request list still groups by the stored holiday_year, which is what the year filter on
  // the request header means. Totals above deliberately do not use it.
  const yearRequests = leaveRequests.filter(r => r.holiday_year === selectedYear);

  const progressPct = allowance > 0 ? Math.min(100, (approvedDays / allowance) * 100) : 0;
  const overAllowance = allowance > 0 && approvedDays >= allowance;

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
            <p className="text-sm font-medium text-text">Book approved holiday</p>
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
              <Input
                id="book-note"
                placeholder="e.g. Annual leave"
                value={bookNote}
                onChange={e => setBookNote(e.target.value)}
              />
            </Field>
            <FormFooter>
              <Button type="button" variant="secondary" onClick={() => { setShowBookForm(false); setBookError(''); }}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleBook} disabled={bookIsPending}>
                {bookIsPending ? 'Saving…' : 'Confirm Booking'}
              </Button>
            </FormFooter>
          </CardBody>
        )}

        <CardBody className="space-y-4">
          {/* Year selector: the same figures for another holiday year */}
          <div className="max-w-full overflow-x-auto">
            <Segmented
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
              <span>{allowance - approvedDays > 0 ? `${allowance - approvedDays} days remaining` : `${approvedDays - allowance} days over allowance`}</span>
              {pendingDays > 0 && <span className="text-warning-fg">{pendingDays} pending</span>}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Leave Requests" subtitle={`Holiday year ${yearLabel(selectedYear)}`} />
        {yearRequests.length === 0 ? (
          <Empty
            size="sm"
            icon={<Icon name="calendar" size={32} />}
            title={`No leave requests for ${yearLabel(selectedYear)}`}
          />
        ) : (
          <ul className="divide-y divide-border">
            {yearRequests.map(r => {
              const days = countRequestDays(r.start_date, r.end_date);
              return (
                <li key={r.id} className="flex items-center justify-between gap-3 px-pad-card py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">
                      {formatDate(r.start_date)}
                      {r.start_date !== r.end_date && <> – {formatDate(r.end_date)}</>}
                    </p>
                    <p className="text-xs text-text-muted">
                      {days} {days === 1 ? 'day' : 'days'}
                      {r.note && ` · ${r.note}`}
                    </p>
                  </div>
                  <Badge tone={leaveStatusTone(r.status)} size="sm">
                    {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
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
