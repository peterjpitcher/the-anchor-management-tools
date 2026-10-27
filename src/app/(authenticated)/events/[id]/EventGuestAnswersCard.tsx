'use client'

import { useMemo } from 'react'
import { Badge, Card, CardBody, CardHeader, Empty, LinkButton } from '@/ds'
import { Icon } from '@/ds/icons'
import type { EventBookingRow } from '@/app/actions/events'
import type { BookingQuestion } from '@/lib/events/booking-questions'
import { eventBookingReference, summariseGuestAnswers } from '@/lib/events/guest-answers'

interface EventGuestAnswersCardProps {
  eventId: string
  questions: BookingQuestion[]
  /** The bookings on the door list (isOnDoorList). */
  bookings: EventBookingRow[]
  canManage: boolean
}

/**
 * Every guest's answers in one place, with counts, a kitchen summary to print and a CSV (BK-015,
 * customer bookings review of 24 October 2026). Answers used to show only under each booking, 25
 * bookings to a page, so the kitchen had no single allergy list for the tasting night. The
 * kitchen summary also carries the booking notes (owner decision D6).
 */
export function EventGuestAnswersCard({ eventId, questions, bookings, canManage }: EventGuestAnswersCardProps) {
  const summary = useMemo(() => summariseGuestAnswers(bookings.map((booking) => ({
    id: booking.id,
    reference: eventBookingReference(booking.id),
    bookerName: [booking.customer?.first_name, booking.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
    attendees: booking.attendees ?? [],
    notes: booking.notes,
  })), questions), [bookings, questions])

  if (summary.questions.length === 0) return null

  return (
    <Card>
      <CardHeader
        title="Guest Answers"
        subtitle="Confidential. Printed copies are shredded after service."
        action={
          <>
            <LinkButton
              href={`/api/events/${eventId}/kitchen-summary`}
              download
              variant="secondary"
              size="sm"
              icon={<Icon name="download" size={14} />}
            >
              Kitchen Summary
            </LinkButton>
            {canManage && (
              <LinkButton
                href={`/api/events/${eventId}/guest-answers`}
                download
                variant="secondary"
                size="sm"
                icon={<Icon name="download" size={14} />}
              >
                Answers CSV
              </LinkButton>
            )}
          </>
        }
      />
      <CardBody className="space-y-5">
        {summary.questions.map((question) => (
          <div key={question.questionId} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-text-strong">{question.label}</p>
              <Badge tone="neutral" size="sm">{question.answered.length} answered</Badge>
              {question.missingRequired.length > 0 && (
                <Badge tone="warning" size="sm">{question.missingRequired.length} still to answer</Badge>
              )}
            </div>
            {question.answered.length === 0 ? (
              <p className="text-sm text-text-muted">No answers yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {question.answered.map((answer, index) => (
                  <li key={`${answer.reference}-${index}`}>
                    <span className="font-medium">{answer.guestName}</span>{' '}
                    <span className="text-text-muted">({answer.reference})</span>: {answer.value}
                  </li>
                ))}
              </ul>
            )}
            {question.missingRequired.length > 0 && (
              <p className="text-sm text-text-muted">
                No answer from: {question.missingRequired.map((guest) => `${guest.guestName} (${guest.reference})`).join(', ')}
              </p>
            )}
          </div>
        ))}
        {summary.questions.length > 0 && summary.guests === 0 && (
          <Empty size="sm" title="No guest details yet" description="Answers show here once guests book." />
        )}
      </CardBody>
    </Card>
  )
}
