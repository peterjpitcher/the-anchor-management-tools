import { describe, expect, it } from 'vitest'
import {
  describeHow,
  fillSignatureSlots,
  findSignatureSlots,
  initialsSlot,
  renderSignatureSlot,
  signatureSlot,
  signedLabel,
  type SignatureSlotFill,
} from '@/lib/signing/signature-slots'
import { SIGNING_METHODS } from '@/lib/signing/types'

const BAD_OUTPUT = /undefined|null|NaN|Invalid Date|\[object Object\]/
const MARKER_TEXT = '<!--signing-'

/** Text that would run as markup if it reached the page unescaped. */
const NASTY = `<script>alert(1)</script> O'Brien & Co`
const NASTY_WITH_QUOTES = `"Dana" <img src=x onerror=alert(1)> O'Fox & Sons`

type SignedFill = Extract<SignatureSlotFill, { state: 'signed' }>

function signed(overrides: Partial<SignedFill> = {}): SignedFill {
  return {
    state: 'signed',
    name: 'Paula Campbell',
    when: '13 October 2026 at 11:41:35 BST',
    location: 'Staines, ENG, GB',
    how: 'By a personal link sent by email',
    reference: 'CEEBA528',
    ...overrides,
  }
}

/** The page as a browser would build it, so assertions read what a person would see. */
function page(html: string): Document {
  return new DOMParser().parseFromString(`<!DOCTYPE html><html><body>${html}</body></html>`, 'text/html')
}

function seen(html: string): string {
  return (page(html).body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

describe('signature slot markers', () => {
  it('prints an HTML comment that carries the slot key', () => {
    expect(signatureSlot('contract:host')).toBe('<!--signing-slot:contract:host-->')
    expect(seen(signatureSlot('contract:host'))).toBe('')
  })

  it('accepts lower case letters, digits, colons, underscores and hyphens', () => {
    for (const key of ['a', 'doc:worker', 'waiver:organiser', 'slot_2', 'quote-client', '0']) {
      expect(findSignatureSlots(signatureSlot(key)), key).toEqual([key])
    }
  })

  it('rejects a key that would not be found again or could break out of the comment', () => {
    for (const key of ['', ' ', 'Contract:Host', 'contract host', 'contract.host', 'contract-->', 'a<b', 'a>b', 'café', 'host\n', 'a/b']) {
      expect(() => signatureSlot(key), `key "${key}"`).toThrow(/Invalid signature slot key/)
    }
  })

  it('has a separate marker for the per-page initials, which is not a signature slot', () => {
    expect(initialsSlot()).toBe('<!--signing-initials-->')
    expect(findSignatureSlots(`<p>${initialsSlot()}</p>`)).toEqual([])
  })
})

describe('finding the slots in a document', () => {
  it('returns each key once, in the order it first appears', () => {
    const html = [
      '<h1>Agreement</h1>',
      signatureSlot('contract:host'),
      '<p>between</p>',
      signatureSlot('contract:anchor'),
      signatureSlot('contract:host'),
      signatureSlot('waiver:organiser'),
      signatureSlot('contract:anchor'),
    ].join('\n')

    expect(findSignatureSlots(html)).toEqual(['contract:host', 'contract:anchor', 'waiver:organiser'])
  })

  it('returns nothing for a document with no slots', () => {
    expect(findSignatureSlots('')).toEqual([])
    expect(findSignatureSlots('<p>Plain wording, <!-- an ordinary comment --> no slots.</p>')).toEqual([])
  })

  it('gives the same answer every time it is asked', () => {
    const html = `${signatureSlot('a')}${signatureSlot('b')}`
    expect(findSignatureSlots(html)).toEqual(['a', 'b'])
    expect(findSignatureSlots(html)).toEqual(['a', 'b'])
    fillSignatureSlots({ html, fills: {}, mode: 'sign', initialsText: null })
    expect(findSignatureSlots(html)).toEqual(['a', 'b'])
  })
})

describe('filling the slots', () => {
  it('replaces every marker, whether awaiting, signed or blank, and leaves none behind', () => {
    const html = `<section>
      <div id="host">${signatureSlot('contract:host')}</div>
      <div id="anchor">${signatureSlot('contract:anchor')}</div>
      <div id="other">${signatureSlot('waiver:organiser')}</div>
      <footer>${initialsSlot()}</footer>
    </section>`

    const filled = fillSignatureSlots({
      html,
      fills: {
        'contract:host': { state: 'awaiting', who: 'Paula Campbell' },
        'contract:anchor': signed({ name: 'Peter Pitcher, Director' }),
        'waiver:organiser': { state: 'blank' },
      },
      mode: 'sign',
      initialsText: 'To be signed electronically',
    })

    expect(filled).not.toContain(MARKER_TEXT)
    expect(findSignatureSlots(filled)).toEqual([])
    expect(seen(filled)).not.toMatch(BAD_OUTPUT)
  })

  it('puts each party in their own slot and nobody else in it', () => {
    const html = `<div id="host">${signatureSlot('contract:host')}</div><div id="anchor">${signatureSlot('contract:anchor')}</div>`

    const filled = page(
      fillSignatureSlots({
        html,
        fills: {
          'contract:host': signed({ name: 'Paula Campbell', reference: 'AAAA1111' }),
          'contract:anchor': signed({ name: 'Peter Pitcher, Director', reference: 'AAAA1111' }),
        },
        mode: 'sign',
        initialsText: null,
      })
    )

    const host = filled.getElementById('host')?.textContent ?? ''
    const anchor = filled.getElementById('anchor')?.textContent ?? ''
    expect(host).toContain('Paula Campbell')
    expect(host).not.toContain('Peter Pitcher')
    expect(anchor).toContain('Peter Pitcher, Director')
    expect(anchor).not.toContain('Paula Campbell')
  })

  it('renders a slot nobody gave a fill for as blank, never as a marker left in place', () => {
    const html = `<div id="known">${signatureSlot('contract:host')}</div><div id="forgotten">${signatureSlot('contract:anchor')}</div>`

    const withoutFill = fillSignatureSlots({
      html,
      fills: { 'contract:host': signed() },
      mode: 'sign',
      initialsText: null,
    })
    const withBlankFill = fillSignatureSlots({
      html,
      fills: { 'contract:host': signed(), 'contract:anchor': { state: 'blank' } },
      mode: 'sign',
      initialsText: null,
    })

    expect(withoutFill).not.toContain(MARKER_TEXT)
    expect(withoutFill).toBe(withBlankFill)
    const forgotten = page(withoutFill).getElementById('forgotten')
    expect(forgotten?.textContent?.trim()).toBe('')
    // The box is still there, holding the space the signature would have taken.
    expect(forgotten?.children).toHaveLength(1)
  })

  it('fills every copy of a slot that appears more than once', () => {
    const html = `<div class="copy">${signatureSlot('doc:worker')}</div><div class="copy">${signatureSlot('doc:worker')}</div>`

    const filled = fillSignatureSlots({ html, fills: { 'doc:worker': signed() }, mode: 'sign', initialsText: null })

    const copies = [...page(filled).querySelectorAll('.copy')].map((copy) => copy.textContent ?? '')
    expect(copies).toHaveLength(2)
    for (const copy of copies) expect(copy).toContain('Paula Campbell')
    expect(filled).not.toContain(MARKER_TEXT)
  })

  it('changes nothing in the document but the slots', () => {
    const before = '<h1>Private booking contract</h1>\n<p class="clause">1. The Host agrees &amp; confirms.</p>\n'
    const after = '\n<p class="clause">2. Nothing else changes.</p>'

    const filled = fillSignatureSlots({
      html: `${before}${signatureSlot('contract:host')}${after}`,
      fills: { 'contract:host': signed() },
      mode: 'sign',
      initialsText: null,
    })

    expect(filled.startsWith(before)).toBe(true)
    expect(filled.endsWith(after)).toBe(true)
  })

  it('escapes markup typed into a signed name, so it prints as text and never runs', () => {
    for (const name of [NASTY, NASTY_WITH_QUOTES]) {
      const filled = fillSignatureSlots({
        html: `<div id="slot">${signatureSlot('contract:host')}</div>`,
        fills: { 'contract:host': signed({ name }) },
        mode: 'sign',
        initialsText: null,
      })

      const document = page(filled)
      expect(document.querySelectorAll('script, img'), name).toHaveLength(0)
      expect(filled).not.toContain('<script>')
      expect(filled).not.toContain('<img')
      expect(seen(filled)).toContain(name)
    }
  })

  it('escapes markup in the name of someone still to sign', () => {
    const filled = fillSignatureSlots({
      html: signatureSlot('contract:host'),
      fills: { 'contract:host': { state: 'awaiting', who: NASTY } },
      mode: 'sign',
      initialsText: null,
    })

    expect(page(filled).querySelectorAll('script')).toHaveLength(0)
    expect(filled).not.toContain('<script>')
    expect(seen(filled)).toContain(NASTY)
  })

  it('escapes markup in the location, the time, how they signed and the reference', () => {
    const filled = fillSignatureSlots({
      html: signatureSlot('contract:host'),
      fills: {
        'contract:host': signed({
          when: '13 October 2026 <b>at</b> 11:41',
          location: `${NASTY}, ENG, GB`,
          how: 'In person, with <i>Sam</i> & Jo present',
          reference: '<u>REF</u>',
        }),
      },
      mode: 'sign',
      initialsText: null,
    })

    const document = page(filled)
    expect(document.querySelectorAll('script, b, i, u')).toHaveLength(0)
    const text = seen(filled)
    expect(text).toContain('13 October 2026 <b>at</b> 11:41')
    expect(text).toContain(`${NASTY}, ENG, GB (approximate location)`)
    expect(text).toContain('In person, with <i>Sam</i> & Jo present')
    expect(text).toContain('<u>REF</u>')
  })

  it('prints a name containing dollar signs exactly as typed', () => {
    const name = 'Cash $& Carry $1 $$ Ltd'

    const filled = fillSignatureSlots({
      html: `<p>before</p>${signatureSlot('quote:client')}<p>after</p>`,
      fills: { 'quote:client': signed({ name }) },
      mode: 'sign',
      initialsText: 'Signed $& ref $1',
    })

    expect(seen(filled)).toContain(name)
    expect(filled).not.toContain(MARKER_TEXT)
  })

  it('prints the initials text wherever the initials marker was', () => {
    const html = `<footer class="one"><span class="foot-init">${initialsSlot()}</span></footer><footer class="two"><span class="foot-init">${initialsSlot()}</span></footer>`

    const filled = fillSignatureSlots({ html, fills: {}, mode: 'sign', initialsText: 'Signed electronically, ref CEEBA528' })

    const footers = [...page(filled).querySelectorAll('.foot-init')].map((footer) => footer.textContent)
    expect(footers).toEqual(['Signed electronically, ref CEEBA528', 'Signed electronically, ref CEEBA528'])
    expect(filled).not.toContain(MARKER_TEXT)
  })

  it('prints nothing where the initials marker was when there is no initials text', () => {
    const html = `<footer><span class="foot-init">${initialsSlot()}</span></footer>`

    for (const initialsText of [null, '']) {
      const filled = fillSignatureSlots({ html, fills: {}, mode: 'sign', initialsText })
      expect(filled).toBe('<footer><span class="foot-init"></span></footer>')
    }
  })

  it('escapes markup in the initials text', () => {
    const filled = fillSignatureSlots({
      html: `<span class="foot-init">${initialsSlot()}</span>`,
      fills: {},
      mode: 'sign',
      initialsText: NASTY,
    })

    expect(page(filled).querySelectorAll('script')).toHaveLength(0)
    expect(filled).not.toContain('<script>')
    expect(page(filled).querySelector('.foot-init')?.textContent).toBe(NASTY)
  })

  it('does not treat marker text typed into a name as a slot or an initials marker', () => {
    const filled = fillSignatureSlots({
      html: `<div id="host">${signatureSlot('contract:host')}</div><div id="anchor">${signatureSlot('contract:anchor')}</div>`,
      fills: {
        'contract:host': signed({ name: `${signatureSlot('contract:anchor')} ${initialsSlot()}` }),
        'contract:anchor': signed({ name: 'Peter Pitcher' }),
      },
      mode: 'sign',
      initialsText: 'INITIALS HERE',
    })

    const host = page(filled).getElementById('host')?.textContent ?? ''
    expect(host).toContain(`${signatureSlot('contract:anchor')} ${initialsSlot()}`)
    expect(host).not.toContain('Peter Pitcher')
    expect(host).not.toContain('INITIALS HERE')
  })
})

describe('a signed panel', () => {
  it('carries the name, when, the approximate location, how they signed and the reference', () => {
    const text = seen(renderSignatureSlot(signed(), 'sign'))

    expect(text).toContain('Paula Campbell')
    expect(text).toContain('13 October 2026 at 11:41:35 BST')
    expect(text).toContain('Staines, ENG, GB (approximate location)')
    expect(text).toContain('By a personal link sent by email')
    expect(text).toContain('CEEBA528')
    expect(text).toContain(signedLabel('sign'))
    expect(text).not.toMatch(BAD_OUTPUT)
  })

  it('has no location line when the location is not known', () => {
    for (const location of [null, '']) {
      const text = seen(renderSignatureSlot(signed({ location }), 'sign'))
      expect(text).not.toContain('approximate location')
      expect(text).toContain('Paula Campbell')
      expect(text).toContain('13 October 2026 at 11:41:35 BST')
      expect(text).not.toMatch(BAD_OUTPUT)
    }
  })

  it('still says how they signed when there is no reference, and mentions no reference', () => {
    const text = seen(renderSignatureSlot(signed({ reference: null }), 'sign'))

    expect(text).toContain('By a personal link sent by email')
    expect(text).not.toMatch(/\bref\b/i)
    expect(text).not.toMatch(BAD_OUTPUT)
  })

  it('says signed for a document that is agreed to, and confirmed for one that is only acknowledged', () => {
    expect(signedLabel('sign')).toBe('Signed electronically')
    expect(signedLabel('acknowledge')).toBe('Confirmed electronically')

    const signedText = seen(renderSignatureSlot(signed(), 'sign'))
    const acknowledgedText = seen(renderSignatureSlot(signed(), 'acknowledge'))
    expect(signedText).toContain('Signed electronically')
    expect(signedText).not.toContain('Confirmed electronically')
    expect(acknowledgedText).toContain('Confirmed electronically')
    expect(acknowledgedText).not.toContain('Signed electronically')
  })
})

describe('a panel that is still awaiting a signature', () => {
  it('names who will sign and says no handwritten signature is needed', () => {
    const text = seen(renderSignatureSlot({ state: 'awaiting', who: 'Paula Campbell' }, 'sign'))

    expect(text).toContain('To be signed electronically')
    expect(text).toContain('Paula Campbell signs online')
    expect(text).toMatch(/no handwritten signature is needed/i)
  })

  it('asks for confirmation, not a signature, on a document that is only acknowledged', () => {
    const signText = seen(renderSignatureSlot({ state: 'awaiting', who: 'Alex Taylor' }, 'sign'))
    const acknowledgeText = seen(renderSignatureSlot({ state: 'awaiting', who: 'Alex Taylor' }, 'acknowledge'))

    expect(acknowledgeText).toContain('To be confirmed electronically')
    expect(acknowledgeText).not.toContain('To be signed electronically')
    expect(signText).toContain('To be signed electronically')
    expect(signText).not.toContain('To be confirmed electronically')
    // The line under the heading agrees with it: nobody "signs" a policy they are only confirming.
    expect(acknowledgeText).toContain('Alex Taylor confirms online')
    expect(acknowledgeText).not.toContain('signs online')
  })

  it('still reads properly when it does not know who will sign', () => {
    for (const fill of [{ state: 'awaiting' }, { state: 'awaiting', who: null }, { state: 'awaiting', who: '' }] as const) {
      const text = seen(renderSignatureSlot(fill, 'sign'))
      expect(text).toContain('To be signed electronically')
      expect(text).not.toContain('signs online')
      expect(text).not.toMatch(BAD_OUTPUT)
    }
  })

  it('never reads as signed', () => {
    for (const mode of ['sign', 'acknowledge'] as const) {
      const text = seen(renderSignatureSlot({ state: 'awaiting', who: 'Paula Campbell' }, mode))
      expect(text).not.toContain(signedLabel(mode))
    }
  })
})

describe('a blank panel', () => {
  it('shows nothing at all, in either mode', () => {
    expect(seen(renderSignatureSlot({ state: 'blank' }, 'sign'))).toBe('')
    expect(seen(renderSignatureSlot({ state: 'blank' }, 'acknowledge'))).toBe('')
  })
})

describe('how someone signed, in one line', () => {
  it('has a different line for each way of signing', () => {
    const lines = SIGNING_METHODS.map((method) => describeHow(method))

    for (const line of lines) expect(line.trim().length).toBeGreaterThan(0)
    expect(new Set(lines).size).toBe(SIGNING_METHODS.length)
  })

  it('says what each way of signing was', () => {
    expect(describeHow('link')).toMatch(/personal link/i)
    expect(describeHow('link')).toMatch(/email/i)
    expect(describeHow('portal')).toMatch(/staff portal/i)
    expect(describeHow('in_person')).toBe('In person')
    expect(describeHow('sender')).toMatch(/on sending/i)
  })

  it('names the manager who was present for an in person signing', () => {
    expect(describeHow('in_person', 'Sam Manager')).toBe('In person, with Sam Manager present')
  })

  it('says only in person when no manager is recorded', () => {
    expect(describeHow('in_person', null)).toBe('In person')
    expect(describeHow('in_person', undefined)).toBe('In person')
    expect(describeHow('in_person', '')).toBe('In person')
  })

  it('ignores a manager name for any other way of signing', () => {
    for (const method of ['link', 'portal', 'sender'] as const) {
      expect(describeHow(method, 'Sam Manager')).toBe(describeHow(method))
      expect(describeHow(method, 'Sam Manager')).not.toContain('Sam Manager')
    }
  })
})
