import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmployeesSection as buildSection,
  employeesSection,
  readMatrixCompletion,
  type CourseCompletion,
} from '@/lib/insights/sections/employees'
import type { SectionContext } from '@/lib/insights/types'
import type { TrainingMatrix } from '@/lib/training/types'
import { TrainingService } from '@/services/training'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext's clock: Friday 25 September 2026, 06:00 London. Today is 2026-09-25.
type Row = Record<string, unknown>

interface PersonFixture {
  employee: Row
  /** undefined: a complete record with no expiry; null: no record. */
  rightToWork?: Row | null
  contact?: boolean
  /** undefined: full payroll details; null: no row. */
  payroll?: Row | null
  invites?: Row[]
}

let sequence = 0

/**
 * Completion counts come from the Training matrix (TrainingService.getMatrix), which reads with
 * its own client, so every build here is given them; nothing reaches a real database.
 */
function buildEmployeesSection(ctx: SectionContext, completion: CourseCompletion[] = []): Promise<SectionBuildResult> {
  return buildSection(ctx, async () => completion)
}

function employee(id: string, overrides: Row = {}): Row {
  return {
    employee_id: id,
    first_name: `Zelda${id}`,
    last_name: 'Quartermaine',
    preferred_name: null,
    status: 'Active',
    onboarding_completed_at: '2026-03-02T10:00:00Z',
    employment_start_date: '2026-03-01',
    employment_end_date: null,
    first_shift_date: null,
    ...overrides,
  }
}

function dbFor(people: PersonFixture[], extra: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {
    employees: [],
    employee_right_to_work: [],
    employee_emergency_contacts: [],
    employee_financial_details: [],
    employee_invite_tokens: [],
    ...extra,
  }
  for (const person of people) {
    const id = String(person.employee.employee_id)
    tables.employees.push(person.employee)
    if (person.rightToWork !== null) {
      tables.employee_right_to_work.push({
        employee_id: id,
        document_type: 'Passport',
        verification_date: '2026-03-01',
        document_expiry_date: null,
        follow_up_date: null,
        ...(person.rightToWork ?? {}),
      })
    }
    if (person.contact !== false) {
      sequence += 1
      tables.employee_emergency_contacts.push({ id: `ec-${sequence}`, employee_id: id, name: 'Contact Person', priority: 'Primary' })
    }
    if (person.payroll !== null) {
      tables.employee_financial_details.push({
        employee_id: id,
        ni_number: 'QQ123456C',
        bank_account_number: '12345678',
        bank_sort_code: '12-34-56',
        ...(person.payroll ?? {}),
      })
    }
    for (const invite of person.invites ?? []) {
      sequence += 1
      tables.employee_invite_tokens.push({ id: `inv-${sequence}`, employee_id: id, invite_type: 'onboarding', completed_at: null, ...invite })
    }
  }
  return new FakeDb(tables)
}

async function build(people: PersonFixture[]): Promise<SectionBuildResult> {
  return buildEmployeesSection(makeContext(dbFor(people)))
}

function signal(result: SectionBuildResult, rule: string): InsightSignal | undefined {
  return result.signals.find((s) => s.key === `employees.${rule}`)
}

function metric(result: SectionBuildResult, label: string): string | undefined {
  return result.metrics.find((m) => m.label === label)?.value
}

/** Everything that can reach the email or the printed copy. */
function emailText(result: SectionBuildResult): string {
  return JSON.stringify({
    headline: result.headline,
    metrics: result.metrics,
    notes: result.notes,
    signals: result.signals.filter((s) => s.emailSafe).map((s) => ({ text: s.text, action: s.action })),
    actions: result.signals.map((s) => s.action),
  })
}

describe('employees section', () => {
  it('is registered as the employees section on /employees', () => {
    expect(employeesSection).toMatchObject({ key: 'employees', title: 'Employees and compliance', path: '/employees' })
  })

  it('reports all clear when every current member of staff has what is needed', async () => {
    const result = await build([{ employee: employee('a') }, { employee: employee('b') }])
    expect(result.headline).toBe('No employee compliance issues need attention.')
    expect(result.signals).toEqual([])
    expect(result.lists).toEqual([])
    expect(metric(result, 'Current staff')).toBe('2')
    expect(metric(result, 'Staff with something missing')).toBe('0')
    expect(metric(result, 'No right-to-work record')).toBe('0')
    expect(result.notes).toContain('Not tracked in the app: licence expiry, contract documents.')
    expect(result.notes).toContain('Right-to-work documents without an expiry date are not checked for expiry.')
    // No period comparison exists here, so there is no "not enough history" state to show.
    expect(result.notes.join(' ')).not.toMatch(/history/i)
  })

  it('handles no current staff at all', async () => {
    const result = await buildEmployeesSection(makeContext(new FakeDb({ employees: [employee('gone', { status: 'Former' })] })))
    expect(result.headline).toBe('No current staff records to check.')
    expect(result.signals).toEqual([])
    expect(result.metrics).toEqual([{ label: 'Current staff', value: '0' }])
    expect(result.notes[0]).toBe('No employees are marked Active or Started Separation.')
  })

  it('raises one red count signal for staff with no right-to-work record, linked to the employee list', async () => {
    const result = await build([
      { employee: employee('a'), rightToWork: null },
      { employee: employee('b'), rightToWork: null },
      { employee: employee('c') },
    ])
    const found = signal(result, 'no_right_to_work')
    expect(found).toEqual({
      key: 'employees.no_right_to_work',
      rag: 'red',
      kind: 'issue',
      text: '2 staff have no right-to-work record.',
      emailSafe: true,
      action: {
        text: 'Record right-to-work checks for 2 staff',
        href: `${TEST_APP_URL}/employees`,
        target: 'list',
        impact: 'staffing',
      },
    })
    expect(found?.entity).toBeUndefined()
    expect(found?.action?.members).toBeUndefined()
    expect(result.headline).toBe('2 staff have no right-to-work record.')
    expect(metric(result, 'No right-to-work record')).toBe('2')
  })

  it('uses the singular for one member of staff', async () => {
    const result = await build([{ employee: employee('a'), rightToWork: null, contact: false }])
    expect(signal(result, 'no_right_to_work')?.text).toBe('1 member of staff has no right-to-work record.')
    expect(signal(result, 'no_emergency_contact')?.action?.text).toBe('Add an emergency contact for 1 member of staff')
    expect(result.headline).toBe('1 member of staff has something missing, including 1 with no right-to-work record.')
  })

  it('flags expired right to work red with the expiry as the due date', async () => {
    const result = await build([
      { employee: employee('a'), rightToWork: { document_expiry_date: '2026-09-10' } },
      { employee: employee('b'), rightToWork: { document_expiry_date: '2026-09-01' } },
    ])
    const found = signal(result, 'right_to_work_expired')
    expect(found?.rag).toBe('red')
    expect(found?.text).toBe('2 right-to-work documents have expired, the earliest on Tue 1 Sep.')
    expect(found?.action).toMatchObject({ text: 'Recheck right to work for 2 staff whose documents have expired', dueDate: '2026-09-01', target: 'list' })
  })

  it('flags right to work expiring within 30 days red and within 60 days amber, at the exact boundaries', async () => {
    const result = await build([
      { employee: employee('today'), rightToWork: { document_expiry_date: '2026-09-25' } },
      { employee: employee('day30'), rightToWork: { document_expiry_date: '2026-10-25' } },
      { employee: employee('day31'), rightToWork: { document_expiry_date: '2026-10-26' } },
      { employee: employee('day60'), rightToWork: { document_expiry_date: '2026-11-24' } },
      { employee: employee('day61'), rightToWork: { document_expiry_date: '2026-11-25' } },
      { employee: employee('none'), rightToWork: { document_expiry_date: null } },
    ])
    const soon = signal(result, 'right_to_work_expiring_soon')
    expect(soon?.rag).toBe('red')
    expect(soon?.text).toBe('2 right-to-work documents expire within 30 days, the first on Fri 25 Sep.')
    expect(soon?.action).toMatchObject({ text: 'Recheck right to work for 2 staff before Fri 25 Sep', dueDate: '2026-09-25' })
    const later = signal(result, 'right_to_work_expiring')
    expect(later?.rag).toBe('amber')
    expect(later?.text).toBe('2 right-to-work documents expire within 60 days, the first on Mon 26 Oct.')
    expect(later?.action).toMatchObject({ text: 'Plan right-to-work rechecks for 2 staff, the first before Mon 26 Oct', dueDate: '2026-10-26' })
    expect(signal(result, 'right_to_work_expired')).toBeUndefined()
    expect(metric(result, 'Right to work expired or expiring within 60 days')).toBe('4')
    expect(result.metrics.find((m) => m.label.startsWith('Right to work expired'))?.comparison).toBe('earliest Fri 25 Sep')
  })

  it('uses the singular wording for one expiring document', async () => {
    const result = await build([{ employee: employee('a'), rightToWork: { document_expiry_date: '2026-11-10' } }])
    expect(signal(result, 'right_to_work_expiring')?.text).toBe('1 right-to-work document expires within 60 days, on Tue 10 Nov.')
    expect(signal(result, 'right_to_work_expiring')?.action?.text).toBe('Plan a right-to-work recheck for 1 member of staff before Tue 10 Nov')
  })

  it('prints the year for a date outside the current year', async () => {
    const result = await build([{ employee: employee('a'), rightToWork: { document_expiry_date: '2025-12-01' } }])
    expect(signal(result, 'right_to_work_expired')?.text).toBe('1 right-to-work document expired on 1 Dec 2025.')
  })

  it('does not flag expiry for someone who leaves before their document expires', async () => {
    const result = await build([
      {
        employee: employee('leaving', { status: 'Started Separation', employment_end_date: '2026-10-02' }),
        rightToWork: { document_expiry_date: '2026-10-10' },
      },
      {
        employee: employee('staying', { status: 'Started Separation', employment_end_date: '2026-10-20' }),
        rightToWork: { document_expiry_date: '2026-10-10' },
      },
    ])
    expect(signal(result, 'right_to_work_expiring_soon')?.text).toBe('1 right-to-work document expires within 30 days, on Sat 10 Oct.')
  })

  it('flags a reached follow-up date amber, and not one still to come', async () => {
    const result = await build([
      { employee: employee('a'), rightToWork: { follow_up_date: '2026-09-25' } },
      { employee: employee('b'), rightToWork: { follow_up_date: '2026-09-26' } },
    ])
    const found = signal(result, 'right_to_work_follow_up')
    expect(found?.rag).toBe('amber')
    expect(found?.text).toBe('1 right-to-work follow-up date has been reached (Fri 25 Sep).')
    expect(found?.action).toMatchObject({ text: 'Complete 1 right-to-work follow-up', dueDate: '2026-09-25' })
    expect(metric(result, 'Right-to-work follow-ups due')).toBe('1')
  })

  it('flags onboarding unfinished more than 14 days after the start date, using the first shift when no start date is set', async () => {
    const result = await build([
      { employee: employee('late', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: '2026-09-10' }) },
      { employee: employee('ontime', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: '2026-09-11' }) },
      { employee: employee('shift', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: null, first_shift_date: '2026-08-01' }) },
      { employee: employee('done', { employment_start_date: '2026-01-01' }) },
    ])
    const found = signal(result, 'onboarding_incomplete')
    expect(found?.rag).toBe('amber')
    expect(found?.text).toBe('2 new starters have not finished onboarding more than 14 days after starting.')
    expect(found?.action).toMatchObject({ text: 'Get onboarding finished for 2 new starters', href: `${TEST_APP_URL}/employees`, target: 'list' })
    expect(found?.action?.dueDate).toBeUndefined()
    expect(metric(result, 'Onboarding unfinished after 14 days')).toBe('2')
  })

  it('notes unfinished onboarding it cannot judge because there is no start date', async () => {
    const result = await build([{ employee: employee('a', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: null, first_shift_date: null }) }])
    expect(signal(result, 'onboarding_incomplete')).toBeUndefined()
    expect(result.notes).toContain('1 new starter has no start date, so late onboarding cannot be judged.')
  })

  it('never raises the onboarding checks on Active or leaving staff, where the app cannot resend or finish onboarding', async () => {
    // Live shape on 18 Sep 2026: Active since 2019, onboarding never finished, last invite expired in March.
    const stale = { onboarding_completed_at: null, employment_start_date: '2019-03-05' }
    const expiredInvite = [{ created_at: '2026-03-01T13:12:41Z', expires_at: '2026-03-08T13:12:41Z' }]
    const db = dbFor([
      { employee: employee('active', stale), rightToWork: null, contact: false, payroll: null, invites: expiredInvite },
      { employee: employee('notice', { ...stale, status: 'Started Separation', employment_end_date: '2026-10-09' }), invites: expiredInvite },
    ])
    const result = await buildEmployeesSection(makeContext(db))
    expect(signal(result, 'onboarding_incomplete')).toBeUndefined()
    expect(signal(result, 'invite_expired')).toBeUndefined()
    expect(result.signals.map((s) => s.key)).toEqual([
      'employees.no_right_to_work',
      'employees.no_emergency_contact',
      'employees.no_payroll_details',
    ])
    expect(result.signals.map((s) => s.action?.text).join(' ')).not.toMatch(/onboarding|invite/i)
    expect(metric(result, 'Onboarding unfinished after 14 days')).toBe('0')
    expect(metric(result, 'Onboarding invites expired unused')).toBe('0')
    expect(result.lists[0].items).toEqual([{
      text: 'Zeldaactive Quartermaine: no right-to-work record, no emergency contact and no payroll details',
      href: `${TEST_APP_URL}/employees/active`,
      rag: 'red',
    }])
    expect(result.notes.join(' ')).not.toMatch(/start date/)
    // Nobody can still finish onboarding, so the invites are never read.
    expect(db.calls.map((call) => call.table)).not.toContain('employee_invite_tokens')
  })

  it('flags the latest onboarding invite when it expired unused', async () => {
    const unfinished = { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: '2026-09-20' }
    const result = await build([
      // Expired 00:30 London on 25 Sep (23:30 UTC on the 24th), before the 06:00 run.
      { employee: employee('expired', unfinished), invites: [{ created_at: '2026-09-17T23:30:00Z', expires_at: '2026-09-24T23:30:00Z' }] },
      {
        employee: employee('resent', unfinished),
        invites: [
          { created_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-08T10:00:00Z' },
          { created_at: '2026-09-20T10:00:00Z', expires_at: '2026-09-27T10:00:00Z' },
        ],
      },
      { employee: employee('used', unfinished), invites: [{ created_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-08T10:00:00Z', completed_at: '2026-09-02T10:00:00Z' }] },
      { employee: employee('onboarded'), invites: [{ created_at: '2026-02-01T10:00:00Z', expires_at: '2026-02-08T10:00:00Z' }] },
      { employee: employee('portal', unfinished), invites: [{ invite_type: 'portal_access', created_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-08T10:00:00Z' }] },
    ])
    const found = signal(result, 'invite_expired')
    expect(found?.rag).toBe('amber')
    expect(found?.text).toBe('1 onboarding invite expired without being used.')
    expect(found?.action?.text).toBe('Resend 1 expired onboarding invite')
    const line = result.lists[0].items.find((item) => item.href?.endsWith('/employees/expired'))
    expect(line?.text).toContain('onboarding invite expired Fri 25 Sep')
  })

  it('does not flag an invite that expires later today', async () => {
    const result = await build([
      { employee: employee('a', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: '2026-09-20' }), invites: [{ created_at: '2026-09-18T10:00:00Z', expires_at: '2026-09-25T10:00:00Z' }] },
    ])
    expect(signal(result, 'invite_expired')).toBeUndefined()
  })

  it('flags missing emergency contacts and payroll details; an empty payroll row counts as none, a partial one does not', async () => {
    const result = await build([
      { employee: employee('nocontact'), contact: false },
      { employee: employee('norow'), payroll: null },
      { employee: employee('emptyrow'), payroll: { ni_number: null, bank_account_number: null, bank_sort_code: null } },
      { employee: employee('nionly'), payroll: { bank_account_number: null, bank_sort_code: null } },
    ])
    expect(signal(result, 'no_emergency_contact')).toMatchObject({ rag: 'amber', text: '1 member of staff has no emergency contact.' })
    expect(signal(result, 'no_payroll_details')).toMatchObject({ rag: 'amber', text: '2 staff have no payroll details.' })
    expect(signal(result, 'no_payroll_details')?.action?.text).toBe('Add payroll details for 2 staff')
    expect(metric(result, 'No payroll details')).toBe('2')
    expect(metric(result, 'No emergency contact')).toBe('1')
  })

  it('checks staff working their notice and ignores former staff', async () => {
    const result = await build([
      { employee: employee('notice', { status: 'Started Separation' }), rightToWork: null },
      { employee: employee('former', { status: 'Former' }), rightToWork: null, contact: false, payroll: null },
    ])
    expect(signal(result, 'no_right_to_work')?.text).toBe('1 member of staff has no right-to-work record.')
    expect(signal(result, 'no_emergency_contact')).toBeUndefined()
    expect(result.metrics[0]).toEqual({ label: 'Current staff', value: '1', comparison: 'including 1 working their notice' })
  })

  it('leaves out a leaver whose last day has passed, and still checks one whose last day is today', async () => {
    const result = await build([
      // Left on Thursday: the separation cron finalises them after this 06:00 run.
      { employee: employee('left', { status: 'Started Separation', employment_end_date: '2026-09-24' }), rightToWork: null, contact: false, payroll: null },
      { employee: employee('lastday', { status: 'Started Separation', employment_end_date: '2026-09-25' }), rightToWork: null },
      { employee: employee('a') },
    ])
    expect(signal(result, 'no_right_to_work')?.text).toBe('1 member of staff has no right-to-work record.')
    expect(signal(result, 'no_emergency_contact')).toBeUndefined()
    expect(signal(result, 'no_payroll_details')).toBeUndefined()
    expect(result.metrics[0]).toEqual({ label: 'Current staff', value: '2', comparison: 'including 1 working their notice' })
    expect(result.lists[0].items.map((item) => item.href)).toEqual([`${TEST_APP_URL}/employees/lastday`])
    expect(result.notes).toContain('1 leaver whose last day has passed is left out until their leaving is finalised.')
  })

  it('reports no current staff when the only person working their notice has already left', async () => {
    const db = dbFor([
      { employee: employee('left', { status: 'Started Separation', employment_end_date: '2026-09-24' }), rightToWork: null, contact: false, payroll: null },
    ])
    const result = await buildEmployeesSection(makeContext(db))
    expect(result.headline).toBe('No current staff records to check.')
    expect(result.signals).toEqual([])
    expect(result.metrics).toEqual([{ label: 'Current staff', value: '0' }])
    expect(result.notes[0]).toBe('1 leaver whose last day has passed is left out until their leaving is finalised.')
    expect(db.calls.map((call) => call.table)).toEqual(['employees'])
  })

  it('checks new starters for onboarding only and does not count them as current staff', async () => {
    const starter = employee('new', { status: 'Onboarding', first_name: null, last_name: null, onboarding_completed_at: null, employment_start_date: '2026-09-01' })
    const result = await build([
      { employee: employee('a') },
      { employee: starter, rightToWork: null, contact: false, payroll: null, invites: [{ created_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-08T10:00:00Z' }] },
    ])
    expect(result.signals.map((s) => s.key)).toEqual(['employees.onboarding_incomplete', 'employees.invite_expired'])
    expect(result.metrics[0]).toEqual({ label: 'Current staff', value: '1', comparison: 'plus 1 new starter onboarding' })
    expect(result.lists[0].items).toEqual([{
      text: 'Name not entered yet (new starter): onboarding not finished (started Tue 1 Sep) and onboarding invite expired Tue 8 Sep',
      href: `${TEST_APP_URL}/employees/new`,
      rag: 'amber',
    }])
  })

  it('orders signals by the precedence table and names the first check in the headline', async () => {
    const result = await build([
      { employee: employee('a', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: '2026-08-01' }), invites: [{ created_at: '2026-08-01T10:00:00Z', expires_at: '2026-08-08T10:00:00Z' }] },
      { employee: employee('b'), rightToWork: { document_expiry_date: '2026-11-01', follow_up_date: '2026-09-01' } },
      { employee: employee('c'), rightToWork: { document_expiry_date: '2026-10-01' } },
      { employee: employee('d'), rightToWork: { document_expiry_date: '2026-09-01' } },
      { employee: employee('e'), rightToWork: null },
      { employee: employee('f'), payroll: null, contact: false },
    ])
    expect(result.signals.map((s) => s.key)).toEqual([
      'employees.no_right_to_work',
      'employees.right_to_work_expired',
      'employees.right_to_work_expiring_soon',
      'employees.right_to_work_expiring',
      'employees.right_to_work_follow_up',
      'employees.onboarding_incomplete',
      'employees.invite_expired',
      'employees.no_emergency_contact',
      'employees.no_payroll_details',
    ])
    expect(result.signals.map((s) => s.rag)).toEqual(['red', 'red', 'red', 'amber', 'amber', 'amber', 'amber', 'amber', 'amber'])
    expect(result.headline).toBe('6 staff have something missing, including 1 with no right-to-work record.')
    expect(metric(result, 'Staff with something missing')).toBe('6')
    // The email shows the first four figures.
    expect(result.metrics.slice(0, 4).map((m) => m.label)).toEqual([
      'Current staff',
      'Staff with something missing',
      'No right-to-work record',
      'Right to work expired or expiring within 60 days',
    ])
  })

  it('keeps names on the page list only, one line per person, worst first', async () => {
    const result = await build([
      { employee: employee('amber1', { first_name: 'Bartholomew', last_name: 'Fenwick' }), contact: false },
      { employee: employee('red1', { first_name: 'Anastasia', last_name: 'Willoughby', preferred_name: 'Stacy' }), rightToWork: null, payroll: null },
      { employee: employee('fine', { first_name: 'Cornelius', last_name: 'Ashdown' }) },
    ])
    for (const name of ['Bartholomew', 'Fenwick', 'Anastasia', 'Willoughby', 'Stacy', 'Cornelius', 'Ashdown', 'Zelda', 'Quartermaine']) {
      expect(emailText(result)).not.toContain(name)
    }
    expect(result.signals.every((s) => s.emailSafe)).toBe(true)
    expect(result.lists).toHaveLength(1)
    expect(result.lists[0].title).toBe('Staff with something missing')
    expect(result.lists[0].items).toEqual([
      { text: 'Stacy (Anastasia Willoughby): no right-to-work record and no payroll details', href: `${TEST_APP_URL}/employees/red1`, rag: 'red' },
      { text: 'Bartholomew Fenwick: no emergency contact', href: `${TEST_APP_URL}/employees/amber1`, rag: 'amber' },
    ])
  })

  it('never prints undefined, NaN or Invalid Date', async () => {
    const result = await build([
      { employee: employee('a', { onboarding_completed_at: null, employment_start_date: null }), rightToWork: null, contact: false, payroll: null },
      { employee: employee('s', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: null }), invites: [{ created_at: '2026-09-01T10:00:00Z', expires_at: '2026-09-08T10:00:00Z' }] },
      { employee: employee('l', { status: 'Started Separation', employment_end_date: '2026-09-01' }) },
      { employee: employee('b'), rightToWork: { document_expiry_date: '2026-10-01', follow_up_date: '2026-09-20' } },
    ])
    const everything = JSON.stringify(result)
    expect(everything).not.toMatch(/undefined|NaN|Invalid Date/)
  })

  it('reads only through the context database and fails loudly when a read fails', async () => {
    const db = dbFor([{ employee: employee('a') }]).fail('employee_right_to_work')
    await expect(buildEmployeesSection(makeContext(db))).rejects.toThrow(/insights right to work failed/)
  })

  it('never asks for more than the nine tables it needs', async () => {
    const db = dbFor([
      { employee: employee('a') },
      { employee: employee('new', { status: 'Onboarding', onboarding_completed_at: null, employment_start_date: '2026-09-01' }) },
    ])
    await buildEmployeesSection(makeContext(db))
    expect(new Set(db.calls.map((call) => call.table))).toEqual(new Set([
      'employees',
      'employee_right_to_work',
      'employee_emergency_contacts',
      'employee_financial_details',
      'employee_invite_tokens',
      'training_courses',
      'training_assignments',
      'training_profiles',
      'training_reminders',
    ]))
    expect(db.calls.every((call) => call.kind === 'select')).toBe(true)
  })

  it('skips the invite read when everyone has finished onboarding', async () => {
    const db = dbFor([{ employee: employee('a') }])
    await buildEmployeesSection(makeContext(db))
    expect(db.calls.map((call) => call.table)).not.toContain('employee_invite_tokens')
  })
})

// Staff training checks (staff training spec 8.3). Today is Friday 25 September 2026.
describe('employees section: staff training', () => {
  const COURSES: Row[] = [
    { id: 'ess', title: 'Essentials', kind: 'online', is_essentials: true, status: 'live', display_order: 1 },
    { id: 'food', title: 'Food Safety', kind: 'online', is_essentials: false, status: 'live', display_order: 2 },
    { id: 'ext', title: 'Personal Licence', kind: 'external', is_essentials: false, status: 'live', display_order: 3 },
    { id: 'old', title: 'Retired Course', kind: 'online', is_essentials: false, status: 'retired', display_order: 4 },
  ]
  let cycleSequence = 0

  function cycle(employeeId: string, courseId: string, overrides: Row = {}): Row {
    cycleSequence += 1
    return {
      id: `tc-${cycleSequence}`,
      employee_id: employeeId,
      course_id: courseId,
      cycle: 1,
      status: 'assigned',
      due_on: '2026-10-09',
      completed_on: null,
      expires_on: null,
      ...overrides,
    }
  }

  /** People with a portal login, so only the check under test fires. */
  function withLogin(id: string, overrides: Row = {}): PersonFixture {
    return { employee: employee(id, { auth_user_id: `user-${id}`, ...overrides }) }
  }

  function completionOf(id: string, title: string, requiredCount: number, completedCount: number): CourseCompletion {
    return { id, title, requiredCount, completedCount }
  }

  async function buildTraining(
    people: PersonFixture[],
    training: { assignments?: Row[]; profiles?: Row[]; reminders?: Row[]; completion?: CourseCompletion[] } = {},
  ): Promise<{ result: SectionBuildResult; db: FakeDb; readCompletion: ReturnType<typeof vi.fn> }> {
    const db = dbFor(people, {
      training_courses: COURSES,
      training_assignments: training.assignments ?? [],
      training_profiles: training.profiles ?? [],
      training_reminders: training.reminders ?? [],
    })
    const readCompletion = vi.fn(async (_today: string) => training.completion ?? [])
    return { result: await buildSection(makeContext(db), readCompletion), db, readCompletion }
  }

  it('reports nothing when training is on track, and shows completion unrated', async () => {
    const { result, readCompletion } = await buildTraining([withLogin('a'), withLogin('b')], {
      assignments: [
        cycle('a', 'food', { status: 'completed', due_on: '2026-09-01', completed_on: '2026-09-01' }),
        cycle('b', 'food', { status: 'in_progress' }),
      ],
      completion: [completionOf('ess', 'Essentials', 0, 0), completionOf('food', 'Food Safety', 2, 1)],
    })
    expect(readCompletion).toHaveBeenCalledWith('2026-09-25')
    expect(result.signals).toEqual([])
    expect(metric(result, 'Training items overdue')).toBe('0')
    expect(metric(result, 'Training completion')).toBe('50%')
    // A course nobody is required for is not listed.
    expect(result.lists).toEqual([{
      title: 'Training completion by course',
      items: [{ text: 'Food Safety: 1 of 2 done (50%)', href: `${TEST_APP_URL}/employees/training` }],
    }])
  })

  // SIG-3: the insights page and the Training matrix counted different people for the same course.
  describe('completion matches the Training matrix', () => {
    // Today 25 September. Six people have a Kegs cycle; p1 to p3 are in Bar with a valid
    // completion. 'expired' and 'kitchen' completed it in Bar and were then moved to Kitchen only:
    // the course no longer applies and nothing is open, so the matrix leaves both out, whether
    // the completion has expired ('expired', on 1 September) or not ('kitchen'). 'waived' had it
    // waived and is still in Bar, so the matrix counts them as required and not done: 3 of 4.
    // Reading the cycles alone gave 4 of 5 (80%): both movers counted, the waiver dropped.
    const KEGS: Row = { id: 'kegs', title: 'Kegs', kind: 'practical', is_essentials: false, status: 'live' }
    const people = () => ['p1', 'p2', 'p3', 'expired', 'kitchen', 'waived'].map((id) => withLogin(id))
    const cycles = () => [
      ...['p1', 'p2', 'p3', 'kitchen'].map((id) => cycle(id, 'kegs', { status: 'completed', completed_on: '2026-06-01', expires_on: '2027-06-01' })),
      cycle('expired', 'kegs', { status: 'completed', completed_on: '2025-09-01', expires_on: '2026-09-01' }),
      cycle('waived', 'kegs', { status: 'waived', due_on: null }),
    ]
    const matrix = (): TrainingMatrix => ({
      today: '2026-09-25',
      courses: [
        { id: 'kegs', slug: 'kegs', title: 'Kegs', kind: 'practical', isEssentials: false, displayOrder: 1, requiredCount: 4, completedCount: 3, completionRate: 0.75 },
        { id: 'food', slug: 'food', title: 'Food Safety', kind: 'online', isEssentials: false, displayOrder: 2, requiredCount: 0, completedCount: 0, completionRate: null },
      ],
      people: [],
    })

    afterEach(() => vi.restoreAllMocks())

    it('reads the counts from TrainingService.getMatrix for the report date', async () => {
      const getMatrix = vi.spyOn(TrainingService, 'getMatrix').mockResolvedValue(matrix())
      const counts = await readMatrixCompletion('2026-09-25')
      expect(getMatrix).toHaveBeenCalledWith({ today: '2026-09-25' })
      expect(counts.map(({ id, requiredCount, completedCount }) => ({ id, requiredCount, completedCount }))).toEqual([
        { id: 'kegs', requiredCount: 4, completedCount: 3 },
        { id: 'food', requiredCount: 0, completedCount: 0 },
      ])
    })

    it('shows the matrix figures for a moved group, an expired completion and a waiver, per course and in total', async () => {
      vi.spyOn(TrainingService, 'getMatrix').mockResolvedValue(matrix())
      const db = dbFor(people(), {
        training_courses: [...COURSES, KEGS],
        training_assignments: cycles(),
        training_profiles: [],
        training_reminders: [],
      })
      // The section as registered: no reader passed, so the matrix read is the one used.
      const result = await employeesSection.build(makeContext(db))
      const shown = matrix().courses[0]

      expect(result.lists.find((list) => list.title === 'Training completion by course')?.items).toEqual([
        { text: `Kegs: ${shown.completedCount} of ${shown.requiredCount} done (75%)`, href: `${TEST_APP_URL}/employees/training` },
      ])
      expect(metric(result, 'Training completion')).toBe('75%')
      expect(result.metrics.find((m) => m.label === 'Training completion')?.comparison).toBe('3 of 4 required courses done')
    })

    it('fails loudly when the matrix cannot be read, as for any other read', async () => {
      vi.spyOn(TrainingService, 'getMatrix').mockRejectedValue(new Error('training: rota failed'))
      const db = dbFor(people(), { training_courses: COURSES, training_assignments: [], training_profiles: [], training_reminders: [] })
      await expect(employeesSection.build(makeContext(db))).rejects.toThrow(/training: rota failed/)
    })
  })

  it('rates essentials overdue red from the day after it was due, linked to the training page', async () => {
    const { result } = await buildTraining([withLogin('a')], {
      assignments: [cycle('a', 'ess', { due_on: '2026-09-24' })],
    })
    const found = signal(result, 'training_essentials_overdue')
    expect(found?.rag).toBe('red')
    expect(found?.text).toBe('1 essentials training item is overdue, due Thu 24 Sep.')
    expect(found?.action).toMatchObject({ href: `${TEST_APP_URL}/employees/training`, dueDate: '2026-09-24' })
    expect(metric(result, 'Training items overdue')).toBe('1')
    expect(result.metrics.find((m) => m.label === 'Training items overdue')?.comparison).toBe('including 1 essentials')
    expect(result.lists[0].items[0]).toMatchObject({ text: expect.stringContaining('Essentials overdue (due Thu 24 Sep)'), rag: 'red' })
  })

  it('rates other training red at 7 days overdue and leaves 6 days unrated, though counted', async () => {
    const sevenDays = await buildTraining([withLogin('a')], { assignments: [cycle('a', 'food', { due_on: '2026-09-18' })] })
    expect(signal(sevenDays.result, 'training_overdue')?.rag).toBe('red')
    expect(sevenDays.result.lists[0].items[0].text).toContain('Food Safety 7 days overdue')

    const sixDays = await buildTraining([withLogin('a')], { assignments: [cycle('a', 'food', { due_on: '2026-09-19' })] })
    expect(sixDays.result.signals).toEqual([])
    expect(metric(sixDays.result, 'Training items overdue')).toBe('1')
  })

  it('rates a locked course and a declined confirmation red', async () => {
    const { result } = await buildTraining([withLogin('a')], {
      assignments: [cycle('a', 'food', { status: 'locked' }), cycle('a', 'ess', { status: 'declined' })],
    })
    expect(signal(result, 'training_locked')?.rag).toBe('red')
    expect(signal(result, 'training_declined')?.rag).toBe('red')
  })

  it('rates open online training that cannot reach the person red: no login, or emails not delivered', async () => {
    const { result } = await buildTraining(
      [{ employee: employee('nologin', { auth_user_id: null }) }, withLogin('bounced'), withLogin('fine')],
      {
        assignments: [cycle('nologin', 'food'), cycle('bounced', 'food'), cycle('fine', 'food')],
        reminders: [{ id: 'r1', employee_id: 'bounced', kind: 'undeliverable' }],
      },
    )
    const found = signal(result, 'training_unreachable')
    expect(found?.rag).toBe('red')
    expect(found?.text).toBe('2 staff with training to do cannot be reached: no portal login, or training emails not delivered.')
    const lines = result.lists[0].items.map((item) => item.text).join('\n')
    expect(lines).toContain('no portal login for training')
    expect(lines).toContain('training emails not delivered')
  })

  it('does not call someone unreachable when they have no online training open', async () => {
    const { result } = await buildTraining([{ employee: employee('a', { auth_user_id: null }) }], {
      assignments: [cycle('a', 'food', { status: 'completed', completed_on: '2026-09-01' })],
    })
    expect(signal(result, 'training_unreachable')).toBeUndefined()
  })

  it('rates external certificates: expired red, within 30 days red, within 60 days amber, beyond that nothing', async () => {
    const done = { status: 'completed', completed_on: '2025-01-01' }
    const { result } = await buildTraining([withLogin('x'), withLogin('s'), withLogin('l'), withLogin('f')], {
      assignments: [
        cycle('x', 'ext', { ...done, expires_on: '2026-09-20' }),
        cycle('s', 'ext', { ...done, expires_on: '2026-10-25' }),
        cycle('l', 'ext', { ...done, expires_on: '2026-11-24' }),
        cycle('f', 'ext', { ...done, expires_on: '2026-11-25' }),
      ],
    })
    expect(signal(result, 'training_external_expired')?.rag).toBe('red')
    expect(signal(result, 'training_external_expiring_soon')?.rag).toBe('red')
    expect(signal(result, 'training_external_expiring')?.rag).toBe('amber')
    expect(result.lists[0].items.map((item) => item.href)).toEqual([
      `${TEST_APP_URL}/employees/s`,
      `${TEST_APP_URL}/employees/x`,
      `${TEST_APP_URL}/employees/l`,
    ])
  })

  it('judges an external certificate by the latest one held', async () => {
    const { result } = await buildTraining([withLogin('a')], {
      assignments: [
        cycle('a', 'ext', { cycle: 1, status: 'completed', completed_on: '2023-01-01', expires_on: '2026-01-01' }),
        cycle('a', 'ext', { cycle: 2, status: 'completed', completed_on: '2026-01-01', expires_on: '2029-01-01' }),
      ],
    })
    expect(result.signals).toEqual([])
  })

  it('leaves paused people out of overdue checks, and shows no completion when nobody is required', async () => {
    // The matrix leaves paused people out of its count, so with only them it requires nobody.
    const { result } = await buildTraining([withLogin('a')], {
      assignments: [cycle('a', 'ess', { due_on: '2026-09-01' })],
      profiles: [{ employee_id: 'a', paused_from: '2026-09-10', paused_until: null }],
      completion: [completionOf('ess', 'Essentials', 0, 0)],
    })
    expect(result.signals).toEqual([])
    expect(metric(result, 'Training items overdue')).toBe('0')
    expect(metric(result, 'Training completion')).toBeUndefined()
    expect(result.lists).toEqual([])
  })

  it('counts a pause that has ended', async () => {
    const { result } = await buildTraining([withLogin('a')], {
      assignments: [cycle('a', 'ess', { due_on: '2026-09-01' })],
      profiles: [{ employee_id: 'a', paused_from: '2026-08-01', paused_until: '2026-08-31' }],
    })
    expect(signal(result, 'training_essentials_overdue')?.rag).toBe('red')
  })

  it('ignores a retired course', async () => {
    const { result } = await buildTraining([withLogin('a')], {
      assignments: [cycle('a', 'old', { due_on: '2026-08-01' })],
    })
    expect(result.signals).toEqual([])
    expect(result.lists).toEqual([])
  })

  it('keeps names and course titles out of the email, and prints no undefined, NaN or Invalid Date', async () => {
    const { result } = await buildTraining(
      [
        { employee: employee('a', { first_name: 'Philippa', last_name: 'Thistlewood', auth_user_id: null }) },
        withLogin('b', { first_name: 'Rupert', last_name: 'Kettleby' }),
      ],
      {
        assignments: [
          cycle('a', 'ess', { due_on: '2026-09-01' }),
          cycle('b', 'food', { status: 'locked', due_on: null }),
          cycle('b', 'ext', { status: 'completed', completed_on: '2025-01-01', expires_on: '2026-09-30' }),
        ],
      },
    )
    for (const word of ['Philippa', 'Thistlewood', 'Rupert', 'Kettleby']) {
      expect(emailText(result)).not.toContain(word)
    }
    expect(result.signals.every((s) => s.emailSafe)).toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/undefined|NaN|Invalid Date/)
  })

  it('reads training only for current staff, and fails loudly when a training read fails', async () => {
    const db = dbFor([withLogin('a')], { training_courses: COURSES }).fail('training_assignments')
    await expect(buildEmployeesSection(makeContext(db))).rejects.toThrow(/insights training assignments failed/)
  })
})
