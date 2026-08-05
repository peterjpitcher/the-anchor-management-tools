/**
 * Shared class strings for the guest pages.
 *
 * These exist so the page intro block and form controls have one definition
 * across 13 routes without adding another component. Values come straight from
 * docs/design/guest-pages-2026-08/HANDOFF.md.
 */

/** Uppercase gold eyebrow naming the flow, e.g. `Table booking`. */
export const GUEST_KICKER_CLASS =
  'font-anchor-body text-[12px] font-semibold uppercase leading-none tracking-[0.18em] text-guest-accent-text'

/** Page title. DM Serif Display is weight 400 only: never add a bold utility. */
export const GUEST_H1_CLASS =
  'font-anchor-display text-[29px] font-normal leading-[1.2] tracking-[-0.02em] text-guest-text-strong sm:text-[40px]'

/** Greeting or lead line under the h1. */
export const GUEST_LEAD_CLASS =
  'font-anchor-body text-[15px] leading-[1.6] text-guest-text-muted'

/** The three-part intro block wrapper: kicker, h1, lead. */
export const GUEST_INTRO_CLASS = 'flex flex-col gap-[7px]'

/**
 * Text input, select and textarea.
 *
 * `text-[16px]` is deliberate and must not be reduced: anything smaller makes
 * iOS Safari zoom the page on focus. The focus outline comes from the
 * `.guest-theme :focus-visible` rule in globals.css; this adds the soft ring.
 */
export const GUEST_INPUT_CLASS =
  'block min-h-[48px] w-full rounded-guest-field border-[1.5px] border-guest-border-strong bg-guest-surface px-4 py-3 font-anchor-body text-[16px] leading-[1.4] text-guest-text transition-[border-color,box-shadow] duration-200 placeholder:text-guest-text-muted focus:border-anchor-gold-dark focus:shadow-guest-focus'

/** Add alongside GUEST_INPUT_CLASS when the control failed validation. */
export const GUEST_INPUT_INVALID_CLASS = 'border-anchor-danger'

/** Textareas add a vertical-only resize handle on top of the input styling. */
export const GUEST_TEXTAREA_CLASS = 'resize-y'

/** Recessed panel used for refund notes, assurances and contact blocks. */
export const GUEST_SUNK_BOX_CLASS =
  'rounded-guest-card border border-guest-border bg-guest-sunk p-4 font-anchor-body text-[13px] leading-[1.6] text-guest-text'

/** A label row wrapping a tick box or radio. Never let this drop below 44px. */
export const GUEST_CHOICE_ROW_CLASS =
  'flex min-h-[44px] cursor-pointer items-center gap-[11px] font-anchor-body text-[14px] leading-[1.5] text-guest-text'
