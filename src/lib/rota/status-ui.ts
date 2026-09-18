/**
 * Rota shift status colours: one map for every screen that shows the state of a shift.
 *
 * The meanings come from the main rota screen (src/app/(authenticated)/rota/RotaGrid.tsx),
 * expressed in design tokens:
 * - scheduled: an ordinary shift. No status colour (the department or template colour shows).
 * - pending: waiting for the member of staff to accept or reject it (warning).
 * - accepted and auto_accepted: accepted by the member of staff, or by the two-week rule (success).
 * - sick: a "Couldn't Work" shift. Danger on every screen; the hours report once showed it blue.
 * - rejected: turned down by the member of staff. A dashed danger outline on white, so it never
 *   reads as the same thing as a Couldn't Work shift.
 * - cancelled: neutral and quiet.
 *
 * Keys are the values of rota_shifts.status ('scheduled', 'sick', 'cancelled') and of
 * acceptance_status ('pending', 'accepted', 'auto_accepted', 'rejected').
 *
 * Every entry is a full class string, because Tailwind only generates classes it can read in
 * the source. Entries colour a bordered block: add `border` and a radius where you use them.
 * The rejected entry brings its own `border border-dashed`, because the dashed line is what
 * sets it apart.
 */

export type RotaShiftStatus = 'scheduled' | 'sick' | 'cancelled';
export type RotaShiftAcceptanceStatus = 'pending' | 'accepted' | 'auto_accepted' | 'rejected';
export type RotaShiftStatusKey = RotaShiftStatus | RotaShiftAcceptanceStatus;

export const ROTA_SHIFT_STATUS_CLASSES: Readonly<Record<RotaShiftStatusKey, string>> = {
  scheduled: 'bg-surface text-text border-border',
  pending: 'bg-warning-soft text-warning-fg border-warning-border',
  accepted: 'bg-success-soft text-success-fg border-success-border',
  auto_accepted: 'bg-success-soft text-success-fg border-success-border',
  sick: 'bg-danger-soft text-danger-fg border-danger-border',
  rejected: 'border border-dashed border-danger text-danger-fg bg-surface',
  cancelled: 'bg-surface-2 text-text-muted border-border',
};

function isRotaShiftStatusKey(status: string): status is RotaShiftStatusKey {
  return Object.prototype.hasOwnProperty.call(ROTA_SHIFT_STATUS_CLASSES, status);
}

/** Classes for a shift status or acceptance status. Anything unrecognised looks like a plain scheduled shift. */
export function rotaShiftStatusClasses(status: string): string {
  return isRotaShiftStatusKey(status) ? ROTA_SHIFT_STATUS_CLASSES[status] : ROTA_SHIFT_STATUS_CLASSES.scheduled;
}
