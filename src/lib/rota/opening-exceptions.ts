import { formatTime12Hour } from '@/lib/dateUtils';

/**
 * Opening-hours exceptions for the rota planner.
 *
 * Opening times live in two tables: business_hours holds the 7 regular weekday
 * rows, special_hours holds dated overrides. A special_hours row is NOT
 * automatically an exception. Managers routinely save a row that matches the
 * regular week, so reporting every row would bury the days that actually change
 * staffing. A day is only reported when something a planner would act on
 * differs, or when the row carries a note (the note is where the reason lives,
 * for example "Sunday Lunch closed for this Sunday" on otherwise normal hours).
 *
 * This module is deliberately pure. RotaGrid is a client component and imports
 * these types, so nothing here may reach for the service-role Supabase client.
 * The query lives in opening-exceptions-query.ts.
 */

export type OpeningExceptionTone = 'danger' | 'warning' | 'info';

export type OpeningExceptionChip = {
  /** Short enough for a ~110px rota grid column. */
  label: string;
  tone: OpeningExceptionTone;
};

export type RotaOpeningException = {
  date: string;
  /** Worst tone across the day's chips, used to colour the summary banner. */
  tone: OpeningExceptionTone;
  chips: OpeningExceptionChip[];
  /** Full sentences for the banner above the grid, where there is room to read. */
  details: string[];
  note: string | null;
};

export type RegularHoursRow = {
  day_of_week: number;
  opens: string | null;
  closes: string | null;
  kitchen_opens: string | null;
  kitchen_closes: string | null;
  is_closed: boolean | null;
  is_kitchen_closed: boolean | null;
};

export type SpecialHoursRow = {
  date: string;
  opens: string | null;
  closes: string | null;
  kitchen_opens: string | null;
  kitchen_closes: string | null;
  is_closed: boolean | null;
  is_kitchen_closed: boolean | null;
  note: string | null;
};

const TONE_RANK: Record<OpeningExceptionTone, number> = { info: 0, warning: 1, danger: 2 };

/** Postgres returns time columns as HH:MM:SS. Trim to HH:MM so comparisons are stable. */
function normaliseTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const [hours, minutes] = value.split(':');
  if (hours === undefined || minutes === undefined) return null;
  const parsed = `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
  return /^\d{2}:\d{2}$/.test(parsed) ? parsed : null;
}

function minutesOf(time: string | null): number | null {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

/**
 * Closing time in minutes, measured from the same midnight as the opening time.
 * A close at or before the open runs past midnight (Halloween closes at 00:00),
 * so it gains a day. Without this a midnight close reads as "closes early".
 */
function closingMinutes(opens: string | null, closes: string | null): number | null {
  const open = minutesOf(opens);
  const close = minutesOf(closes);
  if (close === null) return null;
  if (open !== null && close <= open) return close + 24 * 60;
  return close;
}

/** -1, 0 or 1. Returns 0 when either side is unknown so we never claim a direction we cannot prove. */
function compareMinutes(a: number | null, b: number | null): number {
  if (a === null || b === null) return 0;
  if (a === b) return 0;
  return a > b ? 1 : -1;
}

/**
 * No kitchen window means no kitchen service, whatever the flag says. Several
 * live rows have is_kitchen_closed false with both kitchen times null (for
 * example the May Day row noted "kitchen closed for the day").
 */
function kitchenIsClosed(row: {
  kitchen_opens: string | null;
  kitchen_closes: string | null;
  is_kitchen_closed: boolean | null;
}): boolean {
  if (row.is_kitchen_closed) return true;
  return normaliseTime(row.kitchen_opens) === null || normaliseTime(row.kitchen_closes) === null;
}

function formatSpan(opens: string | null, closes: string | null, joiner: string): string {
  if (!opens && !closes) return 'times not set';
  return `${formatTime12Hour(opens)}${joiner}${formatTime12Hour(closes)}`;
}

function worstTone(chips: OpeningExceptionChip[]): OpeningExceptionTone {
  return chips.reduce<OpeningExceptionTone>(
    (worst, chip) => (TONE_RANK[chip.tone] > TONE_RANK[worst] ? chip.tone : worst),
    'info',
  );
}

/**
 * Turns one special_hours row into something a planner can act on, or null when
 * the row says nothing the regular week does not already say.
 */
export function describeOpeningException(
  special: SpecialHoursRow,
  regular: RegularHoursRow | undefined,
): RotaOpeningException | null {
  const note = special.note?.trim() ? special.note.trim() : null;

  // A full closure overrides everything else: nobody should be rostered at all.
  if (special.is_closed) {
    const chips: OpeningExceptionChip[] = [{ label: 'Closed all day', tone: 'danger' }];
    return {
      date: special.date,
      tone: 'danger',
      chips,
      details: ['Closed all day, so no shifts should be planned.'],
      note,
    };
  }

  const chips: OpeningExceptionChip[] = [];
  const details: string[] = [];

  const opens = normaliseTime(special.opens);
  const closes = normaliseTime(special.closes);
  const regularOpens = normaliseTime(regular?.opens ?? null);
  const regularCloses = normaliseTime(regular?.closes ?? null);
  const regularClosedAllDay = Boolean(regular?.is_closed);

  // Missing regular row means we cannot prove the day is normal, so show it all.
  const barDiffers = !regular || regularClosedAllDay || opens !== regularOpens || closes !== regularCloses;
  if (barDiffers) {
    const opensLater = compareMinutes(minutesOf(opens), minutesOf(regularOpens)) > 0;
    const closesEarlier =
      compareMinutes(closingMinutes(opens, closes), closingMinutes(regularOpens, regularCloses)) < 0;
    // A shorter trading day is the risky direction for a rota already planned.
    const shorterDay = !regularClosedAllDay && (opensLater || closesEarlier);

    chips.push({ label: `Bar ${formatSpan(opens, closes, '-')}`, tone: shorterDay ? 'warning' : 'info' });

    const usual = !regular
      ? ''
      : regularClosedAllDay
        ? ' (usually closed all day)'
        : ` (usually ${formatSpan(regularOpens, regularCloses, ' to ')})`;
    const direction =
      opensLater && closesEarlier
        ? ' Opens later and closes earlier than usual.'
        : opensLater
          ? ' Opens later than usual.'
          : closesEarlier
            ? ' Closes earlier than usual.'
            : '';
    details.push(`Bar open ${formatSpan(opens, closes, ' to ')}${usual}.${direction}`);
  }

  const kitchenOpens = normaliseTime(special.kitchen_opens);
  const kitchenCloses = normaliseTime(special.kitchen_closes);
  const regularKitchenOpens = normaliseTime(regular?.kitchen_opens ?? null);
  const regularKitchenCloses = normaliseTime(regular?.kitchen_closes ?? null);
  const kitchenClosed = kitchenIsClosed(special);
  // Mondays have no kitchen every week, so an unchanged closed kitchen is not news.
  const regularKitchenClosed = regular ? kitchenIsClosed(regular) : false;

  if (kitchenClosed && !regularKitchenClosed) {
    chips.push({ label: 'Kitchen closed', tone: 'warning' });
    const usual = regular ? ` (usually ${formatSpan(regularKitchenOpens, regularKitchenCloses, ' to ')})` : '';
    details.push(`Kitchen closed all day${usual}, so no kitchen shifts are needed.`);
  } else if (!kitchenClosed && regularKitchenClosed) {
    chips.push({ label: `Kitchen ${formatSpan(kitchenOpens, kitchenCloses, '-')}`, tone: 'info' });
    details.push(`Kitchen open ${formatSpan(kitchenOpens, kitchenCloses, ' to ')} (usually closed), so it needs cover.`);
  } else if (
    !kitchenClosed &&
    (!regular || kitchenOpens !== regularKitchenOpens || kitchenCloses !== regularKitchenCloses)
  ) {
    const kitchenOpensLater = compareMinutes(minutesOf(kitchenOpens), minutesOf(regularKitchenOpens)) > 0;
    const kitchenClosesEarlier =
      compareMinutes(
        closingMinutes(kitchenOpens, kitchenCloses),
        closingMinutes(regularKitchenOpens, regularKitchenCloses),
      ) < 0;
    const shorterService = kitchenOpensLater || kitchenClosesEarlier;

    chips.push({
      label: `Kitchen ${formatSpan(kitchenOpens, kitchenCloses, '-')}`,
      tone: shorterService ? 'warning' : 'info',
    });

    const usual = regular ? ` (usually ${formatSpan(regularKitchenOpens, regularKitchenCloses, ' to ')})` : '';
    const direction =
      kitchenOpensLater && kitchenClosesEarlier
        ? ' Opens later and closes earlier than usual.'
        : kitchenOpensLater
          ? ' Opens later than usual.'
          : kitchenClosesEarlier
            ? ' Closes earlier than usual.'
            : '';
    details.push(`Kitchen ${formatSpan(kitchenOpens, kitchenCloses, ' to ')}${usual}.${direction}`);
  }

  // Nothing differs and no reason recorded: the row restates the regular week.
  if (chips.length === 0 && !note) return null;

  return { date: special.date, tone: worstTone(chips), chips, details, note };
}

/**
 * Keys the exceptions by ISO date so the grid can look a day up directly.
 */
/**
 * Look up the regular row for a date by weekday alone.
 *
 * Only correct while a single set of weekly hours exists, which is why
 * buildOpeningExceptions takes a lookup rather than an array: production passes
 * a version-aware one, because the same weekday can have different hours either
 * side of a scheduled change.
 */
export function byWeekday(
  regularRows: RegularHoursRow[],
): (isoDate: string) => RegularHoursRow | undefined {
  const byDay = new Map(regularRows.map(row => [row.day_of_week, row]));
  // Parse as UTC: London is UTC+1 in summer and a local parse on a UTC server
  // lands on the previous day, which would pick the wrong weekday row.
  return isoDate => byDay.get(new Date(`${isoDate}T00:00:00Z`).getUTCDay());
}

export function buildOpeningExceptions(
  specialRows: SpecialHoursRow[],
  regularForDate: (isoDate: string) => RegularHoursRow | undefined,
): Record<string, RotaOpeningException> {
  const result: Record<string, RotaOpeningException> = {};

  for (const row of specialRows) {
    if (!row.date) continue;
    const exception = describeOpeningException(row, regularForDate(row.date));
    if (exception) result[row.date] = exception;
  }

  return result;
}
