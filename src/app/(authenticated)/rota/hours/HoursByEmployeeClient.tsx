'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronDown, Download, Users, X } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Button, Card, CardBody, CardHeader, Input, SearchInput } from '@/ds';
import { cn } from '@/lib/utils';

export interface HoursEmployeeOption {
  id: string;
  name: string;
  role: string | null;
  totalHours: number;
  holidayDays: number;
  sickDays: number;
}

export interface HoursSeries {
  employeeId: string;
  name: string;
  colour: string;
  totalHours: number;
}

export interface WeeklyHolidayDetail {
  employeeId: string;
  name: string;
  colour: string;
  dates: string[];
  days: number;
}

export interface SickEntry {
  date: string;
  reason: string | null;
}

export interface WeeklySickDetail {
  employeeId: string;
  name: string;
  colour: string;
  entries: SickEntry[];
  days: number;
}

export interface WeeklyHoursRow {
  weekStart: string;
  weekLabel: string;
  __holidayDays?: number;
  __holidayDetails?: WeeklyHolidayDetail[];
  __sickDays?: number;
  __sickDetails?: WeeklySickDetail[];
  [employeeId: string]: string | number | WeeklyHolidayDetail[] | WeeklySickDetail[] | null | undefined;
}

export interface HolidayEmployeeSummary {
  employeeId: string;
  name: string;
  colour: string;
  holidayDays: number;
  dates: string[];
}

export interface SickEmployeeSummary {
  employeeId: string;
  name: string;
  colour: string;
  sickDays: number;
  entries: SickEntry[];
}

interface HoursByEmployeeClientProps {
  employees: HoursEmployeeOption[];
  selectedEmployeeIds: string[];
  fromDate: string;
  toDate: string;
  chartData: WeeklyHoursRow[];
  series: HoursSeries[];
  totalHours: number;
  totalHolidayDays: number;
  totalSickDays: number;
  holidaySummaries: HolidayEmployeeSummary[];
  sickSummaries: SickEmployeeSummary[];
  completedSessionCount: number;
  openSessionCount: number;
  weekCount: number;
}

interface HolidayRecordRow {
  employeeId: string;
  name: string;
  date: string;
}

interface SickRecordRow {
  employeeId: string;
  name: string;
  date: string;
  reason: string | null;
}

const HOLIDAY_COLOUR = '#d97706';
const SICK_COLOUR = '#2563eb';

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function fullDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatHolidayDays(value: number): string {
  return `${value} day${value === 1 ? '' : 's'}`;
}

function formatSickDays(value: number): string {
  return `${value} day${value === 1 ? '' : 's'}`;
}

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return '';

  const sortedDates = [...dates].sort();
  const ranges: Array<{ start: string; end: string }> = [];
  let start = sortedDates[0];
  let end = sortedDates[0];

  for (const date of sortedDates.slice(1)) {
    const nextExpected = new Date(`${end}T00:00:00Z`);
    nextExpected.setUTCDate(nextExpected.getUTCDate() + 1);
    const nextExpectedIso = nextExpected.toISOString().split('T')[0];

    if (date === nextExpectedIso) {
      end = date;
    } else {
      ranges.push({ start, end });
      start = date;
      end = date;
    }
  }

  ranges.push({ start, end });

  return ranges.map(range => (
    range.start === range.end
      ? shortDate(range.start)
      : `${shortDate(range.start)} - ${shortDate(range.end)}`
  )).join(', ');
}

function formatSickEntries(entries: SickEntry[]): string {
  return entries
    .map(entry => `${shortDate(entry.date)}${entry.reason ? ` (${entry.reason})` : ''}`)
    .join(', ');
}

function HoursTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{
    dataKey?: string | number;
    value?: number;
    color?: string;
    name?: string;
    payload?: WeeklyHoursRow;
  }>;
  label?: string;
}) {
  const chartRow = payload?.find(item => item.payload)?.payload;
  const holidayDays = Number(chartRow?.__holidayDays ?? 0);
  const holidayDetails = chartRow?.__holidayDetails ?? [];
  const sickDays = Number(chartRow?.__sickDays ?? 0);
  const sickDetails = chartRow?.__sickDetails ?? [];
  const rows = (payload ?? [])
    .filter(item =>
      typeof item.value === 'number' &&
      item.value > 0 &&
      !String(item.dataKey ?? '').startsWith('__')
    )
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

  if (!active || (rows.length === 0 && holidayDays === 0 && sickDays === 0)) return null;

  return (
    <div className="min-w-[180px] rounded-default border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold text-text-strong">{label}</p>
      {rows.length > 0 && (
        <div className="mt-2 space-y-1">
          {rows.map(row => (
            <div key={String(row.dataKey)} className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
                <span className="truncate text-text-muted">{row.name}</span>
              </span>
              <span className="shrink-0 font-semibold text-text-strong">{formatHours(Number(row.value))}</span>
            </div>
          ))}
        </div>
      )}
      {holidayDays > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-warning-fg">
              <span className="h-2 w-2 shrink-0 rounded-full bg-warning" />
              Holiday booked
            </span>
            <span className="font-semibold text-text-strong">{formatHolidayDays(holidayDays)}</span>
          </div>
          <div className="mt-1 space-y-1">
            {holidayDetails.map(item => (
              <p key={item.employeeId} className="text-[11px] leading-snug text-text-muted">
                <span className="font-medium text-text">{item.name}</span>: {formatDateRange(item.dates)}
              </p>
            ))}
          </div>
        </div>
      )}
      {sickDays > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-danger">
              <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
              Couldn&apos;t Work recorded
            </span>
            <span className="font-semibold text-text-strong">{formatSickDays(sickDays)}</span>
          </div>
          <div className="mt-1 space-y-1">
            {sickDetails.map(item => (
              <p key={item.employeeId} className="text-[11px] leading-snug text-text-muted">
                <span className="font-medium text-text">{item.name}</span>: {formatSickEntries(item.entries)}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface EmployeeMultiSelectProps {
  employees: HoursEmployeeOption[];
  selectedEmployeeIds: string[];
  onChange: (employeeIds: string[]) => void;
}

function EmployeeMultiSelect({ employees, selectedEmployeeIds, onChange }: EmployeeMultiSelectProps) {
  const [query, setQuery] = useState('');
  const selectedIdSet = useMemo(() => new Set(selectedEmployeeIds), [selectedEmployeeIds]);
  const employeeOrder = useMemo(
    () => new Map(employees.map((employee, index) => [employee.id, index])),
    [employees],
  );
  const selectedEmployees = useMemo(
    () => employees.filter(employee => selectedIdSet.has(employee.id)),
    [employees, selectedIdSet],
  );
  const filteredEmployees = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return employees;

    return employees.filter(employee =>
      `${employee.name} ${employee.role ?? ''}`.toLowerCase().includes(normalizedQuery)
    );
  }, [employees, query]);

  const selectedSummary = (() => {
    if (selectedEmployees.length === 0) return 'No employees selected';
    if (selectedEmployees.length === employees.length) return 'All employees';
    if (selectedEmployees.length <= 2) return selectedEmployees.map(employee => employee.name).join(', ');
    return `${selectedEmployees.length} employees selected`;
  })();

  const selectedHint = employees.length === 0
    ? 'No employees available'
    : `${selectedEmployees.length} of ${employees.length} selected`;

  const sortIds = (ids: string[]) => (
    [...new Set(ids)].sort((a, b) =>
      (employeeOrder.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (employeeOrder.get(b) ?? Number.MAX_SAFE_INTEGER) ||
      a.localeCompare(b)
    )
  );

  const toggleEmployee = (employeeId: string) => {
    if (selectedIdSet.has(employeeId)) {
      onChange(selectedEmployeeIds.filter(id => id !== employeeId));
      return;
    }

    onChange(sortIds([...selectedEmployeeIds, employeeId]));
  };

  return (
    <div className="flex flex-col">
      <span className="mb-1 text-[13px] font-medium text-text">Employees</span>
      <Popover className="relative">
        {({ open }) => (
          <>
            <PopoverButton
              type="button"
              disabled={employees.length === 0}
              className={cn(
                'flex min-h-[var(--spacing-input-h)] w-full items-center justify-between gap-3 rounded-default border border-border bg-surface px-3 py-2 text-left',
                'outline-none transition-[border-color,box-shadow] duration-[120ms]',
                'hover:bg-surface-hover focus-visible:border-border-focus focus-visible:shadow-ring',
                employees.length === 0 && 'cursor-not-allowed bg-surface-2 opacity-50'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Users className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold text-text-strong">
                    {selectedSummary}
                  </span>
                  <span className="block truncate text-xs text-text-muted">{selectedHint}</span>
                </span>
              </span>
              <ChevronDown
                className={cn('h-4 w-4 shrink-0 text-text-subtle transition-transform', open && 'rotate-180')}
                aria-hidden="true"
              />
            </PopoverButton>

            <PopoverPanel
              className={cn(
                'absolute left-0 z-50 mt-2 w-full min-w-[min(28rem,calc(100vw-2rem))] rounded-default border border-border bg-surface p-3 shadow-lg',
                'focus:outline-none'
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-muted">Employees</p>
                <div className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    icon={<Check className="h-3 w-3" />}
                    onClick={() => onChange(sortIds(employees.map(employee => employee.id)))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    icon={<X className="h-3 w-3" />}
                    disabled={selectedEmployeeIds.length === 0}
                    onClick={() => onChange([])}
                  >
                    Clear
                  </Button>
                </div>
              </div>

              <SearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search employees"
                className="mt-3"
              />

              <div className="mt-3 max-h-72 overflow-y-auto pr-1">
                {filteredEmployees.length === 0 ? (
                  <p className="rounded-default bg-surface-2 px-3 py-4 text-center text-sm text-text-muted">
                    No employees match this search.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {filteredEmployees.map(employee => {
                      const selected = selectedIdSet.has(employee.id);

                      return (
                        <button
                          key={employee.id}
                          type="button"
                          role="checkbox"
                          aria-checked={selected}
                          onClick={() => toggleEmployee(employee.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-default px-2.5 py-2 text-left transition-colors',
                            'hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-ring',
                            selected && 'bg-primary-soft'
                          )}
                        >
                          <span
                            className={cn(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors',
                              selected
                                ? 'border-primary bg-primary text-primary-fg'
                                : 'border-border-strong bg-surface text-transparent'
                            )}
                            aria-hidden="true"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-text">{employee.name}</span>
                            <span className="block truncate text-xs text-text-muted">
                              {employee.role || 'No role'} · {formatHours(employee.totalHours)} · {formatHolidayDays(employee.holidayDays)} holiday · Couldn&apos;t Work: {formatSickDays(employee.sickDays)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </PopoverPanel>
          </>
        )}
      </Popover>
    </div>
  );
}

export default function HoursByEmployeeClient({
  employees,
  selectedEmployeeIds,
  fromDate,
  toDate,
  chartData,
  series,
  totalHours,
  totalHolidayDays,
  totalSickDays,
  holidaySummaries,
  sickSummaries,
  completedSessionCount,
  openSessionCount,
  weekCount,
}: HoursByEmployeeClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [draftFrom, setDraftFrom] = useState(fromDate);
  const [draftTo, setDraftTo] = useState(toDate);
  const [draftEmployeeIds, setDraftEmployeeIds] = useState<string[]>(selectedEmployeeIds);

  const selectedLabel = draftEmployeeIds.length === 0
    ? 'No employees selected'
    : `${draftEmployeeIds.length} selected`;
  const averagePerWeek = weekCount > 0 ? totalHours / weekCount : 0;
  const isWideRange = chartData.length > 52;
  const xAxisInterval = isWideRange ? Math.ceil(chartData.length / 16) : 'preserveStartEnd';
  const chartHeight = isWideRange ? 420 : 380;
  const maxBarSize = isWideRange ? 12 : 24;
  const absenceAxisMax = Math.max(
    1,
    Math.ceil(Math.max(...chartData.map(row => Number(row.__holidayDays ?? 0)))),
    Math.ceil(Math.max(...chartData.map(row => Number(row.__sickDays ?? 0)))),
  );
  const holidayDaysByEmployee = useMemo(
    () => new Map(holidaySummaries.map(summary => [summary.employeeId, summary.holidayDays])),
    [holidaySummaries],
  );
  const sickDaysByEmployee = useMemo(
    () => new Map(sickSummaries.map(summary => [summary.employeeId, summary.sickDays])),
    [sickSummaries],
  );
  const holidayRows = useMemo<HolidayRecordRow[]>(
    () => holidaySummaries
      .flatMap(summary => summary.dates.map(date => ({
        employeeId: summary.employeeId,
        name: summary.name,
        date,
      })))
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
    [holidaySummaries],
  );
  const sickRows = useMemo<SickRecordRow[]>(
    () => sickSummaries
      .flatMap(summary => summary.entries.map(entry => ({
        employeeId: summary.employeeId,
        name: summary.name,
        date: entry.date,
        reason: entry.reason,
      })))
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)),
    [sickSummaries],
  );
  const pdfHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set('from', fromDate);
    params.set('to', toDate);
    for (const employeeId of selectedEmployeeIds) {
      params.append('employee', employeeId);
    }
    return `/api/rota/hours/pdf?${params.toString()}`;
  }, [fromDate, selectedEmployeeIds, toDate]);

  const applyFilters = () => {
    const params = new URLSearchParams();
    params.set('from', draftFrom);
    params.set('to', draftTo);
    for (const employeeId of draftEmployeeIds) {
      params.append('employee', employeeId);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="space-y-5">
      <Card className="overflow-visible">
        <CardHeader title="Filters" subtitle={selectedLabel} />
        <CardBody className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[180px_180px_minmax(280px,1fr)_minmax(220px,auto)_auto] xl:items-end">
            <Input
              label="From"
              type="date"
              value={draftFrom}
              max={draftTo}
              onChange={event => setDraftFrom(event.target.value)}
            />
            <Input
              label="To"
              type="date"
              value={draftTo}
              min={draftFrom}
              onChange={event => setDraftTo(event.target.value)}
            />
            <EmployeeMultiSelect
              employees={employees}
              selectedEmployeeIds={draftEmployeeIds}
              onChange={setDraftEmployeeIds}
            />
            <div className="rounded-default border border-border bg-surface-2 px-3 py-2 text-sm text-text-muted sm:order-5 sm:col-span-2 xl:order-4 xl:col-span-1">
              Weeks shown: <span className="font-semibold text-text-strong">{weekCount}</span>
              <span className="mx-2 text-text-subtle">/</span>
              Employees: <span className="font-semibold text-text-strong">{series.length}</span>
            </div>
            <div className="flex items-center gap-2 justify-self-start sm:order-4 xl:order-5">
              <Button type="button" onClick={applyFilters}>
                Apply
              </Button>
              <a
                href={pdfHref}
                download
                aria-disabled={series.length === 0}
                className={cn(
                  'inline-flex h-[var(--spacing-btn-h)] items-center justify-center gap-1.5 rounded-[8px] border border-border-strong bg-surface px-3 text-[13px] font-semibold text-text no-underline',
                  'transition-[background,border-color,color,transform,box-shadow] duration-[120ms] hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-ring active:translate-y-[0.5px]',
                  series.length === 0 && 'pointer-events-none opacity-50'
                )}
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Download PDF
              </a>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <Card>
          <p className="text-xs font-medium text-text-muted">Actual + planned hours</p>
          <p className="mt-1 text-2xl font-semibold text-text-strong">{formatHours(totalHours)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-text-muted">Average per week</p>
          <p className="mt-1 text-2xl font-semibold text-text-strong">{formatHours(averagePerWeek)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-text-muted">Holidays booked</p>
          <p className="mt-1 text-2xl font-semibold text-text-strong">{formatHolidayDays(totalHolidayDays)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-text-muted">Couldn&apos;t Work recorded</p>
          <p className="mt-1 text-2xl font-semibold text-text-strong">{formatSickDays(totalSickDays)}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-text-muted">Completed sessions</p>
          <p className="mt-1 text-2xl font-semibold text-text-strong">{completedSessionCount}</p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-text-muted">Open sessions ignored</p>
          <p className="mt-1 text-2xl font-semibold text-text-strong">{openSessionCount}</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Hours by week"
          subtitle={`${shortDate(fromDate)} - ${shortDate(toDate)}`}
          action={
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span>Actual + planned hours</span>
              <span className="ml-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: HOLIDAY_COLOUR }} />
              <span>Holiday days</span>
              <span className="ml-2 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: SICK_COLOUR }} />
              <span>Couldn&apos;t Work days</span>
            </div>
          }
        />
        <CardBody>
          {series.length === 0 || chartData.length === 0 ? (
            <div className="rounded-default border border-dashed border-border bg-surface-2 p-8 text-center text-sm text-text-muted">
              Select at least one employee to show hours.
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0">
                <div style={{ height: chartHeight }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart
                      data={chartData}
                      margin={{ top: 12, right: 16, bottom: 6, left: 0 }}
                      barCategoryGap={isWideRange ? 2 : 8}
                      barGap={2}
                    >
                      <CartesianGrid vertical={false} stroke="var(--color-border)" />
                      <XAxis
                        dataKey="weekLabel"
                        interval={xAxisInterval}
                        minTickGap={16}
                        tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        yAxisId="hours"
                        tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                        axisLine={false}
                        tickLine={false}
                        unit="h"
                      />
                      <YAxis
                        yAxisId="absence"
                        orientation="right"
                        domain={[0, absenceAxisMax]}
                        allowDecimals={false}
                        tickFormatter={(value) => `${value}d`}
                        tick={{ fontSize: 11, fill: 'var(--color-warning-fg)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RechartsTooltip content={<HoursTooltip />} cursor={{ fill: 'var(--color-surface-hover)' }} />
                      {series.map(item => (
                        <Line
                          key={item.employeeId}
                          yAxisId="hours"
                          dataKey={item.employeeId}
                          name={item.name}
                          type="linear"
                          stroke={item.colour}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 3 }}
                          isAnimationActive={false}
                        />
                      ))}
                      <Bar
                        yAxisId="absence"
                        dataKey="__holidayDays"
                        name="Holiday days"
                        fill={HOLIDAY_COLOUR}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={maxBarSize}
                        isAnimationActive={false}
                      />
                      <Bar
                        yAxisId="absence"
                        dataKey="__sickDays"
                        name="Couldn't Work days"
                        fill={SICK_COLOUR}
                        radius={[4, 4, 0, 0]}
                        maxBarSize={maxBarSize}
                        isAnimationActive={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-text-strong">Employees shown</h3>
                  <p className="text-xs text-text-muted">Totals across the selected dates.</p>
                </div>
                <div className="space-y-2">
                  {series.map(item => (
                    <div key={item.employeeId} className="flex items-center justify-between gap-3 rounded-default bg-surface-2 px-3 py-2 text-xs">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.colour }} />
                        <span className="truncate font-medium text-text">{item.name}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-semibold text-text-strong">{formatHours(item.totalHours)}</span>
                        <span className="block text-[11px] text-text-muted">
                          {formatHolidayDays(holidayDaysByEmployee.get(item.employeeId) ?? 0)} holiday
                          {' · '}Couldn&apos;t Work: {formatSickDays(sickDaysByEmployee.get(item.employeeId) ?? 0)}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Holidays booked"
          subtitle={`${formatHolidayDays(totalHolidayDays)} from ${shortDate(fromDate)} - ${shortDate(toDate)}`}
        />
        <CardBody>
          {holidayRows.length === 0 ? (
            <div className="rounded-default border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
              No approved holidays booked for the selected employees in this date range.
            </div>
          ) : (
            <div className="overflow-hidden rounded-default border border-border">
              <div className="max-h-[420px] overflow-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-left text-xs font-semibold text-text-muted">
                    <tr>
                      <th scope="col" className="w-1/2 px-3 py-2">Employee</th>
                      <th scope="col" className="px-3 py-2">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-surface">
                    {holidayRows.map(row => (
                      <tr key={`${row.employeeId}-${row.date}`} className="hover:bg-surface-hover">
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: HOLIDAY_COLOUR }} />
                            <span className="truncate font-medium text-text-strong">{row.name}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-text-muted">{fullDate(row.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Couldn't Work recorded"
          subtitle={`${formatSickDays(totalSickDays)} from ${shortDate(fromDate)} - ${shortDate(toDate)}`}
        />
        <CardBody>
          {sickRows.length === 0 ? (
            <div className="rounded-default border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
              No Couldn&apos;t Work days recorded for the selected employees in this date range.
            </div>
          ) : (
            <div className="overflow-hidden rounded-default border border-border">
              <div className="max-h-[420px] overflow-auto">
                <table className="min-w-full divide-y divide-border text-sm">
                  <thead className="sticky top-0 bg-surface-2 text-left text-xs font-semibold text-text-muted">
                    <tr>
                      <th scope="col" className="w-[28%] px-3 py-2">Employee</th>
                      <th scope="col" className="w-[22%] px-3 py-2">Date</th>
                      <th scope="col" className="px-3 py-2">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border bg-surface">
                    {sickRows.map(row => (
                      <tr key={`${row.employeeId}-${row.date}`} className="hover:bg-surface-hover">
                        <td className="px-3 py-2">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: SICK_COLOUR }} />
                            <span className="truncate font-medium text-text-strong">{row.name}</span>
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-text-muted">{fullDate(row.date)}</td>
                        <td className="px-3 py-2 text-text-muted">{row.reason || 'No reason recorded'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
