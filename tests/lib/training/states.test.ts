import { describe, expect, it } from 'vitest'
import {
  DUE_SOON_DAYS,
  MAX_SECTION_FAILS,
  allSectionsPassed,
  countsAsDone,
  daysOverdue,
  displayStateFor,
  hasValidCompletion,
  isOpenStatus,
  isPausedOn,
  nextSectionKey,
  pickDisplayAssignment,
  prerequisiteMet,
  sectionStatesFor,
  withCardReached,
  withSectionFailed,
  withSectionPassed,
  withSectionUnlocked,
  type AssignmentStateFields,
} from '@/lib/training/states'
import {
  TRAINING_ASSIGNMENT_STATUSES,
  TRAINING_INTRO_KEY,
  TrainingError,
  type AssignmentProgress,
  type TrainingAssignmentStatus,
} from '@/lib/training/types'

const TODAY = '2026-11-03'
const KEYS = ['fire', 'allergens', 'data']

function cycle(overrides: Partial<AssignmentStateFields> = {}): AssignmentStateFields {
  return {
    id: 'a1',
    cycle: 1,
    status: 'assigned',
    dueOn: '2026-11-20',
    startedAt: null,
    completedOn: null,
    expiresOn: null,
    windowOpensOn: null,
    ...overrides,
  }
}

function completed(overrides: Partial<AssignmentStateFields> = {}): AssignmentStateFields {
  return cycle({ status: 'completed', completedOn: '2026-06-01', expiresOn: '2027-06-01', windowOpensOn: '2027-05-02', ...overrides })
}

function state(
  assignments: AssignmentStateFields[],
  options: { applies?: boolean; paused?: boolean; today?: string; prerequisiteValid?: boolean } = {}
) {
  return displayStateFor({
    assignments,
    applies: options.applies ?? true,
    paused: options.paused ?? false,
    prerequisiteValid: options.prerequisiteValid,
    today: options.today ?? TODAY,
  })
}

function emptyProgress(): AssignmentProgress {
  return { sections: {}, current: null, introSeen: false }
}

function passed(keys: string[]): AssignmentProgress {
  return {
    sections: Object.fromEntries(keys.map((key) => [key, { card: 5, fails: 0, passedAt: '2026-11-01T10:00:00Z', lastAttemptQuestionIds: [] }])),
    current: keys[keys.length - 1] ?? null,
    introSeen: true,
  }
}

function codeOf(run: () => unknown): string | null {
  try {
    run()
    return null
  } catch (error) {
    return error instanceof TrainingError ? error.code : 'other'
  }
}

describe('isOpenStatus and daysOverdue', () => {
  it('treats exactly the six open statuses as open', () => {
    const open = TRAINING_ASSIGNMENT_STATUSES.filter((status) => isOpenStatus(status))
    expect(open).toEqual(['waiting', 'assigned', 'in_progress', 'locked', 'awaiting_confirmation', 'declined'])
  })

  it('counts days overdue from the day after the due date', () => {
    expect(daysOverdue('2026-11-02', TODAY)).toBe(1)
    expect(daysOverdue('2026-10-27', TODAY)).toBe(7)
    expect(daysOverdue(TODAY, TODAY)).toBeNull()
    expect(daysOverdue('2026-11-10', TODAY)).toBeNull()
    expect(daysOverdue(null, TODAY)).toBeNull()
  })
})

describe('displayStateFor', () => {
  it('is not_required with no cycle (or only cancelled ones) when the course does not apply', () => {
    expect(state([], { applies: false })).toBe('not_required')
    expect(state([cycle({ status: 'cancelled' })], { applies: false })).toBe('not_required')
  })

  it('is not_started with no cycle yet when the course applies', () => {
    expect(state([])).toBe('not_started')
    expect(state([cycle({ status: 'cancelled' })])).toBe('not_started')
  })

  it('is paused for an open item while the person is paused, whatever else is true', () => {
    expect(state([cycle()], { paused: true })).toBe('paused')
    expect(state([cycle({ status: 'locked', dueOn: '2026-10-01' })], { paused: true })).toBe('paused')
  })

  it('does not hide a finished course behind a pause', () => {
    expect(state([completed()], { paused: true })).toBe('done')
  })

  it('shows locked, declined, awaiting confirmation and waiting before any due date', () => {
    const late = { dueOn: '2026-10-01' }
    expect(state([cycle({ status: 'locked', ...late })])).toBe('locked')
    expect(state([cycle({ status: 'declined', ...late })])).toBe('declined')
    expect(state([cycle({ status: 'awaiting_confirmation', ...late })])).toBe('awaiting_confirmation')
    expect(state([cycle({ status: 'waiting', dueOn: null })])).toBe('waiting')
  })

  it('is overdue from the day after the due date, before in progress', () => {
    expect(state([cycle({ dueOn: '2026-11-02' })])).toBe('overdue')
    expect(state([cycle({ status: 'in_progress', startedAt: '2026-11-01T09:00:00Z', dueOn: '2026-11-02' })])).toBe('overdue')
  })

  it('is due soon from two days before the due date until the due date', () => {
    expect(DUE_SOON_DAYS).toBe(2)
    expect(state([cycle({ dueOn: TODAY })])).toBe('due_soon')
    expect(state([cycle({ dueOn: '2026-11-05' })])).toBe('due_soon')
    expect(state([cycle({ dueOn: '2026-11-06' })])).toBe('not_started')
  })

  it('is in progress once started, and not started before', () => {
    expect(state([cycle({ status: 'in_progress', startedAt: '2026-11-01T09:00:00Z' })])).toBe('in_progress')
    expect(state([cycle({ dueOn: null })])).toBe('not_started')
  })

  it('shows the open cycle, not an older completion', () => {
    expect(state([completed({ id: 'old', expiresOn: '2026-11-30' }), cycle({ id: 'new', cycle: 2 })])).toBe('not_started')
  })

  describe('an open cycle after the last completion has expired (spec 4.3: validity is decided by expiry alone)', () => {
    const lapsed = completed({ id: 'old', cycle: 1, completedOn: '2025-11-01', expiresOn: '2026-11-02', windowOpensOn: '2026-10-03' })
    const refresher = (overrides: Partial<AssignmentStateFields> = {}): AssignmentStateFields =>
      cycle({ id: 'new', cycle: 2, dueOn: '2026-11-02', ...overrides })

    it('shows expired instead of overdue, due soon, in progress, not started or waiting', () => {
      expect(state([lapsed, refresher()])).toBe('expired')
      expect(state([lapsed, refresher({ dueOn: '2026-11-05' })])).toBe('expired')
      expect(state([lapsed, refresher({ dueOn: '2026-12-01' })])).toBe('expired')
      expect(state([lapsed, refresher({ dueOn: '2026-12-01', status: 'in_progress', startedAt: '2026-11-01T09:00:00Z' })])).toBe('expired')
      expect(state([lapsed, refresher({ dueOn: null })])).toBe('expired')
      expect(state([lapsed, refresher({ status: 'waiting', dueOn: null })])).toBe('expired')
    })

    it('still shows paused, locked, declined and awaiting confirmation, because each needs someone to act', () => {
      expect(state([lapsed, refresher()], { paused: true })).toBe('paused')
      expect(state([lapsed, refresher({ status: 'locked' })])).toBe('locked')
      expect(state([lapsed, refresher({ status: 'declined' })])).toBe('declined')
      expect(state([lapsed, refresher({ status: 'awaiting_confirmation' })])).toBe('awaiting_confirmation')
    })

    it('reads the latest completion whatever order the cycles come in', () => {
      expect(state([refresher(), lapsed])).toBe('expired')
      const older = completed({ id: 'older', cycle: 1, expiresOn: '2025-11-01', windowOpensOn: '2025-10-02' })
      const current = completed({ id: 'current', cycle: 2, expiresOn: '2026-12-01', windowOpensOn: '2026-11-01' })
      expect(state([refresher({ cycle: 3, dueOn: '2026-12-01' }), older, current])).toBe('not_started')
    })

    it('keeps the ordinary open states until the end of the expiry day', () => {
      const lastDay = completed({ id: 'old', cycle: 1, expiresOn: TODAY, windowOpensOn: '2026-10-04' })
      expect(state([lastDay, refresher({ dueOn: TODAY })])).toBe('due_soon')
      expect(state([lastDay, refresher({ dueOn: '2026-11-20' })])).toBe('not_started')
    })

    it('ignores a cancelled cycle, and an expired completion with no open cycle is plain expired', () => {
      expect(state([lapsed, refresher({ status: 'cancelled' })])).toBe('expired')
      expect(state([lapsed, refresher({ status: 'cancelled' }), refresher({ id: 'newer', cycle: 3, dueOn: '2026-12-01' })])).toBe('expired')
    })

    it('needs a completion: an open first cycle that is late is overdue, not expired', () => {
      expect(state([refresher({ cycle: 1 })])).toBe('overdue')
      expect(state([cycle({ id: 'w', status: 'waived', expiresOn: '2026-11-01' }), refresher()])).toBe('overdue')
    })
  })

  it('is waived when the latest cycle was waived', () => {
    expect(state([cycle({ status: 'waived' })])).toBe('waived')
    expect(state([completed(), cycle({ cycle: 2, status: 'waived' })])).toBe('waived')
  })

  it('is expired once the expiry date has passed, refresher due inside the window, else done', () => {
    expect(state([completed({ expiresOn: '2026-11-02', windowOpensOn: '2026-10-03' })])).toBe('expired')
    expect(state([completed({ expiresOn: TODAY, windowOpensOn: '2026-10-04' })])).toBe('refresher_due')
    expect(state([completed({ expiresOn: '2026-12-03', windowOpensOn: TODAY })])).toBe('refresher_due')
    expect(state([completed({ expiresOn: '2026-12-04', windowOpensOn: '2026-11-04' })])).toBe('done')
    expect(state([completed({ expiresOn: null, windowOpensOn: null })])).toBe('done')
  })

  it('reads the latest completed cycle whatever order the cycles come in', () => {
    const older = completed({ id: 'c1', cycle: 1, expiresOn: '2025-06-01', windowOpensOn: '2025-05-02' })
    const newer = completed({ id: 'c2', cycle: 2 })
    expect(state([newer, older])).toBe('done')
    expect(state([older, newer])).toBe('done')
  })

  it('shows nothing owed for a course that no longer applies once its completion runs out', () => {
    expect(state([completed()], { applies: false })).toBe('done')
    expect(state([completed({ expiresOn: '2026-11-02' })], { applies: false })).toBe('not_required')
    expect(state([completed({ windowOpensOn: '2026-11-01', expiresOn: '2026-12-01' })], { applies: false })).toBe('not_required')
  })
})

describe('a practical whose prerequisite has lapsed (spec 4.1)', () => {
  // Kegs signed off 2027-03-01 (no expiry of its own); Team training, its prerequisite, expired 2028-01-15.
  const kegs = completed({ completedOn: '2027-03-01', expiresOn: null, windowOpensOn: null })
  const teamTraining = (expiresOn: string) =>
    [{ courseId: 'team', status: 'completed' as const, expiresOn }, { courseId: 'kegs', status: 'completed' as const, expiresOn: null }]

  it('shows waiting, not done, while the sign-off is in date but the prerequisite is not', () => {
    const today = '2028-01-16'
    const valid = prerequisiteMet('team', teamTraining('2028-01-15'), today)
    expect(valid).toBe(false)
    expect(state([kegs], { today, prerequisiteValid: valid })).toBe('waiting')
    // The day the prerequisite expires it is still valid, so the sign-off still counts.
    expect(state([kegs], { today: '2028-01-15', prerequisiteValid: prerequisiteMet('team', teamTraining('2028-01-15'), '2028-01-15') })).toBe('done')
  })

  it('shows waiting instead of refresher due, but its own expiry still comes first', () => {
    expect(state([completed()], { prerequisiteValid: false })).toBe('waiting')
    expect(state([completed({ expiresOn: '2026-12-03', windowOpensOn: TODAY })], { prerequisiteValid: false })).toBe('waiting')
    expect(state([completed({ expiresOn: '2026-11-02', windowOpensOn: '2026-10-03' })], { prerequisiteValid: false })).toBe('expired')
  })

  it('shows not required for a course that no longer applies, and leaves open cycles alone', () => {
    expect(state([kegs], { applies: false, prerequisiteValid: false })).toBe('not_required')
    expect(state([cycle({ status: 'waiting', dueOn: null })], { prerequisiteValid: false })).toBe('waiting')
    expect(state([cycle({ status: 'locked' })], { prerequisiteValid: false })).toBe('locked')
  })

  it('changes nothing when the prerequisite is valid or left out', () => {
    expect(state([kegs], { prerequisiteValid: true })).toBe('done')
    expect(state([kegs])).toBe('done')
  })

  it('stops counting the sign-off as completed while the prerequisite has lapsed', () => {
    const today = '2028-01-16'
    expect(countsAsDone({ assignments: [kegs], prerequisiteValid: prerequisiteMet('team', teamTraining('2028-01-15'), today), today })).toBe(false)
    expect(countsAsDone({ assignments: [kegs], prerequisiteValid: prerequisiteMet('team', teamTraining('2029-01-15'), today), today })).toBe(true)
    expect(countsAsDone({ assignments: [kegs], today })).toBe(true)
    expect(countsAsDone({ assignments: [completed({ expiresOn: '2026-11-02' })], prerequisiteValid: true, today: TODAY })).toBe(false)
  })

  it('treats a course with no prerequisite as met, and a waived or missing prerequisite as not met', () => {
    expect(prerequisiteMet(null, [], TODAY)).toBe(true)
    expect(prerequisiteMet('team', [], TODAY)).toBe(false)
    expect(prerequisiteMet('team', [{ courseId: 'team', status: 'waived', expiresOn: null }], TODAY)).toBe(false)
    expect(prerequisiteMet('team', [{ courseId: 'other', status: 'completed', expiresOn: null }], TODAY)).toBe(false)
    expect(prerequisiteMet('team', [{ courseId: 'team', status: 'completed', expiresOn: TODAY }], TODAY)).toBe(true)
  })
})

describe('pickDisplayAssignment and hasValidCompletion', () => {
  it('picks the open cycle, else the latest that is not cancelled', () => {
    const one = completed({ id: 'c1', cycle: 1 })
    const two = cycle({ id: 'c2', cycle: 2, status: 'cancelled' })
    const three = cycle({ id: 'c3', cycle: 3 })
    expect(pickDisplayAssignment([one, two, three])?.id).toBe('c3')
    expect(pickDisplayAssignment([one, two])?.id).toBe('c1')
    expect(pickDisplayAssignment([two])).toBeNull()
    expect(pickDisplayAssignment([])).toBeNull()
  })

  it('holds a valid completion until the end of the expiry day', () => {
    expect(hasValidCompletion([completed({ expiresOn: TODAY })], TODAY)).toBe(true)
    expect(hasValidCompletion([completed({ expiresOn: '2026-11-02' })], TODAY)).toBe(false)
    expect(hasValidCompletion([completed({ expiresOn: null })], TODAY)).toBe(true)
    expect(hasValidCompletion([cycle(), cycle({ status: 'waived' })], TODAY)).toBe(false)
  })
})

describe('isPausedOn', () => {
  it('covers the days from the start of the pause to its end, inclusive', () => {
    expect(isPausedOn({ pausedFrom: '2026-11-01', pausedUntil: null }, TODAY)).toBe(true)
    expect(isPausedOn({ pausedFrom: TODAY, pausedUntil: TODAY }, TODAY)).toBe(true)
    expect(isPausedOn({ pausedFrom: '2026-10-01', pausedUntil: '2026-11-02' }, TODAY)).toBe(false)
    expect(isPausedOn({ pausedFrom: '2026-11-04', pausedUntil: null }, TODAY)).toBe(false)
    expect(isPausedOn({ pausedFrom: null, pausedUntil: null }, TODAY)).toBe(false)
    expect(isPausedOn(null, TODAY)).toBe(false)
  })
})

describe('section order', () => {
  it('opens the first section not passed and keeps later ones shut', () => {
    expect(sectionStatesFor(emptyProgress(), KEYS, null)).toEqual({ fire: 'open', allergens: 'not_open', data: 'not_open' })
    expect(sectionStatesFor(passed(['fire']), KEYS, null)).toEqual({ fire: 'passed', allergens: 'open', data: 'not_open' })
  })

  it('shows the locked section as locked', () => {
    expect(sectionStatesFor(passed(['fire']), KEYS, 'allergens')).toEqual({ fire: 'passed', allergens: 'locked', data: 'not_open' })
  })

  it('finds the next section, and knows when all are passed', () => {
    expect(nextSectionKey(emptyProgress(), KEYS)).toBe('fire')
    expect(nextSectionKey(passed(['fire', 'allergens']), KEYS)).toBe('data')
    expect(nextSectionKey(passed(KEYS), KEYS)).toBeNull()
    expect(allSectionsPassed(passed(['fire', 'allergens']), KEYS)).toBe(false)
    expect(allSectionsPassed(passed(KEYS), KEYS)).toBe(true)
  })
})

describe('withCardReached', () => {
  it('saves the card in the open section and makes it current', () => {
    const next = withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'fire', card: 2, cardCount: 6 })
    expect(next.sections.fire).toEqual({ card: 2, fails: 0, passedAt: null, lastAttemptQuestionIds: [] })
    expect(next.current).toBe('fire')
  })

  it('never goes past the last card, and keeps the furthest card reached', () => {
    const far = withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'fire', card: 40, cardCount: 6 })
    expect(far.sections.fire.card).toBe(5)
    const back = withCardReached(far, { sectionKeys: KEYS, sectionKey: 'fire', card: 1, cardCount: 6 })
    expect(back.sections.fire.card).toBe(5)
  })

  it('refuses a section that is not open yet, or not in the course', () => {
    expect(codeOf(() => withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'allergens', card: 0, cardCount: 6 }))).toBe('not_allowed')
    expect(codeOf(() => withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'other', card: 0, cardCount: 6 }))).toBe('not_allowed')
  })

  it('refuses a card number that is not a card', () => {
    expect(codeOf(() => withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'fire', card: -1, cardCount: 6 }))).toBe('invalid')
    expect(codeOf(() => withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'fire', card: 1.5, cardCount: 6 }))).toBe('invalid')
  })

  it('lets a passed section be looked at again without changing anything', () => {
    const before = passed(['fire'])
    const after = withCardReached(before, { sectionKeys: KEYS, sectionKey: 'fire', card: 0, cardCount: 6 })
    expect(after).toEqual(before)
  })

  it('records the intro as seen once its last card is reached', () => {
    const halfway = withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: TRAINING_INTRO_KEY, card: 0, cardCount: 2 })
    expect(halfway.introSeen).toBe(false)
    const seen = withCardReached(halfway, { sectionKeys: KEYS, sectionKey: TRAINING_INTRO_KEY, card: 1, cardCount: 2 })
    expect(seen.introSeen).toBe(true)
    expect(seen.sections).toEqual({})
  })

  it('never changes the progress it was given', () => {
    const before = emptyProgress()
    const snapshot = JSON.stringify(before)
    withCardReached(before, { sectionKeys: KEYS, sectionKey: 'fire', card: 3, cardCount: 6 })
    expect(JSON.stringify(before)).toBe(snapshot)
  })
})

describe('passing, failing and unlocking a section', () => {
  it('marks a pass and moves to the next section', () => {
    const start = withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'fire', card: 5, cardCount: 6 })
    const next = withSectionPassed(start, { sectionKeys: KEYS, sectionKey: 'fire', passedAt: '2026-11-03T10:00:00Z', questionIds: ['q1', 'q2'] })
    expect(next.sections.fire).toMatchObject({ passedAt: '2026-11-03T10:00:00Z', lastAttemptQuestionIds: ['q1', 'q2'] })
    expect(next.current).toBe('allergens')
    expect(start.sections.fire.passedAt).toBeNull()
  })

  it('stays on the last section once every section is passed', () => {
    const next = withSectionPassed(passed(['fire', 'allergens']), { sectionKeys: KEYS, sectionKey: 'data', passedAt: '2026-11-03T10:00:00Z', questionIds: [] })
    expect(allSectionsPassed(next, KEYS)).toBe(true)
    expect(next.current).toBe('data')
  })

  it('refuses a pass for a section that is not open', () => {
    const run = () => withSectionPassed(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'allergens', passedAt: '2026-11-03T10:00:00Z', questionIds: [] })
    expect(codeOf(run)).toBe('not_allowed')
  })

  it('sends the learner back to card 0 on a fail and locks on the third', () => {
    expect(MAX_SECTION_FAILS).toBe(3)
    let progress = withCardReached(emptyProgress(), { sectionKeys: KEYS, sectionKey: 'fire', card: 5, cardCount: 6 })
    const first = withSectionFailed(progress, { sectionKey: 'fire', questionIds: ['q1', 'q2'] })
    expect(first).toMatchObject({ fails: 1, locked: false })
    expect(first.progress.sections.fire).toMatchObject({ card: 0, fails: 1, lastAttemptQuestionIds: ['q1', 'q2'] })
    progress = withCardReached(first.progress, { sectionKeys: KEYS, sectionKey: 'fire', card: 5, cardCount: 6 })
    const second = withSectionFailed(progress, { sectionKey: 'fire', questionIds: ['q3'] })
    expect(second).toMatchObject({ fails: 2, locked: false })
    const third = withSectionFailed(second.progress, { sectionKey: 'fire', questionIds: ['q4'] })
    expect(third).toMatchObject({ fails: 3, locked: true })
  })

  it('refuses a fail for a section already passed', () => {
    expect(codeOf(() => withSectionFailed(passed(['fire']), { sectionKey: 'fire', questionIds: [] }))).toBe('not_allowed')
  })

  it('resets the fail count and the card on unlock, keeping the last questions for the next draw', () => {
    let progress = emptyProgress()
    for (let i = 0; i < 3; i += 1) progress = withSectionFailed(progress, { sectionKey: 'fire', questionIds: ['q9'] }).progress
    const unlocked = withSectionUnlocked(progress, 'fire')
    expect(unlocked.sections.fire).toEqual({ card: 0, fails: 0, passedAt: null, lastAttemptQuestionIds: ['q9'] })
    expect(withSectionFailed(unlocked, { sectionKey: 'fire', questionIds: [] })).toMatchObject({ fails: 1, locked: false })
  })
})

describe('every display state is reachable', () => {
  it('produces all fourteen states', () => {
    const seen = new Set<string>([
      state([], { applies: false }),
      state([cycle()], { paused: true }),
      state([cycle({ status: 'locked' })]),
      state([cycle({ status: 'declined' })]),
      state([cycle({ status: 'awaiting_confirmation' })]),
      state([cycle({ status: 'waiting', dueOn: null })]),
      state([cycle({ dueOn: '2026-11-01' })]),
      state([cycle({ dueOn: '2026-11-04' })]),
      state([cycle({ status: 'in_progress' as TrainingAssignmentStatus, startedAt: '2026-11-01T09:00:00Z' })]),
      state([cycle()]),
      state([cycle({ status: 'waived' })]),
      state([completed({ expiresOn: '2026-11-01' })]),
      state([completed({ expiresOn: '2026-11-20', windowOpensOn: '2026-10-21' })]),
      state([completed()]),
    ])
    expect(seen.size).toBe(14)
  })
})
