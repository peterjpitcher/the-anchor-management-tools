import { NextRequest, NextResponse } from 'next/server'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createEventManageToken } from '@/lib/events/manage-booking'
import { createGuestToken, hashGuestToken } from '@/lib/guest/tokens'
import { getGoogleReviewLink } from '@/lib/events/review-link'
import { recordAnalyticsEvent } from '@/lib/analytics/events'

const LONDON_TIMEZONE = 'Europe/London'
const TEMPLATE_REMINDER_7D = 'event_reminder_7d'
const TEMPLATE_REMINDER_1D = 'event_reminder_1d'
const TEMPLATE_REVIEW_FOLLOWUP = 'event_review_followup'
const TEMPLATE_TABLE_REVIEW_FOLLOWUP = 'table_review_followup'
const TEMPLATE_INTEREST_MARKETING_14D = 'event_interest_marketing_14d'
const TEMPLATE_INTEREST_REMINDER_14D = 'event_interest_reminder_14d'
const TEMPLATE_INTEREST_REMINDER_7D = 'event_interest_reminder_7d'
const TEMPLATE_INTEREST_REMINDER_1D = 'event_interest_reminder_1d'

type BookingWithRelations = {
  id: string
  customer_id: string
  event_id: string
  seats: number | null
  is_reminder_only: boolean | null
  status: string
  review_sms_sent_at?: string | null
  review_window_closes_at?: string | null
  event: {
    id: string
    name: string
    start_datetime: string | null
    date: string | null
    time: string | null
    event_status?: string | null
  } | null
  customer: {
    id: string
    first_name: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
}

type MarketingEventRow = {
  id: string
  name: string
  start_datetime: string | null
  event_type: string | null
  category_id: string | null
  booking_open: boolean | null
  event_status: string | null
}

type ManualInterestRecipientRow = {
  id: string | null
  customer_id: string | null
  reminder_14d_sent_at: string | null
  reminder_7d_sent_at: string | null
  reminder_1d_sent_at: string | null
}

type TableBookingWithCustomer = {
  id: string
  customer_id: string
  status: string
  booking_type: string | null
  start_datetime: string | null
  review_sms_sent_at?: string | null
  review_window_closes_at?: string | null
  customer: {
    id: string
    first_name: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
}

function chunkArray<T>(input: T[], size = 200): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < input.length; i += size) {
    chunks.push(input.slice(i, i + size))
  }
  return chunks
}

function isUndefinedTableError(error: any): boolean {
  return error?.code === '42P01'
}

function resolveEventStartIso(event: BookingWithRelations['event']): string | null {
  if (!event) return null
  if (event.start_datetime) return event.start_datetime

  if (event.date && event.time) {
    const local = `${event.date}T${event.time}`
    const asDate = fromZonedTime(local, LONDON_TIMEZONE)
    if (Number.isFinite(asDate.getTime())) {
      return asDate.toISOString()
    }
  }

  return null
}

function formatEventDateTime(isoDateTime: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(isoDateTime))
}

function computeNextMorningNineLondon(eventStartIso: string): Date {
  const londonEventStart = toZonedTime(new Date(eventStartIso), LONDON_TIMEZONE)
  const londonNextMorning = new Date(londonEventStart.getTime())
  londonNextMorning.setDate(londonNextMorning.getDate() + 1)
  londonNextMorning.setHours(9, 0, 0, 0)
  return fromZonedTime(londonNextMorning, LONDON_TIMEZONE)
}

async function loadSentTemplateSet(
  supabase: ReturnType<typeof createAdminClient>,
  bookingIds: string[],
  templateKeys: string[]
): Promise<Set<string>> {
  const sent = new Set<string>()
  if (bookingIds.length === 0 || templateKeys.length === 0) {
    return sent
  }

  for (const idChunk of chunkArray(bookingIds)) {
    const { data, error } = await supabase
      .from('messages')
      .select('event_booking_id, template_key')
      .in('event_booking_id', idChunk)
      .in('template_key', templateKeys)

    if (error) {
      logger.warn('Failed loading sent template dedupe set', {
        metadata: { error: error.message }
      })
      continue
    }

    for (const row of data || []) {
      const bookingId = (row as any).event_booking_id
      const templateKey = (row as any).template_key
      if (typeof bookingId === 'string' && typeof templateKey === 'string') {
        sent.add(`${bookingId}:${templateKey}`)
      }
    }
  }

  return sent
}

async function loadSentTableTemplateSet(
  supabase: ReturnType<typeof createAdminClient>,
  bookingIds: string[],
  templateKeys: string[]
): Promise<Set<string>> {
  const sent = new Set<string>()
  if (bookingIds.length === 0 || templateKeys.length === 0) {
    return sent
  }

  for (const idChunk of chunkArray(bookingIds)) {
    const { data, error } = await supabase
      .from('messages')
      .select('table_booking_id, template_key')
      .in('table_booking_id', idChunk)
      .in('template_key', templateKeys)

    if (error) {
      logger.warn('Failed loading sent table-template dedupe set', {
        metadata: { error: error.message }
      })
      continue
    }

    for (const row of data || []) {
      const bookingId = (row as any).table_booking_id
      const templateKey = (row as any).template_key
      if (typeof bookingId === 'string' && typeof templateKey === 'string') {
        sent.add(`${bookingId}:${templateKey}`)
      }
    }
  }

  return sent
}

async function loadEventBookingsForEngagement(
  supabase: ReturnType<typeof createAdminClient>
): Promise<BookingWithRelations[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      event_id,
      seats,
      is_reminder_only,
      status,
      review_sms_sent_at,
      review_window_closes_at,
      event:events(
        id,
        name,
        start_datetime,
        date,
        time,
        event_status
      ),
      customer:customers(
        id,
        first_name,
        mobile_number,
        sms_status
      )
    `)
    .in('status', ['confirmed'])
    .not('event_id', 'is', null)
    .limit(2000)

  if (error) {
    throw error
  }

  return ((data || []) as any[]).map((row) => ({
    ...row,
    event: Array.isArray(row.event) ? (row.event[0] || null) : (row.event || null),
    customer: Array.isArray(row.customer) ? (row.customer[0] || null) : (row.customer || null)
  })) as BookingWithRelations[]
}

async function loadTableBookingsForEngagement(
  supabase: ReturnType<typeof createAdminClient>
): Promise<TableBookingWithCustomer[]> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select(`
      id,
      customer_id,
      status,
      booking_type,
      start_datetime,
      review_sms_sent_at,
      review_window_closes_at,
      customer:customers(
        id,
        first_name,
        mobile_number,
        sms_status
      )
    `)
    .in('status', ['confirmed', 'visited_waiting_for_review', 'review_clicked'])
    .not('start_datetime', 'is', null)
    .limit(3000)

  if (error) {
    throw error
  }

  return ((data || []) as any[]).map((row) => ({
    ...row,
    customer: Array.isArray(row.customer) ? (row.customer[0] || null) : (row.customer || null)
  })) as TableBookingWithCustomer[]
}

async function loadEventsForInterestMarketing(
  supabase: ReturnType<typeof createAdminClient>
): Promise<MarketingEventRow[]> {
  const { data, error } = await supabase
    .from('events')
    .select('id, name, start_datetime, event_type, category_id, booking_open, event_status')
    .not('start_datetime', 'is', null)
    .eq('booking_open', true)
    .limit(500)

  if (error) {
    throw error
  }

  return ((data || []) as MarketingEventRow[]).filter((eventRow) => {
    if (!eventRow.start_datetime) return false
    if (eventRow.event_status && ['cancelled', 'draft'].includes(eventRow.event_status)) return false
    return true
  })
}

function formatEventDateText(isoDateTime: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  }).format(new Date(isoDateTime))
}

function resolveRelatedEventStart(value: any): string | null {
  const eventRecord = Array.isArray(value) ? value[0] : value
  return typeof eventRecord?.start_datetime === 'string' ? eventRecord.start_datetime : null
}

type InterestReminderTemplateKey =
  | typeof TEMPLATE_INTEREST_REMINDER_14D
  | typeof TEMPLATE_INTEREST_REMINDER_7D
  | typeof TEMPLATE_INTEREST_REMINDER_1D

function resolveInterestReminderTemplate(
  nowMs: number,
  eventStartMs: number
): InterestReminderTemplateKey | null {
  const dueAt14d = eventStartMs - 14 * 24 * 60 * 60 * 1000
  const dueAt7d = eventStartMs - 7 * 24 * 60 * 60 * 1000
  const dueAt1d = eventStartMs - 24 * 60 * 60 * 1000

  if (nowMs >= dueAt1d) return TEMPLATE_INTEREST_REMINDER_1D
  if (nowMs >= dueAt7d) return TEMPLATE_INTEREST_REMINDER_7D
  if (nowMs >= dueAt14d) return TEMPLATE_INTEREST_REMINDER_14D
  return null
}

function hasSentInterestReminder(
  row: ManualInterestRecipientRow,
  templateKey: InterestReminderTemplateKey
): boolean {
  if (templateKey === TEMPLATE_INTEREST_REMINDER_14D) {
    return typeof row.reminder_14d_sent_at === 'string'
  }
  if (templateKey === TEMPLATE_INTEREST_REMINDER_7D) {
    return typeof row.reminder_7d_sent_at === 'string'
  }
  return typeof row.reminder_1d_sent_at === 'string'
}

function interestReminderUpdatePayload(
  templateKey: InterestReminderTemplateKey,
  sentAt: string
): Record<string, string> {
  if (templateKey === TEMPLATE_INTEREST_REMINDER_14D) {
    return { reminder_14d_sent_at: sentAt }
  }
  if (templateKey === TEMPLATE_INTEREST_REMINDER_7D) {
    return { reminder_7d_sent_at: sentAt }
  }
  return { reminder_1d_sent_at: sentAt }
}

async function processInterestMarketing(
  supabase: ReturnType<typeof createAdminClient>,
  appBaseUrl: string
): Promise<{ sent: number; skipped: number; eventsProcessed: number }> {
  const nowMs = Date.now()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const events = await loadEventsForInterestMarketing(supabase)

  const result = {
    sent: 0,
    skipped: 0,
    eventsProcessed: 0
  }

  for (const eventRow of events) {
    if (!eventRow.start_datetime) {
      result.skipped += 1
      continue
    }

    const eventStartMs = Date.parse(eventRow.start_datetime)
    if (!Number.isFinite(eventStartMs) || eventStartMs <= nowMs) {
      result.skipped += 1
      continue
    }

    const manualTemplateKey = resolveInterestReminderTemplate(nowMs, eventStartMs)
    if (!manualTemplateKey) {
      result.skipped += 1
      continue
    }

    result.eventsProcessed += 1
    const eventCategoryId =
      typeof eventRow.category_id === 'string' && eventRow.category_id.trim().length > 0
        ? eventRow.category_id
        : null
    const eventType =
      typeof eventRow.event_type === 'string' && eventRow.event_type.trim().length > 0
        ? eventRow.event_type
        : null
    const matchingBasis: 'category' | 'event_type' | null = eventCategoryId ? 'category' : eventType ? 'event_type' : null

    const [pastBookings, pastWaitlist, existingBookings, manualRecipients] = await Promise.all([
      matchingBasis === 'category'
        ? supabase
            .from('bookings')
            .select('customer_id, event:events!inner(category_id, start_datetime)')
            .not('customer_id', 'is', null)
            .eq('event.category_id', eventCategoryId)
        : matchingBasis === 'event_type'
          ? supabase
              .from('bookings')
              .select('customer_id, event:events!inner(event_type, start_datetime)')
              .not('customer_id', 'is', null)
              .eq('event.event_type', eventType)
          : Promise.resolve({ data: [], error: null } as any),
      matchingBasis === 'category'
        ? supabase
            .from('waitlist_entries')
            .select('customer_id, event:events!inner(category_id, start_datetime)')
            .not('customer_id', 'is', null)
            .eq('event.category_id', eventCategoryId)
        : matchingBasis === 'event_type'
          ? supabase
              .from('waitlist_entries')
              .select('customer_id, event:events!inner(event_type, start_datetime)')
              .not('customer_id', 'is', null)
              .eq('event.event_type', eventType)
          : Promise.resolve({ data: [], error: null } as any),
      supabase
        .from('bookings')
        .select('customer_id, is_reminder_only')
        .eq('event_id', eventRow.id)
        .in('status', ['confirmed', 'pending_payment'])
        .not('customer_id', 'is', null),
      (supabase.from('event_interest_manual_recipients') as any)
        .select('id, customer_id, reminder_14d_sent_at, reminder_7d_sent_at, reminder_1d_sent_at')
        .eq('event_id', eventRow.id)
    ])

    let manualRecipientsData = (manualRecipients.data || []) as ManualInterestRecipientRow[]
    let manualRecipientsErrorMessage: string | undefined

    if (manualRecipients.error) {
      if (isUndefinedTableError(manualRecipients.error)) {
        const fallbackManualRecipients = await supabase
          .from('bookings')
          .select('customer_id')
          .eq('event_id', eventRow.id)
          .eq('is_reminder_only', true)
          .in('status', ['confirmed', 'pending_payment'])
          .not('customer_id', 'is', null)

        if (fallbackManualRecipients.error) {
          manualRecipientsErrorMessage = fallbackManualRecipients.error.message
        } else {
          manualRecipientsData = ((fallbackManualRecipients.data || []) as Array<{ customer_id: string | null }>)
            .map((row) => ({
              id: null,
              customer_id: row.customer_id,
              reminder_14d_sent_at: null,
              reminder_7d_sent_at: null,
              reminder_1d_sent_at: null
            }))
        }
      } else if (manualRecipients.error?.code === '42703') {
        const fallbackManualRecipients = await (supabase.from('event_interest_manual_recipients') as any)
          .select('id, customer_id')
          .eq('event_id', eventRow.id)

        if (fallbackManualRecipients.error) {
          manualRecipientsErrorMessage = fallbackManualRecipients.error.message
        } else {
          manualRecipientsData = ((fallbackManualRecipients.data || []) as Array<{ customer_id: string | null }>)
            .map((row) => ({
              id: null,
              customer_id: row.customer_id,
              reminder_14d_sent_at: null,
              reminder_7d_sent_at: null,
              reminder_1d_sent_at: null
            }))
        }
      } else {
        manualRecipientsErrorMessage = manualRecipients.error.message
      }
    }

    if (pastBookings.error || pastWaitlist.error || existingBookings.error || manualRecipientsErrorMessage) {
      logger.warn('Failed loading event interest marketing segments', {
        metadata: {
          eventId: eventRow.id,
          matchingBasis,
          bookingError: pastBookings.error?.message,
          waitlistError: pastWaitlist.error?.message,
          existingError: existingBookings.error?.message,
          manualError: manualRecipientsErrorMessage
        }
      })
      continue
    }

    const interestedCustomerIds = new Set<string>()
    for (const row of (pastBookings.data || []) as any[]) {
      const customerId = row.customer_id
      const eventStartIso = resolveRelatedEventStart(row?.event)
      if (typeof customerId === 'string' && typeof eventStartIso === 'string' && Date.parse(eventStartIso) < nowMs) {
        interestedCustomerIds.add(customerId)
      }
    }
    for (const row of (pastWaitlist.data || []) as any[]) {
      const customerId = row.customer_id
      const eventStartIso = resolveRelatedEventStart(row?.event)
      if (typeof customerId === 'string' && typeof eventStartIso === 'string' && Date.parse(eventStartIso) < nowMs) {
        interestedCustomerIds.add(customerId)
      }
    }
    for (const row of manualRecipientsData) {
      const customerId = row?.customer_id
      if (typeof customerId === 'string') {
        interestedCustomerIds.add(customerId)
      }
    }

    if (interestedCustomerIds.size === 0) {
      continue
    }

    const alreadyBooked = new Set<string>(
      ((existingBookings.data || []) as any[])
        .filter((row) => row?.is_reminder_only !== true)
        .map((row) => row?.customer_id)
        .filter((value): value is string => typeof value === 'string')
    )

    const manualRecipientsByCustomer = new Map<string, ManualInterestRecipientRow>()
    for (const row of manualRecipientsData) {
      if (typeof row.customer_id !== 'string') continue
      manualRecipientsByCustomer.set(row.customer_id, row)
    }

    const manualCandidateIds = Array.from(manualRecipientsByCustomer.keys()).filter(
      (customerId) => !alreadyBooked.has(customerId)
    )
    const behaviorCandidateIds = Array.from(interestedCustomerIds).filter(
      (customerId) => !alreadyBooked.has(customerId) && !manualRecipientsByCustomer.has(customerId)
    )

    if (behaviorCandidateIds.length > 0) {
      const { data: priorMarketingRows, error: priorMarketingError } = await supabase
        .from('messages')
        .select('customer_id')
        .eq('template_key', TEMPLATE_INTEREST_MARKETING_14D)
        .like('body', `%event_id=${eventRow.id}%`)
        .not('customer_id', 'is', null)
        .limit(10000)

      if (priorMarketingError) {
        logger.warn('Failed loading prior interest marketing rows', {
          metadata: { eventId: eventRow.id, error: priorMarketingError.message }
        })
      } else {
        const alreadyMessaged = new Set(
          ((priorMarketingRows || []) as Array<{ customer_id: string | null }>)
            .map((row) => row.customer_id)
            .filter((value): value is string => typeof value === 'string')
        )
        const candidateIds = behaviorCandidateIds.filter((customerId) => !alreadyMessaged.has(customerId))

        if (candidateIds.length > 0) {
          const { data: customers, error: customerError } = await supabase
            .from('customers')
            .select('id, first_name, mobile_number, sms_status, marketing_sms_opt_in')
            .in('id', candidateIds)
            .eq('sms_status', 'active')
            .eq('marketing_sms_opt_in', true)

          if (customerError) {
            logger.warn('Failed loading customers for interest marketing', {
              metadata: {
                eventId: eventRow.id,
                error: customerError.message
              }
            })
          } else {
            for (const customer of (customers || []) as any[]) {
              if (!customer?.mobile_number || !customer?.id) {
                continue
              }

              const firstName = customer.first_name || 'there'
              const eventDateText = formatEventDateText(eventRow.start_datetime)
              const destination = `${appBaseUrl}/events?event_id=${eventRow.id}`
              const body = ensureReplyInstruction(
                `The Anchor: Hi ${firstName}, reminder: ${eventRow.name} is coming up on ${eventDateText}. Book here: ${destination} Reply STOP to opt out.`,
                supportPhone
              )

              const smsResult = await sendSMS(customer.mobile_number, body, {
                customerId: customer.id,
                metadata: {
                  event_id: eventRow.id,
                  event_type: eventType,
                  category_id: eventCategoryId,
                  matching_basis: matchingBasis,
                  template_key: TEMPLATE_INTEREST_MARKETING_14D,
                  marketing: true
                }
              })

              if (!smsResult.success) {
                result.skipped += 1
                continue
              }

              result.sent += 1
            }
          }
        }
      }
    }

    if (manualCandidateIds.length > 0) {
      const { data: priorManualRows, error: priorManualError } = await supabase
        .from('messages')
        .select('customer_id')
        .eq('template_key', manualTemplateKey)
        .like('body', `%event_id=${eventRow.id}%`)
        .not('customer_id', 'is', null)
        .limit(10000)

      if (priorManualError) {
        logger.warn('Failed loading prior manual-interest reminder rows', {
          metadata: {
            eventId: eventRow.id,
            templateKey: manualTemplateKey,
            error: priorManualError.message
          }
        })
      }

      const alreadyMessagedManualTemplate = new Set(
        ((priorManualRows || []) as Array<{ customer_id: string | null }>)
          .map((row) => row.customer_id)
          .filter((value): value is string => typeof value === 'string')
      )

      const { data: manualCustomers, error: manualCustomerError } = await supabase
        .from('customers')
        .select('id, first_name, mobile_number, sms_status, marketing_sms_opt_in')
        .in('id', manualCandidateIds)
        .eq('sms_status', 'active')
        .eq('marketing_sms_opt_in', true)

      if (manualCustomerError) {
        logger.warn('Failed loading manual-interest recipients', {
          metadata: {
            eventId: eventRow.id,
            error: manualCustomerError.message
          }
        })
        continue
      }

      for (const customer of (manualCustomers || []) as any[]) {
        if (!customer?.mobile_number || !customer?.id) {
          continue
        }

        const manualRecipient = manualRecipientsByCustomer.get(customer.id)
        if (!manualRecipient) {
          result.skipped += 1
          continue
        }

        const alreadySentForTemplate = typeof manualRecipient.id === 'string'
          ? hasSentInterestReminder(manualRecipient, manualTemplateKey)
          : alreadyMessagedManualTemplate.has(customer.id)
        if (alreadySentForTemplate) {
          result.skipped += 1
          continue
        }

        const firstName = customer.first_name || 'there'
        const eventDateText = formatEventDateText(eventRow.start_datetime)
        const destination = `${appBaseUrl}/events?event_id=${eventRow.id}`
        const baseBody = manualTemplateKey === TEMPLATE_INTEREST_REMINDER_1D
          ? `The Anchor: Hi ${firstName}, reminder: ${eventRow.name} is tomorrow at ${eventDateText}.`
          : `The Anchor: Hi ${firstName}, reminder: ${eventRow.name} is coming up on ${eventDateText}.`
        const body = ensureReplyInstruction(
          `${baseBody} Book here: ${destination}`,
          supportPhone
        )

        const smsResult = await sendSMS(customer.mobile_number, body, {
          customerId: customer.id,
          metadata: {
            event_id: eventRow.id,
            event_type: eventType,
            category_id: eventCategoryId,
            matching_basis: matchingBasis,
            template_key: manualTemplateKey,
            marketing: true,
            manual_interest: true
          }
        })

        if (!smsResult.success) {
          result.skipped += 1
          continue
        }

        const sentAt = smsResult.scheduledFor || new Date().toISOString()
        if (typeof manualRecipient.id === 'string') {
          const { error: updateError } = await (supabase.from('event_interest_manual_recipients') as any)
            .update(interestReminderUpdatePayload(manualTemplateKey, sentAt))
            .eq('id', manualRecipient.id)
            .eq('event_id', eventRow.id)
            .eq('customer_id', customer.id)

          if (updateError) {
            logger.warn('Failed updating manual-interest reminder cadence state', {
              metadata: {
                eventId: eventRow.id,
                customerId: customer.id,
                templateKey: manualTemplateKey,
                error: updateError.message
              }
            })
          }
        } else {
          alreadyMessagedManualTemplate.add(customer.id)
        }

        result.sent += 1
      }
    }
  }

  return result
}

async function processReminders(
  supabase: ReturnType<typeof createAdminClient>,
  bookings: BookingWithRelations[],
  appBaseUrl: string
): Promise<{ sent7d: number; sent1d: number; skipped: number }> {
  const now = new Date()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const bookingIds = bookings.map((b) => b.id)
  const sentSet = await loadSentTemplateSet(supabase, bookingIds, [TEMPLATE_REMINDER_7D, TEMPLATE_REMINDER_1D])

  const result = {
    sent7d: 0,
    sent1d: 0,
    skipped: 0
  }
  const bookedCustomerEventKeys = new Set(
    bookings
      .filter((booking) => booking.is_reminder_only !== true)
      .map((booking) => `${booking.event_id}:${booking.customer_id}`)
  )

  for (const booking of bookings) {
    if (
      booking.is_reminder_only === true &&
      bookedCustomerEventKeys.has(`${booking.event_id}:${booking.customer_id}`)
    ) {
      result.skipped += 1
      continue
    }

    const customer = booking.customer
    const event = booking.event
    const eventStartIso = resolveEventStartIso(event)
    if (!customer || !event || !eventStartIso || !customer.mobile_number || customer.sms_status !== 'active') {
      result.skipped += 1
      continue
    }

    if (event.event_status && ['cancelled', 'draft'].includes(event.event_status)) {
      result.skipped += 1
      continue
    }

    const eventStart = new Date(eventStartIso)
    if (eventStart.getTime() <= now.getTime()) {
      result.skipped += 1
      continue
    }

    const dueAt7d = eventStart.getTime() - 7 * 24 * 60 * 60 * 1000
    const dueAt1d = eventStart.getTime() - 24 * 60 * 60 * 1000
    const shouldSend1d = now.getTime() >= dueAt1d
    const shouldSend7d = now.getTime() >= dueAt7d && now.getTime() < dueAt1d

    let templateKey: string | null = null
    if (shouldSend1d) templateKey = TEMPLATE_REMINDER_1D
    else if (shouldSend7d) templateKey = TEMPLATE_REMINDER_7D

    if (!templateKey) {
      result.skipped += 1
      continue
    }

    if (sentSet.has(`${booking.id}:${templateKey}`)) {
      result.skipped += 1
      continue
    }

    let manageLink: string | null = null
    try {
      const token = await createEventManageToken(supabase, {
        customerId: booking.customer_id,
        bookingId: booking.id,
        eventStartIso,
        appBaseUrl
      })
      manageLink = token.url
    } catch {
      manageLink = null
    }

    const firstName = customer.first_name || 'there'
    const eventDateText = formatEventDateTime(eventStartIso)
    const baseBody = templateKey === TEMPLATE_REMINDER_1D
      ? `The Anchor: Hi ${firstName}, reminder: ${event.name} is tomorrow at ${eventDateText}.`
      : `The Anchor: Hi ${firstName}, reminder: ${event.name} is coming up on ${eventDateText}.`
    const messageBody = ensureReplyInstruction(
      manageLink ? `${baseBody} Manage booking: ${manageLink}` : baseBody,
      supportPhone
    )

    const smsResult = await sendSMS(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        event_booking_id: booking.id,
        event_id: event.id,
        template_key: templateKey
      }
    })

    if (!smsResult.success) {
      result.skipped += 1
      continue
    }

    sentSet.add(`${booking.id}:${templateKey}`)
    if (templateKey === TEMPLATE_REMINDER_1D) result.sent1d += 1
    else result.sent7d += 1
  }

  return result
}

async function processReviewFollowups(
  supabase: ReturnType<typeof createAdminClient>,
  bookings: BookingWithRelations[],
  appBaseUrl: string
): Promise<{ sent: number; skipped: number }> {
  const now = new Date()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const reviewLinkTarget = await getGoogleReviewLink(supabase)

  const confirmedPastBookings = bookings.filter((booking) => {
    if (booking.status !== 'confirmed' || booking.review_sms_sent_at) return false
    const eventStartIso = resolveEventStartIso(booking.event)
    if (!eventStartIso) return false
    const eventStart = new Date(eventStartIso)
    return eventStart.getTime() <= now.getTime()
  })

  const sentSet = await loadSentTemplateSet(
    supabase,
    confirmedPastBookings.map((b) => b.id),
    [TEMPLATE_REVIEW_FOLLOWUP]
  )

  const result = { sent: 0, skipped: 0 }

  for (const booking of confirmedPastBookings) {
    const customer = booking.customer
    const event = booking.event
    const eventStartIso = resolveEventStartIso(event)
    if (!customer || !event || !eventStartIso || !customer.mobile_number || customer.sms_status !== 'active') {
      result.skipped += 1
      continue
    }

    const dueAt = computeNextMorningNineLondon(eventStartIso)
    if (now.getTime() < dueAt.getTime()) {
      result.skipped += 1
      continue
    }

    if (sentSet.has(`${booking.id}:${TEMPLATE_REVIEW_FOLLOWUP}`)) {
      result.skipped += 1
      continue
    }

    const provisionalExpiry = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000).toISOString()
    const { rawToken, hashedToken } = await createGuestToken(supabase, {
      customerId: customer.id,
      actionType: 'review_redirect',
      eventBookingId: booking.id,
      expiresAt: provisionalExpiry
    })

    const redirectUrl = `${appBaseUrl}/r/${rawToken}`
    const firstName = customer.first_name || 'there'
    const messageBody = ensureReplyInstruction(
      `The Anchor: Hi ${firstName}, thanks for booking ${event.name}. We'd love your feedback: ${redirectUrl}`,
      supportPhone
    )

    const smsResult = await sendSMS(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        event_booking_id: booking.id,
        event_id: event.id,
        template_key: TEMPLATE_REVIEW_FOLLOWUP,
        review_redirect_target: reviewLinkTarget
      }
    })

    if (!smsResult.success) {
      await supabase
        .from('guest_tokens')
        .delete()
        .eq('hashed_token', hashedToken)
      result.skipped += 1
      continue
    }

    const reviewSentAt = smsResult.scheduledFor || new Date().toISOString()
    const reviewWindowClosesAt = new Date(Date.parse(reviewSentAt) + 7 * 24 * 60 * 60 * 1000).toISOString()

    await Promise.all([
      supabase
        .from('bookings')
        .update({
          status: 'visited_waiting_for_review',
          review_sms_sent_at: reviewSentAt,
          review_window_closes_at: reviewWindowClosesAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', booking.id)
        .eq('status', 'confirmed'),
      supabase
        .from('guest_tokens')
        .update({
          expires_at: reviewWindowClosesAt
        })
        .eq('hashed_token', hashGuestToken(rawToken)),
      recordAnalyticsEvent(supabase, {
        customerId: customer.id,
        eventBookingId: booking.id,
        eventType: 'review_sms_sent',
        metadata: {
          event_id: event.id,
          review_sent_at: reviewSentAt,
          review_window_closes_at: reviewWindowClosesAt
        }
      })
    ])

    result.sent += 1
  }

  return result
}

async function processTableReviewFollowups(
  supabase: ReturnType<typeof createAdminClient>,
  tableBookings: TableBookingWithCustomer[],
  appBaseUrl: string
): Promise<{ sent: number; skipped: number }> {
  const now = Date.now()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const reviewLinkTarget = await getGoogleReviewLink(supabase)

  const eligibleBookings = tableBookings.filter((booking) => {
    if (booking.status !== 'confirmed' || booking.review_sms_sent_at) return false
    const startMs = Date.parse(booking.start_datetime || '')
    if (!Number.isFinite(startMs)) return false
    return now >= startMs + 4 * 60 * 60 * 1000
  })

  const sentSet = await loadSentTableTemplateSet(
    supabase,
    eligibleBookings.map((booking) => booking.id),
    [TEMPLATE_TABLE_REVIEW_FOLLOWUP]
  )

  const result = { sent: 0, skipped: 0 }

  for (const booking of eligibleBookings) {
    const customer = booking.customer
    if (!customer || !customer.mobile_number || customer.sms_status !== 'active') {
      result.skipped += 1
      continue
    }

    if (sentSet.has(`${booking.id}:${TEMPLATE_TABLE_REVIEW_FOLLOWUP}`)) {
      result.skipped += 1
      continue
    }

    const provisionalExpiry = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()
    const { rawToken, hashedToken } = await createGuestToken(supabase, {
      customerId: customer.id,
      actionType: 'review_redirect',
      tableBookingId: booking.id,
      expiresAt: provisionalExpiry
    })

    const redirectUrl = `${appBaseUrl}/r/${rawToken}`
    const firstName = customer.first_name || 'there'
    const messageBody = ensureReplyInstruction(
      `The Anchor: Hi ${firstName}, thanks for visiting The Anchor. We'd love your feedback: ${redirectUrl}`,
      supportPhone
    )

    const smsResult = await sendSMS(customer.mobile_number, messageBody, {
      customerId: customer.id,
      metadata: {
        table_booking_id: booking.id,
        template_key: TEMPLATE_TABLE_REVIEW_FOLLOWUP,
        review_redirect_target: reviewLinkTarget
      }
    })

    if (!smsResult.success) {
      await supabase
        .from('guest_tokens')
        .delete()
        .eq('hashed_token', hashedToken)
      result.skipped += 1
      continue
    }

    const reviewSentAt = smsResult.scheduledFor || new Date().toISOString()
    const reviewWindowClosesAt = new Date(Date.parse(reviewSentAt) + 7 * 24 * 60 * 60 * 1000).toISOString()

    await Promise.all([
      (supabase.from('table_bookings') as any)
        .update({
          status: 'visited_waiting_for_review',
          review_sms_sent_at: reviewSentAt,
          review_window_closes_at: reviewWindowClosesAt,
          updated_at: new Date().toISOString()
        })
        .eq('id', booking.id)
        .eq('status', 'confirmed'),
      supabase
        .from('guest_tokens')
        .update({
          expires_at: reviewWindowClosesAt
        })
        .eq('hashed_token', hashGuestToken(rawToken)),
      recordAnalyticsEvent(supabase, {
        customerId: customer.id,
        tableBookingId: booking.id,
        eventType: 'review_sms_sent',
        metadata: {
          booking_type: booking.booking_type || 'regular',
          review_sent_at: reviewSentAt,
          review_window_closes_at: reviewWindowClosesAt
        }
      })
    ])

    result.sent += 1
  }

  return result
}

async function processReviewWindowCompletion(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ completed: number }> {
  const nowIso = new Date().toISOString()
  const result = { completed: 0 }

  const { data: rows, error } = await supabase
    .from('bookings')
    .select('id, customer_id, event_id')
    .in('status', ['visited_waiting_for_review', 'review_clicked'])
    .not('review_window_closes_at', 'is', null)
    .lte('review_window_closes_at', nowIso)
    .limit(1000)

  if (error) {
    throw error
  }

  const bookingRows = (rows || []) as Array<{ id: string; customer_id: string; event_id: string }>
  if (bookingRows.length === 0) {
    return result
  }

  for (const idChunk of chunkArray(bookingRows.map((row) => row.id))) {
    const { data: updatedRows, error: updateError } = await supabase
      .from('bookings')
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso
      })
      .in('id', idChunk)
      .in('status', ['visited_waiting_for_review', 'review_clicked'])
      .select('id, customer_id, event_id')

    if (updateError) {
      throw updateError
    }

    for (const updated of (updatedRows || []) as Array<{ id: string; customer_id: string; event_id: string }>) {
      result.completed += 1
      await recordAnalyticsEvent(supabase, {
        customerId: updated.customer_id,
        eventBookingId: updated.id,
        eventType: 'review_window_closed',
        metadata: {
          event_id: updated.event_id
        }
      })
    }
  }

  return result
}

async function processTableReviewWindowCompletion(
  supabase: ReturnType<typeof createAdminClient>
): Promise<{ completed: number }> {
  const nowIso = new Date().toISOString()
  const result = { completed: 0 }

  const { data: rows, error } = await (supabase.from('table_bookings') as any)
    .select('id, customer_id, booking_type')
    .in('status', ['visited_waiting_for_review', 'review_clicked'])
    .not('review_window_closes_at', 'is', null)
    .lte('review_window_closes_at', nowIso)
    .limit(1000)

  if (error) {
    throw error
  }

  const bookingRows = (rows || []) as Array<{ id: string; customer_id: string; booking_type: string | null }>
  if (bookingRows.length === 0) {
    return result
  }

  for (const idChunk of chunkArray(bookingRows.map((row) => row.id))) {
    const { data: updatedRows, error: updateError } = await (supabase.from('table_bookings') as any)
      .update({
        status: 'completed',
        completed_at: nowIso,
        updated_at: nowIso
      })
      .in('id', idChunk)
      .in('status', ['visited_waiting_for_review', 'review_clicked'])
      .select('id, customer_id, booking_type')

    if (updateError) {
      throw updateError
    }

    for (const updated of (updatedRows || []) as Array<{ id: string; customer_id: string; booking_type: string | null }>) {
      result.completed += 1
      await recordAnalyticsEvent(supabase, {
        customerId: updated.customer_id,
        tableBookingId: updated.id,
        eventType: 'review_window_closed',
        metadata: {
          booking_type: updated.booking_type || 'regular'
        }
      })
    }
  }

  return result
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  try {
    const [bookings, tableBookings] = await Promise.all([
      loadEventBookingsForEngagement(supabase),
      loadTableBookingsForEngagement(supabase)
    ])

    const [reminders, reviews, completion, marketing, tableReviews, tableCompletion] = await Promise.all([
      processReminders(supabase, bookings, appBaseUrl),
      processReviewFollowups(supabase, bookings, appBaseUrl),
      processReviewWindowCompletion(supabase),
      processInterestMarketing(supabase, appBaseUrl),
      processTableReviewFollowups(supabase, tableBookings, appBaseUrl),
      processTableReviewWindowCompletion(supabase)
    ])

    return NextResponse.json({
      success: true,
      reminders,
      reviews,
      completion,
      tableReviews,
      tableCompletion,
      marketing,
      processedAt: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Failed to process event guest engagement cron', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process event guest engagement'
      },
      { status: 500 }
    )
  }
}
