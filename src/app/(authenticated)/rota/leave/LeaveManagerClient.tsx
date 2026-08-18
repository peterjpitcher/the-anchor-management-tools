'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { CheckIcon, XMarkIcon, ChevronDownIcon, ChevronUpIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/ds';
import { Badge } from '@/ds';
import { Input } from '@/ds';
import { ConfirmDialog } from '@/ds';
import { deleteLeaveRequest, reviewLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave';
import type { LeaveRequest } from '@/app/actions/leave';

interface LeaveManagerClientProps {
  initialRequests: LeaveRequest[];
  employeeMap: Record<string, string>; // employee_id -> display name
  canApprove: boolean;
  canEdit: boolean;
  usageMap: Record<string, { count: number; allowance: number }>; // `${emp_id}:${year}` -> usage
}

const STATUS_BADGE: Record<string, 'warning' | 'success' | 'error'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'error',
};

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

  return { allowance, count, isOverAllowance, percent };
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

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-surface cursor-pointer hover:bg-surface-2 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Badge variant={STATUS_BADGE[request.status] ?? 'default'} size="sm">
            {request.status}
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
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setConfirmDecision('approved'); }}
                disabled={isPending}
                className="p-1 text-success-fg hover:text-success-fg hover:bg-success-soft rounded"
                title="Approve"
                aria-label={`Approve ${empName} holiday request`}
              >
                <CheckIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setConfirmDecision('declined'); }}
                disabled={isPending}
                className="p-1 text-danger-fg hover:text-danger-fg hover:bg-danger-soft rounded"
                title="Decline"
                aria-label={`Decline ${empName} holiday request`}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </>
          )}
          {canEdit && (
            <>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setExpanded(true); setIsEditing(true); }}
                className="p-1 text-text-muted hover:text-text-strong hover:bg-surface-hover rounded"
                title="Edit dates"
                aria-label={`Edit ${empName} holiday request`}
              >
                <PencilIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                className="p-1 text-danger-fg hover:text-danger-fg hover:bg-danger-soft rounded"
                title="Delete request"
                aria-label={`Delete ${empName} holiday request`}
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </>
          )}
          {expanded ? (
            <ChevronUpIcon className="h-4 w-4 text-text-subtle" />
          ) : (
            <ChevronDownIcon className="h-4 w-4 text-text-subtle" />
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 bg-surface-2 border-t border-border space-y-3">
          <dl className="grid grid-cols-2 gap-2 mt-3 text-sm">
            <div>
              <dt className="text-text-muted text-xs">Submitted</dt>
              <dd className="text-text-strong">{formatDate(request.created_at)}</dd>
            </div>
            <div>
              <dt className="text-text-muted text-xs">Holiday year</dt>
              <dd className="text-text-strong">{request.holiday_year}/{String(request.holiday_year + 1).slice(2)}</dd>
            </div>
            {usageProgress && (
              <div className="col-span-2">
                <dt className="text-text-muted text-xs mb-1">
                  Allowance used ({request.holiday_year}/{String(request.holiday_year + 1).slice(2)})
                </dt>
                <dd>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-surface-hover rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${usageProgress.isOverAllowance ? 'bg-danger' : 'bg-success'}`}
                        style={{ width: `${usageProgress.percent}%` }}
                      />
                    </div>
                    <span className={`text-xs font-medium ${usageProgress.isOverAllowance ? 'text-danger-fg' : 'text-text'}`}>
                      {usageProgress.count} / {usageProgress.allowance} days
                    </span>
                  </div>
                </dd>
              </div>
            )}
            {request.note && (
              <div className="col-span-2">
                <dt className="text-text-muted text-xs">Employee note</dt>
                <dd className="text-text-strong italic">&ldquo;{request.note}&rdquo;</dd>
              </div>
            )}
            {request.manager_note && (
              <div className="col-span-2">
                <dt className="text-text-muted text-xs">Manager note</dt>
                <dd className="text-text-strong">{request.manager_note}</dd>
              </div>
            )}
          </dl>

          {canApprove && request.status === 'pending' && (
            <div className="space-y-2">
              <Input
                placeholder="Manager note (optional)"
                value={managerNote}
                onChange={e => setManagerNote(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setConfirmDecision('approved')}
                  disabled={isPending}
                >
                  {isPending ? 'Saving…' : 'Approve'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setConfirmDecision('declined')}
                  disabled={isPending}
                  className="!text-danger-fg !border-danger/25 hover:!bg-danger-soft"
                >
                  Decline
                </Button>
              </div>
            </div>
          )}

          {canEdit && (
            <div className="rounded-lg border border-border bg-surface p-3">
              {!isEditing ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setIsEditing(true)}>
                    Edit dates
                  </Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                    Delete request
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="space-y-1 text-xs font-medium text-text-muted">
                      Start date
                      <Input
                        type="date"
                        value={editStartDate}
                        onChange={e => setEditStartDate(e.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-xs font-medium text-text-muted">
                      End date
                      <Input
                        type="date"
                        value={editEndDate}
                        onChange={e => setEditEndDate(e.target.value)}
                      />
                    </label>
                  </div>
                  {editError && <p role="alert" className="text-xs text-danger-fg">{editError}</p>}
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={handleSaveDates} disabled={isPending}>
                      {isPending ? 'Saving…' : 'Save dates'}
                    </Button>
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
                  </div>
                </div>
              )}
            </div>
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
        title={confirmDecision === 'approved' ? 'Approve holiday request?' : 'Decline holiday request?'}
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
        title="Delete holiday request?"
        message={`Delete ${empName}'s holiday request for ${formatDate(request.start_date)} to ${formatDate(request.end_date)}?`}
        confirmLabel="Delete"
        tone="danger"
      />
    </div>
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
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'declined'>('pending');

  const handleUpdated = (updated: LeaveRequest) => {
    setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
  };
  const handleDeleted = (requestId: string) => {
    setRequests(prev => prev.filter(r => r.id !== requestId));
  };

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-1 border border-border rounded-lg p-1 w-fit">
        {(['pending', 'approved', 'declined', 'all'] as const).map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? 'bg-primary text-primary-fg'
                : 'text-text-muted hover:text-text-strong hover:bg-surface-hover'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'pending' && pendingCount > 0 && (
              <span className="ml-1 bg-warning text-warning-fg rounded-full px-1 text-[10px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-text-subtle italic py-6 text-center">
          No {filter === 'all' ? '' : filter} requests.
        </p>
      ) : (
        <div className="space-y-2">
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
        </div>
      )}
    </div>
  );
}
