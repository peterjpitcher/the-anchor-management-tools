import { NextResponse } from 'next/server'
import { formatTime12Hour } from '@/lib/dateUtils'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  claimIdempotencyKey,
  computeIdempotencyRequestHash,
  persistIdempotencyResponse,
  releaseIdempotencyClaim
} from '@/lib/api/idempotency'
import { logger } from '@/lib/logger'
import {
  sendManagerPrivateBookingsDailyDigestEmail,
  type PrivateBookingDailyDigestActionSection,
  type PrivateBookingDailyDigestEvent
} from '@/lib/private-bookings/manager-notifications'

const LONDON_TIMEZONE = 'Europe/London'
const DEFAULT_DIGEST_HOUR = 9
const DATE_TBD_NOTE = 'Event date/time to be confirmed'

type UpcomingBookingRow = {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  event_date: string | null
  start_time: string | null
  status: string | null
  guest_count: number | null
  event_type: string | null
  balance_due_date: string | null
  final_payment_date: string | null
  calculated_total: number | string | null
  total_amount: number | string | null
  deposit_amount: number | string | null
  internal_notes: string | null
}

type PendingSmsRow = {
  id: string
  booking_id: string
  trigger_type: string | null
  created_at: string | null
}

type DraftHoldRow = {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  event_date: string | null
  start_time: string | null
  hold_expiry: string | null
}

type BookingLookupRow = {
  id: string
  customer_name: string | null
  customer_first_name: string | null
  customer_last_name: string | null
  event_date: string | null
  start_time: string | null
  status: string | null
}

function getLondonDateParts(now: Date = new Date()): { dateKey: string; hour: number } {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false
  })

  const parts = formatter.formatToParts(now)
  const year = parts.find((part) => part.type === 'year')?.value || '1970'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  const hourRaw = parts.find((part) => part.type === 'hour')?.value || '00'
  const hour = Number.parseInt(hourRaw, 10)

  return {
    dateKey: `${year}-${month}-${day}`,
    hour: Number.isFinite(hour) ? hour : 0
  }
}

function formatDateTimeInLondon(value: string | null | undefined): string {
  if (!value) return 'Unknown'
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(parsed)
}

function formatEventMoment(eventDate?: string | null, startTime?: string | null): string {
  const dateText = eventDate ? eventDate : 'Date TBC'
  if (!startTime) return `${dateText} (time TBC)`
  return `${dateText} at ${formatTime12Hour(startTime.slice(0, 5))}`
}

function normalizeCustomerName(input: {
  customer_name?: string | null
  customer_first_name?: string | null
  customer_last_name?: string | null
}): string {
  const direct = input.customer_name?.trim()
  if (direct) return direct
  const first = input.customer_first_name?.trim() || ''
  const last = input.customer_last_name?.trim() || ''
  const joined = `${first} ${last}`.trim()
  return joined || 'Guest'
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toCurrency(value: number): string {
  return `£${value.toFixed(2)}`
}

function parseDigestHour(): number {
  const raw = process.env.PRIVATE_BOOKINGS_DAILY_DIGEST_HOUR_LONDON
  if (!raw) return DEFAULT_DIGEST_HOUR
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
    return DEFAULT_DIGEST_HOUR
  }
  return parsed
}

export async function GET(request: Request) {
  let claimKey: string | null = null
  let claimHash: string | null = null
  let claimHeld = false

  try {
    const auth = authorizeCronRequest(request)
    if (!auth.authorized) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'
    const digestHour = parseDigestHour()
    const now = new Date()
    const { dateKey: londonDateKey, hour: londonHour } = getLondonDateParts(now)

    if (!force && londonHour !== digestHour) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'outside_london_digest_window',
        londonDate: londonDateKey,
        londonHour,
        digestHour
      })
    }

    const supabase = createAdminClient()
    claimKey = `cron:private-bookings-daily-summary:${londonDateKey}`
    claimHash = computeIdempotencyRequestHash({
      date: londonDateKey,
      recipient: process.env.PRIVATE_BOOKINGS_MANAGER_EMAIL || 'manager@the-anchor.pub'
    })

    const claim = await claimIdempotencyKey(supabase, claimKey, claimHash, 24 * 14)
    if (claim.state === 'conflict') {
      return NextResponse.json(
        { success: false, error: 'Private-bookings daily digest idempotency conflict' },
        { status: 409 }
      )
    }
    if (claim.state === 'in_progress' || claim.state === 'replay') {
      return NextResponse.json({
        success: true,
        sent: false,
        reason: 'already_processed_or_in_progress',
        londonDate: londonDateKey
      })
    }
    claimHeld = true

    const [upcomingResult, pendingSmsResult, draftHoldsResult] = await Promise.all([
      supabase
        .from('private_bookings_with_details')
        .select(
          'id, customer_name, customer_first_name, customer_last_name, event_date, start_time, status, guest_count, event_type, balance_due_date, final_payment_date, calculated_total, total_amount, deposit_amount, internal_notes'
        )
        .gte('event_date', londonDateKey)
        .neq('status', 'cancelled')
        .order('event_date', { ascending: true, nullsFirst: true })
        .order('start_time', { ascending: true, nullsFirst: true })
        .limit(5000),
      supabase
        .from('private_booking_sms_queue')
        .select('id, booking_id, trigger_type, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true })
        .limit(500),
      supabase
        .from('private_bookings')
        .select('id, customer_name, customer_first_name, customer_last_name, event_date, start_time, hold_expiry')
        .eq('status', 'draft')
        .not('hold_expiry', 'is', null)
        .order('hold_expiry', { ascending: true })
        .limit(5000)
    ])

    if (upcomingResult.error) {
      throw upcomingResult.error
    }
    if (pendingSmsResult.error) {
      throw pendingSmsResult.error
    }
    if (draftHoldsResult.error) {
      throw draftHoldsResult.error
    }

    const upcomingRows = (upcomingResult.data || []) as UpcomingBookingRow[]
    const pendingSmsRows = (pendingSmsResult.data || []) as PendingSmsRow[]
    const draftHoldRows = (draftHoldsResult.data || []) as DraftHoldRow[]

    const pendingBookingIds = Array.from(
      new Set(
        pendingSmsRows
          .map((row) => row.booking_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    )

    const pendingLookupById = new Map<string, BookingLookupRow>()
    if (pendingBookingIds.length > 0) {
      const { data: pendingLookupRows, error: pendingLookupError } = await supabase
        .from('private_bookings')
        .select('id, customer_name, customer_first_name, customer_last_name, event_date, start_time, status')
        .in('id', pendingBookingIds)

      if (pendingLookupError) {
        throw pendingLookupError
      }

      ;(pendingLookupRows || []).forEach((row) => {
        pendingLookupById.set(row.id, row as BookingLookupRow)
      })
    }

    const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '')
    const buildBookingUrl = (bookingId: string) => `${appBaseUrl}/private-bookings/${bookingId}`

    const digestEvents: PrivateBookingDailyDigestEvent[] = upcomingRows.map((row) => {
      const total = toNumber(row.calculated_total ?? row.total_amount)
      const deposit = toNumber(row.deposit_amount)
      const outstanding = Math.max(total - deposit, 0)
      const outstandingBalance =
        row.status === 'confirmed' && !row.final_payment_date && outstanding > 0 ? outstanding : null

      return {
        bookingId: row.id,
        customerName: normalizeCustomerName(row),
        eventDate: row.event_date,
        startTime: row.start_time,
        status: row.status,
        guestCount: row.guest_count,
        eventType: row.event_type,
        outstandingBalance,
        bookingUrl: buildBookingUrl(row.id)
      }
    })

    const nowMs = now.getTime()
    const soonMs = nowMs + 48 * 60 * 60 * 1000

    const expiredHoldItems = draftHoldRows
      .filter((row) => {
        const holdMs = Date.parse(row.hold_expiry || '')
        return Number.isFinite(holdMs) && holdMs <= nowMs
      })
      .map((row) => ({
        label: `${normalizeCustomerName(row)} - ${formatEventMoment(row.event_date, row.start_time)}`,
        detail: `Hold expired ${formatDateTimeInLondon(row.hold_expiry)}`,
        href: buildBookingUrl(row.id)
      }))

    const expiringHoldItems = draftHoldRows
      .filter((row) => {
        const holdMs = Date.parse(row.hold_expiry || '')
        return Number.isFinite(holdMs) && holdMs > nowMs && holdMs <= soonMs
      })
      .map((row) => ({
        label: `${normalizeCustomerName(row)} - ${formatEventMoment(row.event_date, row.start_time)}`,
        detail: `Hold expires ${formatDateTimeInLondon(row.hold_expiry)}`,
        href: buildBookingUrl(row.id)
      }))

    const pendingSmsItems = pendingSmsRows.map((row) => {
      const booking = pendingLookupById.get(row.booking_id)
      const customerName = booking ? normalizeCustomerName(booking) : 'Unknown booking'
      const eventMoment = booking
        ? formatEventMoment(booking.event_date, booking.start_time)
        : row.booking_id

      return {
        label: `${customerName} - ${eventMoment}`,
        detail: `SMS ${row.trigger_type || 'manual'} queued ${formatDateTimeInLondon(row.created_at)}`,
        href: `${appBaseUrl}/private-bookings/sms-queue`
      }
    })

    const overdueBalanceItems = digestEvents
      .filter((event) => {
        const row = upcomingRows.find((candidate) => candidate.id === event.bookingId)
        if (!row) return false
        if (event.outstandingBalance === null || event.outstandingBalance <= 0) return false
        if (!row.balance_due_date) return false
        return row.balance_due_date < londonDateKey
      })
      .map((event) => {
        const source = upcomingRows.find((candidate) => candidate.id === event.bookingId)
        return {
          label: `${event.customerName} - ${formatEventMoment(event.eventDate, event.startTime)}`,
          detail: `Overdue since ${source?.balance_due_date || 'unknown'} (${toCurrency(event.outstandingBalance || 0)})`,
          href: event.bookingUrl
        }
      })

    const dueTodayBalanceItems = digestEvents
      .filter((event) => {
        const row = upcomingRows.find((candidate) => candidate.id === event.bookingId)
        if (!row) return false
        if (event.outstandingBalance === null || event.outstandingBalance <= 0) return false
        if (!row.balance_due_date) return false
        return row.balance_due_date === londonDateKey
      })
      .map((event) => ({
        label: `${event.customerName} - ${formatEventMoment(event.eventDate, event.startTime)}`,
        detail: `Balance due today (${toCurrency(event.outstandingBalance || 0)})`,
        href: event.bookingUrl
      }))

    const dateTbdItems = upcomingRows
      .filter((row) => {
        if (!row.internal_notes) return false
        return row.internal_notes.includes(DATE_TBD_NOTE)
      })
      .map((row) => ({
        label: `${normalizeCustomerName(row)} - ${row.status || 'draft'}`,
        detail: 'Date/time still marked as to be confirmed',
        href: buildBookingUrl(row.id)
      }))

    const actionSections: PrivateBookingDailyDigestActionSection[] = [
      {
        title: 'Draft holds already expired',
        summary: 'Follow up or clean up these draft bookings now.',
        items: expiredHoldItems
      },
      {
        title: 'Draft holds expiring in 48 hours',
        summary: 'Follow up today to avoid losing tentative bookings.',
        items: expiringHoldItems
      },
      {
        title: 'Pending SMS approvals',
        summary: 'Approve or reject private-booking SMS in queue.',
        items: pendingSmsItems
      },
      {
        title: 'Overdue balances',
        summary: 'Outstanding final balances that are past due date.',
        items: overdueBalanceItems
      },
      {
        title: 'Balances due today',
        summary: 'Confirmed events with balance due today.',
        items: dueTodayBalanceItems
      },
      {
        title: 'Date/time still to confirm',
        summary: 'Bookings still marked as event date/time to be confirmed.',
        items: dateTbdItems
      }
    ].filter((section) => section.items.length > 0)

    const emailResult = await sendManagerPrivateBookingsDailyDigestEmail({
      runDateKey: londonDateKey,
      appBaseUrl,
      events: digestEvents,
      actionSections
    })

    if (!emailResult.sent) {
      await releaseIdempotencyClaim(supabase, claimKey, claimHash)
      claimHeld = false
      logger.error('Failed to send private bookings daily digest email', {
        error: new Error(emailResult.error || 'unknown'),
        metadata: {
          runDate: londonDateKey,
          eventCount: digestEvents.length,
          actionCount: emailResult.actionCount ?? 0
        }
      })
      return new NextResponse('Failed to send email', { status: 500 })
    }

    const responsePayload = {
      success: true,
      sent: true,
      londonDate: londonDateKey,
      events: digestEvents.length,
      actions: emailResult.actionCount ?? 0
    }

    await persistIdempotencyResponse(
      supabase,
      claimKey,
      claimHash,
      responsePayload,
      24 * 14
    )
    claimHeld = false

    return NextResponse.json(responsePayload, { status: 200 })
  } catch (error) {
    try {
      if (claimHeld && claimKey && claimHash) {
        const supabase = createAdminClient()
        await releaseIdempotencyClaim(supabase, claimKey, claimHash)
      }
    } catch (releaseError) {
      logger.error('Failed releasing private-bookings daily digest idempotency claim', {
        error: releaseError instanceof Error ? releaseError : new Error(String(releaseError))
      })
    }

    logger.error('Private bookings daily digest cron failed', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
