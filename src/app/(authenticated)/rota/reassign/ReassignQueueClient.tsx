'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { Badge, Button, Card, CardBody, CardHeader, Empty, Section, Select } from '@/ds';
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils';
import {
  approveOpenShiftVolunteer,
  assignOpenShiftFromQueue,
  declineOpenShiftVolunteer,
  dismissStaleOpenShiftRequest,
  type ReassignCoveredShift,
  type ReassignOpenShift,
  type ReassignQueue,
  type ReassignStaleRequest,
} from '@/app/actions/rota-reassign';

interface EmployeeOption {
  employee_id: string;
  name: string;
}

interface ReassignQueueClientProps {
  queue: ReassignQueue;
  employees: EmployeeOption[];
  canEdit: boolean;
  canPublish: boolean;
}

const STALE_REASON_LABEL: Record<ReassignStaleRequest['reason'], string> = {
  already_filled: 'Shift was filled another way',
  shift_in_past: 'Shift has already happened',
  shift_deleted: 'Shift no longer exists',
};

const OUTCOME_LABEL: Record<ReassignCoveredShift['outcome'], string> = {
  covered: 'Covered',
  cancelled: 'Shift cancelled',
  deleted: 'Shift deleted',
};

function formatShiftDay(isoDate: string): string {
  return formatDateInLondon(isoDate + 'T12:00:00Z', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function formatWhen(iso: string): string {
  return formatDateInLondon(iso, { day: 'numeric', month: 'short' });
}

function shiftTimes(shift: { start_time: string; end_time: string; is_overnight: boolean }): string {
  return `${formatTime12Hour(shift.start_time)} to ${formatTime12Hour(shift.end_time)}${shift.is_overnight ? ' (overnight)' : ''}`;
}

function rotaLink(weekStart: string | null, shiftDate: string, shiftId: string): string {
  return `/rota?week=${encodeURIComponent(weekStart ?? shiftDate)}&shift=${encodeURIComponent(shiftId)}`;
}

function OpenShiftCard({
  shift,
  employees,
  canEdit,
  canPublish,
  onChanged,
}: {
  shift: ReassignOpenShift;
  employees: EmployeeOption[];
  canEdit: boolean;
  canPublish: boolean;
  onChanged: () => void;
}) {
  const [assignee, setAssignee] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleApprove = (requestId: string, who: string) => {
    startTransition(async () => {
      const result = await approveOpenShiftVolunteer(requestId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${who} is now on this shift`);
      onChanged();
    });
  };

  const handleDecline = (requestId: string, who: string) => {
    startTransition(async () => {
      const result = await declineOpenShiftVolunteer(requestId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Turned down ${who}`);
      onChanged();
    });
  };

  const handleAssign = () => {
    if (!assignee) return;
    const who = employees.find(employee => employee.employee_id === assignee)?.name ?? 'them';
    startTransition(async () => {
      const result = await assignOpenShiftFromQueue(shift.shift_id, assignee);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Assigned to ${who}. Publish the week so they can see it.`);
      setAssignee('');
      onChanged();
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text">
              {formatShiftDay(shift.shift_date)}, {shiftTimes(shift)}
            </p>
            <p className="text-xs text-text-muted">
              {shift.name ? `${shift.name} · ` : ''}
              {shift.department}
              {shift.unpaid_break_minutes > 0 ? ` · ${shift.unpaid_break_minutes} min break` : ''}
            </p>
          </div>
          <Badge tone={shift.came_from_rejection ? 'danger' : 'warning'}>
            {shift.came_from_rejection ? 'Turned down' : 'Open'}
          </Badge>
        </div>
      </CardHeader>

      <CardBody>
        {shift.came_from_rejection && (
          <div className="mb-3 rounded-default bg-surface-muted p-3">
            <p className="text-xs text-text">
              Turned down by <span className="font-medium">{shift.rejected_by_name}</span>
              {shift.rejected_at ? ` on ${formatWhen(shift.rejected_at)}` : ''}
            </p>
            {shift.rejection_note && (
              <p className="mt-1 text-xs italic text-text-muted">{shift.rejection_note}</p>
            )}
          </div>
        )}

        {shift.notes && <p className="mb-3 text-xs text-text-muted">Shift notes: {shift.notes}</p>}

        <div className="mb-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
            Asked to pick it up
          </p>
          {shift.volunteers.length === 0 ? (
            <p className="text-xs italic text-text-muted">Nobody has volunteered yet.</p>
          ) : (
            <ul className="space-y-2">
              {shift.volunteers.map(volunteer => (
                <li
                  key={volunteer.request_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-default border border-border p-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text">{volunteer.employee_name}</p>
                    <p className="text-xs text-text-muted">
                      Asked {formatWhen(volunteer.requested_at)}
                      {volunteer.note ? ` · ${volunteer.note}` : ''}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={isPending || !canPublish}
                        onClick={() => handleApprove(volunteer.request_id, volunteer.employee_name)}
                        icon={<CheckIcon className="h-4 w-4" />}
                      >
                        Give it to them
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={isPending}
                        onClick={() => handleDecline(volunteer.request_id, volunteer.employee_name)}
                        icon={<XMarkIcon className="h-4 w-4" />}
                      >
                        No
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          {canEdit && (
            <>
              <div className="min-w-[12rem] flex-1">
                <Select
                  label="Or assign somebody"
                  value={assignee}
                  onChange={event => setAssignee(event.target.value)}
                  placeholder="Choose a person"
                  options={employees.map(employee => ({
                    value: employee.employee_id,
                    label: employee.name,
                  }))}
                  disabled={isPending}
                />
              </div>
              <Button type="button" onClick={handleAssign} disabled={isPending || !assignee}>
                Assign
              </Button>
            </>
          )}
          <Link
            href={rotaLink(shift.week_start, shift.shift_date, shift.shift_id)}
            className="inline-flex min-h-[44px] items-center gap-1 px-2 text-sm font-medium text-primary hover:underline"
          >
            Open on rota
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </Link>
        </div>

        {canEdit && (
          <p className="mt-2 text-xs text-text-muted">
            Giving it to a volunteer goes live straight away. Assigning somebody yourself is a draft
            change, so publish the week afterwards.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

export default function ReassignQueueClient({
  queue,
  employees,
  canEdit,
  canPublish,
}: ReassignQueueClientProps) {
  const router = useRouter();
  const [showHistory, setShowHistory] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onChanged = () => router.refresh();

  const rejectedCount = useMemo(
    () => queue.openShifts.filter(shift => shift.came_from_rejection).length,
    [queue.openShifts],
  );

  const handleDismiss = (requestId: string) => {
    startTransition(async () => {
      const result = await dismissStaleOpenShiftRequest(requestId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Cleared');
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <Section
        title="Needs somebody"
        description={
          rejectedCount > 0
            ? `Unfilled shifts from today onwards, across every week. ${rejectedCount} of these were turned down by staff.`
            : 'Unfilled shifts from today onwards, across every week.'
        }
      >
        {queue.openShifts.length === 0 ? (
          <Card>
            <CardBody>
              <Empty
                icon="calendar"
                title="Nothing to reassign"
                description="Every scheduled shift from today onwards has somebody on it."
              />
            </CardBody>
          </Card>
        ) : (
          <div className="space-y-3">
            {queue.openShifts.map(shift => (
              <OpenShiftCard
                key={shift.shift_id}
                shift={shift}
                employees={employees}
                canEdit={canEdit}
                canPublish={canPublish}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </Section>

      {canEdit && queue.staleRequests.length > 0 && (
        <Section
          title="Loose ends"
          description="Staff asked for these shifts and never got an answer. The shift has since gone, so clearing them stops people waiting on a reply."
        >
          <Card>
            <CardBody>
              <ul className="space-y-2">
                {queue.staleRequests.map(request => (
                  <li
                    key={request.request_id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-default border border-border p-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-text">{request.employee_name}</p>
                      <p className="text-xs text-text-muted">
                        {request.shift_date ? formatShiftDay(request.shift_date) : 'Unknown date'}
                        {request.start_time && request.end_time
                          ? `, ${formatTime12Hour(request.start_time)} to ${formatTime12Hour(request.end_time)}`
                          : ''}
                        {' · '}
                        {STALE_REASON_LABEL[request.reason]}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => handleDismiss(request.request_id)}
                    >
                      Clear
                    </Button>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </Section>
      )}

      <Section
        title="Recently turned down"
        description="Shifts staff rejected in the last 90 days, and what happened to them."
      >
        <Card>
          <CardBody>
            {queue.covered.length === 0 ? (
              <p className="py-2 text-sm italic text-text-muted">
                No shifts have been turned down in the last 90 days.
              </p>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setShowHistory(value => !value)}
                >
                  {showHistory ? 'Hide' : `Show ${queue.covered.length}`}
                </Button>
                {showHistory && (
                  <ul className="mt-3 space-y-2">
                    {queue.covered.map(item => (
                      <li
                        key={item.rejection_id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-default border border-border p-2"
                      >
                        <div className="min-w-0">
                          <p className="text-sm text-text">
                            {formatShiftDay(item.shift_date)}, {shiftTimes(item)}, {item.department}
                          </p>
                          <p className="text-xs text-text-muted">
                            Turned down by {item.rejected_by_name} on {formatWhen(item.rejected_at)}
                            {item.rejection_note ? ` · ${item.rejection_note}` : ''}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge tone={item.outcome === 'covered' ? 'success' : 'neutral'}>
                            {item.outcome === 'covered' && item.covered_by_name
                              ? item.covered_by_name
                              : OUTCOME_LABEL[item.outcome]}
                          </Badge>
                          <Link
                            href={rotaLink(item.week_start, item.shift_date, item.shift_id)}
                            className="inline-flex min-h-[44px] items-center px-2 text-sm font-medium text-primary hover:underline"
                          >
                            View
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </CardBody>
        </Card>
      </Section>
    </div>
  );
}
