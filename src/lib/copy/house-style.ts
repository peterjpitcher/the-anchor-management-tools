/**
 * The Anchor's house style, as something a machine can check.
 *
 * The brand voice and the banned claims live in the website repo's `docs/SSOT.md`, sections 1
 * and 14. That document is good and it has never had teeth: its rules say "never say X in
 * copy", and the things that actually reached guests were rows in this database. A Yorkshire
 * pudding sat on a vegan dish for months, on a live page, because the description publishes
 * straight from `menu_dishes` and no rule ever ran over it.
 *
 * So this encodes the checkable half of that document and points it at the data as well as at
 * campaign copy. It cannot judge whether a sentence is warm. It can prove a sentence does not
 * say 1866, or put gluten-free on a menu, or open with "Indulge in".
 *
 * TWO SEVERITIES, and the split matters more than the lists.
 *
 * `error` is a claim the SSOT bans outright: wrong founding year, a regulated dietary term, a
 * retired dish, a gravy we do not serve. These are facts and they are not a matter of taste.
 * Nothing carrying one should ship.
 *
 * `warning` is voice: menu-cliche openers, flourish words, filler, long sentences. Worth
 * fixing, never worth blocking a send over, and deliberately not enforced as failure because
 * a checker that cries wolf about "premium" on a premium spirit tasting gets switched off.
 *
 * Keep this file in step with `docs/SSOT.md` §1 and §14. When they disagree, the SSOT wins and
 * this is the stale copy. The SSOT's engineering notes (`docs/SSOT-engineering-notes.md`) point
 * back here, so a change to either should be made to both.
 */

export type HouseStyleSeverity = 'error' | 'warning'

export interface HouseStyleFinding {
  severity: HouseStyleSeverity
  /** Short machine-ish name, so a report can group by fault rather than by string. */
  rule: string
  /** What was found, quoted from the text. */
  matched: string
  /** Why it is wrong, and what to write instead. */
  message: string
}

interface Rule {
  rule: string
  severity: HouseStyleSeverity
  pattern: RegExp
  message: string
}

/**
 * Claims the SSOT bans outright. Every one of these has a recorded reason and most have a
 * recorded incident.
 */
const BANNED_CLAIMS: Rule[] = [
  {
    rule: 'founding-year',
    severity: 'error',
    pattern: /\b(1866|1869)\b/g,
    message: 'The pub was founded in 1751. 1866 and 1869 are banned outright by SSOT §14.',
  },
  {
    rule: 'vague-heritage',
    severity: 'error',
    pattern: /since the 1800s/gi,
    message: 'Too vague. Use 1751.',
  },
  {
    rule: 'gluten-free',
    severity: 'error',
    pattern: /\bgluten[\s-]free\b/gi,
    message:
      'Gluten-free is a regulated claim meaning below 20ppm, which a shared kitchen cannot ' +
      'guarantee. Use NGCI with the cross-contamination caveat. The /food-menu/gluten-free ' +
      'URL and its meta description are the only permitted uses.',
  },
  {
    rule: 'no-allergens',
    severity: 'error',
    pattern: /\bno allergens\b/gi,
    message:
      'Missing allergen data means unknown, not safe. The required wording is "See menu or ' +
      'contact us for allergen information".',
  },
  {
    rule: 'red-wine-gravy',
    severity: 'error',
    pattern: /red wine gravy/gi,
    message: 'We do not serve a red wine gravy. Use "signature gravy" or "regular gravy".',
  },
  {
    rule: 'beef-dripping',
    severity: 'error',
    pattern: /beef[\s-]dripping/gi,
    message: 'We do not use beef dripping. The phrase is "triple-cooked, herb-and-garlic crusted".',
  },
  {
    rule: 'retired-dish',
    severity: 'error',
    pattern: /\b(lamb shank|crispy pork belly|cauliflower cheese)\b/gi,
    message: 'Retired on 2026-04-29. Lamb is no longer served anywhere on any menu.',
  },
  {
    rule: 'wellington-vegetarian',
    severity: 'error',
    pattern: /wellington[^.]{0,60}vegetarian|vegetarian[^.]{0,60}wellington/gi,
    message: 'The Wellington is fully vegan. Always say vegan, never vegetarian.',
  },
  {
    rule: 'unsubstantiated-superlative',
    severity: 'error',
    pattern: /\b(premier|best)\s+(pub|venue|restaurant|destination)\b/gi,
    message: 'Best and premier claims need substantiation. SSOT §14.',
  },
  {
    rule: 'runway-designator',
    severity: 'error',
    pattern: /\b(27R|27L|09L|09R)\b/g,
    message: 'Runway designators were removed from the site deliberately. Do not reintroduce them.',
  },
  {
    rule: 'doors-open',
    severity: 'error',
    pattern: /\bdoors open\b/gi,
    message: 'The house phrase is "Arrive from", not "Doors open".',
  },
  {
    rule: 'sunday-preorder',
    severity: 'error',
    pattern: /(saturday[^.]{0,40}cutoff|pre-?order[^.]{0,30}sunday roast|sunday roast[^.]{0,30}pre-?order)/gi,
    message: 'Sunday roast pre-order and the Saturday cutoff were retired at the 2026-05-17 walk-in launch.',
  },
  {
    rule: 'ulez-figure',
    severity: 'error',
    // Any figure in the same sentence as the ULEZ, or the retired £12.50 itself close by even
    // across a sentence end ("Save £12.50 daily! We're outside London's ULEZ zone").
    pattern: /ULEZ[^.!?\n]{0,80}£\s?\d|£\s?\d[\d.,]*[^.!?\n]{0,80}ULEZ|£\s?12\.50[^\n]{0,60}ULEZ|ULEZ[^\n]{0,60}£\s?12\.50/gi,
    message:
      'Never quote a ULEZ saving figure: whether a driver pays depends on their vehicle and their ' +
      'route. Say "outside the ULEZ" and stop. Retired 2026-09-10, SSOT §14.',
  },
  {
    rule: 'private-hire-deposit-deducted',
    severity: 'error',
    pattern: /£\s?250\b[^.!?\n]{0,80}(?:deducted|off (?:your|the) (?:final )?bill)/gi,
    message:
      'The £250 private-hire deposit is a booking and damage deposit, held separately and refunded ' +
      'after the event. It is never taken off the bill, and it replaces the group deposit. SSOT §11, §16.',
  },
  {
    rule: 'menu-released-later',
    severity: 'error',
    pattern: /released closer to the time/gi,
    message:
      'The Christmas dishes are published: they come from the booking period in this app. The ' +
      '"released closer to the time" line is retired, SSOT §7 and §14.',
  },
  {
    rule: 'anchor-pub-conversational',
    severity: 'warning',
    pattern: /\bThe Anchor Pub\b/g,
    message:
      'Use "The Anchor" conversationally. "The Anchor Pub" is only for page titles, alt text ' +
      'and schema name fields where the search value warrants it.',
  },
]

/** Voice rules from SSOT §1, Rules 1 and 2 (version 2.0, 10 September 2026). Warnings, never blockers. */
const VOICE_RULES: Rule[] = [
  {
    rule: 'menu-cliche-opener',
    severity: 'warning',
    pattern: /(^|[.!?]\s+)(Delight in|Indulge in|Savour|Treat yourself to|Experience|Discover|Enjoy)\b/g,
    message:
      'Never open a description with a command. Say what the thing is and why it is good.',
  },
  {
    rule: 'flourish-word',
    severity: 'warning',
    // SSOT §1 Rule 2 also bans "premium". It is left out here on purpose: the tasting night
    // really is a premium spirit tasting, and a checker that objects to an accurate word gets
    // switched off. A test pins that decision.
    pattern:
      /\b(quintessentially|sophisticated|elegant|effervescent|utterly|iconic|artisan|indulgent|luxurious|elevates|sensation|pinnacle)\b/gi,
    message: 'Flourish word. Energy comes from verbs and specifics, not adjectives.',
  },
  {
    rule: 'filler',
    severity: 'warning',
    pattern: /\b(great atmosphere|something for everyone|hidden gem|look no further|nestled|boasts|a must-visit)\b/gi,
    message: 'Filler that could belong to any pub. Name the actual thing instead.',
  },
  {
    rule: 'em-dash',
    severity: 'warning',
    pattern: new RegExp(String.fromCharCode(8212), 'g'),
    message: 'No em dashes in customer-facing copy. Use a comma, a shorter sentence or brackets.',
  },
]

const ALL_RULES = [...BANNED_CLAIMS, ...VOICE_RULES]

/** Longest sentence the house style tolerates before asking for a second look. */
export const SENTENCE_REVIEW_LENGTH = 25

export interface HouseStyleOptions {
  /**
   * The one page allowed to use the phrase "gluten free", because it holds the ranking and
   * the visible label on it still says NGCI.
   */
  allowGlutenFreePhrase?: boolean
  /** Skip the sentence-length and exclamation checks for short fragments like a dish name. */
  proseChecks?: boolean
}

/**
 * Runs the house style over a piece of copy.
 *
 * Deliberately returns findings rather than throwing, so a caller can show every problem in
 * one pass instead of one per attempt, and so a warning never stops a send.
 */
export function checkHouseStyle(text: string, options: HouseStyleOptions = {}): HouseStyleFinding[] {
  const findings: HouseStyleFinding[] = []
  if (!text.trim()) return findings

  for (const rule of ALL_RULES) {
    if (rule.rule === 'gluten-free' && options.allowGlutenFreePhrase) continue

    // Fresh regex per use: these carry the g flag and lastIndex is stateful.
    const pattern = new RegExp(rule.pattern.source, rule.pattern.flags)
    for (const match of text.matchAll(pattern)) {
      findings.push({
        severity: rule.severity,
        rule: rule.rule,
        matched: match[0].trim(),
        message: rule.message,
      })
    }
  }

  if (options.proseChecks !== false) {
    const exclamations = (text.match(/!/g) ?? []).length
    if (exclamations > 1) {
      findings.push({
        severity: 'warning',
        rule: 'exclamation-marks',
        matched: `${exclamations} exclamation marks`,
        message: 'One per page at most, never stacked.',
      })
    }

    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      const words = sentence.trim().split(/\s+/).filter(Boolean)
      if (words.length > SENTENCE_REVIEW_LENGTH) {
        findings.push({
          severity: 'warning',
          rule: 'long-sentence',
          matched: `${words.length} words: ${words.slice(0, 8).join(' ')}...`,
          message: `Over ${SENTENCE_REVIEW_LENGTH} words. Read it again and see if it is two sentences.`,
        })
      }
    }
  }

  return findings
}

/** Just the ones that must never ship. */
export function houseStyleErrors(text: string, options: HouseStyleOptions = {}): HouseStyleFinding[] {
  return checkHouseStyle(text, options).filter((finding) => finding.severity === 'error')
}
