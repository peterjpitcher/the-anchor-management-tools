/**
 * How statuses look on the rota section's own screens: the DS Badge tone (or, where a class is
 * the only thing that fits, the full class string) for each value. Pure module, safe to import
 * from server and client components. Call sites never pick a tone themselves; they ask this
 * file, so a status looks the same wherever it shows.
 *
 * Shift, holiday, department, day-note and hours-report colours are not here: they live in
 * src/lib/rota/status-ui.ts because the printed rota and the staff portal read them too.
 * Leave request statuses are not here either: the portal and employee screens hold copies of
 * that map, and they are merged in one change across all three.
 */

import type { IconName } from '@/ds';
import { ROTA_SHIFT_STATUS_CLASSES } from '@/lib/rota/status-ui';
import { isCouldntWorkPayrollFlag } from '@/lib/rota/payroll-flags';

export type RotaBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/**
 * The colour a status icon takes for a tone, for a figure that carries its state as an icon
 * (Stat has no tone of its own). Base shades: these colour icons, never text.
 */
export const ROTA_TONE_ICON_CLASSES: Readonly<Record<RotaBadgeTone, string>> = {
  neutral: 'text-text-muted',
  primary: 'text-primary',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

/** The icon a status tone takes when a figure shows its state as an icon. */
export const ROTA_TONE_ICON: Readonly<Record<RotaBadgeTone, IconName>> = {
  neutral: 'circle',
  primary: 'info',
  success: 'checkCircle',
  warning: 'alertTriangle',
  danger: 'alertCircle',
  info: 'info',
};

/* ------------------------------------------------------------------ */
/*  Rota week publishing                                              */
/* ------------------------------------------------------------------ */

/**
 * Where a rota week stands with staff. The header works it out from the published snapshot
 * (published, draft or unpublished changes); the schedule card reads the week row's own flag
 * (published, published with changes or draft). Both use these names and colours.
 */
export type RotaWeekPublishState = 'published' | 'published_with_changes' | 'unpublished_changes' | 'draft';

export const ROTA_WEEK_PUBLISH_TONE: Readonly<Record<RotaWeekPublishState, RotaBadgeTone>> = {
  published: 'success',
  published_with_changes: 'warning',
  unpublished_changes: 'warning',
  draft: 'warning',
};

export const ROTA_WEEK_PUBLISH_LABEL: Readonly<Record<RotaWeekPublishState, string>> = {
  published: 'Published',
  published_with_changes: 'Published with changes',
  unpublished_changes: 'Unpublished changes',
  draft: 'Draft',
};

export const ROTA_WEEK_PUBLISH_ICON: Readonly<Record<RotaWeekPublishState, IconName>> = {
  published: 'checkCircle',
  published_with_changes: 'alertTriangle',
  unpublished_changes: 'alertTriangle',
  draft: 'alertTriangle',
};

/* ------------------------------------------------------------------ */
/*  Rota grid figures                                                 */
/* ------------------------------------------------------------------ */

/** Open shifts on the week: some waiting for somebody is a warning, none is fine. */
export const ROTA_OPEN_SHIFTS_TONE: Readonly<Record<'some' | 'none', RotaBadgeTone>> = {
  some: 'warning',
  none: 'success',
};

/** Labour as a share of takings against the wage target. */
export type LabourShareState = 'over' | 'within';

export const LABOUR_SHARE_TONE: Readonly<Record<LabourShareState, RotaBadgeTone>> = {
  over: 'danger',
  within: 'success',
};

export const LABOUR_SHARE_LABEL: Readonly<Record<LabourShareState, string>> = {
  over: 'Over target',
  within: 'Within target',
};

/** A day's labour share as text in the rota's day header. */
export const LABOUR_SHARE_TEXT_CLASSES: Readonly<Record<LabourShareState, string>> = {
  over: 'text-danger-fg',
  within: 'text-success-fg',
};

/** The day header's planning cell: tinted when that day's labour share is over target. */
export const LABOUR_SHARE_CELL_CLASSES: Readonly<Record<LabourShareState, string>> = {
  over: 'border-danger-border bg-danger-soft',
  within: 'border-border bg-surface',
};

/** The week's wage figure: a warning while some shifts could not be costed. */
export const ROTA_WAGES_COSTING_TONE: Readonly<Record<'uncosted' | 'costed', RotaBadgeTone>> = {
  uncosted: 'warning',
  costed: 'neutral',
};

/** An employee's hours line on the rota grid: over their weekly or period maximum is danger. */
export const ROTA_HOURS_LIMIT_TEXT_CLASSES: Readonly<Record<'over' | 'within', string>> = {
  over: 'text-danger-fg font-semibold',
  within: 'text-text-muted',
};

/**
 * How much of a payroll period's maximum hours an employee has used, on the rota grid:
 * over the maximum is danger, 85% and above is a warning, anything less is fine.
 */
export type RotaCapacityState = 'over' | 'near' | 'ok';

export function rotaCapacityState(overMaximum: boolean, usedPercent: number): RotaCapacityState {
  if (overMaximum) return 'over';
  return usedPercent >= 85 ? 'near' : 'ok';
}

export const ROTA_CAPACITY_TEXT_CLASSES: Readonly<Record<RotaCapacityState, string>> = {
  over: 'text-danger-fg',
  near: 'text-warning-fg',
  ok: 'text-text-muted',
};

export const ROTA_CAPACITY_BAR_TONE: Readonly<Record<RotaCapacityState, 'danger' | 'warning' | 'success'>> = {
  over: 'danger',
  near: 'warning',
  ok: 'success',
};

/** A member of staff asking to take an open shift, in the shift dialog. */
export const OPEN_SHIFT_REQUEST_STATUS_TONE: Readonly<Record<'pending' | 'approved' | 'declined' | 'cancelled', RotaBadgeTone>> = {
  pending: 'warning',
  approved: 'success',
  declined: 'neutral',
  cancelled: 'neutral',
};

/* ------------------------------------------------------------------ */
/*  Add Shifts dialog                                                 */
/* ------------------------------------------------------------------ */

export const ADD_SHIFTS_ITEM_TONE: Readonly<Record<'recommended' | 'exists', RotaBadgeTone>> = {
  recommended: 'info',
  exists: 'neutral',
};

/** The person a template pre-assigns: a warning when they are on leave and the shift will open. */
export const ADD_SHIFTS_ASSIGNEE_TONE: Readonly<Record<'assigned' | 'on_leave', RotaBadgeTone>> = {
  assigned: 'neutral',
  on_leave: 'warning',
};

/* ------------------------------------------------------------------ */
/*  Labour cost dashboard                                             */
/* ------------------------------------------------------------------ */

/** Hours used against a department budget: over 100% danger, over 85% warning. */
export function budgetUsageTone(percent: number): 'danger' | 'warning' | 'success' {
  if (percent > 100) return 'danger';
  return percent > 85 ? 'warning' : 'success';
}

/** A department's hours figure against its budget: over 100% reads as danger. */
export const BUDGET_HOURS_TEXT_CLASSES: Readonly<Record<'over' | 'within', string>> = {
  over: 'text-danger-fg',
  within: 'text-text',
};

/* ------------------------------------------------------------------ */
/*  Holiday allowance                                                 */
/* ------------------------------------------------------------------ */

/** Holiday allowance used for the year, on a leave request: reaching the allowance is danger. */
export type LeaveAllowanceState = 'over' | 'within';

export const LEAVE_ALLOWANCE_TONE: Readonly<Record<LeaveAllowanceState, 'danger' | 'success'>> = {
  over: 'danger',
  within: 'success',
};

export const LEAVE_ALLOWANCE_TEXT_CLASSES: Readonly<Record<LeaveAllowanceState, string>> = {
  over: 'text-danger-fg',
  within: 'text-text',
};

/* ------------------------------------------------------------------ */
/*  Payroll                                                           */
/* ------------------------------------------------------------------ */

export type PayrollApprovalState = 'approved' | 'pending';

export const PAYROLL_APPROVAL_TONE: Readonly<Record<PayrollApprovalState, RotaBadgeTone>> = {
  approved: 'success',
  pending: 'warning',
};

/** Actual against planned hours to date: ahead is fine, up to 10 hours under a warning, more than that danger. */
export type PayrollVarianceState = 'ahead' | 'under' | 'well_under';

export function payrollVarianceState(varianceHours: number): PayrollVarianceState {
  if (varianceHours >= 0) return 'ahead';
  return varianceHours > -10 ? 'under' : 'well_under';
}

export const PAYROLL_VARIANCE_TONE: Readonly<Record<PayrollVarianceState, RotaBadgeTone>> = {
  ahead: 'success',
  under: 'warning',
  well_under: 'danger',
};

export const PAYROLL_VARIANCE_ICON: Readonly<Record<PayrollVarianceState, IconName>> = {
  ahead: 'checkCircle',
  under: 'alertTriangle',
  well_under: 'alertCircle',
};

/** A day's or a row's hours difference as text: short is danger, over is success, level is muted. */
export function payrollDiffClasses(diffHours: number): string {
  if (Math.abs(diffHours) < 0.05) return 'text-text-muted';
  return diffHours < 0 ? 'text-danger-fg font-medium' : 'text-success-fg';
}

/** Whether an employee has a pay rate on the payroll summary. */
export const PAYROLL_PAY_RATE_TONE: Readonly<Record<'set' | 'missing', RotaBadgeTone>> = {
  set: 'success',
  missing: 'warning',
};

/** A day in the daily breakdown that holds flagged rows. */
export const PAYROLL_DAY_FLAGGED_TONE: RotaBadgeTone = 'warning';

/**
 * Payroll flag badges. Couldn't Work takes the shared rota colour (danger); a variance is a
 * warning; auto-closed and unscheduled are kinds of entry rather than problems, so they take
 * category colours. Anything else is a neutral badge (undefined leaves the Badge default).
 */
export function payrollFlagBadgeClasses(flag: string): string | undefined {
  if (isCouldntWorkPayrollFlag(flag)) return ROTA_SHIFT_STATUS_CLASSES.sick;
  if (flag === 'variance') return 'bg-warning-soft text-warning-fg border-warning-border';
  if (flag === 'auto_close') return 'bg-cat-3-soft text-cat-3-fg border-cat-3/20';
  if (flag === 'unscheduled') return 'bg-cat-5-soft text-cat-5-fg border-cat-5/20';
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Timeclock                                                         */
/* ------------------------------------------------------------------ */

export type TimeclockSessionFlag =
  | 'auto_close'
  | 'unscheduled'
  | 'approved'
  | 'still_in'
  | 'premium'
  | 'inherited_premium';

export const TIMECLOCK_FLAG_TONE: Readonly<Record<TimeclockSessionFlag, RotaBadgeTone>> = {
  auto_close: 'warning',
  unscheduled: 'danger',
  approved: 'success',
  still_in: 'warning',
  premium: 'info',
  inherited_premium: 'neutral',
};

/** An approved session keeps a quiet tint, so it reads apart when approved rows are shown. */
export const TIMECLOCK_REVIEWED_ROW_CLASSES = 'bg-info-soft';

/* ------------------------------------------------------------------ */
/*  Reassign queue                                                    */
/* ------------------------------------------------------------------ */

export type ReassignOriginKind = 'rejected' | 'unassigned' | 'never_assigned';

export const REASSIGN_ORIGIN_TONE: Readonly<Record<ReassignOriginKind, RotaBadgeTone>> = {
  rejected: 'danger',
  unassigned: 'warning',
  never_assigned: 'warning',
};

export const REASSIGN_ORIGIN_LABEL: Readonly<Record<ReassignOriginKind, string>> = {
  rejected: 'Turned down',
  unassigned: 'Open',
  never_assigned: 'Open',
};

export const REASSIGN_OUTCOME_TONE: Readonly<Record<'covered' | 'cancelled' | 'deleted', RotaBadgeTone>> = {
  covered: 'success',
  cancelled: 'neutral',
  deleted: 'neutral',
};

/* ------------------------------------------------------------------ */
/*  Shift templates                                                   */
/* ------------------------------------------------------------------ */

/** The badges on a template row: its auto-schedule day, who it pre-assigns, or that it opens. */
export const SHIFT_TEMPLATE_BADGE_TONE: Readonly<Record<'day' | 'employee' | 'open_shift', RotaBadgeTone>> = {
  day: 'primary',
  employee: 'neutral',
  open_shift: 'warning',
};
