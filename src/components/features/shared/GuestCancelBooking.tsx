import { CANCELLATION_REASONS, CANCELLATION_DETAIL_MAX_LENGTH } from '@/lib/table-bookings/cancellation-reasons'
// Imported file by file rather than through the `guest` barrel on purpose: the barrel pulls in
// `GuestShell` and with it the guest webfont module, which this component has no need of.
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestChoice } from '@/components/features/guest/GuestChoice'
import { GuestTextarea } from '@/components/features/guest/GuestControls'
import { GuestField } from '@/components/features/guest/GuestField'
import { GuestLink } from '@/components/features/guest/GuestLink'
import { GuestSection } from '@/components/features/guest/GuestSection'
import { GUEST_NOTE_CLASS } from '@/components/features/guest/styles'

/**
 * Cancel booking section for the guest manage page.
 *
 * Uses URL state for the confirmation step so the first click works even if the browser has not
 * hydrated the React client yet.
 *
 * The confirmation step offers two routes, on purpose:
 *
 *   - A form POST carrying an optional reason. This is the normal path.
 *   - A plain GET link that cancels with no reason at all. This is the fallback for sandboxed frames
 *     without `allow-forms`, which block form submission before it reaches the server, and it is why
 *     the original implementation used a link. It doubles as the honest answer to "answering is
 *     optional": a guest who would rather not say just uses the link.
 *
 * Nobody is ever prevented from cancelling because they will not give a reason.
 */
export function GuestCancelBooking({
  actionUrl,
  confirmCancel,
  manageUrl,
  refundNotice = null,
}: {
  actionUrl: string
  confirmCancel: boolean
  manageUrl: string
  /**
   * What happens to the deposit, shown at the confirmation step. Cancelling from this page
   * refunds the deposit under the booking's own terms, so the guest is told those terms before
   * they confirm rather than finding out from their bank.
   */
  refundNotice?: string | null
}): React.JSX.Element {
  if (!confirmCancel) {
    return (
      <GuestSection>
        <div className="flex flex-col gap-2">
          <GuestButton as="a" href={`${manageUrl}?confirmCancel=1`} variant="danger" fullWidth>
            Cancel booking
          </GuestButton>
          <p className={GUEST_NOTE_CLASS}>
            If you can let us know early, we can offer the table to someone else.
          </p>
        </div>
      </GuestSection>
    )
  }

  return (
    <GuestSection>
      <GuestCard variant="danger">
        <div className="flex flex-col gap-guest-md">
          <div className="flex flex-col gap-1">
            <p className="font-anchor-body text-guest-lead font-bold leading-guest-snug text-anchor-danger">
              Are you sure you want to cancel?
            </p>
            <p className="font-anchor-body text-guest-small text-guest-text">This cannot be undone.</p>
            {refundNotice && (
              <p className="font-anchor-body text-guest-small text-guest-text">{refundNotice}</p>
            )}
          </div>

          <form method="post" action={actionUrl} className="flex flex-col gap-guest-md">
            <input type="hidden" name="action" value="cancel" />
            <input type="hidden" name="confirm" value="1" />

            <fieldset className="flex flex-col gap-2">
              <legend className="font-anchor-body text-guest-body font-semibold leading-guest-snug text-guest-text">
                If you don&apos;t mind us asking, why?
              </legend>
              <p className={GUEST_NOTE_CLASS}>Entirely optional, and it helps us put things right.</p>

              <div>
                {CANCELLATION_REASONS.map((reason) => (
                  // The whole row is the label, so the full 44px target is clickable rather than
                  // just the radio and its text.
                  <GuestChoice
                    key={reason.code}
                    type="radio"
                    id={`cancellation_reason_${reason.code}`}
                    name="cancellation_reason"
                    value={reason.code}
                    label={reason.label}
                  />
                ))}
              </div>

              <GuestField id="cancellation_reason_detail" label="Anything else you'd like to tell us">
                <GuestTextarea
                  id="cancellation_reason_detail"
                  name="cancellation_reason_detail"
                  rows={2}
                  maxLength={CANCELLATION_DETAIL_MAX_LENGTH}
                />
              </GuestField>
            </fieldset>

            <div className="flex flex-col gap-2.5 sm:flex-row">
              <GuestButton type="submit" variant="destructive" fullWidth="mobile">
                Yes, cancel my booking
              </GuestButton>
              <GuestButton as="a" href={manageUrl} variant="outline" fullWidth="mobile">
                No, keep my booking
              </GuestButton>
            </div>
          </form>

          {/*
            Fallback for sandboxed frames that block form submission, and for anyone who would rather
            not answer. Cancels with no reason recorded.
          */}
          <p className={GUEST_NOTE_CLASS}>
            <GuestLink href={`${actionUrl}?action=cancel&confirm=1`} rel="nofollow">
              Cancel without giving a reason
            </GuestLink>
          </p>
        </div>
      </GuestCard>
    </GuestSection>
  )
}
