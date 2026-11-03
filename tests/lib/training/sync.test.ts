import { describe, expect, it } from 'vitest'
import {
  courseAppliesTo,
  effectiveTrainingGroups,
  minimumAgeFor,
  minimumAgeRefusal,
  planAssignmentSync,
  signoffMinimumAgeRefusal,
  suggestTrainingGroups,
  summariseAutoAssignChanges,
  summariseSyncActions,
  type SyncAction,
  type SyncAssignment,
  type SyncCourse,
  type SyncEmployee,
  type SyncPerson,
} from '@/lib/training/sync'
import { expiryToExtendFrom } from '@/lib/training/states'
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
    refresherMonths: 12,
    windowDays: 30,
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

function plan(people: SyncPerson[], courses: SyncCourse[], today = TODAY, autoAssign = true): SyncAction[] {
  return planAssignmentSync({ today, people, courses, autoAssign })
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

  it('switches the 16 and over rule on the 16th birthday', () => {
    const turning = { groups: [] as TrainingGroup[], dateOfBirth: '2010-11-04' }
    expect(courseAppliesTo(course({ audienceAge: 'over_16' }), turning, TODAY).applies).toBe(false)
    expect(courseAppliesTo(course({ audienceAge: 'over_16' }), turning, '2026-11-04').applies).toBe(true)
    // A 16 year old gets a 16 and over course but not an adult one, and is still under 18.
    expect(courseAppliesTo(course({ audienceAge: 'adult' }), turning, '2026-11-04').applies).toBe(false)
    expect(courseAppliesTo(course({ audienceAge: 'under_18' }), turning, '2026-11-04').applies).toBe(true)
    // An adult meets a 16 and over rule too.
    expect(courseAppliesTo(course({ audienceAge: 'over_16' }), { groups: [], dateOfBirth: '1995-06-15' }, TODAY).applies).toBe(true)
  })

  it('does not apply an age-restricted course without a date of birth, and says so', () => {
    const unknown = { groups: ['bar'] as TrainingGroup[], dateOfBirth: null }
    expect(courseAppliesTo(course({ audienceAge: 'over_16' }), unknown, TODAY)).toEqual({ applies: false, dobMissing: true })
    expect(courseAppliesTo(course({ audienceAge: 'adult' }), unknown, TODAY)).toEqual({ applies: false, dobMissing: true })
    expect(courseAppliesTo(course({ audienceAge: 'all' }), unknown, TODAY)).toEqual({ applies: true, dobMissing: false })
    // Outside the course groups, the missing date of birth does not matter.
    expect(courseAppliesTo(course({ audienceAge: 'adult', audienceGroups: ['kitchen'] }), unknown, TODAY)).toEqual({ applies: false, dobMissing: false })
  })
})

describe('minimum ages', () => {
  it('gives 16 for 16 and over, 18 for adult, and none for the rest', () => {
    expect(minimumAgeFor('over_16')).toBe(16)
    expect(minimumAgeFor('adult')).toBe(18)
    expect(minimumAgeFor('all')).toBeNull()
    expect(minimumAgeFor('under_18')).toBeNull()
  })

  it('refuses someone under the minimum, or with no date of birth, and nobody else', () => {
    const kegs = { audienceAge: 'over_16' as const, title: 'Changing kegs' }
    expect(minimumAgeRefusal(kegs, { dateOfBirth: '2010-11-04', name: 'Robin Young' }, TODAY)).toEqual({
      reason: 'under_minimum_age',
      message: 'Changing kegs is only for people aged 16 or over, and Robin Young is 15.',
    })
    expect(minimumAgeRefusal(kegs, { dateOfBirth: '2010-11-04', name: 'Robin Young' }, '2026-11-04')).toBeNull()
    expect(minimumAgeRefusal(kegs, { dateOfBirth: null, name: 'Sam Example' }, TODAY)).toEqual({
      reason: 'dob_missing',
      message: 'Changing kegs is only for people aged 16 or over, and Sam Example has no date of birth on their employee record. Add it there first.',
    })
    expect(minimumAgeRefusal({ audienceAge: 'adult', title: 'Serving alcohol' }, { dateOfBirth: '2009-03-01' }, TODAY)).toEqual({
      reason: 'under_minimum_age',
      message: 'Serving alcohol is only for people aged 18 or over, and this person is 17.',
    })
    // No minimum: no refusal, even with no date of birth.
    expect(minimumAgeRefusal({ audienceAge: 'all', title: 'Essentials' }, { dateOfBirth: null }, TODAY)).toBeNull()
    expect(minimumAgeRefusal({ audienceAge: 'under_18', title: 'Alcohol (under 18)' }, { dateOfBirth: null }, TODAY)).toBeNull()
  })

  it('checks a sign-off on the day they were watched as well as today', () => {
    const kegs = { audienceAge: 'over_16' as const, title: 'Changing kegs' }
    const robin = { dateOfBirth: '2010-11-04', name: 'Robin Young' }
    // Watched on 20 October 2026 at 15, recorded on 5 November 2026 at 16.
    expect(signoffMinimumAgeRefusal(kegs, robin, '2026-10-20', '2026-11-05')).toEqual({
      reason: 'under_minimum_age',
      message: 'Changing kegs is only for people aged 16 or over, and Robin Young was 15 on the day you watched them.',
    })
    // Watched on the 16th birthday: allowed.
    expect(signoffMinimumAgeRefusal(kegs, robin, '2026-11-04', '2026-11-05')).toBeNull()
    // Under the minimum today: today's refusal, as before.
    expect(signoffMinimumAgeRefusal(kegs, robin, TODAY, TODAY)).toEqual(minimumAgeRefusal(kegs, robin, TODAY))
    expect(signoffMinimumAgeRefusal(kegs, { dateOfBirth: null, name: 'Sam' }, TODAY, TODAY)?.reason).toBe('dob_missing')
    // A date before they were born is refused, not read as a missing date of birth.
    expect(signoffMinimumAgeRefusal(kegs, robin, '2010-01-01', '2026-11-05')).toEqual({
      reason: 'under_minimum_age',
      message: "The day you watched them is before Robin Young's date of birth. Check the date.",
    })
    expect(signoffMinimumAgeRefusal({ audienceAge: 'all', title: 'Ramp' }, robin, '2010-01-01', TODAY)).toBeNull()
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

  it('gives a 16 and over course from the 16th birthday', () => {
    const kegs = course({ id: 'kegs', audienceAge: 'over_16' })
    const fifteen = person({ employee: { dateOfBirth: '2010-11-04' } })
    expect(plan([fifteen], [kegs])).toEqual([])
    expect(plan([fifteen], [kegs], '2026-11-04')).toEqual([expect.objectContaining({ type: 'create', courseId: 'kegs' })])
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

  it('releases a waiting practical refresher due 14 days later, even when the course has no due rule', () => {
    const kegs = course({ id: 'kegs', kind: 'practical', isEssentials: false, prerequisiteCourseId: 'essentials', newStarterDueDays: null, existingStaffDueDays: null })
    const assignments = [
      done(),
      done({ id: 'k1', courseId: 'kegs', completedOn: '2025-11-01', expiresOn: '2026-11-01', windowOpensOn: '2026-10-02' }),
      cycle({ id: 'k2', courseId: 'kegs', cycle: 2, reason: 'refresher', status: 'waiting', dueOn: null }),
    ]
    expect(plan([person({ assignments })], [course(), kegs])).toEqual([
      { type: 'release', assignmentId: 'k2', employeeId: 'e1', courseId: 'kegs', dueOn: '2026-11-17' },
    ])
  })

  it('keeps waiting while the prerequisite has expired', () => {
    const expired = done({ expiresOn: '2026-11-02', windowOpensOn: '2026-10-03' })
    const assignments = [expired, cycle({ id: 'ref', cycle: 2, status: 'in_progress' }), cycle({ id: 'w1', courseId: 'walk', status: 'waiting', dueOn: null })]
    expect(plan([person({ assignments })], [course(), walkthrough])).toEqual([])
  })

  describe('a waived prerequisite refresher still covers its period (owner decision, 3 November 2026)', () => {
    // Team training done once, expiring 1 November 2026; that year's refresher was waived. The keg
    // sign-off, which needs Team training, expires 20 November 2026 and its window is open.
    const team = teamTraining()
    const kegs = course({ id: 'kegs', kind: 'practical', isEssentials: false, prerequisiteCourseId: 'team', newStarterDueDays: null, existingStaffDueDays: null })
    const teamDone = done({ id: 't1', courseId: 'team', completedOn: '2025-11-01', expiresOn: '2026-11-01', windowOpensOn: '2026-10-02' })
    const teamWaived = cycle({ id: 't2', courseId: 'team', cycle: 2, reason: 'refresher', status: 'waived', dueOn: '2026-11-01' })
    const kegsDone = done({ id: 'k1', courseId: 'kegs', completedOn: '2025-11-20', expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' })

    it('opens the keg refresher assigned, with its due date, after the old Team training expiry', () => {
      expect(plan([person({ assignments: [teamDone, teamWaived, kegsDone] })], [team, kegs])).toEqual([
        { type: 'create', employeeId: 'e1', courseId: 'kegs', cycle: 2, reason: 'refresher', status: 'assigned', assignedOn: TODAY, dueOn: '2026-11-20' },
      ])
    })

    it('releases a keg refresher left waiting, and stops once the covered period has passed', () => {
      const waitingKegs = cycle({ id: 'k2', courseId: 'kegs', cycle: 2, reason: 'refresher', status: 'waiting', dueOn: null })
      const assignments = [teamDone, teamWaived, kegsDone, waitingKegs]
      expect(plan([person({ assignments })], [team, kegs])).toEqual([
        { type: 'release', assignmentId: 'k2', employeeId: 'e1', courseId: 'kegs', dueOn: '2026-11-17' },
      ])
      // 2 November 2027: the year the waiver covered is over, so the keg refresher waits again.
      // (Team training's own next refresher is open by then.)
      expect(plan([person({ assignments })], [team, kegs], '2027-11-02')).toEqual([
        expect.objectContaining({ type: 'create', courseId: 'team', cycle: 3, reason: 'refresher' }),
      ])
    })

    it('still waits when the waived Team training was a first cycle', () => {
      const firstWaived = cycle({ id: 't1', courseId: 'team', status: 'waived', dueOn: null })
      const waitingKegs = cycle({ id: 'k1', courseId: 'kegs', reason: 'manual', status: 'waiting', dueOn: null })
      expect(plan([person({ assignments: [firstWaived, waitingKegs] })], [team, kegs])).toEqual([])
    })
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

  describe('a waived refresher covers one period', () => {
    // Completed once, expiring 1 November 2026; that year's refresher was waived.
    const completed = done({ completedOn: '2025-11-01', expiresOn: '2026-11-01', windowOpensOn: '2026-10-02' })
    const waived = cycle({ id: 'w2', cycle: 2, reason: 'refresher', status: 'waived', dueOn: '2026-11-01' })

    it('opens the next refresher a year on, when its window opens, due on the new expiry', () => {
      const assignments = [completed, waived]
      expect(plan([person({ assignments })], [course()])).toEqual([])
      expect(plan([person({ assignments })], [course()], '2027-10-01')).toEqual([])
      expect(plan([person({ assignments })], [course()], '2027-10-02')).toEqual([
        { type: 'create', employeeId: 'e1', courseId: 'essentials', cycle: 3, reason: 'refresher', status: 'assigned', assignedOn: '2027-10-02', dueOn: '2027-11-01' },
      ])
      // Missed altogether: due the day it is noticed.
      expect(plan([person({ assignments })], [course()], '2027-12-01')).toEqual([expect.objectContaining({ reason: 'refresher', dueOn: '2027-12-01' })])
    })

    it('counts one period per waiver, and calls an external one a renewal', () => {
      const twice = [completed, waived, cycle({ id: 'w3', cycle: 3, reason: 'refresher', status: 'waived', dueOn: '2027-11-01' })]
      expect(plan([person({ assignments: twice })], [course()], '2027-10-02')).toEqual([])
      expect(plan([person({ assignments: twice })], [course()], '2028-10-02')).toEqual([expect.objectContaining({ cycle: 4, reason: 'refresher', dueOn: '2028-11-01' })])
      const fireMarshal = course({ id: 'ext', kind: 'external', isEssentials: false, refresherMonths: 36 })
      const external = [
        done({ courseId: 'ext', completedOn: '2023-11-01', expiresOn: '2026-11-01', windowOpensOn: '2026-10-02', versionNumber: null }),
        cycle({ id: 'r2', courseId: 'ext', cycle: 2, reason: 'renewal', status: 'waived', dueOn: '2026-11-01' }),
      ]
      expect(plan([person({ assignments: external })], [fireMarshal], '2029-10-01')).toEqual([])
      expect(plan([person({ assignments: external })], [fireMarshal], '2029-10-02')).toEqual([expect.objectContaining({ cycle: 3, reason: 'renewal', dueOn: '2029-11-01' })])
    })

    it('keeps a waived first cycle, redo or manual cycle waived', () => {
      for (const reason of ['existing_staff', 'redo', 'manual'] as const) {
        const assignments = [completed, cycle({ id: 'w2', cycle: 2, reason, status: 'waived' })]
        expect(plan([person({ assignments })], [course()], '2030-01-01')).toEqual([])
      }
      expect(plan([person({ assignments: [cycle({ status: 'waived' })] })], [course()], '2030-01-01')).toEqual([])
    })

    it('lets the refresher done after a waiver extend from the expiry the waiver ran to', () => {
      // Done early in the window: the new expiry is a year after 1 November 2027, not after the
      // completion date, so finishing early loses nothing.
      expect(expiryToExtendFrom([completed, waived], 3, 12)).toBe('2027-11-01')
      expect(expiryToExtendFrom([completed, waived, cycle({ id: 'w3', cycle: 3, reason: 'refresher', status: 'waived' })], 4, 12)).toBe('2028-11-01')
      // Only cycles before the one being finished count, and a waived redo or first cycle covers no period.
      expect(expiryToExtendFrom([completed, waived], 2, 12)).toBe('2026-11-01')
      expect(expiryToExtendFrom([completed, cycle({ id: 'w2', cycle: 2, reason: 'redo', status: 'waived' })], 3, 12)).toBe('2026-11-01')
      expect(expiryToExtendFrom([cycle({ status: 'waived' })], 2, 12)).toBeNull()
      expect(expiryToExtendFrom([completed, waived], 3, null)).toBe('2026-11-01')
    })

    it('opens nothing for a course that never expires', () => {
      expect(plan([person({ assignments: [completed, waived] })], [course({ refresherMonths: null })], '2030-01-01')).toEqual([])
    })
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

describe('planAssignmentSync: automatic assignment off', () => {
  const off = (people: SyncPerson[], courses: SyncCourse[], today = TODAY) => plan(people, courses, today, false)

  it('creates nothing for anyone and raises no date of birth flag', () => {
    const adult = course({ id: 'alcohol', audienceAge: 'adult' })
    const redoCourse = teamTraining({ latestRedoVersion: { id: 'v2', major: 1, minor: 1 } })
    const people = [
      person({ employee: { employeeId: 'starter', employmentStartDate: '2026-11-09' } }),
      person({ employee: { employeeId: 'nodob', dateOfBirth: null } }),
      person({ employee: { employeeId: 'refresh' }, assignments: [done({ expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' })] }),
      person({ employee: { employeeId: 'redo' }, assignments: [done({ courseId: 'team' })] }),
    ]
    expect(off(people, [course(), adult, redoCourse])).toEqual([])
  })

  it('still cancels for a leaver, a retired course and a group removed', () => {
    const leaver = person({ employee: { employeeId: 'gone', status: 'Former' }, assignments: [cycle({ id: 'x1' })] })
    const retired = person({ employee: { employeeId: 'r' }, assignments: [cycle({ id: 'x2', courseId: 'old' })] })
    const moved = person({ employee: { employeeId: 'm' }, profile: profile({ employeeId: 'm', groups: ['bar'], groupsConfirmedAt: '2026-11-01T09:00:00Z' }), assignments: [cycle({ id: 'x3', courseId: 'kitchen' })] })
    const actions = off([leaver, retired, moved], [course({ id: 'old', status: 'retired' }), course({ id: 'kitchen', audienceGroups: ['kitchen'] })])
    expect(actions).toEqual([
      { type: 'cancel', assignmentId: 'x1', employeeId: 'gone', courseId: 'essentials', reason: 'left' },
      { type: 'cancel', assignmentId: 'x2', employeeId: 'r', courseId: 'old', reason: 'course_retired' },
      { type: 'cancel', assignmentId: 'x3', employeeId: 'm', courseId: 'kitchen', reason: 'group_removed' },
    ])
  })

  it('releases a waiting cycle a manager assigned, but not one the sync made', () => {
    const walk = course({ id: 'walk', kind: 'practical', isEssentials: false, prerequisiteCourseId: 'essentials', newStarterDueDays: 14, existingStaffDueDays: 28 })
    const manual = [done(), cycle({ id: 'm1', courseId: 'walk', reason: 'manual', status: 'waiting', dueOn: null })]
    expect(off([person({ assignments: manual })], [course(), walk])).toEqual([
      { type: 'release', assignmentId: 'm1', employeeId: 'e1', courseId: 'walk', dueOn: '2026-11-17' },
    ])
    const automatic = [done(), cycle({ id: 'c1', courseId: 'walk', reason: 'course_added', status: 'waiting', dueOn: null })]
    expect(off([person({ assignments: automatic })], [course(), walk])).toEqual([])
  })

  it('still ends a pause and re-dates open cycles', () => {
    const paused = profile({ pausedFrom: '2026-09-01', pausedUntil: '2026-11-02', pauseReason: 'parental_leave' })
    const actions = off([person({ profile: paused, assignments: [cycle({ dueOn: '2026-10-01' })] })], [course()])
    expect(actions).toEqual([{ type: 'end_pause', employeeId: 'e1', resumedOn: TODAY, dueChanges: [{ assignmentId: 'a1', dueOn: '2026-11-17' }] }])
  })

  it('refuses to guess when it is not told', () => {
    expect(() => planAssignmentSync({ today: TODAY, people: [], courses: [] } as unknown as Parameters<typeof planAssignmentSync>[0])).toThrow(
      'Say whether courses are assigned automatically'
    )
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

describe('summariseAutoAssignChanges', () => {
  it('counts what switching on adds: creates by kind, and releases only the switch makes', () => {
    const team = teamTraining()
    const walkthrough = course({ id: 'walk', kind: 'practical', isEssentials: false, prerequisiteCourseId: 'essentials' })
    const people = [
      // Nothing yet: Essentials and Team training, and the walkthrough waiting for Essentials.
      person({ employee: { employeeId: 'e1' } }),
      // Essentials done long ago (refresher owed), and a walkthrough sync left waiting, now releasable.
      person({
        employee: { employeeId: 'e2' },
        assignments: [
          done({ id: 'e2-ess', expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' }),
          done({ id: 'e2-team', courseId: 'team' }),
          cycle({ id: 'e2-walk', courseId: 'walk', reason: 'existing_staff', status: 'waiting', dueOn: null }),
        ],
      }),
      // A manager's waiting walkthrough is released with the switch off too, so it is not counted.
      person({
        employee: { employeeId: 'e3' },
        assignments: [
          done({ id: 'e3-ess' }),
          done({ id: 'e3-team', courseId: 'team' }),
          cycle({ id: 'e3-walk', courseId: 'walk', reason: 'manual', status: 'waiting', dueOn: null }),
        ],
      }),
      // A leaver: cancelled either way, never counted.
      person({ employee: { employeeId: 'e4', status: 'Former' }, assignments: [cycle({ id: 'e4-ess' })] }),
    ]
    const courses = [course(), team, walkthrough]
    const on = plan(people, courses, TODAY, true)
    const off = plan(people, courses, TODAY, false)
    expect(summariseAutoAssignChanges(on, off)).toEqual({ people: 2, items: 5, firstCourses: 3, refreshers: 1, redos: 0, released: 1 })
    expect(summariseAutoAssignChanges(off, off)).toEqual({ people: 0, items: 0, firstCourses: 0, refreshers: 0, redos: 0, released: 0 })
  })
})
