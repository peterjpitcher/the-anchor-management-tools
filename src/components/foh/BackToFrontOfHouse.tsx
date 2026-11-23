import { LinkButton } from '@/ds'

const FRONT_OF_HOUSE_HREF = '/table-bookings/foh'
const BACK_TO_FRONT_OF_HOUSE_LABEL = 'Back to Front of House'

/**
 * The one way back to the floor screen from every page the till opens (checklists, vouchers,
 * parking, a booking's sheet). Owner request, 23 November 2026: the button must not move from
 * page to page. So every till page renders this, and only this, as the LAST item of its
 * PageLayout `headerActions` (with `showHeaderActionsOnMobile`): header actions are right-aligned,
 * so the last one sits hard against the right edge in the same place on every page. Any other
 * header button goes before it, never after, and no page uses PageLayout's `backButton` as well.
 */
export function BackToFrontOfHouse(): React.JSX.Element {
  return (
    <LinkButton href={FRONT_OF_HOUSE_HREF} variant="primary" size="lg" className="min-h-touch whitespace-nowrap">
      {BACK_TO_FRONT_OF_HOUSE_LABEL}
    </LinkButton>
  )
}
