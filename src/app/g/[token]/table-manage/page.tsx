import { createAdminClient } from '@/lib/supabase/admin'
import { headers } from 'next/headers'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { formatGuestGreeting, getCustomerFirstNameById } from '@/lib/guest/names'
import { getTableManagePreviewByRawToken } from '@/lib/table-bookings/manage-booking'
import {
  DetailRow,
  GuestAlert,
  GuestBadge,
  GuestBlockedState,
  GuestButton,
  GuestCard,
  GuestField,
  GuestShell,
  guestBadgeToneForStatus,
  guestFieldControlProps,
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_TEXTAREA_CLASS,
} from '@/components/features/guest'
import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import { GuestCancelBooking } from '@/components/features/shared/GuestCancelBooking'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { GUEST_SUBMIT_PRIMARY_CLASS } from './formStyles'
import { loadBookerPreorderView, type BookerPreorderView } from './preorder-data'
import { PreorderSection } from './PreorderSection'

/** Names the flow at the top of the page, per the approved kicker list. */
// Static and non-personal on purpose: no token, customer name or booking reference may reach
// a browser title or history entry. This route is noindex via the X-Robots-Tag header.
export const metadata = { title: 'Manage your booking - The Anchor' }

const KICKER = 'Table booking'

/*
  What the special-requirements box is for, said before the guest types rather than buried in a
  privacy page. Dietary and allergy details are special-category data, and the condition we rely on
  is the guest telling us themselves so we can cater for them. That only holds if they were told
  what it is used for at the point of asking, so this line is the basis, not decoration. It must
  stay ABOVE the textarea, which is where `GuestField` renders a hint.

  It also names the phone as the route for a serious allergy. A text box read hours later by
  whoever is on shift is not a safe channel for something that could put someone in hospital, and
  saying so is more honest than implying the box is enough.
*/
const NOTES_HINT = `Only our kitchen and floor team see this, and we keep it so we can cater for you on a future visit. If you have a serious allergy, please ring us on ${GUEST_CONTACT.phoneDisplay} as well, so we can talk it through properly.`

function formatDateTime(value?: string | null): string {
  if (!value) return 'Unknown'

  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h12'
    }).format(new Date(value))
  } catch {
    return 'Unknown'
  }
}

function humanizeStatus(status?: string | null): string {
  switch (status) {
    case 'confirmed':
      return 'Confirmed'
    case 'pending_deposit':
      return 'Awaiting deposit'
    case 'cancelled':
      return 'Cancelled'
    case 'no_show':
      return 'No show'
    case 'completed':
      return 'Completed'
    case 'seated':
      return 'Seated'
    default:
      return status ? status.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase()) : 'Unknown'
  }
}

function mapBlockedReason(reason?: string): string {
  switch (reason) {
    case 'invalid_token':
      return 'This manage booking link is not valid.'
    case 'booking_not_found':
      return 'This booking was not found.'
    case 'token_customer_mismatch':
      return 'This link does not match the booking.'
    case 'booking_time_missing':
      return 'Booking time details are missing.'
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    default:
      return 'This booking cannot be managed with this link.'
  }
}

function statusMessage(status?: string): { tone: 'green' | 'amber' | 'red'; text: string } | null {
  switch (status) {
    case 'updated':
      return { tone: 'green', text: 'Booking updated.' }
    case 'cancelled':
      return { tone: 'green', text: 'Booking cancelled.' }
    case 'charge_requested':
      return { tone: 'amber', text: 'Booking updated. A fee may apply for reducing your party size.' }
    case 'late_cancel_charge_requested':
      return { tone: 'amber', text: 'Booking cancelled. A late-cancellation fee may apply.' }
    case 'error':
      return { tone: 'red', text: 'We could not process that request. Please try again.' }
    case 'rate_limited':
      return { tone: 'red', text: 'Too many attempts were made. Please wait a few minutes and try again.' }
    default:
      return null
  }
}

function preorderMessage(preorder?: string): { tone: 'green' | 'amber' | 'red'; text: string } | null {
  switch (preorder) {
    case 'saved':
      return { tone: 'green', text: 'Food choices saved.' }
    case 'seats_removed':
      return {
        tone: 'amber',
        text: 'Party size updated. We have removed the food choices for the seats you dropped.'
      }
    case 'error':
      return { tone: 'red', text: 'We could not save your food choices. Please check the seats marked below.' }
    case 'rate_limited':
      return {
        tone: 'red',
        text: 'Too many saves in a short time. Please wait a few minutes and try again.'
      }
    default:
      return null
  }
}

/** The banner tones these pages have always used, in the design system's vocabulary. */
function alertTone(tone: 'green' | 'amber' | 'red'): 'success' | 'notice' | 'problem' {
  if (tone === 'green') return 'success'
  if (tone === 'amber') return 'notice'
  return 'problem'
}

export default async function TableManageBookingPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ confirmCancel?: string; status?: string; preorder?: string; seat?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const manageUrl = `/g/${token}/table-manage`
  const actionUrl = `${manageUrl}/action`
  const confirmCancel = query.confirmCancel === '1'
  const headerValues = await headers()
  const throttle = await checkGuestTokenThrottle({
    headers: headerValues,
    rawToken: token,
    scope: 'guest_table_manage_view',
    maxAttempts: 80
  })

  if (!throttle.allowed) {
    return (
      <GuestShell maxWidthClassName="max-w-2xl">
        <GuestBlockedState
          kicker={KICKER}
          heading="Manage booking unavailable"
          lead={formatGuestGreeting(null, 'we could not load your booking details right now.')}
          reason={mapBlockedReason('rate_limited')}
          primaryAction={{ label: `Call ${GUEST_CONTACT.phoneDisplay}`, href: GUEST_CONTACT.telHref }}
          secondaryAction={{ label: 'Back to The Anchor', href: GUEST_CONTACT.website }}
        />
      </GuestShell>
    )
  }

  const supabase = createAdminClient()
  const preview = await getTableManagePreviewByRawToken(supabase, token)

  const banner = statusMessage(query.status)

  if (preview.state !== 'ready') {
    return (
      <GuestShell maxWidthClassName="max-w-2xl">
        <GuestBlockedState
          kicker={KICKER}
          heading="Manage booking unavailable"
          lead={formatGuestGreeting(null, 'we could not load your booking details right now.')}
          reason={mapBlockedReason(preview.reason)}
          primaryAction={{ label: `Call ${GUEST_CONTACT.phoneDisplay}`, href: GUEST_CONTACT.telHref }}
          secondaryAction={{ label: 'Back to The Anchor', href: GUEST_CONTACT.website }}
        />
      </GuestShell>
    )
  }

  const guestFirstName = await getCustomerFirstNameById(supabase, preview.customer_id)

  // Deliberately not gated on `can_edit`: that also refuses a booking still awaiting its deposit,
  // which is exactly the Christmas case. A booking that is off the books shows nothing.
  const bookingIsLive = preview.status !== 'cancelled' && preview.status !== 'no_show'

  let preorderView: BookerPreorderView | null = null
  // Told apart from "this booking has no pre-order" on purpose: a null view is a booking that was
  // never going to show food choices, while this is a booking that should have and could not.
  let preorderLoadFailed = false
  if (bookingIsLive && preview.table_booking_id) {
    try {
      preorderView = await loadBookerPreorderView(supabase, preview.table_booking_id)
    } catch (error) {
      // A fault in the pre-order section must not take the whole page down with it. The booking
      // details and the cancel button are what this link exists for, and a guest who cannot cancel
      // because the Christmas menu failed to load is a worse outcome than a missing form.
      //
      // Silence is worse still. A guest who followed a "choose your food" reminder used to land on
      // a page with no food section, no reason and no way forward, so the failure is now said out
      // loud with the phone number on it (spec F28).
      preorderLoadFailed = true
      logger.warn('Guest table-manage could not load the pre-order section', {
        metadata: {
          tableBookingId: preview.table_booking_id,
          error: error instanceof Error ? error.message : String(error)
        }
      })
    }
  }

  const preorderBanner = preorderMessage(query.preorder)
  const errorSeat = Number.parseInt(query.seat || '', 10)
  const bookingReference = preview.booking_reference || preview.table_booking_id
  const statusLabel = humanizeStatus(preview.status)

  return (
    <GuestShell maxWidthClassName="max-w-2xl">
      <section className="flex w-full flex-col gap-5">
        <div className={GUEST_INTRO_CLASS}>
          <p className={GUEST_KICKER_CLASS}>{KICKER}</p>
          <h1 className={GUEST_H1_CLASS}>Manage table booking</h1>
          <p className={GUEST_LEAD_CLASS}>
            {formatGuestGreeting(guestFirstName, 'your booking details are below.')}
          </p>
        </div>

        {/* `role="alert"` on both banners is what this page has always sent. Kept verbatim. */}
        {banner && (
          <GuestAlert tone={alertTone(banner.tone)} role="alert">
            {banner.text}
          </GuestAlert>
        )}

        {preorderBanner && (
          <GuestAlert tone={alertTone(preorderBanner.tone)} role="alert">
            {preorderBanner.text}
          </GuestAlert>
        )}

        <GuestCard variant="accent">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-[3px]">
              <span className="font-anchor-body text-[11px] font-semibold uppercase leading-none tracking-[0.1em] text-guest-text-muted">
                Booking
              </span>
              <span className="break-words font-anchor-display text-[26px] font-normal leading-[1.15] text-guest-text-strong">
                {bookingReference}
              </span>
            </div>

            <GuestBadge tone={guestBadgeToneForStatus(statusLabel)} dot className="mt-1">
              {statusLabel}
            </GuestBadge>
          </div>

          <div className="mt-4">
            <DetailRow label="Time" value={formatDateTime(preview.start_datetime)} />
            <DetailRow
              label="Table"
              value={preview.is_outside_seating ? 'Outside' : (preview.table_name || 'Unassigned')}
            />
            <DetailRow label="Party size" value={preview.party_size || 1} />
          </div>
        </GuestCard>

        {!preview.can_edit ? (
          <GuestCard>
            <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
              Booking changes are no longer available. Please call to make any changes.
            </p>
          </GuestCard>
        ) : (
          <GuestCard>
            <form method="post" action={actionUrl} className="flex flex-col gap-5">
              <input type="hidden" name="action" value="update" />

              <GuestField id="party_size" label="Party size" required>
                <input
                  {...guestFieldControlProps({ id: 'party_size', required: true })}
                  name="party_size"
                  type="number"
                  min="1"
                  max="20"
                  defaultValue={String(preview.party_size || 1)}
                  className={GUEST_INPUT_CLASS}
                />
              </GuestField>

              <GuestField id="notes" label="Special requirements" hint={NOTES_HINT}>
                <textarea
                  {...guestFieldControlProps({ id: 'notes', hint: NOTES_HINT })}
                  name="notes"
                  rows={3}
                  defaultValue={preview.special_requirements || ''}
                  placeholder="Allergies, dietary needs, accessibility requirements, etc."
                  className={cn(GUEST_INPUT_CLASS, GUEST_TEXTAREA_CLASS)}
                />
              </GuestField>

              <div>
                <GuestSubmitButton className={GUEST_SUBMIT_PRIMARY_CLASS} loadingText="Saving...">
                  Save changes
                </GuestSubmitButton>
              </div>
            </form>
          </GuestCard>
        )}

        {preorderLoadFailed && (
          <GuestAlert
            tone="problem"
            title="We could not load your food choices"
            action={
              <GuestButton as="a" href={GUEST_CONTACT.telHref} variant="outline" size="sm">
                Call {GUEST_CONTACT.phoneDisplay}
              </GuestButton>
            }
          >
            Your booking itself is fine, and you can still change or cancel it on this page. Please
            ring us and we will take your food choices over the phone.
          </GuestAlert>
        )}

        {preorderView && (
          <PreorderSection
            {...preorderView}
            actionUrl={actionUrl}
            errorSeat={Number.isFinite(errorSeat) && errorSeat > 0 ? errorSeat : null}
          />
        )}

        {preview.can_cancel && (
          <GuestCancelBooking
            actionUrl={actionUrl}
            confirmCancel={confirmCancel}
            manageUrl={manageUrl}
          />
        )}
      </section>
    </GuestShell>
  )
}
