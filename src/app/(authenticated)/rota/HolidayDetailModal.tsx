'use client';

import { useState, useEffect } from 'react';
import { getLeaveRequestById, deleteLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave';
import type { LeaveRequest } from '@/app/actions/leave';
import toast from 'react-hot-toast';

interface HolidayDetailModalProps {
  requestId: string;
  employeeName: string;
  canEdit: boolean;
  onClose: () => void;
  onDeleted: (requestId: string) => void;
  onUpdated: () => void;
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric' };
  if (start === end) return s.toLocaleDateString('en-GB', opts);
  return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} – ${e.toLocaleDateString('en-GB', opts)}`;
}

function dayCount(start: string, end: string): number {
  const diff = new Date(end + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime();
  return Math.round(diff / 86400000) + 1;
}

const STATUS_LABELS: Record<string, string> = { pending: 'Pending approval', approved: 'Approved', declined: 'Declined' };
const STATUS_CLASSES: Record<string, string> = {
  pending:  'bg-warning-soft text-warning-fg',
  approved: 'bg-success-soft text-success-fg',
  declined: 'bg-danger-soft text-danger-fg',
};

export default function HolidayDetailModal({
  requestId,
  employeeName,
  canEdit,
  onClose,
  onDeleted,
  onUpdated,
}: HolidayDetailModalProps) {
  const [request, setRequest] = useState<LeaveRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    getLeaveRequestById(requestId).then(res => {
      if (res.success) {
        setRequest(res.data);
        setEditStart(res.data.start_date);
        setEditEnd(res.data.end_date);
      } else {
        setFetchError(res.error);
      }
      setLoading(false);
    });
  }, [requestId]);

  const handleSave = async () => {
    if (!editStart || !editEnd || editStart > editEnd) {
      toast.error('End date must be on or after start date');
      return;
    }
    setIsSaving(true);
    const res = await updateLeaveRequestDates(requestId, editStart, editEnd);
    if (res.success) {
      toast.success('Holiday dates updated');
      onUpdated();
      onClose();
    } else {
      toast.error(res.error);
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    const res = await deleteLeaveRequest(requestId);
    if (res.success) {
      toast.success('Holiday request deleted');
      onDeleted(requestId);
      onClose();
    } else {
      toast.error(res.error);
      setIsDeleting(false);
    }
  };

  const days = request ? dayCount(request.start_date, request.end_date) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-strong">Holiday Request</h2>
            <p className="text-sm text-text-muted mt-0.5">{employeeName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-text-subtle hover:text-text-muted text-2xl leading-none mt-[-2px]" aria-label="Close">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 min-h-[120px]">
          {loading && <p className="text-sm text-text-subtle">Loading…</p>}
          {fetchError && <p className="text-sm text-danger-fg">{fetchError}</p>}

          {request && !isEditing && (
            <>
              <div>
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Dates</p>
                <p className="text-sm font-semibold text-text-strong">{formatDateRange(request.start_date, request.end_date)}</p>
                <p className="text-xs text-text-muted mt-0.5">{days} day{days !== 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Status</p>
                <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${STATUS_CLASSES[request.status] ?? ''}`}>
                  {STATUS_LABELS[request.status] ?? request.status}
                </span>
              </div>
              {request.note && (
                <div>
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Employee note</p>
                  <p className="text-sm text-text">{request.note}</p>
                </div>
              )}
              {request.manager_note && (
                <div>
                  <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-1">Manager note</p>
                  <p className="text-sm text-text">{request.manager_note}</p>
                </div>
              )}
            </>
          )}

          {request && isEditing && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-text block mb-1">Start date</label>
                <input
                  type="date"
                  value={editStart}
                  onChange={e => setEditStart(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-text block mb-1">End date</label>
                <input
                  type="date"
                  value={editEnd}
                  min={editStart}
                  onChange={e => setEditEnd(e.target.value)}
                  className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
              <p className="text-xs text-text-subtle">
                {editStart && editEnd && editStart <= editEnd
                  ? `${dayCount(editStart, editEnd)} day${dayCount(editStart, editEnd) !== 1 ? 's' : ''}`
                  : 'Invalid range'}
              </p>
            </div>
          )}

          {confirmDelete && (
            <div className="rounded-lg bg-danger-soft border border-danger/25 px-4 py-3">
              <p className="text-sm font-semibold text-danger-fg">Delete this holiday request?</p>
              <p className="text-xs text-danger-fg mt-1">
                This removes {days} day{days !== 1 ? 's' : ''} of leave for {employeeName} and cannot be undone.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center gap-3">
          {/* Left: delete trigger / confirm */}
          {canEdit && !isEditing && !confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium text-danger-fg hover:text-danger-fg"
            >
              Delete
            </button>
          )}
          {confirmDelete && (
            <>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                className="text-sm text-text-muted hover:text-text-strong px-3 py-1.5 rounded-lg border border-border disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-sm font-medium bg-danger text-white px-3 py-1.5 rounded-lg hover:bg-danger disabled:opacity-50"
              >
                {isDeleting ? 'Deleting…' : 'Confirm delete'}
              </button>
            </>
          )}

          {/* Right: primary actions */}
          <div className="ml-auto flex gap-2">
            {!isEditing && !confirmDelete && (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-sm text-text-muted px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2"
                >
                  Close
                </button>
                {canEdit && request && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="text-sm font-medium bg-primary text-primary-fg px-3 py-1.5 rounded-lg hover:bg-primary-hover"
                  >
                    Edit dates
                  </button>
                )}
              </>
            )}
            {isEditing && (
              <>
                <button
                  type="button"
                  onClick={() => { setIsEditing(false); if (request) { setEditStart(request.start_date); setEditEnd(request.end_date); } }}
                  disabled={isSaving}
                  className="text-sm text-text-muted px-3 py-1.5 rounded-lg border border-border hover:bg-surface-2 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !editStart || !editEnd || editStart > editEnd}
                  className="text-sm font-medium bg-primary text-primary-fg px-3 py-1.5 rounded-lg hover:bg-primary-hover disabled:opacity-50"
                >
                  {isSaving ? 'Saving…' : 'Save changes'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
