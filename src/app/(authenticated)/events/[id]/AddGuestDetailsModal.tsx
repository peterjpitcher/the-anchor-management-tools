'use client'

import { Modal } from '@/ds'
import type { EventBookingRow } from '@/app/actions/events'
import type { BookingQuestion } from '@/lib/events/booking-questions'
import { EventAttendeesEditor } from './EventAttendeesEditor'

interface GuestDetailsModalProps {
  booking: EventBookingRow | null
  questions: BookingQuestion[]
  /** Whether the event takes a name and answers for every ticket (requiresGuestDetails). */
  eventTakesGuestDetails: boolean
  canEdit: boolean
  onClose: () => void
  onSaved: () => Promise<void> | void
}

/**
 * A booking's guests: each ticket's name, own mobile (BK-013) and answers (BK-016). They used to
 * show under every booking in the list; the owner asked for the list to show the booking only
 * (9 November 2026), so they open from the booking's Guest Details button instead. A booking with
 * none yet starts straight in the form, as Add Guest Details did before (this file's name), with
 * any names staff typed before guest details existed filled in. The printed guest list and the
 * Guest Answers card still carry every answer.
 */
export function GuestDetailsModal({
  booking,
  questions,
  eventTakesGuestDetails,
  canEdit,
  onClose,
  onSaved,
}: GuestDetailsModalProps): React.ReactElement {
  const attendees = booking?.attendees ?? []
  const legacyNames = (booking?.attendee_names ?? []).filter((name) => typeof name === 'string' && name.trim().length > 0)
  const adding = attendees.length === 0 && eventTakesGuestDetails && canEdit
  const customerName = [booking?.customer?.first_name, booking?.customer?.last_name].filter(Boolean).join(' ')

  return (
    <Modal
      open={booking !== null}
      onClose={onClose}
      title={adding ? 'Add Guest Details' : 'Guest Details'}
      description={
        adding
          ? "A name for every ticket, and their answers to the event's questions."
          : customerName
            ? `Booked by ${customerName}. Guests' answers are confidential.`
            : "Guests' answers are confidential."
      }
      width="lg"
    >
      {booking && (attendees.length > 0 || adding) && (
        <EventAttendeesEditor
          key={booking.id}
          bookingId={booking.id}
          seats={Math.max(1, Number(booking.seats ?? 1))}
          attendees={attendees}
          questions={questions}
          prefillNames={attendees.length === 0 ? booking.attendee_names ?? null : null}
          canEdit={canEdit}
          startInEdit={adding}
          onSaved={() => { void onSaved(); onClose() }}
          onCancel={adding ? onClose : undefined}
        />
      )}
      {booking && attendees.length === 0 && !adding && (
        legacyNames.length > 0 ? (
          <ol className="list-decimal space-y-1 pl-5 text-sm text-text">
            {legacyNames.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-text-muted">No guest details on this booking yet.</p>
        )
      )}
    </Modal>
  )
}
