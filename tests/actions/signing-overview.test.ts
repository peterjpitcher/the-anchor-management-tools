// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * The Signatures page used to read each document, its signers and its subject one at a time:
 * up to three hundred reads in a row. It now reads the documents in full, every signer in one
 * read and each kind of subject in one read. These tests hold the list to exactly what the old
 * one-at-a-time path produced, and hold the number of reads down.
 */

type Row = Record<string, unknown>

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  getUser: vi.fn(),
  permission: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.permission }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }))

import { getSigningOverview } from '@/app/actions/signing'
import { getSigningDocument } from '@/lib/signing/service'
import { describeSigningSubject, describeSigningSubjects } from '@/lib/signing/subjects'

const STAFF_ID = '99999999-9999-4999-8999-999999999999'

let db: FakeDb
let reads: string[]

function id(n: number): string {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
}

function documentRow(n: number, kind: string, subjectType: string, subjectId: string, extra: Row = {}): Row {
  return {
    id: id(1000 + n),
    kind,
    mode: 'sign',
    brand: 'staff',
    title: `Document ${n}`,
    summary: null,
    subject_type: subjectType,
    subject_id: subjectId,
    series_key: `series-${n}`,
    version: 1,
    template_id: null,
    template_version: null,
    context: {},
    status: 'sent',
    source_pdf_path: `docs/${n}.pdf`,
    source_sha256: 'abc',
    final_pdf_path: null,
    final_sha256: null,
    supersedes_id: null,
    expires_at: '2026-12-31T00:00:00.000Z',
    sent_at: '2026-11-01T09:00:00.000Z',
    completed_at: null,
    completion_applied_at: null,
    copies_sent_at: null,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_by: STAFF_ID,
    // Newer documents first, as the page orders them.
    created_at: new Date(Date.UTC(2026, 10, 1, 9, 0, n)).toISOString(),
    updated_at: '2026-11-01T09:00:00.000Z',
    ...extra,
  }
}

function party(n: number, documentId: string, second: number): Row {
  return {
    id: id(5000 + n),
    document_id: documentId,
    role: 'worker',
    name: `Signer ${n}`,
    email: `signer${n}@example.test`,
    status: 'pending',
    hashed_token: `secret-${n}`,
    created_at: new Date(Date.UTC(2026, 10, 1, 9, 0, second)).toISOString(),
  }
}

/** One document for every subject type and every name fallback, plus a missing subject. */
function seed(): FakeDb {
  const documents = [
    documentRow(1, 'employment_agreement', 'employee', id(1)),
    documentRow(2, 'policy_acknowledgement', 'employee', id(2)), // blank name
    documentRow(3, 'employment_agreement', 'employee', id(1)), // same subject as document 1
    documentRow(4, 'private_booking_contract', 'private_booking', id(10)), // first and last name
    documentRow(5, 'private_booking_waiver', 'private_booking', id(11)), // only customer_name
    documentRow(6, 'deposit_deduction_agreement', 'private_booking', id(12)), // no name at all
    documentRow(7, 'quote_acceptance', 'quote', id(20)),
    documentRow(8, 'job_offer', 'recruitment_application', id(30)), // candidate as object
    documentRow(9, 'job_offer', 'recruitment_application', id(31)), // candidate as array
    documentRow(10, 'job_offer', 'recruitment_application', id(32)), // no candidate
    documentRow(11, 'client_agreement', 'invoice_vendor', id(40)),
    documentRow(12, 'supplier_confirmation', 'vendor', id(50)),
    documentRow(13, 'quote_acceptance', 'quote', id(29)), // subject no longer exists
    documentRow(14, 'training_completion', 'employee', id(3)),
    documentRow(15, 'employment_agreement', 'employee', id(1), { status: 'completed' }), // other group
  ]
  return createFakeDb({
    signing_documents: documents,
    signing_parties: [
      party(1, id(1001), 5),
      party(2, id(1001), 2), // earlier signer, must come first
      party(3, id(1004), 1),
      party(4, id(1008), 3),
      // document 2 and the rest have no parties
    ],
    employees: [
      { employee_id: id(1), first_name: ' Sam ', last_name: 'Example', auth_user_id: null },
      { employee_id: id(2), first_name: '', last_name: null, auth_user_id: null },
      { employee_id: id(3), first_name: 'Ali', last_name: null, auth_user_id: null },
      { employee_id: id(99), first_name: 'Peter', last_name: 'Staff', auth_user_id: STAFF_ID },
    ],
    private_bookings: [
      { id: id(10), customer_name: 'Ignored', customer_first_name: 'Jo', customer_last_name: 'Bloggs' },
      { id: id(11), customer_name: 'Pat Smith', customer_first_name: null, customer_last_name: '' },
      { id: id(12), customer_name: null, customer_first_name: null, customer_last_name: null },
    ],
    quotes: [{ id: id(20), quote_number: 'Q-0042' }],
    recruitment_applications: [
      { id: id(30), candidate: { first_name: 'Robin', last_name: 'Hood' } },
      { id: id(31), candidate: [{ first_name: 'Max', last_name: 'Power' }] },
      { id: id(32), candidate: null },
    ],
    invoice_vendors: [{ id: id(40), name: 'Barons Pubs' }],
    vendors: [{ id: id(50), name: 'Cake Shop' }],
  })
}

/** Wraps the fake client so every `from()` is recorded. */
function useDb(fake: FakeDb): void {
  db = fake
  reads = []
  mocks.client = {
    ...fake.client,
    from: (table: string) => {
      reads.push(table)
      return fake.client.from(table)
    },
  }
}

/** What the page showed before: each document, then its subject, one at a time. */
async function oldPath(ids: string[]): Promise<Row[]> {
  const rows: Row[] = []
  for (const documentId of ids) {
    const document = await getSigningDocument(documentId)
    if (!document) continue
    const subject = await describeSigningSubject(document)
    rows.push({ document, subjectLabel: subject.label, subjectPath: subject.path })
  }
  return rows
}

function outstandingIdsNewestFirst(): string[] {
  return db
    .rows('signing_documents')
    .filter((row) => row.status === 'sent' || row.status === 'part_signed')
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .map((row) => row.id as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: STAFF_ID, email: 'peter@example.test' } } })
  mocks.permission.mockResolvedValue(true)
  useDb(seed())
})

describe('getSigningOverview', () => {
  it('lists exactly what the one-at-a-time path listed, for every subject type and fallback', async () => {
    const result = await getSigningOverview('outstanding')
    expect(result.error).toBeUndefined()
    const expected = await oldPath(outstandingIdsNewestFirst())

    expect(result.data?.truncated).toBe(false)
    expect(result.data?.rows).toEqual(expected)
    expect(result.data?.rows).toHaveLength(14)

    const labels = Object.fromEntries((result.data?.rows ?? []).map((row) => [row.document.title, [row.subjectLabel, row.subjectPath]]))
    expect(labels).toEqual({
      'Document 1': ['Sam Example', `/employees/${id(1)}`],
      'Document 2': ['an employee', `/employees/${id(2)}`],
      'Document 3': ['Sam Example', `/employees/${id(1)}`],
      'Document 4': ["Jo Bloggs's booking", `/private-bookings/${id(10)}`],
      'Document 5': ["Pat Smith's booking", `/private-bookings/${id(11)}`],
      'Document 6': ["a customer's booking", `/private-bookings/${id(12)}`],
      'Document 7': ['quote Q-0042', `/quotes/${id(20)}`],
      'Document 8': ['Robin Hood', `/recruitment?application=${id(30)}`],
      'Document 9': ['Max Power', `/recruitment?application=${id(31)}`],
      'Document 10': ['a candidate', `/recruitment?application=${id(32)}`],
      'Document 11': ['Barons Pubs', '/oj-projects/clients'],
      'Document 12': ['Cake Shop', '/private-bookings/settings'],
      'Document 13': ['a record that no longer exists', '/quotes'],
      'Document 14': ['Ali', `/employees/${id(3)}`],
    })

    const first = result.data?.rows.find((row) => row.document.id === id(1001))
    expect(first?.document.parties.map((p) => p.id)).toEqual([id(5002), id(5001)])
    expect(first?.document.parties.some((p) => 'hashed_token' in p)).toBe(false)
    expect(result.data?.rows.find((row) => row.document.id === id(1002))?.document.parties).toEqual([])
  })

  it('makes a bounded number of reads and never reads the caller\'s employee record', async () => {
    await getSigningOverview('outstanding')
    // Documents, signers, and one read per subject type: six types here.
    expect(reads).toHaveLength(8)
    expect(reads.filter((table) => table === 'signing_documents')).toHaveLength(1)
    expect(reads.filter((table) => table === 'signing_parties')).toHaveLength(1)
    expect(reads.filter((table) => table === 'employees')).toHaveLength(1)
    // Each distinct view permission once, for this user, rather than once per kind.
    const pairs = mocks.permission.mock.calls.map(([module, action]) => `${module}:${action}`)
    expect(new Set(pairs).size).toBe(pairs.length)
    expect(pairs.sort()).toEqual(
      [
        'employees:view',
        'employees:view_documents',
        'invoices:view',
        'oj_projects:view',
        'private_bookings:view',
        'recruitment:view',
        'training:view',
      ].sort()
    )
    expect(mocks.permission.mock.calls.every((call) => call[2] === STAFF_ID)).toBe(true)
  })

  it('hides exactly the kinds behind a permission the person lacks', async () => {
    mocks.permission.mockImplementation(async (module: string) => module !== 'private_bookings')
    const result = await getSigningOverview('outstanding')
    const types = new Set(result.data?.rows.map((row) => row.document.subject_type))
    // Booking contracts, waivers, deduction agreements and supplier confirmations all need private_bookings view.
    expect(types.has('private_booking')).toBe(false)
    expect(types.has('vendor')).toBe(false)
    expect(result.data?.rows).toHaveLength(10)
  })

  it('refuses a signed-out caller and one who may see no kind', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } })
    expect(await getSigningOverview('outstanding')).toEqual({ error: 'Unauthorized' })

    mocks.permission.mockResolvedValue(false)
    expect(await getSigningOverview('outstanding')).toEqual({ error: 'Insufficient permissions' })
    expect(reads).not.toContain('signing_documents')
  })

  it('shows the newest hundred and says when there are more', async () => {
    const many = Array.from({ length: 101 }, (_, n) => documentRow(100 + n, 'quote_acceptance', 'quote', id(20)))
    useDb(createFakeDb({ signing_documents: many, signing_parties: [], quotes: [{ id: id(20), quote_number: 'Q-1' }] }))
    const result = await getSigningOverview('outstanding')
    expect(result.data?.truncated).toBe(true)
    expect(result.data?.rows).toHaveLength(100)
    expect(result.data?.rows[0].document.id).toBe(id(1200))
    expect(reads).toHaveLength(3)
  })
})

describe('describeSigningSubjects', () => {
  it('falls back, as the single lookup does, when a subject read fails', async () => {
    db.failNext({ table: 'quotes', operation: 'select', message: 'boom' })
    const [described] = await describeSigningSubjects([{ subject_type: 'quote', subject_id: id(20) }])
    expect(described).toEqual({ label: 'a record that no longer exists', path: '/quotes' })

    db.failNext({ table: 'quotes', operation: 'select', message: 'boom' })
    expect(await describeSigningSubject({ subject_type: 'quote', subject_id: id(20) })).toEqual(described)
  })

  it('returns nothing and reads nothing for no documents', async () => {
    expect(await describeSigningSubjects([])).toEqual([])
    expect(reads).toEqual([])
  })
})
