/**
 * Which unapproved holiday requests deserve a nudge, and which kind.
 *
 * Kept as a pure function so the rules can be tested against fixed dates. The cron route does the
 * fetching, the sending and the ledger writes; everything decidable lives here.
 *
 * Two kinds, deliberately:
 *
 *   waiting   nobody has looked at this in a while
 *   imminent  the leave itself is close and still is not approved
 *
 * They are separate because they mean different things to a manager. One is admin drift, the
 * other is about to become a rota problem. A request can raise both, in which case both are sent
 * once each, never twice.
 */

export const WAITING_AFTER_DAYS = 3;
export const IMMINENT_WITHIN_DAYS = 21;
export const MAX_REMINDERS_PER_RUN = 50;

export type ReminderKind = 'waiting' | 'imminent';

export type PendingRequest = {
  id: string;
  employee_id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  status: string;
  leave_origin?: string | null;
};

export type DueReminder = {
  requestId: string;
  kind: ReminderKind;
  daysWaiting: number;
  daysUntilStart: number;
};

/** Whole days between two ISO dates, positive when the second is later. */
export function daysBetweenIso(fromIso: string, toIso: string): number {
  const from = Date.UTC(
    Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)),
  );
  return Math.round((to - from) / 86_400_000);
}

/**
 * @param requests   every pending request
 * @param alreadySent set of `${requestId}:${kind}` already in the ledger
 * @param todayIso   today in Europe/London, so a run just after midnight does not slip a day
 */
export function selectDueReminders(
  requests: readonly PendingRequest[],
  alreadySent: ReadonlySet<string>,
  todayIso: string,
): DueReminder[] {
  const due: DueReminder[] = [];

  for (const request of requests) {
    if (request.status !== 'pending') continue;

    // Holiday agreed when someone was hired is written already approved, so it never reaches
    // this queue. Guarded anyway: nagging a manager to approve something nobody asked them to
    // approve is exactly the noise that gets a reminder job muted.
    if (request.leave_origin === 'agreed_at_hire') continue;

    const daysWaiting = daysBetweenIso(request.created_at.slice(0, 10), todayIso);
    const daysUntilStart = daysBetweenIso(todayIso, request.start_date);

    const kinds: ReminderKind[] = [];
    if (daysWaiting >= WAITING_AFTER_DAYS) kinds.push('waiting');
    if (daysUntilStart <= IMMINENT_WITHIN_DAYS) kinds.push('imminent');

    for (const kind of kinds) {
      if (alreadySent.has(`${request.id}:${kind}`)) continue;
      due.push({ requestId: request.id, kind, daysWaiting, daysUntilStart });
    }
  }

  // Closest to starting first, so a truncated run deals with the most urgent.
  due.sort((a, b) => a.daysUntilStart - b.daysUntilStart);
  return due.slice(0, MAX_REMINDERS_PER_RUN);
}

/** True when the run had to stop short, so the route can say so rather than look complete. */
export function wasTruncated(dueCount: number): boolean {
  return dueCount >= MAX_REMINDERS_PER_RUN;
}
