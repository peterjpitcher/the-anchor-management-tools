'use client';

import { useState, useEffect } from 'react';
import { getLeaveRequestById, deleteLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave';
import type { LeaveRequest } from '@/app/actions/leave';
import toast from 'react-hot-toast';
import { Badge, Button, Input, Modal } from '@/ds';

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
// The same meanings as the rota grid and the leave manager: approved success, waiting warning.
const STATUS_TONES: Record<string, 'warning' | 'success' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
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
    <Modal
      open
      onClose={onClose}
      title="Holiday Request"
      width="md"
      footer={
        <>
          {/* Left: delete trigger / confirm */}
          {canEdit && !isEditing && !confirmDelete && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setConfirmDelete(true)}
              className="text-danger-fg hover:bg-danger-soft sm:mr-auto"
            >
              Delete
            </Button>
          )}
          {confirmDelete && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Deleting…' : 'Confirm delete'}
              </Button>
            </>
          )}

          {/* Right: primary actions */}
          {!isEditing && !confirmDelete && (
            <>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
              {canEdit && request && (
                <Button type="button" variant="primary" onClick={() => setIsEditing(true)}>
                  Edit dates
                </Button>
              )}
            </>
          )}
          {isEditing && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => { setIsEditing(false); if (request) { setEditStart(request.start_date); setEditEnd(request.end_date); } }}
                disabled={isSaving}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSave}
                disabled={isSaving || !editStart || !editEnd || editStart > editEnd}
              >
                {isSaving ? 'Saving…' : 'Save changes'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4 min-h-[120px]">
        <p className="text-sm text-text-muted">{employeeName}</p>
        {loading && <p className="text-sm text-text-soft">Loading…</p>}
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
              <Badge tone={STATUS_TONES[request.status] ?? 'neutral'}>
                {STATUS_LABELS[request.status] ?? request.status}
              </Badge>
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
            <Input
              type="date"
              label="Start date"
              value={editStart}
              onChange={e => setEditStart(e.target.value)}
            />
            <Input
              type="date"
              label="End date"
              value={editEnd}
              min={editStart}
              onChange={e => setEditEnd(e.target.value)}
            />
            <p className="text-xs text-text-soft">
              {editStart && editEnd && editStart <= editEnd
                ? `${dayCount(editStart, editEnd)} day${dayCount(editStart, editEnd) !== 1 ? 's' : ''}`
                : 'Invalid range'}
            </p>
          </div>
        )}

        {confirmDelete && (
          <div className="rounded-lg bg-danger-soft border border-danger-border px-4 py-3">
            <p className="text-sm font-semibold text-danger-fg">Delete this holiday request?</p>
            <p className="text-xs text-danger-fg mt-1">
              This removes {days} day{days !== 1 ? 's' : ''} of leave for {employeeName} and cannot be undone.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}
