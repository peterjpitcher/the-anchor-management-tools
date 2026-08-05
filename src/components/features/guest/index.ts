/**
 * Shared primitives for the public, token-authenticated guest pages.
 *
 * All eleven are hook-free and safe to import from a server component. Only
 * `GuestShell` renders `<main>`, applies `guest-theme` and loads the guest
 * webfonts, so nothing here can affect an authenticated staff screen.
 *
 * Design source of truth: docs/design/guest-pages-2026-08/HANDOFF.md
 * Implementation contract: tasks/guest-pages-redesign-spec-2026-08-05.md
 */

export { GuestShell } from './GuestShell'
export { GuestCard } from './GuestCard'
export { GuestButton, type GuestButtonProps } from './GuestButton'
export { GuestAlert } from './GuestAlert'
export { GuestBadge, guestBadgeToneForStatus, type GuestBadgeTone } from './GuestBadge'
export { GuestField, guestFieldControlProps, guestFieldIds } from './GuestField'
export { GuestAmount } from './GuestAmount'
export { DetailRow } from './DetailRow'
export { DetailGrid } from './DetailGrid'
export { TrustLine } from './TrustLine'
export { GuestBlockedState } from './GuestBlockedState'

export {
  GUEST_CHOICE_ROW_CLASS,
  GUEST_H1_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INPUT_INVALID_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_SUNK_BOX_CLASS,
  GUEST_TEXTAREA_CLASS,
} from './styles'
