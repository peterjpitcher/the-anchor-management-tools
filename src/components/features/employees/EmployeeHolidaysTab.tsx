'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { CalendarDaysIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Badge } from '@/components/ui-v2/display/Badge';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { bookApprovedHoliday, type LeaveRequest } from '@/app/actions/leave';
import type { EmployeePaySettings } from '@/app/actions/pay-bands';
import type { RotaSettings } from '@/app/actions/rota-settings';

interface EmployeeHolidaysTabProps {
  employeeId: string;
  canCreateLeave: boolean;
  leaveRequests: LeaveRequest[];
  paySettings: EmployeePaySettings | null;
  rotaSettings: Pick<RotaSettings, 'holidayYearStartMonth' | 'holidayYearStartDay' | 'defaultHolidayDays'>;
}

function getHolidayYear(date: Date, startMonth: number, startDay: number): number {
  const year = date.getFullYear();
  const yearStart = new Date(year, startMonth - 1, startDay);
  return date >= yearStart ? year : year - 1;
}

function daysBetween(start: string, end: string): number {
  const ms = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function yearLabel(year: number) {
  return `${year}/${String(year + 1).slice(2)}`;
}

function statusVariant(status: LeaveRequest['status']): 'success' | 'warning' | 'error' {
  if (status === 'approved') return 'success';
  if (status === 'pending') return 'warning';
  return 'error';
}

export default function EmployeeHolidaysTab({
  employeeId,
  canCreateLeave,
  leaveRequests,
  paySettings,
  rotaSettings,
}: EmployeeHolidaysTabProps) {
  const { holidayYearStartMonth, holidayYearStartDay, defaultHolidayDays } = rotaSettings;
  const allowance = paySettings?.holiday_allowance_days ?? defaultHolidayDays;

  const currentYear = getHolidayYear(new Date(), holidayYearStartMonth, holidayYearStartDay);
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookStart, setBookStart] = useState('');
  const [bookEnd, setBookEnd] = useState('');
  const [bookNote, setBookNote] = useState('');
  const [bookError, setBookError] = useState('');
  const [bookIsPending, startBookTransition] = useTransition();

  // Derive available years from requests + always include current year
  const yearsInData = [...new Set(leaveRequests.map(r => r.holiday_year))];
  const availableYears = [...new Set([...yearsInData, currentYear])].sort((a, b) => b - a);

  const yearRequests = leaveRequests.filter(r => r.holiday_year === selectedYear);

  // Count approved days for selected year (from dates, not leave_days table)
  const approvedDays = yearRequests
    .filter(r => r.status === 'approved')
    .reduce((sum, r) => sum + daysBetween(r.start_date, r.end_date), 0);

  const pendingDays = yearRequests
    .filter(r => r.status === 'pending')
    .reduce((sum, r) => sum + daysBetween(r.start_date, r.end_date), 0);

  const progressPct = Math.min(100, (approvedDays / allowance) * 100);
  const overAllowance = approvedDays >= allowance;

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Holidays</h3>
          <p className="mt-1 text-sm text-gray-600">
            Holiday allowance and leave requests.
          </p>
        </div>
        {canCreateLeave && !showBookForm && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => setShowBookForm(true)}
          >
            Book holiday
          </Button>
        )}
      </div>

      {/* Book holiday form */}
      {showBookForm && canCreateLeave && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
          <p className="text-sm font-medium text-gray-700">Book approved holiday</p>
          {bookError && <Alert variant="error">{bookError}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <FormGroup label="Start date" htmlFor="book-start" required>
              <Input
                id="book-start"
                type="date"
                value={bookStart}
                onChange={e => setBookStart(e.target.value)}
              />
            </FormGroup>
            <FormGroup label="End date" htmlFor="book-end" required>
              <Input
                id="book-end"
                type="date"
                value={bookEnd}
                onChange={e => setBookEnd(e.target.value)}
              />
            </FormGroup>
          </div>
          <FormGroup label="Note (optional)" htmlFor="book-note">
            <Input
              id="book-note"
              placeholder="e.g. Annual leave"
              value={bookNote}
              onChange={e => setBookNote(e.target.value)}
            />
          </FormGroup>
          <div className="flex gap-2">
            <Button type="button" onClick={handleBook} disabled={bookIsPending}>
              {bookIsPending ? 'Saving…' : 'Confirm booking'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setShowBookForm(false); setBookError(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Year selector */}
      <div className="flex items-center gap-2">
        {availableYears.map(y => (
          <button
            key={y}
            type="button"
            onClick={() => setSelectedYear(y)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              y === selectedYear
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {yearLabel(y)}
          </button>
        ))}
      </div>

      {/* Allowance progress */}
      <div className="rounded-lg border border-gray-200 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-700">Holiday year {yearLabel(selectedYear)}</p>
          <span className={`text-sm font-semibold ${overAllowance ? 'text-red-600' : 'text-gray-900'}`}>
            {approvedDays} / {allowance} days
          </span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className={`h-2 rounded-full transition-all ${overAllowance ? 'bg-red-500' : 'bg-green-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex gap-4 text-xs text-gray-500">
          <span>{allowance - approvedDays > 0 ? `${allowance - approvedDays} days remaining` : `${approvedDays - allowance} days over allowance`}</span>
          {pendingDays > 0 && <span className="text-amber-600">{pendingDays} pending</span>}
        </div>
      </div>

      {/* Leave request list */}
      {yearRequests.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-gray-400">
          <CalendarDaysIcon className="h-8 w-8 mb-2 text-gray-300" />
          No leave requests for {yearLabel(selectedYear)}.
        </div>
      ) : (
        <div className="space-y-2">
          {yearRequests.map(r => {
            const days = daysBetween(r.start_date, r.end_date);
            return (
              <div key={r.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {formatDate(r.start_date)}
                    {r.start_date !== r.end_date && <> – {formatDate(r.end_date)}</>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {days} {days === 1 ? 'day' : 'days'}
                    {r.note && ` · ${r.note}`}
                  </p>
                </div>
                <Badge variant={statusVariant(r.status)} size="sm">
                  {r.status.charAt(0).toUpperCase() + r.status.slice(1)}
                </Badge>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
