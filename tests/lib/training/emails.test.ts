import { describe, expect, it } from 'vitest'
import {
  MANAGER_CONTACT_LINE,
  PAID_TIME_LINE,
  STAFF_CONTACT_LINE,
  buildManagerTrainingEmail,
  buildStaffReminderEmail,
  describeStaffStep,
  formatTrainingEmailDate,
  type TrainingEmail,
} from '@/lib/training/emails'
import type { ManagerDailyItem, PlannedReminderStep } from '@/lib/training/reminders'
import type { StaffReminderStep } from '@/lib/training/types'

/**
 * Every training email rendered with fixture data (workspace rule: no `undefined`, `Invalid Date`,
 * `NaN` or long dashes reach a person). `npm test` runs this in Europe/London and
 * `npm run test:utc` in UTC; the dates must read the same in both.
 */

const LONG_DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)

function assertClean(email: TrainingEmail): void {
  for (const part of [email.subject, email.text, email.html]) {
    expect(part).not.toMatch(/undefined|Invalid Date|NaN|\bnull\b|\[object Object\]/)
    expect(part).not.toContain(LONG_DASH)
    expect(part).not.toContain(EN_DASH)
  }
  expect(email.subject.length).toBeGreaterThan(0)
}

function step(kind: StaffReminderStep, overrides: Partial<PlannedReminderStep> = {}): PlannedReminderStep {
  return {
    assignmentId: `a-${kind}`,
    courseId: 'c1',
    courseTitle: 'Food Safety & Hygiene',
    step: kind,
    claimKey: `step:a-${kind}:${kind}:2026-11-16`,
    alsoClaims: [],
    dueOn: '2026-11-16',
    daysOverdue: null,
    progress: { sectionsPassed: 0, sectionsTotal: 3, currentSectionTitle: null },
    ...overrides,
  }
}

const PORTAL = 'https://management.example/portal/training'

describe('formatTrainingEmailDate', () => {
  it('reads the same calendar date whatever the zone', () => {
    expect(formatTrainingEmailDate('2026-11-03', '2026-11-02')).toBe('Tuesday 3 November')
    expect(formatTrainingEmailDate('2026-03-29', '2026-03-28')).toBe('Sunday 29 March')
    expect(formatTrainingEmailDate('2026-10-25', '2026-10-24')).toBe('Sunday 25 October')
  })

  it('adds the year when it is not this year', () => {
    expect(formatTrainingEmailDate('2027-01-04', '2026-12-30')).toBe('Monday 4 January 2027')
  })
})

describe('buildStaffReminderEmail', () => {
  const today = '2026-11-02'

  it.each([
    ['assigned', 'New training for you'],
    ['nudge', 'Reminder: your training'],
    ['due_soon', 'Your training is due soon'],
    ['overdue', 'Your training is overdue'],
    ['weekly', 'Your training is still not done'],
  ] as const)('renders the %s step cleanly', (kind, subject) => {
    const overdue = kind === 'overdue' || kind === 'weekly'
    const email = buildStaffReminderEmail({
      name: 'Sam Taylor',
      today,
      steps: [step(kind, overdue ? { dueOn: '2026-10-26', daysOverdue: 7 } : {})],
      portalUrl: PORTAL,
    })
    assertClean(email)
    expect(email.subject).toBe(subject)
    expect(email.text).toContain('Hi Sam,')
    expect(email.text).toContain(PAID_TIME_LINE)
    expect(email.text).toContain(STAFF_CONTACT_LINE)
    expect(email.text).toContain(PORTAL)
    expect(email.html).toContain(`href="${PORTAL}"`)
    expect(email.text).toContain('Orange Jelly Limited')
    expect(email.html).toContain('Food Safety &amp; Hygiene')
  })

  it('lists several steps in one email, most pressing subject, earliest due first', () => {
    const email = buildStaffReminderEmail({
      name: 'Sam',
      today,
      steps: [
        step('assigned', { courseTitle: 'Fire Safety' }),
        step('overdue', { courseTitle: 'Essentials', dueOn: '2026-10-30', daysOverdue: 3 }),
      ],
      portalUrl: PORTAL,
    })
    assertClean(email)
    expect(email.subject).toBe('Your training is overdue')
    expect(email.text.indexOf('Essentials')).toBeLessThan(email.text.indexOf('Fire Safety'))
    expect(email.text).toContain('You have:')
  })

  it('describes progress and due days in plain words', () => {
    expect(describeStaffStep(step('due_soon', { dueOn: today }), today)).toContain('due today')
    expect(describeStaffStep(step('due_soon', { dueOn: '2026-11-03' }), today)).toContain('due tomorrow, Tuesday 3 November')
    expect(describeStaffStep(step('due_soon', { dueOn: '2026-11-04' }), today)).toContain('due on Wednesday 4 November')
    expect(describeStaffStep(step('nudge', { progress: { sectionsPassed: 1, sectionsTotal: 3, currentSectionTitle: 'Allergens' } }), today))
      .toContain('You have passed 1 of 3 parts. Next is "Allergens".')
    expect(describeStaffStep(step('nudge', { progress: { sectionsPassed: 3, sectionsTotal: 3, currentSectionTitle: null } }), today))
      .toContain('You just need to confirm it.')
    expect(describeStaffStep(step('weekly', { dueOn: '2026-10-26', daysOverdue: 1 }), today)).toContain('(1 day ago)')
  })

  it('escapes a name and a title in the html', () => {
    const email = buildStaffReminderEmail({
      name: '<b>Sam</b>',
      today,
      steps: [step('assigned', { courseTitle: '<script>x</script>' })],
      portalUrl: PORTAL,
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).not.toContain('<b>Sam</b>')
  })

  it('greets with "there" when no name is given', () => {
    const email = buildStaffReminderEmail({ name: '  ', today, steps: [step('assigned')], portalUrl: PORTAL })
    assertClean(email)
    expect(email.text).toContain('Hi there,')
  })

  it('refuses an email with nothing to say', () => {
    expect(() => buildStaffReminderEmail({ name: 'Sam', today, steps: [], portalUrl: PORTAL })).toThrow()
  })
})

describe('buildManagerTrainingEmail', () => {
  const today = '2026-11-02'
  const base = { employeeId: 'e1', employeeName: 'Sam Taylor', assignmentId: 'a1', courseTitle: 'Essentials', dueOn: null, daysOverdue: null }
  const items: ManagerDailyItem[] = [
    { ...base, trigger: 'essentials_overdue', kind: 'escalation', claimKey: 'esc:a1:essentials_overdue:2026-10-30', dueOn: '2026-10-30', daysOverdue: 3 },
    { ...base, employeeId: 'e2', employeeName: 'Alex Green', assignmentId: 'a2', courseTitle: 'Fire Safety', trigger: 'overdue_7_days', kind: 'escalation', claimKey: 'esc:a2:overdue_7_days:2026-10-20', dueOn: '2026-10-20', daysOverdue: 13 },
    { ...base, assignmentId: 'a3', courseTitle: 'Cellar', trigger: 'locked', kind: 'escalation', claimKey: 'esc:a3:locked:2026-11-01' },
    { ...base, assignmentId: 'a4', courseTitle: 'Bar', trigger: 'declined', kind: 'escalation', claimKey: 'esc:a4:declined:2026-11-01' },
    { ...base, assignmentId: 'a5', courseTitle: 'Kitchen', trigger: 'certificate_failed', kind: 'escalation', claimKey: 'esc:a5:certificate_failed' },
    { ...base, employeeId: 'e3', employeeName: 'Jo Park', assignmentId: null, courseTitle: null, trigger: 'no_login', kind: 'no_login', claimKey: 'nologin:e3' },
    { ...base, employeeId: 'e4', employeeName: 'Kim Lee', assignmentId: null, courseTitle: null, trigger: 'undeliverable', kind: 'undeliverable', claimKey: 'undeliverable:e4' },
  ]
  const input = {
    today,
    trainingUrl: 'https://management.example/employees/training',
    recordUrl: (id: string) => `https://management.example/employees/${id}?tab=training`,
  }

  it('renders every kind of problem cleanly, grouped, with record links', () => {
    const email = buildManagerTrainingEmail({ ...input, items })
    assertClean(email)
    expect(email.subject).toBe('Training: 7 new problems need you')
    expect(email.text).toContain(MANAGER_CONTACT_LINE)
    expect(email.text).toContain('due Friday 30 October, 3 days overdue')
    expect(email.text).toContain('https://management.example/employees/e3?tab=training')
    expect(email.html).toContain('href="https://management.example/employees/training"')
    // The most serious group first.
    expect(email.text.indexOf('Sam Taylor: Essentials')).toBeLessThan(email.text.indexOf('Alex Green'))
    expect(email.text.indexOf('Alex Green')).toBeLessThan(email.text.indexOf('Kim Lee'))
  })

  it('uses the singular for one problem', () => {
    const email = buildManagerTrainingEmail({ ...input, items: [items[0]] })
    assertClean(email)
    expect(email.subject).toBe('Training: 1 new problem needs you')
  })

  it('refuses an email with nothing new', () => {
    expect(() => buildManagerTrainingEmail({ ...input, items: [] })).toThrow()
  })
})
