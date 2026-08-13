import { describe, expect, it } from 'vitest'

import { escapeEmailText, escapeEmailUrl, toPlainText } from '../escape'

/**
 * Escaping in an email template has two jobs, and only the first is the familiar one.
 *
 * The obvious job is keeping a stray ampersand or angle bracket out of the markup. This
 * brand's copy is full of both, so it is not a theoretical concern.
 *
 * The less obvious job is producing the designer's exact bytes. The handover files write
 * named entities throughout, so a slot value typed as ordinary Unicode has to come out as
 * `&pound;` and `&rsquo;` or the fidelity tests could only ever compare "near enough".
 *
 * Characters are written with String.fromCodePoint rather than typed literally, so this file
 * stays pure ASCII and every case states exactly which character it means.
 */

const POUND = String.fromCodePoint(0x00a3)
const RIGHT_SINGLE_QUOTE = String.fromCodePoint(0x2019)
const TICK = String.fromCodePoint(0x2713)
const NDASH = String.fromCodePoint(0x2013)
const MIDDOT = String.fromCodePoint(0x00b7)

describe('escapeEmailText', () => {
  it.each([
    ['ampersand', 'Fish & chips', 'Fish &amp; chips'],
    ['less than', 'under <10 guests', 'under &lt;10 guests'],
    ['greater than', 'over >20 guests', 'over &gt;20 guests'],
    ['double quote', 'the "quiet" room', 'the &quot;quiet&quot; room'],
  ])('escapes a bare %s, which would otherwise break the markup around it', (_name, input, expected) => {
    expect(escapeEmailText(input)).toBe(expected)
  })

  it('does not double-escape the entities it introduces itself', () => {
    // Ampersand has to be replaced before the named entities are added. Get the order wrong
    // and a pound sign renders to the reader as the literal text "&pound;".
    expect(escapeEmailText(`${POUND}10 & up`)).toBe('&pound;10 &amp; up')
  })

  it('escapes an ampersand the copywriter typed, even next to an entity name', () => {
    expect(escapeEmailText('&pound; is typed out here')).toBe('&amp;pound; is typed out here')
  })

  it.each([
    ['a right single quote, the apostrophe this brand uses', RIGHT_SINGLE_QUOTE, '&rsquo;'],
    ['a pound sign', POUND, '&pound;'],
    ['a tick, used in the reassurance row', TICK, '&#10003;'],
    ['an en dash', NDASH, '&ndash;'],
    ['a middot', MIDDOT, '&middot;'],
  ])('encodes %s as the entity the handover uses', (_name, char, entity) => {
    expect(escapeEmailText(char)).toBe(entity)
  })

  it.each([
    ['a right single quote', RIGHT_SINGLE_QUOTE],
    ['a pound sign', POUND],
    ['a tick', TICK],
  ])('round-trips %s back to the character for the plain-text part', (_name, char) => {
    expect(toPlainText(escapeEmailText(char))).toBe(char)
  })

  it('accepts a number, because prices and years reach it unformatted', () => {
    expect(escapeEmailText(2026)).toBe('2026')
  })

  it('cannot turn a script tag in copy into executable markup', () => {
    const escaped = escapeEmailText('<script>alert(1)</script>')
    expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;')

    const container = document.createElement('div')
    container.innerHTML = escaped
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toBe('<script>alert(1)</script>')
  })

  it('cannot break out of an attribute value and add a handler', () => {
    // The same function fills attribute values as fills text nodes, so the quote case is the
    // one that matters here.
    const container = document.createElement('div')
    container.innerHTML = `<a href="https://example.test" title="${escapeEmailText('" onmouseover="alert(1)')}">x</a>`
    const link = container.querySelector('a')
    expect(link?.getAttribute('onmouseover')).toBeNull()
    expect(link?.getAttribute('title')).toBe('" onmouseover="alert(1)')
  })
})

describe('escapeEmailUrl', () => {
  it.each([
    ['https', 'https://www.the-anchor.pub/christmas-parties'],
    ['http', 'http://www.the-anchor.pub/christmas-parties'],
    ['mailto', 'mailto:manager@the-anchor.pub'],
    ['tel', 'tel:+441753682707'],
  ])('accepts a %s URL, which is a link that resolves from anybody\'s inbox', (_scheme, url) => {
    expect(escapeEmailUrl(url)).toBe(url)
  })

  it.each([
    ['a project-relative path', '/christmas-parties'],
    ['a bare relative path', 'christmas-parties'],
    ['a fragment-only link', '#enquiry'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['an uppercase javascript URL, in case of a case-sensitive check', 'JavaScript:alert(1)'],
    ['an empty string', ''],
    ['whitespace only', '   '],
  ])('throws on %s rather than shipping a link that goes nowhere', (_name, url) => {
    expect(() => escapeEmailUrl(url)).toThrow(/must be absolute https, mailto or tel URLs/i)
  })

  it('entity-encodes ampersands so a query string survives inside an href attribute', () => {
    expect(escapeEmailUrl('https://www.the-anchor.pub/book?date=2026-12-05&covers=8')).toBe(
      'https://www.the-anchor.pub/book?date=2026-12-05&amp;covers=8',
    )
  })

  it('escapes a quote, so a URL can never close the attribute it sits in', () => {
    expect(escapeEmailUrl('https://www.the-anchor.pub/?q="x"')).toBe(
      'https://www.the-anchor.pub/?q=&quot;x&quot;',
    )
  })

  it('trims surrounding whitespace, which a pasted URL routinely carries', () => {
    expect(escapeEmailUrl('  https://www.the-anchor.pub  ')).toBe('https://www.the-anchor.pub')
  })
})

describe('toPlainText', () => {
  it('reverses the entity encoding, so the text part reads as written rather than as markup', () => {
    expect(toPlainText('&pound;36.95 &middot; Tuesday &ndash; Saturday')).toBe(
      `${POUND}36.95 ${MIDDOT} Tuesday ${NDASH} Saturday`,
    )
  })

  it('decodes the markup entities last, so a literal ampersand comes back once not twice', () => {
    expect(toPlainText(escapeEmailText('Fish & chips'))).toBe('Fish & chips')
  })

  it.each(['&lt;', '&gt;', '&quot;', '&amp;'])('decodes %s', (entity) => {
    expect(toPlainText(entity)).toBe(
      { '&lt;': '<', '&gt;': '>', '&quot;': '"', '&amp;': '&' }[entity],
    )
  })
})
