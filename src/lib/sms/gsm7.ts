/**
 * GSM-7 alphabet helpers.
 *
 * An SMS is billed per segment. A message made only of GSM-7 characters fits 160
 * characters per segment; a single character outside that alphabet (a curly
 * apostrophe, a long dash, an emoji) forces the whole message to UCS-2 and drops
 * the limit to 70. Smart punctuation pasted from a word processor is therefore a
 * silent cost multiplier, so we normalise it away before sending.
 *
 * The substitution table is keyed by code point rather than by literal character.
 * Those characters are near-impossible to tell apart by eye and easy for an editor
 * to rewrite, and a stray one is exactly the bug this module exists to prevent.
 */

/** Characters that cost one septet each. */
const GSM7_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
)

/** Characters that are legal but cost two septets (escape + character). */
const GSM7_EXTENDED = new Set('^{}\\[~]|€')

export const GSM7_SINGLE_SEGMENT_LIMIT = 160
export const GSM7_MULTIPART_SEGMENT_LIMIT = 153
export const UCS2_SINGLE_SEGMENT_LIMIT = 70
export const UCS2_MULTIPART_SEGMENT_LIMIT = 67

/**
 * Non-GSM characters mapped to safe equivalents, as [code point, replacement].
 * Deliberately conservative: only substitutions that preserve meaning exactly.
 */
const SUBSTITUTION_CODE_POINTS: ReadonlyArray<readonly [number, string]> = [
  [0x2018, "'"], // left single quotation mark
  [0x2019, "'"], // right single quotation mark, the curly apostrophe
  [0x201a, "'"], // single low quotation mark
  [0x201b, "'"], // single high reversed quotation mark
  [0x2032, "'"], // prime
  [0x201c, '"'], // left double quotation mark
  [0x201d, '"'], // right double quotation mark
  [0x201e, '"'], // double low quotation mark
  [0x2033, '"'], // double prime
  [0x2013, '-'], // en dash
  [0x2014, '-'], // em dash
  [0x2015, '-'], // horizontal bar
  [0x2212, '-'], // minus sign
  [0x2026, '...'], // horizontal ellipsis
  [0x00a0, ' '], // no-break space
  [0x2009, ' '], // thin space
  [0x202f, ' '], // narrow no-break space
  [0x200b, ''], // zero-width space
  [0x2022, '-'], // bullet
  [0x00b7, '.'], // middle dot
  [0x2122, 'TM'], // trade mark sign
  [0x00ae, '(R)'], // registered sign
  [0x00a9, '(C)'], // copyright sign
  [0x00bd, '1/2'], // vulgar fraction one half
  [0x00bc, '1/4'], // vulgar fraction one quarter
  [0x00be, '3/4'], // vulgar fraction three quarters

  // Accented Latin letters that are NOT in GSM-7, folded to their base letter.
  // Lossy but harmless in a text, and it matters: the venue runs World Cup and
  // other fixtures with names like "Curacao" (cedilla) or "Peru" (acute), and a
  // single one of these letters triples the cost of the whole message by forcing
  // UCS-2. Letters already in GSM-7 (a-grave, a-diaeresis, e-acute, n-tilde,
  // o-diaeresis, u-diaeresis, sharp s and friends) are deliberately absent.
  [0x00e7, 'c'], // c with cedilla
  [0x00c7, 'C'], // C with cedilla is in GSM-7, but fold for consistent width
  [0x00e1, 'a'], // a with acute
  [0x00e2, 'a'], // a with circumflex
  [0x00e3, 'a'], // a with tilde
  [0x00ea, 'e'], // e with circumflex
  [0x00eb, 'e'], // e with diaeresis
  [0x00ed, 'i'], // i with acute
  [0x00ee, 'i'], // i with circumflex
  [0x00ef, 'i'], // i with diaeresis
  [0x00f3, 'o'], // o with acute
  [0x00f4, 'o'], // o with circumflex
  [0x00f5, 'o'], // o with tilde
  [0x00fa, 'u'], // u with acute
  [0x00fb, 'u'], // u with circumflex
  [0x00fd, 'y'], // y with acute
  [0x00ff, 'y'], // y with diaeresis
  [0x0161, 's'], // s with caron
  [0x017e, 'z'], // z with caron
  [0x0107, 'c'], // c with acute
  [0x0111, 'd'], // d with stroke
]

const GSM7_SUBSTITUTIONS: ReadonlyMap<string, string> = new Map(
  SUBSTITUTION_CODE_POINTS.map(([codePoint, replacement]) => [String.fromCodePoint(codePoint), replacement])
)

/** True when every character can be encoded as GSM-7. */
export function isGsm7(text: string): boolean {
  for (const char of text) {
    if (!GSM7_BASIC.has(char) && !GSM7_EXTENDED.has(char)) return false
  }
  return true
}

/** Septet cost of a GSM-7 message. Extended characters count double. */
export function countSmsSeptets(text: string): number {
  let septets = 0
  for (const char of text) {
    septets += GSM7_EXTENDED.has(char) ? 2 : 1
  }
  return septets
}

/**
 * Replace smart punctuation with GSM-7 equivalents. Characters with no safe
 * mapping (emoji, non-Latin scripts) are left alone so the message still sends,
 * just as UCS-2.
 */
export function normaliseToGsm7(text: string): string {
  let out = ''
  for (const char of text) {
    out += GSM7_SUBSTITUTIONS.get(char) ?? char
  }
  return out
}

/**
 * Billable segment count, using the correct alphabet and the shorter per-segment
 * limits that apply once a message is split.
 */
export function countSmsSegments(text: string): number {
  if (text.length === 0) return 1

  if (isGsm7(text)) {
    const septets = countSmsSeptets(text)
    if (septets <= GSM7_SINGLE_SEGMENT_LIMIT) return 1
    return Math.ceil(septets / GSM7_MULTIPART_SEGMENT_LIMIT)
  }

  // UCS-2 is billed per UTF-16 code unit, so astral characters (emoji) cost two.
  const units = text.length
  if (units <= UCS2_SINGLE_SEGMENT_LIMIT) return 1
  return Math.ceil(units / UCS2_MULTIPART_SEGMENT_LIMIT)
}
