/**
 * The nightly pre-order report. Spec sections 4.1 and 7.
 *
 * Two checks, one email, one cron:
 *
 * 1. SEAT DRIFT. Cover count must equal party size, and section 4.1 deliberately enforces that in the
 *    server action rather than a database trigger, because a deferred constraint trigger breaks all
 *    four live party-size writers. The price of that choice is that a writer which forgets to call
 *    `preorder_sync_covers` leaves a booking quietly out of step, so something has to look. This is
 *    that something. Reporting a drift beats refusing a booking.
 * 2. WITHDRAWN DISHES. A manager who deactivates an item leaves live orders pointing at food the
 *    kitchen will not cook. Section 7 is explicit that this is a short call list for a manager and
 *    never a mass re-message to every Christmas booker, so it lands here and nowhere else.
 *
 * SILENCE WHEN ALL IS WELL. Nothing is sent unless there is something to act on. A nightly email that
 * is almost always empty gets filtered, and then the one that matters is filtered with it.
 *
 * Carries no dietary notes and no per-cover guest names, matching the escalation email in
 * preorder-reminders. Section 8 keeps that information on permission-gated staff and kitchen screens.
 * Seat numbers say enough for somebody to pick up the telephone.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { escapeHtml, reportCronFailure } from '@/lib/cron/alerting'
import { sendEmail } from '@/lib/email/emailService'
import {
  findWithdrawnPreorderChoices,
  isPreorderEnabled,
  type WithdrawnPreorderChoice,
} from '@/lib/table-bookings/preorder'
import { formatDateWithTimeForSms, getTodayIsoDate } from '@/lib/dateUtils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const REPORT_EMAIL = 'manager@the-anchor.pub'
/**
 * Deliberately WIDER than the reminder sweep, which chases confirmed bookings only.
 *
 * The difference is who receives the output. That one texts a guest, so an unpaid booking must be left
 * alone until it is secured. This one tells a manager what is drifting, and a manager wants the unpaid
 * ones in view too: a seat count that disagrees with its party size is worth knowing about whether or
 * not the deposit has landed, and nothing here costs a message.
 *
 * So do not "tidy" these two lists into agreement. They answer different questions.
 */
const DEAD_BOOKING_STATUSES = ['cancelled', 'no_show']
/** A season's worth of Christmas bookings is a few hundred; the cap is a runaway guard, not a page size. */
const MAX_BOOKINGS_PER_RUN = 500

type SeasonalBooking = {
  id: string
  booking_reference: string
  booking_date: string
  booking_time: string | null
  party_size: number | null
  booking_period_name: string | null
}

type SeatDrift = {
  bookingReference: string
  bookingMoment: string
  periodName: string
  partySize: number
  coverCount: number
}

type WithdrawnGroup = {
  bookingReference: string
  bookingDate: string
  choices: WithdrawnPreorderChoice[]
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  try {
    if (!(await isPreorderEnabled(supabase))) {
      return NextResponse.json({ success: true, skipped: true, reason: 'preorder_disabled' })
    }

    const today = getTodayIsoDate()

    const [drift, withdrawn] = await Promise.all([
      findSeatDrift(supabase, today),
      findWithdrawnPreorderChoices(supabase, { fromDate: today }),
    ])

    const withdrawnGroups = groupWithdrawnByBooking(withdrawn)

    const result = {
      driftBookings: drift.length,
      withdrawnBookings: withdrawnGroups.length,
      withdrawnChoices: withdrawn.length,
      emailed: false,
    }

    if (drift.length > 0 || withdrawnGroups.length > 0) {
      await sendReport(drift, withdrawnGroups)
      result.emailed = true
    }

    logger.info('Pre-order nightly report completed', { metadata: { ...result, from: today } })

    return NextResponse.json({ success: true, result, from: today })
  } catch (error) {
    logger.error('Pre-order nightly report failed', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    await reportCronFailure('preorder-reports', error)
    return NextResponse.json({ success: false, error: 'Pre-order nightly report failed' }, { status: 500 })
  }
}

/**
 * Future seasonal bookings whose seat rows no longer match the party size.
 *
 * A booking with NO covers is not drift. Covers are created on demand, when somebody first opens the
 * pre-order, so zero seats means the order has not been started yet. That is the reminder cron's job
 * to chase, and reporting it here nightly would bury the real drift under every new booking taken.
 */
async function findSeatDrift(
  supabase: ReturnType<typeof createAdminClient>,
  fromDate: string,
): Promise<SeatDrift[]> {
  const { data: bookingRows, error: bookingError } = await supabase
    .from('table_bookings')
    .select('id, booking_reference, booking_date, booking_time, party_size, booking_period_name')
    .gte('booking_date', fromDate)
    // Both halves matter, exactly as in the chase cron: the period may require a pre-order, but a
    // guest who answered "no, this is not a Christmas dinner" owes nobody a seat row.
    .eq('booking_period_requires_preorder', true)
    .eq('booking_period_answer', true)
    .not('status', 'in', `(${DEAD_BOOKING_STATUSES.join(',')})`)
    .order('booking_date', { ascending: true })
    .limit(MAX_BOOKINGS_PER_RUN)

  if (bookingError) throw bookingError

  const bookings = (bookingRows ?? []) as unknown as SeasonalBooking[]
  if (bookings.length === 0) return []

  const { data: coverRows, error: coverError } = await supabase
    .from('booking_preorder_covers')
    .select('id, table_booking_id')
    .in(
      'table_booking_id',
      bookings.map((booking) => booking.id),
    )

  if (coverError) throw coverError

  const coverCounts = new Map<string, number>()
  for (const row of (coverRows ?? []) as Array<{ id: string; table_booking_id: string }>) {
    coverCounts.set(row.table_booking_id, (coverCounts.get(row.table_booking_id) ?? 0) + 1)
  }

  const drift: SeatDrift[] = []
  for (const booking of bookings) {
    const coverCount = coverCounts.get(booking.id) ?? 0
    if (coverCount === 0) continue

    const partySize = booking.party_size ?? 0
    if (coverCount === partySize) continue

    drift.push({
      bookingReference: booking.booking_reference,
      bookingMoment: formatDateWithTimeForSms(booking.booking_date, booking.booking_time),
      periodName: booking.booking_period_name || 'Seasonal menu',
      partySize,
      coverCount,
    })
  }

  return drift
}

/** One block per booking, so a manager makes one telephone call rather than one per dish. */
function groupWithdrawnByBooking(choices: WithdrawnPreorderChoice[]): WithdrawnGroup[] {
  const groups = new Map<string, WithdrawnGroup>()

  for (const choice of choices) {
    const group = groups.get(choice.tableBookingId)
    if (group) {
      group.choices.push(choice)
    } else {
      groups.set(choice.tableBookingId, {
        bookingReference: choice.bookingReference,
        bookingDate: choice.bookingDate,
        choices: [choice],
      })
    }
  }

  // findWithdrawnPreorderChoices already returns date then reference then seat order, so inserting in
  // that order is enough and the groups need no further sorting.
  return Array.from(groups.values())
}

async function sendReport(drift: SeatDrift[], withdrawn: WithdrawnGroup[]): Promise<void> {
  const sections: string[] = []

  if (drift.length > 0) {
    sections.push(
      '<h3>Seat numbers that do not match the party size</h3>',
      '<p>Open the booking in the management tools and use the button that sets up the pre-order ' +
        'seats. It adds or removes seats to match, dropping the highest numbers first.</p>',
      '<ul>',
      ...drift.map(
        (row) =>
          `<li><strong>${escapeHtml(row.bookingReference)}</strong>, ${escapeHtml(row.bookingMoment)}, ` +
          `${escapeHtml(row.periodName)}: ${escapeHtml(String(row.coverCount))} seats set up for a ` +
          `party of ${escapeHtml(String(row.partySize))}.</li>`,
      ),
      '</ul>',
    )
  }

  if (withdrawn.length > 0) {
    sections.push(
      '<h3>Guests who have chosen a dish that is no longer on the menu</h3>',
      '<p>Ring these guests and take a new choice. Nothing has been changed for them automatically.</p>',
      '<ul>',
      ...withdrawn.map((group) => {
        const lines = group.choices
          .map(
            (choice) =>
              `seat ${escapeHtml(String(choice.ordinal))} ${escapeHtml(choice.course)} ` +
              `(${escapeHtml(choice.itemName)})`,
          )
          .join(', ')
        return (
          `<li><strong>${escapeHtml(group.bookingReference)}</strong>, ` +
          `${escapeHtml(group.bookingDate)}: ${lines}.</li>`
        )
      }),
      '</ul>',
    )
  }

  const html = [
    '<p>The nightly pre-order check has found something to look at.</p>',
    ...sections,
    '<p>You only get this email when there is something on it.</p>',
  ].join('')

  const parts: string[] = []
  if (drift.length > 0) parts.push(`${drift.length} with the wrong number of seats`)
  if (withdrawn.length > 0) parts.push(`${withdrawn.length} with a withdrawn dish`)

  const emailResult = await sendEmail({
    to: REPORT_EMAIL,
    subject: `Pre-order check: ${parts.join(' and ')}`,
    html,
  })

  if (!emailResult.success) {
    throw new Error(emailResult.error || 'Failed to send the nightly pre-order report')
  }
}
