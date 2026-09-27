/**
 * The seat block and the read-only seat row share one shell: a white panel with
 * the guest card radius and edge, without the card shadow, because it sits
 * inside the page's food-choices section rather than on the cream body.
 *
 * The two forms on this page submit with `GuestSubmitButton`, which is a
 * `GuestButton`, so the change form and the food-choices form cannot drift apart.
 */
export const PREORDER_SEAT_BLOCK_CLASS =
  'rounded-guest-card border border-guest-border bg-guest-surface p-4'
