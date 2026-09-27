'use client';

import { useState, useEffect } from 'react';
import { getLeaveRequestById, deleteLeaveRequest, updateLeaveRequestDates } from '@/app/actions/leave';
import type { LeaveRequest } from '@/app/actions/leave';
import { Alert, Badge, Button, ConfirmDialog, DescriptionList, Input, Modal, PageLoading, toast } from '@/ds';
import { rotaLeaveStatusLabel, rotaLeaveStatusTone } from '@/lib/rota/status-ui';

interface HolidayDetailModalProps {
  requestId: string;
  employeeName: string;
  canEdit: boolean;
  onClose: () => void;
  onDeleted: (requestId: string) => void;
  onUpdated: () => void;
}

function formatDateRange(start: string, end: string): string {
  // Both dates are UTC midnights, so they are formatted in UTC and never move a day with the zone.
  const s = new Date(start + 'T00:00:00Z');
  const e = new Date(end + 'T00:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' };
  if (start === end) return s.toLocaleDateString('en-GB', opts);
  return `${s.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })} – ${e.toLocaleDateString('en-GB', opts)}`;
}

function dayCount(start: string, end: string): number {
  const diff = new Date(end + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime();
  return Math.round(diff / 86400000) + 1;
}

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
    const res = await deleteLeaveRequest(requestId);
    if (res.success) {
      toast.success('Holiday request deleted');
      onDeleted(requestId);
      onClose();
    } else {
      toast.error(res.error);
    }
  };

  const days = request ? dayCount(request.start_date, request.end_date) : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title="Holiday Request"
      description={employeeName}
      width="md"
      footer={
        <>
          {/* Left: the destructive action, confirmed in its own dialog. */}
          {canEdit && request && !isEditing && (
            <Button
              type="button"
              variant="danger"
              onClick={() => setConfirmDelete(true)}
              className="sm:mr-auto"
            >
              Delete
            </Button>
          )}

          {/* Right: secondary, then primary. */}
          {!isEditing && (
            <>
              <Button type="button" variant="secondary" onClick={onClose}>
                Close
              </Button>
              {canEdit && request && (
                <Button type="button" variant="primary" onClick={() => setIsEditing(true)}>
                  Edit Dates
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
                disabled={!editStart || !editEnd || editStart > editEnd}
                loading={isSaving}
              >
                Save Changes
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {loading && <PageLoading inline label="Loading the holiday request" />}
        {fetchError && <Alert tone="danger">{fetchError}</Alert>}

        {request && !isEditing && (
          <DescriptionList
            columns={1}
            items={[
              {
                key: 'dates',
                label: 'Dates',
                value: (
                  <>
                    <span className="block font-semibold text-text-strong">{formatDateRange(request.start_date, request.end_date)}</span>
                    <span className="block text-xs text-text-muted">{days} day{days !== 1 ? 's' : ''}</span>
                  </>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                value: (
                  <Badge tone={rotaLeaveStatusTone(request.status)}>
                    {rotaLeaveStatusLabel(request.status)}
                  </Badge>
                ),
              },
              ...(request.note ? [{ key: 'note', label: 'Employee note', value: request.note }] : []),
              ...(request.manager_note ? [{ key: 'manager-note', label: 'Manager note', value: request.manager_note }] : []),
            ]}
          />
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
      </div>

      {/* Rendered inside this dialog so Headless UI stacks it on top as a nested dialog. */}
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
        title="Delete Holiday Request"
        message={`This removes ${days} day${days !== 1 ? 's' : ''} of leave for ${employeeName} and cannot be undone.`}
        confirmLabel="Delete"
        tone="danger"
      />
    </Modal>
  );
}
