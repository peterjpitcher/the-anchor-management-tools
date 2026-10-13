// @vitest-environment node
// slot-fills reads the signing record module, which loads pdf-lib: a server module, so no jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CertificateParty } from '@/lib/signing/certificate'
import { describeHow } from '@/lib/signing/signature-slots'
import { buildAwaitingFills, buildSignedFills, signingReference } from '@/lib/signing/slot-fills'
import type { SigningPartyRole } from '@/lib/signing/types'

const DOCUMENT_ID = 'ceeba528-93c1-4d1e-8a55-0f6f1f0b2c11'

function party(overrides: Partial<CertificateParty> = {}): CertificateParty {
  return {
    id: 'party-1',
    document_id: DOCUMENT_ID,
    role: 'customer',
    name: 'Paula Campbell',
    email: 'paula@example.com',
    phone: null,
    employee_id: null,
    customer_id: 'cust-1',
    hashed_token: 'hash',
    token_expires_at: '2026-11-11T12:00:00.000Z',
    identity_check: 'none',
    identity_check_failures: 0,
    identity_checked_at: null,
    status: 'signed',
    first_opened_at: '2026-10-12T13:03:00.000Z',
    document_viewed_at: '2026-10-12T13:04:30.000Z',
    last_reminded_at: null,
    reminder_count: 0,
    method: 'link',
    typed_name: 'Paula J Campbell',
    agreed_text: 'I have read "Private booking contract" and I agree to it.',
    signed_at: '2026-10-12T13:05:09.000Z',
    signed_ip: '203.0.113.9',
    signed_user_agent: 'test-agent',
    signed_city: 'Staines-upon-Thames',
    signed_region: 'ENG',
    signed_country: 'GB',
    auth_user_id: null,
    witnessed_by: null,
    declined_at: null,
    decline_reason: null,
    created_at: '2026-10-12T12:00:00.000Z',
    updated_at: '2026-10-12T13:05:09.000Z',
    ...overrides,
  }
}

function signedDocument(context: Record<string, unknown> = {}): { id: string; context: Record<string, unknown> } {
  return { id: DOCUMENT_ID, context }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the short reference printed beside each signature', () => {
  it('is the start of the document id, in capitals', () => {
    expect(signingReference(DOCUMENT_ID)).toBe('CEEBA528')
  })

  it('leaves the hyphens out before counting eight characters', () => {
    expect(signingReference('ab-cd-ef-01-23-45')).toBe('ABCDEF01')
  })

  it('is the same every time for one document, and different for another', () => {
    expect(signingReference(DOCUMENT_ID)).toBe(signingReference(DOCUMENT_ID))
    expect(signingReference('11111111-1111-4111-8111-111111111111')).not.toBe(signingReference(DOCUMENT_ID))
  })
})

describe('the slots as the signers are first shown them', () => {
  const now = new Date('2026-10-13T10:41:35.000Z')

  it('shows the company slot as already signed by the sender, with their position and the date', () => {
    const fills = buildAwaitingFills({
      slots: { 'contract:anchor': 'company' },
      parties: [],
      sender: { name: 'Peter Pitcher', position: 'Director' },
      now,
    })

    expect(fills).toEqual({
      'contract:anchor': {
        state: 'signed',
        name: 'Peter Pitcher, Director',
        when: '13 October 2026',
        location: null,
        how: describeHow('sender'),
        reference: null,
      },
    })
  })

  it('shows the name of the sender alone when no position is given', () => {
    for (const position of [undefined, null, '']) {
      const fills = buildAwaitingFills({
        slots: { 'contract:anchor': 'company' },
        parties: [],
        sender: { name: 'Peter Pitcher', position },
        now,
      })
      expect(fills['contract:anchor']).toMatchObject({ state: 'signed', name: 'Peter Pitcher' })
    }
  })

  it('leaves the company slot blank when the business does not sign on sending', () => {
    for (const sender of [undefined, null]) {
      const fills = buildAwaitingFills({ slots: { 'contract:anchor': 'company' }, parties: [], sender, now })
      expect(fills).toEqual({ 'contract:anchor': { state: 'blank' } })
    }
  })

  it('shows every other slot as awaiting, with the name of the party who will sign there', () => {
    const fills = buildAwaitingFills({
      slots: { 'agreement:worker': 'worker', 'agreement:guardian': 'guardian', 'agreement:company': 'company' },
      parties: [
        { role: 'guardian', name: 'Morgan Taylor' },
        { role: 'worker', name: 'Alex Taylor' },
      ],
      sender: { name: 'Peter Pitcher', position: 'Director' },
      now,
    })

    expect(fills['agreement:worker']).toEqual({ state: 'awaiting', who: 'Alex Taylor' })
    expect(fills['agreement:guardian']).toEqual({ state: 'awaiting', who: 'Morgan Taylor' })
    expect(fills['agreement:company']).toMatchObject({ state: 'signed', name: 'Peter Pitcher, Director' })
  })

  it('leaves a slot blank when nobody on the document has its role', () => {
    const fills = buildAwaitingFills({
      slots: { 'agreement:worker': 'worker', 'agreement:guardian': 'guardian' },
      parties: [{ role: 'worker', name: 'Alex Taylor' }],
      now,
    })

    expect(fills['agreement:worker']).toEqual({ state: 'awaiting', who: 'Alex Taylor' })
    expect(fills['agreement:guardian']).toEqual({ state: 'blank' })
  })

  it('gives every slot a fill, and no others', () => {
    const slots: Record<string, SigningPartyRole> = {
      'contract:host': 'customer',
      'contract:anchor': 'company',
      'waiver:organiser': 'customer',
      'doc:supplier': 'supplier',
    }

    const fills = buildAwaitingFills({ slots, parties: [{ role: 'customer', name: 'Paula Campbell' }], now })

    expect(Object.keys(fills).sort()).toEqual(Object.keys(slots).sort())
    expect(fills['contract:host']).toEqual({ state: 'awaiting', who: 'Paula Campbell' })
    expect(fills['waiver:organiser']).toEqual({ state: 'awaiting', who: 'Paula Campbell' })
    expect(buildAwaitingFills({ slots: {}, parties: [{ role: 'customer', name: 'Paula Campbell' }], now })).toEqual({})
  })

  it('dates the company signature by the London calendar on both sides of the autumn clock change', () => {
    const dateAt = (instant: string): unknown =>
      buildAwaitingFills({
        slots: { 'contract:anchor': 'company' },
        parties: [],
        sender: { name: 'Peter Pitcher' },
        now: new Date(instant),
      })['contract:anchor']

    // Still summer time: 23:30 UTC on the 24th is already 00:30 on the 25th in London.
    expect(dateAt('2026-10-24T23:30:00Z')).toMatchObject({ when: '25 October 2026' })
    // The clocks went back at 01:00 UTC on the 25th, so 23:30 UTC is 23:30 in London.
    expect(dateAt('2026-10-25T23:30:00Z')).toMatchObject({ when: '25 October 2026' })
  })

  it('dates the company signature by the London calendar on both sides of the spring clock change', () => {
    const dateAt = (instant: string): unknown =>
      buildAwaitingFills({
        slots: { 'contract:anchor': 'company' },
        parties: [],
        sender: { name: 'Peter Pitcher' },
        now: new Date(instant),
      })['contract:anchor']

    // Winter time until 01:00 UTC on 29 March 2026.
    expect(dateAt('2026-03-28T23:30:00Z')).toMatchObject({ when: '28 March 2026' })
    expect(dateAt('2026-03-29T23:30:00Z')).toMatchObject({ when: '30 March 2026' })
  })

  it('uses today in London when it is not told the time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-24T23:30:00Z'))

    const fills = buildAwaitingFills({
      slots: { 'contract:anchor': 'company' },
      parties: [],
      sender: { name: 'Peter Pitcher' },
    })

    expect(fills['contract:anchor']).toMatchObject({ state: 'signed', when: '25 October 2026' })
  })
})

describe('the slots once the document is signed', () => {
  it('shows who signed, when, roughly where, how, and the reference', () => {
    const fills = buildSignedFills({
      document: signedDocument(),
      slots: { 'contract:host': 'customer' },
      parties: [party()],
    })

    expect(fills).toEqual({
      'contract:host': {
        state: 'signed',
        name: 'Paula J Campbell',
        when: '12 October 2026 at 14:05:09 BST',
        location: 'Staines-upon-Thames, ENG, GB',
        how: describeHow('link'),
        reference: 'CEEBA528',
      },
    })
  })

  it('shows the name as they typed it, and the name on record when nothing was typed', () => {
    const typed = buildSignedFills({
      document: signedDocument(),
      slots: { 'contract:host': 'customer' },
      parties: [party({ name: 'Paula Campbell', typed_name: 'P. J. Campbell' })],
    })
    const untyped = buildSignedFills({
      document: signedDocument(),
      slots: { 'contract:host': 'customer' },
      parties: [party({ name: 'Paula Campbell', typed_name: null })],
    })

    expect(typed['contract:host']).toMatchObject({ state: 'signed', name: 'P. J. Campbell' })
    expect(untyped['contract:host']).toMatchObject({ state: 'signed', name: 'Paula Campbell' })
  })

  it('shows the time on the London clock on both sides of a clock change', () => {
    const whenFor = (signedAt: string): unknown =>
      buildSignedFills({
        document: signedDocument(),
        slots: { 'contract:host': 'customer' },
        parties: [party({ signed_at: signedAt })],
      })['contract:host']

    expect(whenFor('2026-10-25T00:30:00.000Z')).toMatchObject({ when: '25 October 2026 at 01:30:00 BST' })
    expect(whenFor('2026-10-25T01:30:00.000Z')).toMatchObject({ when: '25 October 2026 at 01:30:00 GMT' })
    expect(whenFor('2026-10-24T23:30:00.000Z')).toMatchObject({ when: '25 October 2026 at 00:30:00 BST' })
  })

  it('joins the location from the city, region and country that are known', () => {
    const locationFor = (overrides: Partial<CertificateParty>): unknown =>
      buildSignedFills({
        document: signedDocument(),
        slots: { 'contract:host': 'customer' },
        parties: [party(overrides)],
      })['contract:host']

    expect(locationFor({})).toMatchObject({ location: 'Staines-upon-Thames, ENG, GB' })
    expect(locationFor({ signed_city: null })).toMatchObject({ location: 'ENG, GB' })
    expect(locationFor({ signed_region: null })).toMatchObject({ location: 'Staines-upon-Thames, GB' })
    expect(locationFor({ signed_city: null, signed_region: null })).toMatchObject({ location: 'GB' })
    expect(locationFor({ signed_city: 'Staines-upon-Thames', signed_region: null, signed_country: null })).toMatchObject({
      location: 'Staines-upon-Thames',
    })
  })

  it('has no location when none was captured', () => {
    for (const empty of [null, '']) {
      const fills = buildSignedFills({
        document: signedDocument(),
        slots: { 'contract:host': 'customer' },
        parties: [party({ signed_city: empty, signed_region: empty, signed_country: empty })],
      })
      expect(fills['contract:host']).toMatchObject({ state: 'signed', location: null })
    }
  })

  it('says how each person signed', () => {
    const howFor = (overrides: Partial<CertificateParty>): unknown =>
      buildSignedFills({
        document: signedDocument(),
        slots: { 'contract:host': 'customer' },
        parties: [party(overrides)],
      })['contract:host']

    expect(howFor({ method: 'link' })).toMatchObject({ how: describeHow('link') })
    expect(howFor({ method: 'portal' })).toMatchObject({ how: describeHow('portal') })
    expect(howFor({ method: 'sender' })).toMatchObject({ how: describeHow('sender') })
    expect(howFor({ method: 'in_person' })).toMatchObject({ how: 'In person' })
  })

  it('names the manager who was present when someone signed in person', () => {
    const fills = buildSignedFills({
      document: signedDocument(),
      slots: { 'contract:host': 'customer' },
      parties: [party({ method: 'in_person', witnessed_by: 'staff-1', witnessName: 'Sam Manager' })],
    })

    expect(fills['contract:host']).toMatchObject({ state: 'signed', how: 'In person, with Sam Manager present' })
  })

  it('keeps a party who has not signed as awaiting, with their name', () => {
    const unsigned: Array<Partial<CertificateParty>> = [
      { status: 'pending', method: null, signed_at: null, typed_name: null },
      { status: 'declined', method: null, signed_at: null, typed_name: null, declined_at: '2026-10-12T13:05:09.000Z' },
      // Rows that say signed but lack the facts of a signature are not shown as one.
      { status: 'signed', signed_at: null },
      { status: 'signed', method: null },
    ]

    for (const overrides of unsigned) {
      const fills = buildSignedFills({
        document: signedDocument(),
        slots: { 'contract:host': 'customer' },
        parties: [party(overrides)],
      })
      expect(fills['contract:host'], JSON.stringify(overrides)).toEqual({ state: 'awaiting', who: 'Paula Campbell' })
    }
  })

  it('adds the position of the sender to the company name', () => {
    const fills = buildSignedFills({
      document: signedDocument({ sender_position: 'Director' }),
      slots: { 'contract:anchor': 'company', 'contract:host': 'customer' },
      parties: [
        party(),
        party({ id: 'party-2', role: 'company', name: 'Orange Jelly Limited', typed_name: 'Peter Pitcher', method: 'sender' }),
      ],
    })

    expect(fills['contract:anchor']).toMatchObject({
      state: 'signed',
      name: 'Peter Pitcher, Director',
      how: describeHow('sender'),
      reference: 'CEEBA528',
    })
    // The position belongs to the business, never to the other signers.
    expect(fills['contract:host']).toMatchObject({ state: 'signed', name: 'Paula J Campbell' })
  })

  it('shows the company name alone when no position was recorded', () => {
    for (const context of [{}, { sender_position: null }, { sender_position: '' }, { sender_position: 42 }]) {
      const fills = buildSignedFills({
        document: signedDocument(context),
        slots: { 'contract:anchor': 'company' },
        parties: [party({ role: 'company', name: 'Orange Jelly Limited', typed_name: 'Peter Pitcher', method: 'sender' })],
      })
      expect(fills['contract:anchor'], JSON.stringify(context)).toMatchObject({ state: 'signed', name: 'Peter Pitcher' })
    }
  })

  it('leaves a slot blank when nobody on the document has its role', () => {
    const fills = buildSignedFills({
      document: signedDocument(),
      slots: { 'agreement:worker': 'worker', 'agreement:guardian': 'guardian' },
      parties: [party({ role: 'worker', name: 'Alex Taylor', typed_name: 'Alex Taylor' })],
    })

    expect(fills['agreement:guardian']).toEqual({ state: 'blank' })
    expect(fills['agreement:worker']).toMatchObject({ state: 'signed', name: 'Alex Taylor' })
  })

  it('puts each signer in the slot for their own role', () => {
    const fills = buildSignedFills({
      document: signedDocument(),
      slots: { 'agreement:company': 'company', 'agreement:worker': 'worker', 'agreement:guardian': 'guardian' },
      parties: [
        party({ id: 'p-guardian', role: 'guardian', name: 'Morgan Taylor', typed_name: 'Morgan Taylor', signed_city: 'Egham' }),
        party({ id: 'p-worker', role: 'worker', name: 'Alex Taylor', typed_name: 'Alex Taylor', method: 'portal', signed_city: 'Ashford' }),
        party({ id: 'p-company', role: 'company', name: 'Orange Jelly Limited', typed_name: 'Peter Pitcher', method: 'sender', signed_city: null, signed_region: null, signed_country: null }),
      ],
    })

    expect(Object.keys(fills).sort()).toEqual(['agreement:company', 'agreement:guardian', 'agreement:worker'])
    expect(fills['agreement:worker']).toMatchObject({ name: 'Alex Taylor', how: describeHow('portal'), location: 'Ashford, ENG, GB' })
    expect(fills['agreement:guardian']).toMatchObject({ name: 'Morgan Taylor', how: describeHow('link'), location: 'Egham, ENG, GB' })
    expect(fills['agreement:company']).toMatchObject({ name: 'Peter Pitcher', how: describeHow('sender'), location: null })
  })

  it('fills two slots that belong to the same person', () => {
    const fills = buildSignedFills({
      document: signedDocument(),
      slots: { 'contract:host': 'customer', 'waiver:organiser': 'customer' },
      parties: [party()],
    })

    expect(fills['contract:host']).toEqual(fills['waiver:organiser'])
    expect(fills['waiver:organiser']).toMatchObject({ state: 'signed', name: 'Paula J Campbell', reference: 'CEEBA528' })
  })
})
