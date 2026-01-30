import { NextRequest, NextResponse } from 'next/server'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { getCurrentUser } from '@/lib/audit-helpers'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'

type EventRow = {
  id: string
  name: string
  date: string
  time: string | null
  end_time: string | null
  doors_time: string | null
  last_entry_time: string | null
  duration_minutes: number | null
  capacity: number | null
  brief: string | null
  short_description: string | null
  long_description: string | null
  event_status: string | null
  performer_name: string | null
  performer_type: string | null
  price: number | null
  is_free: boolean | null
  booking_url: string | null
  category?: { name: string | null } | { name: string | null }[] | null
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 2,
})

function isValidDate(value: string | null): value is string {
  if (!value) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return !Number.isNaN(Date.parse(value))
}

function sanitizeFilename(value: string, fallback: string): string {
  const trimmed = String(value || '').trim()
  if (!trimmed) return fallback
  return trimmed
    .replaceAll(/[^\w.-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 120) || fallback
}

function formatTime(value: string | null): string {
  if (!value) return 'TBC'
  const [hours, minutes] = value.split(':')
  if (!hours || !minutes) return value
  return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`
}

function formatStatus(value: string | null): string {
  if (!value) return 'Scheduled'
  return value
    .split('_')
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(' ')
}

function formatPrice(event: EventRow): string {
  if (event.is_free) return 'Free'
  if (typeof event.price === 'number') return currencyFormatter.format(event.price)
  return '—'
}

function formatField(label: string, value: string | number | null | undefined): string {
  const hasValue = value !== null && value !== undefined && String(value).trim() !== ''
  return `${label}: ${hasValue ? value : '—'}`
}

function formatMultilineField(label: string, value: string | null | undefined): string {
  const text = value?.trim() ?? ''
  if (!text) return `${label}: —`
  return `${label}:\n${text}`
}

function buildExportText(events: EventRow[], startDate: string, endDate: string): string {
  const headerLines = [
    'Events Export',
    `Range: ${startDate} to ${endDate}`,
    `Generated: ${new Date().toISOString()}`,
    `Total events: ${events.length}`,
    '',
  ]
  const divider = '-'.repeat(64)

  const eventBlocks = events.map((event, index) => {
    const categoryRecord = Array.isArray(event.category) ? event.category[0] : event.category
    const categoryName = categoryRecord?.name ?? null
    const performerParts = [event.performer_name, event.performer_type].filter(Boolean)
    const performerLabel = performerParts.length ? performerParts.join(' • ') : null

    const lines = [
      `Event ${index + 1}: ${event.name}`,
      formatField('Status', formatStatus(event.event_status)),
      formatField('Category', categoryName),
      formatField('Date', event.date),
      formatField('Start time', formatTime(event.time)),
      formatField('End time', formatTime(event.end_time)),
      formatField('Doors time', formatTime(event.doors_time)),
      formatField('Last entry', formatTime(event.last_entry_time)),
      formatField('Duration (mins)', event.duration_minutes ?? null),
      formatField('Capacity', event.capacity ?? null),
      formatField('Price', formatPrice(event)),
      formatField('Booking URL', event.booking_url ?? null),
      formatField('Performer', performerLabel),
      formatMultilineField('Brief', event.brief),
      formatMultilineField('Short description', event.short_description),
      formatMultilineField('Long description', event.long_description),
    ]

    const block = lines.join('\n')
    return index === events.length - 1 ? block : `${block}\n${divider}`
  })

  return [headerLines.join('\n'), ...eventBlocks].join('\n')
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const startDate = searchParams.get('start_date')
  const endDate = searchParams.get('end_date')
  const eventId = searchParams.get('event_id')

  if (!isValidDate(startDate) || !isValidDate(endDate)) {
    return new NextResponse('Start and end dates are required (YYYY-MM-DD).', { status: 400 })
  }

  if (startDate > endDate) {
    return new NextResponse('Start date must be before end date.', { status: 400 })
  }

  const canExport = await checkUserPermission('events', 'export')
  const canManage = await checkUserPermission('events', 'manage')

  if (!canExport && !canManage) {
    return new NextResponse('Permission denied', { status: 403 })
  }

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from('events')
      .select(
        `
        id,
        name,
        date,
        time,
        end_time,
        doors_time,
        last_entry_time,
        duration_minutes,
        capacity,
        brief,
        short_description,
        long_description,
        event_status,
        performer_name,
        performer_type,
        price,
        is_free,
        booking_url,
        category:event_categories(name)
      `
      )
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .order('time', { ascending: true })

    if (eventId) {
      query = query.eq('id', eventId)
    }

    const { data, error } = await query

    if (error) {
      console.error('Failed to export events:', error)
      return new NextResponse('Failed to export events.', { status: 500 })
    }

    const events = (data ?? []) as EventRow[]

    if (events.length === 0) {
      return new NextResponse('No events found for the selected criteria.', { status: 404 })
    }

    const exportText = buildExportText(events, startDate, endDate)
    const buffer = Buffer.from(exportText, 'utf-8')
    const baseFilename = eventId
      ? sanitizeFilename(`event-${events[0]?.name ?? eventId}`, `event-${eventId}`)
      : `events_${startDate}_to_${endDate}`
    const filename = `${baseFilename}.txt`

    const userInfo = await getCurrentUser()
    await logAuditEvent({
      ...(userInfo.user_id && { user_id: userInfo.user_id }),
      ...(userInfo.user_email && { user_email: userInfo.user_email }),
      operation_type: 'export',
      resource_type: 'events',
      operation_status: 'success',
      additional_info: {
        start_date: startDate,
        end_date: endDate,
        event_id: eventId ?? null,
        total: events.length,
      },
    })

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename=\"${filename}\"`,
        'Cache-Control': 'no-store',
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (error) {
    console.error('Events export failed:', error)
    return new NextResponse('Failed to export events.', { status: 500 })
  }
}
