'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, CardHeader, Empty, Section, Select, SubHeading, toast, Icon } from '@/ds';
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
import { REASSIGN_ORIGIN_LABEL, REASSIGN_ORIGIN_TONE, REASSIGN_OUTCOME_TONE } from '../_shared/status-ui';

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

  const { origin } = shift;

  return (
    <Card>
      {/* Uses CardHeader's own title/subtitle/action slots: passing children
          instead leaves its empty title div on the left and justify-between
          shunts everything to the right edge. */}
      <CardHeader
        title={`${formatShiftDay(shift.shift_date)}, ${shiftTimes(shift)}`}
        subtitle={[
          shift.name,
          shift.department,
          shift.unpaid_break_minutes > 0 ? `${shift.unpaid_break_minutes} min break` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <Badge tone={REASSIGN_ORIGIN_TONE[origin.kind]}>
            {REASSIGN_ORIGIN_LABEL[origin.kind]}
          </Badge>
        }
      />

      <CardBody className="space-y-4">
        {/* Why nobody is on it */}
        <div>
          {origin.kind === 'rejected' && (
            <>
              <p className="text-xs text-text">
                Was <span className="font-medium">{origin.who}</span>, who turned it down on{' '}
                {formatWhen(origin.at)}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {origin.note ? (
                  <>
                    Their reason: <span className="italic">{origin.note}</span>
                  </>
                ) : (
                  'They gave no reason.'
                )}
              </p>
            </>
          )}

          {origin.kind === 'unassigned' && (
            <>
              <p className="text-xs text-text">
                {origin.who ? (
                  <>
                    Was <span className="font-medium">{origin.who}</span>, taken off the shift by a
                    manager
                  </>
                ) : (
                  'Taken off somebody by a manager'
                )}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                {origin.reason ? (
                  <>
                    Reason given: <span className="italic">{origin.reason}</span>
                  </>
                ) : (
                  'No reason was recorded.'
                )}
              </p>
            </>
          )}

          {origin.kind === 'never_assigned' && (
            <p className="text-xs text-text-muted">
              Created as an open shift. It has never been assigned to anybody.
            </p>
          )}
        </div>

        {shift.notes && <p className="text-xs text-text-muted">Shift notes: {shift.notes}</p>}

        <div>
          <SubHeading className="mb-2">Volunteers</SubHeading>
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
                        variant="secondary"
                        disabled={isPending}
                        onClick={() => handleDecline(volunteer.request_id, volunteer.employee_name)}
                        icon={<Icon name="x" size={16} />}
                      >
                        No
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="primary"
                        disabled={isPending || !canPublish}
                        onClick={() => handleApprove(volunteer.request_id, volunteer.employee_name)}
                        icon={<Icon name="check" size={16} />}
                      >
                        Give It to Them
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
            className="inline-flex min-h-touch items-center gap-1 px-2 text-sm font-medium text-primary hover:underline"
          >
            Open on rota
            <Icon name="externalLink" size={16} />
          </Link>
        </div>

        {canEdit && (
          <p className="text-xs text-text-muted">
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
    () => queue.openShifts.filter(shift => shift.origin.kind === 'rejected').length,
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
    <>
      <Section
        title="Needs Somebody"
        description={
          rejectedCount > 0
            ? `Unfilled shifts from today onwards, across every week. ${rejectedCount} of these were turned down by staff.`
            : 'Unfilled shifts from today onwards, across every week.'
        }
      >
        {queue.openShifts.length === 0 ? (
          <Card padding="none">
            <Empty
              size="sm"
              icon="calendar"
              title="Nothing to reassign"
              description="Every scheduled shift from today onwards has somebody on it."
            />
          </Card>
        ) : (
          <div className="space-y-4">
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
          title="Loose Ends"
          description="Staff asked for these shifts and never got an answer. The shift has since gone, so clearing them stops people waiting on a reply."
        >
          <Card padding="none">
            <ul className="divide-y divide-border">
              {queue.staleRequests.map(request => (
                <li
                  key={request.request_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-pad-card py-3"
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
          </Card>
        </Section>
      )}

      <Section
        title="Recently Turned Down"
        description="Shifts staff rejected in the last 90 days, and what happened to them."
        actions={
          queue.covered.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-expanded={showHistory}
              onClick={() => setShowHistory(value => !value)}
            >
              {showHistory ? 'Hide' : `Show ${queue.covered.length}`}
            </Button>
          ) : undefined
        }
      >
        {queue.covered.length === 0 ? (
          <Card padding="none">
            <Empty size="sm" title="No shifts have been turned down in the last 90 days" />
          </Card>
        ) : showHistory ? (
          <Card padding="none">
            <ul className="divide-y divide-border">
              {queue.covered.map(item => (
                <li
                  key={item.rejection_id}
                  className="flex flex-wrap items-center justify-between gap-2 px-pad-card py-3"
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
                    <Badge tone={REASSIGN_OUTCOME_TONE[item.outcome]}>
                      {item.outcome === 'covered' && item.covered_by_name
                        ? item.covered_by_name
                        : OUTCOME_LABEL[item.outcome]}
                    </Badge>
                    <Link
                      href={rotaLink(item.week_start, item.shift_date, item.shift_id)}
                      className="inline-flex min-h-touch items-center px-2 text-sm font-medium text-primary hover:underline"
                    >
                      View
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </Section>
    </>
  );
}
