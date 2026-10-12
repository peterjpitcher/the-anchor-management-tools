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
}))

vi.mock('@/lib/env', () => ({ getAppUrl: () => 'https://management.example.test' }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/email/emailService', () => ({ sendEmail: mocks.sendEmail }))
vi.mock('@/lib/cron/alerting', () => ({ reportCronFailure: mocks.alert }))
vi.mock('@/lib/signing/subjects', () => ({ describeSigningSubject: async () => ({ label: 'Sam Example', path: '/employees/emp-1' }) }))
vi.mock('@/lib/signing/service', () => ({ resendSigningLink: mocks.resend, finaliseSigningDocument: mocks.finalise }))

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
