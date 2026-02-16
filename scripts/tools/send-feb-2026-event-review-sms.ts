#!/usr/bin/env tsx
import crypto from 'crypto'
import path from 'path'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { sendSMS } from '../../src/lib/twilio'
import {
  assertFeb2026EventReviewSmsSendAllowed,
  assertFeb2026EventReviewSmsSendLimit,
  isFeb2026EventReviewSmsRunEnabled,
  isFeb2026EventReviewSmsSendEnabled,
  readFeb2026EventReviewSmsSendLimit
} from '../../src/lib/send-feb-2026-event-review-sms-safety'
import {
  buildManualReviewCampaignSmsMetadata,
  assertManualReviewCampaignCompletedWithoutErrors,
  cleanupManualReviewCampaignToken,
  persistManualReviewCampaignSendState
} from '../../src/lib/manual-review-campaign-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const MANUAL_TEMPLATE_KEY = 'event_review_followup_manual_feb_2026'
const CAMPAIGN_KEY = 'manual_feb_4_11_2026_review_campaign'
const SEND_HARD_CAP = 200

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase environment variables')
}

const TARGET_EVENT_DATES = ['2026-02-04', '2026-02-11']

type EventRow = {
  id: string
  name: string
  date: string | null
  start_datetime: string | null
  event_status: string | null
}

type CustomerRow = {
  id: string
  first_name: string | null
  mobile_number: string | null
  sms_status: string | null
}

type BookingRow = {
  id: string
  customer_id: string
  event_id: string
  status: string
  review_sms_sent_at: string | null
  created_at: string
  event: EventRow | EventRow[] | null
  customer: CustomerRow | CustomerRow[] | null
}

type ResolvedBooking = {
  id: string
  customer_id: string
  event_id: string
  status: string
  review_sms_sent_at: string | null
  created_at: string
  event: EventRow | null
  customer: CustomerRow | null
}

type SendResult = {
  customerId: string
  eventBookingIds: string[]
  to: string
  sid: string
  sentAt: string
}

function hashGuestToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

function generateGuestToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function readArgValue(argv: string[], flag: string): string | null {
  const idx = argv.findIndex((arg) => arg === flag)
  if (idx !== -1) {
    const value = argv[idx + 1]
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
  }

  const eq = argv.find((arg) => arg.startsWith(`${flag}=`))
  if (eq) {
    const [, value] = eq.split('=', 2)
    return value && value.trim().length > 0 ? value.trim() : null
  }

  return null
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '')
  if (!/^https?:\/\//.test(trimmed)) {
    throw new Error(`Invalid --url (expected http(s)://...): ${raw}`)
  }
  return trimmed
}

function resolveAppBaseUrl(argv: string[]): { baseUrl: string; source: 'arg' | 'env' | 'default' } {
  const fromArg = readArgValue(argv, '--url') ?? readArgValue(argv, '--app-url')
  if (fromArg) {
    return { baseUrl: normalizeBaseUrl(fromArg), source: 'arg' }
  }

  const fromEnv = process.env.NEXT_PUBLIC_APP_URL
  if (fromEnv && fromEnv.trim().length > 0) {
    return { baseUrl: normalizeBaseUrl(fromEnv), source: 'env' }
  }

  // Safe default: never default scripts to production URLs.
  return { baseUrl: 'http://localhost:3000', source: 'default' }
}

function uniqueEventNames(bookings: ResolvedBooking[]): string[] {
  const names = new Set<string>()
  for (const booking of bookings) {
    const name = booking.event?.name?.trim()
    if (name) names.add(name)
  }
  return [...names]
}

function buildEngagingMessage(
  firstName: string,
  eventNames: string[],
  redirectUrl: string
): string {
  const eventPart =
    eventNames.length === 0
      ? 'our events'
      : eventNames.length === 1
        ? eventNames[0]
        : `${eventNames.slice(0, -1).join(', ')} and ${eventNames[eventNames.length - 1]}`

  return `The Anchor: Hi ${firstName}, thank you so much for joining us for ${eventPart}. We loved having you with us. We'd be really grateful for a quick Google review: ${redirectUrl} Thank you for supporting our team. Reply STOP to opt out.`
}

async function readGoogleReviewLink(
  supabase: ReturnType<typeof createClient>
): Promise<string> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'google_review_link')
    .maybeSingle()

  if (error) throw error

  const fallback = 'https://vip-club.uk/jls0mu'

  const pick = (value: unknown): string | null => {
    if (typeof value === 'string') {
      const trimmed = value.trim()
      return trimmed.length > 0 ? trimmed : null
    }
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['url', 'review_url', 'google_review_link', 'value']) {
        const candidate = pick(record[key])
        if (candidate) return candidate
      }
    }
    return null
  }

  return pick(data?.value) || fallback
}

async function createReviewRedirectToken(
  supabase: ReturnType<typeof createClient>,
  customerId: string,
  bookingId: string
): Promise<{ rawToken: string; hashedToken: string }> {
  const rawToken = generateGuestToken()
  const hashedToken = hashGuestToken(rawToken)
  const provisionalExpiry = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await supabase
    .from('guest_tokens')
    .insert({
      hashed_token: hashedToken,
      customer_id: customerId,
      event_booking_id: bookingId,
      action_type: 'review_redirect',
      expires_at: provisionalExpiry,
    })

  if (error) throw error
  return { rawToken, hashedToken }
}

async function main() {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const argv = process.argv.slice(2)
  const hasConfirmFlag = argv.includes('--confirm')
  const dryRunOverride = argv.includes('--dry-run')
  const sendEnabled = !dryRunOverride && isFeb2026EventReviewSmsSendEnabled(process.argv)
  const sendLimit = readFeb2026EventReviewSmsSendLimit(process.argv)
  const appBase = resolveAppBaseUrl(argv)

  if (hasConfirmFlag && !sendEnabled && !isFeb2026EventReviewSmsRunEnabled() && !dryRunOverride) {
    throw new Error(
      'send-feb-2026-event-review-sms blocked: --confirm requires RUN_FEB_REVIEW_SMS_SEND=true.'
    )
  }

  if (sendEnabled && appBase.source === 'default') {
    throw new Error(
      'send-feb-2026-event-review-sms blocked: sending requires an explicit --url (or NEXT_PUBLIC_APP_URL).'
    )
  }

  if (!sendEnabled) {
    const extra = dryRunOverride ? ' (--dry-run)' : ''
    console.log(
      `Read-only mode${extra}. Re-run with --confirm RUN_FEB_REVIEW_SMS_SEND=true ALLOW_FEB_REVIEW_SMS_SEND=true --limit=25 --url=https://your-domain to send SMS messages.`
    )
  } else {
    assertFeb2026EventReviewSmsSendAllowed()

    if (!sendLimit) {
      throw new Error(
        'send-feb-2026-event-review-sms blocked: sending requires an explicit cap via --limit=<n> (or FEB_REVIEW_SMS_SEND_LIMIT).'
      )
    }

    assertFeb2026EventReviewSmsSendLimit(sendLimit, SEND_HARD_CAP)
    console.log(`Send mode enabled. Will send up to ${sendLimit} message(s) (hard cap ${SEND_HARD_CAP}).`)
  }

  console.log(`App base URL: ${appBase.baseUrl} (${appBase.source})`)

  const reviewLinkTarget = await readGoogleReviewLink(supabase)

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, date, start_datetime, event_status')
    .in('date', TARGET_EVENT_DATES)
    .order('date', { ascending: true })

  if (eventsError) throw eventsError
  const eventRows = (events || []) as EventRow[]
  if (eventRows.length === 0) {
    console.log('No target events found.')
    return
  }

  const eventIds = eventRows.map((row) => row.id)
  const { data: bookingsRaw, error: bookingsError } = await supabase
    .from('bookings')
    .select(`
      id,
      customer_id,
      event_id,
      status,
      review_sms_sent_at,
      created_at,
      event:events(id, name, date, start_datetime, event_status),
      customer:customers(id, first_name, mobile_number, sms_status)
    `)
    .in('event_id', eventIds)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true })

  if (bookingsError) throw bookingsError

  const bookings = ((bookingsRaw || []) as BookingRow[]).map((row) => ({
    id: row.id,
    customer_id: row.customer_id,
    event_id: row.event_id,
    status: row.status,
    review_sms_sent_at: row.review_sms_sent_at,
    created_at: row.created_at,
    event: normalizeRelatedRow(row.event),
    customer: normalizeRelatedRow(row.customer),
  })) as ResolvedBooking[]

  const unsent = bookings.filter((row) => !row.review_sms_sent_at)

  const grouped = new Map<string, ResolvedBooking[]>()
  for (const booking of unsent) {
    const existing = grouped.get(booking.customer_id) || []
    existing.push(booking)
    grouped.set(booking.customer_id, existing)
  }

  const skipped: Array<{ customerId: string; reason: string; bookingIds: string[] }> = []
  const processingErrors: Array<{ customerId: string; reason: string; bookingIds: string[] }> = []
  const sent: SendResult[] = []

  for (const [customerId, customerBookings] of grouped.entries()) {
    if (sendEnabled && sendLimit && sent.length >= sendLimit) {
      break
    }

    const customer = customerBookings[0]?.customer
    const bookingIds = customerBookings.map((row) => row.id)

    if (!customer?.mobile_number) {
      skipped.push({ customerId, reason: 'missing_mobile_number', bookingIds })
      continue
    }
    if (customer.sms_status !== 'active') {
      skipped.push({ customerId, reason: `sms_status_${customer.sms_status || 'unknown'}`, bookingIds })
      continue
    }

    const firstName = (customer.first_name || 'there').trim() || 'there'
    const eventNames = uniqueEventNames(customerBookings)
    const primaryBooking = customerBookings[0]
    if (!sendEnabled) {
      skipped.push({
        customerId,
        reason: 'dry_run',
        bookingIds,
      })
      continue
    }

    let hashedToken: string | null = null
    let smsDispatched = false
    try {
      const { rawToken, hashedToken: createdHashedToken } = await createReviewRedirectToken(
        supabase,
        customerId,
        primaryBooking.id
      )
      hashedToken = createdHashedToken

      const redirectUrl = `${appBase.baseUrl}/r/${rawToken}`
      const messageBody = buildEngagingMessage(firstName, eventNames, redirectUrl)
      const campaignEventIds = Array.from(
        new Set(
          customerBookings
            .map((row) => row.event_id)
            .filter((eventId): eventId is string => typeof eventId === 'string' && eventId.trim().length > 0)
        )
      )
      const metadata = buildManualReviewCampaignSmsMetadata({
        templateKey: MANUAL_TEMPLATE_KEY,
        campaignKey: CAMPAIGN_KEY,
        source: CAMPAIGN_KEY,
        customerId,
        primaryBookingId: primaryBooking.id,
        eventIds: campaignEventIds,
        reviewRedirectTarget: reviewLinkTarget
      })

      const smsResult = await sendSMS(customer.mobile_number, messageBody, {
        customerId,
        metadata
      })

      if (!smsResult.success || !smsResult.sid) {
        throw new Error(smsResult.error || 'SMS send failed')
      }
      smsDispatched = true

      const sentAt = new Date().toISOString()
      const reviewWindowClosesAt = new Date(Date.parse(sentAt) + 7 * 24 * 60 * 60 * 1000).toISOString()

      const persistence = await persistManualReviewCampaignSendState(supabase, {
        bookingIds,
        sentAtIso: sentAt,
        reviewWindowClosesAtIso: reviewWindowClosesAt,
        hashedToken: createdHashedToken
      })
      if (persistence.error) {
        throw new Error(persistence.error)
      }

      sent.push({
        customerId,
        eventBookingIds: bookingIds,
        to: customer.mobile_number,
        sid: smsResult.sid,
        sentAt,
      })
    } catch (error) {
      let failureReason = error instanceof Error ? error.message : String(error)

      if (hashedToken && !smsDispatched) {
        const cleanup = await cleanupManualReviewCampaignToken(supabase, hashedToken)
        if (cleanup.error) {
          failureReason = `${failureReason}; token_cleanup_failed=${cleanup.error}`
        }
      }

      skipped.push({
        customerId,
        reason: failureReason,
        bookingIds,
      })
      processingErrors.push({
        customerId,
        reason: failureReason,
        bookingIds
      })
    }
  }

  const byDate = new Map<string, number>()
  for (const booking of unsent) {
    const eventDate = booking.event?.date || 'unknown'
    byDate.set(eventDate, (byDate.get(eventDate) || 0) + 1)
  }

  console.log('--- Manual Review Campaign Complete ---')
  console.log('Target dates:', TARGET_EVENT_DATES.join(', '))
  console.log('Resolved Google review target:', reviewLinkTarget)
  console.log('Candidate bookings (confirmed, unsent):', unsent.length)
  console.log('Unique customers targeted:', grouped.size)
  console.log('Messages sent:', sent.length)
  console.log('Skipped:', skipped.length)
  console.log('Candidates by event date:', Object.fromEntries(byDate.entries()))

  if (sent.length > 0) {
    console.log('\nSent messages:')
    for (const row of sent) {
      console.log(
        `- customer=${row.customerId} bookings=${row.eventBookingIds.length} to=${row.to} sid=${row.sid} sent_at=${row.sentAt}`
      )
    }
  }

  if (skipped.length > 0) {
    console.log('\nSkipped messages:')
    for (const row of skipped) {
      console.log(
        `- customer=${row.customerId} bookings=${row.bookingIds.length} reason=${row.reason}`
      )
    }
  }

  assertManualReviewCampaignCompletedWithoutErrors(processingErrors)
}

main().catch((error) => {
  console.error('Failed to send manual review campaign', error)
  process.exitCode = 1
})
