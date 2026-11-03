import { describe, expect, it } from 'vitest'
import { shiftIsoDate } from '@/lib/dateUtils'
import {
  MANAGER_OVERDUE_DAYS,
  NUDGE_AFTER_DAYS,
  dailyCapClaimKey,
  escalationClaimKey,
  forecastNextReminder,
  managerDayClaimKey,
  noLoginClaimKey,
  planManagerDaily,
  planStaffReminders,
  staffEmailClaimKeys,
  staffStepClaimKey,
  undeliverableClaimKey,
  weeklyClaimKey,
  type ManagerDailyAssignment,
  type ManagerDailyInput,
  type ManagerDailyPerson,
  type StaffReminderItem,
  type StaffReminderPerson,
} from '@/lib/training/reminders'

// 2 November 2026 and 16 November 2026 are Mondays.
const ASSIGNED = '2026-11-02'
const DUE = '2026-11-16'

function item(overrides: Partial<StaffReminderItem> = {}): StaffReminderItem {
  return {
    assignmentId: 'a1',
    courseId: 'essentials',
    courseTitle: 'Essentials',
    courseKind: 'online',
    status: 'assigned',
    assignedOn: ASSIGNED,
    dueOn: DUE,
    confirmationSettled: false,
    progress: { sectionsPassed: 0, sectionsTotal: 4, currentSectionTitle: null },
    ...overrides,
  }
}

function staff(overrides: Partial<StaffReminderPerson> = {}): StaffReminderPerson {
  return {
    employeeId: 'e1',
    name: 'Sam',
    email: 'sam@example.com',
    employeeStatus: 'Active',
    hasLogin: true,
    paused: false,
    emailSuppressed: false,
    items: [item()],
    ...overrides,
  }
}

function runStaff(today: string, people: StaffReminderPerson[] = [staff()], claims: string[] = [], options: { emailsEnabled?: boolean; suspended?: boolean } = {}) {
  return planStaffReminders({
    today,
    emailsEnabled: options.emailsEnabled ?? true,
    suspended: options.suspended ?? false,
    people,
    existingClaims: new Set(claims),
  })
}

function day(offset: number, from = ASSIGNED): string {
  return shiftIsoDate(from, offset) as string
}

/** Runs the job every morning from the assignment date, claiming whatever it sends. */
function walkLadder(person: StaffReminderPerson, days: number, options: { skip?: string[] } = {}): Array<[string, string]> {
  const claims = new Set<string>()
  const sent: Array<[string, string]> = []
  for (let offset = 0; offset <= days; offset += 1) {
    const today = day(offset)
    if (options.skip?.includes(today)) continue
    const plan = planStaffReminders({ today, emailsEnabled: true, suspended: false, people: [person], existingClaims: claims })
    for (const email of plan.emails) {
      for (const key of staffEmailClaimKeys(email)) claims.add(key)
      for (const step of email.steps) sent.push([today, step.step])
    }
  }
  return sent
}

describe('claim keys', () => {
  it('follows the ledger key formats', () => {
    expect(staffStepClaimKey('a1', 'nudge', DUE)).toBe('step:a1:nudge:2026-11-16')
    expect(weeklyClaimKey('a1', '2026-11-23')).toBe('weekly:a1:2026-11-23')
    expect(dailyCapClaimKey('e1', '2026-11-03')).toBe('cap:e1:2026-11-03')
    expect(managerDayClaimKey('2026-11-03')).toBe('manager:2026-11-03')
    expect(escalationClaimKey('a1', 'locked')).toBe('esc:a1:locked')
    expect(escalationClaimKey('a1', 'overdue_7_days', DUE)).toBe('esc:a1:overdue_7_days:2026-11-16')
    expect(noLoginClaimKey('e1')).toBe('nologin:e1')
    expect(undeliverableClaimKey('e1')).toBe('undeliverable:e1')
  })
})

describe('planStaffReminders: the ladder', () => {
  it('walks assigned, nudge, due soon, overdue, then weekly on each London Monday', () => {
    expect(NUDGE_AFTER_DAYS).toBe(3)
    expect(walkLadder(staff(), 30)).toEqual([
      ['2026-11-02', 'assigned'],
      ['2026-11-05', 'nudge'],
      ['2026-11-14', 'due_soon'],
      ['2026-11-17', 'overdue'],
      ['2026-11-23', 'weekly'],
      ['2026-11-30', 'weekly'],
    ])
  })

  it('catches up a missed day in each window', () => {
    const missed = ['2026-11-02', '2026-11-05', '2026-11-14', '2026-11-17', '2026-11-23']
    expect(walkLadder(staff(), 30, { skip: missed })).toEqual([
      ['2026-11-03', 'assigned'],
      ['2026-11-06', 'nudge'],
      ['2026-11-15', 'due_soon'],
      ['2026-11-18', 'overdue'],
      ['2026-11-24', 'weekly'],
      ['2026-11-30', 'weekly'],
    ])
  })

  it('makes up a weekly email later in the week when Monday did not go', () => {
    const claims = [
      staffStepClaimKey('a1', 'assigned', DUE),
      staffStepClaimKey('a1', 'overdue', DUE),
      weeklyClaimKey('a1', '2026-11-16'),
    ]
    const plan = runStaff('2026-11-25', [staff()], claims)
    expect(plan.emails[0].steps[0]).toMatchObject({ step: 'weekly', claimKey: 'weekly:a1:2026-11-23', daysOverdue: 9 })
    expect(runStaff('2026-11-25', [staff()], [...claims, weeklyClaimKey('a1', '2026-11-23')]).emails).toEqual([])
  })

  it('takes the weekly claim of its own week with the overdue email, so the first weekly is the next Monday', () => {
    const plan = runStaff('2026-11-17', [staff()], [staffStepClaimKey('a1', 'assigned', DUE)])
    expect(plan.emails[0].steps[0]).toMatchObject({
      step: 'overdue',
      claimKey: 'step:a1:overdue:2026-11-16',
      alsoClaims: ['weekly:a1:2026-11-16'],
      daysOverdue: 1,
    })
  })

  it('sends the assigned email first even when it is late, and covers the window it fell in', () => {
    const inNudge = runStaff('2026-11-07').emails[0].steps[0]
    expect(inNudge).toMatchObject({ step: 'assigned', claimKey: 'step:a1:assigned:2026-11-16', alsoClaims: ['step:a1:nudge:2026-11-16'] })
    const inDueSoon = runStaff('2026-11-15').emails[0].steps[0]
    expect(inDueSoon).toMatchObject({ step: 'assigned', alsoClaims: ['step:a1:due_soon:2026-11-16'] })
    // Switched on long after the due date: the first email is the overdue one.
    expect(runStaff('2026-11-20').emails[0].steps[0]).toMatchObject({ step: 'overdue', daysOverdue: 4 })
  })

  it('sends one assigned email for an item due the day it is set, and nothing more until it is overdue', () => {
    const sameDay = staff({ items: [item({ assignedOn: '2026-11-03', dueOn: '2026-11-03' })] })
    const claims = new Set<string>()
    const sent: Array<[string, string]> = []
    for (const today of ['2026-11-03', '2026-11-04', '2026-11-05']) {
      const plan = planStaffReminders({ today, emailsEnabled: true, suspended: false, people: [sameDay], existingClaims: claims })
      for (const email of plan.emails) {
        for (const key of staffEmailClaimKeys(email)) claims.add(key)
        for (const step of email.steps) sent.push([today, step.step])
      }
    }
    expect(sent).toEqual([
      ['2026-11-03', 'assigned'],
      ['2026-11-04', 'overdue'],
    ])
  })

  it('follows an extended due date with new keys, without a second assigned email', () => {
    const extended = staff({ items: [item({ dueOn: '2026-12-07' })] })
    const oldClaims = [
      staffStepClaimKey('a1', 'assigned', DUE),
      staffStepClaimKey('a1', 'nudge', DUE),
      staffStepClaimKey('a1', 'due_soon', DUE),
      staffStepClaimKey('a1', 'overdue', DUE),
      weeklyClaimKey('a1', '2026-11-16'),
    ]
    expect(runStaff('2026-11-24', [extended], oldClaims).emails[0].steps[0]).toMatchObject({ step: 'nudge', claimKey: 'step:a1:nudge:2026-12-07' })
    expect(runStaff('2026-12-05', [extended], oldClaims).emails[0].steps[0]).toMatchObject({ step: 'due_soon', claimKey: 'step:a1:due_soon:2026-12-07' })
    expect(runStaff('2026-12-08', [extended], oldClaims).emails[0].steps[0]).toMatchObject({ step: 'overdue', claimKey: 'step:a1:overdue:2026-12-07' })
  })

  it('sends one email per person per London day, listing every step due', () => {
    const twoItems = staff({
      items: [
        item(),
        item({ assignmentId: 'a2', courseId: 'team', courseTitle: 'Team training', assignedOn: '2026-10-01', dueOn: '2026-10-29' }),
        item({ assignmentId: 'a3', courseId: 'other', courseTitle: 'Other', assignedOn: ASSIGNED, dueOn: '2026-12-31' }),
      ],
    })
    const claims = [staffStepClaimKey('a3', 'assigned', '2026-12-31')]
    const plan = runStaff('2026-11-03', [twoItems, staff({ employeeId: 'e2', name: 'Alex', email: 'alex@example.com' })], claims)
    expect(plan.emails).toHaveLength(2)
    expect(plan.emails[0]).toMatchObject({ employeeId: 'e1', name: 'Sam', email: 'sam@example.com', capClaimKey: 'cap:e1:2026-11-03' })
    expect(plan.emails[0].steps.map((step) => [step.assignmentId, step.step])).toEqual([
      ['a1', 'assigned'],
      ['a2', 'overdue'],
    ])
    expect(staffEmailClaimKeys(plan.emails[0])).toEqual([
      'cap:e1:2026-11-03',
      'step:a1:assigned:2026-11-16',
      'step:a2:overdue:2026-10-29',
      'weekly:a2:2026-11-02',
    ])
  })

  it('carries the progress through for the nudge wording', () => {
    const progress = { sectionsPassed: 2, sectionsTotal: 4, currentSectionTitle: 'Allergens' }
    const plan = runStaff('2026-11-05', [staff({ items: [item({ status: 'in_progress', progress })] })], [staffStepClaimKey('a1', 'assigned', DUE)])
    expect(plan.emails[0].steps[0]).toMatchObject({ step: 'nudge', progress, dueOn: DUE, daysOverdue: null })
  })
})

describe('planStaffReminders: when chasing stops', () => {
  const cases: Array<[string, StaffReminderPerson, string]> = [
    ['left', staff({ employeeStatus: 'Former' }), 'left'],
    ['onboarding', staff({ employeeStatus: 'Onboarding' }), 'left'],
    ['paused', staff({ paused: true }), 'paused'],
    ['no login', staff({ hasLogin: false }), 'no_login'],
    ['no address', staff({ email: null }), 'no_email'],
    ['blank address', staff({ email: '   ' }), 'no_email'],
    ['suppressed', staff({ emailSuppressed: true }), 'suppressed'],
  ]

  for (const [label, person, reason] of cases) {
    it(`sends nothing to someone who is ${label}`, () => {
      const plan = runStaff(ASSIGNED, [person])
      expect(plan.emails).toEqual([])
      expect(plan.skipped).toEqual([{ employeeId: 'e1', reason }])
    })
  }

  it('still chases someone working their notice', () => {
    expect(runStaff(ASSIGNED, [staff({ employeeStatus: 'Started Separation' })]).emails).toHaveLength(1)
  })

  it('sends nothing at all with the setting off or a kill switch on', () => {
    expect(runStaff(ASSIGNED, [staff()], [], { emailsEnabled: false })).toEqual({ emails: [], skipped: [{ employeeId: 'e1', reason: 'emails_off' }] })
    expect(runStaff(ASSIGNED, [staff()], [], { suspended: true })).toEqual({ emails: [], skipped: [{ employeeId: 'e1', reason: 'suspended' }] })
  })

  it('sends nothing twice in one London day', () => {
    const plan = runStaff(ASSIGNED, [staff()], [dailyCapClaimKey('e1', ASSIGNED)])
    expect(plan).toEqual({ emails: [], skipped: [{ employeeId: 'e1', reason: 'already_emailed_today' }] })
  })

  it('says so when nothing is due today', () => {
    const plan = runStaff('2026-11-03', [staff()], [staffStepClaimKey('a1', 'assigned', DUE)])
    expect(plan).toEqual({ emails: [], skipped: [{ employeeId: 'e1', reason: 'nothing_due' }] })
  })

  it('never chases practical or external items, items not in a chased status, or items with no due date', () => {
    const notChased: StaffReminderItem[] = [
      item({ assignmentId: 'p', courseKind: 'practical' }),
      item({ assignmentId: 'x', courseKind: 'external' }),
      item({ assignmentId: 'w', status: 'waiting', dueOn: null }),
      item({ assignmentId: 'l', status: 'locked' }),
      item({ assignmentId: 'd', status: 'declined' }),
      item({ assignmentId: 'c', status: 'completed' }),
      item({ assignmentId: 'v', status: 'waived' }),
      item({ assignmentId: 'k', status: 'cancelled' }),
      item({ assignmentId: 'n', dueOn: null }),
      item({ assignmentId: 's', status: 'awaiting_confirmation', confirmationSettled: true }),
    ]
    // Someone with only these is not listed at all: there is nothing to chase.
    expect(runStaff('2026-11-20', [staff({ items: notChased })])).toEqual({ emails: [], skipped: [] })
  })

  it('chases an item waiting for its confirmation like any other', () => {
    const plan = runStaff(ASSIGNED, [staff({ items: [item({ status: 'awaiting_confirmation' })] })])
    expect(plan.emails[0].steps[0].step).toBe('assigned')
  })
})

function managerAssignment(overrides: Partial<ManagerDailyAssignment> = {}): ManagerDailyAssignment {
  return {
    assignmentId: 'a1',
    employeeId: 'e1',
    employeeName: 'Sam Jones',
    courseId: 'team',
    courseTitle: 'Team training',
    isEssentials: false,
    status: 'in_progress',
    dueOn: '2026-11-30',
    lockedSection: null,
    paused: false,
    ...overrides,
  }
}

function managerPerson(overrides: Partial<ManagerDailyPerson> = {}): ManagerDailyPerson {
  return { employeeId: 'e1', employeeName: 'Sam Jones', hasLogin: true, emailUndeliverable: false, hasOpenTraining: true, ...overrides }
}

function runManager(overrides: Partial<ManagerDailyInput> = {}, claims: string[] = []) {
  return planManagerDaily({
    today: '2026-11-03',
    emailsEnabled: true,
    suspended: false,
    assignments: [],
    people: [],
    certificateFailures: [],
    existingClaims: new Set(claims),
    ...overrides,
  })
}

describe('planManagerDaily', () => {
  it('sends nothing on a quiet day', () => {
    expect(runManager({ assignments: [managerAssignment()], people: [managerPerson()] })).toEqual({ send: false, dayClaimKey: 'manager:2026-11-03', items: [] })
  })

  it('tells the manager about an essentials item the morning after it was due', () => {
    const plan = runManager({ assignments: [managerAssignment({ isEssentials: true, courseTitle: 'Essentials', dueOn: '2026-11-02' })] })
    expect(plan.send).toBe(true)
    expect(plan.items).toEqual([
      {
        trigger: 'essentials_overdue',
        claimKey: 'esc:a1:essentials_overdue:2026-11-02',
        kind: 'escalation',
        employeeId: 'e1',
        employeeName: 'Sam Jones',
        assignmentId: 'a1',
        courseTitle: 'Essentials',
        dueOn: '2026-11-02',
        daysOverdue: 1,
      },
    ])
    expect(runManager({ assignments: [managerAssignment({ isEssentials: true, dueOn: '2026-11-03' })] }).send).toBe(false)
  })

  it('tells the manager about anything else only at 7 days overdue', () => {
    expect(MANAGER_OVERDUE_DAYS).toBe(7)
    expect(runManager({ assignments: [managerAssignment({ dueOn: '2026-10-28' })] }).send).toBe(false)
    const plan = runManager({ assignments: [managerAssignment({ dueOn: '2026-10-27' })] })
    expect(plan.items).toEqual([expect.objectContaining({ trigger: 'overdue_7_days', claimKey: 'esc:a1:overdue_7_days:2026-10-27', daysOverdue: 7 })])
  })

  it('tells the manager about a practical item running late too', () => {
    const plan = runManager({ assignments: [managerAssignment({ courseTitle: 'Walkthrough', status: 'assigned', dueOn: '2026-10-20' })] })
    expect(plan.items.map((entry) => entry.trigger)).toEqual(['overdue_7_days'])
  })

  it('tells the manager again when an extended due date is missed as well', () => {
    const told = [escalationClaimKey('a1', 'overdue_7_days', '2026-10-01')]
    expect(runManager({ assignments: [managerAssignment({ dueOn: '2026-10-27' })] }, told).items).toHaveLength(1)
    expect(runManager({ assignments: [managerAssignment({ dueOn: '2026-10-01' })] }, told).send).toBe(false)
  })

  it('escalates nothing as overdue for someone who is paused, but still reports a lock', () => {
    const paused = { paused: true, isEssentials: true, dueOn: '2026-10-01' }
    expect(runManager({ assignments: [managerAssignment(paused)] }).send).toBe(false)
    const locked = runManager({ assignments: [managerAssignment({ ...paused, status: 'locked', lockedSection: 'fire' })] })
    expect(locked.items.map((entry) => entry.trigger)).toEqual(['locked'])
  })

  it('reports a locked section and a declined confirmation, once each, and a second lock again', () => {
    const locked = managerAssignment({ status: 'locked', lockedSection: 'fire', lockedAt: '2026-11-02T19:30:00Z' })
    const declined = managerAssignment({ assignmentId: 'a2', status: 'declined', declinedAt: '2026-11-02T12:00:00Z' })
    const plan = runManager({ assignments: [locked, declined] })
    expect(plan.items.map((entry) => entry.claimKey)).toEqual(['esc:a1:locked:2026-11-02', 'esc:a2:declined:2026-11-02'])
    expect(runManager({ assignments: [locked, declined] }, plan.items.map((entry) => entry.claimKey)).send).toBe(false)
    const lockedAgain = { ...locked, lockedAt: '2026-11-03T10:00:00Z' }
    expect(runManager({ assignments: [lockedAgain] }, plan.items.map((entry) => entry.claimKey)).items.map((entry) => entry.claimKey)).toEqual([
      'esc:a1:locked:2026-11-03',
    ])
    // Without the lock time, each cycle's lock is told once.
    expect(runManager({ assignments: [managerAssignment({ status: 'locked' })] }).items[0].claimKey).toBe('esc:a1:locked')
  })

  it('reports no login only for someone with open training, and undeliverable email', () => {
    const plan = runManager({
      people: [
        managerPerson({ hasLogin: false }),
        managerPerson({ employeeId: 'e2', employeeName: 'Alex Kay', hasLogin: false, hasOpenTraining: false }),
        managerPerson({ employeeId: 'e3', employeeName: 'Jo Bell', emailUndeliverable: true }),
      ],
    })
    expect(plan.items).toEqual([
      expect.objectContaining({ trigger: 'no_login', kind: 'no_login', claimKey: 'nologin:e1', assignmentId: null }),
      expect.objectContaining({ trigger: 'undeliverable', kind: 'undeliverable', claimKey: 'undeliverable:e3' }),
    ])
  })

  it('reports a certificate pack that could not be prepared', () => {
    const plan = runManager({ certificateFailures: [{ assignmentId: 'a9', employeeId: 'e1', employeeName: 'Sam Jones', courseTitle: 'Essentials' }] })
    expect(plan.items).toEqual([expect.objectContaining({ trigger: 'certificate_failed', claimKey: 'esc:a9:certificate_failed', kind: 'escalation' })])
  })

  it('ignores cycles that are not open', () => {
    const closed = (['completed', 'waived', 'cancelled'] as const).map((status, index) =>
      managerAssignment({ assignmentId: `c${index}`, status, isEssentials: true, dueOn: '2026-10-01' })
    )
    expect(runManager({ assignments: closed }).send).toBe(false)
  })

  it('lists problems grouped by trigger, and leaves out what was already told', () => {
    const plan = runManager(
      {
        assignments: [
          managerAssignment({ assignmentId: 'late', dueOn: '2026-10-01' }),
          managerAssignment({ assignmentId: 'lock', status: 'locked' }),
          managerAssignment({ assignmentId: 'ess', isEssentials: true, dueOn: '2026-11-01' }),
        ],
        people: [managerPerson({ hasLogin: false })],
      },
      ['nologin:e1']
    )
    expect(plan.items.map((entry) => entry.trigger)).toEqual(['essentials_overdue', 'overdue_7_days', 'locked'])
  })

  it('sends nothing with the setting off, a kill switch on, or the day already claimed', () => {
    const busy = { assignments: [managerAssignment({ isEssentials: true, dueOn: '2026-10-01' })] }
    expect(runManager({ ...busy, emailsEnabled: false })).toEqual({ send: false, dayClaimKey: 'manager:2026-11-03', items: [] })
    expect(runManager({ ...busy, suspended: true }).send).toBe(false)
    expect(runManager(busy, ['manager:2026-11-03']).send).toBe(false)
  })
})

describe('forecastNextReminder', () => {
  const person = staff()
  const forecast = (overrides: { item?: StaffReminderItem; today?: string; claims?: string[]; emailsEnabled?: boolean; person?: StaffReminderPerson } = {}) =>
    forecastNextReminder({
      item: overrides.item ?? item(),
      person: overrides.person ?? person,
      today: overrides.today ?? ASSIGNED,
      emailsEnabled: overrides.emailsEnabled ?? true,
      existingClaims: new Set(overrides.claims ?? []),
    })

  it('is today for an assigned email not yet sent', () => {
    expect(forecast()).toEqual({ step: 'assigned', onDate: ASSIGNED })
  })

  it('finds the nudge once the assigned email has gone', () => {
    expect(forecast({ claims: [staffStepClaimKey('a1', 'assigned', DUE)] })).toEqual({ step: 'nudge', onDate: day(NUDGE_AFTER_DAYS) })
  })

  it('goes straight to due soon on a short course with no nudge window', () => {
    const short = item({ dueOn: '2026-11-06' })
    expect(forecast({ item: short, claims: [staffStepClaimKey('a1', 'assigned', '2026-11-06')] })).toEqual({ step: 'due_soon', onDate: '2026-11-04' })
  })

  it('finds the overdue email, then the next Monday weekly', () => {
    const sentBefore = [staffStepClaimKey('a1', 'assigned', DUE), staffStepClaimKey('a1', 'nudge', DUE), staffStepClaimKey('a1', 'due_soon', DUE)]
    expect(forecast({ today: '2026-11-14', claims: sentBefore })).toEqual({ step: 'overdue', onDate: '2026-11-17' })
    const afterOverdue = [...sentBefore, staffStepClaimKey('a1', 'overdue', DUE), weeklyClaimKey('a1', '2026-11-16')]
    expect(forecast({ today: '2026-11-18', claims: afterOverdue })).toEqual({ step: 'weekly', onDate: '2026-11-23' })
  })

  it('is null when the item would not be chased', () => {
    expect(forecast({ emailsEnabled: false })).toBeNull()
    expect(forecast({ item: item({ courseKind: 'practical' }) })).toBeNull()
    expect(forecast({ item: item({ status: 'locked' }) })).toBeNull()
    expect(forecast({ person: staff({ paused: true }) })).toBeNull()
    expect(forecast({ person: staff({ hasLogin: false }) })).toBeNull()
    expect(forecast({ person: staff({ employeeStatus: 'Former' }) })).toBeNull()
  })
})
