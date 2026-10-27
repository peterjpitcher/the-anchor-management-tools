import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const maxDuration = 60

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { formatDateInLondon, formatTime12Hour } from '@/lib/dateUtils'
import { getAnchorLogoDataUri } from '@/lib/pdf/anchor-logo'
import { summariseGuestAnswers } from '@/lib/events/guest-answers'
import { loadEventGuestAnswers } from '@/lib/events/guest-answers-server'
import { generateKitchenSummaryPdf } from '@/lib/events/kitchen-summary-pdf'

type RouteContext = {
  params: Promise<{ id: string }>
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'event'
}

/**
 * The kitchen's printout for an event night: guests' answers by question and the booking notes
 * (BK-015; owner decision D6). Anyone who can see the event can print it, as they can the guest
 * list. Each download is recorded, because the answers can be health data (BK-017).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id: eventId } = await context.params
  if (!eventId) return new NextResponse('Event ID required', { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const canView = await checkUserPermission('events', 'view')
  if (!canView) return new NextResponse('Permission denied', { status: 403 })

  try {
    const data = await loadEventGuestAnswers(createAdminClient(), eventId)
    if (!data) return new NextResponse('Event not found', { status: 404 })

    const summary = summariseGuestAnswers(data.bookings, data.event.questions)
    const pdf = await generateKitchenSummaryPdf(
      {
        name: data.event.name,
        dateLabel: formatDateInLondon(data.event.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        timeLabel: formatTime12Hour(data.event.time),
      },
      summary,
      { logoDataUri: getAnchorLogoDataUri() },
    )

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'export',
      resource_type: 'event',
      resource_id: eventId,
      operation_status: 'success',
      additional_info: { document: 'kitchen_summary', guests: summary.guests },
    })

    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="kitchen-summary-${safeFilename(data.event.slug || data.event.name)}.pdf"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to generate the kitchen summary:', error)
    return new NextResponse('Failed to generate the kitchen summary', { status: 500 })
  }
}
