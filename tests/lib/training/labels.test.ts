import { describe, expect, it } from 'vitest'
import * as labels from '@/lib/training/labels'
import {
  describeDisplayState,
  describeStaffDisplayState,
  formatTrainingDate,
  formatTrainingVersion,
  trainingGroupsText,
  trainingVersionText,
} from '@/lib/training/labels'
import {
  MANAGER_TRIGGERS,
  STAFF_REMINDER_STEPS,
  TRAINING_ASSIGNMENT_REASONS,
  TRAINING_ASSIGNMENT_STATUSES,
  TRAINING_AUDIENCE_AGES,
  TRAINING_CANCEL_REASONS,
  TRAINING_COURSE_KINDS,
  TRAINING_COURSE_STATUSES,
  TRAINING_DISPLAY_STATES,
  TRAINING_EVENT_TYPES,
  TRAINING_GROUPS,
  TRAINING_PAUSE_REASONS,
  TRAINING_PERSON_FLAGS,
  TRAINING_VERSION_STATES,
} from '@/lib/training/types'

const LONG_DASH = String.fromCharCode(0x2014)
const BADGE_TONES = ['neutral', 'primary', 'success', 'warning', 'danger', 'info']

const MAPS: Array<[string, Record<string, labels.TrainingBadge>, readonly string[]]> = [
  ['display states', labels.TRAINING_DISPLAY_STATE_BADGE, TRAINING_DISPLAY_STATES],
  ['assignment statuses', labels.TRAINING_ASSIGNMENT_STATUS_BADGE, TRAINING_ASSIGNMENT_STATUSES],
  ['reasons', labels.TRAINING_REASON_BADGE, TRAINING_ASSIGNMENT_REASONS],
  ['cancel reasons', labels.TRAINING_CANCEL_REASON_BADGE, TRAINING_CANCEL_REASONS],
  ['groups', labels.TRAINING_GROUP_BADGE, TRAINING_GROUPS],
  ['events', labels.TRAINING_EVENT_BADGE, TRAINING_EVENT_TYPES],
  ['course statuses', labels.TRAINING_COURSE_STATUS_BADGE, TRAINING_COURSE_STATUSES],
  ['course kinds', labels.TRAINING_COURSE_KIND_BADGE, TRAINING_COURSE_KINDS],
  ['version states', labels.TRAINING_VERSION_STATE_BADGE, TRAINING_VERSION_STATES],
  ['pause reasons', labels.TRAINING_PAUSE_REASON_BADGE, TRAINING_PAUSE_REASONS],
  ['person flags', labels.TRAINING_PERSON_FLAG_BADGE, TRAINING_PERSON_FLAGS],
  ['audience ages', labels.TRAINING_AUDIENCE_AGE_BADGE, TRAINING_AUDIENCE_AGES],
  ['reminder steps', labels.TRAINING_REMINDER_STEP_BADGE, STAFF_REMINDER_STEPS],
  ['manager triggers', labels.TRAINING_MANAGER_TRIGGER_BADGE, MANAGER_TRIGGERS],
  ['attempt results', labels.TRAINING_ATTEMPT_RESULT_BADGE, ['passed', 'failed', 'open']],
]

describe('training labels', () => {
  it.each(MAPS)('words every one of the %s, with a tone the Badge supports', (_name, map, values) => {
    expect(Object.keys(map).sort()).toEqual([...values].sort())
    for (const value of values) {
      const badge = map[value]
      expect(badge.label.trim().length, value).toBeGreaterThan(0)
      expect(BADGE_TONES, value).toContain(badge.tone)
      expect(badge.label, value).not.toContain(LONG_DASH)
      expect(badge.label.charAt(0), value).toBe(badge.label.charAt(0).toUpperCase())
    }
  })

  it('marks late or stuck items danger and done items success', () => {
    const tone = labels.TRAINING_DISPLAY_STATE_BADGE
    expect(tone.overdue.tone).toBe('danger')
    expect(tone.locked.tone).toBe('danger')
    expect(tone.declined.tone).toBe('danger')
    expect(tone.expired.tone).toBe('danger')
    expect(tone.done.tone).toBe('success')
    expect(tone.due_soon.tone).toBe('warning')
    expect(tone.not_required.tone).toBe('neutral')
    expect(labels.TRAINING_SUPERVISED_ONLY_BADGE).toEqual({ label: 'Supervised only', tone: 'warning' })
  })
})

describe('describeDisplayState', () => {
  it('adds the days overdue', () => {
    expect(describeDisplayState('overdue', { daysOverdue: 3 }).text).toBe('Overdue (3 days)')
    expect(describeDisplayState('overdue', { daysOverdue: 1 }).text).toBe('Overdue (1 day)')
    expect(describeDisplayState('overdue', {}).text).toBe('Overdue')
  })

  it('adds the refresher date to a done item', () => {
    expect(describeDisplayState('done', { expiresOn: '2027-11-02' })).toEqual({
      label: 'Done',
      tone: 'success',
      detail: 'refresher due by 2 Nov 2027',
      text: 'Done (refresher due by 2 Nov 2027)',
    })
    expect(describeDisplayState('done', { expiresOn: null }).text).toBe('Done')
  })

  it('shows an expired item with its extended due date', () => {
    expect(describeDisplayState('expired', { dueOn: '2026-12-01' }).text).toBe('Expired (due 1 Dec 2026)')
  })

  it('shows due dates on open items and nothing extra on the rest', () => {
    expect(describeDisplayState('due_soon', { dueOn: '2026-11-04' }).text).toBe('Due soon (due 4 Nov 2026)')
    expect(describeDisplayState('refresher_due', { expiresOn: '2026-11-30' }).text).toBe('Refresher due (due by 30 Nov 2026)')
    expect(describeDisplayState('locked', { dueOn: '2026-11-04' }).text).toBe('Locked')
    expect(describeDisplayState('paused').detail).toBeNull()
  })

  it('keeps a London date on the same day in summer and winter', () => {
    expect(formatTrainingDate('2026-06-30')).toBe('30 Jun 2026')
    expect(formatTrainingDate('2026-12-31')).toBe('31 Dec 2026')
    expect(formatTrainingDate('2028-02-29')).toBe('29 Feb 2028')
  })
})

describe('describeStaffDisplayState (My Training)', () => {
  it('words a waiting item plainly for staff, without the word prerequisite', () => {
    const waiting = describeStaffDisplayState('waiting')
    expect(waiting).toEqual({ label: 'Waiting for another course', tone: 'neutral', detail: null, text: 'Waiting for another course' })
    expect(waiting.text.toLowerCase()).not.toContain('prerequisite')
    // The manager word stays as the spec has it.
    expect(describeDisplayState('waiting').label).toBe('Waiting for prerequisite')
  })

  it('reads every other state exactly as the manager screens do', () => {
    for (const state of TRAINING_DISPLAY_STATES) {
      const staff = describeStaffDisplayState(state, { dueOn: '2026-11-04', daysOverdue: 2, expiresOn: '2027-11-02' })
      const manager = describeDisplayState(state, { dueOn: '2026-11-04', daysOverdue: 2, expiresOn: '2027-11-02' })
      expect(staff.label.toLowerCase(), state).not.toContain('prerequisite')
      expect(staff.label, state).not.toContain(LONG_DASH)
      expect(staff.tone, state).toBe(manager.tone)
      expect(staff.detail, state).toBe(manager.detail)
      if (!labels.TRAINING_STAFF_DISPLAY_STATE_LABEL[state]) expect(staff, state).toEqual(manager)
    }
  })
})

describe('version and group words', () => {
  it('formats version numbers', () => {
    expect(formatTrainingVersion(1, 0)).toBe('1.0')
    expect(trainingVersionText({ major: 2, minor: 3 })).toBe('Version 2.3')
    expect(trainingVersionText({ major: null, minor: null })).toBe('Draft')
  })

  it('lists groups in a fixed order, or everyone', () => {
    expect(trainingGroupsText([])).toBe('Everyone')
    expect(trainingGroupsText(['management', 'bar'])).toBe('Bar, Management')
  })
})
