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
 *
 * Holiday, department and day-note colours for the rota screens are further down this file,
 * so /rota, /rota/hours, /rota/payroll, /rota/templates and the staff portal read one source.
 * The printed rota and hours report take their colours from here too, as palette values.
 */

import { CATEGORY, CHART_SERIES, STAFF } from '@/lib/brand/palette';

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

/**
 * Holiday on the rota, keyed by leave_requests.status: approved holiday is success and a
 * request still waiting for a manager is warning. Same shape as the shift status map: add
 * `border` and a radius where you use an entry.
 */
export type RotaHolidayStatus = 'approved' | 'pending';

export const ROTA_HOLIDAY_CLASSES: Readonly<Record<RotaHolidayStatus, string>> = {
  approved: 'bg-success-soft text-success-fg border-success-border',
  pending: 'bg-warning-soft text-warning-fg border-warning-border',
};

/**
 * The same meanings as CSS colours, for places a class cannot reach (chart fills and legend
 * dots on the hours report): approved holiday is success and Couldn't Work is danger.
 */
export const ROTA_CHART_COLOURS = {
  holiday: 'var(--color-success)',
  couldntWork: 'var(--color-danger)',
} as const;

/**
 * The same two meanings as literal colours, for the printed hours report
 * (src/app/api/rota/hours/pdf/route.ts): a PDF cannot read CSS variables.
 */
export const ROTA_CHART_PRINT_COLOURS = {
  holiday: STAFF.success,
  couldntWork: STAFF.danger,
} as const;

/**
 * One line colour per employee on the hours report, in this order: the six chart colours, then
 * the category colours they do not already use (cat-2, cat-5 and cat-8), so up to nine people get
 * distinct lines. Success and danger stay out because the holiday and Couldn't Work bars use them.
 * The screen (/rota/hours) draws `css` and the PDF prints `print`, the same token's palette value.
 */
export const ROTA_HOURS_SERIES_COLOURS: ReadonlyArray<{ css: string; print: string }> = [
  { css: 'var(--color-chart-1)', print: CHART_SERIES[0] },
  { css: 'var(--color-chart-2)', print: CHART_SERIES[1] },
  { css: 'var(--color-chart-3)', print: CHART_SERIES[2] },
  { css: 'var(--color-chart-4)', print: CHART_SERIES[3] },
  { css: 'var(--color-chart-5)', print: CHART_SERIES[4] },
  { css: 'var(--color-chart-6)', print: CHART_SERIES[5] },
  { css: 'var(--color-cat-2)', print: CATEGORY[1].base },
  { css: 'var(--color-cat-5)', print: CATEGORY[4].base },
  { css: 'var(--color-cat-8)', print: CATEGORY[7].base },
];

/**
 * Department colours. A department is a category, not a state, so it takes the category
 * tokens and never a status tone: kitchen on the warning tone would make every kitchen shift
 * read as a problem, which is also why kitchen is cat-5 (orange) and not cat-6 (amber, the
 * same colour as warning). The hues follow the automatic shift colours in
 * shift-template-colours.ts where there is one (runner purple, training green, host black).
 *
 * Keys are departments.name values, which settings managers can add to, so anything not listed
 * falls back to a neutral chip. Entries colour a bordered block or badge: add `border` and a
 * radius where you use them (DS Badge brings both).
 */
export type RotaDepartmentKey = 'bar' | 'kitchen' | 'runner' | 'host' | 'training' | 'cleaning';

/** A category colour: cat-N in globals.css, CATEGORY[N - 1] in src/lib/brand/palette.ts. */
export type RotaCategoryNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Which category colour each department takes: the single source for the department look.
 * ROTA_DEPARTMENT_CLASSES spells the same numbers out as classes for the screen (written out in
 * full because Tailwind only generates classes it can read in the source; a test holds the two
 * together), and the printed rota reads CATEGORY[N - 1] from src/lib/brand/palette.ts.
 */
export const ROTA_DEPARTMENT_CATEGORIES: Readonly<Record<RotaDepartmentKey, RotaCategoryNumber>> = {
  bar: 1,
  kitchen: 5,
  runner: 3,
  host: 8,
  training: 7,
  cleaning: 2,
};

export const ROTA_DEPARTMENT_CLASSES: Readonly<Record<RotaDepartmentKey, string>> = {
  bar: 'bg-cat-1-soft text-cat-1-fg border-cat-1/20',
  kitchen: 'bg-cat-5-soft text-cat-5-fg border-cat-5/20',
  runner: 'bg-cat-3-soft text-cat-3-fg border-cat-3/20',
  host: 'bg-cat-8-soft text-cat-8-fg border-cat-8/20',
  training: 'bg-cat-7-soft text-cat-7-fg border-cat-7/20',
  cleaning: 'bg-cat-2-soft text-cat-2-fg border-cat-2/20',
};

export const ROTA_DEPARTMENT_FALLBACK_CLASSES = 'bg-surface-2 text-text-muted border-border';

/** A department name as a key, matched without regard to case or spaces. Null when it has no category. */
function rotaDepartmentKey(department: string | null | undefined): RotaDepartmentKey | null {
  const key = (department ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(ROTA_DEPARTMENT_CATEGORIES, key) ? (key as RotaDepartmentKey) : null;
}

/** The category colour for a department name, or null for a department with none (the neutral look). */
export function rotaDepartmentCategory(department: string | null | undefined): RotaCategoryNumber | null {
  const key = rotaDepartmentKey(department);
  return key ? ROTA_DEPARTMENT_CATEGORIES[key] : null;
}

/** Classes for a department name, matched without regard to case or spaces. Unknown departments are neutral. */
export function rotaDepartmentClasses(department: string | null | undefined): string {
  const key = rotaDepartmentKey(department);
  return key ? ROTA_DEPARTMENT_CLASSES[key] : ROTA_DEPARTMENT_FALLBACK_CLASSES;
}

/**
 * What else is on that day, shown as a dot and a label on the rota and on payroll. These are
 * categories too, so a private booking never reads as an error. Events and private bookings
 * follow their calendar colours (dark blue and purple); calendar notes carry their own colour.
 */
export type RotaDayInfoKind = 'event' | 'private_booking' | 'covers' | 'high_chairs';

export const ROTA_DAY_INFO_CLASSES: Readonly<Record<RotaDayInfoKind, { dot: string; text: string }>> = {
  event: { dot: 'bg-cat-2', text: 'text-cat-2-fg' },
  private_booking: { dot: 'bg-cat-3', text: 'text-cat-3-fg' },
  covers: { dot: 'bg-cat-7', text: 'text-cat-7-fg' },
  high_chairs: { dot: 'bg-cat-1', text: 'text-cat-1-fg' },
};

/**
 * A calendar note in the day notes, the same on the rota and on payroll. Its colour is the one
 * staff picked, which can be white or pale yellow, so it goes on a small outlined swatch (set
 * as the swatch's background) and the title is ordinary text that reads on any colour.
 */
export const ROTA_CALENDAR_NOTE_CLASSES = {
  swatch: 'inline-block h-2 w-2 shrink-0 rounded-sm border border-border-strong',
  text: 'text-text',
} as const;
