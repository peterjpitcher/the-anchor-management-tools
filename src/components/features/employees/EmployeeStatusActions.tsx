'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { revokeEmployeeAccess, resendInvite } from '@/app/actions/employeeInvite';
import {
  beginEmployeeSeparation,
  getEmployeeSeparationPreview,
  type EmployeeSeparationPreview,
  type EmployeeSeparationShift,
  type SeparationShiftPolicy,
} from '@/app/actions/employeeSeparation';
import { Badge, Button, ConfirmDialog, Input, Modal, Textarea, toast } from '@/ds';
import { formatDateFull, formatTime12Hour, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { rotaShiftStatusClasses } from '@/lib/rota/status-ui';

interface EmployeeStatusActionsProps {
  employeeId: string;
  status: string;
  canEdit: boolean;
  employmentStartDate: string | null;
}

function departmentLabel(department: string | null | undefined): string {
  if (!department) return 'No department';
  const cleaned = department.replace(/[_-]+/g, ' ');
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function acceptanceLabel(status: EmployeeSeparationShift['acceptanceStatus']): string | null {
  if (!status) return null;
  if (status === 'auto_accepted') return 'Auto accepted';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export default function EmployeeStatusActions({
  employeeId,
  status,
  canEdit,
  employmentStartDate,
}: EmployeeStatusActionsProps) {
  const router = useRouter();
  const dateInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<EmployeeSeparationPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState<'separation' | 'revoke' | null>(null);
  const [separationEndDate, setSeparationEndDate] = useState(getTodayIsoDate);
  const [separationNote, setSeparationNote] = useState('');
  const [shiftPolicy, setShiftPolicy] = useState<SeparationShiftPolicy | null>(null);

  const recordedStartDate = preview?.employmentStartDate ?? employmentStartDate;
  const minimumEndDate = recordedStartDate ? shiftIsoDate(recordedStartDate, 1) : null;
  const dateError = recordedStartDate && separationEndDate <= recordedStartDate
    ? `Last working day must be after ${formatDateFull(recordedStartDate)}.`
    : null;

  const { retainedShifts, releasedShifts } = useMemo(() => {
    if (!preview || !shiftPolicy) return { retainedShifts: [], releasedShifts: [] };
    if (shiftPolicy === 'release_remaining') {
      return { retainedShifts: [], releasedShifts: preview.shifts };
    }
    return {
      retainedShifts: preview.shifts.filter((shift) => shift.shiftDate <= separationEndDate),
      releasedShifts: preview.shifts.filter((shift) => shift.shiftDate > separationEndDate),
    };
  }, [preview, separationEndDate, shiftPolicy]);

  const leaveAfterEndDate = preview?.futureLeaveDates.filter((date) => date > separationEndDate) ?? [];

  useEffect(() => {
    if (showConfirm === 'separation' && !previewLoading) dateInputRef.current?.focus();
  }, [previewLoading, showConfirm]);

  if (!canEdit) return null;

  const closeSeparation = () => {
    if (loading) return;
    setShowConfirm(null);
  };

  const handleResendInvite = async () => {
    setLoading(true);
    try {
      const result = await resendInvite(employeeId);
      if (result.type === 'success') {
        toast.success(result.message || 'Invite resent.');
      } else {
        toast.error(result.message || 'Failed to resend invite.');
      }
    } catch {
      toast.error('Failed to resend invite.');
    } finally {
      setLoading(false);
    }
  };

  const openSeparation = async () => {
    setShowConfirm('separation');
    setPreview(null);
    setPreviewError(null);
    setShiftPolicy(null);
    setPreviewLoading(true);

    const localMinimum = employmentStartDate ? shiftIsoDate(employmentStartDate, 1) : null;
    if (localMinimum && separationEndDate < localMinimum) setSeparationEndDate(localMinimum);

    try {
      const result = await getEmployeeSeparationPreview(employeeId);
      if (!result.success) {
        setPreviewError(result.error);
        return;
      }
      setPreview(result.data);
      const previewMinimum = result.data.employmentStartDate
        ? shiftIsoDate(result.data.employmentStartDate, 1)
        : null;
      if (previewMinimum && separationEndDate < previewMinimum) setSeparationEndDate(previewMinimum);
    } catch {
      setPreviewError('Failed to load remaining scheduled shifts.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleBeginSeparation = async () => {
    if (!shiftPolicy || !preview || dateError) return;
    setLoading(true);
    try {
      const result = await beginEmployeeSeparation(employeeId, {
        employmentEndDate: separationEndDate,
        shiftPolicy,
        note: separationNote.trim() || undefined,
      });
      if (result.success) {
        setShowConfirm(null);
        setSeparationNote('');
        setShiftPolicy(null);
        if (result.warning) {
          toast.warning(result.warning);
        } else {
          toast.success(
            `Separation started. ${result.retainedShiftCount} shift${result.retainedShiftCount === 1 ? '' : 's'} retained and ${result.releasedShiftCount} released.`,
          );
        }
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to start separation.');
      }
    } catch {
      toast.error('Failed to start separation.');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeAccess = async () => {
    setShowConfirm(null);
    setLoading(true);
    try {
      const result = await revokeEmployeeAccess(employeeId);
      if (result.success) {
        toast.success('Employee access revoked and status set to Former.');
        router.refresh();
      } else {
        toast.error(result.error || 'Failed to revoke access.');
      }
    } catch {
      toast.error('Failed to revoke access.');
    } finally {
      setLoading(false);
    }
  };

  const confirmDisabled = previewLoading
    || loading
    || !preview
    || Boolean(previewError)
    || !separationEndDate
    || Boolean(dateError)
    || !shiftPolicy;

  return (
    <>
      {status === 'Onboarding' && (
        <Button
          type="button"
          onClick={handleResendInvite}
          loading={loading}
          size="sm"
          variant="secondary"
        >
          {loading ? 'Sending...' : 'Resend Invite'}
        </Button>
      )}

      {status === 'Active' && (
        <Button
          type="button"
          onClick={openSeparation}
          disabled={loading}
          size="sm"
          variant="secondary"
        >
          Begin Separation
        </Button>
      )}

      {status === 'Started Separation' && (
        <Button
          type="button"
          onClick={() => setShowConfirm('revoke')}
          loading={loading}
          size="sm"
          variant="danger"
        >
          {loading ? 'Processing...' : 'Mark as Former'}
        </Button>
      )}

      {/* The DS Modal traps focus and closes on Escape or a click outside, through closeSeparation,
          which refuses while the separation is being saved (as the hand-built dialog did). */}
      <Modal
        open={showConfirm === 'separation'}
        onClose={closeSeparation}
        title="Begin Separation"
        width="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeSeparation} disabled={loading}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleBeginSeparation} disabled={confirmDisabled}>
              {loading ? 'Starting...' : 'Confirm separation'}
            </Button>
          </>
        }
      >
        <p className="mb-6 text-sm text-text-muted">
          Review the remaining rota before starting the separation process. System access is not affected yet.
        </p>

        <div className="space-y-5">
          <div>
            <label htmlFor="separation-end-date" className="block text-sm font-medium text-text">
              Last working day
            </label>
            <Input
              ref={dateInputRef}
              id="separation-end-date"
              type="date"
              value={separationEndDate}
              min={minimumEndDate ?? undefined}
              onChange={(event) => setSeparationEndDate(event.target.value)}
              aria-describedby={dateError ? 'separation-date-error' : undefined}
              aria-invalid={Boolean(dateError)}
              className="mt-1"
              required
            />
            {dateError && (
              <p id="separation-date-error" className="mt-1 text-sm text-danger-fg">
                {dateError}
              </p>
            )}
          </div>

          <fieldset disabled={previewLoading || Boolean(previewError)}>
            <legend className="text-sm font-medium text-text">What should happen to remaining shifts?</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border-strong p-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input
                  type="radio"
                  name="separation-shift-policy"
                  value="work_remaining"
                  checked={shiftPolicy === 'work_remaining'}
                  onChange={() => setShiftPolicy('work_remaining')}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="block text-sm font-semibold text-text">Work agreed shifts</span>
                  <span className="mt-1 block text-sm text-text-muted">
                    Keep shifts through the last working day and open any later shifts.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-border-strong p-4 has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                <input
                  type="radio"
                  name="separation-shift-policy"
                  value="release_remaining"
                  checked={shiftPolicy === 'release_remaining'}
                  onChange={() => setShiftPolicy('release_remaining')}
                  className="mt-1 accent-primary"
                />
                <span>
                  <span className="block text-sm font-semibold text-text">Release all remaining shifts</span>
                  <span className="mt-1 block text-sm text-text-muted">
                    Open every shift which has not started, including later today.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>

          <section aria-labelledby="remaining-shifts-heading">
            <div className="flex items-center justify-between gap-3">
              <h4 id="remaining-shifts-heading" className="text-sm font-medium text-text">
                Remaining scheduled shifts
              </h4>
              {preview && (
                <span className="text-xs text-text-muted">
                  {preview.shifts.length} shift{preview.shifts.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {previewLoading && <p className="mt-2 text-sm text-text-muted">Loading scheduled shifts...</p>}
            {previewError && (
              <p role="alert" className="mt-2 rounded-md border border-danger-border bg-danger-soft p-3 text-sm text-danger-fg">
                {previewError}
              </p>
            )}
            {preview && preview.shifts.length === 0 && (
              <p className="mt-2 rounded-md bg-surface-2 p-3 text-sm text-text-muted">
                There are no assigned shifts which have not started.
              </p>
            )}
            {preview && preview.shifts.length > 0 && (
              <ul className="mt-2 max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border">
                {preview.shifts.map((shift) => {
                  const willRelease = releasedShifts.some((released) => released.id === shift.id);
                  const decision = shiftPolicy ? (willRelease ? 'Will become open' : 'Will stay assigned') : null;
                  const acceptance = acceptanceLabel(shift.acceptanceStatus);
                  return (
                    <li key={shift.id} className="p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-text">
                            {formatDateFull(shift.shiftDate)}, {formatTime12Hour(shift.startTime)} to {formatTime12Hour(shift.endTime)}
                          </p>
                          <p className="mt-1 text-text-muted">
                            {shift.name ? `${shift.name}, ` : ''}{departmentLabel(shift.department)}
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <Badge tone={shift.weekStatus === 'published' ? 'success' : 'neutral'}>
                            {shift.weekStatus === 'published' ? 'Published' : 'Draft'}
                          </Badge>
                          {acceptance && shift.acceptanceStatus && (
                            <Badge className={rotaShiftStatusClasses(shift.acceptanceStatus)}>
                              {acceptance}
                            </Badge>
                          )}
                          {decision && (
                            <Badge tone={willRelease ? 'warning' : 'success'}>
                              {decision}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {preview && shiftPolicy && (
            <p className="rounded-md border border-info-border bg-info-soft p-3 text-sm text-info-fg" aria-live="polite">
              {retainedShifts.length} shift{retainedShifts.length === 1 ? '' : 's'} will stay assigned.{' '}
              {releasedShifts.length} shift{releasedShifts.length === 1 ? '' : 's'} will become open.
            </p>
          )}

          {leaveAfterEndDate.length > 0 && (
            <p className="rounded-md border border-warning-border bg-warning-soft p-3 text-sm text-warning-fg">
              There {leaveAfterEndDate.length === 1 ? 'is' : 'are'} {leaveAfterEndDate.length} approved leave day{leaveAfterEndDate.length === 1 ? '' : 's'} after the last working day. Cancel {leaveAfterEndDate.length === 1 ? 'it' : 'them'} separately before finalising the employee.
            </p>
          )}

          <div>
            <label htmlFor="separation-note" className="block text-sm font-medium text-text">
              Note
            </label>
            <Textarea
              id="separation-note"
              value={separationNote}
              onChange={(event) => setSeparationNote(event.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1"
              placeholder="Optional reason or handover note"
            />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={showConfirm === 'revoke'}
        onClose={() => setShowConfirm(null)}
        onConfirm={handleRevokeAccess}
        title="Mark as Former and Revoke Access"
        message={'This will set the employee status to "Former", set their employment end date to today, and remove all their system permissions. This cannot be undone automatically. Continue?'}
        confirmLabel="Confirm"
        tone="danger"
      />
    </>
  );
}
