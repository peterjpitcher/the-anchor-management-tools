import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))

import { buildAgreedText, buildCompanyAgreedText, isAcceptableTypedName } from '@/lib/signing/agreement-text'
import { appendCertificate, formatSigningInstant, renderCertificateHtml } from '@/lib/signing/certificate'
import {
  buildSigningCompletedEmail,
  buildSigningRequestEmail,
  buildSigningStaffNoticeEmail,
} from '@/lib/signing/emails'
import { describeDevice, describeLocation, readSigningEvidence } from '@/lib/signing/evidence'
import { SIGNING_KIND_DEFINITIONS } from '@/lib/signing/kinds'
import {
  TemplateMergeError,
  findDraftMarkers,
  findMergeFields,
  mergeTemplateText,
  renderTemplateDocumentHtml,
  templateBodyToHtml,
} from '@/lib/signing/template-render'
import {
  buildSigningUrl,
  generateSigningToken,
  hashSigningToken,
  isWellFormedSigningToken,
  sha256Hex,
} from '@/lib/signing/tokens'
import { SIGNING_KINDS, type SigningPartyRow } from '@/lib/signing/types'

const BAD_OUTPUT = /undefined|Invalid Date|NaN|\[object Object\]/

function headers(values: Record<string, string>): { get(name: string): string | null } {
  return { get: (name) => values[name.toLowerCase()] ?? null }
}

function party(overrides: Partial<SigningPartyRow> = {}): SigningPartyRow {
  return {
    id: 'party-1',
    document_id: 'doc-1',
    role: 'worker',
    name: 'Łukasz Example',
    email: 'lukasz@example.com',
    phone: null,
    employee_id: 'emp-1',
    customer_id: null,
    hashed_token: 'hash',
    token_expires_at: '2026-11-11T12:00:00.000Z',
    identity_check: 'date_of_birth',
    identity_check_failures: 0,
    identity_checked_at: '2026-10-12T13:04:00.000Z',
    status: 'signed',
    first_opened_at: '2026-10-12T13:03:00.000Z',
    document_viewed_at: '2026-10-12T13:04:30.000Z',
    last_reminded_at: null,
    reminder_count: 0,
    method: 'link',
    typed_name: 'Łukasz Example',
    agreed_text: 'I have read "Worker agreement" and I agree to it.',
    signed_at: '2026-10-12T13:05:09.000Z',
    signed_ip: '203.0.113.9',
    signed_user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
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

describe('signing tokens', () => {
  it('issues a 43 character token and stores only its hash', () => {
    const token = generateSigningToken()
    expect(isWellFormedSigningToken(token)).toBe(true)
    expect(hashSigningToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashSigningToken(token)).not.toContain(token)
    expect(generateSigningToken()).not.toBe(token)
  })

  it('rejects anything that is not one of our tokens before any lookup', () => {
    for (const bad of ['', 'short', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}/`, `${'a'.repeat(42)} `, null, undefined]) {
      expect(isWellFormedSigningToken(bad)).toBe(false)
    }
  })

  it('builds the link on the app URL and fingerprints bytes', () => {
    expect(buildSigningUrl('abc')).toBe('https://management.example.test/sign/abc')
    expect(sha256Hex(Buffer.from('hello'))).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824')
  })
})

describe('signing evidence', () => {
  it('reads the address, browser and approximate location from the request', () => {
    const evidence = readSigningEvidence(headers({
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      'user-agent': 'Mozilla/5.0 Test',
      'x-vercel-ip-city': 'Staines-upon-Thames',
      'x-vercel-ip-country-region': 'ENG',
      'x-vercel-ip-country': 'GB',
    }))
    expect(evidence).toEqual({
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 Test',
      city: 'Staines-upon-Thames',
      region: 'ENG',
      country: 'GB',
    })
    expect(describeLocation(evidence)).toBe('Staines-upon-Thames, ENG, GB')
  })

  it('decodes an encoded place name and survives a malformed one', () => {
    expect(readSigningEvidence(headers({ 'x-vercel-ip-city': 'Stanwell%20Moor' })).city).toBe('Stanwell Moor')
    expect(readSigningEvidence(headers({ 'x-vercel-ip-city': 'Bad%ZZName' })).city).toBe('Bad%ZZName')
  })

  it('says plainly when nothing is known, and never stores an unbounded header', () => {
    const empty = readSigningEvidence(headers({}))
    expect(empty).toEqual({ ip: null, userAgent: null, city: null, region: null, country: null })
    expect(describeLocation(empty)).toBe('Not available')
    expect(describeDevice(null)).toBe('Not available')
    expect(readSigningEvidence(headers({ 'user-agent': 'x'.repeat(5000) })).userAgent).toHaveLength(400)
  })
})

describe('agreement wording', () => {
  it('uses different words for signing and acknowledging, both naming the document', () => {
    const sign = buildAgreedText({ mode: 'sign', title: 'Worker agreement' })
    const acknowledge = buildAgreedText({ mode: 'acknowledge', title: 'Allergens policy' })
    expect(sign).toContain('"Worker agreement"')
    expect(sign).toContain('I agree')
    expect(acknowledge).toContain('read and understood "Allergens policy"')
    expect(acknowledge).not.toContain('I agree')
    expect(buildCompanyAgreedText({ title: 'Worker agreement' })).toContain('"Worker agreement"')
  })

  it('accepts real names and refuses blanks and scribbles', () => {
    for (const good of ['Sam Example', "Siobhán O'Neill", 'Łukasz Żółć', 'Li', 'J. R. Example-Smith']) {
      expect(isAcceptableTypedName(good)).toBe(true)
    }
    for (const bad of ['', ' ', 'x', '..', '123', '-', 'a'.repeat(121), null, undefined]) {
      expect(isAcceptableTypedName(bad)).toBe(false)
    }
  })
})

describe('template wording', () => {
  it('finds merge fields and refuses to send a document with a gap', () => {
    const body = 'Dear {{worker_name}}, your rate is {{ hourly_rate }}. Signed, {{worker_name}}.'
    expect(findMergeFields(body)).toEqual(['worker_name', 'hourly_rate'])
    expect(mergeTemplateText(body, { worker_name: 'Sam Example', hourly_rate: '£12.21' })).toBe(
      'Dear Sam Example, your rate is £12.21. Signed, Sam Example.'
    )
    expect(() => mergeTemplateText(body, { worker_name: 'Sam Example', hourly_rate: ' ' })).toThrow(TemplateMergeError)
    try {
      mergeTemplateText(body, {})
    } catch (error) {
      expect((error as TemplateMergeError).missingFields).toEqual(['worker_name', 'hourly_rate'])
    }
  })

  it('lists the gaps the owner still has to fill', () => {
    expect(findDraftMarkers('Pay is [[TO CONFIRM: rate]] and notice is [[TO CONFIRM: notice period]].')).toHaveLength(2)
    expect(findDraftMarkers('Nothing to confirm here.')).toEqual([])
  })

  it('turns headings, bullets and paragraphs into HTML and escapes everything typed', () => {
    const html = templateBodyToHtml('## Pay\nYou are paid weekly.\nIn arrears.\n\n- One <b>bold</b>\n- Two & three\n\nEnd.')
    expect(html).toContain('<h2>Pay</h2>')
    expect(html).toContain('<p>You are paid weekly.<br>In arrears.</p>')
    expect(html).toContain('<li>One &lt;b&gt;bold&lt;/b&gt;</li>')
    expect(html).toContain('<li>Two &amp; three</li>')
    expect(html).toContain('<p>End.</p>')
    expect(html).not.toContain('<b>')
  })

  it('renders a whole document for each brand with no broken values', () => {
    for (const brand of ['staff', 'guest'] as const) {
      const html = renderTemplateDocumentHtml({
        brand,
        title: 'Change to terms <test>',
        subtitle: 'Prepared for Sam Example on 12 October 2026',
        mergedBody: '## What changes\nYour hourly rate becomes £12.21.',
        reference: 'abc-123',
      })
      expect(html).toContain('Change to terms &lt;test&gt;')
      expect(html).toContain('Orange Jelly Limited')
      expect(html).toContain('Reference abc-123')
      expect(html).not.toMatch(BAD_OUTPUT)
    }
    expect(renderTemplateDocumentHtml({ brand: 'guest', title: 'T', mergedBody: 'B', reference: 'r' })).toContain('trading as The Anchor')
  })
})

describe('signing record', () => {
  it('shows UK time with seconds on both sides of a clock change', () => {
    expect(formatSigningInstant('2026-10-12T13:05:09.000Z')).toBe('12 October 2026 at 14:05:09 BST')
    expect(formatSigningInstant('2026-10-25T00:30:00.000Z')).toBe('25 October 2026 at 01:30:00 BST')
    expect(formatSigningInstant('2026-10-25T01:30:00.000Z')).toBe('25 October 2026 at 01:30:00 GMT')
    expect(formatSigningInstant('2026-12-31T00:00:05.000Z')).toBe('31 December 2026 at 00:00:05 GMT')
  })

  it('sets out who signed, how, and the fingerprint, with no broken values', () => {
    const html = renderCertificateHtml({
      document: {
        id: 'doc-1',
        title: 'Worker agreement <2026>',
        version: 2,
        source_sha256: 'a'.repeat(64),
        sent_at: '2026-10-12T12:00:00.000Z',
        completed_at: '2026-10-12T13:05:09.000Z',
      },
      parties: [
        party(),
        party({ id: 'party-2', role: 'company', name: 'Peter Pitcher', typed_name: 'Peter Pitcher', method: 'sender', email: null, identity_checked_at: null, document_viewed_at: null, signed_ip: null, signed_user_agent: null, signed_city: null, signed_region: null, signed_country: null }),
        party({ id: 'party-3', role: 'guardian', name: 'Pat Example', typed_name: 'Pat Example', method: 'in_person', witnessed_by: 'user-9', witnessName: 'Billy Summers' } as Partial<SigningPartyRow>),
        party({ id: 'party-4', status: 'pending', signed_at: null, method: null, name: 'Never Signed' }),
      ],
    })
    expect(html).toContain('Worker agreement &lt;2026&gt;')
    expect(html).toContain('a'.repeat(64))
    expect(html).toContain('Łukasz Example')
    expect(html).toContain('12 October 2026 at 14:05:09 BST')
    expect(html).toContain('Staines-upon-Thames, ENG, GB')
    expect(html).toContain('203.0.113.9')
    expect(html).toContain('Date of birth matched our records')
    expect(html).toContain('Personal link sent by email')
    expect(html).toContain('Signed on sending')
    expect(html).toContain('Manager present')
    expect(html).toContain('Billy Summers')
    expect(html).toContain('For the business')
    expect(html).not.toContain('Never Signed')
    expect(html).not.toMatch(BAD_OUTPUT)
  })

  it('adds the record after the document without touching its pages', async () => {
    const source = await PDFDocument.create()
    source.addPage([595, 842])
    source.addPage([595, 842])
    const certificate = await PDFDocument.create()
    certificate.addPage([595, 842])
    const merged = await PDFDocument.load(await appendCertificate(await source.save(), await certificate.save()))
    expect(merged.getPageCount()).toBe(3)
  })
})

describe('signing emails', () => {
  const request = {
    recipientName: 'Sam Example',
    title: 'Worker agreement',
    signingUrl: 'https://management.example.test/sign/abc',
    expiresAt: '2026-11-11T12:00:00.000Z',
  }

  it('renders every request and reminder with fixture data and no broken values', () => {
    for (const brand of ['staff', 'guest'] as const) {
      for (const mode of ['sign', 'acknowledge'] as const) {
        for (const isReminder of [false, true]) {
          const email = buildSigningRequestEmail({ ...request, brand, mode, isReminder })
          for (const part of [email.subject, email.text, email.html]) {
            expect(part).not.toMatch(BAD_OUTPUT)
            expect(part).toContain('Worker agreement')
          }
          expect(email.text).toContain('Hi Sam,')
          expect(email.text).toContain(request.signingUrl)
          expect(email.html).toContain(request.signingUrl)
          expect(email.text).toContain('11 November 2026')
          expect(email.subject.startsWith('Reminder:')).toBe(isReminder)
        }
      }
    }
  })

  it('speaks as The Anchor to guests and as Orange Jelly to staff and clients', () => {
    expect(buildSigningRequestEmail({ ...request, brand: 'guest', mode: 'sign' }).text).toContain('The Anchor has sent you')
    expect(buildSigningRequestEmail({ ...request, brand: 'staff', mode: 'sign' }).text).toContain('Orange Jelly Limited has sent you')
  })

  it('escapes a title and a name that carry markup', () => {
    const email = buildSigningRequestEmail({ ...request, brand: 'staff', mode: 'sign', recipientName: '<Sam>', title: 'A & B <script>' })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('A &amp; B &lt;script&gt;')
    expect(email.html).toContain('Hi &lt;Sam&gt;,')
  })

  it('renders the signed copy email and all three staff notices', () => {
    for (const mode of ['sign', 'acknowledge'] as const) {
      const email = buildSigningCompletedEmail({ brand: 'guest', mode, recipientName: 'Sam Example', title: 'Booking contract' })
      expect(email.subject).toBe(mode === 'sign' ? 'Signed: Booking contract' : 'Confirmed: Booking contract')
      expect(`${email.text}${email.html}`).not.toMatch(BAD_OUTPUT)
      expect(email.text).toContain('signing record')
    }
    for (const outcome of ['completed', 'declined', 'expired'] as const) {
      const email = buildSigningStaffNoticeEmail({
        outcome,
        title: 'Booking contract',
        subjectLabel: "Sam Example's booking",
        partyName: 'Sam Example',
        declineReason: outcome === 'declined' ? 'The date is wrong' : null,
        recordUrl: 'https://management.example.test/private-bookings/1',
      })
      expect(`${email.subject}${email.text}${email.html}`).not.toMatch(BAD_OUTPUT)
      expect(email.text).toContain('https://management.example.test/private-bookings/1')
    }
    expect(buildSigningStaffNoticeEmail({ outcome: 'declined', title: 'T', subjectLabel: 'S', partyName: 'Sam', declineReason: 'The date is wrong', recordUrl: 'u' }).text).toContain('The date is wrong')
    expect(buildSigningStaffNoticeEmail({ outcome: 'declined', title: 'T', subjectLabel: 'S', recordUrl: 'u' }).text).toContain('did not give a reason')
  })
})

describe('kind registry', () => {
  it('defines every kind once, with signers and permissions', () => {
    expect(Object.keys(SIGNING_KIND_DEFINITIONS).sort()).toEqual([...SIGNING_KINDS].sort())
    for (const kind of SIGNING_KINDS) {
      const definition = SIGNING_KIND_DEFINITIONS[kind]
      expect(definition.kind).toBe(kind)
      expect(definition.signerRoles.length).toBeGreaterThan(0)
      expect(definition.signerRoles).not.toContain('company')
      expect(definition.label.length).toBeGreaterThan(3)
    }
    expect(SIGNING_KIND_DEFINITIONS.policy_acknowledgement.mode).toBe('acknowledge')
  })
})
