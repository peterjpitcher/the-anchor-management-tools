'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { revokeEmployeeAccess, resendInvite } from '@/app/actions/employeeInvite';
import {
  beginEmployeeSeparation,
  getEmployeeSeparationPreview,
  type EmployeeSeparationPreview,
  type EmployeeSeparationShift,
  type SeparationShiftPolicy,
} from '@/app/actions/employeeSeparation';
import { Alert, Badge, Button, ConfirmDialog, Empty, Fieldset, Input, Modal, PageLoading, Radio, SubHeading, Textarea, toast } from '@/ds';
import { formatDateFull, formatTime12Hour, getTodayIsoDate, shiftIsoDate } from '@/lib/dateUtils';
import { rotaShiftStatusClasses } from '@/lib/rota/status-ui';
import { SEPARATION_SHIFT_DECISION_TONES } from '@/app/(authenticated)/employees/_shared/status-ui';
import { ROTA_WEEK_PUBLISH_LABEL, ROTA_WEEK_PUBLISH_TONE } from '@/app/(authenticated)/rota/_shared/status-ui';
import { EmployeeActionButton, type EmployeeHeaderAction } from './employeeHeaderActions';

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

/**
 * The status actions for an employee (Resend Invite, Begin Separation, Mark as Former) and the
 * dialogs they open. Returned separately so the page can show the actions as buttons or as items
 * in the phone "More" menu while the dialogs stay mounted outside that menu.
 */
export function useEmployeeStatusActions({
  employeeId,
  status,
  canEdit,
  employmentStartDate,
}: EmployeeStatusActionsProps): { actions: EmployeeHeaderAction[]; dialogs: ReactNode } {
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

  if (!canEdit) return { actions: [], dialogs: null };

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

  // No shift choice until the remaining rota has loaded.
  const shiftPolicyDisabled = previewLoading || Boolean(previewError);

  const actions: EmployeeHeaderAction[] = [];
  if (status === 'Onboarding') {
    actions.push({
      key: 'resend-invite',
      label: loading ? 'Sending...' : 'Resend Invite',
      onSelect: handleResendInvite,
      loading,
    });
  }
  if (status === 'Active') {
    actions.push({
      key: 'begin-separation',
      label: 'Begin Separation',
      onSelect: openSeparation,
      disabled: loading,
    });
  }
  if (status === 'Started Separation') {
    actions.push({
      key: 'mark-former',
      label: loading ? 'Processing...' : 'Mark as Former',
      onSelect: () => setShowConfirm('revoke'),
      loading,
      tone: 'danger',
    });
  }

  const dialogs = (
    <>
      {/* The DS Modal traps focus and closes on Escape or a click outside, through closeSeparation,
          which refuses while the separation is being saved (as the hand-built dialog did). */}
      <Modal
        open={showConfirm === 'separation'}
        onClose={closeSeparation}
        title="Begin Separation"
        description="Review the remaining rota before starting the separation process. System access is not affected yet."
        width="lg"
        footer={
          <>
            <Button type="button" variant="secondary" onClick={closeSeparation} disabled={loading}>
              Cancel
            </Button>
            <Button type="button" variant="primary" onClick={handleBeginSeparation} disabled={confirmDisabled}>
              {loading ? 'Starting...' : 'Confirm Separation'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            ref={dateInputRef}
            id="separation-end-date"
            label="Last working day"
            type="date"
            value={separationEndDate}
            min={minimumEndDate ?? undefined}
            onChange={(event) => setSeparationEndDate(event.target.value)}
            error={dateError ?? undefined}
            required
          />

          {/* The DS Radio's label is the tap target, 44px tall on a touch screen, so the options
              need no hand-built label or card around them. The fieldset disables the inputs; each
              Radio is told as well, because its drawn circle and label only dim from its own prop. */}
          <Fieldset
            legend="What should happen to remaining shifts?"
            required
            disabled={shiftPolicyDisabled}
          >
            <Radio
              name="separation-shift-policy"
              value="work_remaining"
              checked={shiftPolicy === 'work_remaining'}
              onChange={() => setShiftPolicy('work_remaining')}
              disabled={shiftPolicyDisabled}
              label="Work agreed shifts"
              description="Keep shifts through the last working day and open any later shifts."
            />
            <Radio
              name="separation-shift-policy"
              value="release_remaining"
              checked={shiftPolicy === 'release_remaining'}
              onChange={() => setShiftPolicy('release_remaining')}
              disabled={shiftPolicyDisabled}
              label="Release all remaining shifts"
              description="Open every shift which has not started, including later today."
            />
          </Fieldset>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              {/* h3: the dialog title is the h2. */}
              <SubHeading as="h3">Remaining Scheduled Shifts</SubHeading>
              {preview && (
                <span className="text-xs text-text-muted">
                  {preview.shifts.length} shift{preview.shifts.length === 1 ? '' : 's'}
                </span>
              )}
            </div>

            {previewLoading && <PageLoading inline label="Loading scheduled shifts..." className="py-6" />}
            {previewError && (
              <Alert tone="danger" size="sm">
                {previewError}
              </Alert>
            )}
            {preview && preview.shifts.length === 0 && (
              <Empty
                size="sm"
                title="No remaining shifts"
                description="There are no assigned shifts which have not started."
              />
            )}
            {preview && preview.shifts.length > 0 && (
              <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-default border border-border">
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
                          <Badge tone={ROTA_WEEK_PUBLISH_TONE[shift.weekStatus]}>
                            {ROTA_WEEK_PUBLISH_LABEL[shift.weekStatus]}
                          </Badge>
                          {acceptance && shift.acceptanceStatus && (
                            <Badge className={rotaShiftStatusClasses(shift.acceptanceStatus)}>
                              {acceptance}
                            </Badge>
                          )}
                          {decision && (
                            <Badge tone={SEPARATION_SHIFT_DECISION_TONES[willRelease ? 'released' : 'retained']}>
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
          </div>

          {preview && shiftPolicy && (
            <Alert tone="info" size="sm" role="status">
              {retainedShifts.length} shift{retainedShifts.length === 1 ? '' : 's'} will stay assigned.{' '}
              {releasedShifts.length} shift{releasedShifts.length === 1 ? '' : 's'} will become open.
            </Alert>
          )}

          {leaveAfterEndDate.length > 0 && (
            <Alert tone="warning" size="sm">
              There {leaveAfterEndDate.length === 1 ? 'is' : 'are'} {leaveAfterEndDate.length} approved leave day{leaveAfterEndDate.length === 1 ? '' : 's'} after the last working day. Cancel {leaveAfterEndDate.length === 1 ? 'it' : 'them'} separately before finalising the employee.
            </Alert>
          )}

          <Textarea
            id="separation-note"
            label="Note"
            value={separationNote}
            onChange={(event) => setSeparationNote(event.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Optional reason or handover note"
          />
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

  return { actions, dialogs };
}

/** The status actions as buttons, with their dialogs. */
export default function EmployeeStatusActions(props: EmployeeStatusActionsProps): React.JSX.Element {
  const { actions, dialogs } = useEmployeeStatusActions(props);
  return (
    <>
      {actions.map((action) => (
        <EmployeeActionButton key={action.key} action={action} />
      ))}
      {dialogs}
    </>
  );
}
