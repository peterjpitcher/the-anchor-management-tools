import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeDb, type FakeDb } from '../helpers/fakeSupabaseDb'

/**
 * What happens to a job applicant's details 12 months after they applied.
 *
 * OWNER DECISION (site review of 7 October 2026, P07): for everyone not taken
 * on, keep a short record for good (name, role, date, outcome and reason) and
 * delete the CV and contact details 12 months after they applied. That covers
 * applications never decided and the talent pool, not only the rejected, and
 * the answers, AI output and calendar entries go at the same time.
 *
 * The job this replaced covered only rejected, withdrawn and duplicate
 * applications, deleted the name, and carried on when a CV file could not be
 * removed.
 *
 * Every case runs the real service against an in-memory database. Nothing here
 * touches Supabase, storage or a calendar.
 */

const deleteCalendarEvent = vi.hoisted(() => vi.fn())

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }))
vi.mock('@/lib/recruitment/calendar', () => ({
  deleteRecruitmentAppointmentCalendarEvent: deleteCalendarEvent,
}))

import {
  RETENTION_MESSAGE_PLACEHOLDER,
  isRecruitmentRetentionApplyEnabled,
  recruitmentRetentionCutoff,
  recruitmentRetentionMonths,
  runRecruitmentRetentionCleanup,
} from '@/services/recruitment-retention'

// Thursday 8 October 2026, midday in London (BST). Twelve months back is the
// start of 8 October 2025 in London, which is 23:00 on the 7th in UTC.
const NOW = new Date('2026-10-08T11:00:00.000Z')
const CUTOFF = '2025-10-07T23:00:00.000Z'

const JOB = 'job-bar-staff'

type Row = Record<string, unknown>

function candidate(id: string, overrides: Row = {}): Row {
  return {
    id,
    created_at: '2025-03-01T10:00:00+00:00',
    anonymised_at: null,
    converted_employee_id: null,
    first_name: `First-${id}`,
    last_name: `Last-${id}`,
    email: `${id}@example.com`,
    phone: '07700 900123',
    phone_e164: '+447700900123',
    location: 'Staines',
    cv_file_path: `cvs/${id}.pdf`,
    cv_file_name: `${id}.pdf`,
    cv_mime_type: 'application/pdf',
    cv_file_size_bytes: 1234,
    cv_text: `CV text for ${id}, born 1990, lives at 1 High Street`,
    cv_sha256: `sha-${id}`,
    cv_summary: 'Five years behind a bar',
    extracted_data: { phone: '07700 900123' },
    provided_details: 'Typed in by hand',
    notes: 'Seemed keen on the phone',
    sms_consent: true,
    sms_consent_at: '2025-03-01T10:00:00+00:00',
    future_recruitment_consent: false,
    future_recruitment_consent_at: null,
    ...overrides,
  }
}

function application(id: string, candidateId: string, overrides: Row = {}): Row {
  return {
    id,
    candidate_id: candidateId,
    job_posting_id: JOB,
    status: 'rejected',
    created_at: '2025-03-01T10:05:00+00:00',
    rejected_at: '2025-03-10T09:00:00+00:00',
    rejection_reason: 'No weekend availability',
    source: 'website',
    cover_note: 'I would love to work at The Anchor',
    relevant_experience_answer: 'Two years at another pub',
    travel_answer: 'I drive',
    start_availability: 'Straight away',
    availability: { raw: 'weekdays' },
    ai_score: 62,
    ai_recommendation: 'review',
    ai_rationale: 'Decent experience, limited hours',
    ai_strengths: ['bar experience'],
    ai_concerns: ['availability'],
    ai_flags: [],
    ai_model: 'gpt-test',
    ai_scored_at: '2025-03-01T10:06:00+00:00',
    ai_scored_against_version: 1,
    booking_token_hash: null,
    booking_token_type: null,
    booking_token_expires_at: null,
    ...overrides,
  }
}

function fullRecord(id: string, status: string, appliedAt: string, candidateOverrides: Row = {}) {
  return {
    recruitment_candidates: [candidate(id, { created_at: appliedAt, ...candidateOverrides })],
    recruitment_applications: [application(`app-${id}`, id, { status, created_at: appliedAt })],
    recruitment_ai_runs: [
      {
        id: `run-${id}`,
        candidate_id: id,
        application_id: `app-${id}`,
        raw_response: { text: `${id}@example.com 07700 900123` },
        structured_output: { name: `First-${id}` },
        error_message: null,
        cost: 0.01,
        model: 'gpt-test',
      },
    ],
    recruitment_candidate_notes: [
      { id: `note-${id}`, candidate_id: id, application_id: `app-${id}`, kind: 'note', content: 'Chatty, lives near the green' },
      { id: `reason-${id}`, candidate_id: id, application_id: `app-${id}`, kind: 'reject', content: 'No weekend availability' },
    ],
    recruitment_interview_scorecards: [
      {
        id: `card-${id}`,
        candidate_id: id,
        application_id: `app-${id}`,
        comments: 'Nervous but capable',
        criteria: [{ key: 'attitude', rating: 4 }],
        overall_rating: 4,
        recommendation: 'no',
      },
    ],
    recruitment_communications: [
      {
        id: `msg-${id}`,
        candidate_id: id,
        application_id: `app-${id}`,
        channel: 'email',
        type: 'rejection',
        final_body: `Dear First-${id}, thank you for applying`,
        subject: 'Your application to The Anchor',
        sent_at: '2025-03-10T09:05:00+00:00',
        metadata: { role_title: 'Bar staff' },
      },
    ],
    recruitment_candidate_appointments: [
      {
        id: `appt-${id}`,
        candidate_id: id,
        application_id: `app-${id}`,
        status: 'completed',
        scheduled_start: '2025-03-05T14:00:00+00:00',
        calendar_event_id: `gcal-${id}`,
        booking_token_hash: `token-${id}`,
        token_expires_at: '2025-03-05T14:00:00+00:00',
      },
    ],
    recruitment_application_status_events: [
      { id: `event-${id}`, application_id: `app-${id}`, from_status: 'new', to_status: status, note: `Decision: ${status}` },
    ],
  }
}

function merge(...parts: Array<Record<string, Row[]>>): Record<string, Row[]> {
  const merged: Record<string, Row[]> = {}
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) {
      merged[table] = [...(merged[table] ?? []), ...rows]
    }
  }
  return merged
}

type Storage = {
  removed: string[]
  failFor: Set<string>
  throwFor: Set<string>
}

function clientWith(db: FakeDb, storage: Storage) {
  return {
    ...db.client,
    storage: {
      from: (_bucket: string) => ({
        remove: async (paths: string[]) => {
          for (const path of paths) {
            if (storage.throwFor.has(path)) throw new Error('storage unreachable')
            if (storage.failFor.has(path)) return { data: null, error: { message: 'storage said no' } }
            storage.removed.push(path)
          }
          return { data: [], error: null }
        },
      }),
    },
  } as never
}

function setup(seed: Record<string, Row[]>) {
  const db = createFakeDb({
    recruitment_candidates: [],
    recruitment_applications: [],
    recruitment_ai_runs: [],
    recruitment_candidate_notes: [],
    recruitment_interview_scorecards: [],
    recruitment_communications: [],
    recruitment_candidate_appointments: [],
    recruitment_application_status_events: [],
    ...seed,
  })
  const storage: Storage = { removed: [], failFor: new Set(), throwFor: new Set() }
  // As the real helper does: remove the entry, then forget its id on the appointment.
  deleteCalendarEvent.mockImplementation(async (appointmentId: string) => {
    const appointment = db.rows('recruitment_candidate_appointments').find((row) => row.id === appointmentId)
    if (appointment) appointment.calendar_event_id = null
    return { deleted: true }
  })
  const run = (options: { dryRun?: boolean; limit?: number } = {}) =>
    runRecruitmentRetentionCleanup({ now: NOW, ...options }, clientWith(db, storage))
  const row = (table: string, id: string) => db.rows(table).find((candidateRow) => candidateRow.id === id) as Row
  return { db, storage, run, row }
}

function snapshot(db: FakeDb): string {
  return JSON.stringify(
    [
      'recruitment_candidates',
      'recruitment_applications',
      'recruitment_ai_runs',
      'recruitment_candidate_notes',
      'recruitment_interview_scorecards',
      'recruitment_communications',
      'recruitment_candidate_appointments',
      'recruitment_application_status_events',
    ].map((table) => db.rows(table))
  )
}

/** One of everybody the decision has something to say about. */
function everybody() {
  return merge(
    fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'),
    fullRecord('withdrawn', 'withdrawn', '2025-04-01T10:00:00+00:00'),
    fullRecord('never-decided', 'new', '2025-01-10T10:00:00+00:00'),
    fullRecord('interviewed', 'interviewed', '2025-02-10T10:00:00+00:00'),
    fullRecord('on-hold', 'on_hold', '2025-02-20T10:00:00+00:00'),
    fullRecord('talent-pool', 'talent_pool', '2024-12-01T10:00:00+00:00', {
      future_recruitment_consent: true,
      future_recruitment_consent_at: '2024-12-01T10:00:00+00:00',
    }),
    // Left alone.
    fullRecord('hired', 'hired', '2025-01-01T10:00:00+00:00'),
    fullRecord('now-staff', 'offered', '2025-01-02T10:00:00+00:00', { converted_employee_id: 'employee-9' }),
    fullRecord('applied-last-month', 'new', '2026-09-08T10:00:00+00:00'),
    // A CV uploaded by hand that never became an application.
    { recruitment_candidates: [candidate('cv-only', { created_at: '2025-02-01T10:00:00+00:00' })] }
  )
}

const DUE_IDS = ['rejected', 'withdrawn', 'never-decided', 'interviewed', 'on-hold', 'talent-pool', 'cv-only']
const LEFT_ALONE_IDS = ['hired', 'now-staff', 'applied-last-month']

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.RECRUITMENT_RETENTION_MONTHS
  delete process.env.RECRUITMENT_RETENTION_APPLY
})

afterEach(() => {
  delete process.env.RECRUITMENT_RETENTION_MONTHS
  delete process.env.RECRUITMENT_RETENTION_APPLY
})

describe('dry run', () => {
  it('reports what would be removed, by category', async () => {
    const { run } = setup(everybody())
    const result = await run({ dryRun: true })

    expect(result.mode).toBe('dry_run')
    expect(result.retentionMonths).toBe(12)
    expect(result.cutoff).toBe(CUTOFF)
    expect(result.due).toEqual({
      candidates: 7,
      byCategory: { decided: 2, undecided: 3, talent_pool: 1, no_application: 1 },
      cvFiles: 7,
      contactDetails: 7,
      cvContent: 7,
      candidateNotesField: 7,
      applicationAnswers: 6,
      applicationAiOutput: 6,
      aiRuns: 6,
      notes: 6,
      scorecards: 6,
      messages: 6,
      calendarEntries: 6,
    })
    expect(result.skipped).toEqual({ hired: 2, recent_application: 0, upcoming_appointment: 0 })
    expect(result.remaining).toBe(7)
  })

  it('removes nothing: no write, no file, no calendar call, every row as it was', async () => {
    const { db, storage, run } = setup(everybody())
    const before = snapshot(db)

    const result = await run({ dryRun: true })

    expect(db.writes).toEqual([])
    expect(storage.removed).toEqual([])
    expect(deleteCalendarEvent).not.toHaveBeenCalled()
    expect(snapshot(db)).toBe(before)
    expect(result.cleared).toBe(0)
    expect(result.cvFilesRemoved).toBe(0)
    expect(result.calendarEntriesRemoved).toBe(0)
    expect(result.failed).toEqual([])
  })

  it('gives the same figures however many times it is run', async () => {
    const { run } = setup(everybody())

    expect(await run({ dryRun: true })).toEqual(await run({ dryRun: true }))
  })

  it('predicts exactly what a real run then clears', async () => {
    const { run } = setup(everybody())
    const predicted = await run({ dryRun: true })
    const applied = await run()

    expect(applied.due).toEqual(predicted.due)
    expect(applied.cleared).toBe(predicted.due.candidates)
    expect(applied.cvFilesRemoved).toBe(predicted.due.cvFiles)
    expect(applied.calendarEntriesRemoved).toBe(predicted.due.calendarEntries)
  })

  it('carries no name, email, phone or CV text in what it reports', async () => {
    const { run } = setup(everybody())
    const report = JSON.stringify(await run({ dryRun: true }))

    for (const personal of ['First-', 'Last-', '@example.com', '07700', 'High Street', 'Staines']) {
      expect(report).not.toContain(personal)
    }
  })

  it('reports nobody due on an empty database', async () => {
    const { run } = setup({})
    const result = await run({ dryRun: true })

    expect(result.due.candidates).toBe(0)
    expect(result.remaining).toBe(0)
  })
})

describe('a real run: what goes', () => {
  it.each(DUE_IDS)('clears the contact details and CV of "%s"', async (id) => {
    const { run, row } = setup(everybody())
    await run()

    const cleared = row('recruitment_candidates', id)
    for (const field of [
      'email', 'phone', 'phone_e164', 'location', 'cv_file_path', 'cv_file_name', 'cv_mime_type',
      'cv_file_size_bytes', 'cv_text', 'cv_sha256', 'cv_summary', 'extracted_data', 'provided_details', 'notes',
      'sms_consent_at', 'future_recruitment_consent_at',
    ]) {
      expect(cleared[field], field).toBeNull()
    }
    expect(cleared.sms_consent).toBe(false)
    expect(cleared.future_recruitment_consent).toBe(false)
    expect(cleared.anonymised_at).toBe(NOW.toISOString())
  })

  it('deletes each CV file from storage', async () => {
    const { storage, run } = setup(everybody())
    const result = await run()

    expect([...storage.removed].sort()).toEqual(DUE_IDS.map((id) => `cvs/${id}.pdf`).sort())
    expect(result.cvFilesRemoved).toBe(7)
  })

  it('clears the answers, the cover note and every piece of AI output on the application', async () => {
    const { run, row } = setup(everybody())
    await run()

    const cleared = row('recruitment_applications', 'app-never-decided')
    for (const field of [
      'cover_note', 'relevant_experience_answer', 'travel_answer', 'start_availability', 'availability',
      'ai_score', 'ai_recommendation', 'ai_rationale', 'ai_strengths', 'ai_concerns', 'ai_flags',
      'ai_model', 'ai_scored_at', 'ai_scored_against_version', 'booking_token_hash',
    ]) {
      expect(cleared[field], field).toBeNull()
    }
  })

  it('clears what was sent to and came back from the AI, and keeps the row for its cost', async () => {
    const { run, row } = setup(everybody())
    await run()

    const cleared = row('recruitment_ai_runs', 'run-talent-pool')
    expect(cleared.raw_response).toBeNull()
    expect(cleared.structured_output).toBeNull()
    expect(cleared.cost).toBe(0.01)
  })

  it('finds an AI run that points only at the application', async () => {
    const seed = fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00')
    seed.recruitment_ai_runs[0].candidate_id = null as never
    const { run, row } = setup(seed)
    const result = await run()

    expect(result.due.aiRuns).toBe(1)
    expect(row('recruitment_ai_runs', 'run-rejected').raw_response).toBeNull()
  })

  it('deletes free-text notes about the person', async () => {
    const { db, run } = setup(everybody())
    await run()

    expect(db.rows('recruitment_candidate_notes').some((note) => note.id === 'note-rejected')).toBe(false)
  })

  it('clears scorecard comments and per-question scores', async () => {
    const { run, row } = setup(everybody())
    await run()

    const card = row('recruitment_interview_scorecards', 'card-interviewed')
    expect(card.comments).toBeNull()
    expect(card.criteria).toEqual([])
  })

  it('blanks the text and subject of every message sent', async () => {
    const { run, row } = setup(everybody())
    await run()

    const message = row('recruitment_communications', 'msg-withdrawn')
    expect(message.final_body).toBe(RETENTION_MESSAGE_PLACEHOLDER)
    expect(message.subject).toBeNull()
    expect(message.sent_at).toBe('2025-03-10T09:05:00+00:00')
  })

  it('takes interview and trial entries off the calendar and drops booking link tokens', async () => {
    const { run, row } = setup(everybody())
    const result = await run()

    expect(deleteCalendarEvent).toHaveBeenCalledTimes(6)
    expect(deleteCalendarEvent.mock.calls.map((call) => call[0]).sort()).toEqual(
      ['rejected', 'withdrawn', 'never-decided', 'interviewed', 'on-hold', 'talent-pool'].map((id) => `appt-${id}`).sort()
    )
    expect(result.calendarEntriesRemoved).toBe(6)
    expect(row('recruitment_candidate_appointments', 'appt-rejected').booking_token_hash).toBeNull()
    expect(row('recruitment_candidate_appointments', 'appt-rejected').scheduled_start).toBe('2025-03-05T14:00:00+00:00')
  })

  it('leaves nothing personal anywhere for the people it cleared', async () => {
    const { db, run } = setup(merge(
      fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'),
      fullRecord('talent-pool', 'talent_pool', '2024-12-01T10:00:00+00:00')
    ))
    await run()

    const everything = snapshot(db)
    for (const gone of ['@example.com', '07700', '+447700900123', 'High Street', 'Staines', 'Chatty', 'Nervous', 'I would love', 'thank you for applying', 'cvs/']) {
      expect(everything, gone).not.toContain(gone)
    }
  })
})

describe('a real run: the short record that is kept for good', () => {
  it.each(DUE_IDS)('keeps the name of "%s"', async (id) => {
    const { run, row } = setup(everybody())
    await run()

    expect(row('recruitment_candidates', id).first_name).toBe(`First-${id}`)
    expect(row('recruitment_candidates', id).last_name).toBe(`Last-${id}`)
  })

  it('keeps the role, the date, the outcome and the reason', async () => {
    const { db, run, row } = setup(everybody())
    await run()

    const kept = row('recruitment_applications', 'app-rejected')
    expect(kept.job_posting_id).toBe(JOB)
    expect(kept.created_at).toBe('2025-03-01T10:00:00+00:00')
    expect(kept.status).toBe('rejected')
    expect(kept.rejected_at).toBe('2025-03-10T09:00:00+00:00')
    expect(kept.rejection_reason).toBe('No weekend availability')
    expect(kept.source).toBe('website')

    // The note written when the decision was recorded is the reason. It stays.
    expect(db.rows('recruitment_candidate_notes').find((note) => note.id === 'reason-rejected')?.content).toBe(
      'No weekend availability'
    )
    // So does the history of what happened to the application.
    expect(db.rows('recruitment_application_status_events').find((event) => event.id === 'event-rejected')).toBeTruthy()
  })

  it('keeps the overall rating and recommendation on a scorecard', async () => {
    const { run, row } = setup(everybody())
    await run()

    expect(row('recruitment_interview_scorecards', 'card-interviewed').overall_rating).toBe(4)
    expect(row('recruitment_interview_scorecards', 'card-interviewed').recommendation).toBe('no')
  })

  it('keeps the outcome of an application that was never decided as it was left', async () => {
    const { run, row } = setup(everybody())
    await run()

    expect(row('recruitment_applications', 'app-never-decided').status).toBe('new')
    expect(row('recruitment_applications', 'app-talent-pool').status).toBe('talent_pool')
  })
})

describe('who is left alone', () => {
  it.each(LEFT_ALONE_IDS)('does not touch "%s" in any table', async (id) => {
    const { db, run } = setup(everybody())
    const tables = [
      'recruitment_candidates', 'recruitment_applications', 'recruitment_ai_runs', 'recruitment_candidate_notes',
      'recruitment_interview_scorecards', 'recruitment_communications', 'recruitment_candidate_appointments',
    ]
    const own = () =>
      JSON.stringify(tables.map((table) => db.rows(table).filter((row) => row.id === id || row.candidate_id === id)))
    const before = own()

    await run()

    expect(own()).toBe(before)
  })

  it('keeps the CV files of the people it leaves alone', async () => {
    const { storage, run } = setup(everybody())
    await run()

    for (const id of LEFT_ALONE_IDS) {
      expect(storage.removed).not.toContain(`cvs/${id}.pdf`)
    }
  })

  it('does not wipe a person with one old application and one live one', async () => {
    const seed = fullRecord('reapplied', 'rejected', '2024-06-01T10:00:00+00:00')
    seed.recruitment_applications.push(
      application('app-reapplied-new', 'reapplied', { status: 'shortlisted', created_at: '2026-08-01T10:00:00+00:00' })
    )
    const { db, storage, run } = setup(seed)
    const before = snapshot(db)

    const result = await run()

    expect(result.skipped.recent_application).toBe(1)
    expect(result.due.candidates).toBe(0)
    expect(snapshot(db)).toBe(before)
    expect(storage.removed).toEqual([])
  })

  it('clears that person once the newer application is 12 months old too', async () => {
    const seed = fullRecord('reapplied', 'rejected', '2024-06-01T10:00:00+00:00')
    seed.recruitment_applications.push(
      application('app-reapplied-new', 'reapplied', { status: 'rejected', created_at: '2025-08-01T10:00:00+00:00' })
    )
    const { run, row } = setup(seed)

    const result = await run()

    expect(result.cleared).toBe(1)
    expect(row('recruitment_candidates', 'reapplied').email).toBeNull()
    expect(row('recruitment_applications', 'app-reapplied').cover_note).toBeNull()
    expect(row('recruitment_applications', 'app-reapplied-new').cover_note).toBeNull()
  })

  it('does not wipe a person hired on a later application, however old the first', async () => {
    const seed = fullRecord('hired-second-time', 'rejected', '2024-01-01T10:00:00+00:00')
    seed.recruitment_applications.push(
      application('app-hired', 'hired-second-time', { status: 'hired', created_at: '2025-01-01T10:00:00+00:00' })
    )
    const { db, run } = setup(seed)
    const before = snapshot(db)

    const result = await run()

    expect(result.skipped.hired).toBe(1)
    expect(snapshot(db)).toBe(before)
  })

  it('does not wipe a person with an interview still to come', async () => {
    const seed = fullRecord('interview-booked', 'interview_scheduled', '2025-06-01T10:00:00+00:00')
    seed.recruitment_candidate_appointments[0] = {
      ...seed.recruitment_candidate_appointments[0],
      status: 'scheduled',
      scheduled_start: '2026-10-12T14:00:00+00:00',
    }
    const { db, run } = setup(seed)
    const before = snapshot(db)

    const result = await run()

    expect(result.skipped.upcoming_appointment).toBe(1)
    expect(snapshot(db)).toBe(before)
    expect(deleteCalendarEvent).not.toHaveBeenCalled()
  })

  it('does clear a person whose scheduled interview date has passed', async () => {
    const seed = fullRecord('never-showed', 'interview_scheduled', '2025-06-01T10:00:00+00:00')
    seed.recruitment_candidate_appointments[0] = {
      ...seed.recruitment_candidate_appointments[0],
      status: 'scheduled',
      scheduled_start: '2025-06-10T14:00:00+00:00',
    }
    const { run } = setup(seed)

    expect((await run()).cleared).toBe(1)
  })
})

describe('the 12 month line', () => {
  it('clears someone who applied at one second to midnight, London time, 12 months and a day ago', async () => {
    // 23:59:59 on 7 October 2025 in London is 22:59:59 UTC.
    const { run } = setup(fullRecord('just-over', 'rejected', '2025-10-07T22:59:59+00:00'))

    expect((await run()).cleared).toBe(1)
  })

  it('does not clear someone who applied at midnight, London time, exactly 12 months ago', async () => {
    // 00:00:00 on 8 October 2025 in London is 23:00:00 UTC on the 7th.
    const { db, run } = setup(fullRecord('exactly', 'rejected', '2025-10-07T23:00:00+00:00'))
    const before = snapshot(db)

    const result = await run()

    expect(result.due.candidates).toBe(0)
    expect(snapshot(db)).toBe(before)
  })

  it('reads the database time format and the JavaScript one as the same instant', async () => {
    const { run } = setup(fullRecord('exactly', 'rejected', '2025-10-07T23:00:00.000000+00:00'))

    expect((await run({ dryRun: true })).due.candidates).toBe(0)
  })

  it('treats a date it cannot read as too recent, and removes nothing', async () => {
    const seed = fullRecord('bad-date', 'rejected', '2025-01-01T10:00:00+00:00')
    seed.recruitment_applications[0].created_at = 'not a date'
    const { db, run } = setup(seed)
    const before = snapshot(db)

    await run()

    expect(snapshot(db)).toBe(before)
  })

  it.each([
    // now (UTC), months, expected cut-off (UTC)
    ['a summer lunchtime', '2026-10-08T11:00:00.000Z', 12, '2025-10-07T23:00:00.000Z'],
    ['half past midnight in London, still the day before in UTC', '2026-10-08T23:30:00.000Z', 12, '2025-10-08T23:00:00.000Z'],
    ['a winter lunchtime', '2026-01-15T12:00:00.000Z', 12, '2025-01-15T00:00:00.000Z'],
    ['across the clocks going back', '2026-11-02T12:00:00.000Z', 12, '2025-11-02T00:00:00.000Z'],
    ['the 29th of February, to a year without one', '2028-02-29T12:00:00.000Z', 12, '2027-02-28T00:00:00.000Z'],
    ['the 31st, to a month with 30 days', '2026-10-31T12:00:00.000Z', 1, '2026-09-29T23:00:00.000Z'],
    ['the 31st of March, back into February', '2026-03-31T12:00:00.000Z', 1, '2026-02-28T00:00:00.000Z'],
    ['across a year end', '2026-01-10T12:00:00.000Z', 2, '2025-11-10T00:00:00.000Z'],
    ['24 months', '2026-10-08T11:00:00.000Z', 24, '2024-10-07T23:00:00.000Z'],
  ])('works out the cut-off on the London calendar: %s', (_label, now, months, expected) => {
    expect(recruitmentRetentionCutoff(new Date(now), months).toISOString()).toBe(expected)
  })

  it('defaults to 12 months and ignores a setting that is not a positive number', () => {
    expect(recruitmentRetentionMonths()).toBe(12)
    for (const bad of ['0', '-3', 'twelve', '']) {
      process.env.RECRUITMENT_RETENTION_MONTHS = bad
      expect(recruitmentRetentionMonths()).toBe(12)
    }
    process.env.RECRUITMENT_RETENTION_MONTHS = '18'
    expect(recruitmentRetentionMonths()).toBe(18)
  })

  it('uses a longer period when one is set', async () => {
    process.env.RECRUITMENT_RETENTION_MONTHS = '24'
    const { run } = setup(everybody())
    const result = await run({ dryRun: true })

    // Only the talent pool applicant, from December 2024, is under 24 months... none are over.
    expect(result.retentionMonths).toBe(24)
    expect(result.due.candidates).toBe(0)
  })
})

describe('when something fails, the person is not marked as done', () => {
  it('leaves the record untouched when the CV file cannot be removed, and carries on with the rest', async () => {
    const { storage, run, row } = setup(everybody())
    storage.failFor.add('cvs/rejected.pdf')

    const result = await run()

    expect(result.failed).toEqual([{ candidateId: 'rejected', step: 'cv_file', message: 'storage said no' }])
    expect(result.cleared).toBe(6)
    expect(result.remaining).toBe(1)

    const untouched = row('recruitment_candidates', 'rejected')
    expect(untouched.anonymised_at).toBeNull()
    expect(untouched.cv_file_path).toBe('cvs/rejected.pdf')
    expect(untouched.email).toBe('rejected@example.com')
    expect(row('recruitment_applications', 'app-rejected').cover_note).toBe('I would love to work at The Anchor')
  })

  it('treats storage throwing the same way', async () => {
    const { storage, run, row } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    storage.throwFor.add('cvs/rejected.pdf')

    const result = await run()

    expect(result.failed).toEqual([{ candidateId: 'rejected', step: 'cv_file', message: 'storage unreachable' }])
    expect(row('recruitment_candidates', 'rejected').anonymised_at).toBeNull()
  })

  it('picks the person up again on the next run once storage is back', async () => {
    const { storage, run, row } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    storage.failFor.add('cvs/rejected.pdf')
    await run()

    storage.failFor.clear()
    const second = await run()

    expect(second.cleared).toBe(1)
    expect(second.failed).toEqual([])
    expect(row('recruitment_candidates', 'rejected').email).toBeNull()
    expect(storage.removed).toEqual(['cvs/rejected.pdf'])
  })

  it.each([
    ['recruitment_applications', 'update', 'applications'],
    ['recruitment_ai_runs', 'update', 'ai_runs'],
    ['recruitment_candidate_notes', 'delete', 'notes'],
    ['recruitment_interview_scorecards', 'update', 'scorecards'],
    ['recruitment_communications', 'update', 'messages'],
    ['recruitment_candidate_appointments', 'update', 'appointments'],
    ['recruitment_candidates', 'update', 'candidate'],
  ] as const)('a failed write to %s leaves the candidate unmarked and says which step', async (table, operation, step) => {
    const { db, run, row } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    db.failNext({ table, operation, message: 'database said no', times: 1 })

    const result = await run()

    expect(result.cleared).toBe(0)
    expect(result.failed).toEqual([{ candidateId: 'rejected', step, message: 'database said no' }])
    expect(row('recruitment_candidates', 'rejected').anonymised_at).toBeNull()
    expect(row('recruitment_candidates', 'rejected').email).toBe('rejected@example.com')

    // And the next run finishes the job.
    const second = await run()
    expect(second.cleared).toBe(1)
    expect(row('recruitment_candidates', 'rejected').email).toBeNull()
  })

  it('stops for a calendar entry that could not be removed', async () => {
    const { storage, run, row } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    deleteCalendarEvent.mockResolvedValue({ deleted: false, reason: 'Google said 500' })

    const result = await run()

    expect(result.failed).toEqual([{ candidateId: 'rejected', step: 'calendar', message: 'Google said 500' }])
    expect(storage.removed).toEqual([])
    expect(row('recruitment_candidates', 'rejected').anonymised_at).toBeNull()
  })

  it('stops when the calendar call throws', async () => {
    const { run, row } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    deleteCalendarEvent.mockRejectedValue(new Error('network down'))

    const result = await run()

    expect(result.failed[0]).toMatchObject({ step: 'calendar', message: 'network down' })
    expect(row('recruitment_candidates', 'rejected').anonymised_at).toBeNull()
  })

  it('still clears the person when no calendar is connected, and counts the entry it could not reach', async () => {
    const { run, row } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    deleteCalendarEvent.mockResolvedValue({ deleted: false, reason: 'not_configured' })

    const result = await run()

    expect(result.cleared).toBe(1)
    expect(result.calendarEntriesRemoved).toBe(0)
    expect(result.calendarEntriesLeft).toBe(1)
    expect(row('recruitment_candidates', 'rejected').email).toBeNull()
  })

  it('keeps reporting a calendar entry it could not reach, so it is not forgotten', async () => {
    const { run } = setup(fullRecord('rejected', 'rejected', '2025-03-01T10:00:00+00:00'))
    deleteCalendarEvent.mockResolvedValue({ deleted: false, reason: 'not_configured' })
    await run()

    const later = await run({ dryRun: true })

    expect(later.due.candidates).toBe(1)
    expect(later.due.calendarEntries).toBe(1)
    expect(later.due.contactDetails).toBe(0)
    expect(later.due.cvFiles).toBe(0)
  })

  it('throws, and writes nothing, when the candidates cannot be read at all', async () => {
    const { db, run } = setup(everybody())
    db.failNext({ table: 'recruitment_candidates', operation: 'select', message: 'connection refused' })

    await expect(run()).rejects.toThrow('Could not read recruitment_candidates: connection refused')
    expect(db.writes).toEqual([])
  })

  it('throws, and writes nothing, when the applications cannot be read', async () => {
    // Without the applications there is no telling who was hired or who applied
    // again last month, so nobody may be cleared.
    const { db, storage, run } = setup(everybody())
    db.failNext({ table: 'recruitment_applications', operation: 'select', message: 'timeout' })

    await expect(run()).rejects.toThrow('Could not read recruitment_applications: timeout')
    expect(db.writes).toEqual([])
    expect(storage.removed).toEqual([])
  })

  it('throws, and writes nothing, when the appointments cannot be read', async () => {
    const { db, run } = setup(everybody())
    db.failNext({ table: 'recruitment_candidate_appointments', operation: 'select', message: 'timeout' })

    await expect(run()).rejects.toThrow('Could not read recruitment_candidate_appointments: timeout')
    expect(db.writes).toEqual([])
  })
})

describe('running it again', () => {
  it('finds nothing left to do after a clean run, and writes nothing', async () => {
    const { db, storage, run } = setup(everybody())
    await run()
    const writesAfterFirst = db.writes.length
    const filesAfterFirst = storage.removed.length
    deleteCalendarEvent.mockClear()

    const second = await run()

    expect(second.due.candidates).toBe(0)
    expect(second.cleared).toBe(0)
    expect(db.writes.length).toBe(writesAfterFirst)
    expect(storage.removed.length).toBe(filesAfterFirst)
    expect(deleteCalendarEvent).not.toHaveBeenCalled()
  })

  it('clears at most the batch limit and says how many are left', async () => {
    const { run } = setup(everybody())

    const first = await run({ limit: 3 })
    expect(first.cleared).toBe(3)
    expect(first.remaining).toBe(4)

    const second = await run({ limit: 3 })
    expect(second.cleared).toBe(3)
    expect(second.remaining).toBe(1)

    const third = await run({ limit: 3 })
    expect(third.cleared).toBe(1)
    expect(third.remaining).toBe(0)
  })

  it('takes the oldest first', async () => {
    const { run, row } = setup(everybody())
    await run({ limit: 1 })

    // The talent pool applicant, from December 2024, is the oldest on file.
    expect(row('recruitment_candidates', 'talent-pool').email).toBeNull()
    expect(row('recruitment_candidates', 'rejected').email).toBe('rejected@example.com')
  })

  it('reads past the first page of candidates', async () => {
    const many: Record<string, Row[]> = { recruitment_candidates: [], recruitment_applications: [] }
    for (let index = 0; index < 450; index += 1) {
      const id = `bulk-${String(index).padStart(3, '0')}`
      many.recruitment_candidates.push(candidate(id, { created_at: '2025-01-01T10:00:00+00:00' }))
      many.recruitment_applications.push(application(`app-${id}`, id, { status: 'new', created_at: '2025-01-01T10:00:00+00:00' }))
    }
    const { run } = setup(many)

    const result = await run({ dryRun: true })

    expect(result.due.candidates).toBe(450)
    expect(result.due.byCategory.undecided).toBe(450)
  })
})

describe('people the old job already cleared', () => {
  function alreadyAnonymised() {
    const seed = fullRecord('old-job', 'rejected', '2024-05-01T10:00:00+00:00', {
      anonymised_at: '2025-06-01T02:30:00+00:00',
      first_name: null,
      last_name: null,
      email: null,
      phone: null,
      phone_e164: null,
      location: null,
      cv_file_path: null,
      cv_file_name: null,
      cv_mime_type: null,
      cv_file_size_bytes: null,
      cv_text: null,
      cv_sha256: null,
      cv_summary: null,
      extracted_data: null,
      provided_details: null,
      notes: null,
      sms_consent: false,
      sms_consent_at: null,
    })
    seed.recruitment_communications[0].final_body = '[anonymised after recruitment retention period]'
    seed.recruitment_communications[0].subject = null as never
    return seed
  }

  it('still clears the answers, AI output and calendar entries that job never touched', async () => {
    const { run, row } = setup(alreadyAnonymised())
    const result = await run()

    expect(result.due.candidates).toBe(1)
    expect(result.due.contactDetails).toBe(0)
    expect(result.due.cvFiles).toBe(0)
    expect(result.due.messages).toBe(0)
    expect(result.due.applicationAnswers).toBe(1)
    expect(result.due.applicationAiOutput).toBe(1)
    expect(result.due.aiRuns).toBe(1)
    expect(result.due.calendarEntries).toBe(1)
    expect(row('recruitment_applications', 'app-old-job').cover_note).toBeNull()
    expect(row('recruitment_applications', 'app-old-job').ai_rationale).toBeNull()
    expect(row('recruitment_ai_runs', 'run-old-job').raw_response).toBeNull()
    expect(deleteCalendarEvent).toHaveBeenCalledWith('appt-old-job', expect.anything())
  })

  it('keeps the date they were first cleared', async () => {
    const { run, row } = setup(alreadyAnonymised())
    await run()

    expect(row('recruitment_candidates', 'old-job').anonymised_at).toBe('2025-06-01T02:30:00+00:00')
  })

  it('is not counted again once nothing is left', async () => {
    const { run } = setup(alreadyAnonymised())
    await run()

    expect((await run({ dryRun: true })).due.candidates).toBe(0)
  })
})

describe('the switch', () => {
  it('is off unless RECRUITMENT_RETENTION_APPLY is exactly "true"', () => {
    expect(isRecruitmentRetentionApplyEnabled()).toBe(false)
    for (const value of ['', '1', 'yes', 'TRUE', 'True', ' true', 'false']) {
      process.env.RECRUITMENT_RETENTION_APPLY = value
      expect(isRecruitmentRetentionApplyEnabled(), JSON.stringify(value)).toBe(false)
    }
    process.env.RECRUITMENT_RETENTION_APPLY = 'true'
    expect(isRecruitmentRetentionApplyEnabled()).toBe(true)
  })
})
