import { GuestBlockedState, GuestShell } from '@/components/features/guest'
import { GUEST_CONTACT } from '@/lib/guest-contact'

/**
 * The 404 boundary for every `/parking/*` miss, including a guest arriving with
 * a booking id that no longer exists.
 *
 * The phone number comes from `GUEST_CONTACT` rather than
 * `NEXT_PUBLIC_CONTACT_PHONE_NUMBER`: that variable is documented as a Twilio
 * sending number (`docs/DEPLOYMENT.md`) and is a placeholder in `.env.example`,
 * so it can print something that is not the pub's landline. Guest contact facts
 * have one source per the spec (F26).
 */
export default function ParkingNotFound() {
  return (
    <GuestShell>
      <GuestBlockedState
        kicker="Guest parking"
        heading="Booking link not found"
        lead="We could not find that parking booking."
        reason="Please check the link, or contact the team and quote your parking reference if you have one."
        primaryAction={{ label: 'Return to The Anchor website', href: GUEST_CONTACT.website }}
      />
    </GuestShell>
  )
}
