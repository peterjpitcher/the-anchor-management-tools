import { getTodayIsoDate } from '@/lib/dateUtils';
import { countRequestDays } from '@/lib/leave/working-days';

/**
 * Rules for the "time off already booked" step in employee onboarding.
 *
 * The screen's date pickers, the client side check and the server validation are all generated
 * from the constants here, so the question a new starter is asked and the answer the server
 * will accept cannot drift apart. The original review flagged exactly that: the question said
 * "before you start" while the validation rejected anything before the employment start date.
 */

/** Nobody is asked about dates further out than this. */
export const MAX_MONTHS_AHEAD = 12;
/** A typo guard. Longer genuine unavailability is recorded by a manager after they start. */
export const MAX_DAYS_PER_BLOCK = 60;
export const MAX_BLOCKS = 10;
export const MAX_TOTAL_DAYS = 200;
export const MAX_NOTE_LENGTH = 200;

export type TimeOffAnswer = 'has_dates' | 'none';

export type TimeOffBlock = {
  startDate: string;
  endDate: string;
  leaveType: string;
  note?: string | null;
};

export const TIME_OFF_ERRORS = {
  TIME_OFF_INVALID_RANGE: 'Check these dates: the last day needs to be on or after the first day.',
  TIME_OFF_IN_PAST: 'These dates have already passed. Please enter dates from today onwards.',
  TIME_OFF_TOO_FAR_AHEAD: `We can only take dates up to ${MAX_MONTHS_AHEAD} months ahead for now. Tell your manager about anything later.`,
  TIME_OFF_TOO_LONG: `Each block can be up to ${MAX_DAYS_PER_BLOCK} days. Please split a longer break, or tell your manager.`,
  TIME_OFF_TOO_MANY: `You can add up to ${MAX_BLOCKS} blocks here. Tell your manager about anything else.`,
  TIME_OFF_TOTAL_TOO_LONG: `That comes to more than ${MAX_TOTAL_DAYS} days in total. Please check the dates.`,
  TIME_OFF_OVERLAP: 'These dates overlap another block you have already added.',
  TIME_OFF_UNKNOWN_TYPE: 'Please choose what this time off is.',
  TIME_OFF_NOTE_TOO_LONG: `Please keep the note under ${MAX_NOTE_LENGTH} characters.`,
  TIME_OFF_SHIFT_CLASH: 'You are already on the rota for one of these dates. Please speak to your manager.',
  TIME_OFF_TOKEN_EXPIRED: 'Your invite link has expired. Ask your manager for a new one.',
} as const;

export type TimeOffErrorCode = keyof typeof TIME_OFF_ERRORS;

/** Inclusive date bounds the step accepts. Used for the input min and max, and on the server. */
export function getTimeOffDateBounds(today: string = getTodayIsoDate()): {
  minDate: string;
  maxDate: string;
} {
  const max = new Date(`${today}T00:00:00Z`);
  max.setUTCMonth(max.getUTCMonth() + MAX_MONTHS_AHEAD);
  return { minDate: today, maxDate: max.toISOString().slice(0, 10) };
}

/**
 * Validate the whole submission. Returns the first problem found, or null.
 *
 * All or nothing on purpose: if one of ten blocks is wrong the whole submission is refused and
 * nothing is written, so a new starter never ends up with half their dates in the rota.
 */
export function validateTimeOffBlocks(
  blocks: readonly TimeOffBlock[],
  options: { allowedTypes: ReadonlySet<string>; today?: string },
): { code: TimeOffErrorCode; blockIndex: number } | null {
  const today = options.today ?? getTodayIsoDate();
  const { minDate, maxDate } = getTimeOffDateBounds(today);

  if (blocks.length > MAX_BLOCKS) {
    return { code: 'TIME_OFF_TOO_MANY', blockIndex: MAX_BLOCKS };
  }

  let totalDays = 0;

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];

    if (!block.startDate || !block.endDate || block.endDate < block.startDate) {
      return { code: 'TIME_OFF_INVALID_RANGE', blockIndex: index };
    }
    if (block.startDate < minDate) {
      return { code: 'TIME_OFF_IN_PAST', blockIndex: index };
    }
    if (block.endDate > maxDate) {
      return { code: 'TIME_OFF_TOO_FAR_AHEAD', blockIndex: index };
    }
    if (!options.allowedTypes.has(block.leaveType)) {
      return { code: 'TIME_OFF_UNKNOWN_TYPE', blockIndex: index };
    }
    if ((block.note ?? '').length > MAX_NOTE_LENGTH) {
      return { code: 'TIME_OFF_NOTE_TOO_LONG', blockIndex: index };
    }

    const days = countRequestDays(block.startDate, block.endDate);
    if (days > MAX_DAYS_PER_BLOCK) {
      return { code: 'TIME_OFF_TOO_LONG', blockIndex: index };
    }
    totalDays += days;

    // Overlaps within the submission. Overlaps against rows already stored are caught in the
    // database, where the check and the insert share a lock.
    for (let other = 0; other < index; other += 1) {
      const previous = blocks[other];
      if (block.startDate <= previous.endDate && previous.startDate <= block.endDate) {
        return { code: 'TIME_OFF_OVERLAP', blockIndex: index };
      }
    }
  }

  if (totalDays > MAX_TOTAL_DAYS) {
    return { code: 'TIME_OFF_TOTAL_TOO_LONG', blockIndex: blocks.length - 1 };
  }

  return null;
}
