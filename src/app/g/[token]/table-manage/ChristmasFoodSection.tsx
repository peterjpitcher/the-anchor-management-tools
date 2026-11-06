import { GuestSection } from '@/components/features/guest/GuestSection'
import { GUEST_BODY_CLASS } from '@/components/features/guest/styles'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import { formatPreorderCutoffForGuest, preorderClosedMessage } from '@/lib/table-bookings/preorder-food-link-emails'
import { FoodLines } from './FoodLines'
import { FoodMenuPanel } from './FoodMenuPanel'
import type { FoodMenu, FoodSeatView, FoodTierPrices } from './food-types'
import type { PreorderCutoff } from './preorder-data'

/**
 * The organiser's food page, on the manage link they already have (spec section 2, step 3).
 *
 * Top: the deadline, progress and the menu panel. Then a line per guest, each saved on its own, each
 * able to send that guest their own link (D5). After the cutoff everything is read only (D8).
 */

export type ChristmasFoodSectionProps = {
  seats: FoodSeatView[]
  menu: FoodMenu
  /** Null when the Christmas menu prices could not be read. */
  prices: FoodTierPrices | null
  cutoff: PreorderCutoff
  /** The organiser's JSON route, `/g/<token>/table-manage/food`. */
  endpoint: string
  /** The `table_preorder_choices_copy` switch. */
  copyEnabled: boolean
}

export function ChristmasFoodSection({ seats, menu, prices, cutoff, endpoint, copyEnabled }: ChristmasFoodSectionProps) {
  const deadlineLabel = cutoff.at ? formatPreorderCutoffForGuest(cutoff.at) : null
  const locked = !cutoff.editable

  return (
    <GuestSection
      title="Choose everyone's food"
      titleId="preorder-heading"
      description="Every guest needs a name, their allergies, their number of courses and their dishes. Save each guest as you go, or send them a link to choose their own."
    >
      {!locked && (
        <p className={GUEST_BODY_CLASS}>
          {deadlineLabel ? (
            <>
              Choose by <span className="font-semibold">{deadlineLabel}</span>. That&apos;s when the kitchen orders.
            </>
          ) : (
            'Choose as soon as you can, so the kitchen can order.'
          )}
        </p>
      )}

      <FoodMenuPanel prices={prices} menu={menu} phoneDisplay={GUEST_CONTACT.phoneDisplay} />

      <FoodLines
        mode="organiser"
        endpoint={endpoint}
        seats={seats}
        menu={menu}
        locked={locked}
        closedMessage={preorderClosedMessage(cutoff.at)}
        deadlineLabel={deadlineLabel}
        copyEnabled={copyEnabled}
        phoneDisplay={GUEST_CONTACT.phoneDisplay}
      />
    </GuestSection>
  )
}
