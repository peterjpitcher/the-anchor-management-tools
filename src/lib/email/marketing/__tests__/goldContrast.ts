/**
 * The one place the shipped markup deliberately departs from the designer's handover.
 *
 * The handover is explicit that charcoal on gold is a choice, not an oversight: "white on gold
 * fails contrast". Measured against WCAG it is right about the golds it used. The owner has
 * nonetheless asked for white text on every gold background, and the only way to give them
 * that legibly is to darken the fill.
 *
 *   fill      white text   charcoal text
 *   #a57626   4.02:1       4.33:1      both large-text only
 *   #c9a020   2.46:1       7.07:1      white fails outright
 *   #8b6914   5.09:1       3.42:1      white passes AA
 *
 * So every gold surface that carries text moves to #8b6914, which is already the brand's
 * "Gold dark" and is documented in the handover as the gold that passes AA. Gold used as a
 * non-text accent is untouched: the 3px card top borders, the hairlines and dashed rules, the
 * star glyphs, the gold kicker text on cream, and the gold text on the dark panels all keep
 * the designer's values, because none of those is text sitting on a gold fill.
 *
 * The fidelity suites compare the rendered email against the handover byte for byte, which is
 * the guard against accidental drift and must stay that strict. So rather than loosen the
 * comparison, this substitution is applied to the FIXTURE first. That permits exactly this
 * change and leaves every other difference failing the test, which is the point.
 */

/** Gold dark. White reaches 5.09:1 on it, so it is the only gold that can carry white text. */
export const GOLD_ON_WHITE_TEXT = '#8b6914'

/** The designer's golds. Fine as accents and as text, never again as a fill behind text. */
export const DESIGNER_GOLD_FILLS = ['#a57626', '#c9a020'] as const

/**
 * Exact literals, deliberately long.
 *
 * Each pair reproduces a complete opening tag from the handover rather than matching a bare
 * colour value, so the substitution cannot spread to a surface it was never meant to touch and
 * cannot mask real drift in the padding, the font stack or anything else in the same tag.
 */
const SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  // deadline_bar: the solid strip itself, and its inline link, which keeps its underline
  // because on a solid fill the underline is all that still marks it as a link.
  [
    `<td bgcolor="#a57626" align="center" style="background-color:#a57626;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:22px;color:#1a1a1a">`,
    `<td bgcolor="#8b6914" align="center" style="background-color:#8b6914;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;line-height:22px;color:#ffffff">`,
  ],
  [
    `style="color:#1a1a1a;text-decoration:underline"`,
    `style="color:#ffffff;text-decoration:underline"`,
  ],

  // The pill button cell, in both of the designer's gold values. `border-radius:999px` is only
  // ever a button here, so these two literals reach buttons and nothing else.
  [
    `bgcolor="#c9a020" style="background-color:#c9a020;border-radius:999px"`,
    `bgcolor="#8b6914" style="background-color:#8b6914;border-radius:999px"`,
  ],
  [
    `bgcolor="#a57626" style="background-color:#a57626;border-radius:999px"`,
    `bgcolor="#8b6914" style="background-color:#8b6914;border-radius:999px"`,
  ],

  // The button labels. One literal per button, distinguished by its own padding, so a label in
  // closing_panel_dark can never be rewritten by the rule meant for hero_image.
  [
    `style="display:block;padding:15px 34px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#1a1a1a;text-decoration:none"`,
    `style="display:block;padding:15px 34px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none"`,
  ],
  [
    `style="display:block;padding:14px 30px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#1a1a1a;text-decoration:none"`,
    `style="display:block;padding:14px 30px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none"`,
  ],
  [
    `style="display:block;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#1a1a1a;text-decoration:none"`,
    `style="display:block;padding:15px 32px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none"`,
  ],
  [
    `style="display:block;padding:14px 28px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:20px;color:#1a1a1a;text-decoration:none"`,
    `style="display:block;padding:14px 28px;font-family:'Outfit','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;line-height:20px;color:#ffffff;text-decoration:none"`,
  ],
]

/**
 * Applies the owner's white-on-gold change to a handover fixture so it can be compared against
 * what we actually render. Literal replacement only, no regular expressions, so nothing here
 * can quietly absorb an unrelated difference.
 */
export function applyGoldContrastChange(fixtureHtml: string): string {
  let html = fixtureHtml
  for (const [from, to] of SUBSTITUTIONS) html = html.split(from).join(to)
  return html
}

/** Every literal, so a test can prove none of them has gone stale and stopped matching. */
export function goldContrastSubstitutionSources(): string[] {
  return SUBSTITUTIONS.map(([from]) => from)
}

/**
 * Finds any place where text still sits badly on a gold fill.
 *
 * This is the guard that stops a future edit quietly putting charcoal back. For every gold
 * fill in the markup it takes the tag that declares the fill plus the anchor nested straight
 * inside it, which together are where a button or a bar declares its text colour, and reports
 * anything that is either filled with one of the designer's lighter golds or still setting
 * charcoal on top.
 *
 * Returns a list of offending snippets. An empty list is the passing state.
 */
export function findCharcoalOnGold(html: string): string[] {
  const offenders: string[] = []
  const fillPattern = /(?:bgcolor="|background-color:)#(a57626|c9a020|8b6914)/gi

  for (const match of html.matchAll(fillPattern)) {
    const at = match.index ?? 0
    const gold = `#${match[1].toLowerCase()}`

    // Walk out to the tag that declares the fill, then pick up a directly nested anchor, which
    // is where a pill button puts its label colour.
    const tagStart = html.lastIndexOf('<', at)
    const tagEnd = html.indexOf('>', at)
    if (tagStart === -1 || tagEnd === -1) continue

    let region = html.slice(tagStart, tagEnd + 1)
    const after = html.slice(tagEnd + 1)
    if (after.startsWith('<a ')) {
      const anchorEnd = after.indexOf('>')
      if (anchorEnd !== -1) region += after.slice(0, anchorEnd + 1)
    }

    const excerpt = region.length > 240 ? `${region.slice(0, 240)}...` : region

    if (gold !== GOLD_ON_WHITE_TEXT) {
      offenders.push(
        `Gold ${gold} used as a fill. Only ${GOLD_ON_WHITE_TEXT} is dark enough to carry ` +
          `white text at AA. ${excerpt}`,
      )
      continue
    }

    if (region.includes('color:#1a1a1a')) {
      offenders.push(`Charcoal text on a gold fill, which the owner asked us not to ship. ${excerpt}`)
      continue
    }

    if (!region.includes('color:#ffffff')) {
      offenders.push(
        `Gold fill with no white text colour declared, so it inherits whatever is above it. ` +
          `${excerpt}`,
      )
    }
  }

  return offenders
}
