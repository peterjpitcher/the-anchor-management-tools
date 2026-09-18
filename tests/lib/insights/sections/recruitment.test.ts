import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildRecruitmentSection, recruitmentSection } from '@/lib/insights/sections/recruitment'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext: Friday 25 Sep 2026 06:00 London (05:00 UTC). Today 2026-09-25, this week
// 18 to 24 Sep, previous 4 weeks 21 Aug to 17 Sep, next 7 days 25 Sep to 1 Oct.

type Row = Record<string, unknown>

const NOW = new Date('2026-09-25T05:00:00Z')
const LIST_URL = `${TEST_APP_URL}/recruitment`

let sequence = 0
const names: string[] = []

function nextId(prefix: string): string {
  sequence += 1
  return `${prefix}-${String(sequence).padStart(4, '0')}`
}

function application(overrides: Row = {}): Row {
  const id = (overrides.id as string | undefined) ?? nextId('app')
  const first = `Firstname${sequence}x`
  const last = `Surname${sequence}y`
  names.push(first, last)
  return {
    id,
    candidate_id: `cand-${id}`,
    status: 'ai_screened',
    job_posting_id: 'post-bar',
    is_general: false,
    created_at: '2026-09-23T10:00:00Z',
    updated_at: '2026-09-23T10:00:00Z',
    archived_at: null,
    duplicate_of_application_id: null,
    candidate: { first_name: first, last_name: last },
    job_posting: { title: 'Bar staff' },
    ...overrides,
  }
}

function posting(overrides: Row = {}): Row {
  return {
    id: 'post-bar',
    title: 'Bar staff',
    status: 'open',
    opened_at: '2026-05-12T09:00:00Z',
    application_closing_date: null,
    ...overrides,
  }
}

/** An appointment starting at `start` (UTC) and lasting an hour. */
function appointment(applicationId: string, start: string, overrides: Row = {}): Row {
  const end = new Date(Date.parse(start) + 60 * 60 * 1000).toISOString().replace('.000Z', 'Z')
  return {
    id: nextId('appt'),
    application_id: applicationId,
    candidate_id: `cand-${applicationId}`,
    type: 'interview',
    status: 'scheduled',
    scheduled_start: start,
    scheduled_end: end,
    outcome: null,
    outcome_recorded_at: null,
    archived_at: null,
    ...overrides,
  }
}

function statusEvent(applicationId: string, toStatus: string, createdAt: string): Row {
  return { id: nextId('event'), application_id: applicationId, from_status: null, to_status: toStatus, created_at: createdAt }
}

interface Fixture {
  applications?: Row[]
  postings?: Row[]
  appointments?: Row[]
  events?: Row[]
}

function db(fixture: Fixture = {}): FakeDb {
  return new FakeDb({
    recruitment_applications: fixture.applications ?? [],
    recruitment_job_postings: fixture.postings ?? [posting()],
    recruitment_candidate_appointments: fixture.appointments ?? [],
    recruitment_application_status_events: fixture.events ?? [],
  })
}

async function build(fake: FakeDb, now: Date = NOW): Promise<SectionBuildResult> {
  return buildRecruitmentSection(makeContext(fake, now))
}

function metric(result: SectionBuildResult, label: string): { value: string; comparison?: string } | undefined {
  return result.metrics.find((item) => item.label === label)
}

function list(result: SectionBuildResult, title: string): string[] {
  return result.lists.find((item) => item.title === title)?.items.map((item) => item.text) ?? []
}

function byKey(result: SectionBuildResult, prefix: string): InsightSignal[] {
  return result.signals.filter((signal) => signal.key.startsWith(prefix))
}

/** Everything that can reach the email or a printed copy. */
function emailSafeText(result: SectionBuildResult): string {
  const parts: string[] = [result.headline, ...result.notes]
  for (const item of result.metrics) parts.push(item.label, item.value, item.comparison ?? '')
  for (const signal of result.signals) {
    if (signal.emailSafe) parts.push(signal.text)
    if (signal.action) parts.push(signal.action.text, ...(signal.action.members ?? []))
  }
  return parts.join('\n')
}

function leakedNames(text: string): string[] {
  return names.filter((name) => text.includes(name))
}

describe('recruitment section', () => {
  it('is registered under the recruitment key with its list page', () => {
    expect(recruitmentSection).toMatchObject({ key: 'recruitment', title: 'Recruitment', path: '/recruitment' })
  })

  it('reports an empty pipeline plainly, with real zeros and no signals', async () => {
    const fake = db({ postings: [] })
    const result = await build(fake)
    expect(result.headline).toBe('No open roles and no active applicants. No new applications this week.')
    expect(result.signals).toEqual([])
    expect(result.notes).toEqual([])
    expect(result.metrics.slice(0, 4)).toEqual([
      { label: 'Open roles', value: '0' },
      { label: 'New applications this week', value: '0', comparison: 'no activity, as in the 4-week average' },
      { label: 'Awaiting review', value: '0' },
      { label: 'Awaiting a decision', value: '0' },
    ])
    expect(result.metrics.map((item) => item.value).every((value) => value === '0')).toBe(true)
    expect(result.lists.find((item) => item.title === 'Open roles')).toMatchObject({ items: [], emptyText: 'No open roles.' })
    expect(result.lists.find((item) => item.title === 'Interviews and trials in the next 7 days')).toMatchObject({ items: [], emptyText: 'None booked.' })
    // No active applicants: nothing to look up appointments or status changes for.
    const tables = fake.calls.map((call) => call.table)
    expect(tables.filter((table) => table === 'recruitment_candidate_appointments')).toHaveLength(1) // the unrecorded count only
    expect(tables).not.toContain('recruitment_application_status_events')
  })

  it('puts every active applicant in exactly one stage and leaves inactive ones out', async () => {
    const future = '2026-09-28T09:00:00Z'
    const apps = [
      application({ id: 'new', status: 'new' }),
      application({ id: 'screened', status: 'ai_screened' }),
      application({ id: 'shortlisted', status: 'shortlisted' }),
      application({ id: 'invited', status: 'interview_invited' }),
      application({ id: 'trial-offered', status: 'trial_offered' }),
      application({ id: 'invited-booked', status: 'interview_invited' }),
      application({ id: 'scheduled', status: 'interview_scheduled' }),
      application({ id: 'trial-scheduled', status: 'trial_scheduled' }),
      application({ id: 'interviewed', status: 'interviewed' }),
      application({ id: 'trial-done', status: 'trial_completed' }),
      application({ id: 'past-unrecorded', status: 'interview_scheduled' }),
      application({ id: 'offered', status: 'offered' }),
      application({ id: 'on-hold', status: 'on_hold' }),
      // Not active.
      application({ id: 'pool', status: 'talent_pool', job_posting_id: null, is_general: true, job_posting: null }),
      application({ id: 'rejected', status: 'rejected' }),
      application({ id: 'withdrawn', status: 'withdrawn' }),
      application({ id: 'hired', status: 'hired' }),
      application({ id: 'duplicate', status: 'declined_duplicate', duplicate_of_application_id: 'new' }),
      application({ id: 'duplicate-new', status: 'new', duplicate_of_application_id: 'screened' }),
      application({ id: 'archived', status: 'ai_screened', archived_at: '2026-09-20T10:00:00Z' }),
    ]
    const result = await build(db({
      applications: apps,
      appointments: [
        appointment('invited-booked', future),
        appointment('scheduled', future),
        appointment('interviewed', '2026-09-22T09:00:00Z', { status: 'completed', outcome: 'Good', outcome_recorded_at: '2026-09-22T11:00:00Z' }),
        appointment('trial-done', '2026-09-21T17:00:00Z', { type: 'trial_shift', status: 'completed', outcome: 'Fine' }),
        appointment('past-unrecorded', '2026-09-23T09:00:00Z'),
      ],
    }))
    expect(metric(result, 'Awaiting review')?.value).toBe('2')
    // 'trial-scheduled' has a scheduled status but nothing booked, so it is to arrange.
    expect(metric(result, 'Interview or trial to arrange')?.value).toBe('4')
    expect(metric(result, 'Interview or trial booked')?.value).toBe('2')
    expect(metric(result, 'Awaiting a decision')?.value).toBe('3')
    expect(metric(result, 'Offered')?.value).toBe('1')
    expect(metric(result, 'On hold')?.value).toBe('1')
    expect(metric(result, 'Active applicants')?.value).toBe('13')
    expect(result.notes).toEqual([])
    expect(list(result, 'Interview or trial to arrange')).toEqual([
      expect.stringContaining('invited to interview, nothing booked'),
      expect.stringContaining('shortlisted, no interview arranged'),
      expect.stringContaining('offered a trial shift, nothing booked'),
      expect.stringContaining('marked trial scheduled, but nothing booked'),
    ])
    const decisionList = list(result, 'Awaiting a decision')
    expect(decisionList).toHaveLength(3)
    expect(decisionList.join('\n')).toContain('trial shift on Mon 21 Sep, waiting 4 days')
    expect(decisionList.join('\n')).toContain('interview on Wed 23 Sep, waiting 2 days, no outcome recorded')
    expect(result.headline).toBe('1 open role and 13 active applicants: 2 awaiting review (oldest 2 days), 3 awaiting a decision, 2 interviews or trials in the next 7 days. 18 new applications this week.')
  })

  describe('a scheduled status whose booking is gone', () => {
    // Cancelling from the outcome form and archiving an appointment both leave the
    // application status as it was, so the status alone does not mean anything is booked.
    it('puts an interview whose booking was cancelled back to arrange', async () => {
      const result = await build(db({
        applications: [application({ id: 'cancelled', status: 'interview_scheduled' })],
        appointments: [
          appointment('cancelled', '2026-09-28T09:00:00Z', { status: 'cancelled', outcome: 'Could not make it', outcome_recorded_at: '2026-09-24T10:00:00Z' }),
        ],
      }))
      expect(metric(result, 'Interview or trial to arrange')?.value).toBe('1')
      expect(metric(result, 'Interview or trial booked')?.value).toBe('0')
      expect(metric(result, 'Awaiting a decision')?.value).toBe('0')
      expect(metric(result, 'Interviews and trials, next 7 days')).toEqual({ label: 'Interviews and trials, next 7 days', value: '0' })
      expect(list(result, 'Interview or trial to arrange')).toEqual([
        expect.stringMatching(/^Firstname\d+x Surname\d+y \(Bar staff\): marked interview scheduled, but nothing booked\.$/),
      ])
      expect(list(result, 'Interviews and trials in the next 7 days')).toEqual([])
      expect(result.signals).toEqual([])
      expect(result.notes).toEqual([])
    })

    it('puts a trial whose booking was archived back to arrange, past or future', async () => {
      const result = await build(db({
        applications: [
          application({ id: 'archived-future', status: 'trial_scheduled' }),
          application({ id: 'archived-past', status: 'trial_scheduled' }),
        ],
        appointments: [
          appointment('archived-future', '2026-09-29T16:00:00Z', { type: 'trial_shift', archived_at: '2026-09-24T10:00:00Z' }),
          // Archived with no outcome: not an unrecorded interview or trial either.
          appointment('archived-past', '2026-09-20T16:00:00Z', { type: 'trial_shift', archived_at: '2026-09-21T10:00:00Z' }),
        ],
      }))
      expect(metric(result, 'Interview or trial to arrange')?.value).toBe('2')
      expect(metric(result, 'Interview or trial booked')?.value).toBe('0')
      expect(metric(result, 'Awaiting a decision')?.value).toBe('0')
      expect(metric(result, 'Interviews and trials, next 7 days')?.value).toBe('0')
      expect(list(result, 'Interview or trial to arrange')).toEqual([
        expect.stringContaining('marked trial scheduled, but nothing booked'),
        expect.stringContaining('marked trial scheduled, but nothing booked'),
      ])
      expect(result.signals).toEqual([])
    })

    it('still counts it as booked when another booking is still to come', async () => {
      const result = await build(db({
        applications: [application({ id: 'rebooked', status: 'interview_scheduled' })],
        appointments: [
          appointment('rebooked', '2026-09-26T09:00:00Z', { status: 'cancelled' }),
          appointment('rebooked', '2026-09-30T09:00:00Z'),
        ],
      }))
      expect(metric(result, 'Interview or trial booked')?.value).toBe('1')
      expect(metric(result, 'Interview or trial to arrange')?.value).toBe('0')
      expect(list(result, 'Interviews and trials in the next 7 days')).toEqual([expect.stringMatching(/^Wed 30 Sep 10:00, interview: /)])
    })
  })

  it('looks up appointments and status changes in chunks, and finds rows in the second chunk', async () => {
    // 160 active applicants: more than one lookup chunk of 150 ids. Ids sort in this order.
    const ids = Array.from({ length: 160 }, (_, index) => `c-${String(index).padStart(3, '0')}`)
    const apps = ids.map((id) => application({ id, status: id === 'c-157' ? 'interview_scheduled' : 'interviewed' }))
    const events = ids.map((id) => statusEvent(id, 'interviewed', id === 'c-155' ? '2026-09-01T10:00:00Z' : '2026-09-24T10:00:00Z'))
    const fake = db({
      applications: apps,
      events,
      appointments: [
        // Both in the second chunk of ids.
        appointment('c-157', '2026-09-30T09:00:00Z'),
        appointment('c-158', '2026-09-02T09:00:00Z', { status: 'completed', outcome: 'Good' }),
      ],
    })
    const result = await build(fake)
    const tables = fake.calls.map((call) => call.table)
    // Two appointment lookups plus the unrecorded count; two status-change lookups.
    expect(tables.filter((table) => table === 'recruitment_candidate_appointments')).toHaveLength(3)
    expect(tables.filter((table) => table === 'recruitment_application_status_events')).toHaveLength(2)
    expect(metric(result, 'Active applicants')?.value).toBe('160')
    expect(metric(result, 'Interview or trial booked')?.value).toBe('1')
    expect(metric(result, 'Interviews and trials, next 7 days')).toEqual({ label: 'Interviews and trials, next 7 days', value: '1', comparison: 'first Wed 30 Sep' })
    expect(metric(result, 'Awaiting a decision')).toEqual({ label: 'Awaiting a decision', value: '159', comparison: '2 waiting more than 7 days' })
    expect(byKey(result, 'recruitment.decision_overdue.').map((signal) => [signal.key, signal.action?.text])).toEqual([
      ['recruitment.decision_overdue.c-155', 'Decide on the Bar staff applicant after the interview on Tue 1 Sep, waiting 24 days'],
      ['recruitment.decision_overdue.c-158', 'Decide on the Bar staff applicant after the interview on Wed 2 Sep, waiting 23 days'],
    ])
  })

  describe('awaiting a decision (red after 7 days)', () => {
    it('raises red for a candidate waiting more than 7 days since the interview, not at exactly 7', async () => {
      const result = await build(db({
        applications: [
          application({ id: 'late', status: 'interviewed' }),
          application({ id: 'on-time', status: 'interviewed' }),
        ],
        appointments: [
          appointment('late', '2026-09-17T09:00:00Z', { status: 'completed', outcome: 'Good' }),
          appointment('on-time', '2026-09-18T09:00:00Z', { status: 'completed', outcome: 'Good' }),
        ],
      }))
      const red = byKey(result, 'recruitment.decision_overdue.')
      expect(red.map((signal) => signal.key)).toEqual(['recruitment.decision_overdue.late'])
      expect(red[0]).toMatchObject({
        entity: 'application:late',
        rag: 'red',
        kind: 'issue',
        emailSafe: false,
        action: {
          text: 'Decide on the Bar staff applicant after the interview on Thu 17 Sep, waiting 8 days',
          href: LIST_URL,
          target: 'list',
          dueDate: '2026-09-24',
          impact: 'staffing',
        },
      })
      expect(red[0].text).toMatch(/^Firstname\d+x Surname\d+y \(Bar staff\) has waited 8 days for a decision since the interview on Thu 17 Sep\.$/)
      expect(metric(result, 'Awaiting a decision')).toEqual({ label: 'Awaiting a decision', value: '2', comparison: '1 waiting more than 7 days' })
    })

    it('uses the latest interview or trial, here a trial shift', async () => {
      const result = await build(db({
        applications: [application({ id: 'trial', status: 'trial_completed' })],
        appointments: [
          appointment('trial', '2026-09-01T09:00:00Z', { status: 'completed', outcome: 'Good' }),
          appointment('trial', '2026-09-10T16:00:00Z', { type: 'trial_shift', status: 'completed', outcome: 'Good' }),
        ],
      }))
      const [red] = byKey(result, 'recruitment.decision_overdue.')
      expect(red.action?.text).toBe('Decide on the Bar staff applicant after the trial shift on Thu 10 Sep, waiting 15 days')
      expect(red.text).toContain('since the trial shift on Thu 10 Sep')
    })

    it('falls back to the day the status changed, then to the last update, when no appointment exists', async () => {
      const result = await build(db({
        applications: [
          application({ id: 'event', status: 'interviewed', updated_at: '2026-09-24T10:00:00Z' }),
          application({ id: 'no-event', status: 'trial_completed', updated_at: '2026-09-05T10:00:00Z' }),
        ],
        events: [
          statusEvent('event', 'interview_scheduled', '2026-08-20T10:00:00Z'),
          statusEvent('event', 'interviewed', '2026-09-01T10:00:00Z'),
          statusEvent('no-event', 'interviewed', '2026-08-01T10:00:00Z'),
        ],
      }))
      const red = byKey(result, 'recruitment.decision_overdue.')
      expect(red.map((signal) => signal.action?.text)).toEqual([
        'Decide on the Bar staff applicant after the interview on Tue 1 Sep, waiting 24 days',
        'Decide on the Bar staff applicant after the trial shift on Sat 5 Sep, waiting 20 days',
      ])
    })

    it('treats a past appointment still scheduled with no outcome as awaiting a decision', async () => {
      const result = await build(db({
        applications: [application({ id: 'stale', status: 'interview_scheduled' })],
        appointments: [appointment('stale', '2026-07-02T09:00:00Z')],
      }))
      expect(metric(result, 'Awaiting a decision')?.value).toBe('1')
      expect(metric(result, 'Interview or trial booked')?.value).toBe('0')
      const [red] = byKey(result, 'recruitment.decision_overdue.')
      expect(red.action?.text).toBe('Decide on the Bar staff applicant after the interview on Thu 2 Jul, waiting 85 days')
    })

    it('uses the general wording for an application with no role', async () => {
      const result = await build(db({
        applications: [application({ id: 'general', status: 'interviewed', job_posting_id: null, is_general: true, job_posting: null })],
        appointments: [appointment('general', '2026-09-01T09:00:00Z', { status: 'completed', outcome: 'Good' })],
      }))
      const [red] = byKey(result, 'recruitment.decision_overdue.')
      expect(red.action?.text).toBe('Decide on the general applicant after the interview on Tue 1 Sep, waiting 24 days')
      expect(red.text).toContain('(general application)')
    })

    it('merges more than two into one red list action whose members name no one', async () => {
      const apps = ['a', 'b', 'c'].map((id) => application({ id: `late-${id}`, status: 'interviewed' }))
      const result = await build(db({
        applications: apps,
        appointments: [
          appointment('late-a', '2026-09-10T09:00:00Z', { status: 'completed', outcome: 'Good' }),
          appointment('late-b', '2026-09-01T09:00:00Z', { status: 'completed', outcome: 'Good' }),
          appointment('late-c', '2026-09-15T09:00:00Z', { status: 'completed', outcome: 'Good' }),
        ],
      }))
      const red = result.signals.filter((signal) => signal.rag === 'red')
      expect(red).toHaveLength(1)
      expect(red[0]).toMatchObject({
        key: 'recruitment.decisions_overdue',
        emailSafe: true,
        text: '3 candidates have waited more than 7 days for a decision after an interview or trial, the longest 24 days.',
        action: {
          text: 'Decide on 3 candidates waiting more than 7 days after an interview or trial',
          href: LIST_URL,
          target: 'list',
          dueDate: '2026-09-08',
          impact: 'staffing',
          members: [
            'Decide on the Bar staff applicant after the interview on Tue 1 Sep, waiting 24 days',
            'Decide on the Bar staff applicant after the interview on Thu 10 Sep, waiting 15 days',
            'Decide on the Bar staff applicant after the interview on Tue 15 Sep, waiting 10 days',
          ],
        },
      })
      expect(red[0].entity).toBeUndefined()
      // Names stay on the page, in the list.
      expect(list(result, 'Awaiting a decision')).toHaveLength(3)
      expect(leakedNames(list(result, 'Awaiting a decision').join('\n')).length).toBeGreaterThan(0)
    })
  })

  describe('past appointments with no outcome (amber)', () => {
    it('raises amber with a housekeeping action for an active applicant', async () => {
      const result = await build(db({
        applications: [application({ id: 'recent', status: 'interview_scheduled' })],
        appointments: [appointment('recent', '2026-09-22T09:00:00Z')],
      }))
      expect(result.signals).toHaveLength(1)
      expect(result.signals[0]).toMatchObject({
        key: 'recruitment.no_outcome.recent',
        entity: 'application:recent',
        rag: 'amber',
        kind: 'issue',
        emailSafe: false,
        action: { text: 'Record the outcome of the Bar staff interview on Tue 22 Sep', href: LIST_URL, target: 'list', impact: 'housekeeping' },
      })
      expect(result.signals[0].action?.dueDate).toBeUndefined()
      expect(result.signals[0].text).toMatch(/\(Bar staff\) has no outcome recorded for the interview on Tue 22 Sep\.$/)
    })

    it('counts several past appointments for one applicant as one record', async () => {
      const result = await build(db({
        applications: [application({ id: 'two', status: 'interview_invited', job_posting_id: null, is_general: true, job_posting: null })],
        appointments: [
          appointment('two', '2026-09-21T09:00:00Z'),
          appointment('two', '2026-09-23T09:00:00Z', { type: 'trial_shift' }),
        ],
      }))
      const amber = byKey(result, 'recruitment.no_outcome.')
      expect(amber).toHaveLength(1)
      expect(amber[0].text).toContain('has no outcome recorded for 2 past interviews or trials, the latest on Wed 23 Sep.')
      expect(amber[0].action?.text).toBe('Record the outcomes of 2 past interviews or trials for the general applicant, the latest on Wed 23 Sep')
    })

    it('keeps the decision as the one action when the same candidate has also waited too long', async () => {
      const fake = db({
        applications: [application({ id: 'both', status: 'interview_scheduled' })],
        appointments: [appointment('both', '2026-09-10T09:00:00Z')],
      })
      const result = await build(fake)
      expect(result.signals.map((signal) => [signal.key, signal.rag, Boolean(signal.action)])).toEqual([
        ['recruitment.decision_overdue.both', 'red', true],
        ['recruitment.no_outcome.both', 'amber', false],
      ])
      const report = await buildInsightsReport({
        createDb: () => fake.asDb(),
        now: NOW,
        appUrl: TEST_APP_URL,
        sections: [recruitmentSection],
        logFailure: () => undefined,
      })
      expect(report.sections[0]).toMatchObject({ key: 'recruitment', status: 'red', href: LIST_URL })
      expect(report.actions).toHaveLength(1)
      expect(report.actions[0]).toMatchObject({ sectionKey: 'recruitment', rag: 'red', signalKey: 'recruitment.decision_overdue.both' })
      expect(leakedNames(report.actions[0].text)).toEqual([])
    })

    it('keeps the missing outcome as a line only when the decisions are merged', async () => {
      const result = await build(db({
        applications: ['x', 'y', 'z'].map((id) => application({ id, status: 'interview_scheduled' })),
        appointments: [
          appointment('x', '2026-09-01T09:00:00Z'),
          appointment('y', '2026-09-02T09:00:00Z'),
          appointment('z', '2026-09-03T09:00:00Z'),
        ],
      }))
      expect(byKey(result, 'recruitment.decisions_overdue')).toHaveLength(1)
      const lines = byKey(result, 'recruitment.no_outcome')
      expect(lines).toHaveLength(3)
      expect(lines.every((signal) => signal.action === undefined && signal.emailSafe === false)).toBe(true)
      expect(result.signals.filter((signal) => signal.action)).toHaveLength(1)
    })

    it('merges more than two into one list action', async () => {
      const result = await build(db({
        applications: ['p', 'q', 'r'].map((id) => application({ id, status: 'interview_scheduled' })),
        appointments: [
          appointment('p', '2026-09-23T09:00:00Z'),
          appointment('q', '2026-09-19T09:00:00Z'),
          appointment('r', '2026-09-22T09:00:00Z', { type: 'trial_shift' }),
        ],
      }))
      const amber = result.signals.filter((signal) => signal.rag === 'amber')
      expect(amber).toHaveLength(1)
      expect(amber[0]).toMatchObject({
        key: 'recruitment.no_outcomes',
        emailSafe: true,
        text: '3 candidates have a past interview or trial with no outcome recorded.',
        action: {
          text: 'Record the outcomes of past interviews or trials for 3 candidates',
          target: 'list',
          href: LIST_URL,
          impact: 'housekeeping',
          members: [
            'Record the outcome of the Bar staff interview on Sat 19 Sep',
            'Record the outcome of the Bar staff trial shift on Tue 22 Sep',
            'Record the outcome of the Bar staff interview on Wed 23 Sep',
          ],
        },
      })
    })

    it('counts leftovers on candidates no longer active as a page-only line, not an issue', async () => {
      const result = await build(db({
        postings: [],
        applications: [
          application({ id: 'hired', status: 'hired' }),
          application({ id: 'rejected', status: 'rejected' }),
        ],
        appointments: [
          appointment('hired', '2026-07-01T09:00:00Z'),
          appointment('rejected', '2026-07-03T09:00:00Z', { type: 'trial_shift' }),
          // Not counted: recorded, cancelled, archived or still to come.
          appointment('rejected', '2026-07-02T09:00:00Z', { status: 'completed', outcome: 'Poor' }),
          appointment('rejected', '2026-07-04T09:00:00Z', { status: 'cancelled', outcome: 'Withdrew' }),
          appointment('hired', '2026-07-05T09:00:00Z', { archived_at: '2026-08-01T09:00:00Z' }),
          appointment('hired', '2026-10-05T09:00:00Z'),
        ],
      }))
      expect(result.signals).toEqual([{
        key: 'recruitment.inactive_no_outcome',
        rag: 'green',
        kind: 'info',
        text: '2 past interviews or trials for candidates no longer active have no outcome recorded.',
        emailSafe: true,
      }])
    })

    it('does not treat an interview still in progress as past', async () => {
      // Starts 05:30 London (04:30 UTC) and ends 06:30 London, after the report time.
      const result = await build(db({
        applications: [application({ id: 'now', status: 'interview_scheduled' })],
        appointments: [appointment('now', '2026-09-25T04:30:00Z')],
      }))
      expect(result.signals).toEqual([])
      expect(metric(result, 'Interview or trial booked')?.value).toBe('1')
      expect(list(result, 'Interviews and trials in the next 7 days')).toEqual([expect.stringMatching(/^Fri 25 Sep 05:30, interview: /)])
    })
  })

  describe('awaiting review (amber after 7 days)', () => {
    it('raises amber for more than 7 days since applying, on London dates', async () => {
      const result = await build(db({
        applications: [
          application({ id: 'old', status: 'ai_screened', created_at: '2026-09-17T10:00:00Z' }),
          application({ id: 'seven', status: 'new', created_at: '2026-09-18T10:00:00Z' }),
          // 23:30 UTC on 17 Sep is 00:30 on 18 Sep in London: 7 days, not 8.
          application({ id: 'midnight', status: 'new', created_at: '2026-09-17T23:30:00Z' }),
        ],
      }))
      const amber = byKey(result, 'recruitment.review_overdue.')
      expect(amber).toHaveLength(1)
      expect(amber[0]).toMatchObject({
        key: 'recruitment.review_overdue.old',
        entity: 'application:old',
        rag: 'amber',
        emailSafe: false,
        action: {
          text: 'Review the Bar staff application received Thu 17 Sep, waiting 8 days',
          href: LIST_URL,
          target: 'list',
          dueDate: '2026-09-24',
          impact: 'staffing',
        },
      })
      expect(amber[0].text).toMatch(/\(Bar staff\) applied on Thu 17 Sep and has waited 8 days for a review\.$/)
      expect(metric(result, 'Awaiting review')).toEqual({ label: 'Awaiting review', value: '3', comparison: 'oldest 8 days, 1 waiting more than 7 days' })
      expect(list(result, 'Awaiting review')[0]).toMatch(/applied Thu 17 Sep, 8 days ago, AI screened\.$/)
    })

    it('merges more than two into one list action, oldest first', async () => {
      const result = await build(db({
        applications: [
          application({ id: 'r1', created_at: '2026-07-07T10:00:00Z' }),
          application({ id: 'r2', created_at: '2026-07-21T10:00:00Z' }),
          application({ id: 'r3', created_at: '2026-07-14T10:00:00Z', job_posting_id: null, is_general: true, job_posting: null }),
          application({ id: 'r4', created_at: '2026-09-01T10:00:00Z' }),
        ],
      }))
      const amber = result.signals.filter((signal) => signal.rag === 'amber')
      expect(amber).toHaveLength(1)
      expect(amber[0]).toMatchObject({
        key: 'recruitment.reviews_overdue',
        emailSafe: true,
        text: '4 applications have waited more than 7 days for a review, the oldest 80 days.',
        action: {
          text: 'Review 4 applications waiting more than 7 days',
          target: 'list',
          dueDate: '2026-07-14',
          members: [
            'Review the Bar staff application received Tue 7 Jul, waiting 80 days',
            'Review the general application received Tue 14 Jul, waiting 73 days',
            'Review the Bar staff application received Tue 21 Jul, waiting 66 days',
            'Review the Bar staff application received Tue 1 Sep, waiting 24 days',
          ],
        },
      })
    })
  })

  describe('open roles', () => {
    it('raises amber for an open role with no active applicants only', async () => {
      const result = await build(db({
        postings: [
          posting({ id: 'post-bar', title: 'Bar staff' }),
          posting({ id: 'post-kitchen', title: 'Kitchen staff', application_closing_date: '2026-07-26' }),
          posting({ id: 'post-rejected', title: 'Cellar person', opened_at: null }),
          posting({ id: 'post-closed', title: 'Supervisor', status: 'closed' }),
          posting({ id: 'post-draft', title: 'Chef', status: 'draft' }),
        ],
        applications: [
          application({ id: 'bar-1', job_posting_id: 'post-bar' }),
          application({ id: 'cellar-1', status: 'rejected', job_posting_id: 'post-rejected', job_posting: { title: 'Cellar person' } }),
        ],
      }))
      const amber = byKey(result, 'recruitment.role_no_applicants.')
      expect(amber.map((signal) => signal.key)).toEqual([
        'recruitment.role_no_applicants.post-rejected',
        'recruitment.role_no_applicants.post-kitchen',
      ])
      expect(amber[0]).toMatchObject({
        entity: 'job_posting:post-rejected',
        rag: 'amber',
        emailSafe: true,
        text: 'The Cellar person role is open with no active applicants.',
        action: { text: 'Advertise or close the Cellar person role, which has no active applicants', href: LIST_URL, target: 'list', impact: 'staffing' },
      })
      expect(amber[1].text).toBe('The Kitchen staff role has been open since Tue 12 May with no active applicants.')
      expect(metric(result, 'Open roles')).toEqual({ label: 'Open roles', value: '3', comparison: '2 with no active applicants' })
      expect(list(result, 'Open roles')).toEqual([
        'Bar staff: 1 active applicant, open since Tue 12 May.',
        'Cellar person: no active applicants.',
        'Kitchen staff: no active applicants, open since Tue 12 May; the closing date (Sun 26 Jul) has passed.',
      ])
    })

    it('merges more than two roles into one list action', async () => {
      const result = await build(db({
        postings: ['Bar staff', 'Kitchen staff', 'Cellar person'].map((title, index) => posting({ id: `post-${index}`, title })),
      }))
      expect(result.signals).toHaveLength(1)
      expect(result.signals[0]).toMatchObject({
        key: 'recruitment.roles_no_applicants',
        rag: 'amber',
        emailSafe: true,
        text: '3 open roles have no active applicants.',
        action: { text: 'Advertise or close 3 open roles with no active applicants', target: 'list' },
      })
    })
  })

  describe('new applications this week', () => {
    it('counts every application received this week except duplicates, against the 4-week average', async () => {
      const baseline = ['2026-08-21', '2026-08-25', '2026-08-30', '2026-09-02', '2026-09-06', '2026-09-10', '2026-09-14', '2026-09-17']
        .map((date) => application({ status: 'rejected', created_at: `${date}T10:00:00Z` }))
      const result = await build(db({
        applications: [
          ...baseline,
          application({ status: 'ai_screened', created_at: '2026-09-18T10:00:00Z' }),
          application({ status: 'rejected', created_at: '2026-09-24T10:00:00Z' }),
          application({ status: 'talent_pool', created_at: '2026-09-20T10:00:00Z', job_posting_id: null, is_general: true, job_posting: null }),
          // 23:30 UTC on 17 Sep is 18 Sep in London: this week.
          application({ status: 'withdrawn', created_at: '2026-09-17T23:30:00Z' }),
          // 23:30 UTC on 24 Sep is today in London: not this week.
          application({ status: 'new', created_at: '2026-09-24T23:30:00Z' }),
          // Duplicates are not new applications.
          application({ status: 'declined_duplicate', created_at: '2026-09-21T10:00:00Z', duplicate_of_application_id: 'x' }),
          application({ status: 'declined_duplicate', created_at: '2026-09-21T11:00:00Z' }),
          // Before the 4-week baseline.
          application({ status: 'rejected', created_at: '2026-08-20T10:00:00Z' }),
        ],
      }))
      expect(metric(result, 'New applications this week')).toEqual({
        label: 'New applications this week',
        value: '4',
        comparison: 'including 1 general application; in line with the 4-week average (2 a week)',
      })
      expect(result.headline.endsWith('4 new applications this week.')).toBe(true)
    })

    it('says new activity when the 4 weeks before had none', async () => {
      const result = await build(db({
        applications: Array.from({ length: 6 }, () => application({ status: 'rejected', created_at: '2026-09-21T10:00:00Z' })),
      }))
      expect(metric(result, 'New applications this week')?.comparison).toBe('new activity (none in the 4-week average)')
    })

    it('says not enough history before four weeks of applications exist', async () => {
      // Friday 26 June 2026: the 4-week baseline starts 22 May, before the first application.
      const result = await build(db({
        applications: [application({ status: 'ai_screened', created_at: '2026-06-22T10:00:00Z' })],
      }), new Date('2026-06-26T05:00:00Z'))
      expect(metric(result, 'New applications this week')).toEqual({
        label: 'New applications this week',
        value: '1',
        comparison: 'not enough history yet',
      })
      expect(result.notes).toEqual([
        'Applications start on 8 Jun 2026, so there is not enough history yet to compare new applications with the 4-week average.',
      ])
      expect(result.signals).toEqual([])
    })
  })

  it('lists interviews and trials in the next 7 London days in time order', async () => {
    const result = await build(db({
      applications: [
        application({ id: 'soon', status: 'interview_scheduled' }),
        application({ id: 'later', status: 'trial_scheduled' }),
        application({ id: 'edge', status: 'interview_scheduled' }),
        application({ id: 'beyond', status: 'interview_scheduled' }),
      ],
      appointments: [
        appointment('later', '2026-09-29T16:00:00Z', { type: 'trial_shift' }),
        appointment('soon', '2026-09-25T09:00:00Z'),
        // 22:30 UTC on 1 Oct is 23:30 on 1 Oct in London: inside.
        appointment('edge', '2026-10-01T22:30:00Z'),
        // 23:30 UTC on 1 Oct is 00:30 on 2 Oct in London: outside.
        appointment('beyond', '2026-10-01T23:30:00Z'),
      ],
    }))
    const items = list(result, 'Interviews and trials in the next 7 days')
    expect(items).toHaveLength(3)
    expect(items[0]).toMatch(/^Fri 25 Sep 10:00, interview: Firstname\d+x Surname\d+y \(Bar staff\)\.$/)
    expect(items[1]).toMatch(/^Tue 29 Sep 17:00, trial shift: /)
    expect(items[2]).toMatch(/^Thu 1 Oct 23:30, interview: /)
    expect(metric(result, 'Interviews and trials, next 7 days')).toEqual({ label: 'Interviews and trials, next 7 days', value: '3', comparison: 'first Fri 25 Sep' })
    expect(metric(result, 'Interview or trial booked')?.value).toBe('4')
    expect(result.signals).toEqual([])
  })

  it('never puts a candidate name in anything the email or a printed copy can show', async () => {
    const result = await build(db({
      postings: [posting(), posting({ id: 'post-empty', title: 'Kitchen staff' })],
      applications: [
        application({ id: 'd1', status: 'interviewed' }),
        application({ id: 'd2', status: 'interview_scheduled' }),
        application({ id: 'o1', status: 'interview_scheduled' }),
        application({ id: 'v1', created_at: '2026-09-01T10:00:00Z' }),
        application({ id: 'v2', created_at: '2026-09-02T10:00:00Z' }),
        application({ id: 'b1', status: 'interview_invited' }),
        application({ id: 'f1', status: 'offered' }),
        application({ id: 'h1', status: 'on_hold' }),
      ],
      appointments: [
        appointment('d1', '2026-09-01T09:00:00Z', { status: 'completed', outcome: 'Good' }),
        appointment('d2', '2026-09-05T09:00:00Z'),
        appointment('o1', '2026-09-23T09:00:00Z'),
        appointment('b1', '2026-09-28T09:00:00Z'),
      ],
    }))
    expect(result.signals.length).toBeGreaterThanOrEqual(6)
    expect(leakedNames(emailSafeText(result))).toEqual([])
    // Names do appear on the page: in lists and in page-only signal text.
    const pageOnly = result.signals.filter((signal) => !signal.emailSafe).map((signal) => signal.text).join('\n')
    expect(leakedNames(pageOnly).length).toBeGreaterThan(0)
    expect(leakedNames(result.lists.flatMap((item) => item.items.map((entry) => entry.text)).join('\n')).length).toBeGreaterThan(0)
    // Every signal naming a candidate is page only, and every action is email safe.
    for (const signal of result.signals) {
      if (leakedNames(signal.text).length > 0) expect(signal.emailSafe).toBe(false)
    }
    const everything = JSON.stringify(result)
    expect(everything).not.toMatch(/undefined|NaN|Invalid Date/)
    expect(everything).not.toMatch(new RegExp(String.fromCharCode(0x2014)))
    expect(everything).not.toContain('!')
    expect(result.lists.every((item) => item.items.every((entry) => entry.href === LIST_URL))).toBe(true)
  })

  it('reads each source once, and status changes only when a decision date needs them', async () => {
    const fake = db({
      applications: [application({ id: 'dec', status: 'interviewed' })],
    })
    await build(fake)
    const tables = fake.calls.map((call) => call.table).sort()
    expect(tables).toEqual([
      'recruitment_application_status_events',
      'recruitment_applications',
      'recruitment_applications',
      'recruitment_candidate_appointments',
      'recruitment_candidate_appointments',
      'recruitment_job_postings',
    ])
  })

  it('fails the section when a source cannot be read, rather than reporting zeros', async () => {
    await expect(build(db().fail('recruitment_applications'))).rejects.toThrow(/insights recruitment/)
    await expect(build(db().fail('recruitment_candidate_appointments'))).rejects.toThrow(/insights recruitment/)
  })
})
