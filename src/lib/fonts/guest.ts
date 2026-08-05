import { Clicker_Script, DM_Serif_Display, Outfit } from 'next/font/google'

/**
 * Webfonts for the public, token-authenticated guest pages only.
 *
 * These are deliberately NOT registered in `src/app/layout.tsx`. `GuestShell`
 * applies `guestFontClassName` to its own wrapper, so a staff member loading an
 * authenticated screen never downloads any of the three faces.
 *
 * The CSS variable names below must differ from the `@theme` token names in
 * `src/app/globals.css` (`--font-anchor-display` and friends). The token aliases
 * point at these runtime variables; if the names matched, each alias would
 * reference itself and resolve to nothing.
 */

/** Display face. Single weight 400: never faux-bold it. */
const dmSerifDisplay = DM_Serif_Display({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-dm-serif-runtime',
  display: 'swap',
})

/** Body and UI workhorse, matching the live website. */
const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-outfit-runtime',
  display: 'swap',
})

/** Script accent, used sparingly on the feedback funnel only. */
const clickerScript = Clicker_Script({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-clicker-runtime',
  display: 'swap',
})

/**
 * The three font variable classes, joined. Apply once, on the outermost guest
 * element, alongside `guest-theme`.
 */
export const guestFontClassName: string = [
  dmSerifDisplay.variable,
  outfit.variable,
  clickerScript.variable,
].join(' ')
