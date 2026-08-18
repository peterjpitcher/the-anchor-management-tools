import {
  getRemovedPublishedShifts,
  shiftIsUnpublished,
  type PublishedShiftSnapshot,
  type RotaPublishShift,
  type RotaPublishWeek,
} from '@/lib/rota/publish-status';

/**
 * One answer to "can staff actually see this week yet?", shared by the section
 * nav badge, the rota page banner, the Sunday manager cron and the manager email.
 *
 * Readiness is deliberately NOT derived from `rota_weeks.has_unpublished_changes`.
 * That flag is written by several shift actions in a second, unchecked call, so a
 * failed write leaves a dirty week looking clean. More importantly it is
 * structurally blind: it only ever marks a *changed published* week, so it cannot
 * see a draft week, a missing `rota_weeks` row, or the out-of-order hole where a
 * later week is published while an earlier one is still draft. Readiness is
 * therefore computed by diffing the live shifts against the published snapshot,
 * reusing the diff rules in `publish-status.ts`.
 *
 * Everything here is pure: callers read the rows and pass them in.
 */

export type RotaWeekReadinessState = 'missing' | 'draft' | 'published_stale' | 'published_current';

/** A week as readiness sees it. `missing` means `rota_weeks` has no row for it at all. */
export type RotaReadinessWeek = {
  weekStart: string;
  status: 'missing' | 'draft' | 'published';
  publishedAt: string | null;
};

export type RotaWeekReadiness = {
  weekStart: string;
  state: RotaWeekReadinessState;
  /** Live shifts staff cannot see yet, either added or edited since the last publish. */
  unpublishedCount: number;
  /** Shifts still in the published snapshot that no longer exist live (ghost shifts). */
  removedCount: number;
  /** Plain English explanations, safe to show a manager or put in an email. */
  reasons: string[];
};

export type RotaWeekReadinessInput = {
  week: RotaReadinessWeek;
  liveShifts: RotaPublishShift[];
  publishedShifts: PublishedShiftSnapshot[];
};

export type RotaReadinessSummary = {
  weeksNeedingAttention: number;
  totalUnpublished: number;
  firstProblemWeekStart: string | null;
  byWeek: RotaWeekReadiness[];
};

/** A week that has never reached staff, used for counting on draft and missing weeks. */
const NEVER_PUBLISHED: RotaPublishWeek = { status: 'draft', published_at: null };

/** Maps a `rota_weeks` row (snake_case, possibly absent) onto the readiness shape. */
export function readinessWeekFromRow(
  weekStart: string,
  row: { status: string | null; published_at: string | null } | null | undefined,
): RotaReadinessWeek {
  if (!row) {
    return { weekStart, status: 'missing', publishedAt: null };
  }

  return {
    weekStart,
    status: row.status === 'published' ? 'published' : 'draft',
    publishedAt: row.published_at,
  };
}

export function outOfOrderPublishReason(laterPublishedWeekStart: string): string {
  return `Week beginning ${laterPublishedWeekStart} is already published while this earlier week is not, so staff can see a week further ahead than one they cannot see at all.`;
}

function shiftsAre(count: number): string {
  return count === 1 ? '1 shift is' : `${count} shifts are`;
}

function shiftsHave(count: number): string {
  return count === 1 ? '1 shift has' : `${count} shifts have`;
}

function countUnpublished(
  liveShifts: RotaPublishShift[],
  week: RotaPublishWeek,
  publishedShifts: PublishedShiftSnapshot[],
): number {
  const publishedShiftById = new Map(publishedShifts.map(shift => [shift.id, shift]));
  return liveShifts.filter(shift => shiftIsUnpublished(shift, week, publishedShiftById)).length;
}

export function getRotaWeekReadiness(
  week: RotaReadinessWeek,
  liveShifts: RotaPublishShift[],
  publishedShifts: PublishedShiftSnapshot[],
): RotaWeekReadiness {
  if (week.status === 'missing') {
    const unpublishedCount = countUnpublished(liveShifts, NEVER_PUBLISHED, publishedShifts);
    const reasons = ['There is no rota week record, so there is nothing to publish from.'];
    if (unpublishedCount > 0) {
      reasons.push(`${shiftsAre(unpublishedCount)} rostered for this week and no staff member can see any of them.`);
    }
    return { weekStart: week.weekStart, state: 'missing', unpublishedCount, removedCount: 0, reasons };
  }

  if (week.status === 'draft') {
    const unpublishedCount = countUnpublished(liveShifts, NEVER_PUBLISHED, publishedShifts);
    const reasons = ['The week is still a draft, so staff cannot see any of it.'];
    if (unpublishedCount > 0) {
      reasons.push(`${shiftsAre(unpublishedCount)} waiting to be published.`);
    } else {
      reasons.push('The week has no shifts on it yet.');
    }
    return { weekStart: week.weekStart, state: 'draft', unpublishedCount, removedCount: 0, reasons };
  }

  // Marked published but never actually sent. The snapshot diff cannot judge this
  // week (there is no publish time to diff against), so treat every live shift as
  // unseen rather than reporting a false all-clear.
  if (!week.publishedAt) {
    const unpublishedCount = countUnpublished(liveShifts, NEVER_PUBLISHED, publishedShifts);
    return {
      weekStart: week.weekStart,
      state: 'published_stale',
      unpublishedCount,
      removedCount: 0,
      reasons: ['The week is marked published but has no publish time, so it was never sent to staff.'],
    };
  }

  const publishedWeek: RotaPublishWeek = { status: 'published', published_at: week.publishedAt };
  const unpublishedCount = countUnpublished(liveShifts, publishedWeek, publishedShifts);
  const removedCount = getRemovedPublishedShifts(liveShifts, publishedWeek, publishedShifts).length;

  const reasons: string[] = [];
  if (unpublishedCount > 0) {
    reasons.push(`${shiftsHave(unpublishedCount)} been added or changed since the week was published.`);
  }
  if (removedCount > 0) {
    reasons.push(`${shiftsHave(removedCount)} been deleted since the week was published, so staff can still see ${removedCount === 1 ? 'it' : 'them'}.`);
  }

  return {
    weekStart: week.weekStart,
    state: reasons.length > 0 ? 'published_stale' : 'published_current',
    unpublishedCount,
    removedCount,
    reasons,
  };
}

/**
 * Readiness across the planning horizon. Weeks are sorted by start date and only
 * the first `horizonWeeks` of them are judged, so a caller can pass everything it
 * loaded and let the horizon do the trimming.
 *
 * The out-of-order gap is detected here rather than per week because it needs the
 * neighbours: any missing or draft week that sits before an already published week
 * gets an extra reason, which is the exact hole a per-week flag can never see.
 */
export function summariseRotaReadiness(
  weeks: RotaWeekReadinessInput[],
  horizonWeeks: number,
): RotaReadinessSummary {
  const inHorizon = [...weeks]
    .sort((a, b) => a.week.weekStart.localeCompare(b.week.weekStart))
    .slice(0, Math.max(0, horizonWeeks));

  const byWeek = inHorizon.map(entry =>
    getRotaWeekReadiness(entry.week, entry.liveShifts, entry.publishedShifts),
  );

  let lastDeliveredIndex = -1;
  for (let index = inHorizon.length - 1; index >= 0; index -= 1) {
    const week = inHorizon[index].week;
    if (week.status === 'published' && week.publishedAt) {
      lastDeliveredIndex = index;
      break;
    }
  }

  if (lastDeliveredIndex > 0) {
    const laterWeekStart = inHorizon[lastDeliveredIndex].week.weekStart;
    for (let index = 0; index < lastDeliveredIndex; index += 1) {
      const readiness = byWeek[index];
      if (readiness.state === 'missing' || readiness.state === 'draft') {
        byWeek[index] = {
          ...readiness,
          reasons: [...readiness.reasons, outOfOrderPublishReason(laterWeekStart)],
        };
      }
    }
  }

  const needingAttention = byWeek.filter(readiness => readiness.state !== 'published_current');

  return {
    weeksNeedingAttention: needingAttention.length,
    totalUnpublished: byWeek.reduce((total, readiness) => total + readiness.unpublishedCount, 0),
    firstProblemWeekStart: needingAttention[0]?.weekStart ?? null,
    byWeek,
  };
}
