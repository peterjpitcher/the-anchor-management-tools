'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ChartTooltipRow,
  Checkbox,
  ComboChart,
  Empty,
  Field,
  Input,
  Popover,
  SearchInput,
  Stat,
  StatGrid,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Icon,
  type ChartSeries,
  type ChartTooltipContext,
} from '@/ds';
import { cn } from '@/lib/utils';
import { ROTA_CHART_COLOURS } from '@/lib/rota/status-ui';

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

interface SickEntry {
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

// Approved holiday is success and Couldn't Work is danger, the same as on the rota itself
// (this report once drew them amber and blue).
const HOLIDAY_COLOUR = ROTA_CHART_COLOURS.holiday;
const SICK_COLOUR = ROTA_CHART_COLOURS.couldntWork;
// The same two meanings as classes, for the dots in the holiday and Couldn't Work tables.
const HOLIDAY_DOT = 'bg-success';
const SICK_DOT = 'bg-danger';

function formatHours(value: number): string {
  return `${value.toFixed(1)}h`;
}

// Report dates are plain days read as UTC midnights, so they are formatted in UTC too.
function shortDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function fullDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
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

/**
 * The chart tooltip body (the DS tooltip card and the week title wrap it): each person's hours
 * that week, largest first, then who was on holiday or could not work and when.
 */
function renderHoursTooltip({ row, items }: ChartTooltipContext<WeeklyHoursRow>): React.ReactNode {
  const holidayDays = Number(row.__holidayDays ?? 0);
  const holidayDetails = row.__holidayDetails ?? [];
  const sickDays = Number(row.__sickDays ?? 0);
  const sickDetails = row.__sickDetails ?? [];
  const hourItems = items
    .filter(item => !item.key.startsWith('__') && item.value > 0)
    .sort((a, b) => b.value - a.value);

  if (hourItems.length === 0 && holidayDays === 0 && sickDays === 0) return null;

  return (
    <>
      {hourItems.map(item => (
        <ChartTooltipRow key={item.key} color={item.color} label={item.label} value={item.formatted} />
      ))}
      {holidayDays > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          <ChartTooltipRow color={HOLIDAY_COLOUR} label="Holiday booked" value={formatHolidayDays(holidayDays)} />
          {holidayDetails.map(item => (
            <p key={item.employeeId} className="text-meta leading-snug text-text-muted">
              <span className="font-medium text-text">{item.name}</span>: {formatDateRange(item.dates)}
            </p>
          ))}
        </div>
      )}
      {sickDays > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-2">
          <ChartTooltipRow color={SICK_COLOUR} label="Couldn't Work recorded" value={formatSickDays(sickDays)} />
          {sickDetails.map(item => (
            <p key={item.employeeId} className="text-meta leading-snug text-text-muted">
              <span className="font-medium text-text">{item.name}</span>: {formatSickEntries(item.entries)}
            </p>
          ))}
        </div>
      )}
    </>
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
    <Field label="Employees" htmlFor="hours-employees">
      {/* The panel matches the trigger's width; Done, Escape or a click outside closes it. */}
      <Popover
        className="w-72 max-w-full"
        width="md"
        trigger={
          <Button
            id="hours-employees"
            type="button"
            variant="secondary"
            aria-describedby="hours-employees-summary"
            disabled={employees.length === 0}
            className="h-auto min-h-input-h w-full justify-between gap-3 px-3 py-2 text-left font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon name="users" size={16} className="shrink-0 text-text-subtle" />
              {/* The label names the button; the current selection describes it. */}
              <span id="hours-employees-summary" className="min-w-0">
                <span className="block truncate text-ui font-semibold text-text-strong">
                  {selectedSummary}
                </span>
                <span className="block truncate text-xs font-normal text-text-muted">{selectedHint}</span>
              </span>
            </span>
            <Icon name="chevronDown" size={16} className="shrink-0 text-text-subtle" />
          </Button>
        }
      >
        {({ close }) => (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-text-muted">Employees</p>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  icon={<Icon name="check" size={12} />}
                  onClick={() => onChange(sortIds(employees.map(employee => employee.id)))}
                >
                  Select All
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  icon={<Icon name="x" size={12} />}
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
              aria-label="Search employees"
              className="mt-3"
            />

            <div className="mt-3 max-h-72 overflow-y-auto pr-1">
              {filteredEmployees.length === 0 ? (
                <Empty size="sm" title="No employees match these filters" />
              ) : (
                <div className="space-y-1">
                  {filteredEmployees.map(employee => {
                    const selected = selectedIdSet.has(employee.id);

                    return (
                      <Checkbox
                        key={employee.id}
                        checked={selected}
                        onChange={() => toggleEmployee(employee.id)}
                        label={employee.name}
                        description={`${employee.role || 'No role'} · ${formatHours(employee.totalHours)} · ${formatHolidayDays(employee.holidayDays)} holiday · Couldn't Work: ${formatSickDays(employee.sickDays)}`}
                        className={cn('rounded-default px-2.5 py-2 hover:bg-surface-hover', selected && 'bg-primary-soft')}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            <div className="mt-3 flex justify-end border-t border-border pt-3">
              <Button type="button" size="sm" variant="secondary" onClick={close}>
                Done
              </Button>
            </div>
          </>
        )}
      </Popover>
    </Field>
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

  const averagePerWeek = weekCount > 0 ? totalHours / weekCount : 0;
  const isWideRange = chartData.length > 52;
  const absenceAxisMax = Math.max(
    1,
    Math.ceil(Math.max(...chartData.map(row => Number(row.__holidayDays ?? 0)))),
    Math.ceil(Math.max(...chartData.map(row => Number(row.__sickDays ?? 0)))),
  );
  // One line per person in their own colour on the hours axis, and the week's holiday and
  // Couldn't Work days as bars on the days axis.
  const chartSeries = useMemo<ChartSeries[]>(
    () => [
      ...series.map((item): ChartSeries => ({
        key: item.employeeId,
        label: item.name,
        type: 'line',
        curve: 'linear',
        color: item.colour,
        format: formatHours,
      })),
      { key: '__holidayDays', label: 'Holiday days', type: 'bar', axis: 'right', color: HOLIDAY_COLOUR, format: formatHolidayDays },
      { key: '__sickDays', label: "Couldn't Work days", type: 'bar', axis: 'right', color: SICK_COLOUR, format: formatSickDays },
    ],
    [series],
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
  const applyFilters = () => {
    const params = new URLSearchParams();
    params.set('from', draftFrom);
    params.set('to', draftTo);
    for (const employeeId of draftEmployeeIds) {
      params.append('employee', employeeId);
    }
    router.push(`${pathname}?${params.toString()}`);
  };

  const rangeLabel = `${shortDate(fromDate)} - ${shortDate(toDate)}`;
  const hasChart = series.length > 0 && chartData.length > 0;

  return (
    <>
      {/* Filters sit directly above the data they filter. The PDF of the applied filters is a
          header action. */}
      <div className="flex flex-wrap items-end gap-3">
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
        <Button type="button" variant="primary" onClick={applyFilters}>
          Apply
        </Button>
      </div>

      <StatGrid columns={3}>
        <Stat label="Actual + planned hours" value={formatHours(totalHours)} />
        <Stat label="Average per week" value={formatHours(averagePerWeek)} />
        <Stat label="Holidays booked" value={formatHolidayDays(totalHolidayDays)} />
        <Stat label="Couldn't Work recorded" value={formatSickDays(totalSickDays)} />
        <Stat label="Completed sessions" value={completedSessionCount} />
        <Stat label="Open sessions ignored" value={openSessionCount} />
      </StatGrid>

      <div className={cn('grid gap-6', hasChart && 'xl:grid-cols-[minmax(0,1fr)_300px]')}>
        <Card className="min-w-0">
          <CardHeader
            title="Hours by Week"
            subtitle={`${rangeLabel} · ${weekCount} week${weekCount === 1 ? '' : 's'} · ${series.length} employee${series.length === 1 ? '' : 's'}`}
          />
          {!hasChart ? (
            <Empty size="sm" icon="users" title="No employees selected" description="Select at least one employee to show their hours." />
          ) : (
            <CardBody>
              <ComboChart
                data={chartData}
                xKey="weekLabel"
                series={chartSeries}
                height={isWideRange ? 420 : 380}
                xInterval={isWideRange ? Math.ceil(chartData.length / 16) : 'preserveStartEnd'}
                leftAxis={{ format: value => `${value}h` }}
                rightAxis={{ format: value => `${value}d`, domain: [0, absenceAxisMax], allowDecimals: false }}
                maxBarSize={isWideRange ? 12 : 24}
                barCategoryGap={isWideRange ? 2 : 8}
                barGap={2}
                showLegend
                renderTooltip={renderHoursTooltip}
                ariaLabel={`Hours per week for ${series.length} employee${series.length === 1 ? '' : 's'}, with holiday and Couldn't Work days`}
              />
            </CardBody>
          )}
        </Card>

        {hasChart && (
          <Card>
            <CardHeader title="Employees Shown" subtitle="Totals across the selected dates" />
            <ul className="divide-y divide-border">
              {series.map(item => (
                <li key={item.employeeId} className="flex items-center justify-between gap-3 px-pad-card py-2 text-xs">
                  <span className="flex min-w-0 items-center gap-2">
                    {/* Each person's line colour is data: the chart series it matches. */}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.colour }} />
                    <span className="truncate font-medium text-text">{item.name}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold text-text-strong">{formatHours(item.totalHours)}</span>
                    <span className="block text-meta text-text-muted">
                      {formatHolidayDays(holidayDaysByEmployee.get(item.employeeId) ?? 0)} holiday
                      {' · '}Couldn&apos;t Work: {formatSickDays(sickDaysByEmployee.get(item.employeeId) ?? 0)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader
          title="Holidays Booked"
          subtitle={`${formatHolidayDays(totalHolidayDays)} from ${rangeLabel}`}
        />
        {holidayRows.length === 0 ? (
          <Empty size="sm" icon="calendar" title="No holidays for this period" description="The selected employees have no approved holidays in this date range." />
        ) : (
          <Table className="max-h-[420px] overflow-y-auto">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-1/2">Employee</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {holidayRows.map(row => (
                <TableRow key={`${row.employeeId}-${row.date}`}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${HOLIDAY_DOT}`} />
                      <span className="truncate font-medium text-text-strong">{row.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-text-muted">{fullDate(row.date)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Couldn't Work Recorded"
          subtitle={`${formatSickDays(totalSickDays)} from ${rangeLabel}`}
        />
        {sickRows.length === 0 ? (
          <Empty size="sm" icon="calendar" title="No Couldn't Work days for this period" description="The selected employees have no Couldn't Work days in this date range." />
        ) : (
          <Table className="max-h-[420px] overflow-y-auto">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="w-[28%]">Employee</TableHead>
                <TableHead className="w-[22%]">Date</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sickRows.map(row => (
                <TableRow key={`${row.employeeId}-${row.date}`}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SICK_DOT}`} />
                      <span className="truncate font-medium text-text-strong">{row.name}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-text-muted">{fullDate(row.date)}</TableCell>
                  <TableCell className="whitespace-normal text-text-muted">{row.reason || 'No reason recorded'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>
  );
}
