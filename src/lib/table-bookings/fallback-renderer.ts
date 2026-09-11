import type { createAdminClient } from '@/lib/supabase/admin'
import type { GuestShortLinkKind } from '@/lib/guest/guest-short-link'
import { buildShortLinkUrl } from '@/lib/short-links/base-url'
import { getSmartFirstName } from '@/lib/sms/name-utils'
import { isChristmasBookingType } from '@/lib/table-bookings/christmas'
import { getPreorderCompleteness, getPreorderCutoff, loadPreorderOrder } from '@/lib/table-bookings/preorder'
import { resolveTableBookingGuestSmsTo } from '@/lib/table-bookings/guest-notify'
import {
  buildConfirmReminderText,
  buildDepositConfirmedText,
  buildPartySizeDepositText,
  buildPreorderReminderText,
  buildTableBookingCancelledText,
  describePartySizeDeposit,
} from '@/lib/table-bookings/guest-texts'
import {
  cancellationFacts,
  confirmReminderFacts,
  depositConfirmedFacts,
  isAwaitingTableDeposit,
  isoInstant,
  partySizeDepositRequestFacts,
  preorderReminderFacts,
  readTableBookingDeliveryMetadata,
  refundResultFromFacts,
  tableBookingStartsAt,
  TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS,
  type TableBookingFallbackLink,
  type TableBookingFallbackMessage,
} from '@/lib/table-bookings/fallback-details'
import type {
  DelayedFallbackRenderer,
  FallbackBookingFacts,
  FallbackSkipCheck,
  FallbackValidUntil,
} from '@/lib/notifications/delayed-fallback/types'

/**
 * Rebuilds a bounced table booking email as the text it replaced (P4 with P3 and P5).
 *
 * The delivery row, written by notifyTableBookingGuestEmailFirst when the message went, names the
 * booking, the message, the facts it stated and how its link was made. The text is rebuilt from
 * the booking as it is now, with the builder the sender uses (guest-texts.ts), and goes to the
 * number the sender would have texted. Whether it is still true (cancelled or not, started,
 * changed, or landing after the deadline its words name) is decided by the job, with the same
 * rules as every other booking type. A message whose purpose has been met since (the deposit paid,
 * the guest answered, the food choices in) comes back as no longer needed.
 *
 * LINKS ARE FOUND, NEVER MADE. A text that carries a link reuses the short link the email carried:
 * the newest short link of that kind for this booking and guest created no later than the
 * delivery row, and only while the token behind it is live. Finding it only reads. Nothing here
 * creates a token, a short link or a payment session, because each of those is a side effect the
 * guest never asked for, and a payment session is money. When the link cannot be found that way
 * the text is not sent, and the job reports why.
 */

type AdminClient = ReturnType<typeof createAdminClient>

/** The table_bookings fields the rebuilt texts read. The row is read with `*`, as the senders read it. */
type FallbackTableBooking = {
  id: string
  customer_id: string | null
  status: string | null
  payment_status: string | null
  booking_reference: string | null
  booking_date: string | null
  booking_time: string | null
  start_datetime: string | null
  party_size: number | null
  booking_type: string | null
  is_outside_seating: boolean | null
  high_chair_count: number | null
  christmas_course_counts?: number[] | null
  deposit_amount: number | string | null
  hold_expires_at: string | null
  guest_confirmed_at: string | null
}

type FallbackCustomer = {
  id: string
  first_name: string | null
  mobile_e164: string | null
  mobile_number: string | null
}

/** The short_links columns read to find the email's link. */
type ShortLinkRow = {
  short_code: string | null
  expires_at: string | null
  metadata: { guest_token_hash?: unknown } | null
}

/** The guest_tokens columns that say whether the link still works for this booking and guest. */
type GuestTokenRow = {
  table_booking_id: string | null
  customer_id: string | null
  action_type: string | null
  expires_at: string | null
  consumed_at: string | null
}

type MessageContext = {
  client: AdminClient
  booking: FallbackTableBooking
  customer: FallbackCustomer
  storedFacts: Record<string, unknown> | null
  now: Date
}

/** What a message's rules make of the booking as it is now. */
type Assessment = {
  /** The facts the message states, compared with the ones stored with the email. */
  facts: FallbackBookingFacts
  /** When the text's words stop being true; null when they hold until the booking starts. */
  validUntil: FallbackValidUntil
  /** What the message asked for has happened since (paid, answered, chosen): nothing to send. */
  noLongerNeeded: boolean
}

type MessageSpec = {
  /**
   * The link the message carries, and the token that must still be live behind it. `doneWhenUsed`:
   * using the link is itself the answer the message asks for (paying, confirming), so a used link
   * means the message is no longer needed rather than that the text cannot be rebuilt.
   */
  link: { kind: GuestShortLinkKind; tokenAction: string; optional: boolean; doneWhenUsed: boolean } | null
  /** Which of the customer's two mobile fields the sender names first. Both hold the same phone. */
  mobileFirst: 'mobile_number' | 'mobile_e164'
  expectCancelled: boolean
  assess: (ctx: Omit<MessageContext, 'customer'>) => Assessment | Promise<Assessment>
  /** The text, or null when something it states cannot be read. */
  text: (ctx: MessageContext, link: string | null) => string | null
  /** Extra metadata the sender puts on the text; table_booking_id is always added. */
  smsMetadata: (booking: FallbackTableBooking) => Record<string, unknown>
}

/**
 * Where the booker's food choices stand, by the conditions the pre-order sweep checks before it
 * chases. `outstanding`: owed on a form that is still open. `settled`: nothing is owed any more
 * (every choice is in, or the booking no longer needs a pre-order). `closesAt`: when the form locks.
 */
async function readFoodChoices(
  client: AdminClient,
  booking: FallbackTableBooking,
  now: Date
): Promise<{ outstanding: boolean; settled: boolean; closesAt: string | null }> {
  const order = await loadPreorderOrder(client, booking.id)
  if (!order || !order.requiresPreorder) return { outstanding: false, settled: true, closesAt: null }
  const cutoff = getPreorderCutoff({ bookingDate: order.bookingDate, preorderCutoffDays: order.preorderCutoffDays, now })
  const closesAt = cutoff.closesAt ? cutoff.closesAt.toISOString() : null
  if (getPreorderCompleteness(order).complete) return { outstanding: false, settled: true, closesAt }
  return { outstanding: !cutoff.closed, settled: false, closesAt }
}

const MESSAGE_SPECS: Record<TableBookingFallbackMessage, MessageSpec> = {
  // sendTableBookingCancelledEmailFirst in bookings.ts
  cancellation: {
    link: null,
    mobileFirst: 'mobile_number',
    expectCancelled: true,
    assess: ({ booking, storedFacts }) => {
      const refundResult = refundResultFromFacts(storedFacts)
      return {
        facts: refundResult
          ? cancellationFacts({ bookingDate: booking.booking_date, refundResult })
          : { booking_date: booking.booking_date ?? null },
        validUntil: null,
        noLongerNeeded: false,
      }
    },
    text: ({ booking, customer, storedFacts }) => {
      // The refund outcome is not on the booking; the facts stored with the email are the record.
      const refundResult = refundResultFromFacts(storedFacts)
      if (!refundResult || !booking.booking_date) return null
      return buildTableBookingCancelledText({
        firstName: getSmartFirstName(customer.first_name),
        bookingDate: booking.booking_date,
        refundResult,
      })
    },
    smsMetadata: (booking) => ({ booking_reference: booking.booking_reference || booking.id }),
  },

  // sendTableBookingDepositConfirmedEmailFirst in bookings.ts
  deposit_confirmed: {
    link: { kind: 'table_manage', tokenAction: 'manage', optional: true, doneWhenUsed: false },
    mobileFirst: 'mobile_number',
    expectCancelled: false,
    assess: ({ booking }) => ({ facts: depositConfirmedFacts(booking), validUntil: null, noLongerNeeded: false }),
    text: ({ booking, customer }, link) =>
      buildDepositConfirmedText({ booking, firstName: getSmartFirstName(customer.first_name), manageLink: link }),
    smsMetadata: () => ({}),
  },

  // sendPartySizeDepositRequestEmailFirst in staff-deposit-transitions.ts
  party_size_deposit_request: {
    link: { kind: 'table_payment', tokenAction: 'payment', optional: false, doneWhenUsed: true },
    mobileFirst: 'mobile_e164',
    expectCancelled: false,
    assess: ({ booking }) => ({
      facts: partySizeDepositRequestFacts({
        partySize: booking.party_size,
        depositAmount: booking.deposit_amount,
        holdExpiresAt: booking.hold_expires_at,
        awaitingPayment: isAwaitingTableDeposit(booking),
      }),
      // "Pay now" holds only while the payment link does, and the link runs out with the hold.
      validUntil: isoInstant(booking.hold_expires_at),
      // Paid, or the deposit cleared since: there is nothing left to ask for.
      noLongerNeeded: !isAwaitingTableDeposit(booking),
    }),
    text: ({ booking, customer }, link) => {
      const partySize = Number(booking.party_size)
      const depositAmount = Number(booking.deposit_amount)
      // Never a request for nothing: a GBP 0 text is refused even if the booking still reads as owing.
      if (!link || !Number.isFinite(partySize) || partySize <= 0 || !Number.isFinite(depositAmount) || depositAmount <= 0) {
        return null
      }
      const wording = describePartySizeDeposit({
        newPartySize: partySize,
        depositAmount,
        isChristmas: isChristmasBookingType(booking.booking_type),
        bookingType: booking.booking_type,
      })
      return buildPartySizeDepositText({ firstName: getSmartFirstName(customer.first_name), wording, paymentUrl: link })
    },
    smsMetadata: () => ({ trigger: 'party_size_threshold_crossed' }),
  },

  // sendConfirmReminderEmailFirst in app/api/cron/table-booking-confirm/route.ts
  confirm_reminder: {
    link: { kind: 'booking_confirm', tokenAction: 'booking_confirm', optional: false, doneWhenUsed: true },
    mobileFirst: 'mobile_e164',
    expectCancelled: false,
    assess: ({ booking }) => ({
      facts: confirmReminderFacts(booking),
      // The text names the day and time ("your table for 4 is Saturday 24 October at 7pm"), never
      // "tomorrow", so it holds until the booking starts. If it ever says tomorrow, this must become
      // the start of the booking's London day (a test pins the wording).
      validUntil: tableBookingStartsAt(booking),
      // The guest has answered since: the question is settled.
      noLongerNeeded: Boolean(booking.guest_confirmed_at),
    }),
    text: ({ booking, customer }, link) =>
      link && booking.booking_date
        ? buildConfirmReminderText({
            firstName: customer.first_name,
            bookingDate: booking.booking_date,
            bookingTime: booking.booking_time,
            partySize: booking.party_size,
            confirmUrl: link,
          })
        : null,
    smsMetadata: () => ({}),
  },

  // sendBookerReminderEmailFirst in app/api/cron/preorder-reminders/route.ts
  preorder_reminder: {
    link: { kind: 'table_manage', tokenAction: 'manage', optional: false, doneWhenUsed: false },
    mobileFirst: 'mobile_e164',
    expectCancelled: false,
    assess: async ({ client, booking, now }) => {
      const choices = await readFoodChoices(client, booking, now)
      return {
        facts: preorderReminderFacts({
          bookingDate: booking.booking_date,
          bookingTime: booking.booking_time,
          choicesOutstanding: choices.outstanding,
        }),
        // "Choose here" holds only while the form is open: it locks at the pre-order cut-off.
        validUntil: choices.closesAt,
        noLongerNeeded: choices.settled,
      }
    },
    text: ({ booking, customer }, link) =>
      link && booking.booking_date
        ? buildPreorderReminderText({
            firstName: getSmartFirstName(customer.first_name),
            bookingDate: booking.booking_date,
            bookingTime: booking.booking_time,
            manageLink: link,
          })
        : null,
    smsMetadata: () => ({}),
  },
}

const TEMPLATE_KEYS = new Set(Object.values(TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS))

type LinkLookup =
  | { ok: true; url: string | null }
  | { ok: false; reason: 'link_not_found' | 'link_expired' | 'link_used' | 'link_not_rebuildable' }

/**
 * The short link the email carried, found without creating anything: the newest short link of
 * this kind for this booking and guest made no later than the delivery row, provided the token
 * behind it is still live for the same booking and guest.
 */
async function findEmailLink(input: {
  client: AdminClient
  link: NonNullable<MessageSpec['link']>
  form: TableBookingFallbackLink | null
  tableBookingId: string
  customerId: string
  deliveryCreatedAt: string | null
  now: Date
}): Promise<LinkLookup> {
  if (input.form === 'none') {
    return input.link.optional ? { ok: true, url: null } : { ok: false, reason: 'link_not_found' }
  }
  // A full-length link carries its raw token, which is never stored, so it cannot be made again.
  if (input.form !== 'short_link') {
    return { ok: false, reason: 'link_not_rebuildable' }
  }

  let query = input.client
    .from('short_links')
    .select('short_code, expires_at, metadata, created_at')
    .contains('metadata', {
      table_booking_id: input.tableBookingId,
      customer_id: input.customerId,
      guest_link_kind: input.link.kind,
    })
  if (input.deliveryCreatedAt) {
    query = query.lte('created_at', input.deliveryCreatedAt)
  }
  const { data: links, error: linkError } = await query.order('created_at', { ascending: false }).limit(1)
  if (linkError) {
    throw new Error(`Failed to look up the short link for table booking ${input.tableBookingId}: ${linkError.message}`)
  }

  const shortLink = (Array.isArray(links) ? links[0] : null) as ShortLinkRow | null
  const tokenHash = shortLink?.metadata?.guest_token_hash
  if (!shortLink?.short_code || typeof tokenHash !== 'string' || !tokenHash) {
    return { ok: false, reason: 'link_not_found' }
  }
  if (shortLink.expires_at && Date.parse(shortLink.expires_at) <= input.now.getTime()) {
    return { ok: false, reason: 'link_expired' }
  }

  const { data: tokenRow, error: tokenError } = await input.client
    .from('guest_tokens')
    .select('table_booking_id, customer_id, action_type, expires_at, consumed_at')
    .eq('hashed_token', tokenHash)
    .maybeSingle()
  if (tokenError) {
    throw new Error(`Failed to look up the link token for table booking ${input.tableBookingId}: ${tokenError.message}`)
  }
  const token = tokenRow as GuestTokenRow | null
  if (
    !token ||
    token.action_type !== input.link.tokenAction ||
    token.table_booking_id !== input.tableBookingId ||
    token.customer_id !== input.customerId
  ) {
    return { ok: false, reason: 'link_not_found' }
  }
  if (token.consumed_at) {
    return { ok: false, reason: 'link_used' }
  }
  const tokenExpiresAtMs = Date.parse(token.expires_at || '')
  if (!Number.isFinite(tokenExpiresAtMs) || tokenExpiresAtMs <= input.now.getTime()) {
    return { ok: false, reason: 'link_expired' }
  }

  return { ok: true, url: buildShortLinkUrl(shortLink.short_code) }
}

export const tableBookingFallbackRenderer: DelayedFallbackRenderer = {
  matches: (templateKey) => TEMPLATE_KEYS.has(templateKey),
  render: async ({ delivery, client, now }) => {
    const recorded = readTableBookingDeliveryMetadata(delivery.metadata)
    if (!recorded) {
      return { kind: 'unavailable', reason: 'booking_missing', booking: null }
    }

    const bookingRef = { type: 'table_booking' as const, id: recorded.tableBookingId }
    // The message must be one of ours and sent under its own key, so a different message that
    // shares a template key is never answered with this text.
    if (!recorded.message || TABLE_BOOKING_FALLBACK_TEMPLATE_KEYS[recorded.message] !== delivery.template_key) {
      return { kind: 'unavailable', reason: 'no_renderer', booking: bookingRef }
    }
    const spec = MESSAGE_SPECS[recorded.message]

    const { data: bookingRow, error: bookingError } = await client
      .from('table_bookings')
      .select('*')
      .eq('id', recorded.tableBookingId)
      .maybeSingle()
    if (bookingError) {
      throw new Error(`Failed to load table booking ${recorded.tableBookingId}: ${bookingError.message}`)
    }
    if (!bookingRow) {
      return { kind: 'unavailable', reason: 'booking_missing', booking: bookingRef }
    }
    const booking = bookingRow as FallbackTableBooking

    const assessment = await spec.assess({ client, booking, storedFacts: recorded.facts, now })
    const current: FallbackSkipCheck = {
      booking: {
        status: booking.status ?? null,
        startsAt: tableBookingStartsAt(booking),
        facts: assessment.facts,
      },
      expectCancelled: spec.expectCancelled,
      validUntil: assessment.validUntil,
    }

    if (assessment.noLongerNeeded) {
      return { kind: 'no_longer_needed', booking: bookingRef }
    }

    if (!recorded.facts) {
      return { kind: 'unavailable', reason: 'facts_missing', booking: bookingRef, current }
    }

    let customer: FallbackCustomer | null = null
    if (booking.customer_id) {
      const { data: customerRow, error: customerError } = await client
        .from('customers')
        .select('id, first_name, mobile_e164, mobile_number')
        .eq('id', booking.customer_id)
        .maybeSingle()
      if (customerError) {
        throw new Error(`Failed to load customer ${booking.customer_id}: ${customerError.message}`)
      }
      customer = (customerRow as FallbackCustomer | null) ?? null
    }
    if (!customer) {
      return { kind: 'unavailable', reason: 'customer_missing', booking: bookingRef, current }
    }

    let link: string | null = null
    if (spec.link) {
      const found = await findEmailLink({
        client,
        link: spec.link,
        form: recorded.link,
        tableBookingId: booking.id,
        customerId: customer.id,
        deliveryCreatedAt: delivery.created_at ?? null,
        now,
      })
      if (!found.ok) {
        // Paying through the link, or answering through it, is what the message asked for.
        if (found.reason === 'link_used' && spec.link.doneWhenUsed) {
          return { kind: 'no_longer_needed', booking: bookingRef }
        }
        const reason = found.reason === 'link_used' ? 'link_expired' : found.reason
        return { kind: 'unavailable', reason, booking: bookingRef, current }
      }
      link = found.url
    }

    const body = spec.text({ client, booking, customer, storedFacts: recorded.facts, now }, link)
    if (!body) {
      return { kind: 'unavailable', reason: 'facts_missing', booking: bookingRef, current }
    }

    const requested =
      spec.mobileFirst === 'mobile_number' ? customer.mobile_number : customer.mobile_e164 || customer.mobile_number || null

    return {
      kind: 'ready',
      booking: { ...bookingRef, ...current.booking },
      expectCancelled: spec.expectCancelled,
      validUntil: current.validUntil,
      sms: {
        to: resolveTableBookingGuestSmsTo(customer, requested),
        body,
        customerId: customer.id,
        metadata: { ...spec.smsMetadata(booking), table_booking_id: booking.id },
      },
    }
  },
}
