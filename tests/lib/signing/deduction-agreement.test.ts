// @vitest-environment node
// Server code that reads and writes with the service role: no browser globals wanted.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

/**
 * The deposit deduction agreement (owner decision, 13 October 2026): what a signature does to
 * the deduction, when a request for one is withdrawn, and the wording it is seeded with.
 *
 * The General Manager decides a deduction (SOP section 25). So a signature may only ever move a
 * deduction to Discussed, and must never touch one that has been approved, rejected or applied.
 */

type Row = Record<string, unknown>

const state = vi.hoisted(() => ({ client: null as unknown }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))

import { SIGNING_COMPLETION_HOOKS, deductionAgreedNote, runCompletionHook } from '@/lib/signing/completion-hooks'
import { getSigningKind } from '@/lib/signing/kinds'
import { signingKindsForSubject } from '@/lib/signing/staff'
import { findSubjectClosure } from '@/lib/signing/subject-state'
import { SINGLE_TEMPLATE_SLUGS, TEMPLATE_MERGE_FIELDS, unknownMergeFields } from '@/lib/signing/template-fields'
import { findDraftMarkers, findMergeFields } from '@/lib/signing/template-render'
import { templateActivationBlocker } from '@/lib/signing/templates'
import { SIGNING_KINDS, SIGNING_TEMPLATE_KINDS, type SigningDocumentRow } from '@/lib/signing/types'

const BOOKING = '11111111-1111-4111-8111-111111111111'
const OTHER_BOOKING = '22222222-2222-4222-8222-222222222222'
const DEDUCTION = '77777777-7777-4777-8777-777777777777'
const OTHER_DEDUCTION = '88888888-8888-4888-8888-888888888888'
const DOCUMENT = 'ceeba528-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

/** When the customer signed: the evening of 14 October in London, and still 14 October in UTC. */
const SIGNED_AT = '2026-10-14T19:05:09.000Z'
/** When the hook runs in these tests: five days later, as a retry by the daily job would. */
const RUN_AT = '2026-10-19T06:00:00.000Z'
const AGREED = 'Agreed by the customer online on 14 October 2026 (signing reference CEEBA528)'

let db: FakeDb

function deductionRow(extra: Row = {}): Row {
  return {
    id: DEDUCTION,
    booking_id: BOOKING,
    amount: 50,
    reason: 'Red wine on the function room carpet',
    status: 'proposed',
    customer_discussion_note: null,
    approved_by: null,
    approved_at: null,
    ...extra,
  }
}

function seed(tables: Record<string, Row[]>): void {
  db = createFakeDb(tables)
  state.client = db.client
}

function deduction(id = DEDUCTION): Row {
  return db.rows('private_booking_deductions').find((row) => row.id === id) as Row
}

function audit(): Row[] {
  return db.rows('private_booking_audit')
}

function signedAgreement(overrides: Partial<SigningDocumentRow> = {}): SigningDocumentRow {
  return {
    id: DOCUMENT,
    kind: 'deposit_deduction_agreement',
    mode: 'sign',
    brand: 'guest',
    title: 'Deposit deduction agreement',
    summary: null,
    subject_type: 'private_booking',
    subject_id: BOOKING,
    series_key: `deduction:${DEDUCTION}`,
    version: 1,
    template_id: null,
    template_version: 1,
    context: { deduction_id: DEDUCTION, deduction_amount: 50, deduction_reason: 'Red wine on the function room carpet' },
    status: 'completed',
    source_pdf_path: `private_booking/${BOOKING}/${DOCUMENT}/document.pdf`,
    source_sha256: 'a'.repeat(64),
    final_pdf_path: `private_booking/${BOOKING}/${DOCUMENT}/signed.pdf`,
    final_sha256: 'b'.repeat(64),
    supersedes_id: null,
    expires_at: '2026-11-12T12:00:00.000Z',
    sent_at: '2026-10-13T12:00:00.000Z',
    completed_at: SIGNED_AT,
    completion_applied_at: null,
    copies_sent_at: SIGNED_AT,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_by: '99999999-9999-4999-8999-999999999999',
    created_at: '2026-10-13T12:00:00.000Z',
    updated_at: SIGNED_AT,
    ...overrides,
  }
}

beforeEach(() => {
  // Only the date is frozen, so the promises the fake database returns still settle.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(RUN_AT))
  seed({ private_bookings: [{ id: BOOKING, status: 'completed' }], private_booking_deductions: [deductionRow()] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the kind', () => {
  it('is the thirteenth kind and the ninth with wording in a template', () => {
    expect(SIGNING_KINDS).toHaveLength(13)
    expect(SIGNING_KINDS).toContain('deposit_deduction_agreement')
    expect(SIGNING_TEMPLATE_KINDS).toHaveLength(9)
    expect(SIGNING_TEMPLATE_KINDS).toContain('deposit_deduction_agreement')
  })

  it('goes out as The Anchor, to the customer alone, on the booking, for signature', () => {
    expect(getSigningKind('deposit_deduction_agreement')).toEqual({
      kind: 'deposit_deduction_agreement',
      label: 'Deposit deduction agreement',
      mode: 'sign',
      brand: 'guest',
      subjectType: 'private_booking',
      signerRoles: ['customer'],
      companySigns: false,
      source: 'template',
      // The permissions proposeDeduction and listDeductions check.
      sendPermission: { module: 'private_bookings', action: 'manage_deposits' },
      viewPermission: { module: 'private_bookings', action: 'view' },
    })
  })

  it('is one of the three kinds a private booking can hold', () => {
    expect(signingKindsForSubject('private_booking')).toEqual([
      'private_booking_contract',
      'private_booking_waiver',
      'deposit_deduction_agreement',
    ])
  })
})

describe('a signed deposit deduction agreement', () => {
  it('moves a proposed deduction to Discussed and says the customer agreed online, with the date and the reference', async () => {
    await runCompletionHook(signedAgreement(), [])

    expect(deduction()).toMatchObject({ status: 'discussed', customer_discussion_note: AGREED })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({
      booking_id: BOOKING,
      action: 'field_updated',
      field_name: 'deduction_status',
      old_value: 'proposed',
      new_value: 'discussed',
      performed_by: null,
      metadata: { via: 'e_signature', signing_document_id: DOCUMENT, deduction_id: DEDUCTION },
    })
  })

  it('never approves or applies it, and names no approver: the General Manager still decides', async () => {
    await runCompletionHook(signedAgreement(), [])

    expect(deduction()).toMatchObject({ status: 'discussed', approved_by: null, approved_at: null, amount: 50 })
    // Only the deduction and its audit row are written: no booking, payment or refund is touched.
    expect(db.writes.map((write) => `${write.table}:${write.operation}`)).toEqual([
      'private_booking_deductions:update',
      'private_booking_audit:insert',
    ])
    expect(Object.keys(db.writes[0].payload as Row).sort()).toEqual(['customer_discussion_note', 'status', 'updated_at'])
  })

  it('keeps a note staff already typed, with the agreement on its own line beneath it', async () => {
    seed({ private_booking_deductions: [deductionRow({ status: 'discussed', customer_discussion_note: 'Spoke to Alex by phone on Monday.' })] })

    await runCompletionHook(signedAgreement(), [])

    expect(deduction()).toMatchObject({
      status: 'discussed',
      customer_discussion_note: `Spoke to Alex by phone on Monday.\n${AGREED}`,
    })
    expect(audit()[0]).toMatchObject({ old_value: 'discussed', new_value: 'discussed' })
  })

  it('treats a blank note as no note', async () => {
    seed({ private_booking_deductions: [deductionRow({ customer_discussion_note: '   ' })] })

    await runCompletionHook(signedAgreement(), [])

    expect(deduction().customer_discussion_note).toBe(AGREED)
  })

  it.each(['approved', 'rejected', 'applied'])('leaves a deduction that is already %s exactly as it is', async (status) => {
    seed({ private_booking_deductions: [deductionRow({ status, customer_discussion_note: 'Decided at the Monday meeting.' })] })

    await runCompletionHook(signedAgreement(), [])

    expect(deduction()).toMatchObject({ status, customer_discussion_note: 'Decided at the Monday meeting.' })
    expect(db.writes).toEqual([])
  })

  it('dates the agreement by when it was signed, on the London calendar, not by when this ran', async () => {
    // Half past midnight in London on 25 October, which is still 24 October in UTC.
    await runCompletionHook(signedAgreement({ completed_at: '2026-10-24T23:30:00.000Z' }), [])

    expect(deduction().customer_discussion_note).toBe('Agreed by the customer online on 25 October 2026 (signing reference CEEBA528)')
  })

  it('falls back to the day it ran for a document with no completion time recorded', async () => {
    await runCompletionHook(signedAgreement({ completed_at: null }), [])

    expect(deduction().customer_discussion_note).toBe('Agreed by the customer online on 19 October 2026 (signing reference CEEBA528)')
  })

  it('touches only its own deduction', async () => {
    seed({ private_booking_deductions: [deductionRow(), deductionRow({ id: OTHER_DEDUCTION, booking_id: BOOKING })] })

    await runCompletionHook(signedAgreement(), [])

    expect(deduction().status).toBe('discussed')
    expect(deduction(OTHER_DEDUCTION)).toMatchObject({ status: 'proposed', customer_discussion_note: null })
  })

  it('changes nothing when run a second time', async () => {
    await runCompletionHook(signedAgreement(), [])
    const writes = db.writes.length
    const after = { ...deduction() }

    // A retry a day later still.
    vi.setSystemTime(new Date('2026-10-20T06:00:00.000Z'))
    await runCompletionHook(signedAgreement(), [])

    expect(db.writes).toHaveLength(writes)
    expect(deduction()).toEqual(after)
    expect(audit()).toHaveLength(1)
  })

  it('does nothing when the deduction no longer exists, or the document names none', async () => {
    seed({ private_booking_deductions: [] })
    await runCompletionHook(signedAgreement(), [])
    expect(db.writes).toEqual([])

    seed({ private_booking_deductions: [deductionRow()] })
    await runCompletionHook(signedAgreement({ context: {} }), [])
    expect(db.writes).toEqual([])
    expect(deduction().status).toBe('proposed')
  })
})

describe('a signature that lands as the deduction is being changed', () => {
  it.each(['approved', 'rejected', 'applied'])(
    'does not overwrite a decision made in the moment between its read and its write: %s',
    async (decision) => {
      db.beforeUpdate((table, matched) => {
        if (table === 'private_booking_deductions') for (const row of matched) row.status = decision
      })

      await runCompletionHook(signedAgreement(), [])

      expect(deduction()).toMatchObject({ status: decision, customer_discussion_note: null })
      expect(audit()).toHaveLength(0)
    }
  )

  it('reads again and still records the agreement when staff save a discussion note in that moment, keeping their note', async () => {
    let moved = false
    db.beforeUpdate((table, matched) => {
      if (table !== 'private_booking_deductions' || moved) return
      moved = true
      for (const row of matched) Object.assign(row, { status: 'discussed', customer_discussion_note: 'Alex rang: happy with it.' })
    })

    await runCompletionHook(signedAgreement(), [])

    expect(deduction()).toMatchObject({ status: 'discussed', customer_discussion_note: `Alex rang: happy with it.\n${AGREED}` })
    expect(audit()).toHaveLength(1)
    // What it really overwrote, not what it first read.
    expect(audit()[0]).toMatchObject({ old_value: 'discussed', new_value: 'discussed' })
  })

  it('fails, so that it is run again, when the deduction moves three times running', async () => {
    let count = 0
    db.beforeUpdate((table, matched) => {
      if (table !== 'private_booking_deductions') return
      count += 1
      for (const row of matched) row.customer_discussion_note = `Edit ${count}`
    })

    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow('it kept changing')
    expect(deduction()).toMatchObject({ status: 'proposed', customer_discussion_note: 'Edit 3' })
    expect(audit()).toHaveLength(0)
  })
})

describe('a signed deposit deduction agreement whose record cannot be written', () => {
  it('puts the deduction back and fails when the audit row cannot be written', async () => {
    seed({ private_booking_deductions: [deductionRow({ customer_discussion_note: 'Spoke to Alex by phone on Monday.' })] })
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })

    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow(
      "Could not record the customer's agreement on the deduction: audit unavailable"
    )

    expect(deduction()).toMatchObject({ status: 'proposed', customer_discussion_note: 'Spoke to Alex by phone on Monday.' })
    expect(audit()).toHaveLength(0)
  })

  it('puts back a deduction that had no note to having no note', async () => {
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })

    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow('audit unavailable')

    expect(deduction()).toMatchObject({ status: 'proposed', customer_discussion_note: null })
  })

  it('ends Discussed, with exactly one audit row, when it is tried again after an audit failure', async () => {
    db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })
    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow('audit unavailable')

    await runCompletionHook(signedAgreement(), [])

    expect(deduction()).toMatchObject({ status: 'discussed', customer_discussion_note: AGREED })
    expect(audit()).toHaveLength(1)
    expect(audit()[0]).toMatchObject({ old_value: 'proposed', new_value: 'discussed' })
  })

  it('does not undo a decision the General Manager made while the audit row was failing', async () => {
    state.client = {
      ...db.client,
      from: (table: string) => {
        const builder = db.client.from(table)
        if (table !== 'private_booking_audit') return builder
        return {
          ...builder,
          insert: (payload: Row | Row[]) => {
            db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })
            deduction().status = 'approved'
            return builder.insert(payload)
          },
        }
      },
    }

    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow('audit unavailable')

    expect(deduction().status).toBe('approved')
  })

  it('says both things when the audit row fails and the deduction cannot be put back either', async () => {
    state.client = {
      ...db.client,
      from: (table: string) => {
        const builder = db.client.from(table)
        if (table !== 'private_booking_audit') return builder
        return {
          ...builder,
          insert: (payload: Row | Row[]) => {
            db.failNext({ table: 'private_booking_audit', operation: 'insert', message: 'audit unavailable', times: 1 })
            db.failNext({ table: 'private_booking_deductions', operation: 'update', message: 'still unavailable', times: 1 })
            return builder.insert(payload)
          },
        }
      },
    }

    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow(
      "Could not record the customer's agreement on the deduction: audit unavailable (and the change could not be put back: still unavailable)"
    )
  })

  it('fails, and writes no audit row, when the deduction cannot be read or cannot be updated', async () => {
    db.failNext({ table: 'private_booking_deductions', operation: 'select', message: 'database down', times: 1 })
    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow('Could not read the deduction: database down')

    db.failNext({ table: 'private_booking_deductions', operation: 'update', message: 'database down', times: 1 })
    await expect(runCompletionHook(signedAgreement(), [])).rejects.toThrow(
      "Could not record the customer's agreement on the deduction: database down"
    )
    expect(deduction().status).toBe('proposed')
    expect(audit()).toHaveLength(0)
  })

  it('is the hook the registry runs for this kind, and no other booking hook', async () => {
    seed({
      private_bookings: [{ id: BOOKING, status: 'confirmed', contract_accepted_at: null, waiver_status: 'sent' }],
      private_booking_deductions: [deductionRow()],
    })

    await SIGNING_COMPLETION_HOOKS.deposit_deduction_agreement(signedAgreement(), [])

    expect(deduction().status).toBe('discussed')
    expect(db.rows('private_bookings')[0]).toMatchObject({ contract_accepted_at: null, waiver_status: 'sent' })
  })

  it('writes the line with the first eight characters of the document id, in capitals', () => {
    expect(deductionAgreedNote({ id: DOCUMENT, completed_at: SIGNED_AT })).toBe(AGREED)
  })
})

describe('whether a request for agreement still stands', () => {
  type SubjectDocument = Parameters<typeof findSubjectClosure>[0]

  function request(overrides: Partial<SubjectDocument> = {}): SubjectDocument {
    return {
      kind: 'deposit_deduction_agreement',
      subject_type: 'private_booking',
      subject_id: BOOKING,
      context: { deduction_id: DEDUCTION },
      ...overrides,
    }
  }

  function useDb(bookingStatus: string | null, deductions: Row[]): void {
    seed({
      private_bookings: bookingStatus === null ? [] : [{ id: BOOKING, status: bookingStatus, waiver_status: 'not_required', outside_food: false }],
      private_booking_deductions: deductions,
    })
  }

  it.each(['proposed', 'discussed', 'approved'])('stands while the deduction is %s', async (status) => {
    useDb('completed', [deductionRow({ status })])

    expect(await findSubjectClosure(request())).toBeNull()
  })

  it('is withdrawn when the deduction was rejected', async () => {
    useDb('completed', [deductionRow({ status: 'rejected' })])

    expect(await findSubjectClosure(request())).toBe('The deduction was rejected')
  })

  it('is withdrawn when the deduction has been applied', async () => {
    useDb('completed', [deductionRow({ status: 'applied' })])

    expect(await findSubjectClosure(request())).toBe('The deduction has been applied')
  })

  it('is withdrawn when the deduction no longer exists', async () => {
    useDb('completed', [deductionRow({ id: OTHER_DEDUCTION })])

    expect(await findSubjectClosure(request())).toBe('The deduction no longer exists')
  })

  it('is withdrawn when the request names no deduction, or names one on another booking', async () => {
    useDb('completed', [deductionRow({ booking_id: OTHER_BOOKING })])

    expect(await findSubjectClosure(request({ context: {} }))).toBe('The deduction no longer exists')
    expect(await findSubjectClosure(request())).toBe('The deduction no longer exists')
  })

  it('is withdrawn when the booking no longer exists', async () => {
    useDb(null, [deductionRow()])

    expect(await findSubjectClosure(request())).toBe('The booking no longer exists')
  })

  it('still stands when the booking was cancelled: a deduction can follow a cancelled event', async () => {
    useDb('cancelled', [deductionRow()])

    expect(await findSubjectClosure(request())).toBeNull()
    // The contract for the same booking is closed, as it always was.
    expect(await findSubjectClosure({ kind: 'private_booking_contract', subject_type: 'private_booking', subject_id: BOOKING, context: {} })).toBe(
      'The booking was cancelled'
    )
  })

  it('is not closed by the food agreement rules, which are for the food agreement alone', async () => {
    seed({
      private_bookings: [{ id: BOOKING, status: 'completed', waiver_status: 'signed', outside_food: false }],
      private_booking_deductions: [deductionRow()],
    })

    expect(await findSubjectClosure(request())).toBeNull()
  })

  it('fails, and does not report the request as closed or as standing, when the booking cannot be read', async () => {
    useDb('completed', [deductionRow()])
    db.failNext({ table: 'private_bookings', operation: 'select', message: 'database down' })

    await expect(findSubjectClosure(request())).rejects.toThrow('Could not read the booking: database down')
  })

  it('fails the same way when the deduction cannot be read', async () => {
    useDb('completed', [deductionRow()])
    db.failNext({ table: 'private_booking_deductions', operation: 'select', message: 'database down' })

    await expect(findSubjectClosure(request())).rejects.toThrow('Could not read the deduction: database down')
  })
})

describe('the wording it is seeded with', () => {
  const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261014084753_signing_deposit_deduction_agreement.sql'), 'utf8')
  const seeded = migration.match(/\('([a-z_]+)', '([a-z0-9-]+)', '([^']+)', \$body\$([\s\S]*?)\$body\$\)/) as RegExpMatchArray
  const [, kind, slug, title, body] = seeded

  it('is one template, for this kind, under the slug the send action asks for', () => {
    expect(migration.match(/\$body\$/g)).toHaveLength(2)
    expect(kind).toBe('deposit_deduction_agreement')
    expect(slug).toBe(SINGLE_TEMPLATE_SLUGS.deposit_deduction_agreement)
    expect(title).toBe('Deposit deduction agreement')
  })

  it('uses every field the customer needs to see, and only fields the send action supplies', () => {
    expect(unknownMergeFields('deposit_deduction_agreement', findMergeFields(`${title}\n${body}`))).toEqual([])
    expect([...new Set(findMergeFields(body))].sort()).toEqual(
      ['amount_to_return', 'customer_name', 'deduction_amount', 'deduction_reason', 'deposit_amount', 'event_label']
    )
    expect(TEMPLATE_MERGE_FIELDS.deposit_deduction_agreement).toEqual([
      'customer_name',
      'event_label',
      'deduction_amount',
      'deposit_amount',
      'deduction_reason',
      'amount_to_return',
      'manager_name',
      'date_today',
    ])
  })

  it('cannot be switched on as seeded: both gaps are still there for the owner to fill', () => {
    expect(findDraftMarkers(body)).toEqual([
      '[[TO CONFIRM: how and when the rest of the deposit is returned, for example to the card or account it was paid from within 48 hours of your agreement]]',
      '[[TO CONFIRM: any wording you want about how a disagreement is settled]]',
    ])
    expect(templateActivationBlocker({ title, body })).toContain('Fill in or remove these 2 gaps first')
  })

  it('can be switched on once the owner has filled both gaps', () => {
    const filled = body
      .replace(/\[\[TO CONFIRM: how and when[^\]]*\]\]/, 'We return it to the account it was paid from.')
      .replace(/\[\[TO CONFIRM: any wording[^\]]*\]\]/, '')
    expect(templateActivationBlocker({ title, body: filled })).toBeNull()
  })

  it('is seeded switched off, without naming the switch, and never overwrites wording already there', () => {
    const statements = migration.replace(/^\s*--.*$/gm, '')
    expect(statements).not.toMatch(/is_active/i)
    expect(statements).toContain('INSERT INTO public.signing_templates (kind, slug, title, body) VALUES')
    expect(statements).toContain('ON CONFLICT (slug) DO NOTHING')
  })

  it('says plainly what signing means, with no shouting and no em dash', () => {
    expect(body).toContain('By signing you agree to this deduction from your deposit.')
    expect(body).toContain('If you do not agree, use Decline and tell us why.')
    // The gaps are notes to the owner and never reach a customer, so they are left out of this.
    expect(body.replace(/\[\[[^\]]*\]\]/g, '')).not.toMatch(/\*\*|[A-Z]{6,}/)
    // Built at runtime so this file does not contain the character.
    expect(migration.includes(String.fromCharCode(0x2014))).toBe(false)
  })
})
