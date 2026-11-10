import {
  GuestChoice,
  GuestField,
  GuestInput,
  guestFieldControlProps,
  GuestSection,
  GUEST_BODY_CLASS,
} from '@/components/features/guest'
import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { CHRISTMAS_MIN_PARTY_SIZE } from '@/lib/table-bookings/christmas'
import type { GuestChristmasParty } from './christmas-party-data'

type ChristmasPartySectionProps = GuestChristmasParty & {
  actionUrl: string
}

const LEGEND_CLASS = 'px-1 font-anchor-body text-guest-body font-bold leading-guest-snug text-guest-text-strong'

/** "Guest 2 (Sam), 3 courses". A guest on 0 has not chosen their number of courses yet. */
function seatLabel(seat: number, tier: number, name: string | null): string {
  const courses = tier === 0 ? 'courses not chosen yet' : tier === 1 ? '1 course' : `${tier} courses`
  return name ? `Guest ${seat} (${name}), ${courses}` : `Guest ${seat}, ${courses}`
}

/**
 * The numbers on a Christmas booking, changed by the booker until noon seven days before the date
 * (owner decision D21, BK-053). The booker ticks anyone not coming, so that guest's own food choices
 * go and nobody else's move, and says how many are joining. A guest who joins chooses their number
 * of courses and their dishes on the food page, like everyone else (D4), so the form asks only how
 * many. Seats still on 0 (courses not chosen yet) are listed like any other. After the deadline, or on a
 * booking with no courses recorded, the page asks them to ring instead, because a manager makes the
 * change then. Plain server-rendered HTML posting to the route next door, like the rest of the page.
 */
export function ChristmasPartySection({
  courseCounts,
  seatNames,
  canChangeOnline,
  closesAt,
  maxPartySize,
  actionUrl,
}: ChristmasPartySectionProps) {
  const phone = GUEST_CONTACT.phoneDisplay

  if (!courseCounts) {
    return (
      <GuestSection title="Your Christmas numbers" titleId="christmas-numbers-heading">
        <p className={GUEST_BODY_CLASS}>To change numbers for Christmas dinner, please call us on {phone}.</p>
      </GuestSection>
    )
  }

  if (!canChangeOnline) {
    return (
      <GuestSection title="Your Christmas numbers" titleId="christmas-numbers-heading">
        <p className={GUEST_BODY_CLASS}>
          The deadline for changing your Christmas numbers online has passed. Please call us on {phone} and
          we&apos;ll help.
        </p>
      </GuestSection>
    )
  }

  return (
    <GuestSection
      title="Your Christmas numbers"
      titleId="christmas-numbers-heading"
      description={`${
        closesAt
          ? `You can change your numbers here until ${formatDateTime12Hour(closesAt)}. After that, please call us.`
          : 'You can change your numbers here until the pre-order deadline. After that, please call us.'
      } Online, Christmas bookings are for ${CHRISTMAS_MIN_PARTY_SIZE} to ${maxPartySize} guests.`}
    >
      <form method="post" action={actionUrl} className="flex flex-col gap-guest-lg">
        <input type="hidden" name="action" value="christmas_party" />
        <input type="hidden" name="expected_courses" value={courseCounts.join(',')} />

        <fieldset className="flex flex-col gap-guest-xs">
          <legend className={LEGEND_CLASS}>Anyone not coming?</legend>
          <ul>
            {courseCounts.map((tier, index) => {
              const seat = index + 1
              return (
                <li key={seat}>
                  <GuestChoice
                    type="checkbox"
                    id={`christmas-remove-${seat}`}
                    name="remove_seat"
                    value={String(seat)}
                    label={seatLabel(seat, tier, seatNames[index] ?? null)}
                  />
                </li>
              )
            })}
          </ul>
        </fieldset>

        <fieldset className="flex flex-col gap-guest-md">
          <legend className={LEGEND_CLASS}>Anyone joining?</legend>
          <GuestField
            id="christmas-add-guests"
            label="How many more guests?"
            hint="Once you've saved, add their names, allergies, courses and dishes in the food section below."
          >
            <GuestInput
              {...guestFieldControlProps({
                id: 'christmas-add-guests',
                hint: "Once you've saved, add their names, allergies, courses and dishes in the food section below.",
              })}
              name="add_guests"
              type="number"
              inputMode="numeric"
              min="0"
              max={String(Math.max(0, maxPartySize - CHRISTMAS_MIN_PARTY_SIZE))}
              defaultValue="0"
              className="sm:max-w-40"
            />
          </GuestField>
        </fieldset>

        <div>
          <GuestSubmitButton loadingText="Saving...">Update numbers</GuestSubmitButton>
        </div>
      </form>
    </GuestSection>
  )
}
