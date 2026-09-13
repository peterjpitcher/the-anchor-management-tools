/**
 * A plain-text version of an HTML email, for callers that only build HTML.
 *
 * Twelve guest templates sent HTML with no text part: the nine private booking emails, the refund
 * notice, the invoice payment link and the pre-order reminder. A message with no text part reads as
 * an empty email in a text-only client, scores worse with spam filters, and leaves `body_text` null
 * in the send log, so staff looking at what a guest received see nothing.
 *
 * Deriving it centrally is deliberate: a template that forgets is covered, and a template that
 * writes its own better version still wins, because `sendEmail` only derives when `text` is absent.
 *
 * Links are kept as readable URLs rather than dropped, because a booking email's whole purpose is
 * usually the link in it.
 */

/** Entities these emails actually use. Anything else numeric is decoded below. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  pound: '£',
  times: 'x',
  hellip: '...',
  mdash: ', ',
  ndash: ' to ',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(value: string): string {
  return value
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&#(\d+);/g, (_whole, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_whole, code: string) => String.fromCodePoint(parseInt(code, 16)))
}

/**
 * Turns an HTML email body into plain text.
 *
 * A link becomes "label (https://...)", or just the URL when the label is the URL already, so a
 * text-only reader can still act on it.
 */
export function htmlToPlainText(html: string): string {
  const withLinks = html
    // Drop anything that is not content before tags are stripped.
    .replace(/<(head|style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // A link keeps its destination beside its label.
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_whole, href: string, label: string) => {
      const text = decodeEntities(label.replace(/<[^>]+>/g, '')).trim()
      const url = decodeEntities(href).trim()
      if (!text) return url
      if (url.startsWith('mailto:') || url.startsWith('tel:')) return text
      return text === url ? url : `${text} (${url})`
    })
    // Block ends become line breaks, so paragraphs and rows stay apart.
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')

  return decodeEntities(withLinks)
    // A dash entity becomes a comma, which would otherwise leave the space that sat before the
    // dash stranded in front of it.
    .replace(/ +([,.;:!?])/g, '$1')
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
