'use client'

import { Modal } from '@/ds'
import type { EventBookingRow } from '@/app/actions/events'
import type { BookingQuestion } from '@/lib/events/booking-questions'
import { EventAttendeesEditor } from './EventAttendeesEditor'

interface AddGuestDetailsModalProps {
  booking: EventBookingRow | null
  questions: BookingQuestion[]
  onClose: () => void
  onSaved: () => Promise<void> | void
}

/**
 * Adds a name and the event's answers for every ticket on a booking that has none, such as a
 * phone, bar or kiosk booking (BK-016). It replaces the old names-only editor, so names and
 * answers are always kept together. Names typed with that editor start the form off.
 */
export function AddGuestDetailsModal({ booking, questions, onClose, onSaved }: AddGuestDetailsModalProps) {
  return (
    <Modal open={booking !== null} onClose={onClose} title="Add Guest Details" description="A name for every ticket, and their answers to the event's questions." width="lg">
      {booking && (
        <EventAttendeesEditor
          key={booking.id}
          bookingId={booking.id}
          seats={Math.max(1, Number(booking.seats ?? 1))}
          attendees={[]}
          questions={questions}
          prefillNames={booking.attendee_names ?? null}
          canEdit
          startInEdit
          onSaved={() => { void onSaved(); onClose() }}
          onCancel={onClose}
        />
      )}
    </Modal>
  )
}
