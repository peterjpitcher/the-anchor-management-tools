/**
 * The second deliberate deviation from the designer's handover, after the gold contrast fix.
 *
 * The handover left-aligns the button under a hero and under the outline call to action, and
 * leaves the text block's button row with no alignment at all, which renders left. The owner
 * asked for every button on the standard components to be centred, so a campaign reads
 * consistently instead of switching sides as you scroll.
 *
 * Byte fidelity is still enforced everywhere else. These are exact literal substitutions of
 * complete opening tags taken from the handover, not pattern matches, so one rule cannot
 * quietly rewrite a surface it was never meant to touch. `buttonAlignmentSubstitutionSources`
 * lets a test assert every rule still matches something real, so a stale rule cannot sit here
 * pretending to protect a surface that has since moved.
 */

interface Substitution {
  from: string
  to: string
  /** Which block the literal belongs to, so a failure names the file to look in. */
  block: string
}

const SUBSTITUTIONS: Substitution[] = [
  {
    block: 'hero_image',
    from: '<tr><td bgcolor="#faf8f3" align="left" style="background-color:#faf8f3;padding:26px 32px 34px">',
    to: '<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:26px 32px 34px">',
  },
  {
    block: 'cta_outline',
    from: '<tr><td bgcolor="#faf8f3" align="left" style="background-color:#faf8f3;padding:24px 32px 36px">',
    to: '<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:24px 32px 36px">',
  },
  {
    // The text block's button row carries no align at all, so it renders left. Outlook ignores
    // margin:0 auto on a table, and several clients ignore align on the cell, so both are set:
    // between them every target client centres it.
    block: 'text_block',
    from:
      '<tr><td bgcolor="#faf8f3" style="background-color:#faf8f3;padding:24px 32px 0">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate"><tbody><tr>',
    to:
      '<tr><td bgcolor="#faf8f3" align="center" style="background-color:#faf8f3;padding:24px 32px 0">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;margin:0 auto"><tbody><tr>',
  },
]

/** Applies the centring to a handover fixture so it can be compared with what we now render. */
export function applyButtonCentring(fixtureHtml: string): string {
  let out = fixtureHtml
  for (const rule of SUBSTITUTIONS) {
    out = out.split(rule.from).join(rule.to)
  }
  return out
}

/** The literals each rule expects to find, for the guard against stale rules. */
export function buttonAlignmentSubstitutionSources(): Array<{ block: string; from: string }> {
  return SUBSTITUTIONS.map(({ block, from }) => ({ block, from }))
}

/**
 * Reverse guard: reports any button row that is still left-aligned.
 *
 * Without this, someone could satisfy the fidelity test by widening a substitution rather
 * than by fixing the markup, and the buttons would drift back one block at a time.
 */
export function findLeftAlignedButtonRows(html: string): string[] {
  const offences: string[] = []
  const rowPattern = /<tr><td[^>]*align="left"[^>]*>(?:(?!<\/tr>)[\s\S])*?border-radius:999px/g

  for (const match of html.matchAll(rowPattern)) {
    offences.push(match[0].slice(0, 120))
  }

  return offences
}
