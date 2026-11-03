// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeDb } from '../helpers/fakeSupabaseDb'
import { createTrainingDb } from '../helpers/trainingDb'

const mocks = vi.hoisted(() => ({ client: null as unknown, getTrainingAutoAssignEnabled: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/training/settings', () => ({
  getTrainingEmailsEnabled: vi.fn().mockResolvedValue(false),
  getTrainingAutoAssignEnabled: mocks.getTrainingAutoAssignEnabled,
}))

import { validateCourse } from '@/lib/training/course-schema'
import { emptyProgress } from '@/lib/training/mappers'
import { planStaffReminders, staffEmailClaimKeys } from '@/lib/training/reminders'
import { TrainingError } from '@/lib/training/types'
import { TrainingService } from '@/services/training'

const TODAY = '2026-11-10'

const SAM = '11111111-1111-4111-8111-111111111111'
const FORMER = '44444444-4444-4444-8444-444444444444'
const ONLINE = 'c1111111-1111-4111-8111-111111111111'
const A_FORMER = 'a4444444-4444-4444-8444-444444444444'
const A_SAM = 'a1111111-1111-4111-8111-111111111111'

const UNIQUE_OPEN = 'duplicate key value violates unique constraint "training_assignments_one_open"'

let db: FakeDb

function courseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ONLINE,
    slug: 'allergens',
    title: 'Allergen awareness',
    kind: 'online',
    audience_groups: [],
    audience_age: 'all',
    is_essentials: true,
    prerequisite_course_id: null,
    new_starter_due_days: 14,
    existing_staff_due_days: 30,
    refresher_months: 12,
    window_days: 30,
    supervised_only_under_18: false,
    display_order: 10,
    status: 'live',
    current_version_id: null,
    summary: null,
    created_by: null,
    created_by_name: null,
    created_at: '2026-10-01T09:00:00.000Z',
    updated_at: '2026-10-01T09:00:00.000Z',
    ...overrides,
  }
}

function assignmentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: A_SAM,
    employee_id: SAM,
    course_id: ONLINE,
    cycle: 1,
    reason: 'existing_staff',
    status: 'assigned',
    assigned_on: '2026-11-01',
    due_on: '2026-11-12',
    progress: emptyProgress(),
    supervised_only: false,
    created_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:00:00.000Z',
    ...overrides,
  }
}

function attemptRow(id: string, startedAt: string, submittedAt: string | null): Record<string, unknown> {
  return {
    id,
    assignment_id: A_SAM,
    employee_id: SAM,
    version_id: 'v1111111-1111-4111-8111-111111111111',
    section_key: 'fire',
    attempt_no: 1,
    served: [{ questionId: 'q1', optionOrder: [0, 1, 2] }],
    started_at: startedAt,
    submitted_at: submittedAt,
    answers: null,
    results: null,
    wrong_count: null,
    critical_missed: null,
    passed: null,
  }
}

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}): void {
  db = createTrainingDb({
    employees: [
      { employee_id: SAM, first_name: 'Sam', last_name: 'Example', preferred_name: null, status: 'Active', job_title: 'Bartender', employment_start_date: '2025-01-01', date_of_birth: '1990-05-01', email_address: 'sam@example.test', auth_user_id: 'u-sam' },
      { employee_id: FORMER, first_name: 'Fran', last_name: 'Former', preferred_name: null, status: 'Former', job_title: 'Bartender', employment_start_date: '2020-01-01', date_of_birth: '1980-01-01', email_address: null, auth_user_id: null },
    ],
    training_courses: [courseRow()],
    ...extra,
  })
  mocks.client = db.client
}

function events(type?: string): Array<Record<string, unknown>> {
  return db.rows('training_events').filter((event) => !type || event.event_type === type)
}

beforeEach(() => {
  vi.clearAllMocks()
  // Most tests here are about what the sync does once it runs; the switch has its own tests.
  mocks.getTrainingAutoAssignEnabled.mockResolvedValue(true)
  seed()
})

describe('syncAssignments', () => {
  it('opens what is owed, cancels what is no longer owed, and records an event for each', async () => {
    seed({ training_assignments: [assignmentRow({ id: A_FORMER, employee_id: FORMER })] })
    const result = await TrainingService.syncAssignments({ today: TODAY })

    expect(result).toEqual({ created: 1, cancelled: 1, updated: 0 })
    const rows = db.rows('training_assignments')
    expect(rows.find((row) => row.employee_id === SAM)).toMatchObject({
      course_id: ONLINE,
      cycle: 1,
      reason: 'existing_staff',
      status: 'assigned',
      assigned_on: TODAY,
      due_on: '2026-12-10',
    })
    expect(rows.find((row) => row.id === A_FORMER)).toMatchObject({ status: 'cancelled', cancel_reason: 'left' })
    expect(events('assigned')).toEqual([expect.objectContaining({ employee_id: SAM, actor_id: null, actor_name: 'System' })])
    expect(events('cancelled')).toEqual([expect.objectContaining({ assignment_id: A_FORMER, note_code: 'left' })])
  })

  it('is safe to run twice: the second run changes nothing', async () => {
    seed({ training_assignments: [assignmentRow({ id: A_FORMER, employee_id: FORMER })] })
    await TrainingService.syncAssignments({ today: TODAY })
    const writes = db.writes.length
    expect(await TrainingService.syncAssignments({ today: TODAY })).toEqual({ created: 0, cancelled: 0, updated: 0 })
    expect(db.writes.length).toBe(writes)
  })

  it('treats a cycle another run opened first as already done, not as a failure', async () => {
    db.failNext({ table: 'training_assignments', operation: 'insert', message: UNIQUE_OPEN, times: 1 })
    expect(await TrainingService.syncAssignments({ today: TODAY })).toEqual({ created: 0, cancelled: 0, updated: 0 })
    expect(events()).toEqual([])
  })

  it('applies every other change when one fails, then says so', async () => {
    seed({ training_assignments: [assignmentRow({ id: A_FORMER, employee_id: FORMER })] })
    db.failNext({ table: 'training_assignments', operation: 'insert', message: 'connection reset', times: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await expect(TrainingService.syncAssignments({ today: TODAY })).rejects.toThrow(/applied 1 change\(s\) but 1 failed/)
    spy.mockRestore()
    expect(db.rows('training_assignments').find((row) => row.id === A_FORMER)?.status).toBe('cancelled')
  })

  it('ends a pause that has run its course once: due dates get their grace and the pause is cleared', async () => {
    seed({
      training_profiles: [{ employee_id: SAM, groups: [], paused_from: '2026-10-01', paused_until: '2026-11-05', pause_reason: 'other', updated_at: 'x' }],
      training_assignments: [assignmentRow()],
    })
    expect(await TrainingService.syncAssignments({ today: TODAY })).toEqual({ created: 0, cancelled: 0, updated: 1 })
    expect(db.rows('training_assignments')[0]).toMatchObject({ due_on: '2026-11-20', due_change_reason: 'Pause ended' })
    expect(db.rows('training_profiles')[0]).toMatchObject({ paused_from: null, paused_until: null, pause_reason: null })
    expect(events('resumed')).toHaveLength(1)

    expect(await TrainingService.syncAssignments({ today: TODAY })).toEqual({ created: 0, cancelled: 0, updated: 0 })
    expect(events('resumed')).toHaveLength(1)
  })

  it('syncs one person only when asked', async () => {
    seed({ training_assignments: [assignmentRow({ id: A_FORMER, employee_id: FORMER })] })
    expect(await TrainingService.syncAssignments({ today: TODAY, employeeId: SAM })).toEqual({ created: 1, cancelled: 0, updated: 0 })
    expect(db.rows('training_assignments').find((row) => row.id === A_FORMER)?.status).toBe('assigned')
  })

  it('gives nobody a course while automatic assignment is off, but still cancels for a leaver', async () => {
    mocks.getTrainingAutoAssignEnabled.mockResolvedValue(false)
    seed({ training_assignments: [assignmentRow({ id: A_FORMER, employee_id: FORMER })] })
    expect(await TrainingService.syncAssignments({ today: TODAY })).toEqual({ created: 0, cancelled: 1, updated: 0 })
    expect(mocks.getTrainingAutoAssignEnabled).toHaveBeenCalledTimes(1)
    expect(db.rows('training_assignments').filter((row) => row.employee_id === SAM)).toEqual([])
    expect(events('assigned')).toEqual([])
    expect(db.rows('training_assignments').find((row) => row.id === A_FORMER)).toMatchObject({ status: 'cancelled', cancel_reason: 'left' })
  })

  it('takes the switch from the caller when given, without reading it', async () => {
    mocks.getTrainingAutoAssignEnabled.mockResolvedValue(true)
    expect(await TrainingService.syncAssignments({ today: TODAY, autoAssign: false })).toEqual({ created: 0, cancelled: 0, updated: 0 })
    mocks.getTrainingAutoAssignEnabled.mockResolvedValue(false)
    expect(await TrainingService.syncAssignments({ today: TODAY, autoAssign: true })).toEqual({ created: 1, cancelled: 0, updated: 0 })
    expect(mocks.getTrainingAutoAssignEnabled).not.toHaveBeenCalled()
  })
})

describe('previewAutoAssign', () => {
  it('counts what switching on would give out, writing nothing, whatever the switch says now', async () => {
    mocks.getTrainingAutoAssignEnabled.mockResolvedValue(false)
    seed({ training_assignments: [assignmentRow({ id: A_FORMER, employee_id: FORMER })] })
    expect(await TrainingService.previewAutoAssign({ today: TODAY })).toEqual({
      people: 1,
      items: 1,
      firstCourses: 1,
      refreshers: 0,
      redos: 0,
      released: 0,
    })
    // The leaver's cancellation happens either way, so it is not counted, and nothing is written.
    expect(db.writes).toEqual([])
    expect(events()).toEqual([])
    expect(mocks.getTrainingAutoAssignEnabled).not.toHaveBeenCalled()
  })
})

describe('getMatrix', () => {
  it('shows current staff against live courses with counts', async () => {
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people.map((person) => person.employeeId)).toEqual([SAM])
    expect(matrix.people[0].cells[ONLINE]).toMatchObject({ state: 'not_started', assignmentId: null })
    expect(matrix.people[0].flags).toEqual(['groups_not_confirmed'])
    expect(matrix.courses[0]).toMatchObject({ id: ONLINE, requiredCount: 1, completedCount: 0, completionRate: 0 })
  })

  it('leaves out of the count someone whose item is waived (owner decision, 3 November 2026)', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'waived', waived_at: '2026-11-02T09:00:00.000Z' })] })
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people[0].cells[ONLINE].state).toBe('waived')
    expect(matrix.courses[0]).toMatchObject({ id: ONLINE, requiredCount: 0, completedCount: 0 })
  })
})

describe('updateAssignment', () => {
  it('refuses when the row moved on since it was read', async () => {
    seed({ training_assignments: [assignmentRow()] })
    db.beforeUpdate((table, matched) => {
      if (table === 'training_assignments') for (const row of matched) row.status = 'completed'
    })
    await expect(
      TrainingService.updateAssignment(A_SAM, { dueOn: '2026-12-31' }, { expectedStatuses: ['assigned'] })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('says not found for a missing row', async () => {
    await expect(TrainingService.updateAssignment(A_SAM, { dueOn: '2026-12-31' })).rejects.toBeInstanceOf(TrainingError)
  })
})

describe('reminder claims', () => {
  it('claims a key once; a second claim of the same key is refused quietly', async () => {
    expect(await TrainingService.claimReminder({ kind: 'staff_step', claimKey: 'step:a:assigned:2026-12-10', londonDate: TODAY })).toBe(true)
    db.failNext({ table: 'training_reminders', operation: 'insert', message: 'duplicate key value violates unique constraint "training_reminders_claim"', times: 1 })
    expect(await TrainingService.claimReminder({ kind: 'staff_step', claimKey: 'step:a:assigned:2026-12-10', londonDate: TODAY })).toBe(false)
  })

  it('marking a claim that is not held throws rather than passing silently', async () => {
    await expect(TrainingService.setReminderStatus('missing', 'sent')).rejects.toThrow(/the claim is not held/)
  })
})

describe('publishDraftVersion', () => {
  const DRAFT = 'v2222222-2222-4222-8222-222222222222'
  const UPLOADED_AT = '2026-11-03T09:00:00.123+00:00'

  function seedDraft(): void {
    seed({
      training_course_versions: [{ id: DRAFT, course_id: ONLINE, state: 'draft', major: null, minor: null, content: onlineContent(), images: [], uploaded_at: UPLOADED_AT }],
    })
  }

  const input = (expectedUploadedAt: string) => ({
    courseId: ONLINE,
    draftVersionId: DRAFT,
    major: 1,
    minor: 0,
    changeNote: null,
    redoRequired: false,
    expectedUploadedAt,
    actor: { id: null, name: 'System' },
  })

  it('freezes the draft that was checked and leaves the course row to the publish action', async () => {
    seedDraft()
    const version = await TrainingService.publishDraftVersion(input(UPLOADED_AT))
    expect(version).toMatchObject({ id: DRAFT, state: 'published', major: 1, minor: 0 })
    expect(db.rows('training_course_versions')[0]).toMatchObject({ state: 'published', published_by_name: 'System' })
    // current_version_id moves with the course details in one update, so a publish that stops
    // here is seen as unfinished and Publish can finish it.
    expect(db.writes.filter((write) => write.table === 'training_courses')).toEqual([])
    expect(db.rows('training_courses')[0].current_version_id).toBeNull()
  })

  it('refuses a draft replaced since it was read (a new upload resets uploaded_at), freezing nothing', async () => {
    seedDraft()
    await expect(TrainingService.publishDraftVersion(input('2026-11-03T08:59:00.000+00:00'))).rejects.toMatchObject({
      code: 'conflict',
      message: 'The draft was replaced or published while you were looking at it. Refresh and try again.',
    })
    expect(db.rows('training_course_versions')[0]).toMatchObject({ state: 'draft', major: null })
  })

  it('says a version number already taken is a conflict', async () => {
    seedDraft()
    db.failNext({ table: 'training_course_versions', operation: 'update', message: 'duplicate key value violates unique constraint "training_course_versions_number"', times: 1 })
    await expect(TrainingService.publishDraftVersion(input(UPLOADED_AT))).rejects.toMatchObject({ code: 'conflict' })
  })
})

describe('hasCoursePublishedEvent', () => {
  it('finds the course_published line for that version only', async () => {
    seed({
      training_events: [
        { id: 'e1', event_type: 'course_published', course_id: ONLINE, meta: { versionId: 'v-1' }, created_at: '2026-11-01T09:00:00.000Z' },
        { id: 'e2', event_type: 'course_draft_uploaded', course_id: ONLINE, meta: { versionId: 'v-2' }, created_at: '2026-11-02T09:00:00.000Z' },
      ],
    })
    expect(await TrainingService.hasCoursePublishedEvent(ONLINE, 'v-1')).toBe(true)
    expect(await TrainingService.hasCoursePublishedEvent(ONLINE, 'v-2')).toBe(false)
    expect(await TrainingService.hasCoursePublishedEvent('c9999999-9999-4999-8999-999999999999', 'v-1')).toBe(false)
  })
})

describe('getPayReport', () => {
  it('counts check time and the minutes outside clocked or rostered shifts', async () => {
    seed({
      training_assignments: [assignmentRow()],
      training_attempts: [
        // 30 minutes, the first 15 before Sam clocked in.
        attemptRow('t1', '2026-11-09T10:00:00.000Z', '2026-11-09T10:30:00.000Z'),
        // 20 minutes during a shift that was cancelled, so all outside.
        attemptRow('t2', '2026-11-09T14:00:00.000Z', '2026-11-09T14:20:00.000Z'),
        // 20 minutes after midnight inside an overnight rostered shift.
        attemptRow('t3', '2026-11-10T00:10:00.000Z', '2026-11-10T00:30:00.000Z'),
        // Never submitted, and outside the range: neither counts.
        attemptRow('t4', '2026-11-09T16:00:00.000Z', null),
        attemptRow('t5', '2026-11-11T10:00:00.000Z', '2026-11-11T10:10:00.000Z'),
      ],
      timeclock_sessions: [
        { id: 's1', employee_id: SAM, work_date: '2026-11-09', clock_in_at: '2026-11-09T10:15:00.000Z', clock_out_at: '2026-11-09T12:00:00.000Z' },
      ],
      rota_published_shifts: [
        { id: 'r1', employee_id: SAM, shift_date: '2026-11-09', start_time: '13:00:00', end_time: '15:00:00', is_overnight: false, department: 'bar', status: 'cancelled' },
        { id: 'r2', employee_id: SAM, shift_date: '2026-11-09', start_time: '18:00:00', end_time: '01:00:00', is_overnight: true, department: 'bar', status: 'scheduled' },
      ],
    })

    const report = await TrainingService.getPayReport({ from: '2026-11-09', to: '2026-11-10' })
    expect(report.rows).toHaveLength(1)
    const [row] = report.rows
    expect(row).toMatchObject({ employeeId: SAM, name: 'Sam', minutesTotal: 70, minutesOutsideShifts: 35 })
    expect(row.entries.map((entry) => [entry.attemptId, entry.minutes, entry.minutesOutsideShifts])).toEqual([
      ['t1', 30, 15],
      ['t2', 20, 20],
      ['t3', 20, 0],
    ])
    expect(row.entries[0]).toMatchObject({ date: '2026-11-09', courseTitle: 'Allergen awareness' })
  })

  it('refuses a range the wrong way round', async () => {
    await expect(TrainingService.getPayReport({ from: '2026-11-10', to: '2026-11-01' })).rejects.toMatchObject({ code: 'invalid' })
  })
})

describe('getEmployeeTraining', () => {
  const PRACTICAL = 'c2222222-2222-4222-8222-222222222222'
  const NO_VERSION = 'c3333333-3333-4333-8333-333333333333'
  const KEGS_V1 = 'v1111111-1111-4111-8111-111111111111'
  const KEGS_V2 = 'v2222222-2222-4222-8222-222222222222'
  const A_KEGS = 'a2222222-2222-4222-8222-222222222222'
  const A_NO_VERSION = 'a3333333-3333-4333-8333-333333333333'
  const A_OLD = 'a5555555-5555-4555-8555-555555555555'

  const V1_TASKS = [
    { key: 'change-keg', text: 'Changes a keg safely.' },
    { key: 'clean-coupler', text: 'Cleans the coupler before fitting it.' },
  ]
  const V2_TASKS = [...V1_TASKS, { key: 'check-gas', text: 'Checks the gas is off first.' }]

  function practicalContent(tasks: Array<{ key: string; text: string }>): unknown {
    const result = validateCourse(
      {
        schemaVersion: 1,
        slug: 'kegs',
        title: 'Changing a keg',
        summary: 'A manager watches you change a keg safely.',
        kind: 'practical',
        audience: { groups: [], age: 'all' },
        deadline: { newStarterDays: null, existingStaffDays: null },
        refresherMonths: 12,
        prerequisite: null,
        legalBasis: 'MHOR 1992.',
        estimatedMinutes: 15,
        tasks,
      },
      { mode: 'publish' }
    )
    if (!result.ok) throw new Error(`fixture course is not valid: ${result.errors.join('; ')}`)
    return result.course
  }

  function versionRow(id: string, minor: number, tasks: Array<{ key: string; text: string }>): Record<string, unknown> {
    return {
      id,
      course_id: PRACTICAL,
      state: 'published',
      major: 1,
      minor,
      content: practicalContent(tasks),
      content_sha256: String(minor).repeat(64),
      images: [],
      change_note: null,
      redo_required: false,
      uploaded_by: null,
      uploaded_by_name: 'Test Manager',
      uploaded_at: '2026-10-01T09:00:00.000Z',
      published_by: null,
      published_by_name: 'Test Manager',
      published_at: `2026-10-0${minor + 1}T09:00:00.000Z`,
    }
  }

  function seedPractical(extra: Record<string, Array<Record<string, unknown>>> = {}): void {
    seed({
      training_courses: [
        courseRow(),
        courseRow({ id: PRACTICAL, slug: 'kegs', title: 'Changing a keg', kind: 'practical', is_essentials: false, current_version_id: KEGS_V2, display_order: 20 }),
        courseRow({ id: NO_VERSION, slug: 'gas', title: 'Changing a gas cylinder', kind: 'practical', is_essentials: false, current_version_id: null, display_order: 30 }),
      ],
      training_course_versions: [versionRow(KEGS_V1, 0, V1_TASKS), versionRow(KEGS_V2, 1, V2_TASKS)],
      ...extra,
    })
  }

  function currentItem(view: Awaited<ReturnType<typeof TrainingService.getEmployeeTraining>>, assignmentId: string) {
    const found = view?.current.find((entry) => entry.assignment.id === assignmentId)
    if (!found) throw new Error(`no current item ${assignmentId}`)
    return found
  }

  it('gives a practical item the tasks of the version its cycle is pinned to', async () => {
    seedPractical({
      training_assignments: [
        assignmentRow({ id: A_KEGS, course_id: PRACTICAL, status: 'declined', version_id: KEGS_V1, due_on: null }),
      ],
    })
    const view = await TrainingService.getEmployeeTraining(SAM, { today: TODAY })
    expect(currentItem(view, A_KEGS).tasks).toEqual(V1_TASKS)
  })

  it("falls back to the course's current published version when the cycle is not pinned yet", async () => {
    seedPractical({
      training_assignments: [assignmentRow({ id: A_KEGS, course_id: PRACTICAL, status: 'assigned', version_id: null, due_on: null })],
    })
    const view = await TrainingService.getEmployeeTraining(SAM, { today: TODAY })
    expect(currentItem(view, A_KEGS).tasks).toEqual(V2_TASKS)
  })

  it('has no tasks for an online item, or for a practical course with nothing published', async () => {
    seedPractical({
      training_assignments: [
        assignmentRow(),
        assignmentRow({ id: A_NO_VERSION, course_id: NO_VERSION, status: 'assigned', version_id: null, due_on: null }),
      ],
    })
    const view = await TrainingService.getEmployeeTraining(SAM, { today: TODAY })
    expect(currentItem(view, A_SAM).tasks).toBeNull()
    expect(currentItem(view, A_NO_VERSION).tasks).toBeNull()
  })

  it('shows an open refresher as expired once the last completion has expired, on the record and the matrix', async () => {
    seed({
      training_assignments: [
        assignmentRow({
          id: A_OLD,
          cycle: 1,
          status: 'completed',
          assigned_on: '2025-10-01',
          due_on: '2025-10-15',
          completed_on: '2025-11-01',
          expires_on: '2026-11-01',
          window_opens_on: '2026-10-02',
          created_at: '2025-10-01T09:00:00.000Z',
        }),
        assignmentRow({ cycle: 2, reason: 'refresher', assigned_on: '2026-10-02', due_on: '2026-11-30' }),
      ],
    })
    const view = await TrainingService.getEmployeeTraining(SAM, { today: TODAY })
    expect(currentItem(view, A_SAM).state).toBe('expired')
    expect(view?.history.map((entry) => entry.assignment.id)).toEqual([A_OLD])

    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people[0].cells[ONLINE]).toMatchObject({ state: 'expired', assignmentId: A_SAM, dueOn: '2026-11-30', daysOverdue: null })
  })

  it('keeps the ordinary state for an open refresher while the last completion is still in date', async () => {
    seed({
      training_assignments: [
        assignmentRow({ id: A_OLD, cycle: 1, status: 'completed', completed_on: '2025-11-20', expires_on: '2026-11-20', window_opens_on: '2026-10-21' }),
        assignmentRow({ cycle: 2, reason: 'refresher', assigned_on: '2026-10-21', due_on: '2026-11-20' }),
      ],
    })
    const view = await TrainingService.getEmployeeTraining(SAM, { today: TODAY })
    expect(currentItem(view, A_SAM).state).toBe('not_started')
  })
})

// ---------------------------------------------------------------------------------------------
// Fixtures for the reads below: an online course with a published version
// ---------------------------------------------------------------------------------------------

const V_ONLINE = 'v3333333-3333-4333-8333-333333333333'
const V_DRAFT = 'v4444444-4444-4444-8444-444444444444'
const PRACTICAL_COURSE = 'c2222222-2222-4222-8222-222222222222'
const LEAVER = '55555555-5555-4555-8555-555555555555'

function onlineSection(key: string): Record<string, unknown> {
  const question = (id: string, objective: string, critical = false) => ({
    id,
    objective,
    critical,
    prompt: `A customer asks about ${id}. What do you do?`,
    options: ['Tell them to wait', 'Help them straight away', 'Ignore it'],
    answer: 1,
    explanation: 'Help them straight away. It is quicker and safer.',
  })
  return {
    key,
    title: `Section ${key}`,
    objectives: [
      { key: 'first-aim', text: 'Do the first thing well' },
      { key: 'second-aim', text: 'Do the second thing well' },
    ],
    cards: [
      { type: 'paragraph', text: 'One idea on this card.' },
      { type: 'paragraph', text: 'A second idea on this card.' },
    ],
    questions: [
      question(`${key}-01`, 'first-aim', true),
      question(`${key}-02`, 'first-aim', true),
      question(`${key}-03`, 'first-aim'),
      question(`${key}-04`, 'first-aim'),
      question(`${key}-05`, 'second-aim'),
      question(`${key}-06`, 'second-aim'),
      question(`${key}-07`, 'second-aim'),
      question(`${key}-08`, 'second-aim'),
    ],
  }
}

function onlineContent(summary = 'The things everyone needs on their first shift.'): unknown {
  const result = validateCourse(
    {
      schemaVersion: 1,
      slug: 'allergens',
      title: 'Allergen awareness',
      summary,
      kind: 'online',
      audience: { groups: [], age: 'all' },
      essentials: true,
      deadline: { newStarterDays: 14, existingStaffDays: 30 },
      refresherMonths: 12,
      windowDays: 30,
      prerequisite: null,
      legalBasis: 'Food Information Regulations 2014.',
      estimatedMinutes: 20,
      sections: [onlineSection('fire'), onlineSection('allergy')],
    },
    { mode: 'draft' }
  )
  if (!result.ok) throw new Error(`fixture course is not valid: ${result.errors.join('; ')}`)
  return result.course
}

function practicalContentFor(): unknown {
  const result = validateCourse(
    {
      schemaVersion: 1,
      slug: 'kegs',
      title: 'Changing a keg',
      summary: 'A manager watches you change a keg safely.',
      kind: 'practical',
      audience: { groups: [], age: 'all' },
      deadline: { newStarterDays: null, existingStaffDays: null },
      refresherMonths: 12,
      prerequisite: null,
      legalBasis: 'MHOR 1992.',
      estimatedMinutes: 15,
      tasks: [{ key: 'change-keg', text: 'Changes a keg safely.' }],
    },
    { mode: 'publish' }
  )
  if (!result.ok) throw new Error(`fixture course is not valid: ${result.errors.join('; ')}`)
  return result.course
}

function versionRowFor(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: V_ONLINE,
    course_id: ONLINE,
    state: 'published',
    major: 1,
    minor: 0,
    content: onlineContent(),
    content_sha256: 'a'.repeat(64),
    images: [],
    change_note: null,
    redo_required: false,
    uploaded_by: null,
    uploaded_by_name: 'Test Manager',
    uploaded_at: '2026-10-01T09:00:00.000Z',
    published_by: null,
    published_by_name: 'Test Manager',
    published_at: '2026-10-01T09:00:00.000Z',
    ...overrides,
  }
}

/** Seeds the online course with its published version, plus the given tables. */
function seedOnline(extra: Record<string, Array<Record<string, unknown>>> = {}): void {
  seed({
    training_courses: [courseRow({ current_version_id: V_ONLINE })],
    training_course_versions: [versionRowFor()],
    ...extra,
  })
}

function addLeaver(): void {
  db.rows('employees').push({
    employee_id: LEAVER,
    first_name: 'Lee',
    last_name: 'Leaver',
    preferred_name: null,
    status: 'Started Separation',
    job_title: 'Bartender',
    employment_start_date: '2024-01-01',
    date_of_birth: '1995-01-01',
    email_address: 'lee@example.test',
    auth_user_id: 'u-lee',
  })
}

// ---------------------------------------------------------------------------------------------
// DR-5: the matrix for someone working their notice
// ---------------------------------------------------------------------------------------------

describe('getMatrix for someone working their notice (Started Separation)', () => {
  const A_LEAVER = 'a5555555-5555-4555-8555-555555555555'
  const completion = (expiresOn: string, windowOpensOn: string) =>
    assignmentRow({ id: A_LEAVER, employee_id: LEAVER, status: 'completed', completed_on: '2025-11-01', expires_on: expiresOn, window_opens_on: windowOpensOn })

  it.each([
    ['an expired completion as expired, as they may still be working shifts', [completion('2026-11-09', '2026-10-10')], 'expired'],
    ['a completion inside its refresher window as done, as no refresher will be opened', [completion('2026-11-20', '2026-10-21')], 'done'],
    ['a completion in date as done', [completion('2027-05-01', '2027-04-01')], 'done'],
    ['nothing as not required, as no new cycle will be opened', [], 'not_required'],
    ['an open cycle as usual', [assignmentRow({ id: A_LEAVER, employee_id: LEAVER, status: 'assigned', due_on: '2026-11-05' })], 'overdue'],
  ])('shows %s', async (_label, cycles, state) => {
    seed({ training_assignments: cycles })
    addLeaver()
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    const leaver = matrix.people.find((person) => person.employeeId === LEAVER)
    expect(leaver?.status).toBe('Started Separation')
    expect(leaver?.cells[ONLINE].state).toBe(state)
  })

  it('keeps not required for an expired completion on a course no longer in their audience', async () => {
    seed({ training_courses: [courseRow({ audience_groups: ['kitchen'] })], training_assignments: [completion('2026-11-09', '2026-10-10')] })
    addLeaver()
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people.find((person) => person.employeeId === LEAVER)?.cells[ONLINE].state).toBe('not_required')
  })

  it('leaves Active staff as they were: an expired completion is expired, one inside its window is a refresher due', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'completed', completed_on: '2025-11-20', expires_on: '2026-11-20', window_opens_on: '2026-10-21' })] })
    expect((await TrainingService.getMatrix({ today: TODAY })).people[0].cells[ONLINE].state).toBe('refresher_due')
  })
})

// ---------------------------------------------------------------------------------------------
// DR-3: a sign-off counts only while the course it depends on is valid (spec 4.1)
// ---------------------------------------------------------------------------------------------

describe('a sign-off whose prerequisite has lapsed', () => {
  const A_PREREQ = 'a6666666-6666-4666-8666-666666666666'
  const A_SIGNOFF = 'a7777777-7777-4777-8777-777777777777'

  function seedSignoff(prerequisiteExpiresOn: string, extra: Array<Record<string, unknown>> = []): void {
    seed({
      training_courses: [
        courseRow(),
        courseRow({ id: PRACTICAL_COURSE, slug: 'kegs', title: 'Changing a keg', kind: 'practical', is_essentials: false, prerequisite_course_id: ONLINE, display_order: 20 }),
      ],
      training_assignments: [
        // The prerequisite, completed; it is in date or not depending on the case.
        assignmentRow({ id: A_PREREQ, status: 'completed', completed_on: '2025-11-01', expires_on: prerequisiteExpiresOn, window_opens_on: '2026-10-01', due_on: null }),
        // The sign-off itself, completed and still in date.
        assignmentRow({
          id: A_SIGNOFF,
          course_id: PRACTICAL_COURSE,
          status: 'completed',
          completed_on: '2026-06-01',
          expires_on: '2027-06-01',
          window_opens_on: '2027-05-02',
          due_on: null,
        }),
        ...extra,
      ],
    })
  }

  it('shows the sign-off as waiting in the matrix and leaves it out of the completed count', async () => {
    seedSignoff('2026-11-01')
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people[0].cells[PRACTICAL_COURSE].state).toBe('waiting')
    expect(matrix.courses.find((course) => course.id === PRACTICAL_COURSE)).toMatchObject({ requiredCount: 1, completedCount: 0 })
  })

  it('counts it as done again while the prerequisite is in date', async () => {
    seedSignoff('2026-12-01')
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people[0].cells[PRACTICAL_COURSE].state).toBe('done')
    expect(matrix.courses.find((course) => course.id === PRACTICAL_COURSE)).toMatchObject({ requiredCount: 1, completedCount: 1 })
  })

  it('lists it under Done on My Training with the waiting state', async () => {
    seedSignoff('2026-11-01')
    const view = await TrainingService.getMyTraining(SAM, { today: TODAY })
    expect(view.done.find((item) => item.course.id === PRACTICAL_COURSE)?.state).toBe('waiting')
  })

  it('counts it as done while a waived refresher of the prerequisite covers its period', async () => {
    // The prerequisite expired on 1 November 2026, but that year's refresher was waived.
    seedSignoff('2026-11-01', [
      assignmentRow({ id: 'a8888888-8888-4888-8888-888888888888', cycle: 2, reason: 'refresher', status: 'waived', due_on: '2026-11-01' }),
    ])
    const matrix = await TrainingService.getMatrix({ today: TODAY })
    expect(matrix.people[0].cells[PRACTICAL_COURSE].state).toBe('done')
    expect(matrix.courses.find((course) => course.id === PRACTICAL_COURSE)).toMatchObject({ requiredCount: 1, completedCount: 1 })
    const view = await TrainingService.getMyTraining(SAM, { today: TODAY })
    expect(view.done.find((item) => item.course.id === PRACTICAL_COURSE)?.state).toBe('done')
  })
})

// ---------------------------------------------------------------------------------------------
// DR-7: a released waiting cycle is assigned from the release
// ---------------------------------------------------------------------------------------------

describe('releasing a waiting cycle', () => {
  const FIRST = 'c9999999-9999-4999-8999-999999999999'
  const A_FIRST = 'a9999999-9999-4999-8999-999999999999'

  it('counts the assignment from the release, so the nudge comes 3 days after it', async () => {
    seed({
      training_courses: [
        courseRow({ id: FIRST, slug: 'essentials', title: 'Essentials', display_order: 1 }),
        courseRow({ is_essentials: false, prerequisite_course_id: FIRST }),
      ],
      training_assignments: [
        assignmentRow({ id: A_FIRST, course_id: FIRST, status: 'completed', completed_on: '2026-11-09', expires_on: '2027-11-09', window_opens_on: '2027-10-10' }),
        assignmentRow({ status: 'waiting', assigned_on: '2026-09-01', due_on: null }),
      ],
    })

    expect(await TrainingService.syncAssignments({ today: TODAY })).toMatchObject({ updated: 1 })
    expect(db.rows('training_assignments').find((row) => row.id === A_SAM)).toMatchObject({
      status: 'assigned',
      assigned_on: TODAY,
      due_on: '2026-11-24',
    })
    expect(events('assigned')).toEqual([
      expect.objectContaining({ assignment_id: A_SAM, note_code: 'prerequisite_met', meta: { released: true, assignedOn: TODAY, dueOn: '2026-11-24' } }),
    ])

    const people = await TrainingService.getStaffReminderPeople(TODAY)
    expect(people[0].items).toEqual([expect.objectContaining({ assignmentId: A_SAM, assignedOn: TODAY, dueOn: '2026-11-24' })])

    const plan = (today: string, claims: ReadonlySet<string>) =>
      planStaffReminders({ today, emailsEnabled: true, suspended: false, people, existingClaims: claims })
    const first = plan(TODAY, new Set())
    expect(first.emails[0].steps).toEqual([expect.objectContaining({ step: 'assigned', alsoClaims: [] })])
    const claims = new Set(staffEmailClaimKeys(first.emails[0]))
    expect(plan('2026-11-12', claims).emails).toEqual([])
    expect(plan('2026-11-13', claims).emails[0].steps).toEqual([expect.objectContaining({ assignmentId: A_SAM, step: 'nudge' })])
  })
})

// ---------------------------------------------------------------------------------------------
// Signing document status as it stands now
// ---------------------------------------------------------------------------------------------

describe('signing document status', () => {
  function seedAwaiting(document: Record<string, unknown>): void {
    seedOnline({
      training_assignments: [assignmentRow({ status: 'awaiting_confirmation', version_id: V_ONLINE, signing_document_id: 'doc-1' })],
      signing_documents: [{ id: 'doc-1', kind: 'training_completion', ...document }],
      signing_parties: [{ id: 'party-1', document_id: 'doc-1', employee_id: SAM, role: 'worker' }],
    })
  }

  it('reads a document still open past its link expiry as expired, before the daily sweep marks it', async () => {
    seedAwaiting({ status: 'sent', expires_at: '2026-01-01T09:00:00.000Z' })
    expect(await TrainingService.getSigningDocumentStatus('doc-1')).toBe('expired')
    const view = await TrainingService.getEmployeeTraining(SAM, { today: TODAY })
    expect(view?.current[0].certificate).toEqual({ documentId: 'doc-1', status: 'expired' })
    // The learner is offered a new confirmation, not a link to one that can no longer be signed.
    expect((await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY }))?.confirmation).toEqual({ state: 'retry', confirmUrl: null })
  })

  it('keeps an open document in date as it is, and offers the learner its page', async () => {
    seedAwaiting({ status: 'sent', expires_at: '2099-01-01T09:00:00.000Z' })
    expect(await TrainingService.getSigningDocumentStatus('doc-1')).toBe('sent')
    expect((await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY }))?.confirmation).toEqual({
      state: 'ready',
      confirmUrl: '/portal/documents/party-1',
    })
  })

  it('leaves a closed document as it is, whatever its expiry, and says null for a missing one', async () => {
    seedAwaiting({ status: 'completed', expires_at: '2026-01-01T09:00:00.000Z' })
    expect(await TrainingService.getSigningDocumentStatus('doc-1')).toBe('completed')
    expect(await TrainingService.getSigningDocumentStatus('doc-missing')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// The portal reads
// ---------------------------------------------------------------------------------------------

describe('getMyAssignment', () => {
  it("returns the worker's own open online cycle with cards and no questions", async () => {
    seedOnline({ training_assignments: [assignmentRow({ status: 'in_progress', started_at: '2026-11-05T10:00:00.000Z' })] })
    const view = await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY })
    expect(view).toMatchObject({ assignmentId: A_SAM, courseId: ONLINE, status: 'in_progress', state: 'due_soon', confirmation: { state: 'not_ready' } })
    expect(view?.course.sections.map((section) => section.key)).toEqual(['fire', 'allergy'])
    expect(view?.sectionStates).toEqual({ fire: 'open', allergy: 'not_open' })
    expect(JSON.stringify(view)).not.toMatch(/explanation|"answer"/)
  })

  it("is null for another person's cycle", async () => {
    seedOnline({ training_assignments: [assignmentRow()] })
    expect(await TrainingService.getMyAssignment(FORMER, A_SAM, { today: TODAY })).toBeNull()
  })

  it.each(['completed', 'waived', 'cancelled'])('is null for a %s cycle', async (status) => {
    seedOnline({ training_assignments: [assignmentRow({ status })] })
    expect(await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY })).toBeNull()
  })

  it('is null for a practical course with nothing published, and for an external qualification', async () => {
    seedOnline({
      training_courses: [courseRow({ current_version_id: V_ONLINE }), courseRow({ id: PRACTICAL_COURSE, slug: 'kegs', kind: 'practical', current_version_id: null })],
      training_assignments: [assignmentRow({ course_id: PRACTICAL_COURSE })],
    })
    expect(await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY })).toBeNull()

    db.rows('training_courses').find((row) => row.id === PRACTICAL_COURSE)!.kind = 'external'
    expect(await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY })).toBeNull()
  })

  describe('a practical course, opened to read its notes', () => {
    const V_PRACTICAL = 'v5555555-5555-4555-8555-555555555555'

    function seedPracticalItem(assignment: Record<string, unknown>, extra: Record<string, Array<Record<string, unknown>>> = {}): void {
      seedOnline({
        training_courses: [
          courseRow({ current_version_id: V_ONLINE }),
          courseRow({ id: PRACTICAL_COURSE, slug: 'kegs', title: 'Changing a keg', kind: 'practical', current_version_id: V_PRACTICAL }),
        ],
        training_course_versions: [versionRowFor(), versionRowFor({ id: V_PRACTICAL, course_id: PRACTICAL_COURSE, content: practicalContentFor() })],
        training_assignments: [assignmentRow({ course_id: PRACTICAL_COURSE, due_on: null, ...assignment })],
        ...extra,
      })
    }

    it('comes back with its notes and no sections', async () => {
      seedPracticalItem({ status: 'assigned' })
      const view = await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY })
      expect(view).toMatchObject({ assignmentId: A_SAM, courseId: PRACTICAL_COURSE, confirmation: { state: 'not_ready', confirmUrl: null } })
      expect(view?.course).toMatchObject({ versionId: V_PRACTICAL, kind: 'practical', title: 'Changing a keg', sections: [] })
      expect(view?.sectionStates).toEqual({})
    })

    it('never offers a confirm link: the sign-off is confirmed in person', async () => {
      seedPracticalItem(
        { status: 'awaiting_confirmation', version_id: V_PRACTICAL, signing_document_id: 'doc-signoff' },
        {
          signing_documents: [{ id: 'doc-signoff', kind: 'training_signoff', status: 'part_signed', expires_at: '2026-12-10T12:00:00.000Z' }],
          signing_parties: [{ id: 'party-signoff', document_id: 'doc-signoff', employee_id: SAM, role: 'worker' }],
        }
      )
      expect((await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY }))?.confirmation).toEqual({ state: 'not_ready', confirmUrl: null })
    })

    it('shows a declined sign-off as declined', async () => {
      seedPracticalItem({ status: 'declined', version_id: V_PRACTICAL })
      expect((await TrainingService.getMyAssignment(SAM, A_SAM, { today: TODAY }))?.confirmation).toEqual({ state: 'declined', confirmUrl: null })
    })
  })
})

describe('getMyTraining', () => {
  it('sorts open, waiting and done items, and lists a completion under done with its certificate', async () => {
    const WAITS = 'c7777777-7777-4777-8777-777777777777'
    const DONE = 'c8888888-8888-4888-8888-888888888888'
    seedOnline({
      training_courses: [
        courseRow({ current_version_id: V_ONLINE }),
        courseRow({ id: WAITS, slug: 'walkthrough', title: 'Walkthrough', is_essentials: false }),
        courseRow({ id: DONE, slug: 'fire', title: 'Fire safety', is_essentials: false }),
      ],
      training_assignments: [
        assignmentRow(),
        assignmentRow({ id: 'a7777777-7777-4777-8777-777777777777', course_id: WAITS, status: 'waiting', due_on: null }),
        assignmentRow({
          id: 'a8888888-8888-4888-8888-888888888888',
          course_id: DONE,
          status: 'completed',
          completed_on: '2026-10-01',
          expires_on: '2027-10-01',
          window_opens_on: '2027-09-01',
          signing_document_id: 'doc-done',
        }),
      ],
      signing_parties: [{ id: 'party-done', document_id: 'doc-done', employee_id: SAM, role: 'worker' }],
    })
    const view = await TrainingService.getMyTraining(SAM, { today: TODAY })
    expect(view.due.map((item) => [item.assignmentId, item.action, item.sectionsTotal])).toEqual([[A_SAM, 'start', 2]])
    expect(view.waiting.map((item) => [item.course.id, item.waitingReason])).toEqual([[WAITS, 'prerequisite']])
    expect(view.done.map((item) => [item.course.id, item.state, item.certificatePartyId])).toEqual([[DONE, 'done', 'party-done']])
  })

  it('is empty for someone with no training', async () => {
    expect(await TrainingService.getMyTraining(SAM, { today: TODAY })).toEqual({ today: TODAY, due: [], waiting: [], done: [] })
  })
})

describe('getPlayerCourse', () => {
  it('returns an online or a practical version for the preview player, and null for an unknown one', async () => {
    seedOnline({
      training_course_versions: [versionRowFor(), versionRowFor({ id: V_DRAFT, course_id: PRACTICAL_COURSE, content: practicalContentFor() })],
    })
    expect(await TrainingService.getPlayerCourse(V_ONLINE)).toMatchObject({ versionId: V_ONLINE, versionLabel: '1.0', imageBaseUrl: `/api/training/images/${V_ONLINE}/` })
    // A practical course previews its notes: it has tasks, not sections.
    expect(await TrainingService.getPlayerCourse(V_DRAFT)).toMatchObject({ versionId: V_DRAFT, kind: 'practical', title: 'Changing a keg', sections: [] })
    expect(await TrainingService.getPlayerCourse('v0000000-0000-4000-8000-000000000000')).toBeNull()
  })
})

describe('employeeCanSeeVersion (the course image check)', () => {
  it('allows a published version of a course the person has any cycle on', async () => {
    seedOnline({ training_assignments: [assignmentRow({ status: 'completed' })] })
    expect(await TrainingService.employeeCanSeeVersion(SAM, V_ONLINE)).toBe(true)
  })

  it('refuses a draft, an unknown version, and a course the person has no cycle on', async () => {
    seedOnline({
      training_course_versions: [versionRowFor(), versionRowFor({ id: V_DRAFT, state: 'draft', major: null, minor: null })],
      training_assignments: [assignmentRow()],
    })
    expect(await TrainingService.employeeCanSeeVersion(SAM, V_DRAFT)).toBe(false)
    expect(await TrainingService.employeeCanSeeVersion(SAM, 'v0000000-0000-4000-8000-000000000000')).toBe(false)
    expect(await TrainingService.employeeCanSeeVersion(FORMER, V_ONLINE)).toBe(false)
  })
})

// ---------------------------------------------------------------------------------------------
// Attempts
// ---------------------------------------------------------------------------------------------

describe('attempts', () => {
  const served = [{ questionId: 'fire-01', optionOrder: [2, 0, 1] }]
  const newAttempt = { assignmentId: A_SAM, employeeId: SAM, versionId: V_ONLINE, sectionKey: 'fire', attemptNo: 1, served }

  it('starts a check and returns it again while it is open', async () => {
    seedOnline({ training_assignments: [assignmentRow({ status: 'in_progress' })] })
    const attempt = await TrainingService.createAttempt(newAttempt)
    expect(attempt).toMatchObject({ assignmentId: A_SAM, sectionKey: 'fire', attemptNo: 1, served, submittedAt: null })
    expect((await TrainingService.getOpenAttempt(A_SAM, 'fire'))?.id).toBe(attempt.id)
    expect(await TrainingService.getOpenAttempt(A_SAM, 'allergy')).toBeNull()
  })

  it('refuses a second open check for the same section as a conflict', async () => {
    db.failNext({ table: 'training_attempts', operation: 'insert', message: 'duplicate key value violates unique constraint "training_attempts_one_open"', times: 1 })
    await expect(TrainingService.createAttempt(newAttempt)).rejects.toMatchObject({
      code: 'conflict',
      message: 'A check for this section is already open. Reload the page to carry on with it.',
    })
  })

  it('records the marking once; a second submit is a conflict and an unknown check is not found', async () => {
    const attempt = await TrainingService.createAttempt(newAttempt)
    const marking = { submittedAt: '2026-11-10T10:05:00.000Z', answers: { 'fire-01': 0 }, results: [], wrongCount: 0, criticalMissed: 0, passed: true }
    expect(await TrainingService.submitAttempt(attempt.id, marking)).toMatchObject({ id: attempt.id, passed: true, wrongCount: 0 })
    expect(await TrainingService.getOpenAttempt(A_SAM, 'fire')).toBeNull()
    await expect(TrainingService.submitAttempt(attempt.id, marking)).rejects.toMatchObject({ code: 'conflict', message: 'This check was already submitted.' })
    await expect(TrainingService.submitAttempt('t-missing', marking)).rejects.toMatchObject({ code: 'not_found' })
  })
})

// ---------------------------------------------------------------------------------------------
// Courses and versions
// ---------------------------------------------------------------------------------------------

describe('course reads and writes', () => {
  const newCourse = {
    slug: 'allergens',
    title: 'Allergen awareness',
    kind: 'online' as const,
    audienceGroups: [],
    audienceAge: 'all' as const,
    isEssentials: true,
    prerequisiteCourseId: null,
    newStarterDueDays: 14,
    existingStaffDueDays: 30,
    refresherMonths: 12,
    windowDays: 30,
    supervisedOnlyUnder18: false,
    summary: null,
    actor: { id: null, name: 'System' },
  }

  it('creates a draft course and refuses a short name already taken', async () => {
    seed({ training_courses: [] })
    const created = await TrainingService.createCourse({ ...newCourse, slug: 'fire' })
    expect(created).toMatchObject({ slug: 'fire', status: 'draft', displayOrder: 100 })
    db.failNext({ table: 'training_courses', operation: 'insert', message: 'duplicate key value violates unique constraint "training_courses_slug_key"', times: 1 })
    await expect(TrainingService.createCourse(newCourse)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('updates only the fields given and says not found for a missing course', async () => {
    const updated = await TrainingService.updateCourse(ONLINE, { title: 'Allergens 2026', refresherMonths: 24 })
    expect(updated).toMatchObject({ title: 'Allergens 2026', refresherMonths: 24, windowDays: 30 })
    await expect(TrainingService.updateCourse('c0000000-0000-4000-8000-000000000000', { title: 'x' })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('reads the current version, and none for a course with nothing published', async () => {
    seedOnline()
    expect((await TrainingService.getCurrentVersion(ONLINE))?.id).toBe(V_ONLINE)
    db.rows('training_courses')[0].current_version_id = null
    expect(await TrainingService.getCurrentVersion(ONLINE)).toBeNull()
  })

  it('saves a draft, then replaces that same draft on the next upload, never making a second', async () => {
    seedOnline()
    const draftInput = { courseId: ONLINE, content: onlineContent() as never, contentSha256: 'b'.repeat(64), images: [], actor: { id: null, name: 'System' } }
    const first = await TrainingService.saveDraftVersion(draftInput)
    expect(first).toMatchObject({ state: 'draft', courseId: ONLINE })
    const second = await TrainingService.saveDraftVersion({ ...draftInput, contentSha256: 'c'.repeat(64) })
    expect(second.id).toBe(first.id)
    expect(second.contentSha256).toBe('c'.repeat(64))
    expect(db.rows('training_course_versions').filter((row) => row.state === 'draft')).toHaveLength(1)
    // The published version is never touched.
    expect(db.rows('training_course_versions').find((row) => row.id === V_ONLINE)).toMatchObject({ state: 'published', content_sha256: 'a'.repeat(64) })
  })

  it('reports two first drafts at the same moment as a conflict', async () => {
    db.failNext({ table: 'training_course_versions', operation: 'insert', message: 'duplicate key value violates unique constraint "training_course_versions_one_draft"', times: 1 })
    await expect(
      TrainingService.saveDraftVersion({ courseId: ONLINE, content: onlineContent() as never, contentSha256: 'b'.repeat(64), images: [], actor: { id: null, name: 'System' } })
    ).rejects.toMatchObject({ code: 'conflict' })
  })

  it('lists courses with their current version, draft and counts', async () => {
    seedOnline({
      training_course_versions: [versionRowFor(), versionRowFor({ id: V_DRAFT, state: 'draft', major: null, minor: null, uploaded_at: '2026-11-02T09:00:00.000Z' })],
      training_assignments: [
        assignmentRow(),
        assignmentRow({ id: 'a6666666-6666-4666-8666-666666666666', employee_id: FORMER, status: 'completed', expires_on: '2099-01-01' }),
      ],
    })
    const [item] = await TrainingService.listCourseItems()
    expect(item).toMatchObject({
      id: ONLINE,
      currentVersion: { id: V_ONLINE, major: 1, minor: 0 },
      hasDraft: true,
      draftUploadedAt: '2026-11-02T09:00:00.000Z',
      assignedCount: 1,
      completedCount: 1,
    })
  })

  it('shows a course page with its draft checked in publish mode, so a gap blocks publishing', async () => {
    seedOnline({
      training_course_versions: [
        versionRowFor(),
        versionRowFor({ id: V_DRAFT, state: 'draft', major: null, minor: null, content: onlineContent('Ring [[TO CONFIRM: number]] first.') }),
      ],
      training_assignments: [assignmentRow({ status: 'locked', due_on: '2020-01-01' })],
    })
    const detail = await TrainingService.getCourseDetail('allergens')
    expect(detail?.current?.id).toBe(V_ONLINE)
    expect(detail?.versions.map((version) => version.id)).toEqual([V_ONLINE])
    expect(detail?.draft).toMatchObject({ version: { id: V_DRAFT }, publishable: false })
    expect(detail?.draft?.errors).toEqual([expect.stringContaining('fill in [[TO CONFIRM: number]] before publishing')])
    expect(detail?.stats).toMatchObject({ open: 1, locked: 1, overdue: 1 })
    expect(await TrainingService.getCourseDetail('nope')).toBeNull()
  })
})

// ---------------------------------------------------------------------------------------------
// Daily job reads
// ---------------------------------------------------------------------------------------------

describe('daily job reads', () => {
  it('lists online items awaiting confirmation with no document as certificate retries, and nothing else', async () => {
    seedOnline({
      training_courses: [courseRow({ current_version_id: V_ONLINE }), courseRow({ id: PRACTICAL_COURSE, slug: 'kegs', kind: 'practical' })],
      training_assignments: [
        assignmentRow({ status: 'awaiting_confirmation' }),
        assignmentRow({ id: 'a2222222-2222-4222-8222-222222222222', course_id: PRACTICAL_COURSE, status: 'awaiting_confirmation' }),
        assignmentRow({ id: 'a3333333-3333-4333-8333-333333333333', employee_id: FORMER, status: 'awaiting_confirmation', signing_document_id: 'doc-1' }),
      ],
    })
    expect((await TrainingService.listCertificateRetries()).map((assignment) => assignment.id)).toEqual([A_SAM])
  })

  it('finalises only items whose document was confirmed or declined', async () => {
    seedOnline({
      training_assignments: [
        assignmentRow({ status: 'awaiting_confirmation', signing_document_id: 'doc-done' }),
        assignmentRow({ id: 'a2222222-2222-4222-8222-222222222222', employee_id: FORMER, status: 'awaiting_confirmation', signing_document_id: 'doc-no' }),
        assignmentRow({ id: 'a3333333-3333-4333-8333-333333333333', employee_id: LEAVER, status: 'awaiting_confirmation', signing_document_id: 'doc-open' }),
      ],
      signing_documents: [
        { id: 'doc-done', status: 'completed', expires_at: '2099-01-01T00:00:00.000Z' },
        { id: 'doc-no', status: 'declined', expires_at: '2099-01-01T00:00:00.000Z' },
        { id: 'doc-open', status: 'sent', expires_at: '2099-01-01T00:00:00.000Z' },
      ],
    })
    const settled = await TrainingService.listConfirmationsToFinalise()
    expect(settled.map((entry) => [entry.assignment.id, entry.documentStatus])).toEqual([
      [A_SAM, 'completed'],
      ['a2222222-2222-4222-8222-222222222222', 'declined'],
    ])
    expect((await TrainingService.findAssignmentBySigningDocument('doc-open'))?.id).toBe('a3333333-3333-4333-8333-333333333333')
    expect(await TrainingService.findAssignmentBySigningDocument('doc-none')).toBeNull()
  })

  it('gives the staff ladder each in-scope person with their open online items, paused from a London date', async () => {
    seedOnline({
      training_courses: [courseRow({ current_version_id: V_ONLINE }), courseRow({ id: PRACTICAL_COURSE, slug: 'kegs', kind: 'practical' })],
      training_assignments: [
        assignmentRow({ status: 'awaiting_confirmation', signing_document_id: 'doc-1' }),
        assignmentRow({ id: 'a2222222-2222-4222-8222-222222222222', course_id: PRACTICAL_COURSE }),
        assignmentRow({ id: 'a3333333-3333-4333-8333-333333333333', employee_id: FORMER }),
      ],
      training_profiles: [{ employee_id: SAM, groups: [], paused_from: TODAY, paused_until: null, pause_reason: 'other' }],
      signing_documents: [{ id: 'doc-1', status: 'completed', expires_at: '2099-01-01T00:00:00.000Z' }],
      email_suppressions: [{ email: 'sam@example.test' }],
    })
    const people = await TrainingService.getStaffReminderPeople(TODAY)
    expect(people).toHaveLength(1)
    expect(people[0]).toMatchObject({ employeeId: SAM, name: 'Sam', paused: true, emailSuppressed: true, hasLogin: true })
    expect(people[0].items).toEqual([
      expect.objectContaining({ assignmentId: A_SAM, courseKind: 'online', confirmationSettled: true, progress: { sectionsPassed: 0, sectionsTotal: 2, currentSectionTitle: null } }),
    ])
    // The day before the pause starts, they are not paused.
    expect((await TrainingService.getStaffReminderPeople('2026-11-09'))[0].paused).toBe(false)
  })

  it('gives the manager email its snapshot: open items, people and certificates that could not be prepared', async () => {
    const A_LEAVER = 'a5555555-5555-4555-8555-555555555555'
    seedOnline({
      training_assignments: [
        assignmentRow({ status: 'locked', locked_section: 'fire', locked_at: '2026-11-08T10:00:00.000Z' }),
        assignmentRow({ id: 'a3333333-3333-4333-8333-333333333333', employee_id: FORMER }),
        assignmentRow({ id: A_LEAVER, employee_id: LEAVER, status: 'awaiting_confirmation' }),
      ],
    })
    addLeaver()
    const snapshot = await TrainingService.getManagerDailySnapshot(TODAY)
    expect(snapshot.assignments.map((item) => [item.employeeId, item.status, item.lockedSection])).toEqual([
      [SAM, 'locked', 'fire'],
      [LEAVER, 'awaiting_confirmation', null],
    ])
    expect(snapshot.people.map((person) => [person.employeeId, person.hasOpenTraining])).toEqual(
      expect.arrayContaining([
        [SAM, true],
        [LEAVER, true],
      ])
    )
    expect(snapshot.people.map((person) => person.employeeId)).not.toContain(FORMER)
    // Awaiting confirmation with no document: the certificate could not be prepared.
    expect(snapshot.certificateFailures).toEqual([expect.objectContaining({ assignmentId: A_LEAVER, employeeId: LEAVER })])
  })

  it('releases held reminder claims so the next run tries again', async () => {
    await TrainingService.claimReminder({ kind: 'staff_step', claimKey: 'step:a:assigned:2026-12-10', londonDate: TODAY })
    await TrainingService.claimReminder({ kind: 'staff_step', claimKey: 'cap:sam:2026-11-10', londonDate: TODAY })
    await TrainingService.releaseReminders(['step:a:assigned:2026-12-10'])
    expect(db.rows('training_reminders').map((row) => row.claim_key)).toEqual(['cap:sam:2026-11-10'])
    expect(await TrainingService.listReminderClaimKeys({ claimKeys: ['step:a:assigned:2026-12-10', 'cap:sam:2026-11-10'] })).toEqual(
      new Set(['cap:sam:2026-11-10'])
    )
  })
})

// ---------------------------------------------------------------------------------------------
// The training log
// ---------------------------------------------------------------------------------------------

describe('the training log', () => {
  function eventRow(id: string, createdAt: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { id, event_type: 'assigned', employee_id: SAM, course_id: ONLINE, assignment_id: A_SAM, actor_name: 'System', meta: {}, created_at: createdAt, ...overrides }
  }

  beforeEach(() => {
    seed({
      training_events: [
        eventRow('e1', '2026-11-01T09:00:00.000Z'),
        eventRow('e3', '2026-11-03T09:00:00.000Z', { event_type: 'waived', note: 'Trained elsewhere' }),
        eventRow('e2', '2026-11-02T09:00:00.000Z', { employee_id: FORMER }),
        eventRow('e4', '2026-11-04T09:00:00.000Z', { employee_id: null, course_id: null, assignment_id: null, event_type: 'course_published' }),
      ],
    })
  })

  it('pages newest first with names and course titles', async () => {
    const first = await TrainingService.getActivity({ page: 1, pageSize: 2 })
    expect(first).toMatchObject({ page: 1, pageSize: 2, total: 4 })
    expect(first.items.map((item) => item.id)).toEqual(['e4', 'e3'])
    expect(first.items[1]).toMatchObject({ employeeName: 'Sam', courseTitle: 'Allergen awareness', note: 'Trained elsewhere' })
    expect(first.items[0]).toMatchObject({ employeeName: null, courseTitle: null })
    expect((await TrainingService.getActivity({ page: 2, pageSize: 2 })).items.map((item) => item.id)).toEqual(['e2', 'e1'])
  })

  it('filters to one person', async () => {
    const page = await TrainingService.getActivity({ employeeId: FORMER })
    expect(page.items.map((item) => [item.id, item.employeeName])).toEqual([['e2', 'Fran']])
    expect(page.total).toBe(1)
  })

  it('exports every line newest first', async () => {
    expect((await TrainingService.listActivityForExport()).map((item) => item.id)).toEqual(['e4', 'e3', 'e2', 'e1'])
    expect((await TrainingService.listActivityForExport({ employeeId: SAM })).map((item) => item.id)).toEqual(['e3', 'e1'])
  })
})
