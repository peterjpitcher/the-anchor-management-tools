import { describe, expect, it } from 'vitest'
import {
  courseAppliesTo,
  effectiveTrainingGroups,
  planAssignmentSync,
  suggestTrainingGroups,
  summariseSyncActions,
  type SyncAction,
  type SyncAssignment,
  type SyncCourse,
  type SyncEmployee,
  type SyncPerson,
} from '@/lib/training/sync'
import type { TrainingGroup, TrainingProfile } from '@/lib/training/types'

const TODAY = '2026-11-03'

function course(overrides: Partial<SyncCourse> = {}): SyncCourse {
  return {
    id: 'essentials',
    slug: 'essentials',
    kind: 'online',
    status: 'live',
    audienceGroups: [],
    audienceAge: 'all',
    isEssentials: true,
    prerequisiteCourseId: null,
    newStarterDueDays: 0,
    existingStaffDueDays: 14,
    wentLiveOn: TODAY,
    assignAutomatically: true,
    latestRedoVersion: null,
    ...overrides,
  }
}

const teamTraining = (overrides: Partial<SyncCourse> = {}) =>
  course({ id: 'team', slug: 'team-training', isEssentials: false, newStarterDueDays: 14, existingStaffDueDays: 28, ...overrides })

function employee(overrides: Partial<SyncEmployee> = {}): SyncEmployee {
  return {
    employeeId: 'e1',
    status: 'Active',
    employmentStartDate: '2024-05-01',
    dateOfBirth: '1995-06-15',
    jobTitle: 'Bartender',
    recentRotaDepartments: ['bar'],
    ...overrides,
  }
}

function profile(overrides: Partial<TrainingProfile> = {}): TrainingProfile {
  return {
    employeeId: 'e1',
    groups: [],
    groupsConfirmedAt: null,
    groupsConfirmedBy: null,
    groupsConfirmedByName: null,
    pausedFrom: null,
    pausedUntil: null,
    pauseReason: null,
    adjustmentNote: null,
    createdAt: '2026-11-01T09:00:00Z',
    updatedAt: '2026-11-01T09:00:00Z',
    ...overrides,
  }
}

function cycle(overrides: Partial<SyncAssignment> = {}): SyncAssignment {
  return {
    id: 'a1',
    courseId: 'essentials',
    cycle: 1,
    status: 'assigned',
    reason: 'existing_staff',
    dueOn: '2026-11-17',
    completedOn: null,
    expiresOn: null,
    windowOpensOn: null,
    versionId: null,
    versionNumber: null,
    ...overrides,
  }
}

function done(overrides: Partial<SyncAssignment> = {}): SyncAssignment {
  return cycle({
    status: 'completed',
    completedOn: '2026-02-01',
    expiresOn: '2027-02-01',
    windowOpensOn: '2027-01-02',
    versionId: 'v1',
    versionNumber: { major: 1, minor: 0 },
    ...overrides,
  })
}

function person(input: { employee?: Partial<SyncEmployee>; profile?: TrainingProfile | null; assignments?: SyncAssignment[] } = {}): SyncPerson {
  return { employee: employee(input.employee), profile: input.profile ?? null, assignments: input.assignments ?? [] }
}

function plan(people: SyncPerson[], courses: SyncCourse[], today = TODAY): SyncAction[] {
  return planAssignmentSync({ today, people, courses })
}

describe('suggestTrainingGroups', () => {
  it('reads the job title, ignoring case and spacing', () => {
    expect(suggestTrainingGroups({ jobTitle: 'Bartender', recentRotaDepartments: [] })).toEqual(['bar'])
    expect(suggestTrainingGroups({ jobTitle: '  bar   STAFF ', recentRotaDepartments: [] })).toEqual(['bar'])
    expect(suggestTrainingGroups({ jobTitle: 'Head Chef', recentRotaDepartments: [] })).toEqual(['kitchen'])
    expect(suggestTrainingGroups({ jobTitle: 'Cook', recentRotaDepartments: [] })).toEqual(['kitchen'])
    expect(suggestTrainingGroups({ jobTitle: 'Host', recentRotaDepartments: [] })).toEqual(['floor'])
    expect(suggestTrainingGroups({ jobTitle: 'Sunday Runner', recentRotaDepartments: [] })).toEqual(['floor'])
  })

  it('combines title and rota, in a fixed order with no repeats', () => {
    expect(suggestTrainingGroups({ jobTitle: 'Bartender & Cook', recentRotaDepartments: [] })).toEqual(['bar', 'kitchen'])
    expect(suggestTrainingGroups({ jobTitle: 'Cook', recentRotaDepartments: ['runner', 'bar', 'kitchen', 'host'] })).toEqual(['bar', 'kitchen', 'floor'])
  })

  it('suggests nothing for cleaning, training, management or an unknown title', () => {
    expect(suggestTrainingGroups({ jobTitle: 'Not Specified', recentRotaDepartments: ['cleaning', 'training'] })).toEqual([])
    expect(suggestTrainingGroups({ jobTitle: 'Barista', recentRotaDepartments: [] })).toEqual([])
    expect(suggestTrainingGroups({ jobTitle: 'General Manager', recentRotaDepartments: [] })).toEqual([])
    expect(suggestTrainingGroups({ jobTitle: null, recentRotaDepartments: [] })).toEqual([])
  })
})

describe('effectiveTrainingGroups', () => {
  it('uses the suggested groups until a manager confirms', () => {
    expect(effectiveTrainingGroups(null, ['kitchen', 'bar'])).toEqual({ groups: ['bar', 'kitchen'], confirmed: false })
    expect(effectiveTrainingGroups(profile({ groups: ['management'] }), ['bar'])).toEqual({ groups: ['bar'], confirmed: false })
  })

  it('uses the confirmed groups once confirmed, even an empty list', () => {
    expect(effectiveTrainingGroups(profile({ groups: ['management', 'bar'], groupsConfirmedAt: '2026-11-01T09:00:00Z' }), ['kitchen'])).toEqual({
      groups: ['bar', 'management'],
      confirmed: true,
    })
    expect(effectiveTrainingGroups(profile({ groups: [], groupsConfirmedAt: '2026-11-01T09:00:00Z' }), ['bar'])).toEqual({ groups: [], confirmed: true })
  })
})

describe('courseAppliesTo', () => {
  const adult = { groups: ['bar'] as TrainingGroup[], dateOfBirth: '1995-06-15' }

  it('applies a live course for everyone to everyone', () => {
    expect(courseAppliesTo(course(), adult, TODAY)).toEqual({ applies: true, dobMissing: false })
  })

  it('never applies a draft or retired course', () => {
    expect(courseAppliesTo(course({ status: 'draft' }), adult, TODAY).applies).toBe(false)
    expect(courseAppliesTo(course({ status: 'retired' }), adult, TODAY).applies).toBe(false)
  })

  it('needs one of the course groups', () => {
    expect(courseAppliesTo(course({ audienceGroups: ['kitchen', 'bar'] }), adult, TODAY).applies).toBe(true)
    expect(courseAppliesTo(course({ audienceGroups: ['kitchen'] }), adult, TODAY).applies).toBe(false)
  })

  it('switches the age rule on the 18th birthday', () => {
    const turning = { groups: [] as TrainingGroup[], dateOfBirth: '2008-11-04' }
    expect(courseAppliesTo(course({ audienceAge: 'under_18' }), turning, TODAY).applies).toBe(true)
    expect(courseAppliesTo(course({ audienceAge: 'adult' }), turning, TODAY).applies).toBe(false)
    expect(courseAppliesTo(course({ audienceAge: 'under_18' }), turning, '2026-11-04').applies).toBe(false)
    expect(courseAppliesTo(course({ audienceAge: 'adult' }), turning, '2026-11-04').applies).toBe(true)
  })

  it('does not apply an age-restricted course without a date of birth, and says so', () => {
    const unknown = { groups: ['bar'] as TrainingGroup[], dateOfBirth: null }
    expect(courseAppliesTo(course({ audienceAge: 'adult' }), unknown, TODAY)).toEqual({ applies: false, dobMissing: true })
    expect(courseAppliesTo(course({ audienceAge: 'all' }), unknown, TODAY)).toEqual({ applies: true, dobMissing: false })
    // Outside the course groups, the missing date of birth does not matter.
    expect(courseAppliesTo(course({ audienceAge: 'adult', audienceGroups: ['kitchen'] }), unknown, TODAY)).toEqual({ applies: false, dobMissing: false })
  })
})

describe('planAssignmentSync: first cycles and due dates', () => {
  it('gives a new starter essentials due on the start date and team training 14 days after', () => {
    const actions = plan([person({ employee: { employmentStartDate: '2026-11-09' } })], [course(), teamTraining()])
    expect(actions).toEqual([
      { type: 'create', employeeId: 'e1', courseId: 'essentials', cycle: 1, reason: 'new_starter', status: 'assigned', assignedOn: TODAY, dueOn: '2026-11-09' },
      { type: 'create', employeeId: 'e1', courseId: 'team', cycle: 1, reason: 'new_starter', status: 'assigned', assignedOn: TODAY, dueOn: '2026-11-23' },
    ])
  })

  it('never makes a new starter due in the past', () => {
    const [essentials] = plan([person({ employee: { employmentStartDate: '2026-10-30' } })], [course()])
    expect(essentials).toMatchObject({ reason: 'new_starter', dueOn: TODAY })
  })

  it('gives staff already working at launch 14 and 28 days (course added)', () => {
    const actions = plan([person()], [course(), teamTraining()])
    expect(actions.map((action) => action.type === 'create' && [action.reason, action.dueOn])).toEqual([
      ['course_added', '2026-11-17'],
      ['course_added', '2026-12-01'],
    ])
  })

  it('calls it existing staff when the person started after the course went live', () => {
    const [action] = plan([person({ employee: { employmentStartDate: '2026-09-01' } })], [course({ wentLiveOn: '2026-08-01' })])
    expect(action).toMatchObject({ reason: 'existing_staff', dueOn: '2026-11-17' })
  })

  it('gives someone with no start date the course but no due date', () => {
    const [action] = plan([person({ employee: { employmentStartDate: null } })], [course()])
    expect(action).toMatchObject({ type: 'create', reason: 'existing_staff', status: 'assigned', dueOn: null })
  })

  it('gives no due date when the course has no rule', () => {
    const [action] = plan([person()], [course({ newStarterDueDays: null, existingStaffDueDays: null })])
    expect(action).toMatchObject({ type: 'create', dueOn: null })
  })

  it('numbers a new cycle after every earlier one, cancelled cycles included', () => {
    const actions = plan([person({ assignments: [cycle({ id: 'x', cycle: 1, status: 'cancelled' }), cycle({ id: 'y', cycle: 2, status: 'cancelled' })] })], [course()])
    expect(actions).toEqual([expect.objectContaining({ type: 'create', cycle: 3 })])
  })

  it('creates nothing while a cycle is open', () => {
    expect(plan([person({ assignments: [cycle()] })], [course()])).toEqual([])
  })

  it('creates nothing for a course that is only recorded by hand', () => {
    expect(plan([person()], [course({ kind: 'external', assignAutomatically: false })])).toEqual([])
  })

  it('ignores draft courses', () => {
    expect(plan([person({ assignments: [cycle()] })], [course({ status: 'draft' })])).toEqual([])
  })
})

describe('planAssignmentSync: who is in scope', () => {
  it('cancels every open cycle of someone who has left, and leaves completed ones alone', () => {
    const assignments = [
      done({ id: 'old', cycle: 1 }),
      cycle({ id: 'open-e', cycle: 2 }),
      cycle({ id: 'open-t', courseId: 'team', status: 'locked' }),
    ]
    const actions = plan([person({ employee: { status: 'Former' }, assignments })], [course(), teamTraining()])
    expect(actions).toEqual([
      { type: 'cancel', assignmentId: 'open-e', employeeId: 'e1', courseId: 'essentials', reason: 'left' },
      { type: 'cancel', assignmentId: 'open-t', employeeId: 'e1', courseId: 'team', reason: 'left' },
    ])
  })

  it('treats Onboarding as out of scope too: nothing new, open items cancelled', () => {
    expect(plan([person({ employee: { status: 'Onboarding' } })], [course()])).toEqual([])
    expect(plan([person({ employee: { status: 'Onboarding' }, assignments: [cycle()] })], [course()])).toEqual([
      { type: 'cancel', assignmentId: 'a1', employeeId: 'e1', courseId: 'essentials', reason: 'left' },
    ])
  })

  it('keeps open cycles for someone working their notice but gives them nothing new', () => {
    const notice = { status: 'Started Separation' as const }
    expect(plan([person({ employee: notice })], [course()])).toEqual([])
    expect(plan([person({ employee: notice, assignments: [cycle()] })], [course()])).toEqual([])
    const refresherDue = done({ expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' })
    expect(plan([person({ employee: notice, assignments: [refresherDue] })], [course()])).toEqual([])
  })

  it('still releases a waiting cycle for someone working their notice', () => {
    const assignments = [done({ id: 'ess' }), cycle({ id: 'walk', courseId: 'walk', status: 'waiting', dueOn: null })]
    const walkthrough = course({ id: 'walk', kind: 'practical', isEssentials: false, prerequisiteCourseId: 'essentials', newStarterDueDays: 14, existingStaffDueDays: 28 })
    const actions = plan([person({ employee: { status: 'Started Separation' }, assignments })], [course(), walkthrough])
    expect(actions).toEqual([{ type: 'release', assignmentId: 'walk', employeeId: 'e1', courseId: 'walk', dueOn: '2026-11-17' }])
  })
})

describe('planAssignmentSync: courses and audiences', () => {
  it('cancels open items on a retired course and creates nothing', () => {
    expect(plan([person()], [course({ status: 'retired' })])).toEqual([])
    expect(plan([person({ assignments: [cycle({ cycle: 2 }), done({ id: 'old', cycle: 1 })] })], [course({ status: 'retired' })])).toEqual([
      { type: 'cancel', assignmentId: 'a1', employeeId: 'e1', courseId: 'essentials', reason: 'course_retired' },
    ])
  })

  it('gives a group course to suggested groups until groups are confirmed', () => {
    const barCourse = course({ id: 'cellar', audienceGroups: ['bar'] })
    expect(plan([person()], [barCourse])).toEqual([expect.objectContaining({ type: 'create', courseId: 'cellar' })])
    const kitchenOnly = profile({ groups: ['kitchen'], groupsConfirmedAt: '2026-11-01T09:00:00Z' })
    expect(plan([person({ profile: kitchenOnly })], [barCourse])).toEqual([])
  })

  it('cancels an open item when the person leaves the course groups', () => {
    const kitchenOnly = profile({ groups: ['kitchen'], groupsConfirmedAt: '2026-11-01T09:00:00Z' })
    const barCourse = course({ id: 'cellar', audienceGroups: ['bar'] })
    const actions = plan([person({ profile: kitchenOnly, assignments: [cycle({ courseId: 'cellar', cycle: 2 }), done({ id: 'old', courseId: 'cellar', cycle: 1 })] })], [barCourse])
    expect(actions).toEqual([{ type: 'cancel', assignmentId: 'a1', employeeId: 'e1', courseId: 'cellar', reason: 'group_removed' }])
  })

  it('keeps a cycle a manager assigned by hand outside the course groups', () => {
    const kitchenOnly = profile({ groups: ['kitchen'], groupsConfirmedAt: '2026-11-01T09:00:00Z' })
    const barCourse = course({ id: 'cellar', audienceGroups: ['bar'] })
    expect(plan([person({ profile: kitchenOnly, assignments: [cycle({ courseId: 'cellar', reason: 'manual' })] })], [barCourse])).toEqual([])
  })

  it('assigns by age: under 18 and adult variants', () => {
    const under = course({ id: 'alcohol-u18', audienceAge: 'under_18' })
    const adult = course({ id: 'alcohol', audienceAge: 'adult' })
    const young = person({ employee: { dateOfBirth: '2009-03-01' } })
    expect(plan([young], [under, adult])).toEqual([expect.objectContaining({ type: 'create', courseId: 'alcohol-u18' })])
    expect(plan([person()], [under, adult])).toEqual([expect.objectContaining({ type: 'create', courseId: 'alcohol' })])
  })

  it('moves someone to the adult course on their 18th birthday', () => {
    const under = course({ id: 'alcohol-u18', audienceAge: 'under_18' })
    const adult = course({ id: 'alcohol', audienceAge: 'adult' })
    const birthday = person({ employee: { dateOfBirth: '2008-11-03' }, assignments: [cycle({ courseId: 'alcohol-u18' })] })
    expect(plan([birthday], [under, adult])).toEqual([
      { type: 'cancel', assignmentId: 'a1', employeeId: 'e1', courseId: 'alcohol-u18', reason: 'group_removed' },
      expect.objectContaining({ type: 'create', courseId: 'alcohol', reason: 'course_added', dueOn: '2026-11-17' }),
    ])
  })

  it('flags a missing date of birth and assigns nothing age-restricted', () => {
    const adult = course({ id: 'alcohol', audienceAge: 'adult' })
    const unknown = person({ employee: { dateOfBirth: null } })
    expect(plan([unknown], [course(), adult])).toEqual([
      expect.objectContaining({ type: 'create', courseId: 'essentials' }),
      { type: 'flag', employeeId: 'e1', courseId: 'alcohol', flag: 'dob_missing' },
    ])
  })

  it('keeps an open age-restricted cycle when the date of birth goes missing, and flags it', () => {
    const adult = course({ id: 'alcohol', audienceAge: 'adult' })
    const unknown = person({ employee: { dateOfBirth: null }, assignments: [cycle({ courseId: 'alcohol' })] })
    expect(plan([unknown], [adult])).toEqual([{ type: 'flag', employeeId: 'e1', courseId: 'alcohol', flag: 'dob_missing' }])
  })
})

describe('planAssignmentSync: prerequisites', () => {
  const walkthrough = course({
    id: 'walk',
    kind: 'practical',
    isEssentials: false,
    prerequisiteCourseId: 'essentials',
    newStarterDueDays: 14,
    existingStaffDueDays: 28,
  })

  it('creates the later course waiting, with no due date, until the prerequisite is done', () => {
    expect(plan([person()], [course(), walkthrough])).toEqual([
      expect.objectContaining({ courseId: 'essentials', status: 'assigned' }),
      expect.objectContaining({ type: 'create', courseId: 'walk', status: 'waiting', dueOn: null, reason: 'course_added' }),
    ])
  })

  it('creates it assigned with its own due date when the prerequisite is already valid', () => {
    const actions = plan([person({ assignments: [done()] })], [course(), walkthrough])
    expect(actions).toEqual([expect.objectContaining({ type: 'create', courseId: 'walk', status: 'assigned', dueOn: '2026-12-01' })])
  })

  it('releases a waiting cycle once the prerequisite completes, due 14 days later', () => {
    const assignments = [done(), cycle({ id: 'w1', courseId: 'walk', status: 'waiting', dueOn: null })]
    expect(plan([person({ assignments })], [course(), walkthrough])).toEqual([
      { type: 'release', assignmentId: 'w1', employeeId: 'e1', courseId: 'walk', dueOn: '2026-11-17' },
    ])
  })

  it('releases with no due date when the course has none', () => {
    const kegs = course({ id: 'kegs', kind: 'practical', prerequisiteCourseId: 'essentials', newStarterDueDays: null, existingStaffDueDays: null })
    const assignments = [done(), cycle({ id: 'k1', courseId: 'kegs', status: 'waiting', dueOn: null })]
    expect(plan([person({ assignments })], [course(), kegs])).toEqual([{ type: 'release', assignmentId: 'k1', employeeId: 'e1', courseId: 'kegs', dueOn: null }])
  })

  it('keeps waiting while the prerequisite has expired', () => {
    const expired = done({ expiresOn: '2026-11-02', windowOpensOn: '2026-10-03' })
    const assignments = [expired, cycle({ id: 'ref', cycle: 2, status: 'in_progress' }), cycle({ id: 'w1', courseId: 'walk', status: 'waiting', dueOn: null })]
    expect(plan([person({ assignments })], [course(), walkthrough])).toEqual([])
  })
})

describe('planAssignmentSync: refreshers and redo', () => {
  it('opens a refresher on the day the window opens, due on the expiry date', () => {
    const assignments = [done({ expiresOn: '2026-12-03', windowOpensOn: TODAY })]
    expect(plan([person({ assignments })], [course()])).toEqual([
      { type: 'create', employeeId: 'e1', courseId: 'essentials', cycle: 2, reason: 'refresher', status: 'assigned', assignedOn: TODAY, dueOn: '2026-12-03' },
    ])
  })

  it('does nothing before the window opens', () => {
    expect(plan([person({ assignments: [done({ expiresOn: '2026-12-04', windowOpensOn: '2026-11-04' })] })], [course()])).toEqual([])
  })

  it('makes a refresher for an expired completion due today', () => {
    const assignments = [done({ expiresOn: '2026-10-01', windowOpensOn: '2026-09-01' })]
    expect(plan([person({ assignments })], [course()])).toEqual([expect.objectContaining({ reason: 'refresher', dueOn: TODAY })])
  })

  it('calls an external qualification renewal a renewal', () => {
    const fireMarshal = course({ id: 'ext', kind: 'external', isEssentials: false })
    const assignments = [done({ courseId: 'ext', expiresOn: '2026-11-20', windowOpensOn: '2026-10-21', versionNumber: null })]
    expect(plan([person({ assignments })], [fireMarshal])).toEqual([expect.objectContaining({ reason: 'renewal', dueOn: '2026-11-20' })])
  })

  it('never opens a refresher for a course that never expires, or after a waiver', () => {
    expect(plan([person({ assignments: [done({ expiresOn: null, windowOpensOn: null })] })], [course()])).toEqual([])
    const waivedLatest = [done({ expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' }), cycle({ id: 'w', cycle: 2, status: 'waived' })]
    expect(plan([person({ assignments: waivedLatest })], [course()])).toEqual([])
  })

  it('opens a redo cycle when a newer version asks everyone to redo it', () => {
    const redoCourse = course({ latestRedoVersion: { id: 'v2', major: 1, minor: 1 } })
    expect(plan([person({ assignments: [done()] })], [redoCourse])).toEqual([
      { type: 'create', employeeId: 'e1', courseId: 'essentials', cycle: 2, reason: 'redo', status: 'assigned', assignedOn: TODAY, dueOn: '2026-11-17' },
    ])
  })

  it('opens no redo for someone who already took that version, or is part-way through', () => {
    const redoCourse = course({ latestRedoVersion: { id: 'v2', major: 1, minor: 1 } })
    expect(plan([person({ assignments: [done({ versionNumber: { major: 1, minor: 1 } })] })], [redoCourse])).toEqual([])
    expect(plan([person({ assignments: [done({ versionNumber: { major: 2, minor: 0 } })] })], [redoCourse])).toEqual([])
    expect(plan([person({ assignments: [done(), cycle({ id: 'open', cycle: 2, status: 'in_progress' })] })], [redoCourse])).toEqual([])
  })

  it('gives the redo to someone who finishes the old version, at their next sync', () => {
    const redoCourse = course({ latestRedoVersion: { id: 'v2', major: 1, minor: 1 } })
    const justFinished = done({ completedOn: TODAY, expiresOn: '2027-11-03', windowOpensOn: '2027-10-04' })
    expect(plan([person({ assignments: [justFinished] })], [redoCourse])).toEqual([expect.objectContaining({ reason: 'redo', cycle: 2 })])
  })

  it('opens the redo, not a refresher, when both are owed', () => {
    const redoCourse = course({ latestRedoVersion: { id: 'v2', major: 1, minor: 1 } })
    const inWindow = done({ expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' })
    expect(plan([person({ assignments: [inWindow] })], [redoCourse])).toEqual([expect.objectContaining({ reason: 'redo', dueOn: '2026-11-17' })])
  })
})

describe('planAssignmentSync: pauses', () => {
  it('ends a pause that finished yesterday and gives open items 14 days from the resume date', () => {
    const paused = profile({ pausedFrom: '2026-09-01', pausedUntil: '2026-11-02', pauseReason: 'parental_leave' })
    const assignments = [
      cycle({ id: 'soon', dueOn: '2026-09-15' }),
      cycle({ id: 'later', courseId: 'team', dueOn: '2026-12-31' }),
      cycle({ id: 'none', courseId: 'other', dueOn: null }),
    ]
    const actions = plan([person({ profile: paused, assignments })], [course(), teamTraining(), course({ id: 'other', isEssentials: false })])
    expect(actions).toEqual([{ type: 'end_pause', employeeId: 'e1', resumedOn: TODAY, dueChanges: [{ assignmentId: 'soon', dueOn: '2026-11-17' }] }])
  })

  it('leaves a pause that is still running, or has no end date', () => {
    const running = profile({ pausedFrom: '2026-09-01', pausedUntil: TODAY })
    const openEnded = profile({ pausedFrom: '2026-09-01', pausedUntil: null })
    expect(plan([person({ profile: running, assignments: [cycle()] })], [course()])).toEqual([])
    expect(plan([person({ profile: openEnded, assignments: [cycle()] })], [course()])).toEqual([])
  })

  it('leaves out of the pause change any item this run releases or cancels', () => {
    const paused = profile({ pausedFrom: '2026-09-01', pausedUntil: '2026-10-31' })
    const walkthrough = course({ id: 'walk', kind: 'practical', isEssentials: false, prerequisiteCourseId: 'essentials' })
    const assignments = [done({ id: 'ess' }), cycle({ id: 'w1', courseId: 'walk', status: 'waiting', dueOn: null }), cycle({ id: 'r1', courseId: 'gone', dueOn: '2026-09-10' })]
    const actions = plan([person({ profile: paused, assignments })], [course(), walkthrough, course({ id: 'gone', status: 'retired' })])
    expect(actions).toEqual([
      { type: 'end_pause', employeeId: 'e1', resumedOn: '2026-11-01', dueChanges: [] },
      { type: 'release', assignmentId: 'w1', employeeId: 'e1', courseId: 'walk', dueOn: '2026-11-17' },
      { type: 'cancel', assignmentId: 'r1', employeeId: 'e1', courseId: 'gone', reason: 'course_retired' },
    ])
  })
})

describe('planAssignmentSync: order and counts', () => {
  it('gives the same actions in the same order for the same input', () => {
    const people = [
      person({ employee: { employeeId: 'e1' } }),
      person({ employee: { employeeId: 'e2', status: 'Former' }, assignments: [cycle({ id: 'x' })] }),
      person({ employee: { employeeId: 'e3', employmentStartDate: '2026-11-01' } }),
    ]
    const courses = [course(), teamTraining()]
    const first = plan(people, courses)
    expect(plan(people, courses)).toEqual(first)
    expect(first.map((action) => `${action.employeeId}:${action.type}:${'courseId' in action ? action.courseId : ''}`)).toEqual([
      'e1:create:essentials',
      'e1:create:team',
      'e2:cancel:essentials',
      'e3:create:essentials',
      'e3:create:team',
    ])
  })

  it('counts creates, cancels and updates, and ignores flags', () => {
    const actions: SyncAction[] = [
      { type: 'create', employeeId: 'e1', courseId: 'c', cycle: 1, reason: 'manual', status: 'assigned', assignedOn: TODAY, dueOn: null },
      { type: 'create', employeeId: 'e1', courseId: 'd', cycle: 1, reason: 'manual', status: 'waiting', assignedOn: TODAY, dueOn: null },
      { type: 'cancel', assignmentId: 'a', employeeId: 'e1', courseId: 'c', reason: 'left' },
      { type: 'release', assignmentId: 'b', employeeId: 'e1', courseId: 'c', dueOn: null },
      { type: 'end_pause', employeeId: 'e1', resumedOn: TODAY, dueChanges: [] },
      { type: 'flag', employeeId: 'e1', courseId: 'c', flag: 'dob_missing' },
    ]
    expect(summariseSyncActions(actions)).toEqual({ created: 2, cancelled: 1, updated: 2 })
    expect(summariseSyncActions([])).toEqual({ created: 0, cancelled: 0, updated: 0 })
  })
})
