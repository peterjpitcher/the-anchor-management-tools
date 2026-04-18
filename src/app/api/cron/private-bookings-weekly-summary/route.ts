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
  sendManagerPrivateBookingsWeeklyDigestEmail,
  type PrivateBookingWeeklyDigestEvent,
  type PrivateBookingWeeklyDigestStaleOutcome
} from '@/lib/private-bookings/manager-notifications'
import {
  classifyBookingTier,
  hasOutstandingBalance,
  type ClassificationContext,
  type WeeklyDigestBookingRow
} from '@/lib/private-bookings/weekly-digest-classifier'
import { getStalePendingOutcomes } from '@/lib/private-bookings/stale-outcomes'
import { AuditService } from '@/services/audit'

export const maxDuration = 60

const LONDON_TIMEZONE = 'Europe/London'
const DEFAULT_DIGEST_HOUR = 9

type PendingSmsRow = {
  id: string
  booking_id: string
  trigger_type: string | null
  created_at: string | null
}

function getLondonDateParts(now: Date = new Date()): { dateKey: string; hour: number; dayOfWeek: string } {
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

  const dayOfWeek = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'long'
  }).format(now)

  return {
    dateKey: `${year}-${month}-${day}`,
    hour: Number.isFinite(hour) ? hour : 0,
    dayOfWeek
  }
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

function parseDigestHour(): number {
  const raw = process.env.PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON
  if (!raw) return DEFAULT_DIGEST_HOUR
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 23) {
    return DEFAULT_DIGEST_HOUR
  }
  return parsed
}

function getEndOfWeekDateKey(mondayDateKey: string): string {
  const monday = new Date(`${mondayDateKey}T00:00:00Z`)
  const sunday = new Date(monday.getTime() + 6 * 24 * 60 * 60 * 1000)
  return sunday.toISOString().slice(0, 10)
}

function formatWeekLabel(mondayDateKey: string): string {
  const monday = new Date(`${mondayDateKey}T12:00:00.000Z`)
  return `w/c ${new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TIMEZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  }).format(monday)}`
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
    const { dateKey: londonDateKey, hour: londonHour, dayOfWeek } = getLondonDateParts(now)

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

    if (!force && dayOfWeek !== 'Monday') {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'not_monday',
        londonDate: londonDateKey,
        dayOfWeek
      })
    }

    const supabase = createAdminClient()
    claimKey = `cron:private-bookings-weekly-summary:${londonDateKey}`
    claimHash = computeIdempotencyRequestHash({
      date: londonDateKey,
      recipient: process.env.PRIVATE_BOOKINGS_MANAGER_EMAIL || 'manager@the-anchor.pub'
    })

    const claim = await claimIdempotencyKey(supabase, claimKey, claimHash, 24 * 7)
    if (claim.state === 'conflict') {
      return NextResponse.json(
        { success: false, error: 'Private-bookings weekly digest idempotency conflict' },
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

    const [upcomingResult, pendingSmsResult] = await Promise.all([
      supabase
        .from('private_bookings_with_details')
        .select(
          'id, customer_name, customer_first_name, customer_last_name, event_date, start_time, status, guest_count, event_type, balance_due_date, final_payment_date, internal_notes, updated_at, contact_email, contact_phone, balance_remaining, hold_expiry'
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
        .limit(500)
    ])

    if (upcomingResult.error) {
      throw upcomingResult.error
    }
    if (pendingSmsResult.error) {
      throw pendingSmsResult.error
    }

    const upcomingRows = (upcomingResult.data || []) as WeeklyDigestBookingRow[]
    const pendingSmsRows = (pendingSmsResult.data || []) as PendingSmsRow[]

    // Group pending SMS by booking_id into a count map
    const pendingSmsMap = new Map<string, number>()
    for (const row of pendingSmsRows) {
      if (row.booking_id) {
        pendingSmsMap.set(row.booking_id, (pendingSmsMap.get(row.booking_id) ?? 0) + 1)
      }
    }
    const totalPendingSms = pendingSmsRows.length

    const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/+$/, '')
    const buildBookingUrl = (bookingId: string): string => `${appBaseUrl}/private-bookings/${bookingId}`

    const classCtx: ClassificationContext = {
      now,
      todayDateKey: londonDateKey,
      endOfWeekDateKey: getEndOfWeekDateKey(londonDateKey),
      pendingSmsCount: 0 // overridden per-booking
    }

    const digestEvents: PrivateBookingWeeklyDigestEvent[] = upcomingRows.map((row) => {
      const perBookingCtx = { ...classCtx, pendingSmsCount: pendingSmsMap.get(row.id) ?? 0 }
      const { tier, labels } = classifyBookingTier(row, perBookingCtx)
      return {
        bookingId: row.id,
        customerName: normalizeCustomerName(row),
        eventDate: row.event_date,
        startTime: row.start_time,
        status: row.status,
        guestCount: row.guest_count,
        eventType: row.event_type,
        outstandingBalance: hasOutstandingBalance(row) ? row.balance_remaining : null,
        bookingUrl: buildBookingUrl(row.id),
        tier,
        triggerLabels: labels
      }
    })

    // Sort: tier ascending, then event_date ascending, then trigger count descending
    digestEvents.sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      const dateA = a.eventDate ?? ''
      const dateB = b.eventDate ?? ''
      if (dateA !== dateB) return dateA.localeCompare(dateB)
      return b.triggerLabels.length - a.triggerLabels.length
    })

    // Surface bookings whose outcome email was sent >14 days ago but the
    // manager still hasn't clicked a went_well / issues / skip link. The
    // getStalePendingOutcomes helper is fail-safe — on DB error it returns
    // [] so a single query issue does not break the whole digest.
    let stalePendingOutcomes: PrivateBookingWeeklyDigestStaleOutcome[] = []
    try {
      const staleRows = await getStalePendingOutcomes()
      stalePendingOutcomes = staleRows.map((row) => ({
        bookingId: row.booking_id,
        customerName: row.customer_name,
        eventDate: row.event_date,
        daysSinceEmail: row.days_since_email,
        bookingUrl: buildBookingUrl(row.booking_id)
      }))
    } catch (staleErr) {
      logger.warn('Failed to load stale pending outcomes for weekly digest', {
        metadata: {
          error: staleErr instanceof Error ? staleErr.message : String(staleErr)
        }
      })
    }

    const emailResult = await sendManagerPrivateBookingsWeeklyDigestEmail({
      runDateKey: londonDateKey,
      weekLabel: formatWeekLabel(londonDateKey),
      appBaseUrl,
      events: digestEvents,
      pendingSmsCount: totalPendingSms,
      smsQueueUrl: `${appBaseUrl}/private-bookings/sms-queue`,
      stalePendingOutcomes
    })

    if (!emailResult.sent) {
      await releaseIdempotencyClaim(supabase, claimKey, claimHash)
      claimHeld = false
      logger.error('Failed to send private bookings weekly digest email', {
        error: new Error(emailResult.error || 'unknown'),
        metadata: {
          runDate: londonDateKey,
          eventCount: digestEvents.length,
          actionCount: emailResult.actionCount ?? 0
        }
      })
      return new NextResponse('Failed to send email', { status: 500 })
    }

    // Audit log — failure should not break the cron
    try {
      await AuditService.logAuditEvent({
        operation_type: 'create',
        resource_type: 'private_booking_weekly_digest',
        operation_status: 'success',
        additional_info: {
          tier1Count: digestEvents.filter((e) => e.tier === 1).length,
          tier2Count: digestEvents.filter((e) => e.tier === 2).length,
          tier3Count: digestEvents.filter((e) => e.tier === 3).length,
          totalEvents: digestEvents.length
        }
      })
    } catch {
      /* audit failure should not break the cron */
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
      24 * 7
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
      logger.error('Failed releasing private-bookings weekly digest idempotency claim', {
        error: releaseError instanceof Error ? releaseError : new Error(String(releaseError))
      })
    }

    logger.error('Private bookings weekly digest cron failed', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return GET(request)
}
