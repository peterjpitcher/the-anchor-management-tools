import localFont from 'next/font/local'

/**
 * Webfonts for the public, token-authenticated guest pages only.
 *
 * Self-hosted from `src/app/fonts/`, so the build never calls Google Fonts (see the
 * README there). Each `font-family` declaration keeps the real family name rather
 * than the private one next/font/local would generate.
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
const dmSerifDisplay = localFont({
  src: '../../app/fonts/dm-serif-display-latin.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-dm-serif-runtime',
  display: 'swap',
  adjustFontFallback: 'Times New Roman',
  declarations: [{ prop: 'font-family', value: 'DM Serif Display' }],
})

/** Body and UI workhorse, matching the live website. A variable font: one file, 400 to 700. */
const outfit = localFont({
  src: '../../app/fonts/outfit-latin.woff2',
  weight: '400 700',
  style: 'normal',
  variable: '--font-outfit-runtime',
  display: 'swap',
  declarations: [{ prop: 'font-family', value: 'Outfit' }],
})

/** Script accent, used sparingly on the feedback funnel only. */
const clickerScript = localFont({
  src: '../../app/fonts/clicker-script-latin.woff2',
  weight: '400',
  style: 'normal',
  variable: '--font-clicker-runtime',
  display: 'swap',
  declarations: [{ prop: 'font-family', value: 'Clicker Script' }],
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
