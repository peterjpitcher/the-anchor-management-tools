/**
 * HTML escaping for values interpolated into email templates.
 *
 * Two jobs, and the second one is not obvious.
 *
 * 1. Escape the characters that would break markup. Copy for this brand contains
 *    apostrophes and ampersands constantly, so this is not optional.
 *
 * 2. Encode a fixed set of non-ASCII characters as named entities. The designer's files
 *    use named entities throughout (`&pound;`, `&rsquo;`, `&middot;`), and some older MIME
 *    configurations mishandle raw UTF-8. Encoding them here means a slot value written as
 *    a normal Unicode string reproduces the handover's bytes exactly, which is what lets
 *    the fidelity tests compare byte for byte instead of "near enough after normalising".
 *
 * Callers pass plain text. Never pass markup: there is deliberately no raw-HTML escape
 * hatch, because one would be used and then a campaign would ship broken tables.
 *
 * Entries are keyed by code point rather than by literal character so this file stays pure
 * ASCII and every entry states exactly which character it means.
 */

/** Code point to named entity, for the characters the handover encodes. */
const ENTITY_CODE_POINTS: ReadonlyArray<readonly [number, string]> = [
  [0x00a0, '&nbsp;'], // no-break space
  [0x00a3, '&pound;'],
  [0x00a9, '&copy;'],
  [0x00ae, '&reg;'],
  [0x00b7, '&middot;'],
  [0x00d7, '&times;'],
  [0x2013, '&ndash;'],
  [0x2014, '&mdash;'],
  [0x2018, '&lsquo;'],
  [0x2019, '&rsquo;'], // right single quote, the apostrophe this brand's copy uses
  [0x201c, '&ldquo;'],
  [0x201d, '&rdquo;'],
  [0x2026, '&hellip;'],
  [0x2192, '&rarr;'],
  [0x2713, '&#10003;'], // tick, used in the reassurance row
  [0x2605, '&#9733;'], // filled star, used in reviews
  [0x2606, '&#9734;'],
]

const ENTITY_MAP: ReadonlyArray<readonly [string, string]> = ENTITY_CODE_POINTS.map(
  ([codePoint, entity]) => [String.fromCodePoint(codePoint), entity] as const,
)

/**
 * Escapes a value for use in a text node or an attribute value.
 *
 * Ampersand is replaced first so the entities added afterwards survive intact.
 */
export function escapeEmailText(value: string | number): string {
  let out = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

  for (const [char, entity] of ENTITY_MAP) {
    if (out.includes(char)) out = out.split(char).join(entity)
  }

  return out
}

/**
 * Escapes a URL for an href/src attribute.
 *
 * Only absolute http(s), mailto and tel URLs are allowed. Several clients rewrite or drop
 * relative and fragment-only links, and a project-relative path never resolves in a
 * recipient's inbox, so anything else is a bug worth failing on rather than shipping.
 */
export function escapeEmailUrl(value: string): string {
  const trimmed = String(value).trim()

  if (!/^(https?:\/\/|mailto:|tel:)/i.test(trimmed)) {
    throw new Error(
      `Email links must be absolute https, mailto or tel URLs. Received: ${trimmed.slice(0, 80)}`,
    )
  }

  // Ampersands in query strings must be entity-encoded inside an HTML attribute.
  return trimmed
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** Turns entities back into readable characters, for the plain-text part of an email. */
export function toPlainText(value: string): string {
  let out = String(value)
  for (const [char, entity] of ENTITY_MAP) {
    out = out.split(entity).join(char)
  }
  return out
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}
