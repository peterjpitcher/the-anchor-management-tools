'use client';

import { useMemo, useState } from 'react';
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { usePathname, useRouter } from 'next/navigation';
import { Check, ChevronDown, Users, X } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
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

export interface WeeklyHoursRow {
  weekStart: string;
  weekLabel: string;
  __holidayDays?: number;
  __holidayDetails?: WeeklyHolidayDetail[];
  [employeeId: string]: string | number | WeeklyHolidayDetail[] | null | undefined;
}

export interface HolidayEmployeeSummary {
  employeeId: string;
  name: string;
  colour: string;
  holidayDays: number;
  dates: string[];
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
  holidaySummaries: HolidayEmployeeSummary[];
  completedSessionCount: number;
  openSessionCount: number;
  weekCount: number;
}

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatHolidayDays(value: number): string {
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
  const rows = (payload ?? [])
    .filter(item =>
      typeof item.value === 'number' &&
      item.value > 0 &&
      !String(item.dataKey ?? '').startsWith('__holiday')
    )
    .sort((a, b) => (Number(b.value) || 0) - (Number(a.value) || 0));

  if (!active || (rows.length === 0 && holidayDays === 0)) return null;

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
                              {employee.role || 'No role'} · {formatHours(employee.totalHours)} · {formatHolidayDays(employee.holidayDays)} holiday
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
  holidaySummaries,
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
  const holidayAxisMax = Math.max(
    1,
    Math.ceil(Math.max(...chartData.map(row => Number(row.__holidayDays ?? 0)))),
  );
  const holidayDaysByEmployee = useMemo(
    () => new Map(holidaySummaries.map(summary => [summary.employeeId, summary.holidayDays])),
    [holidaySummaries],
  );

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
            <Button type="button" className="justify-self-start sm:order-4 xl:order-5" onClick={applyFilters}>
              Apply
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <p className="text-xs font-medium text-text-muted">Worked hours</p>
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
          title="Worked hours by week"
          subtitle={`${shortDate(fromDate)} - ${shortDate(toDate)}`}
          action={
            <div className="flex items-center gap-2 text-xs text-text-muted">
              <span className="h-2.5 w-2.5 rounded-full bg-primary" />
              <span>Worked hours</span>
              <span className="ml-2 h-2.5 w-2.5 rounded-full bg-warning" />
              <span>Holiday days</span>
            </div>
          }
        />
        <CardBody>
          {series.length === 0 || chartData.length === 0 ? (
            <div className="rounded-default border border-dashed border-border bg-surface-2 p-8 text-center text-sm text-text-muted">
              Select at least one employee to show worked hours.
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
                        yAxisId="holiday"
                        orientation="right"
                        domain={[0, holidayAxisMax]}
                        allowDecimals={false}
                        tickFormatter={(value) => `${value}d`}
                        tick={{ fontSize: 11, fill: 'var(--color-warning-fg)' }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <RechartsTooltip content={<HoursTooltip />} cursor={{ fill: 'var(--color-surface-hover)' }} />
                      {series.map(item => (
                        <Bar
                          key={item.employeeId}
                          yAxisId="hours"
                          dataKey={item.employeeId}
                          name={item.name}
                          fill={item.colour}
                          radius={[4, 4, 0, 0]}
                          maxBarSize={maxBarSize}
                          minPointSize={2}
                          isAnimationActive={false}
                        />
                      ))}
                      <Bar
                        yAxisId="holiday"
                        dataKey="__holidayDays"
                        name="Holiday days"
                        fill="var(--color-warning)"
                        radius={[4, 4, 0, 0]}
                        maxBarSize={maxBarSize}
                        minPointSize={2}
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
          subtitle={`Approved holiday days from ${shortDate(fromDate)} - ${shortDate(toDate)}`}
        />
        <CardBody>
          {holidaySummaries.length === 0 ? (
            <div className="rounded-default border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-text-muted">
              No approved holidays booked for the selected employees in this date range.
            </div>
          ) : (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {holidaySummaries.map(item => (
                <div key={item.employeeId} className="rounded-default border border-border bg-surface-2 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.colour }} />
                      <span className="truncate text-sm font-semibold text-text-strong">{item.name}</span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-text-muted">
                      {formatHolidayDays(item.holidayDays)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{formatDateRange(item.dates)}</p>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
