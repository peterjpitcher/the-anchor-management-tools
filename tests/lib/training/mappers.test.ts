import { describe, expect, it } from 'vitest'
import {
  assignmentPatchToRow,
  emptyProgress,
  mapAssignmentRow,
  mapAttemptRow,
  mapCourseRow,
  mapCourseVersionMetaRow,
  mapCourseVersionRow,
  mapEventRow,
  mapProfileRow,
  mapReminderRow,
  parseProgress,
  parseServed,
} from '@/lib/training/mappers'
import {
  TrainingDataError,
  type TrainingAssignmentRow,
  type TrainingAttemptRow,
  type TrainingCourseRow,
  type TrainingCourseVersionRow,
  type TrainingEventRow,
  type TrainingProfileRow,
  type TrainingReminderRow,
} from '@/lib/training/types'

const SHA = 'a'.repeat(64)
const COURSE_ID = '11111111-1111-4111-8111-111111111111'
const VERSION_ID = '22222222-2222-4222-8222-222222222222'
const EMPLOYEE_ID = '33333333-3333-4333-8333-333333333333'
const ASSIGNMENT_ID = '44444444-4444-4444-8444-444444444444'

function courseRow(overrides: Partial<TrainingCourseRow> = {}): TrainingCourseRow {
  return {
    id: COURSE_ID,
    slug: 'essentials',
    title: 'Essentials',
    kind: 'online',
    audience_groups: ['bar', 'floor'],
    audience_age: 'all',
    is_essentials: true,
    prerequisite_course_id: null,
    new_starter_due_days: 0,
    existing_staff_due_days: 14,
    refresher_months: 12,
    window_days: 30,
    supervised_only_under_18: false,
    display_order: 10,
    status: 'live',
    current_version_id: VERSION_ID,
    summary: 'The basics.',
    created_by: 'user-1',
    created_by_name: 'Peter',
    created_at: '2026-11-03T09:00:00.000Z',
    updated_at: '2026-11-03T09:05:00.000Z',
    ...overrides,
  }
}

const CONTENT = {
  schemaVersion: 1,
  slug: 'essentials',
  title: 'Essentials',
  summary: 'The basics.',
  kind: 'online',
  audience: { groups: [], age: 'all' },
  essentials: true,
  deadline: { newStarterDays: 0, existingStaffDays: 14 },
  refresherMonths: 12,
  windowDays: 30,
  prerequisite: null,
  legalBasis: 'MHSWR 1999 reg 13.',
  estimatedMinutes: 25,
  intro: [],
  sections: [],
  tasks: [],
  supervisedOnlyUnder18: false,
  closing: [],
}

function versionRow(overrides: Partial<TrainingCourseVersionRow> = {}): TrainingCourseVersionRow {
  return {
    id: VERSION_ID,
    course_id: COURSE_ID,
    state: 'published',
    major: 1,
    minor: 2,
    content: CONTENT,
    content_sha256: SHA,
    images: [{ src: 'images/a.png', path: `courses/${COURSE_ID}/${SHA}.png`, sha256: SHA, contentType: 'image/png', bytes: 1200 }],
    change_note: 'Clearer wording.',
    redo_required: false,
    uploaded_by: 'user-1',
    uploaded_by_name: 'Peter',
    uploaded_at: '2026-11-03T09:00:00.000Z',
    published_by: 'user-1',
    published_by_name: 'Peter',
    published_at: '2026-11-03T10:00:00.000Z',
    ...overrides,
  }
}

function assignmentRow(overrides: Partial<TrainingAssignmentRow> = {}): TrainingAssignmentRow {
  return {
    id: ASSIGNMENT_ID,
    employee_id: EMPLOYEE_ID,
    course_id: COURSE_ID,
    cycle: 1,
    reason: 'new_starter',
    status: 'in_progress',
    assigned_on: '2026-11-03',
    due_on: '2026-11-17',
    window_opens_on: null,
    version_id: VERSION_ID,
    progress: { sections: { fire: { card: 3, fails: 1, passedAt: null, lastAttemptQuestionIds: ['fire-01'] } }, current: 'fire', introSeen: true },
    started_at: '2026-11-03T09:00:00.000Z',
    last_section_passed_at: null,
    completed_on: null,
    expires_on: null,
    certificate_number: null,
    signing_document_id: null,
    confirmed_at: null,
    locked_at: null,
    locked_section: null,
    declined_at: null,
    waived_at: null,
    waived_by: null,
    waived_by_name: null,
    waive_reason: null,
    cancelled_at: null,
    cancel_reason: null,
    external_issuer: null,
    external_reference: null,
    external_issued_on: null,
    external_file_path: null,
    signoff_tasks: null,
    signed_off_by: null,
    signed_off_by_name: null,
    signed_off_on: null,
    supervised_only: false,
    due_change_reason: null,
    created_at: '2026-11-03T08:00:00.000Z',
    updated_at: '2026-11-03T09:00:00.000Z',
    ...overrides,
  }
}

describe('mapCourseRow', () => {
  it('maps every column', () => {
    expect(mapCourseRow(courseRow())).toEqual({
      id: COURSE_ID,
      slug: 'essentials',
      title: 'Essentials',
      kind: 'online',
      audienceGroups: ['bar', 'floor'],
      audienceAge: 'all',
      isEssentials: true,
      prerequisiteCourseId: null,
      newStarterDueDays: 0,
      existingStaffDueDays: 14,
      refresherMonths: 12,
      windowDays: 30,
      supervisedOnlyUnder18: false,
      displayOrder: 10,
      status: 'live',
      currentVersionId: VERSION_ID,
      summary: 'The basics.',
      createdBy: 'user-1',
      createdByName: 'Peter',
      createdAt: '2026-11-03T09:00:00.000Z',
      updatedAt: '2026-11-03T09:05:00.000Z',
    })
  })

  it('refuses a value outside its fixed list', () => {
    expect(() => mapCourseRow(courseRow({ kind: 'video' }))).toThrow(TrainingDataError)
    expect(() => mapCourseRow(courseRow({ kind: 'video' }))).toThrow('training_courses.kind: unexpected value "video"')
    expect(() => mapCourseRow(courseRow({ audience_groups: ['bar', 'cellar'] }))).toThrow('training_courses.audience_groups')
    expect(() => mapCourseRow(courseRow({ status: 'archived' }))).toThrow('training_courses.status')
  })
})

describe('mapCourseVersionRow', () => {
  it('maps a published version with its content and images', () => {
    const version = mapCourseVersionRow(versionRow())
    expect(version).toMatchObject({
      id: VERSION_ID,
      courseId: COURSE_ID,
      state: 'published',
      major: 1,
      minor: 2,
      contentSha256: SHA,
      changeNote: 'Clearer wording.',
      redoRequired: false,
      uploadedBy: 'user-1',
      uploadedByName: 'Peter',
      uploadedAt: '2026-11-03T09:00:00.000Z',
      publishedBy: 'user-1',
      publishedByName: 'Peter',
      publishedAt: '2026-11-03T10:00:00.000Z',
    })
    expect(version.content.slug).toBe('essentials')
    expect(version.images).toEqual([
      { src: 'images/a.png', path: `courses/${COURSE_ID}/${SHA}.png`, sha256: SHA, contentType: 'image/png', bytes: 1200 },
    ])
  })

  it('maps a draft without a number', () => {
    const draft = mapCourseVersionRow(versionRow({ state: 'draft', major: null, minor: null, published_at: null, published_by: null, published_by_name: null }))
    expect(draft).toMatchObject({ state: 'draft', major: null, minor: null, publishedAt: null })
  })

  it('maps a version without its content for lists', () => {
    const { content: _content, ...rest } = versionRow()
    const meta = mapCourseVersionMetaRow(rest)
    expect(meta).not.toHaveProperty('content')
    expect(meta.major).toBe(1)
  })

  it('refuses a published version with no number, broken content or a bad image', () => {
    expect(() => mapCourseVersionRow(versionRow({ minor: null }))).toThrow('a published version has no number')
    expect(() => mapCourseVersionRow(versionRow({ content: { slug: 'essentials' } }))).toThrow(
      'training_course_versions.content: does not match its shape'
    )
    expect(() => mapCourseVersionRow(versionRow({ images: [{ src: 'a.png', path: 'x', sha256: 'short', contentType: 'image/png', bytes: 1 }] }))).toThrow(
      'training_course_versions.images'
    )
  })

  it('reads missing images as none', () => {
    expect(mapCourseVersionRow(versionRow({ images: null })).images).toEqual([])
  })
})

describe('mapProfileRow', () => {
  it('maps every column', () => {
    const row: TrainingProfileRow = {
      employee_id: EMPLOYEE_ID,
      groups: ['kitchen'],
      groups_confirmed_at: '2026-11-03T09:00:00.000Z',
      groups_confirmed_by: 'user-1',
      groups_confirmed_by_name: 'Peter',
      paused_from: '2026-11-10',
      paused_until: null,
      pause_reason: 'parental_leave',
      adjustment_note: 'Read aloud offered',
      created_at: '2026-11-03T08:00:00.000Z',
      updated_at: '2026-11-03T09:00:00.000Z',
    }
    expect(mapProfileRow(row)).toEqual({
      employeeId: EMPLOYEE_ID,
      groups: ['kitchen'],
      groupsConfirmedAt: '2026-11-03T09:00:00.000Z',
      groupsConfirmedBy: 'user-1',
      groupsConfirmedByName: 'Peter',
      pausedFrom: '2026-11-10',
      pausedUntil: null,
      pauseReason: 'parental_leave',
      adjustmentNote: 'Read aloud offered',
      createdAt: '2026-11-03T08:00:00.000Z',
      updatedAt: '2026-11-03T09:00:00.000Z',
    })
    expect(() => mapProfileRow({ ...row, pause_reason: 'illness' })).toThrow('training_profiles.pause_reason')
    expect(mapProfileRow({ ...row, pause_reason: null }).pauseReason).toBeNull()
  })
})

describe('mapAssignmentRow', () => {
  it('maps every column', () => {
    const assignment = mapAssignmentRow(
      assignmentRow({
        status: 'completed',
        completed_on: '2026-11-04',
        expires_on: '2027-11-04',
        window_opens_on: '2027-10-05',
        certificate_number: 'AT-0123456789',
        signing_document_id: '55555555-5555-4555-8555-555555555555',
        confirmed_at: '2026-11-04T10:00:00.000Z',
        signoff_tasks: [{ key: 'change-keg', text: 'Changes a keg safely.' }],
        signed_off_by: 'user-1',
        signed_off_by_name: 'Peter',
        signed_off_on: '2026-11-04',
        supervised_only: true,
        cancel_reason: null,
      })
    )
    expect(assignment).toEqual({
      id: ASSIGNMENT_ID,
      employeeId: EMPLOYEE_ID,
      courseId: COURSE_ID,
      cycle: 1,
      reason: 'new_starter',
      status: 'completed',
      assignedOn: '2026-11-03',
      dueOn: '2026-11-17',
      windowOpensOn: '2027-10-05',
      versionId: VERSION_ID,
      progress: { sections: { fire: { card: 3, fails: 1, passedAt: null, lastAttemptQuestionIds: ['fire-01'] } }, current: 'fire', introSeen: true },
      startedAt: '2026-11-03T09:00:00.000Z',
      lastSectionPassedAt: null,
      completedOn: '2026-11-04',
      expiresOn: '2027-11-04',
      certificateNumber: 'AT-0123456789',
      signingDocumentId: '55555555-5555-4555-8555-555555555555',
      confirmedAt: '2026-11-04T10:00:00.000Z',
      lockedAt: null,
      lockedSection: null,
      declinedAt: null,
      waivedAt: null,
      waivedBy: null,
      waivedByName: null,
      waiveReason: null,
      cancelledAt: null,
      cancelReason: null,
      externalIssuer: null,
      externalReference: null,
      externalIssuedOn: null,
      externalFilePath: null,
      signoffTasks: [{ key: 'change-keg', text: 'Changes a keg safely.' }],
      signedOffBy: 'user-1',
      signedOffByName: 'Peter',
      signedOffOn: '2026-11-04',
      supervisedOnly: true,
      dueChangeReason: null,
      createdAt: '2026-11-03T08:00:00.000Z',
      updatedAt: '2026-11-03T09:00:00.000Z',
    })
  })

  it('narrows reason, status and cancel reason', () => {
    expect(mapAssignmentRow(assignmentRow({ status: 'cancelled', cancel_reason: 'left' })).cancelReason).toBe('left')
    expect(() => mapAssignmentRow(assignmentRow({ status: 'done' }))).toThrow('training_assignments.status')
    expect(() => mapAssignmentRow(assignmentRow({ reason: 'induction' }))).toThrow('training_assignments.reason')
    expect(() => mapAssignmentRow(assignmentRow({ cancel_reason: 'sacked' }))).toThrow('training_assignments.cancel_reason')
  })

  it('reads empty or partial progress with starting values', () => {
    expect(mapAssignmentRow(assignmentRow({ progress: {} })).progress).toEqual(emptyProgress())
    expect(parseProgress(null)).toEqual({ sections: {}, current: null, introSeen: false })
    expect(parseProgress({ sections: { fire: { fails: 2 } } })).toEqual({
      sections: { fire: { card: 0, fails: 2, passedAt: null, lastAttemptQuestionIds: [] } },
      current: null,
      introSeen: false,
    })
  })

  it('refuses progress of the wrong shape', () => {
    expect(() => parseProgress({ sections: { fire: { card: -1 } } })).toThrow('training_assignments.progress')
    expect(() => parseProgress({ introSeen: 'yes' })).toThrow('training_assignments.progress')
  })
})

describe('assignmentPatchToRow', () => {
  it('writes only the fields given, as columns', () => {
    expect(
      assignmentPatchToRow({ status: 'locked', lockedAt: '2026-11-05T10:00:00.000Z', lockedSection: 'fire', dueOn: undefined })
    ).toEqual({ status: 'locked', locked_at: '2026-11-05T10:00:00.000Z', locked_section: 'fire' })
    expect(assignmentPatchToRow({ dueOn: null, dueChangeReason: 'Holiday', signedOffBy: 'user-1' })).toEqual({
      due_on: null,
      due_change_reason: 'Holiday',
      signed_off_by: 'user-1',
    })
  })

  it('refuses a field with no column', () => {
    expect(() => assignmentPatchToRow({ id: 'x' } as never)).toThrow('training_assignments: no column for "id"')
  })
})

describe('mapAttemptRow', () => {
  const row: TrainingAttemptRow = {
    id: 'attempt-1',
    assignment_id: ASSIGNMENT_ID,
    employee_id: EMPLOYEE_ID,
    version_id: VERSION_ID,
    section_key: 'fire',
    attempt_no: 2,
    served: [
      { questionId: 'fire-01', optionOrder: [2, 0, 1] },
      { questionId: 'fire-05', optionOrder: [0, 1, 2] },
    ],
    started_at: '2026-11-03T09:00:00.000Z',
    submitted_at: '2026-11-03T09:04:00.000Z',
    answers: { 'fire-01': 1, 'fire-05': 0 },
    results: [
      { questionId: 'fire-01', chosen: 1, correct: true, critical: true },
      { questionId: 'fire-05', chosen: 0, correct: false, critical: false },
    ],
    wrong_count: 1,
    critical_missed: 0,
    passed: true,
  }

  it('maps every column', () => {
    expect(mapAttemptRow(row)).toEqual({
      id: 'attempt-1',
      assignmentId: ASSIGNMENT_ID,
      employeeId: EMPLOYEE_ID,
      versionId: VERSION_ID,
      sectionKey: 'fire',
      attemptNo: 2,
      served: [
        { questionId: 'fire-01', optionOrder: [2, 0, 1] },
        { questionId: 'fire-05', optionOrder: [0, 1, 2] },
      ],
      startedAt: '2026-11-03T09:00:00.000Z',
      submittedAt: '2026-11-03T09:04:00.000Z',
      answers: { 'fire-01': 1, 'fire-05': 0 },
      results: [
        { questionId: 'fire-01', chosen: 1, correct: true, critical: true },
        { questionId: 'fire-05', chosen: 0, correct: false, critical: false },
      ],
      wrongCount: 1,
      criticalMissed: 0,
      passed: true,
    })
  })

  it('maps an open attempt with nothing marked yet', () => {
    const open = mapAttemptRow({ ...row, submitted_at: null, answers: null, results: null, wrong_count: null, critical_missed: null, passed: null })
    expect(open).toMatchObject({ submittedAt: null, answers: null, results: null, wrongCount: null, criticalMissed: null, passed: null })
  })

  it('refuses a served order that is not a reordering of the options', () => {
    expect(() => parseServed([{ questionId: 'fire-01', optionOrder: [0, 0, 1] }])).toThrow('training_attempts.served')
    expect(() => parseServed([{ questionId: 'fire-01', optionOrder: [1, 2, 3] }])).toThrow('training_attempts.served')
    expect(() => parseServed({ questionId: 'fire-01' })).toThrow('training_attempts.served')
  })
})

describe('mapEventRow', () => {
  const row: TrainingEventRow = {
    id: 'event-1',
    employee_id: EMPLOYEE_ID,
    assignment_id: ASSIGNMENT_ID,
    course_id: COURSE_ID,
    event_type: 'section_failed',
    actor_id: null,
    actor_name: 'System',
    note_code: null,
    note: null,
    meta: { sectionKey: 'fire', fails: 2, questionIds: ['fire-01', 'fire-05'] },
    created_at: '2026-11-03T09:04:00.000Z',
  }

  it('maps every column', () => {
    expect(mapEventRow(row)).toEqual({
      id: 'event-1',
      employeeId: EMPLOYEE_ID,
      assignmentId: ASSIGNMENT_ID,
      courseId: COURSE_ID,
      eventType: 'section_failed',
      actorId: null,
      actorName: 'System',
      noteCode: null,
      note: null,
      meta: { sectionKey: 'fire', fails: 2, questionIds: ['fire-01', 'fire-05'] },
      createdAt: '2026-11-03T09:04:00.000Z',
    })
  })

  it('refuses an unknown event and meta that is not a flat record', () => {
    expect(() => mapEventRow({ ...row, event_type: 'emailed' })).toThrow('training_events.event_type')
    expect(() => mapEventRow({ ...row, meta: { nested: { deep: true } } })).toThrow('training_events.meta')
    expect(mapEventRow({ ...row, meta: null }).meta).toEqual({})
  })
})

describe('mapReminderRow', () => {
  const row: TrainingReminderRow = {
    id: 'reminder-1',
    kind: 'staff_step',
    claim_key: `step:${ASSIGNMENT_ID}:overdue:2026-11-17`,
    assignment_id: ASSIGNMENT_ID,
    employee_id: EMPLOYEE_ID,
    london_date: '2026-11-18',
    status: 'uncertain',
    detail: { messageId: 'abc' },
    created_at: '2026-11-18T09:00:00.000Z',
    updated_at: '2026-11-18T09:00:05.000Z',
  }

  it('maps every column', () => {
    expect(mapReminderRow(row)).toEqual({
      id: 'reminder-1',
      kind: 'staff_step',
      claimKey: `step:${ASSIGNMENT_ID}:overdue:2026-11-17`,
      assignmentId: ASSIGNMENT_ID,
      employeeId: EMPLOYEE_ID,
      londonDate: '2026-11-18',
      status: 'uncertain',
      detail: { messageId: 'abc' },
      createdAt: '2026-11-18T09:00:00.000Z',
      updatedAt: '2026-11-18T09:00:05.000Z',
    })
  })

  it('refuses an unknown kind or status', () => {
    expect(() => mapReminderRow({ ...row, kind: 'sms' })).toThrow('training_reminders.kind')
    expect(() => mapReminderRow({ ...row, status: 'failed' })).toThrow('training_reminders.status')
    expect(() => mapReminderRow({ ...row, detail: [1, 2] })).toThrow('training_reminders.detail')
  })
})
