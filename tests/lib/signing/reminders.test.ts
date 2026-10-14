// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  resend: vi.fn(),
  finalise: vi.fn(),
  sendEmail: vi.fn(),
  alert: vi.fn(),
  closure: vi.fn(),
}))

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))
vi.mock('@/lib/signing/subjects', () => ({ describeSigningSubject: async () => ({ label: 'Sam Example', path: '/employees/emp-1' }) }))
vi.mock('@/lib/signing/service', () => ({ resendSigningLink: mocks.resend, finaliseSigningDocument: mocks.finalise }))
// Whether the record behind a document still needs signing. Tested on its own in subject-state.test.ts.
vi.mock('@/lib/signing/subject-state', () => ({ findSubjectClosure: mocks.closure }))

import { GET } from '@/app/api/cron/signing-reminders/route'
import { remindersDue, runSigningReminders } from '@/lib/signing/reminders'

const NOW = new Date('2026-10-20T09:30:00.000Z')
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString()
const inDays = (days: number): string => new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000).toISOString()

let db: FakeDb

function seed(documents: Record<string, unknown>[], parties: Record<string, unknown>[] = []): void {
  db = createFakeDb({ signing_documents: documents, signing_parties: parties })
  mocks.client = {
    ...db.client,
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sender@example.test' } } }) } },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resend.mockResolvedValue(undefined)
  mocks.finalise.mockResolvedValue(undefined)
  mocks.sendEmail.mockResolvedValue({ success: true })
  mocks.alert.mockResolvedValue(undefined)
  mocks.closure.mockResolvedValue(null)
})

describe('reminder timing', () => {
  it('owes one reminder from day 3 and a second from day 7', () => {
    expect(remindersDue(daysAgo(0), NOW)).toBe(0)
    expect(remindersDue(daysAgo(2.9), NOW)).toBe(0)
    expect(remindersDue(daysAgo(3), NOW)).toBe(1)
    expect(remindersDue(daysAgo(6.9), NOW)).toBe(1)
    expect(remindersDue(daysAgo(7), NOW)).toBe(2)
    expect(remindersDue(daysAgo(29), NOW)).toBe(2)
  })
})

describe('the daily signing run', () => {
  it('reminds only the people who are behind, and never twice in one run', async () => {
    seed(
      [
        { id: 'fresh', status: 'sent', sent_at: daysAgo(1), expires_at: inDays(29), final_pdf_path: null, completion_applied_at: null },
        { id: 'day3', status: 'sent', sent_at: daysAgo(3), expires_at: inDays(27), final_pdf_path: null, completion_applied_at: null },
        { id: 'day8', status: 'part_signed', sent_at: daysAgo(8), expires_at: inDays(22), final_pdf_path: null, completion_applied_at: null },
      ],
      [
        { id: 'p-fresh', document_id: 'fresh', status: 'pending', email: 'a@example.com', reminder_count: 0, role: 'worker' },
        { id: 'p-day3', document_id: 'day3', status: 'pending', email: 'b@example.com', reminder_count: 0, role: 'worker' },
        { id: 'p-day3-done', document_id: 'day3', status: 'pending', email: 'c@example.com', reminder_count: 1, role: 'guardian' },
        // Never reminded and now past both thresholds: one email today, not two.
        { id: 'p-day8', document_id: 'day8', status: 'pending', email: 'd@example.com', reminder_count: 0, role: 'customer' },
        { id: 'p-day8-uptodate', document_id: 'day8', status: 'pending', email: 'e@example.com', reminder_count: 2, role: 'customer' },
        { id: 'p-day8-signed', document_id: 'day8', status: 'signed', email: 'f@example.com', reminder_count: 0, role: 'customer' },
        { id: 'p-day8-noemail', document_id: 'day8', status: 'pending', email: null, reminder_count: 0, role: 'customer' },
      ]
    )

    const run = await runSigningReminders(NOW)
    expect(mocks.resend.mock.calls.map((call) => call[0].partyId).sort()).toEqual(['p-day3', 'p-day8'])
    expect(mocks.resend).toHaveBeenCalledWith({ partyId: 'p-day3', userId: null, isReminder: true })
    expect(run).toMatchObject({ remindersSent: 2, expired: 0, errors: [] })
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('closes a request that has run out of time, records it and tells the sender', async () => {
    seed(
      [{ id: 'late', status: 'sent', title: 'Worker agreement', sent_at: daysAgo(31), expires_at: daysAgo(1), created_by: 'user-1', subject_type: 'employee', subject_id: 'emp-1', final_pdf_path: null, completion_applied_at: null }],
      [{ id: 'p-late', document_id: 'late', status: 'pending', email: 'a@example.com', reminder_count: 0, role: 'worker' }]
    )
    const run = await runSigningReminders(NOW)
    expect(run.expired).toBe(1)
    expect(db.rows('signing_documents')[0].status).toBe('expired')
    expect(db.rows('signing_events')[0]).toMatchObject({ document_id: 'late', event: 'expired' })
    expect(mocks.sendEmail.mock.calls[0][0]).toMatchObject({ to: 'sender@example.test', subject: 'Not signed: Worker agreement (Sam Example)' })
    // An expired request is not chased.
    expect(mocks.resend).not.toHaveBeenCalled()
  })

  it('withdraws a request whose record has moved on, and chases nobody about it', async () => {
    seed(
      [
        { id: 'cancelled', status: 'sent', sent_at: daysAgo(3), expires_at: inDays(27), final_pdf_path: null, completion_applied_at: null },
        { id: 'live', status: 'sent', sent_at: daysAgo(3), expires_at: inDays(27), final_pdf_path: null, completion_applied_at: null },
      ],
      [
        { id: 'p-cancelled', document_id: 'cancelled', status: 'pending', email: 'a@example.com', reminder_count: 0, role: 'customer' },
        { id: 'p-live', document_id: 'live', status: 'pending', email: 'b@example.com', reminder_count: 0, role: 'customer' },
      ]
    )
    mocks.closure.mockImplementation(async (document: { id: string }) => (document.id === 'cancelled' ? 'This booking was cancelled.' : null))

    const run = await runSigningReminders(NOW)
    expect(run).toMatchObject({ withdrawn: 1, remindersSent: 1, expired: 0, errors: [] })
    expect(db.rows('signing_documents').find((row) => row.id === 'cancelled')).toMatchObject({ status: 'voided', void_reason: 'This booking was cancelled.' })
    expect(db.rows('signing_events')).toEqual([
      expect.objectContaining({ document_id: 'cancelled', event: 'voided', meta: { reason: 'This booking was cancelled.', automatic: true } }),
    ])
    expect(mocks.resend.mock.calls.map((call) => call[0].partyId)).toEqual(['p-live'])
  })

  it('does not chase when it cannot tell whether the record still needs signing, and says so', async () => {
    seed(
      [{ id: 'unknown', status: 'sent', sent_at: daysAgo(3), expires_at: inDays(27), final_pdf_path: null, completion_applied_at: null }],
      [{ id: 'p-unknown', document_id: 'unknown', status: 'pending', email: 'a@example.com', reminder_count: 0, role: 'customer' }]
    )
    mocks.closure.mockRejectedValue(new Error('database unavailable'))

    const run = await runSigningReminders(NOW)
    expect(mocks.resend).not.toHaveBeenCalled()
    expect(db.rows('signing_documents')[0].status).toBe('sent')
    expect(run.errors).toEqual([expect.stringContaining('database unavailable')])
    expect(mocks.alert).toHaveBeenCalled()
  })

  it('finishes a signed document whose finishing step did not complete', async () => {
    seed([
      { id: 'no-pdf', status: 'completed', final_pdf_path: null, completion_applied_at: '2026-10-19T10:00:00.000Z', copies_sent_at: null },
      { id: 'no-hook', status: 'completed', final_pdf_path: 'p/signed.pdf', completion_applied_at: null, copies_sent_at: '2026-10-19T10:00:00.000Z' },
      { id: 'no-copies', status: 'completed', final_pdf_path: 'p/signed.pdf', completion_applied_at: '2026-10-19T10:00:00.000Z', copies_sent_at: null },
      { id: 'done', status: 'completed', final_pdf_path: 'p/signed.pdf', completion_applied_at: '2026-10-19T10:00:00.000Z', copies_sent_at: '2026-10-19T10:00:00.000Z' },
    ])
    const run = await runSigningReminders(NOW)
    expect(mocks.finalise.mock.calls.map((call) => call[0]).sort()).toEqual(['no-copies', 'no-hook', 'no-pdf'])
    expect(run.finalised).toBe(3)
  })

  it('carries on past a failure, and reports it rather than coming back quiet', async () => {
    seed(
      [
        { id: 'a', status: 'sent', sent_at: daysAgo(4), expires_at: inDays(26), final_pdf_path: null, completion_applied_at: null },
        { id: 'b', status: 'sent', sent_at: daysAgo(4), expires_at: inDays(26), final_pdf_path: null, completion_applied_at: null },
      ],
      [
        { id: 'p-a', document_id: 'a', status: 'pending', email: 'a@example.com', reminder_count: 0, role: 'worker' },
        { id: 'p-b', document_id: 'b', status: 'pending', email: 'b@example.com', reminder_count: 0, role: 'worker' },
      ]
    )
    mocks.resend.mockRejectedValueOnce(new Error('mailbox unavailable'))
    const run = await runSigningReminders(NOW)
    expect(mocks.resend).toHaveBeenCalledTimes(2)
    expect(run.remindersSent).toBe(1)
    expect(run.errors).toHaveLength(1)
    expect(run.errors[0]).toContain('mailbox unavailable')
    expect(mocks.alert).toHaveBeenCalledWith('signing-reminders', expect.any(Error), expect.objectContaining({ remindersSent: 1 }))
  })
})

describe('repairing the trail of a request that was closed without a line for it', () => {
  // Closing a request is two writes: the status, then the line on the trail. If the second
  // failed, the request is closed but its trail does not say so.

  function seedClosed(documents: Record<string, unknown>[], events: Record<string, unknown>[] = []): void {
    db = createFakeDb({ signing_documents: documents, signing_parties: [], signing_events: events })
    mocks.client = {
      ...db.client,
      auth: { admin: { getUserById: async () => ({ data: { user: { email: 'sender@example.test' } } }) } },
    }
  }

  function trail(documentId: string): Record<string, unknown>[] {
    return db.rows('signing_events').filter((row) => row.document_id === documentId)
  }

  it('adds the missing line for a withdrawn request, dated when it was withdrawn, with the reason', async () => {
    seedClosed([
      { id: 'withdrawn', status: 'voided', void_reason: 'The booking was cancelled', voided_at: daysAgo(2), updated_at: daysAgo(1) },
    ])

    const run = await runSigningReminders(NOW)

    expect(run).toMatchObject({ trailRepaired: 1, errors: [] })
    expect(trail('withdrawn')).toEqual([
      expect.objectContaining({
        document_id: 'withdrawn',
        event: 'voided',
        occurred_at: daysAgo(2),
        meta: { reason: 'The booking was cancelled', repaired: true },
      }),
    ])
    expect(mocks.alert).not.toHaveBeenCalled()
  })

  it('adds the missing line for a request that ran out of time, dated when it was closed', async () => {
    seedClosed([{ id: 'ran-out', status: 'expired', void_reason: null, voided_at: null, updated_at: daysAgo(3) }])

    const run = await runSigningReminders(NOW)

    expect(run.trailRepaired).toBe(1)
    expect(trail('ran-out')).toEqual([
      expect.objectContaining({ document_id: 'ran-out', event: 'expired', occurred_at: daysAgo(3), meta: { repaired: true } }),
    ])
  })

  it('leaves alone a closed request whose trail already has its line', async () => {
    seedClosed(
      [
        { id: 'withdrawn', status: 'voided', void_reason: 'Sent to the wrong person', voided_at: daysAgo(2), updated_at: daysAgo(2) },
        { id: 'ran-out', status: 'expired', void_reason: null, voided_at: null, updated_at: daysAgo(3) },
      ],
      [
        { id: 'e1', document_id: 'withdrawn', event: 'sent' },
        { id: 'e2', document_id: 'withdrawn', event: 'voided', meta: { reason: 'Sent to the wrong person' } },
        { id: 'e3', document_id: 'ran-out', event: 'expired' },
      ]
    )

    const run = await runSigningReminders(NOW)

    expect(run).toMatchObject({ trailRepaired: 0, errors: [] })
    expect(db.rows('signing_events').map((row) => row.id)).toEqual(['e1', 'e2', 'e3'])
  })

  it('goes by the line for how the request was closed, not by any other line on its trail', async () => {
    seedClosed(
      [{ id: 'withdrawn', status: 'voided', void_reason: 'The quote was marked as rejected', voided_at: daysAgo(1), updated_at: daysAgo(1) }],
      [
        { id: 'e1', document_id: 'withdrawn', event: 'sent' },
        { id: 'e2', document_id: 'withdrawn', event: 'opened' },
        { id: 'e3', document_id: 'another-document', event: 'voided' },
      ]
    )

    const run = await runSigningReminders(NOW)

    expect(run.trailRepaired).toBe(1)
    expect(trail('withdrawn').map((row) => row.event)).toEqual(['sent', 'opened', 'voided'])
  })

  it('looks back fourteen days and no further', async () => {
    seedClosed([
      { id: 'a-thirteen-days', status: 'voided', void_reason: 'Recent', voided_at: daysAgo(13), updated_at: daysAgo(13) },
      { id: 'b-fourteen-days', status: 'expired', void_reason: null, voided_at: null, updated_at: daysAgo(14) },
      { id: 'c-fifteen-days', status: 'voided', void_reason: 'Too old', voided_at: daysAgo(15), updated_at: daysAgo(15) },
      { id: 'd-last-year', status: 'expired', void_reason: null, voided_at: null, updated_at: daysAgo(400) },
    ])

    const run = await runSigningReminders(NOW)

    expect(run.trailRepaired).toBe(2)
    expect(db.rows('signing_events').map((row) => row.document_id).sort()).toEqual(['a-thirteen-days', 'b-fourteen-days'])
  })

  it('touches only requests that were withdrawn or ran out of time', async () => {
    seedClosed([
      { id: 'declined', status: 'declined', void_reason: null, voided_at: null, updated_at: daysAgo(1), final_pdf_path: null, completion_applied_at: null },
      { id: 'replaced', status: 'superseded', void_reason: null, voided_at: null, updated_at: daysAgo(1), final_pdf_path: 'p/signed.pdf', completion_applied_at: daysAgo(1), copies_sent_at: daysAgo(1) },
      { id: 'signed', status: 'completed', void_reason: null, voided_at: null, updated_at: daysAgo(1), final_pdf_path: 'p/signed.pdf', completion_applied_at: daysAgo(1), copies_sent_at: daysAgo(1) },
      { id: 'open', status: 'sent', void_reason: null, voided_at: null, updated_at: daysAgo(1), sent_at: daysAgo(1), expires_at: inDays(29), final_pdf_path: null, completion_applied_at: null },
    ])

    const run = await runSigningReminders(NOW)

    expect(run).toMatchObject({ trailRepaired: 0, errors: [] })
    expect(db.rows('signing_events')).toHaveLength(0)
  })

  it('repairs a trail once: the next run finds the line it added', async () => {
    seedClosed([{ id: 'withdrawn', status: 'voided', void_reason: 'The booking was cancelled', voided_at: daysAgo(2), updated_at: daysAgo(2) }])

    expect((await runSigningReminders(NOW)).trailRepaired).toBe(1)
    expect((await runSigningReminders(NOW)).trailRepaired).toBe(0)

    expect(trail('withdrawn')).toHaveLength(1)
  })

  it('carries on past one it cannot repair, and reports it', async () => {
    seedClosed([
      { id: 'a-first', status: 'voided', void_reason: 'One', voided_at: daysAgo(2), updated_at: daysAgo(2) },
      { id: 'b-second', status: 'expired', void_reason: null, voided_at: null, updated_at: daysAgo(2) },
      { id: 'c-third', status: 'voided', void_reason: 'Three', voided_at: daysAgo(2), updated_at: daysAgo(2) },
    ])
    db.failNext({ table: 'signing_events', operation: 'insert', message: 'connection reset', times: 1 })

    const run = await runSigningReminders(NOW)

    expect(run.trailRepaired).toBe(2)
    expect(db.rows('signing_events').map((row) => row.document_id)).toEqual(['b-second', 'c-third'])
    expect(run.errors).toEqual([expect.stringContaining('repairing the trail of a-first: connection reset')])
    expect(mocks.alert).toHaveBeenCalledWith('signing-reminders', expect.any(Error), expect.objectContaining({ trailRepaired: 2 }))

    // The one that was missed is picked up the next morning.
    const next = await runSigningReminders(NOW)
    expect(next).toMatchObject({ trailRepaired: 1, errors: [] })
    expect(trail('a-first')).toHaveLength(1)
  })

  it('reports it, and adds nothing, when the trails cannot be read', async () => {
    seedClosed([{ id: 'withdrawn', status: 'voided', void_reason: 'One', voided_at: daysAgo(2), updated_at: daysAgo(2) }])
    db.failNext({ table: 'signing_events', operation: 'select', message: 'connection reset', times: 1 })

    const run = await runSigningReminders(NOW)

    // Not knowing whether the line is there is not a reason to add a second one.
    expect(run.trailRepaired).toBe(0)
    expect(db.rows('signing_events')).toHaveLength(0)
    expect(run.errors).toEqual([expect.stringContaining('connection reset')])
    expect(mocks.alert).toHaveBeenCalled()
  })

  it('works through more closed requests than it reads the trails of at once', async () => {
    const documents = Array.from({ length: 205 }, (_, index) => ({
      id: `doc-${String(index).padStart(3, '0')}`,
      status: index % 2 === 0 ? 'voided' : 'expired',
      void_reason: index % 2 === 0 ? 'The booking was cancelled' : null,
      voided_at: index % 2 === 0 ? daysAgo(2) : null,
      updated_at: daysAgo(2),
    }))
    // Every third one already has its line.
    const events = documents
      .filter((_, index) => index % 3 === 0)
      .map((document, index) => ({ id: `existing-${index}`, document_id: document.id, event: document.status }))
    seedClosed(documents, events)

    const run = await runSigningReminders(NOW)

    const missing = documents.length - events.length
    expect(run).toMatchObject({ trailRepaired: missing, errors: [] })
    // One line each, and no document has two.
    const lines = db.rows('signing_events')
    expect(lines).toHaveLength(documents.length)
    expect(new Set(lines.map((row) => row.document_id)).size).toBe(documents.length)
    for (const document of documents) {
      expect(lines.find((row) => row.document_id === document.id)?.event, document.id).toBe(document.status)
    }
  })

  it('repairs, in the same run, a request it withdrew a moment ago whose trail line could not be written', async () => {
    // The fake database stamps every update at midday on 1 October 2026, so this run is dated a
    // few days after that for the withdrawal to count as recent.
    const now = new Date('2026-10-05T09:30:00.000Z')
    const sentAt = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
    const expiresAt = new Date(now.getTime() + 29 * 24 * 60 * 60 * 1000).toISOString()
    seedClosed([{ id: 'cancelled', status: 'sent', sent_at: sentAt, expires_at: expiresAt, final_pdf_path: null, completion_applied_at: null }])
    mocks.closure.mockResolvedValue('The booking was cancelled')
    db.failNext({ table: 'signing_events', operation: 'insert', message: 'connection reset', times: 1 })

    const run = await runSigningReminders(now)

    expect(db.rows('signing_documents')[0]).toMatchObject({ status: 'voided', void_reason: 'The booking was cancelled' })
    expect(run.trailRepaired).toBe(1)
    expect(trail('cancelled')).toEqual([
      expect.objectContaining({ event: 'voided', occurred_at: now.toISOString(), meta: { reason: 'The booking was cancelled', repaired: true } }),
    ])
    // The first failure is still reported.
    expect(run.errors).toEqual([expect.stringContaining('connection reset')])
  })

  it('counts the repairs in what the daily job reports back', async () => {
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'test-secret'
    try {
      // The route runs at the real time, so these are dated from now.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      seedClosed([{ id: 'withdrawn', status: 'voided', void_reason: 'The booking was cancelled', voided_at: yesterday, updated_at: yesterday }])

      const response = await GET(
        new NextRequest('https://management.example.test/api/cron/signing-reminders', { headers: { authorization: 'Bearer test-secret' } })
      )

      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ success: true, trailRepaired: 1, remindersSent: 0, withdrawn: 0, expired: 0, finalised: 0 })
    } finally {
      process.env.CRON_SECRET = previous
    }
  })
})

describe('GET /api/cron/signing-reminders', () => {
  it('refuses a caller without the cron secret', async () => {
    const previous = process.env.CRON_SECRET
    process.env.CRON_SECRET = 'test-secret'
    try {
      seed([])
      const denied = await GET(new NextRequest('https://management.example.test/api/cron/signing-reminders'))
      expect(denied.status).toBe(401)
      const allowed = await GET(
        new NextRequest('https://management.example.test/api/cron/signing-reminders', { headers: { authorization: 'Bearer test-secret' } })
      )
      expect(allowed.status).toBe(200)
      expect(await allowed.json()).toMatchObject({ success: true, remindersSent: 0, expired: 0, finalised: 0 })
    } finally {
      process.env.CRON_SECRET = previous
    }
  })
})
