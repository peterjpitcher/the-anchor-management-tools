/**
 * The submit look shared by the two server-rendered forms on this page.
 *
 * `GuestSubmitButton` is a client component that the excluded
 * `/m/[token]/charge-request` screen also uses, so its API and its default
 * classes must not change (spec F22). It takes a `className` instead, and this
 * is the one definition of that string, so the change form and the food-choices
 * form cannot drift apart.
 *
 * The values mirror `GuestButton variant="primary" size="md"`: the same pill,
 * the same 48px target, and the same `guest-motion-lift` hook that the
 * reduced-motion block in globals.css switches off. `bg-anchor-gold-dark`
 * (#8b6914) is the AA-safe gold for white text (spec C1); never substitute
 * #a57626 behind type.
 */
export const GUEST_SUBMIT_PRIMARY_CLASS =
  'guest-btn guest-motion-lift inline-flex min-h-[48px] w-full items-center justify-center rounded-full border-2 border-transparent bg-anchor-gold-dark px-8 text-center font-anchor-body text-[16px] font-semibold text-white no-underline transition-[transform,translate,background-color,box-shadow,color] duration-200 ease-out hover:-translate-y-0.5 hover:bg-anchor-gold-deep hover:shadow-guest-gold active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none sm:w-auto'

/** The seat block and the read-only seat row share one shell. */
export const PREORDER_SEAT_BLOCK_CLASS =
  'rounded-guest-card border border-guest-border bg-guest-surface p-4'
