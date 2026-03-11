import { NextResponse } from 'next/server'
import { authorizeCronRequest } from '@/lib/cron-auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email/emailService'
import { logger } from '@/lib/logger'

const LONDON_TZ = 'Europe/London'
const RECIPIENT = 'manager@the-anchor.pub'
const SEND_HOUR = 13 // 1pm London time

function getLondonParts(now: Date): { dayOfWeek: number; hour: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: LONDON_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    hour12: false
  })
  const parts = fmt.formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekdayMap: Record<string, number> = {
    Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0
  }
  const weekday = get('weekday')
  const day = get('day')
  const month = get('month')
  const year = get('year')
  const hour = Number.parseInt(get('hour'), 10)
  return {
    dayOfWeek: weekdayMap[weekday] ?? -1,
    hour: Number.isFinite(hour) ? hour : -1,
    dateKey: `${year}-${month}-${day}`
  }
}

function nextSundayDate(saturdayDateKey: string): string {
  // Given a Saturday ISO date, return the next day (Sunday)
  const d = new Date(`${saturdayDateKey}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function formatTime(time: string | null | undefined): string {
  if (!time) return 'TBC'
  const [hStr, mStr] = time.slice(0, 5).split(':')
  const h = Number.parseInt(hStr, 10)
  const m = mStr || '00'
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  return `${h12}:${m}${ampm}`
}

function customerName(row: { first_name?: string | null; last_name?: string | null }): string {
  const first = row.first_name?.trim() ?? ''
  const last = row.last_name?.trim() ?? ''
  return `${first} ${last}`.trim() || 'Guest'
}

type BookingRow = {
  id: string
  booking_reference: string | null
  booking_time: string
  party_size: number | null
  committed_party_size: number | null
  special_requirements: string | null
  status: string
  payment_status: string | null
  customer: { first_name: string | null; last_name: string | null; mobile_number: string | null } | null
}

type ItemRow = {
  booking_id: string
  custom_item_name: string | null
  quantity: number | null
  item_type: string | null
}

function buildHtml(sundayDate: string, bookings: BookingRow[], itemsByBooking: Map<string, ItemRow[]>): string {
  const formattedDate = new Date(`${sundayDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  })

  const bookingsSorted = [...bookings].sort((a, b) => (a.booking_time ?? '').localeCompare(b.booking_time ?? ''))

  const totalCovers = bookingsSorted.reduce((sum, b) => sum + (b.committed_party_size ?? b.party_size ?? 0), 0)

  const rows = bookingsSorted.map((b) => {
    const items = itemsByBooking.get(b.id) ?? []
    const preorder = items.length > 0
      ? items.map((item) => `${item.quantity ?? 1}× ${item.custom_item_name ?? 'Unknown'} (${item.item_type ?? 'item'})`).join(', ')
      : '—'

    const covers = b.committed_party_size ?? b.party_size ?? '?'
    const name = customerName(b.customer ?? {})
    const phone = b.customer?.mobile_number ?? '—'
    const ref = b.booking_reference ?? b.id.slice(0, 8)
    const requirements = b.special_requirements?.trim() || '—'
    const depositStatus = b.payment_status === 'paid' ? '✓ Paid' : b.payment_status === 'waived' ? 'Waived' : b.payment_status ?? '—'

    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-weight:600;">${formatTime(b.booking_time)}</td>
        <td style="padding:10px 12px;">${name}</td>
        <td style="padding:10px 12px;text-align:center;">${covers}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${phone}</td>
        <td style="padding:10px 12px;font-size:13px;">${requirements}</td>
        <td style="padding:10px 12px;font-size:13px;">${preorder}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${depositStatus}</td>
        <td style="padding:10px 12px;font-size:12px;color:#9ca3af;">${ref}</td>
      </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f9fafb;margin:0;padding:24px;">
  <div style="max-width:900px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden;">
    <div style="background:#1e3a5f;padding:20px 24px;">
      <h1 style="color:#fff;margin:0;font-size:20px;">Sunday Lunch Prep — ${formattedDate}</h1>
      <p style="color:#93c5fd;margin:6px 0 0;font-size:14px;">${bookingsSorted.length} booking${bookingsSorted.length !== 1 ? 's' : ''} · ${totalCovers} cover${totalCovers !== 1 ? 's' : ''} total</p>
    </div>
    <div style="padding:20px 24px;">
      ${bookingsSorted.length === 0 ? '<p style="color:#6b7280;">No Sunday lunch bookings for this week.</p>' : `
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead>
            <tr style="background:#f3f4f6;text-align:left;">
              <th style="padding:10px 12px;font-weight:600;white-space:nowrap;">Time</th>
              <th style="padding:10px 12px;font-weight:600;">Name</th>
              <th style="padding:10px 12px;font-weight:600;text-align:center;">Covers</th>
              <th style="padding:10px 12px;font-weight:600;">Phone</th>
              <th style="padding:10px 12px;font-weight:600;">Requirements</th>
              <th style="padding:10px 12px;font-weight:600;">Pre-order</th>
              <th style="padding:10px 12px;font-weight:600;">Deposit</th>
              <th style="padding:10px 12px;font-weight:600;">Ref</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`}
    </div>
    <div style="padding:12px 24px;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">Sent automatically every Saturday at 1pm · The Anchor Management</p>
    </div>
  </div>
</body>
</html>`
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const auth = authorizeCronRequest(request)
    if (!auth.authorized) {
      return new NextResponse('Unauthorized', { status: 401 })
    }

    const url = new URL(request.url)
    const force = url.searchParams.get('force') === 'true'

    const now = new Date()
    const { dayOfWeek, hour, dateKey } = getLondonParts(now)

    // Only run on Saturdays at 1pm London time (handles GMT/BST automatically)
    if (!force && (dayOfWeek !== 6 || hour !== SEND_HOUR)) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'outside_send_window',
        dayOfWeek,
        hour
      })
    }

    const sundayDate = nextSundayDate(dateKey)
    const supabase = createAdminClient()

    // Fetch all non-cancelled Sunday lunch bookings for tomorrow (Sunday)
    const { data: bookingRows, error: bookingError } = await supabase
      .from('table_bookings')
      .select(
        'id, booking_reference, booking_time, party_size, committed_party_size, special_requirements, status, payment_status, customer:customers!table_bookings_customer_id_fkey(first_name,last_name,mobile_number)'
      )
      .eq('booking_date', sundayDate)
      .eq('booking_type', 'sunday_lunch')
      .not('status', 'in', '("cancelled")')
      .order('booking_time', { ascending: true })

    if (bookingError) {
      logger.error('sunday-lunch-prep: failed to fetch bookings', { error: bookingError })
      return NextResponse.json({ success: false, error: 'Failed to fetch bookings' }, { status: 500 })
    }

    const bookings = (bookingRows ?? []) as unknown as BookingRow[]
    const bookingIds = bookings.map((b) => b.id)

    // Fetch preorder items for all bookings in one query
    const itemsByBooking = new Map<string, ItemRow[]>()
    if (bookingIds.length > 0) {
      const { data: itemRows, error: itemError } = await supabase
        .from('table_booking_items')
        .select('booking_id, custom_item_name, quantity, item_type')
        .in('booking_id', bookingIds)
        .order('item_type', { ascending: true })

      if (itemError) {
        logger.error('sunday-lunch-prep: failed to fetch preorder items', { error: itemError })
        // Non-fatal — send the email without preorder data
      } else {
        for (const item of (itemRows ?? []) as unknown as ItemRow[]) {
          const existing = itemsByBooking.get(item.booking_id) ?? []
          existing.push(item)
          itemsByBooking.set(item.booking_id, existing)
        }
      }
    }

    const totalCovers = bookings.reduce((sum, b) => sum + (b.committed_party_size ?? b.party_size ?? 0), 0)
    const html = buildHtml(sundayDate, bookings, itemsByBooking)

    const result = await sendEmail({
      to: RECIPIENT,
      subject: `Sunday Lunch Prep — ${new Date(`${sundayDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })} (${bookings.length} bookings, ${totalCovers} covers)`,
      html
    })

    if (!result.success) {
      logger.error('sunday-lunch-prep: email send failed', { error: new Error(result.error ?? 'unknown') })
      return NextResponse.json({ success: false, error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      sundayDate,
      bookings: bookings.length,
      covers: totalCovers
    })
  } catch (error) {
    logger.error('sunday-lunch-prep: unexpected error', {
      error: error instanceof Error ? error : new Error(String(error))
    })
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  return GET(request)
}
