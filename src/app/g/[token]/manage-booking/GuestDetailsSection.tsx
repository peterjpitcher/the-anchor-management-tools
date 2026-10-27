import { randomUUID } from 'crypto'
import {
  GuestButton,
  GuestCard,
  GuestCardHeader,
  GuestChoice,
  GuestField,
  GuestInput,
  GuestSelect,
  GuestTextarea,
  guestFieldControlProps,
  GUEST_MUTED_CLASS,
} from '@/components/features/guest'
import type { BookingQuestion, StoredEventAttendee } from '@/lib/events/booking-questions'
import { guestDetailsForEditing } from '@/lib/events/guest-details-edit'
import { displayAnswer } from '@/lib/events/guest-answers'

/** Shown beside the guest details, the same promise the website booking form makes (BK-017). */
const MANAGE_GUEST_DETAILS_PRIVACY_LINE =
  'Only add people who are happy to share these details with us. We use their answers for this event only, and delete them 90 days after it.'
const MANAGE_GUEST_DETAILS_CONFIRM_LABEL = "Everyone I've added is happy to share these details."

/**
 * The booker adds or corrects each guest's name and answers from their manage link, until online
 * sales close (BK-016, customer bookings review of 24 October 2026). A plain form posted to the
 * action route, so it works with no JavaScript, like the rest of this page.
 */
export function GuestDetailsSection({
  token,
  seats,
  attendees,
  questions,
  editable,
}: {
  token: string
  seats: number
  attendees: StoredEventAttendee[]
  questions: BookingQuestion[]
  editable: boolean
}): React.JSX.Element {
  const rows = guestDetailsForEditing({ current: attendees, questions, seats, newId: randomUUID })

  if (!editable) {
    return (
      <GuestCard>
        <GuestCardHeader title="Who is coming" />
        {attendees.length === 0 ? (
          <p className={GUEST_MUTED_CLASS}>No guest details were added. Call us if you need to add them.</p>
        ) : (
          <ul className="flex flex-col gap-guest-sm">
            {attendees.map((guest) => (
              <li key={guest.id}>
                <p className="font-semibold">{guest.name}</p>
                {(guest.answers ?? []).filter((answer) => answer.value?.trim()).map((answer) => (
                  <p key={answer.question_id} className={GUEST_MUTED_CLASS}>{answer.label}: {displayAnswer(answer.type, answer.value.trim())}</p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </GuestCard>
    )
  }

  return (
    <GuestCard>
      <GuestCardHeader title="Who is coming" />
      <form method="post" action={`/g/${token}/manage-booking/action`} className="flex flex-col gap-guest-lg">
        <input type="hidden" name="intent" value="update_guest_details" />
        <p className={GUEST_MUTED_CLASS}>{MANAGE_GUEST_DETAILS_PRIVACY_LINE}</p>
        {rows.map((guest, index) => (
          <fieldset key={guest.id} className="flex flex-col gap-guest-md">
            <legend className="font-semibold">Ticket {index + 1}</legend>
            <input type="hidden" name="guest_id" value={guest.id} />
            <GuestField id={`guest_name_${index}`} label={`Ticket ${index + 1} full name`} required>
              <GuestInput
                {...guestFieldControlProps({ id: `guest_name_${index}` })}
                name={`guest_name_${index}`}
                defaultValue={guest.name}
                maxLength={120}
                required
              />
            </GuestField>
            {guest.answers.map((answer) => {
              const fieldId = `answer_${index}_${answer.question_id}`
              const label = `${answer.label} (${answer.required ? 'required' : 'optional'})`
              return (
                <GuestField key={answer.question_id} id={fieldId} label={label}>
                  {answer.type === 'text' ? (
                    <GuestTextarea {...guestFieldControlProps({ id: fieldId })} name={fieldId} defaultValue={answer.value} maxLength={2000} />
                  ) : (
                    <GuestSelect {...guestFieldControlProps({ id: fieldId })} name={fieldId} defaultValue={answer.value}>
                      <option value="">Choose an answer</option>
                      {(answer.type === 'yes_no' ? ['yes', 'no'] : answer.options ?? []).map((option) => (
                        <option key={option} value={option}>{displayAnswer(answer.type, option)}</option>
                      ))}
                    </GuestSelect>
                  )}
                </GuestField>
              )
            })}
          </fieldset>
        ))}
        <GuestChoice id="details_confirmed" type="checkbox" name="details_confirmed" value="yes" required label={MANAGE_GUEST_DETAILS_CONFIRM_LABEL} />
        <GuestButton as="button" type="submit" variant="primary" size="md" fullWidth="mobile">
          Save guest details
        </GuestButton>
      </form>
    </GuestCard>
  )
}
