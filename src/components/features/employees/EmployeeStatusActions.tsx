'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { revokeEmployeeAccess, resendInvite } from '@/app/actions/employeeInvite';
import {
  beginEmployeeSeparation,
  getEmployeeSeparationPreview,
  type EmployeeSeparationPreview,
  type EmployeeSeparationShift,
  type SeparationShiftPolicy,
} from '@/app/actions/employeeSeparation';
import { Button, toast } from '@/ds';
import { formatDateFull, formatTime12Hour, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';

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

function trapDialogFocus(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'Tab') return;
  const focusable = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ),
  );
  if (focusable.length === 0) return;

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
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

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSeparation();
      return;
    }
    trapDialogFocus(event);
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

      {showConfirm === 'separation' && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="separation-dialog-title"
          onKeyDown={handleDialogKeyDown}
        >
          <div className="fixed inset-0 bg-gray-500/75" onClick={closeSeparation} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-2xl rounded-lg bg-surface p-6 shadow-lg">
              <h3 id="separation-dialog-title" className="mb-2 text-lg font-semibold text-text">
                Begin Separation
              </h3>
              <p className="mb-6 text-sm text-text-muted">
                Review the remaining rota before starting the separation process. System access is not affected yet.
              </p>

              <div className="mb-6 space-y-5">
                <div>
                  <label htmlFor="separation-end-date" className="block text-sm font-medium text-gray-700">
                    Last working day
                  </label>
                  <input
                    ref={dateInputRef}
                    id="separation-end-date"
                    type="date"
                    value={separationEndDate}
                    min={minimumEndDate ?? undefined}
                    onChange={(event) => setSeparationEndDate(event.target.value)}
                    aria-describedby={dateError ? 'separation-date-error' : undefined}
                    aria-invalid={Boolean(dateError)}
                    className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                    required
                  />
                  {dateError && (
                    <p id="separation-date-error" className="mt-1 text-sm text-red-700">
                      {dateError}
                    </p>
                  )}
                </div>

                <fieldset disabled={previewLoading || Boolean(previewError)}>
                  <legend className="text-sm font-medium text-text">What should happen to remaining shifts?</legend>
                  <div className="mt-2 grid gap-3 sm:grid-cols-2">
                    <label className="flex cursor-pointer gap-3 rounded-lg border border-border-strong p-4 has-[:checked]:border-yellow-600 has-[:checked]:bg-warning-soft">
                      <input
                        type="radio"
                        name="separation-shift-policy"
                        value="work_remaining"
                        checked={shiftPolicy === 'work_remaining'}
                        onChange={() => setShiftPolicy('work_remaining')}
                        className="mt-1"
                      />
                      <span>
                        <span className="block text-sm font-semibold text-text">Work agreed shifts</span>
                        <span className="mt-1 block text-sm text-text-muted">
                          Keep shifts through the last working day and open any later shifts.
                        </span>
                      </span>
                    </label>
                    <label className="flex cursor-pointer gap-3 rounded-lg border border-border-strong p-4 has-[:checked]:border-yellow-600 has-[:checked]:bg-warning-soft">
                      <input
                        type="radio"
                        name="separation-shift-policy"
                        value="release_remaining"
                        checked={shiftPolicy === 'release_remaining'}
                        onChange={() => setShiftPolicy('release_remaining')}
                        className="mt-1"
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
                      <span className="text-xs text-gray-500">
                        {preview.shifts.length} shift{preview.shifts.length === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {previewLoading && <p className="mt-2 text-sm text-text-muted">Loading scheduled shifts...</p>}
                  {previewError && (
                    <p role="alert" className="mt-2 rounded-md bg-danger-soft p-3 text-sm text-danger-fg">
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
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${shift.weekStatus === 'published' ? 'bg-success-soft text-green-800' : 'bg-surface-hover text-gray-700'}`}>
                                  {shift.weekStatus === 'published' ? 'Published' : 'Draft'}
                                </span>
                                {acceptance && (
                                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-info-fg">
                                    {acceptance}
                                  </span>
                                )}
                                {decision && (
                                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${willRelease ? 'bg-amber-100 text-warning-fg' : 'bg-success-soft text-green-800'}`}>
                                    {decision}
                                  </span>
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
                  <p className="rounded-md bg-blue-50 p-3 text-sm text-info-fg" aria-live="polite">
                    {retainedShifts.length} shift{retainedShifts.length === 1 ? '' : 's'} will stay assigned.{' '}
                    {releasedShifts.length} shift{releasedShifts.length === 1 ? '' : 's'} will become open.
                  </p>
                )}

                {leaveAfterEndDate.length > 0 && (
                  <p className="rounded-md bg-warning-soft p-3 text-sm text-warning-fg">
                    There {leaveAfterEndDate.length === 1 ? 'is' : 'are'} {leaveAfterEndDate.length} approved leave day{leaveAfterEndDate.length === 1 ? '' : 's'} after the last working day. Cancel {leaveAfterEndDate.length === 1 ? 'it' : 'them'} separately before finalising the employee.
                  </p>
                )}

                <div>
                  <label htmlFor="separation-note" className="block text-sm font-medium text-gray-700">
                    Note
                  </label>
                  <textarea
                    id="separation-note"
                    value={separationNote}
                    onChange={(event) => setSeparationNote(event.target.value)}
                    rows={3}
                    maxLength={500}
                    className="mt-1 block w-full rounded-md border-border-strong shadow-sm focus:border-yellow-500 focus:ring-yellow-500 sm:text-sm"
                    placeholder="Optional reason or handover note"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeSeparation}
                  disabled={loading}
                  className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-surface-hover disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleBeginSeparation}
                  disabled={confirmDisabled}
                  className="rounded-md bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-500 disabled:opacity-50"
                >
                  {loading ? 'Starting...' : 'Confirm separation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showConfirm === 'revoke' && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="revoke-dialog-title"
          onKeyDown={trapDialogFocus}
        >
          <div className="fixed inset-0 bg-gray-500/75" onClick={() => setShowConfirm(null)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative w-full max-w-md rounded-lg bg-surface p-6 shadow-lg">
              <h3 id="revoke-dialog-title" className="mb-2 text-lg font-semibold text-text">
                Mark as Former and Revoke Access
              </h3>
              <p className="mb-6 text-sm text-text-muted">
                This will set the employee status to &quot;Former&quot;, set their employment end date to today, and remove all their system permissions. This cannot be undone automatically. Continue?
              </p>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowConfirm(null)} className="rounded-md px-4 py-2 text-sm font-semibold text-gray-700 ring-1 ring-inset ring-gray-300 hover:bg-surface-hover">
                  Cancel
                </button>
                <button type="button" onClick={handleRevokeAccess} className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500">
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
