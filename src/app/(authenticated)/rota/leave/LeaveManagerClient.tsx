'use client';

import { useState, useTransition } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DescriptionList,
  Empty,
  FormFooter,
  IconButton,
  Input,
  ProgressBar,
  Segmented,
  toast,
  Icon,
} from '@/ds';
import { deleteLeaveRequest, reviewLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave';
import type { LeaveRequest } from '@/app/actions/leave';
import {
  LEAVE_ALLOWANCE_TEXT_CLASSES,
  LEAVE_ALLOWANCE_TONE,
  type LeaveAllowanceState,
} from '../_shared/status-ui';

interface LeaveManagerClientProps {
  initialRequests: LeaveRequest[];
  employeeMap: Record<string, string>; // employee_id -> display name
  canApprove: boolean;
  canEdit: boolean;
  usageMap: Record<string, { count: number; allowance: number }>; // `${emp_id}:${year}` -> usage
}

// The same tones as the holiday dialog on the rota (HolidayDetailModal STATUS_TONES), keyed and
// typed the same way: approved success, waiting warning, declined danger.
const STATUS_BADGE: Record<LeaveRequest['status'], 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
};

const STATUS_LABEL: Record<LeaveRequest['status'], string> = {
  pending: 'Pending',
  approved: 'Approved',
  declined: 'Declined',
};

type LeaveFilter = 'all' | 'pending' | 'approved' | 'declined';

function daysBetween(start: string, end: string): number {
  const ms = new Date(end + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime();
  return Math.round(ms / 86400000) + 1;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function getUsageProgress(usage: { count: number; allowance: number }) {
  const allowance = Number.isFinite(usage.allowance) ? Math.max(0, usage.allowance) : 0;
  const count = Number.isFinite(usage.count) ? Math.max(0, usage.count) : 0;
  const isOverAllowance = allowance > 0 && count >= allowance;
  const percent = allowance > 0 ? Math.min(100, Math.round((count / allowance) * 100)) : 0;
  const state: LeaveAllowanceState = isOverAllowance ? 'over' : 'within';

  return { allowance, count, isOverAllowance, percent, state };
}

function LeaveRequestRow({
  request,
  empName,
  canApprove,
  canEdit,
  onUpdated,
  onDeleted,
  usage,
}: {
  request: LeaveRequest;
  empName: string;
  canApprove: boolean;
  canEdit: boolean;
  onUpdated: (updated: LeaveRequest) => void;
  onDeleted: (requestId: string) => void;
  usage?: { count: number; allowance: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const [managerNote, setManagerNote] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [editStartDate, setEditStartDate] = useState(request.start_date);
  const [editEndDate, setEditEndDate] = useState(request.end_date);
  const [editError, setEditError] = useState('');
  const [confirmDecision, setConfirmDecision] = useState<'approved' | 'declined' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const days = daysBetween(request.start_date, request.end_date);
  const usageProgress = usage ? getUsageProgress(usage) : null;

  const runReview = async (decision: 'approved' | 'declined') => {
    const result = await reviewLeaveRequest(request.id, decision, managerNote || undefined);
    if (!result.success) throw new Error((result as { success: false; error: string }).error);
    toast.success(decision === 'approved' ? 'Request approved' : 'Request declined');
    onUpdated({ ...request, status: decision, manager_note: managerNote || null });
    setExpanded(false);
  };

  const handleSaveDates = () => {
    setEditError('');
    if (new Date(editEndDate) < new Date(editStartDate)) {
      setEditError('End date must be on or after start date');
      return;
    }

    startTransition(async () => {
      const result = await updateLeaveRequestDates(request.id, editStartDate, editEndDate);
      if (!result.success) {
        setEditError(result.error);
        return;
      }
      toast.success('Request dates updated');
      onUpdated({ ...request, start_date: editStartDate, end_date: editEndDate });
      setIsEditing(false);
    });
  };

  const runDelete = async () => {
    const result = await deleteLeaveRequest(request.id);
    if (!result.success) throw new Error(result.error);
    toast.success('Request deleted');
    onDeleted(request.id);
  };

  const holidayYear = `${request.holiday_year}/${String(request.holiday_year + 1).slice(2)}`;

  return (
    // The weekly Insights report links straight to a pending request as /rota/leave#leave-<id>.
    <li id={`leave-${request.id}`} className="scroll-mt-4 target:ring-2 target:ring-inset target:ring-primary">
      <div
        className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-hover transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge tone={STATUS_BADGE[request.status] ?? 'neutral'} size="sm">
            {STATUS_LABEL[request.status] ?? request.status}
          </Badge>
          <div className="min-w-0">
            <p className="text-sm font-medium text-text-strong truncate">{empName}</p>
            <p className="text-xs text-text-muted truncate">
              {formatDate(request.start_date)} – {formatDate(request.end_date)} · {days} day{days !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5 ml-3 shrink-0">
          {canApprove && request.status === 'pending' && !expanded && (
            <>
              <IconButton
                type="button"
                size="sm"
                onClick={e => { e.stopPropagation(); setConfirmDecision('approved'); }}
                disabled={isPending}
                className="text-success-fg hover:bg-success-soft"
                title="Approve"
                label={`Approve ${empName} holiday request`}
                icon={<Icon name="check" size={16} />}
              />
              <IconButton
                type="button"
                size="sm"
                onClick={e => { e.stopPropagation(); setConfirmDecision('declined'); }}
                disabled={isPending}
                className="text-danger-fg hover:bg-danger-soft"
                title="Decline"
                label={`Decline ${empName} holiday request`}
                icon={<Icon name="x" size={16} />}
              />
            </>
          )}
          {canEdit && (
            <>
              <IconButton
                type="button"
                size="sm"
                onClick={e => { e.stopPropagation(); setExpanded(true); setIsEditing(true); }}
                className="text-text-muted hover:text-text-strong"
                title="Edit dates"
                label={`Edit ${empName} holiday request`}
                icon={<Icon name="edit" size={16} />}
              />
              <IconButton
                type="button"
                size="sm"
                onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                className="text-danger-fg hover:bg-danger-soft"
                title="Delete request"
                label={`Delete ${empName} holiday request`}
                icon={<Icon name="trash" size={16} />}
              />
            </>
          )}
          {expanded ? (
            <Icon name="chevronUp" size={16} className="text-text-subtle" />
          ) : (
            <Icon name="chevronDown" size={16} className="text-text-subtle" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border bg-surface-2 px-4 py-4">
          <DescriptionList
            columns={2}
            items={[
              { key: 'submitted', label: 'Submitted', value: formatDate(request.created_at) },
              { key: 'year', label: 'Holiday year', value: holidayYear },
              ...(usageProgress
                ? [{
                    key: 'allowance',
                    label: `Allowance used (${holidayYear})`,
                    span: 2 as const,
                    value: (
                      <div className="flex items-center gap-2">
                        <ProgressBar
                          value={usageProgress.percent}
                          tone={LEAVE_ALLOWANCE_TONE[usageProgress.state]}
                          className="flex-1"
                        />
                        <span className={`text-xs font-medium ${LEAVE_ALLOWANCE_TEXT_CLASSES[usageProgress.state]}`}>
                          {usageProgress.count} / {usageProgress.allowance} days
                        </span>
                      </div>
                    ),
                  }]
                : []),
              ...(request.note
                ? [{ key: 'note', label: 'Employee note', span: 2 as const, value: <span className="italic">&ldquo;{request.note}&rdquo;</span> }]
                : []),
              ...(request.manager_note
                ? [{ key: 'manager-note', label: 'Manager note', span: 2 as const, value: request.manager_note }]
                : []),
            ]}
          />

          {canApprove && request.status === 'pending' && (
            <div className="space-y-3">
              <Input
                label="Manager note"
                placeholder="Optional"
                value={managerNote}
                onChange={e => setManagerNote(e.target.value)}
              />
              <FormFooter>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmDecision('declined')}
                  disabled={isPending}
                  className="text-danger-fg border-danger-border hover:bg-danger-soft"
                >
                  Decline
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => setConfirmDecision('approved')}
                  disabled={isPending}
                >
                  {isPending ? 'Saving…' : 'Approve'}
                </Button>
              </FormFooter>
            </div>
          )}

          {canEdit && (
            !isEditing ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setIsEditing(true)}>
                  Edit Dates
                </Button>
                <Button type="button" size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                  Delete Request
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    type="date"
                    label="Start date"
                    value={editStartDate}
                    onChange={e => setEditStartDate(e.target.value)}
                  />
                  <Input
                    type="date"
                    label="End date"
                    value={editEndDate}
                    onChange={e => setEditEndDate(e.target.value)}
                  />
                </div>
                {editError && <Alert tone="danger">{editError}</Alert>}
                <FormFooter>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setEditStartDate(request.start_date);
                      setEditEndDate(request.end_date);
                      setEditError('');
                      setIsEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                  <Button type="button" size="sm" variant="primary" onClick={handleSaveDates} disabled={isPending}>
                    {isPending ? 'Saving…' : 'Save Dates'}
                  </Button>
                </FormFooter>
              </div>
            )
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDecision !== null}
        onClose={() => setConfirmDecision(null)}
        onConfirm={async () => {
          if (!confirmDecision) return;
          await runReview(confirmDecision);
          setConfirmDecision(null);
        }}
        title={confirmDecision === 'approved' ? 'Approve Holiday Request?' : 'Decline Holiday Request?'}
        message={
          confirmDecision === 'approved'
            ? `Approve ${empName}'s holiday request for ${formatDate(request.start_date)} to ${formatDate(request.end_date)}?`
            : `Decline ${empName}'s holiday request for ${formatDate(request.start_date)} to ${formatDate(request.end_date)}? This will remove pending holiday days from the rota.`
        }
        confirmLabel={confirmDecision === 'approved' ? 'Approve' : 'Decline'}
        tone={confirmDecision === 'approved' ? 'warning' : 'danger'}
      />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await runDelete();
          setConfirmDelete(false);
        }}
        title="Delete Holiday Request?"
        message={`Delete ${empName}'s holiday request for ${formatDate(request.start_date)} to ${formatDate(request.end_date)}?`}
        confirmLabel="Delete"
        tone="danger"
      />
    </li>
  );
}

export default function LeaveManagerClient({
  initialRequests,
  employeeMap,
  canApprove,
  canEdit,
  usageMap,
}: LeaveManagerClientProps) {
  const [requests, setRequests] = useState(initialRequests);
  const [filter, setFilter] = useState<LeaveFilter>('pending');

  const handleUpdated = (updated: LeaveRequest) => {
    setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
  };
  const handleDeleted = (requestId: string) => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
  };

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const filterOptions: Array<{ id: LeaveFilter; label: string }> = [
    { id: 'pending', label: pendingCount > 0 ? `Pending (${pendingCount})` : 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'declined', label: 'Declined' },
    { id: 'all', label: 'All' },
  ];

  return (
    <div className="space-y-4">
      {/* A status filter over the same list: a view switch, so Segmented. */}
      <Segmented
        options={filterOptions}
        value={filter}
        onChange={id => setFilter(id as LeaveFilter)}
      />

      <Card padding="none">
        {filtered.length === 0 ? (
          <Empty size="sm" icon="calendar" title={`No ${filter === 'all' ? '' : `${filter} `}requests`} />
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map(req => (
              <LeaveRequestRow
                key={req.id}
                request={req}
                empName={employeeMap[req.employee_id] ?? 'Unknown employee'}
                canApprove={canApprove}
                canEdit={canEdit}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
                usage={usageMap[`${req.employee_id}:${req.holiday_year}`]}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
