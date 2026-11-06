import { GUEST_BODY_CLASS, GUEST_MUTED_CLASS, GUEST_NOTE_CLASS, GUEST_SUNK_BOX_CLASS } from '@/components/features/guest/styles'
import { cn } from '@/lib/utils'
import type { FoodDish, FoodMenu, FoodTierPrices } from './food-types'

/**
 * The menu panel at the top of the food page and the guest's own page: what each tier costs on the
 * booking's day, what it includes, and every dish with its description and allergens.
 *
 * Prices come from the Christmas menu in menu management (`loadChristmasTierPrices`); a tier with
 * no price for that day says to ask rather than showing a number nobody set. A dish with no
 * allergens recorded says "Ask us about allergens", never nothing: missing data means unknown.
 * Hook-free, so the server pages render it directly.
 */

export const ALLERGEN_UNKNOWN = 'Ask us about allergens'

function price(priceGbp: number): string {
  return Number.isInteger(priceGbp) ? `£${priceGbp}` : `£${priceGbp.toFixed(2)}`
}

const HEADING_CLASS = 'font-anchor-body text-guest-body font-bold leading-guest-snug text-guest-text-strong'

function DishList({ title, dishes }: { title: string; dishes: FoodDish[] }) {
  if (dishes.length === 0) return null
  return (
    <div className="flex flex-col gap-guest-xs">
      <h4 className={HEADING_CLASS}>{title}</h4>
      <ul className="flex flex-col gap-guest-sm">
        {dishes.map((dish) => (
          <li key={dish.id} className={GUEST_BODY_CLASS}>
            <span className="font-semibold">{dish.name}</span>
            {dish.isChildOption && <span className={GUEST_MUTED_CLASS}> (kids, 1 course only)</span>}
            {dish.priceGbp !== null && <span>, {price(dish.priceGbp)}</span>}
            {dish.description && <p className={GUEST_MUTED_CLASS}>{dish.description}</p>}
            <p className={GUEST_NOTE_CLASS}>
              {dish.allergens?.trim() ? `Allergens: ${dish.allergens.trim()}` : ALLERGEN_UNKNOWN}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function TierRow({ title, includes, amount, note }: { title: string; includes: string; amount: string; note?: string | null }) {
  return (
    <li className="flex flex-col gap-guest-2xs">
      <p className={GUEST_BODY_CLASS}>
        <span className="font-semibold">{title}</span>: {amount}
      </p>
      <p className={GUEST_MUTED_CLASS}>{includes}</p>
      {note && <p className={GUEST_NOTE_CLASS}>{note}</p>}
    </li>
  )
}

export function FoodMenuPanel({
  prices,
  menu,
  phoneDisplay,
  dishesOpen = false,
}: {
  /** Null when the prices could not be read; the panel then gives the phone number instead. */
  prices: FoodTierPrices | null
  menu: FoodMenu
  phoneDisplay: string
  /** Open the dish list from the start (the guest's own page). */
  dishesOpen?: boolean
}) {
  const ask = `ask us on ${phoneDisplay}`
  const adults = prices?.oneCourse.filter((entry) => !entry.isKids) ?? []
  const kids = prices?.oneCourse.filter((entry) => entry.isKids) ?? []
  const oneCourseAmount =
    adults.length > 0 ? adults.map((entry) => `${entry.name} ${price(entry.priceGbp)}`).join(', ') : `price by dish, ${ask}`

  return (
    <section aria-labelledby="food-menu-heading" className={cn(GUEST_SUNK_BOX_CLASS, 'flex flex-col gap-guest-md')}>
      <h3 id="food-menu-heading" className={HEADING_CLASS}>
        The menu{prices?.dayLabel ? `, prices for ${prices.dayLabel}` : ''}
      </h3>

      {prices ? (
        <ul className="flex flex-col gap-guest-sm">
          <TierRow
            title="1 course"
            includes="A main. Kids Christmas dinners are 1 course only."
            amount={oneCourseAmount}
            note={kids.length > 0 ? `Kids: ${kids.map((entry) => `${entry.name} ${price(entry.priceGbp)}`).join(', ')}` : null}
          />
          <TierRow
            title="2 courses"
            includes="A main, plus a starter or a dessert."
            amount={prices.twoCourse ? `${price(prices.twoCourse.priceGbp)} each` : ask}
            note={prices.twoCourse?.description}
          />
          <TierRow
            title="3 courses"
            includes="A starter, a main and a dessert."
            amount={prices.threeCourse ? `${price(prices.threeCourse.priceGbp)} each` : ask}
            note={prices.threeCourse?.description}
          />
        </ul>
      ) : (
        <p className={GUEST_BODY_CLASS}>
          We couldn&apos;t load the prices just now. Please {ask}. 1 course is a main; 2 courses a main plus a starter or a
          dessert; 3 courses all three.
        </p>
      )}

      <details open={dishesOpen}>
        <summary className="cursor-pointer font-anchor-body text-guest-body font-semibold">Every dish, with allergens</summary>
        <div className="mt-guest-sm flex flex-col gap-guest-md">
          <DishList title="Starters" dishes={menu.starter} />
          <DishList title="Mains" dishes={menu.main} />
          <DishList title="Desserts" dishes={menu.dessert} />
          <DishList title="Extras" dishes={menu.addons} />
          <p className={GUEST_NOTE_CLASS}>
            If anyone has a serious allergy, please ring us on {phoneDisplay} so we can talk it through.
          </p>
        </div>
      </details>
    </section>
  )
}
