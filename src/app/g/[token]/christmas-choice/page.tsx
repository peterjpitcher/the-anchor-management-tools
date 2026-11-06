import { headers } from 'next/headers'
import { DetailRow, GuestBlockedState, GuestCard, GuestIntro, GuestShell } from '@/components/features/guest'
import { checkGuestTokenThrottle } from '@/lib/guest/token-throttle'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { logger } from '@/lib/logger'
import { createAdminClient } from '@/lib/supabase/admin'
import { formatBookingDateForEmail, formatBookingTimeForEmail } from '@/lib/table-bookings/guest-emails'
import { formatPreorderCutoffForGuest, preorderClosedMessage } from '@/lib/table-bookings/preorder-food-link-emails'
import { FoodLines } from '../table-manage/FoodLines'
import { FoodMenuPanel } from '../table-manage/FoodMenuPanel'
import { buildFoodMenu, buildFoodSeatView, loadChristmasTierPrices } from '../table-manage/food-data'
import type { FoodSeatView } from '../table-manage/food-types'
import { loadBookerPreorderView } from '../table-manage/preorder-data'
import { loadGuestChoiceContext, type GuestChoiceBlockReason } from './guest-data'

/**
 * One guest's own Christmas dinner, from the link the organiser asked us to email them (D5).
 *
 * Shows that guest's line only, with the same menu panel and the booking's date and time. Never
 * other guests, the organiser's details, or any way to cancel or change the booking. Saves through
 * the route next door as the guest, and is read only after the cutoff (D8).
 */

// Static and non-personal on purpose, like every guest page's title (tests/app/guestPageTitles.test.ts
// holds every guest page to this exact shape). Not indexed: the middleware sends X-Robots-Tag:
// noindex for every /g/ route, and the page says so too with `NoIndex`, which React hoists into the head.
export const metadata = { title: 'Christmas dinner - The Anchor' }

function NoIndex() {
  return <meta name="robots" content="noindex, nofollow" />
}

const KICKER = 'Christmas dinner'

function blockedReason(reason: GuestChoiceBlockReason | 'rate_limited' | 'error'): string {
  switch (reason) {
    case 'expired_token':
      return 'Choices have closed for this booking, so this link no longer works.'
    case 'booking_closed':
      return 'This booking is no longer open for food choices.'
    case 'switched_off':
      return "Food choices aren't open online just now."
    case 'seat_missing':
      return "We couldn't find your place on this booking. The numbers may have changed."
    case 'rate_limited':
      return 'Too many attempts were made with this link. Please wait a few minutes and try again.'
    case 'error':
      return "We couldn't load your choices just now."
    default:
      return "This link isn't valid."
  }
}

function Blocked({ reason }: { reason: GuestChoiceBlockReason | 'rate_limited' | 'error' }) {
  return (
    <GuestShell>
      <NoIndex />
      <GuestBlockedState
        kicker={KICKER}
        heading="Choose your Christmas dinner"
        lead={`Call us on ${GUEST_CONTACT.phoneDisplay} and we'll take your choices over the phone.`}
        reason={blockedReason(reason)}
        primaryAction={{ label: `Call ${GUEST_CONTACT.phoneDisplay}`, href: GUEST_CONTACT.telHref }}
        secondaryAction={{ label: 'Back to The Anchor', href: GUEST_CONTACT.website }}
      />
    </GuestShell>
  )
}

export default async function ChristmasChoicePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const throttle = await checkGuestTokenThrottle({
    headers: await headers(),
    rawToken: token,
    scope: 'guest_christmas_choice_view',
    maxAttempts: 80,
  })
  if (!throttle.allowed) return <Blocked reason="rate_limited" />

  const supabase = createAdminClient()
  let context: Awaited<ReturnType<typeof loadGuestChoiceContext>>
  let view: Awaited<ReturnType<typeof loadBookerPreorderView>> = null
  try {
    context = await loadGuestChoiceContext(supabase, token)
    if (context.ok) view = await loadBookerPreorderView(supabase, context.order.tableBookingId)
  } catch (error) {
    logger.error('Guest food link page could not load', {
      error: error instanceof Error ? error : new Error(String(error)),
    })
    return <Blocked reason="error" />
  }
  if (!context.ok) return <Blocked reason={context.reason} />
  if (!view) return <Blocked reason="booking_closed" />

  const { order } = view
  const prices = await loadChristmasTierPrices(supabase, order.bookingDate).catch((error: unknown) => {
    logger.error('Guest food link page could not load the Christmas prices', {
      error: error instanceof Error ? error : new Error(String(error)),
      metadata: { tableBookingId: order.tableBookingId },
    })
    return null
  })

  const cover = order.covers.find((entry) => entry.id === context.cover.id) ?? context.cover
  // The guest never sees who was invited or when.
  const seat: FoodSeatView = {
    ...buildFoodSeatView(order, cover.ordinal),
    inviteEmail: null,
    inviteSentAt: null,
    canResendInvite: false,
  }
  const menu = buildFoodMenu(view)
  const deadlineLabel = view.cutoff.at ? formatPreorderCutoffForGuest(view.cutoff.at) : null
  const date = formatBookingDateForEmail(order.bookingDate, context.startDateTime)
  const time = formatBookingTimeForEmail(order.bookingTime, context.startDateTime)

  return (
    <GuestShell width="wide">
      <NoIndex />
      <GuestIntro
        kicker={KICKER}
        title="Choose your Christmas dinner"
        lead="You've been asked to choose your own food for a Christmas booking at The Anchor. Only your choices are on this page."
      />

      <GuestCard variant="accent">
        <div>
          {date && <DetailRow label="Date" value={date} />}
          {time && <DetailRow label="Time" value={time} />}
          {deadlineLabel && <DetailRow label="Choose by" value={deadlineLabel} />}
        </div>
      </GuestCard>

      <FoodMenuPanel prices={prices} menu={menu} phoneDisplay={GUEST_CONTACT.phoneDisplay} dishesOpen />

      <FoodLines
        mode="guest"
        endpoint={`/g/${token}/christmas-choice/save`}
        seats={[seat]}
        menu={menu}
        locked={!view.cutoff.editable}
        closedMessage={preorderClosedMessage(view.cutoff.at)}
        deadlineLabel={deadlineLabel}
        phoneDisplay={GUEST_CONTACT.phoneDisplay}
      />
    </GuestShell>
  )
}
