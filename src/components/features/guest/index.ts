/**
 * Shared primitives for the public, token-authenticated guest pages.
 *
 * Every component here is hook-free and safe to import from a server
 * component. Only `GuestShell` renders `<main>`, applies `guest-theme` and
 * loads the guest webfonts, so nothing here can affect an authenticated staff
 * screen. A client component imports these file by file rather than through
 * this barrel, so the webfont module never enters a client bundle.
 *
 * Design source of truth: docs/design/guest-pages-2026-08/HANDOFF.md
 * Implementation contract: tasks/guest-pages-redesign-spec-2026-08-05.md
 * Tokens: the guest block of the `@theme` in src/app/globals.css
 */

export { GuestShell } from './GuestShell'
export { GuestIntro, GUEST_SCRIPT_CLASS } from './GuestIntro'
export { GuestCard } from './GuestCard'
export { GuestCardHeader } from './GuestCardHeader'
export { GuestSection } from './GuestSection'
export { GuestButton, type GuestButtonProps } from './GuestButton'
export { GuestAlert } from './GuestAlert'
export { GuestBadge, guestBadgeToneForStatus, type GuestBadgeTone } from './GuestBadge'
export { GuestStatusMark } from './GuestStatusMark'
export { GuestField, guestFieldControlProps, guestFieldIds } from './GuestField'
export { GuestInput, GuestSelect, GuestTextarea } from './GuestControls'
export { GuestChoice } from './GuestChoice'
export { GuestLink, GuestPhoneLink, GuestEmailLink, GuestHelpLine } from './GuestLink'
export { GuestAmount } from './GuestAmount'
export { DetailRow } from './DetailRow'
export { DetailGrid } from './DetailGrid'
export { TrustLine } from './TrustLine'
export { GuestBlockedState } from './GuestBlockedState'
export {
  GUEST_BANNER_TONE,
  GUEST_BADGE_TONE_FOR,
  type GuestTone,
  type GuestMarkTone,
} from './status-ui'

export {
  GUEST_BODY_CLASS,
  GUEST_CHOICE_ROW_CLASS,
  GUEST_H1_CLASS,
  GUEST_H2_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INPUT_INVALID_CLASS,
  GUEST_INTRO_CLASS,
  GUEST_KICKER_CLASS,
  GUEST_LABEL_CLASS,
  GUEST_LEAD_CLASS,
  GUEST_LINK_CLASS,
  GUEST_MESSAGE_CLASS,
  GUEST_MUTED_CLASS,
  GUEST_NOTE_CLASS,
  GUEST_SUNK_BOX_CLASS,
  GUEST_TEXTAREA_CLASS,
} from './styles'
