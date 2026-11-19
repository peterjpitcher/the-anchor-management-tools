import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * "Text bookers": a service text to everyone booked into one event, about that event.
 *
 * Owner decision, 19 November 2026: these are service messages ("just to make sure that people
 * have all of the information"), so they go to every booker who accepts texts, whether or not
 * they agreed to marketing. That is why this path is separate from Bulk Messages, which is
 * marketing and stays limited to marketing consent. Someone who has opted out of texts
 * altogether is never texted: sendSMS refuses them too, so this list only explains it.
 *
 * The template key is deliberately outside PROMOTIONAL_SMS_TEMPLATE_KEYS (it does not use up a
 * guest's promotional allowance) and starts with `event_`, so SUSPEND_EVENT_SMS still stops it.
 */
export const EVENT_BOOKER_UPDATE_TEMPLATE_KEY = 'event_booker_update'

/** Longest message staff may write: four segments of plain text. */
export const EVENT_BOOKER_TEXT_MAX_LENGTH = 612

export type EventBookerExclusionReason = 'no_mobile' | 'opted_out' | 'number_not_textable'

export const EVENT_BOOKER_EXCLUSION_LABELS: Record<EventBookerExclusionReason, string> = {
  no_mobile: 'No mobile number on file',
  opted_out: 'Has opted out of texts',
  number_not_textable: 'Number has stopped receiving texts',
}

export interface EventBookerRecipient {
  customerId: string
  bookingIds: string[]
  firstName: string
  lastName: string
  mobile: string
  seats: number
  pendingPayment: boolean
}

export interface EventBookerExclusion {
  customerId: string
  name: string
  seats: number
  reason: EventBookerExclusionReason
}

export interface EventBookerAudience {
  recipients: EventBookerRecipient[]
  excluded: EventBookerExclusion[]
}

type BookingRow = {
  id: string
  customer_id: string | null
  seats: number | null
  status: string
  customer: {
    id: string
    first_name: string | null
    last_name: string | null
    mobile_e164: string | null
    mobile_number: string | null
    sms_opt_in: boolean | null
    sms_status: string | null
  } | null
}

function cleanName(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim()
  return trimmed.toLowerCase() === 'null' ? '' : trimmed
}

/** Why a booker cannot be texted, or null when they can. Mirrors sendSMS's own consent gate. */
export function resolveBookerExclusion(customer: NonNullable<BookingRow['customer']>): EventBookerExclusionReason | null {
  const mobile = (customer.mobile_e164 ?? '').trim() || (customer.mobile_number ?? '').trim()
  if (!mobile) return 'no_mobile'
  if (customer.sms_opt_in === false || customer.sms_status === 'opted_out') return 'opted_out'
  if (customer.sms_status !== null && customer.sms_status !== 'active') return 'number_not_textable'
  return null
}

/**
 * Who a "Text bookers" send reaches, worked out on the server from the event's live bookings.
 * Confirmed bookings always; bookings waiting for payment only when staff tick the box. One
 * text per customer, however many bookings they hold. Reminder-only rows are not bookings.
 */
export async function loadEventBookerAudience(
  db: SupabaseClient,
  eventId: string,
  options: { includePendingPayment: boolean }
): Promise<EventBookerAudience> {
  const statuses = options.includePendingPayment ? ['confirmed', 'pending_payment'] : ['confirmed']

  const { data, error } = await db
    .from('bookings')
    .select('id, customer_id, seats, status, customer:customers(id, first_name, last_name, mobile_e164, mobile_number, sms_opt_in, sms_status)')
    .eq('event_id', eventId)
    .in('status', statuses)
    .or('is_reminder_only.is.null,is_reminder_only.eq.false')
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(`Failed to load bookings for event texts: ${error.message}`)
  }

  const recipients = new Map<string, EventBookerRecipient>()
  const excluded = new Map<string, EventBookerExclusion>()

  for (const row of (data ?? []) as unknown as BookingRow[]) {
    const customer = row.customer
    if (!customer) continue
    const seats = Math.max(row.seats ?? 1, 1)
    const name = [cleanName(customer.first_name), cleanName(customer.last_name)].filter(Boolean).join(' ') || 'Unnamed guest'
    const reason = resolveBookerExclusion(customer)

    if (reason) {
      const existing = excluded.get(customer.id)
      if (existing) existing.seats += seats
      else excluded.set(customer.id, { customerId: customer.id, name, seats, reason })
      continue
    }

    const existing = recipients.get(customer.id)
    if (existing) {
      existing.bookingIds.push(row.id)
      existing.seats += seats
      existing.pendingPayment = existing.pendingPayment && row.status === 'pending_payment'
      continue
    }

    recipients.set(customer.id, {
      customerId: customer.id,
      bookingIds: [row.id],
      firstName: cleanName(customer.first_name),
      lastName: cleanName(customer.last_name),
      mobile: (customer.mobile_e164 ?? '').trim() || (customer.mobile_number ?? '').trim(),
      seats,
      pendingPayment: row.status === 'pending_payment',
    })
  }

  return { recipients: [...recipients.values()], excluded: [...excluded.values()] }
}

/** Fills {{first_name}}; a booker with no usable first name is greeted as "there". */
export function personaliseBookerText(template: string, firstName: string): string {
  return template.replace(/{{\s*first_name\s*}}/g, firstName || 'there').trim()
}
