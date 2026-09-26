/**
 * Shared class strings for the guest pages.
 *
 * Every value is a guest token from the `@theme` block in src/app/globals.css
 * (`guest-*` spacing and type, `anchor-*` and `guest-*` colours), so no guest
 * page hard-codes a pixel value. Values come from
 * docs/design/guest-pages-2026-08/HANDOFF.md.
 *
 * Pages should reach for the components first (`GuestIntro`, `GuestInput`,
 * `GuestChoice`, `GuestLink` and friends); these strings are what those
 * components are built from, exported for the few places that need the raw class.
 *
 * NEVER pass these strings through `cn()`. Until the guest type sizes are registered
 * with tailwind-merge in src/lib/utils.ts, it reads an unknown `text-guest-*` size
 * as a colour and silently drops either the size or the colour. The guest kit joins
 * type classes with `clsx`, which never removes a class, and keeps `cn()` for box
 * classes (padding, width, margins) where a caller's override has to win.
 */

/** Uppercase gold eyebrow naming the flow, e.g. `Table booking`. */
export const GUEST_KICKER_CLASS =
  'font-anchor-body text-guest-kicker font-semibold uppercase text-guest-accent-text'

/** Page title. DM Serif Display is weight 400 only: never add a bold utility. */
export const GUEST_H1_CLASS =
  'font-anchor-display text-guest-h1 font-normal text-guest-text-strong sm:text-guest-h1-wide'

/** Section and card title, the one heading level below the page title. */
export const GUEST_H2_CLASS = 'font-anchor-display text-guest-h2 font-normal text-guest-text-strong'

/** Greeting or lead line under the h1. */
export const GUEST_LEAD_CLASS = 'font-anchor-body text-guest-lead text-guest-text-muted'

/** The three-part intro block wrapper: kicker, h1, lead. */
export const GUEST_INTRO_CLASS = 'flex flex-col gap-guest-xs'

/** Small uppercase label over a figure or a value (`Total due`, `Booking`). */
export const GUEST_LABEL_CLASS =
  'font-anchor-body text-guest-label font-semibold uppercase text-guest-text-muted'

/** The main message of a result card (paid, confirmed, received): the lead size in body colour. */
export const GUEST_MESSAGE_CLASS = 'font-anchor-body text-guest-lead text-guest-text'

/** Ordinary body copy. */
export const GUEST_BODY_CLASS = 'font-anchor-body text-guest-body text-guest-text'

/** Secondary body copy: descriptions, notes under a card title. */
export const GUEST_MUTED_CLASS = 'font-anchor-body text-guest-body text-guest-text-muted'

/** Fine print: hints, processing messages, the line under a payment button. */
export const GUEST_NOTE_CLASS = 'font-anchor-body text-guest-note text-guest-text-muted'

/** An inline text link in guest copy. */
export const GUEST_LINK_CLASS =
  'font-semibold text-guest-accent-text underline underline-offset-3 hover:no-underline'

/**
 * Text input, select and textarea.
 *
 * `text-guest-control` (16px) is deliberate and must not be reduced: anything
 * smaller makes iOS Safari zoom the page on focus. The focus outline comes from
 * the `.guest-theme :focus-visible` rule in globals.css; this adds the soft ring.
 * `border-[1.5px]` stays arbitrary: Tailwind has no border-width token namespace.
 */
export const GUEST_INPUT_CLASS =
  'block min-h-guest-control w-full rounded-guest-field border-[1.5px] border-guest-border-strong bg-guest-surface px-4 py-3 font-anchor-body text-guest-control text-guest-text transition duration-200 placeholder:text-guest-text-muted focus:border-anchor-gold-dark focus:shadow-guest-focus'

/** Add alongside GUEST_INPUT_CLASS when the control failed validation. */
export const GUEST_INPUT_INVALID_CLASS = 'border-anchor-danger'

/** Textareas add a vertical-only resize handle on top of the input styling. */
export const GUEST_TEXTAREA_CLASS = 'resize-y'

/** Recessed panel used for refund notes, assurances and contact blocks. */
export const GUEST_SUNK_BOX_CLASS =
  'rounded-guest-card border border-guest-border bg-guest-sunk p-4 font-anchor-body text-guest-small text-guest-text'

/** A label row wrapping a tick box or radio. Never let this drop below 44px. */
export const GUEST_CHOICE_ROW_CLASS =
  'flex min-h-guest-touch cursor-pointer items-center gap-guest-sm font-anchor-body text-guest-body text-guest-text'
