import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { checkUserPermission } from '@/app/actions/rbac'
import { logAuditEvent } from '@/app/actions/audit'
import { buildCsvBuffer, escapeCsvCell } from '@/lib/receipts/export/csv-helpers'
import { displayAnswer, storedAttendees, summariseGuestAnswers } from '@/lib/events/guest-answers'
import { loadEventGuestAnswers } from '@/lib/events/guest-answers-server'

type RouteContext = {
  params: Promise<{ id: string }>
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'event'
}

/**
 * Every ticket's guest details as a spreadsheet: one row per ticket, one column per question
 * (BK-015). Managers only, and each download is recorded (BK-017), because the answers can be
 * health data.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id: eventId } = await context.params
  if (!eventId) return new NextResponse('Event ID required', { status: 400 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Unauthorized', { status: 401 })

  const canManage = await checkUserPermission('events', 'manage')
  if (!canManage) return new NextResponse('Permission denied', { status: 403 })

  try {
    const data = await loadEventGuestAnswers(createAdminClient(), eventId)
    if (!data) return new NextResponse('Event not found', { status: 404 })

    const questions = summariseGuestAnswers(data.bookings, data.event.questions).questions
    const rows: string[][] = [
      ['Booking reference', 'Booked by', 'Guest', ...questions.map((question) => question.label)],
    ]
    let tickets = 0
    for (const booking of data.bookings) {
      for (const attendee of storedAttendees(booking.attendees)) {
        tickets += 1
        const byQuestion = new Map((attendee.answers ?? []).map((answer) => [answer.question_id, answer]))
        rows.push([
          booking.reference,
          escapeCsvCell(booking.bookerName),
          escapeCsvCell(attendee.name),
          ...questions.map((question) => {
            const answer = byQuestion.get(question.questionId)
            const value = typeof answer?.value === 'string' ? answer.value.trim() : ''
            return escapeCsvCell(value ? displayAnswer(answer?.type, value) : '')
          }),
        ])
      }
    }

    await logAuditEvent({
      user_id: user.id,
      user_email: user.email ?? undefined,
      operation_type: 'export',
      resource_type: 'event',
      resource_id: eventId,
      operation_status: 'success',
      additional_info: { document: 'guest_answers_csv', tickets },
    })

    return new NextResponse(buildCsvBuffer(rows) as unknown as BodyInit, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="guest-answers-${safeFilename(data.event.slug || data.event.name)}.csv"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  } catch (error) {
    console.error('Failed to export guest answers:', error)
    return new NextResponse('Failed to export guest answers', { status: 500 })
  }
}
