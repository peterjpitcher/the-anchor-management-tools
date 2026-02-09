import { NextRequest, NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import { ensureReplyInstruction } from '@/lib/sms/support'
import { sendSMS } from '@/lib/twilio'
import { createSundayPreorderToken } from '@/lib/table-bookings/sunday-preorder'
import { recordAnalyticsEvent } from '@/lib/analytics/events'

const TEMPLATE_REMINDER_48H = 'sunday_preorder_reminder_48h'
const TEMPLATE_REMINDER_26H = 'sunday_preorder_reminder_26h'
const TEMPLATE_CANCELLED_24H = 'sunday_preorder_cancelled_24h'

type SundayBookingRow = {
  id: string
  customer_id: string
  booking_reference: string | null
  party_size: number | null
  status: string
  start_datetime: string | null
  sunday_preorder_completed_at: string | null
  customer: {
    id: string
    first_name: string | null
    mobile_number: string | null
    sms_status: string | null
  } | null
}

function chunkArray<T>(input: T[], size = 200): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < input.length; index += size) {
    chunks.push(input.slice(index, index + size))
  }
  return chunks
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

  for (const bookingChunk of chunkArray(bookingIds, 300)) {
    const { data, error } = await supabase
      .from('messages')
      .select('table_booking_id, template_key, metadata')
      .in('table_booking_id', bookingChunk)
      .in('template_key', templateKeys)

    if (error) {
      logger.warn('Failed to load Sunday pre-order message dedupe set', {
        metadata: {
          error: error.message
        }
      })
      continue
    }

    for (const row of data || []) {
      const bookingId = (row as any).table_booking_id || (row as any)?.metadata?.table_booking_id
      const templateKey = (row as any).template_key || (row as any)?.metadata?.template_key
      if (typeof bookingId === 'string' && typeof templateKey === 'string') {
        sent.add(`${bookingId}:${templateKey}`)
      }
    }
  }

  return sent
}

async function loadSundayBookings(
  supabase: ReturnType<typeof createAdminClient>
): Promise<SundayBookingRow[]> {
  const { data, error } = await supabase
    .from('table_bookings')
    .select(`
      id,
      customer_id,
      booking_reference,
      party_size,
      status,
      start_datetime,
      sunday_preorder_completed_at,
      customer:customers(
        id,
        first_name,
        mobile_number,
        sms_status
      )
    `)
    .eq('booking_type', 'sunday_lunch')
    .eq('status', 'confirmed')
    .not('start_datetime', 'is', null)
    .limit(3000)

  if (error) {
    throw error
  }

  return ((data || []) as any[]).map((row) => ({
    ...row,
    customer: Array.isArray(row.customer) ? (row.customer[0] || null) : (row.customer || null)
  })) as SundayBookingRow[]
}

function shouldSend48HourReminder(nowMs: number, startMs: number): boolean {
  return nowMs >= startMs - 48 * 60 * 60 * 1000 && nowMs < startMs - 26 * 60 * 60 * 1000
}

function shouldSend26HourReminder(nowMs: number, startMs: number): boolean {
  return nowMs >= startMs - 26 * 60 * 60 * 1000 && nowMs < startMs - 24 * 60 * 60 * 1000
}

function shouldCancelForMissingPreorder(nowMs: number, startMs: number): boolean {
  return nowMs >= startMs - 24 * 60 * 60 * 1000
}

export async function GET(request: NextRequest) {
  const auth = authorizeCronRequest(request)
  if (!auth.authorized) {
    return NextResponse.json({ error: auth.reason || 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const now = new Date()
  const nowMs = now.getTime()
  const supportPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || process.env.TWILIO_PHONE_NUMBER || undefined
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin

  const counters = {
    reminders48Sent: 0,
    reminders26Sent: 0,
    cancelledAt24h: 0,
    cancellationSmsSent: 0,
    skipped: 0
  }

  try {
    const bookings = await loadSundayBookings(supabase)
    const sentTemplateSet = await loadSentTemplateSet(
      supabase,
      bookings.map((booking) => booking.id),
      [TEMPLATE_REMINDER_48H, TEMPLATE_REMINDER_26H, TEMPLATE_CANCELLED_24H]
    )

    for (const booking of bookings) {
      const customer = booking.customer
      const startIso = booking.start_datetime

      if (!customer || !startIso || !customer.mobile_number || customer.sms_status !== 'active') {
        counters.skipped += 1
        continue
      }

      if (booking.sunday_preorder_completed_at) {
        counters.skipped += 1
        continue
      }

      const startMs = Date.parse(startIso)
      if (!Number.isFinite(startMs)) {
        counters.skipped += 1
        continue
      }

      if (shouldCancelForMissingPreorder(nowMs, startMs)) {
        const nowIso = new Date().toISOString()

        const { data: cancelledRows, error: cancelError } = await (supabase.from('table_bookings') as any)
          .update({
            status: 'cancelled',
            cancelled_at: nowIso,
            cancelled_by: 'system',
            updated_at: nowIso
          })
          .eq('id', booking.id)
          .eq('status', 'confirmed')
          .is('sunday_preorder_completed_at', null)
          .select('id')

        if (cancelError || !cancelledRows || cancelledRows.length === 0) {
          counters.skipped += 1
          continue
        }

        counters.cancelledAt24h += 1

        await recordAnalyticsEvent(supabase, {
          customerId: customer.id,
          tableBookingId: booking.id,
          eventType: 'table_booking_cancelled',
          metadata: {
            cancellation_reason: 'sunday_preorder_incomplete_24h',
            cancelled_by: 'system'
          }
        })

        const cancellationKey = `${booking.id}:${TEMPLATE_CANCELLED_24H}`
        if (!sentTemplateSet.has(cancellationKey)) {
          const message = ensureReplyInstruction(
            `The Anchor: Hi ${customer.first_name || 'there'}, your Sunday lunch booking ${booking.booking_reference || ''} has been cancelled because the required pre-order wasn't completed 24 hours before the booking. No charge has been applied.`,
            supportPhone
          )

          const smsResult = await sendSMS(customer.mobile_number, message, {
            customerId: customer.id,
            metadata: {
              table_booking_id: booking.id,
              template_key: TEMPLATE_CANCELLED_24H
            }
          })

          if (smsResult.success) {
            sentTemplateSet.add(cancellationKey)
            counters.cancellationSmsSent += 1
          }
        }

        continue
      }

      let templateKey: string | null = null
      if (shouldSend26HourReminder(nowMs, startMs)) {
        templateKey = TEMPLATE_REMINDER_26H
      } else if (shouldSend48HourReminder(nowMs, startMs)) {
        templateKey = TEMPLATE_REMINDER_48H
      }

      if (!templateKey) {
        counters.skipped += 1
        continue
      }

      const dedupeKey = `${booking.id}:${templateKey}`
      if (sentTemplateSet.has(dedupeKey)) {
        counters.skipped += 1
        continue
      }

      let preorderUrl: string | null = null
      try {
        const token = await createSundayPreorderToken(supabase, {
          customerId: customer.id,
          tableBookingId: booking.id,
          bookingStartIso: startIso,
          appBaseUrl
        })
        preorderUrl = token.url
      } catch {
        preorderUrl = null
      }

      const intro = templateKey === TEMPLATE_REMINDER_26H
        ? 'Final reminder: please complete your Sunday lunch pre-order.'
        : 'please complete your Sunday lunch pre-order.'

      const smsResult = await sendSMS(
        customer.mobile_number,
        ensureReplyInstruction(
          preorderUrl
            ? `The Anchor: Hi ${customer.first_name || 'there'}, ${intro} Complete here: ${preorderUrl}`
            : `The Anchor: Hi ${customer.first_name || 'there'}, please use the Sunday pre-order link from your original booking text. If you can't find it, reply to this message and we'll resend it.`,
          supportPhone
        ),
        {
          customerId: customer.id,
          metadata: {
            table_booking_id: booking.id,
            template_key: templateKey
          }
        }
      )

      if (!smsResult.success) {
        counters.skipped += 1
        continue
      }

      sentTemplateSet.add(dedupeKey)
      if (templateKey === TEMPLATE_REMINDER_26H) {
        counters.reminders26Sent += 1
      } else {
        counters.reminders48Sent += 1
      }
    }

    return NextResponse.json({
      success: true,
      counters,
      processedAt: new Date().toISOString()
    })
  } catch (error) {
    logger.error('Failed to process Sunday pre-order cron', {
      error: error instanceof Error ? error : new Error(String(error))
    })

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process Sunday pre-orders'
      },
      { status: 500 }
    )
  }
}
