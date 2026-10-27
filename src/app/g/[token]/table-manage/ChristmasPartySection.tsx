import {
  GuestChoice,
  GuestField,
  GuestInput,
  guestFieldControlProps,
  GuestSection,
  GUEST_BODY_CLASS,
  GUEST_MUTED_CLASS,
} from '@/components/features/guest'
import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { CHRISTMAS_MAX_PARTY_SIZE, CHRISTMAS_MIN_PARTY_SIZE } from '@/lib/table-bookings/christmas'
import type { GuestChristmasParty } from './christmas-party-data'

type ChristmasPartySectionProps = GuestChristmasParty & {
  actionUrl: string
}

const LEGEND_CLASS = 'px-1 font-anchor-body text-guest-body font-bold leading-guest-snug text-guest-text-strong'

/** The tiers a guest can join on, with the form field each one posts. */
const JOIN_FIELDS = [
  { name: 'add_1', label: 'On 1 course' },
  { name: 'add_2', label: 'On 2 courses' },
  { name: 'add_3', label: 'On 3 courses' },
] as const

function seatLabel(seat: number, tier: number, name: string | null): string {
  const courses = tier === 1 ? '1 course' : `${tier} courses`
  return name ? `Guest ${seat} (${name}), ${courses}` : `Guest ${seat}, ${courses}`
}

/**
 * The numbers on a Christmas booking, changed by the booker until noon seven days before the date
 * (owner decision D21, BK-053). The booker ticks anyone not coming, so that guest's own food choices
 * go and nobody else's move, and adds guests on 1, 2 or 3 courses. After the deadline, or on a
 * booking with no courses recorded, the page asks them to ring instead, because a manager makes the
 * change then. Plain server-rendered HTML posting to the route next door, like the rest of the page.
 */
export function ChristmasPartySection({ courseCounts, seatNames, canChangeOnline, closesAt, actionUrl }: ChristmasPartySectionProps) {
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
      } Christmas bookings are for ${CHRISTMAS_MIN_PARTY_SIZE} to ${CHRISTMAS_MAX_PARTY_SIZE} guests.`}
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
          <p className={GUEST_MUTED_CLASS}>
            Guests joining on 2 or 3 courses choose their food in the food choices section once you&apos;ve saved.
          </p>
          <div className="grid grid-cols-1 gap-guest-md sm:grid-cols-3">
            {JOIN_FIELDS.map((field) => (
              <GuestField key={field.name} id={`christmas-${field.name}`} label={field.label}>
                <GuestInput
                  {...guestFieldControlProps({ id: `christmas-${field.name}` })}
                  name={field.name}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={String(CHRISTMAS_MAX_PARTY_SIZE - CHRISTMAS_MIN_PARTY_SIZE)}
                  defaultValue="0"
                />
              </GuestField>
            ))}
          </div>
        </fieldset>

        <div>
          <GuestSubmitButton loadingText="Saving...">Update numbers</GuestSubmitButton>
        </div>
      </form>
    </GuestSection>
  )
}
