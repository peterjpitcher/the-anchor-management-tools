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
  pending:  'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-800',
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
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Holiday Request</h2>
            <p className="text-sm text-gray-500 mt-0.5">{employeeName}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none mt-[-2px]" aria-label="Close">×</button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4 min-h-[120px]">
          {loading && <p className="text-sm text-gray-400">Loading…</p>}
          {fetchError && <p className="text-sm text-red-600">{fetchError}</p>}

          {request && !isEditing && (
            <>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Dates</p>
                <p className="text-sm font-semibold text-gray-900">{formatDateRange(request.start_date, request.end_date)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{days} day{days !== 1 ? 's' : ''}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Status</p>
                <span className={`inline-block text-xs font-semibold px-2.5 py-0.5 rounded-full ${STATUS_CLASSES[request.status] ?? ''}`}>
                  {STATUS_LABELS[request.status] ?? request.status}
                </span>
              </div>
              {request.note && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Employee note</p>
                  <p className="text-sm text-gray-700">{request.note}</p>
                </div>
              )}
              {request.manager_note && (
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">Manager note</p>
                  <p className="text-sm text-gray-700">{request.manager_note}</p>
                </div>
              )}
            </>
          )}

          {request && isEditing && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">Start date</label>
                <input
                  type="date"
                  value={editStart}
                  onChange={e => setEditStart(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 block mb-1">End date</label>
                <input
                  type="date"
                  value={editEnd}
                  min={editStart}
                  onChange={e => setEditEnd(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <p className="text-xs text-gray-400">
                {editStart && editEnd && editStart <= editEnd
                  ? `${dayCount(editStart, editEnd)} day${dayCount(editStart, editEnd) !== 1 ? 's' : ''}`
                  : 'Invalid range'}
              </p>
            </div>
          )}

          {confirmDelete && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm font-semibold text-red-800">Delete this holiday request?</p>
              <p className="text-xs text-red-600 mt-1">
                This removes {days} day{days !== 1 ? 's' : ''} of leave for {employeeName} and cannot be undone.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex items-center gap-3">
          {/* Left: delete trigger / confirm */}
          {canEdit && !isEditing && !confirmDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="text-sm font-medium text-red-600 hover:text-red-700"
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
                className="text-sm text-gray-600 hover:text-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className="text-sm font-medium bg-red-600 text-white px-3 py-1.5 rounded-lg hover:bg-red-700 disabled:opacity-50"
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
                  className="text-sm text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
                >
                  Close
                </button>
                {canEdit && request && (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="text-sm font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700"
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
                  className="text-sm text-gray-600 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={isSaving || !editStart || !editEnd || editStart > editEnd}
                  className="text-sm font-medium bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 disabled:opacity-50"
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
