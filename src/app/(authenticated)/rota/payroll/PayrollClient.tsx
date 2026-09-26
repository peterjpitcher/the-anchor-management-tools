'use client';

import { useEffect, useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Empty,
  IconButton,
  Input,
  LinkButton,
  Modal,
  PageLayout,
  Section,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
  Icon,
} from '@/ds';
import { approvePayrollMonth, sendPayrollEmail, updatePayrollPeriod, upsertShiftNote, updatePayrollRowTimes, deletePayrollRow } from '@/app/actions/payroll';
import type { PayrollRow } from '@/lib/rota/excel-export';
import type { PayrollEmployeeSummary } from '@/lib/rota/email-templates';
import type { PayrollMonthApproval, PayrollPeriod } from '@/app/actions/payroll';
import type { RotaDayInfo } from '@/app/actions/rota-day-info';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';
import { validatePayrollPeriodRange } from '@/lib/rota/payroll-guards';
import { hasCouldntWorkPayrollFlag, isCouldntWorkPayrollFlag, parsePayrollFlags, payrollFlagLabel } from '@/lib/rota/payroll-flags';
import { ROTA_CALENDAR_NOTE_CLASSES, ROTA_DAY_INFO_CLASSES } from '@/lib/rota/status-ui';
import type { RotaLayoutProps } from '../_shared/layout';
import {
  PAYROLL_APPROVAL_TONE,
  PAYROLL_DAY_FLAGGED_TONE,
  PAYROLL_PAY_RATE_TONE,
  payrollDiffClasses,
  payrollFlagBadgeClasses,
} from '../_shared/status-ui';
import { PayrollSummaryBar } from './PayrollSummaryBar';
import { computeEmployeeCards } from './payrollCycleStats';

interface PayrollClientProps {
  /** The page header, built once by page.tsx so the error state shows the same one. */
  layout: RotaLayoutProps;
  /** Shown above the page body, such as the alert for a secondary load that failed. */
  notice?: React.ReactNode;
  year: number;
  month: number;
  rows: PayrollRow[];
  employees: PayrollEmployeeSummary[];
  approval: PayrollMonthApproval | null;
  period: PayrollPeriod;
  canApprove: boolean;
  canSend: boolean;
  canExport: boolean;
  monthOptions: { label: string; value: string }[];
  dayInfo?: Record<string, RotaDayInfo>;
}

function DayInfoChips({ info }: { info?: RotaDayInfo }) {
  if (!info) return null;
  const items: React.ReactNode[] = [];

  for (const note of info.calendarNotes) {
    items.push(
      <span key={`note-${note.title}`} className={`inline-flex items-center gap-0.5 text-2xs font-medium ${ROTA_CALENDAR_NOTE_CLASSES.text}`}>
        <span className={ROTA_CALENDAR_NOTE_CLASSES.swatch} style={{ backgroundColor: note.color }} />
        {note.title}
      </span>
    );
  }

  for (const event of info.events) {
    items.push(
      <span key={`ev-${event.name}`} className={`inline-flex items-center gap-0.5 text-2xs ${ROTA_DAY_INFO_CLASSES.event.text}`}>
        <span className={`w-1 h-1 rounded-full inline-block shrink-0 ${ROTA_DAY_INFO_CLASSES.event.dot}`} />
        {event.name}
      </span>
    );
  }

  for (const pb of info.privateBookings) {
    items.push(
      <span key={`pb-${pb.customer_name}`} className={`inline-flex items-center gap-0.5 text-2xs ${ROTA_DAY_INFO_CLASSES.private_booking.text}`}>
        <span className={`w-1 h-1 rounded-full inline-block shrink-0 ${ROTA_DAY_INFO_CLASSES.private_booking.dot}`} />
        {pb.customer_name}
      </span>
    );
  }

  if (info.tableCovers > 0) {
    items.push(
      <span key="covers" className={`inline-flex items-center gap-0.5 text-2xs ${ROTA_DAY_INFO_CLASSES.covers.text}`}>
        <span className={`w-1 h-1 rounded-full inline-block shrink-0 ${ROTA_DAY_INFO_CLASSES.covers.dot}`} />
        {info.tableCovers} covers{info.outsideCovers > 0 ? ` (${info.outsideCovers} outside)` : ''}
      </span>
    );
  }

  if (info.highChairs > 0) {
    items.push(
      <span key="highchairs" className={`inline-flex items-center gap-0.5 text-2xs ${ROTA_DAY_INFO_CLASSES.high_chairs.text}`}>
        <span className={`w-1 h-1 rounded-full inline-block shrink-0 ${ROTA_DAY_INFO_CLASSES.high_chairs.dot}`} />
        {info.highChairs} high chair{info.highChairs !== 1 ? 's' : ''}
      </span>
    );
  }

  if (!items.length) return null;
  return (
    <span className="ml-3 inline-flex flex-wrap items-center gap-x-2 gap-y-0">
      {items}
    </span>
  );
}

function formatDate(iso: string) {
  return formatDateInLondon(`${iso}T12:00:00Z`, {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function formatTime12h(time: string | null | undefined): string {
  if (!time) return '';
  const [hStr, mStr] = time.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr ?? '0', 10);
  const period = h < 12 ? 'am' : 'pm';
  const hour12 = h % 12 || 12;
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`;
}

/** Shown in a cell with no value to report. */
const NO_VALUE = '–';

/** Said wherever a change would undo this month's approval. */
const AFTER_APPROVAL_WARNING = 'Payroll is already approved: re-approve after this change to update the snapshot.';

/** The planned time under a worked-time field, so the correction can be checked against it. */
function plannedHint(row: PayrollRow, edge: 'start' | 'end'): string | undefined {
  if (hasCouldntWorkPayrollFlag(row.flags)) return undefined;
  const planned = edge === 'start' ? row.plannedStart : row.plannedEnd;
  return planned ? `Planned ${formatTime12h(planned)}` : undefined;
}

function diffLabel(diff: number) {
  if (Math.abs(diff) < 0.05) return '–';
  return `${diff > 0 ? '+' : ''}${diff.toFixed(1)}h`;
}

function PayRateDisplay({ row }: { row: PayrollRow }) {
  if (row.hourlyRate == null) {
    return <span className="font-medium text-warning-fg">Not set</span>;
  }

  const premiumRate = (row.premiumHours ?? 0) > 0 ? row.effectiveRate : null;

  return (
    <div className="whitespace-nowrap">
      <span className="font-semibold text-text-strong">£{row.hourlyRate.toFixed(2)}/hr</span>
      {premiumRate != null && (
        <span className="block text-2xs font-medium text-cat-3-fg">
          Premium £{premiumRate.toFixed(2)}/hr
        </span>
      )}
    </div>
  );
}

function FlagChips({ flags, couldntWorkReason }: { flags: string; couldntWorkReason?: string | null }) {
  const parts = parsePayrollFlags(flags);
  if (!parts.length) return null;
  const reason = couldntWorkReason?.trim();
  const showCouldntWorkReason = reason && parts.some(isCouldntWorkPayrollFlag);

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {parts.map(f => (
          <Badge key={f} size="sm" className={payrollFlagBadgeClasses(f)}>
            {payrollFlagLabel(f)}
          </Badge>
        ))}
      </div>
      {showCouldntWorkReason && (
        <p className="text-2xs leading-snug text-danger-fg">
          <span className="font-medium">Reason: </span>
          {reason}
        </p>
      )}
    </div>
  );
}


export default function PayrollClient({
  layout,
  notice,
  year,
  month,
  rows: initialRows,
  employees,
  approval: initialApproval,
  period: initialPeriod,
  canApprove,
  canSend,
  canExport,
  monthOptions,
  dayInfo,
}: PayrollClientProps) {
  const router = useRouter();
  const [approval, setApproval] = useState(initialApproval);
  const [approvePending, startApproveTransition] = useTransition();
  const [sendPending, startSendTransition] = useTransition();
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());

  // Edit / delete state: a row's worked times and its payroll note each edit in a dialog.
  const [editingRow, setEditingRow] = useState<PayrollRow | null>(null);
  const [editClockIn, setEditClockIn] = useState('');
  const [editClockOut, setEditClockOut] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [confirmDeleteRow, setConfirmDeleteRow] = useState<PayrollRow | null>(null);

  useEffect(() => {
    setApproval(initialApproval);
  }, [initialApproval]);

  const startEdit = (row: PayrollRow) => {
    setEditingRow(row);
    setEditClockIn(row.actualStart ?? '');
    setEditClockOut(row.actualEnd ?? '');
  };

  const handleSaveEdit = async (row: PayrollRow) => {
    if (!editClockIn) { toast.error('Clock-in time is required'); return; }
    setEditSaving(true);
    const result = await updatePayrollRowTimes(row.sessionId, row.employeeId, row.date, editClockIn, editClockOut || null, year, month);
    setEditSaving(false);
    if (!result.success) { toast.error(result.error); return; }
    setEditingRow(null);
    if (approval) setApproval(null);
    router.refresh();
  };

  const handleDelete = async (row: PayrollRow) => {
    const result = await deletePayrollRow(row.sessionId, row.shiftId, year, month);
    if (!result.success) { toast.error(result.error); return; }
    setConfirmDeleteRow(null);
    if (approval) setApproval(null);
    router.refresh();
  };

  // Note editing
  const [noteRow, setNoteRow] = useState<PayrollRow | null>(null);
  const [editNoteValue, setEditNoteValue] = useState('');
  const [notePending, startNoteTransition] = useTransition();

  const startEditNote = (row: PayrollRow) => {
    setNoteRow(row);
    setEditNoteValue(row.note ?? '');
  };

  const handleSaveNote = (shiftId: string) => {
    startNoteTransition(async () => {
      const result = await upsertShiftNote(shiftId, editNoteValue, year, month);
      if (!result.success) { toast.error(result.error); return; }
      setNoteRow(null);
      if (approval) setApproval(null);
      router.refresh();
    });
  };

  // Period editing
  const [editingPeriod, setEditingPeriod] = useState(false);
  const [periodStart, setPeriodStart] = useState(initialPeriod.period_start);
  const [periodEnd, setPeriodEnd] = useState(initialPeriod.period_end);
  const [periodPending, startPeriodTransition] = useTransition();
  const periodError = validatePayrollPeriodRange(periodStart, periodEnd);

  const handleSavePeriod = () => {
    if (periodError) {
      toast.error(periodError);
      return;
    }

    startPeriodTransition(async () => {
      const result = await updatePayrollPeriod(year, month, periodStart, periodEnd);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Payroll period updated');
      setEditingPeriod(false);
      router.refresh();
    });
  };

  const toggleDate = (date: string) =>
    setExpandedDates(prev => {
      const next = new Set(prev);
      if (next.has(date)) { next.delete(date); } else { next.add(date); }
      return next;
    });

  const expandAll = () => setExpandedDates(new Set(sortedDates));
  const collapseAll = () => setExpandedDates(new Set());

  // Group rows by date in chronological order
  const { byDate, sortedDates } = useMemo(() => {
    const map = new Map<string, PayrollRow[]>();
    for (const row of initialRows) {
      if (!map.has(row.date)) map.set(row.date, []);
      map.get(row.date)!.push(row);
    }
    return { byDate: map, sortedDates: [...map.keys()].sort() };
  }, [initialRows]);

  const { totalActual, totalPlanned } = useMemo(() => ({
    totalActual: employees.reduce((s, e) => s + e.actualHours, 0),
    totalPlanned: employees.reduce((s, e) => s + e.plannedHours, 0),
  }), [employees]);

  const employeeCards = useMemo(() => {
    const today = getTodayIsoDate();
    return computeEmployeeCards(initialRows, today);
  }, [initialRows]);

  const handleApprove = () => {
    startApproveTransition(async () => {
      const result = await approvePayrollMonth(year, month);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Payroll approved and snapshot saved');
      setApproval(result.data);
    });
  };

  const handleSend = () => {
    if (!approval) { toast.error('Please approve payroll first'); return; }
    startSendTransition(async () => {
      const result = await sendPayrollEmail(year, month);
      if (!result.success) { toast.error((result as { success: false; error: string }).error); return; }
      toast.success('Payroll email sent to accountant');
    });
  };

  const approvalState = approval ? 'approved' : 'pending';
  const approvalLabel = approval
    ? `Approved ${formatDateInLondon(approval.approved_at, { day: 'numeric', month: 'short', year: 'numeric' })}${
        approval.email_sent_at ? ` · Emailed ${formatDateInLondon(approval.email_sent_at)}` : ''
      }`
    : 'Pending approval';

  return (
    <PageLayout
      {...layout}
      headerActions={
        <>
          {canExport && approval && (
            <LinkButton
              href={`/api/rota/export?year=${year}&month=${month}`}
              download
              size="sm"
              variant="secondary"
              icon={<Icon name="download" size={16} />}
            >
              Export Excel
            </LinkButton>
          )}
          {canSend && approval && !approval.email_sent_at && (
            <Button type="button" size="sm" variant="secondary" icon={<Icon name="mail" size={14} />} onClick={handleSend} loading={sendPending}>
              Email Accountant
            </Button>
          )}
          {canApprove && !approval && (
            <Button type="button" size="sm" variant="primary" onClick={handleApprove} disabled={initialRows.length === 0} loading={approvePending}>
              Approve Payroll
            </Button>
          )}
        </>
      }
    >
      {notice}

      {/* Which month, and the pay period it covers. */}
      <div className="flex flex-wrap items-end gap-3">
        <Select
          label="Month"
          value={`?year=${year}&month=${month}`}
          onChange={e => { if (e.target.value) router.push(`/rota/payroll${e.target.value}`); }}
          options={monthOptions}
        />
        {editingPeriod ? (
          <>
            <Input
              type="date"
              label="Period start"
              value={periodStart}
              onChange={e => setPeriodStart(e.target.value)}
              error={Boolean(periodError)}
            />
            <Input
              type="date"
              label="Period end"
              value={periodEnd}
              onChange={e => setPeriodEnd(e.target.value)}
              error={periodError ?? undefined}
            />
            <Button type="button" variant="secondary" onClick={() => { setPeriodStart(initialPeriod.period_start); setPeriodEnd(initialPeriod.period_end); setEditingPeriod(false); }}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleSavePeriod} disabled={Boolean(periodError)} loading={periodPending}>
              Save Changes
            </Button>
          </>
        ) : (
          <div className="flex h-input-h items-center gap-2 text-sm">
            <span className="text-text-muted">Period:</span>
            <span className="font-medium text-text-strong">
              {formatDate(initialPeriod.period_start)} – {formatDate(initialPeriod.period_end)}
            </span>
            {canApprove && !approval && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setEditingPeriod(true)}
              >
                Edit
              </Button>
            )}
          </div>
        )}
        {/* The month's approval status, beside the period it covers rather than in the header. */}
        <div className="flex h-input-h items-center">
          <Badge
            tone={PAYROLL_APPROVAL_TONE[approvalState]}
            icon={approval ? <Icon name="checkCircle" size={12} /> : undefined}
          >
            {approvalLabel}
          </Badge>
        </div>
      </div>

      {/* Cycle stats: planned against actual to date, and earned */}
      <PayrollSummaryBar rows={initialRows} />

      {/* Pivot table: dates, then employees */}
      <Section
        title="Daily Breakdown"
        description="Review planned against actual hours per employee. Salaried staff are excluded. Approve to lock the snapshot, then export the Excel or email the accountant."
        actions={
          initialRows.length > 0 ? (
            <div className="flex gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={expandAll}>
                Expand All
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={collapseAll}>
                Collapse All
              </Button>
            </div>
          ) : undefined
        }
      >
        {initialRows.length === 0 ? (
          <Card padding="none">
            <Empty
              size="sm"
              title="No hourly shifts for this period"
              description="Salaried employees are excluded from payroll calculations."
            />
          </Card>
        ) : (
          <Card padding="none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8"><span className="sr-only">Expand</span></TableHead>
                  <TableHead>Date / Employee</TableHead>
                  <TableHead align="right">Planned</TableHead>
                  <TableHead align="right">Worked</TableHead>
                  <TableHead align="right">Diff</TableHead>
                  <TableHead align="right">Pay rate</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedDates.map(date => {
                  const dayRows = byDate.get(date)!;
                  const dayPlanned = dayRows.reduce((s, r) => s + (r.plannedHours ?? 0), 0);
                  const dayActual = dayRows.reduce((s, r) => s + (r.actualHours ?? 0), 0);
                  const dayDiff = dayActual - dayPlanned;
                  const dayHasFlags = dayRows.some(r => r.flags);
                  const isExpanded = expandedDates.has(date);

                  return [
                    /* Date summary row */
                    <TableRow
                      key={`date-${date}`}
                      onClick={() => toggleDate(date)}
                      className="cursor-pointer select-none bg-surface-2"
                    >
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? 'Hide' : 'Show'} shifts for ${formatDate(date)}`}
                          onClick={event => { event.stopPropagation(); toggleDate(date); }}
                          icon={<Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={14} className="block" />}
                        />
                      </TableCell>
                      <TableCell className="whitespace-normal font-semibold text-text-strong">
                        {formatDate(date)}
                        <span className="ml-2 text-xs font-normal text-text-soft">{dayRows.length} shift{dayRows.length !== 1 ? 's' : ''}</span>
                        <DayInfoChips info={dayInfo?.[date]} />
                      </TableCell>
                      <TableCell align="right" className="font-medium">{dayPlanned.toFixed(1)}h</TableCell>
                      <TableCell align="right" className="font-medium">{dayActual > 0 ? `${dayActual.toFixed(1)}h` : NO_VALUE}</TableCell>
                      <TableCell align="right" className={`text-xs ${payrollDiffClasses(dayDiff)}`}>{dayActual > 0 ? diffLabel(dayDiff) : NO_VALUE}</TableCell>
                      <TableCell align="right" className="text-xs text-text-soft">{NO_VALUE}</TableCell>
                      <TableCell>
                        {dayHasFlags && <Badge size="sm" tone={PAYROLL_DAY_FLAGGED_TONE}>Flagged</Badge>}
                      </TableCell>
                      <TableCell />
                    </TableRow>,

                    /* Employee rows (expanded) */
                    ...(isExpanded ? dayRows.map((row, i) => {
                      const rowKey = `${date}-${i}`;
                      const empDiff = (row.actualHours ?? 0) - (row.plannedHours ?? 0);
                      const isCouldntWork = hasCouldntWorkPayrollFlag(row.flags);

                      return (
                        <TableRow key={`row-${rowKey}`} className="group">
                          <TableCell />
                          <TableCell className="pl-8 text-text-strong">
                            {row.employeeName}
                            <span className="ml-2 text-xs text-text-soft capitalize">{row.department}</span>
                          </TableCell>
                          <TableCell align="right" className="text-xs text-text-muted tabular-nums">
                            {isCouldntWork
                              ? null
                              : row.plannedStart
                              ? <>{formatTime12h(row.plannedStart)}–{formatTime12h(row.plannedEnd)}{' '}<span className="text-text-soft">({row.plannedHours?.toFixed(1)}h)</span></>
                              : row.plannedHours != null ? `${row.plannedHours.toFixed(1)}h` : NO_VALUE
                            }
                          </TableCell>
                          <TableCell align="right" className="text-xs text-text-muted tabular-nums">
                            {row.actualStart
                              ? <>{formatTime12h(row.actualStart)}–{row.actualEnd ? formatTime12h(row.actualEnd) : '…'}{' '}<span className="text-text-soft">({row.actualHours?.toFixed(1)}h)</span></>
                              : row.actualHours != null ? `${row.actualHours.toFixed(1)}h` : NO_VALUE
                            }
                          </TableCell>
                          <TableCell align="right" className={`text-xs ${row.actualHours != null ? payrollDiffClasses(empDiff) : 'text-text-soft'}`}>
                            {row.actualHours != null ? diffLabel(empDiff) : NO_VALUE}
                          </TableCell>
                          <TableCell align="right" className="text-xs">
                            <PayRateDisplay row={row} />
                          </TableCell>
                          <TableCell className="whitespace-normal">
                            <FlagChips flags={row.flags} couldntWorkReason={row.sickReason} />
                            {row.sessionNote && (
                              <p className="mt-1 text-2xs text-text-muted italic">
                                <span className="not-italic font-medium text-text-soft">Timeclock: </span>
                                {row.sessionNote}
                              </p>
                            )}
                            {row.note && (
                              <p className="mt-1 text-2xs text-info-fg italic">
                                <span className="not-italic font-medium text-info-fg">Note: </span>
                                {row.note}
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                              <IconButton
                                type="button"
                                size="sm"
                                onClick={() => startEdit(row)}
                                className="text-text-subtle hover:text-text"
                                title="Edit worked times"
                                label="Edit worked times"
                                icon={<Icon name="edit" size={14} />}
                              />
                              {row.shiftId && (
                                <IconButton
                                  type="button"
                                  size="sm"
                                  onClick={() => startEditNote(row)}
                                  className={row.note ? 'text-info-fg' : 'text-text-subtle hover:text-text'}
                                  title={row.note ? 'Edit note' : 'Add note'}
                                  label={row.note ? 'Edit note' : 'Add note'}
                                  icon={<Icon name="message" size={14} />}
                                />
                              )}
                              <IconButton
                                type="button"
                                size="sm"
                                onClick={() => setConfirmDeleteRow(row)}
                                className="text-text-subtle hover:bg-danger-soft hover:text-danger-fg"
                                title="Delete row"
                                label="Delete row"
                                icon={<Icon name="trash" size={14} />}
                              />
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }) : []),
                  ];
                })}
              </TableBody>
              <tfoot className="border-t-2 border-border bg-surface-2">
                <tr>
                  <TableCell />
                  <TableCell className="font-semibold text-text-strong">Total</TableCell>
                  <TableCell align="right" className="font-semibold text-text-strong">{totalPlanned.toFixed(1)}h</TableCell>
                  <TableCell align="right" className="font-semibold text-text-strong">{totalActual.toFixed(1)}h</TableCell>
                  <TableCell align="right" className={`font-semibold text-sm ${payrollDiffClasses(totalActual - totalPlanned)}`}>
                    {diffLabel(totalActual - totalPlanned)}
                  </TableCell>
                  <TableCell align="right" className="text-xs font-medium text-text-muted">Varies</TableCell>
                  <TableCell />
                  <TableCell />
                </tr>
              </tfoot>
            </Table>
          </Card>
        )}
      </Section>

      {/* Employee summary cards */}
      {employeeCards.length > 0 && (
        <Section title="Employee Summary">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {employeeCards.map(card => (
              <Card key={card.employeeId}>
                <CardHeader title={card.employeeName} />
                <CardBody className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-text-muted">Pay rate</span>
                    <Badge tone={PAYROLL_PAY_RATE_TONE[card.hourlyRate != null ? 'set' : 'missing']}>
                      {card.hourlyRate != null ? `£${card.hourlyRate.toFixed(2)} per hour` : 'Not set'}
                    </Badge>
                  </div>
                  <div className="space-y-1 text-xs text-text-muted">
                    <div className="flex justify-between">
                      <span>Planned</span>
                      <span className="font-medium text-text-strong">{card.plannedHours.toFixed(1)}h</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Actual</span>
                      <span className="font-medium text-text-strong">{card.actualHours.toFixed(1)}h</span>
                    </div>
                  </div>
                  <div className="flex justify-between border-t border-border pt-2 text-xs">
                    <span className="font-medium text-text-muted">Earned to date</span>
                    <span className="font-bold text-success-fg">£{card.earnedToDate.toFixed(2)}</span>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* A row's worked times and its note are forms, so each opens in a dialog. */}
      <Modal
        open={editingRow !== null}
        onClose={() => { if (!editSaving) setEditingRow(null); }}
        title="Edit Worked Times"
        description={editingRow ? `${editingRow.employeeName}, ${formatDate(editingRow.date)}` : undefined}
        width="md"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditingRow(null)} disabled={editSaving}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { if (editingRow) void handleSaveEdit(editingRow); }}
              loading={editSaving}
            >
              Save Changes
            </Button>
          </>
        }
      >
        {editingRow && (
          <div className="space-y-4">
            {approval && <Alert tone="warning">{AFTER_APPROVAL_WARNING}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Clock in"
                type="time"
                value={editClockIn}
                onChange={e => setEditClockIn(e.target.value)}
                hint={plannedHint(editingRow, 'start')}
              />
              <Input
                label="Clock out"
                type="time"
                value={editClockOut}
                onChange={e => setEditClockOut(e.target.value)}
                hint={plannedHint(editingRow, 'end')}
              />
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={noteRow !== null}
        onClose={() => { if (!notePending) setNoteRow(null); }}
        title={noteRow?.note ? 'Edit Note' : 'Add Note'}
        description={noteRow ? `${noteRow.employeeName}, ${formatDate(noteRow.date)}` : undefined}
        width="md"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setNoteRow(null)} disabled={notePending}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { if (noteRow?.shiftId) handleSaveNote(noteRow.shiftId); }}
              loading={notePending}
            >
              {noteRow?.note ? 'Save Changes' : 'Add Note'}
            </Button>
          </>
        }
      >
        {noteRow && (
          <div className="space-y-4">
            {approval && <Alert tone="warning">{AFTER_APPROVAL_WARNING}</Alert>}
            <Input
              autoFocus
              label="Note"
              type="text"
              value={editNoteValue}
              onChange={e => setEditNoteValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && noteRow.shiftId) handleSaveNote(noteRow.shiftId); }}
              placeholder="Add a note for this shift…"
            />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={confirmDeleteRow !== null}
        onClose={() => setConfirmDeleteRow(null)}
        onConfirm={async () => { if (confirmDeleteRow) await handleDelete(confirmDeleteRow); }}
        title="Delete Payroll Row"
        message={
          confirmDeleteRow
            ? `This removes ${confirmDeleteRow.employeeName}'s row for ${formatDate(confirmDeleteRow.date)}.${approval ? ` ${AFTER_APPROVAL_WARNING}` : ''}`
            : undefined
        }
        confirmLabel="Delete"
        tone="danger"
      />
    </PageLayout>
  );
}
