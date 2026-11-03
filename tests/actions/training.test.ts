// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FakeDb } from '../helpers/fakeSupabaseDb'
import { createTrainingDb } from '../helpers/trainingDb'

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  user: vi.fn(),
  allowed: vi.fn(),
  audit: vi.fn(),
  prepare: vi.fn(),
  signoff: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: mocks.allowed }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => mocks.client }))
vi.mock('@/lib/signing/staff', () => ({ getSigningStaffUser: mocks.user }))
vi.mock('@/lib/training/signing', () => ({
  prepareTrainingCertificate: mocks.prepare,
  createPracticalSignoff: mocks.signoff,
}))
vi.mock('@/lib/training/storage', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/training/storage')>()
  return { ...original, uploadExternalCertificate: mocks.upload }
})
vi.mock('@/lib/training/settings', () => ({ getTrainingEmailsEnabled: vi.fn().mockResolvedValue(false) }))

import {
  assignCourse,
  extendDueDate,
  getEmployeeTraining,
  getTrainingActivity,
  getTrainingMatrix,
  getTrainingPayReport,
  pauseTraining,
  prepareConfirmationAgain,
  recordExternalQualification,
  recordPracticalSignoff,
  resumeTraining,
  setTrainingAdjustmentNote,
  setTrainingGroups,
  syncTrainingNow,
  unlockSection,
  waiveAssignment,
} from '@/app/actions/training'
import { validateCourse } from '@/lib/training/course-schema'
import { emptyProgress } from '@/lib/training/mappers'

const TODAY = '2026-11-10'

const SAM = '11111111-1111-4111-8111-111111111111'
const ROBIN = '22222222-2222-4222-8222-222222222222'
const FORMER = '44444444-4444-4444-8444-444444444444'

const ONLINE = 'c1111111-1111-4111-8111-111111111111'
const ADULT_ONLY = 'c2222222-2222-4222-8222-222222222222'
const PRACTICAL = 'c3333333-3333-4333-8333-333333333333'
const EXTERNAL = 'c4444444-4444-4444-8444-444444444444'
const DRAFT = 'c5555555-5555-4555-8555-555555555555'
const PRACTICAL_V1 = 'd3333333-3333-4333-8333-333333333333'

const A1 = 'a1111111-1111-4111-8111-111111111111'

const STAFF = { id: '99999999-9999-4999-8999-999999999999', email: 'billy@example.test', name: 'Billy Summers', position: 'General Manager' }

const UNIQUE_OPEN = 'duplicate key value violates unique constraint "training_assignments_one_open"'

let db: FakeDb

function courseRow(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    slug: `course-${id.slice(0, 2)}`,
    title: 'Allergen awareness',
    kind: 'online',
    audience_groups: [],
    audience_age: 'all',
    is_essentials: false,
    prerequisite_course_id: null,
    new_starter_due_days: 14,
    existing_staff_due_days: 30,
    refresher_months: 12,
    window_days: 30,
    supervised_only_under_18: false,
    display_order: 100,
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
    id: A1,
    employee_id: SAM,
    course_id: ONLINE,
    cycle: 1,
    reason: 'existing_staff',
    status: 'assigned',
    assigned_on: '2026-11-01',
    due_on: '2026-12-01',
    window_opens_on: null,
    version_id: null,
    progress: emptyProgress(),
    started_at: null,
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
    created_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:00:00.000Z',
    ...overrides,
  }
}

const PRACTICAL_TASKS = [
  { key: 'change-keg', text: 'Changes a keg safely.' },
  { key: 'clean-coupler', text: 'Cleans the coupler before fitting it.' },
]

function practicalContent(tasks: Array<{ key: string; text: string }> = PRACTICAL_TASKS): unknown {
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

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}): void {
  db = createTrainingDb({
    employees: [
      { employee_id: SAM, first_name: 'Sam', last_name: 'Example', preferred_name: null, status: 'Active', job_title: 'Bartender', employment_start_date: '2025-01-01', date_of_birth: '1990-05-01', email_address: 'sam@example.test', auth_user_id: 'u-sam' },
      { employee_id: ROBIN, first_name: 'Robin', last_name: 'Young', preferred_name: null, status: 'Active', job_title: 'Runner', employment_start_date: '2026-06-01', date_of_birth: '2010-06-01', email_address: 'robin@example.test', auth_user_id: null },
      { employee_id: FORMER, first_name: 'Fran', last_name: 'Former', preferred_name: null, status: 'Former', job_title: 'Bartender', employment_start_date: '2020-01-01', date_of_birth: '1980-01-01', email_address: null, auth_user_id: null },
    ],
    training_courses: [
      courseRow(ONLINE),
      courseRow(ADULT_ONLY, { title: 'Age verification', audience_age: 'adult' }),
      courseRow(PRACTICAL, { title: 'Changing a keg', kind: 'practical', current_version_id: PRACTICAL_V1, new_starter_due_days: null, existing_staff_due_days: null }),
      courseRow(EXTERNAL, { title: 'Level 2 Food Hygiene', kind: 'external', new_starter_due_days: null, existing_staff_due_days: null, refresher_months: 36, window_days: 60 }),
      courseRow(DRAFT, { title: 'Not ready yet', status: 'draft' }),
    ],
    training_course_versions: [
      {
        id: PRACTICAL_V1,
        course_id: PRACTICAL,
        state: 'published',
        major: 1,
        minor: 0,
        content: practicalContent(),
        content_sha256: 'a'.repeat(64),
        images: [],
        change_note: null,
        redo_required: false,
        uploaded_by: null,
        uploaded_by_name: 'Billy Summers',
        uploaded_at: '2026-10-01T09:00:00.000Z',
        published_by: null,
        published_by_name: 'Billy Summers',
        published_at: '2026-10-01T09:00:00.000Z',
      },
    ],
    ...extra,
  })
  mocks.client = db.client
}

function assignments(): Array<Record<string, unknown>> {
  return db.rows('training_assignments')
}

function events(type?: string): Array<Record<string, unknown>> {
  return db.rows('training_events').filter((event) => !type || event.event_type === type)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T12:00:00.000Z`))
  vi.clearAllMocks()
  mocks.user.mockResolvedValue(STAFF)
  mocks.allowed.mockResolvedValue(true)
  mocks.audit.mockResolvedValue(undefined)
  seed()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('permissions', () => {
  const manageCalls: Array<[string, () => Promise<unknown>]> = [
    ['syncTrainingNow', () => syncTrainingNow()],
    ['assignCourse', () => assignCourse({ employeeIds: [SAM], courseId: ONLINE })],
    ['extendDueDate', () => extendDueDate({ assignmentId: A1, dueOn: '2026-12-20', reason: 'On holiday' })],
    ['waiveAssignment', () => waiveAssignment({ assignmentId: A1, reason: 'Already trained elsewhere' })],
    ['unlockSection', () => unlockSection({ assignmentId: A1, note: 'Went through it together' })],
    ['setTrainingGroups', () => setTrainingGroups({ employeeId: SAM, groups: ['bar'], confirm: true })],
    ['setTrainingAdjustmentNote', () => setTrainingAdjustmentNote({ employeeId: SAM, note: 'Read aloud offered' })],
    ['pauseTraining', () => pauseTraining({ employeeId: SAM, from: TODAY, until: null, reason: 'other' })],
    ['resumeTraining', () => resumeTraining({ employeeId: SAM })],
    ['prepareConfirmationAgain', () => prepareConfirmationAgain({ assignmentId: A1 })],
    [
      'recordPracticalSignoff',
      () => recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: ['change-keg'], observedOn: TODAY }),
    ],
    ['recordExternalQualification', () => recordExternalQualification(new FormData())],
  ]
  const viewCalls: Array<[string, () => Promise<unknown>]> = [
    ['getTrainingMatrix', () => getTrainingMatrix()],
    ['getEmployeeTraining', () => getEmployeeTraining(SAM)],
    ['getTrainingActivity', () => getTrainingActivity({})],
    ['getTrainingPayReport', () => getTrainingPayReport({ from: TODAY, to: TODAY })],
  ]

  it.each(manageCalls)('%s needs training:manage and writes nothing without it', async (_name, call) => {
    mocks.allowed.mockResolvedValue(false)
    await expect(call()).rejects.toThrow('Insufficient permissions')
    expect(mocks.allowed).toHaveBeenCalledWith('training', 'manage', STAFF.id)
    expect(db.writes).toEqual([])
    expect(mocks.audit).not.toHaveBeenCalled()
  })

  it.each(viewCalls)('%s needs training:view', async (_name, call) => {
    mocks.allowed.mockResolvedValue(false)
    await expect(call()).rejects.toThrow('Insufficient permissions')
    expect(mocks.allowed).toHaveBeenCalledWith('training', 'view', STAFF.id)
    expect(db.writes).toEqual([])
  })

  it('refuses when nobody is signed in', async () => {
    mocks.user.mockResolvedValue(null)
    await expect(assignCourse({ employeeIds: [SAM], courseId: ONLINE })).rejects.toThrow('Unauthorized')
    await expect(getTrainingMatrix()).rejects.toThrow('Unauthorized')
    expect(mocks.allowed).not.toHaveBeenCalled()
  })
})

describe('validation', () => {
  it('refuses an assignment with nobody chosen', async () => {
    expect(await assignCourse({ employeeIds: [], courseId: ONLINE })).toEqual({ error: 'Choose at least one person.' })
  })

  it('refuses a due date that is not a real date', async () => {
    const result = await extendDueDate({ assignmentId: A1, dueOn: '2026-02-30', reason: 'On holiday' })
    expect(result.error).toBe('Choose a real date.')
    expect(db.writes).toEqual([])
  })

  it('refuses an extension with no reason', async () => {
    const result = await extendDueDate({ assignmentId: A1, dueOn: '2026-12-20', reason: ' ' })
    expect(result.error).toBe('Say briefly why.')
  })

  it('refuses a pause that ends before it starts, or has already ended', async () => {
    expect((await pauseTraining({ employeeId: SAM, from: '2026-11-20', until: '2026-11-15', reason: 'other' })).error).toBe(
      'The pause must end on or after the day it starts.'
    )
    expect((await pauseTraining({ employeeId: SAM, from: '2026-11-01', until: '2026-11-05', reason: 'other' })).error).toBe(
      'The pause must end today or later.'
    )
    expect(db.writes).toEqual([])
  })

  it('refuses a pay report range the wrong way round or too long', async () => {
    expect((await getTrainingPayReport({ from: '2026-11-10', to: '2026-11-01' })).error).toBe(
      'The start date must be on or before the end date.'
    )
    expect((await getTrainingPayReport({ from: '2026-01-01', to: '2026-11-01' })).error).toBe('Choose at most 93 days at a time.')
  })

  it('refuses an external qualification with no file', async () => {
    const form = new FormData()
    form.set('employeeId', SAM)
    form.set('courseId', EXTERNAL)
    form.set('issuer', 'Highfield')
    form.set('issuedOn', '2026-10-01')
    expect((await recordExternalQualification(form)).error).toBe('Attach the certificate file (PDF, JPG or PNG).')
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('refuses ids that are not ids', async () => {
    expect((await getEmployeeTraining('not-an-id')).error).toBe('That employee could not be found.')
    expect((await waiveAssignment({ assignmentId: 'nope', reason: 'Because' })).error).toBeTruthy()
  })
})

describe('assignCourse', () => {
  it('creates a manual cycle where none is open and skips everyone else with the reason', async () => {
    seed({ training_assignments: [assignmentRow({ employee_id: ROBIN })] })
    const result = await assignCourse({ employeeIds: [SAM, ROBIN, FORMER], courseId: ONLINE, note: 'Before the menu change' })

    expect(result).toEqual({
      success: true,
      data: {
        created: 1,
        skipped: [
          { employeeId: ROBIN, reason: 'already_open' },
          { employeeId: FORMER, reason: 'not_in_scope' },
        ],
      },
    })
    const created = assignments().find((row) => row.employee_id === SAM)
    expect(created).toMatchObject({ course_id: ONLINE, cycle: 1, reason: 'manual', status: 'assigned', assigned_on: TODAY, due_on: '2026-12-10' })
    expect(events('assigned')).toEqual([
      expect.objectContaining({ employee_id: SAM, course_id: ONLINE, actor_id: STAFF.id, actor_name: STAFF.name, note: 'Before the menu change', note_code: 'manual' }),
    ])
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'assign', resource_type: 'training_course', resource_id: ONLINE, operation_status: 'success' })
    )
  })

  it('uses the manager due date when one is given, and numbers the cycle after the last one', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'completed', completed_on: '2025-11-01', expires_on: '2026-11-01' })] })
    const result = await assignCourse({ employeeIds: [SAM], courseId: ONLINE, dueOn: '2026-11-30' })
    expect(result.success).toBe(true)
    const created = assignments().find((row) => row.cycle === 2)
    expect(created).toMatchObject({ employee_id: SAM, due_on: '2026-11-30', reason: 'manual' })
  })

  it('skips a person the age rule rules out', async () => {
    const result = await assignCourse({ employeeIds: [ROBIN], courseId: ADULT_ONLY })
    expect(result.data).toEqual({ created: 0, skipped: [{ employeeId: ROBIN, reason: 'not_applicable' }] })
    expect(assignments()).toEqual([])
  })

  it('creates a waiting cycle with no due date when the prerequisite is not done', async () => {
    seed()
    db.rows('training_courses').find((row) => row.id === ADULT_ONLY)!.prerequisite_course_id = ONLINE
    const result = await assignCourse({ employeeIds: [SAM], courseId: ADULT_ONLY, dueOn: '2026-11-30' })
    expect(result.success).toBe(true)
    expect(assignments()[0]).toMatchObject({ status: 'waiting', due_on: null })
  })

  it('counts a cycle opened by someone else at the same moment as already open', async () => {
    db.failNext({ table: 'training_assignments', operation: 'insert', message: UNIQUE_OPEN, times: 1 })
    const result = await assignCourse({ employeeIds: [SAM], courseId: ONLINE })
    expect(result).toEqual({ success: true, data: { created: 0, skipped: [{ employeeId: SAM, reason: 'already_open' }] } })
    expect(events()).toEqual([])
  })

  it('refuses a due date in the past and a course that is not live', async () => {
    expect((await assignCourse({ employeeIds: [SAM], courseId: ONLINE, dueOn: '2026-11-01' })).error).toBe(
      'The due date cannot be before today.'
    )
    expect((await assignCourse({ employeeIds: [SAM], courseId: DRAFT })).error).toBe('Not ready yet is not live, so it cannot be used yet.')
    expect(assignments()).toEqual([])
  })

  it('says so when some people could not be assigned', async () => {
    db.failNext({ table: 'training_assignments', operation: 'insert', message: 'connection reset', times: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await assignCourse({ employeeIds: [SAM], courseId: ONLINE })
    spy.mockRestore()
    expect(result.error).toBe('Allergen awareness was assigned to 0 people, but 1 could not be assigned. Please try again for them.')
  })
})

describe('extendDueDate', () => {
  it('moves the due date later and records why', async () => {
    seed({ training_assignments: [assignmentRow()] })
    const result = await extendDueDate({ assignmentId: A1, dueOn: '2026-12-20', reason: 'Two weeks of holiday' })
    expect(result).toEqual({ success: true, data: { dueOn: '2026-12-20' } })
    expect(assignments()[0]).toMatchObject({ due_on: '2026-12-20', due_change_reason: 'Two weeks of holiday' })
    expect(events('extended')).toEqual([
      expect.objectContaining({ assignment_id: A1, note: 'Two weeks of holiday', meta: { from: '2026-12-01', to: '2026-12-20' } }),
    ])
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'extend', resource_id: A1 }))
  })

  it('never moves a due date earlier', async () => {
    seed({ training_assignments: [assignmentRow()] })
    const result = await extendDueDate({ assignmentId: A1, dueOn: '2026-11-20', reason: 'Sooner please' })
    expect(result.error).toBe('The new due date must be after 2026-12-01 and not before today.')
    expect(db.writes).toEqual([])
  })

  it('refuses a closed cycle', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'completed' })] })
    const result = await extendDueDate({ assignmentId: A1, dueOn: '2026-12-20', reason: 'On holiday' })
    expect(result.error).toBe('This training item is closed, so it cannot be changed.')
    expect(db.writes).toEqual([])
  })

  it('refuses when the item changed since it was read', async () => {
    seed({ training_assignments: [assignmentRow()] })
    db.beforeUpdate((table, matched) => {
      if (table === 'training_assignments') for (const row of matched) row.updated_at = '2026-11-10T11:59:00.000Z'
    })
    const result = await extendDueDate({ assignmentId: A1, dueOn: '2026-12-20', reason: 'On holiday' })
    expect(result.error).toBe('This training item changed while you were looking at it. Refresh and try again.')
    expect(events()).toEqual([])
  })
})

describe('unlockSection', () => {
  it('clears the lock, resets the section and moves the due date on by the days locked', async () => {
    const progress = {
      sections: { fire: { card: 4, fails: 3, passedAt: null, lastAttemptQuestionIds: ['q1'] } },
      current: 'fire',
      introSeen: true,
    }
    seed({
      training_assignments: [
        assignmentRow({ status: 'locked', locked_section: 'fire', locked_at: '2026-11-07T10:00:00.000Z', due_on: '2026-11-20', progress }),
      ],
    })
    const result = await unlockSection({ assignmentId: A1, note: 'Went through the fire section together' })
    expect(result).toEqual({ success: true, data: { dueOn: '2026-11-23' } })
    const row = assignments()[0]
    expect(row).toMatchObject({ status: 'in_progress', locked_at: null, locked_section: null, due_on: '2026-11-23' })
    expect((row.progress as typeof progress).sections.fire).toMatchObject({ fails: 0, card: 0 })
    expect(events('unlocked')).toEqual([expect.objectContaining({ note: 'Went through the fire section together' })])
  })

  it('refuses a cycle that is not locked', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'in_progress' })] })
    expect((await unlockSection({ assignmentId: A1, note: 'Just in case' })).error).toBe('This training is not locked.')
    expect(db.writes).toEqual([])
  })
})

describe('waiveAssignment', () => {
  it('waives an open cycle with who and why', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'in_progress' })] })
    expect(await waiveAssignment({ assignmentId: A1, reason: 'Trained at the sister pub' })).toEqual({ success: true })
    expect(assignments()[0]).toMatchObject({
      status: 'waived',
      waived_by: STAFF.id,
      waived_by_name: STAFF.name,
      waive_reason: 'Trained at the sister pub',
    })
    expect(assignments()[0].waived_at).toBeTruthy()
    expect(events('waived')).toHaveLength(1)
  })

  it('reports success when the waiver saved but its log line could not be written', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'in_progress' })] })
    db.failNext({ table: 'training_events', operation: 'insert', message: 'connection reset', times: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await waiveAssignment({ assignmentId: A1, reason: 'Trained at the sister pub' })).toEqual({ success: true })
    expect(spy).toHaveBeenCalledWith(
      'Training change saved, but its training log line could not be written:',
      expect.objectContaining({ eventType: 'waived', assignmentId: A1 })
    )
    spy.mockRestore()
    expect(assignments()[0].status).toBe('waived')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'waive', resource_id: A1 }))
  })

  it('refuses a cycle that is already closed', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'waived' })] })
    expect((await waiveAssignment({ assignmentId: A1, reason: 'Again' })).error).toBe('This training item is closed, so it cannot be changed.')
  })
})

describe('pause and resume', () => {
  it('pauses from a date with a reason from the list', async () => {
    expect(await pauseTraining({ employeeId: SAM, from: TODAY, until: '2026-12-31', reason: 'parental_leave' })).toEqual({ success: true })
    expect(db.rows('training_profiles')[0]).toMatchObject({
      employee_id: SAM,
      paused_from: TODAY,
      paused_until: '2026-12-31',
      pause_reason: 'parental_leave',
    })
    expect(events('paused')).toEqual([expect.objectContaining({ note_code: 'parental_leave', meta: { from: TODAY, until: '2026-12-31' } })])
  })

  it('resumes: each open due date becomes the later of itself and today + 14, and the pause is cleared', async () => {
    seed({
      training_profiles: [{ employee_id: SAM, groups: [], paused_from: '2026-11-01', paused_until: null, pause_reason: 'other', updated_at: '2026-11-01T09:00:00.000Z' }],
      training_assignments: [
        assignmentRow({ due_on: '2026-11-12' }),
        assignmentRow({ id: 'a2222222-2222-4222-8222-222222222222', course_id: ADULT_ONLY, due_on: '2026-12-31' }),
        assignmentRow({ id: 'a3333333-3333-4333-8333-333333333333', course_id: PRACTICAL, status: 'completed', due_on: '2026-11-05' }),
      ],
    })
    expect(await resumeTraining({ employeeId: SAM })).toEqual({ success: true })
    const byId = new Map(assignments().map((row) => [row.id, row]))
    expect(byId.get(A1)?.due_on).toBe('2026-11-24')
    expect(byId.get('a2222222-2222-4222-8222-222222222222')?.due_on).toBe('2026-12-31')
    expect(byId.get('a3333333-3333-4333-8333-333333333333')?.due_on).toBe('2026-11-05')
    expect(db.rows('training_profiles')[0]).toMatchObject({ paused_from: null, paused_until: null, pause_reason: null })
    expect(events('resumed')).toEqual([expect.objectContaining({ meta: { resumedOn: TODAY, dueDatesMoved: 1 } })])
  })

  it('a pause that has not started yet is just cancelled, with no due dates moved', async () => {
    seed({
      training_profiles: [{ employee_id: SAM, groups: [], paused_from: '2026-12-01', paused_until: null, pause_reason: 'other' }],
      training_assignments: [assignmentRow({ due_on: '2026-11-12' })],
    })
    expect(await resumeTraining({ employeeId: SAM })).toEqual({ success: true })
    expect(assignments()[0].due_on).toBe('2026-11-12')
    expect(db.rows('training_profiles')[0].paused_from).toBeNull()
  })

  it('refuses when there is no pause', async () => {
    expect((await resumeTraining({ employeeId: SAM })).error).toBe('Their training is not paused.')
    expect(db.writes).toEqual([])
  })
})

describe('setTrainingGroups and the adjustment note', () => {
  it('confirms groups, records the change and syncs that person', async () => {
    const result = await setTrainingGroups({ employeeId: SAM, groups: ['floor', 'bar', 'bar'], confirm: true })
    expect(result.success).toBe(true)
    expect(result.data?.groups).toEqual(['bar', 'floor'])
    expect(db.rows('training_profiles')[0]).toMatchObject({
      groups: ['bar', 'floor'],
      groups_confirmed_by: STAFF.id,
      groups_confirmed_by_name: STAFF.name,
    })
    expect(events('groups_changed')).toEqual([
      expect.objectContaining({ employee_id: SAM, meta: { groups: ['bar', 'floor'], confirmed: true, previousGroups: [] } }),
    ])
    // The sync ran for Sam: the live online courses that apply to everyone were assigned.
    expect(result.data?.sync.created).toBeGreaterThan(0)
    expect(assignments().every((row) => row.employee_id === SAM)).toBe(true)
  })

  it('stores the adjustment note and keeps its wording out of the audit log', async () => {
    expect(await setTrainingAdjustmentNote({ employeeId: SAM, note: '  Read aloud offered  ' })).toEqual({ success: true })
    expect(db.rows('training_profiles')[0].adjustment_note).toBe('Read aloud offered')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ additional_info: { adjustment_note_set: true } }))
  })

  it('refuses an adjustment note over 300 characters', async () => {
    expect((await setTrainingAdjustmentNote({ employeeId: SAM, note: 'x'.repeat(301) })).error).toBe(
      'Keep the adjustment under 300 characters.'
    )
  })
})

describe('prepareConfirmationAgain', () => {
  it('after a decline: back to awaiting confirmation with the old document let go, then a new one is prepared', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'declined', signing_document_id: 'doc-old', declined_at: '2026-11-09T10:00:00.000Z' })] })
    mocks.prepare.mockResolvedValue({ documentId: 'doc-new', partyId: 'party-1' })
    expect(await prepareConfirmationAgain({ assignmentId: A1 })).toEqual({ success: true, data: { documentId: 'doc-new' } })
    expect(mocks.prepare).toHaveBeenCalledWith(A1)
    expect(assignments()[0]).toMatchObject({ status: 'awaiting_confirmation', signing_document_id: null })
  })

  it('a failed preparation is reported and left for the daily retry', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'awaiting_confirmation' })] })
    mocks.prepare.mockRejectedValue(new Error('chromium timed out'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await prepareConfirmationAgain({ assignmentId: A1 })
    spy.mockRestore()
    expect(result.error).toBe('We could not prepare the confirmation. The daily job will try again, or you can try again later.')
    expect(assignments()[0].status).toBe('awaiting_confirmation')
  })

  it('refuses a cycle with nothing to confirm', async () => {
    seed({ training_assignments: [assignmentRow({ status: 'in_progress' })] })
    expect((await prepareConfirmationAgain({ assignmentId: A1 })).error).toBe(
      'Only a declined confirmation, or one that could not be prepared, can be prepared again.'
    )
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})

describe('recordPracticalSignoff', () => {
  it('opens a manual cycle when none is open and hands the sign-off to signing', async () => {
    mocks.signoff.mockResolvedValue({ documentId: 'doc-1', partyId: 'party-1', inPersonUrl: '/sign/in-person/abc', supervisedOnly: true })
    const result = await recordPracticalSignoff({
      employeeId: SAM,
      courseId: PRACTICAL,
      tasks: ['change-keg', 'clean-coupler'],
      observedOn: '2026-11-09',
      note: 'Watched on the Monday delivery',
    })
    const cycle = assignments()[0]
    expect(result).toEqual({ success: true, data: { assignmentId: cycle.id, documentId: 'doc-1', inPersonUrl: '/sign/in-person/abc' } })
    expect(cycle).toMatchObject({ employee_id: SAM, course_id: PRACTICAL, reason: 'manual', status: 'assigned' })
    expect(mocks.signoff).toHaveBeenCalledWith({
      assignmentId: cycle.id,
      tasks: ['change-keg', 'clean-coupler'],
      observedOn: '2026-11-09',
      actor: { id: STAFF.id, name: STAFF.name },
    })
    expect(events('signoff_recorded')).toEqual([
      expect.objectContaining({
        note: 'Watched on the Monday delivery',
        meta: { tasks: ['change-keg', 'clean-coupler'], observedOn: '2026-11-09', documentId: 'doc-1', supervisedOnly: true },
      }),
    ])
  })

  it('refuses unless every task was watched, a task from another course, or a future date', async () => {
    expect(
      (await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: ['change-keg'], observedOn: TODAY })).error
    ).toBe('Every task must be watched before this can be signed off. Tick each one you watched.')
    expect(
      (await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: ['change-keg', 'clean-coupler', 'juggle'], observedOn: TODAY }))
        .error
    ).toBe('One of those tasks is not part of this course. Refresh and try again.')
    expect(
      (await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: ['change-keg', 'clean-coupler'], observedOn: '2026-11-11' }))
        .error
    ).toBe('The date you watched them cannot be in the future.')
    expect(mocks.signoff).not.toHaveBeenCalled()
    expect(db.writes).toEqual([])
  })

  const BOTH = ['change-keg', 'clean-coupler']
  const IN_PERSON = { documentId: 'doc-2', partyId: 'party-2', inPersonUrl: '/sign/in-person/xyz', supervisedOnly: false }

  function awaitingSignoff(document: Record<string, unknown> | null): void {
    seed({
      training_assignments: [
        assignmentRow({ course_id: PRACTICAL, status: 'awaiting_confirmation', version_id: PRACTICAL_V1, signing_document_id: 'doc-1', due_on: null }),
      ],
      ...(document ? { signing_documents: [{ id: 'doc-1', kind: 'training_signoff', ...document }] } : {}),
    })
  }

  it('refuses while the sign-off document can still be confirmed', async () => {
    awaitingSignoff({ status: 'sent', expires_at: '2026-12-01T12:00:00.000Z' })
    expect((await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })).error).toBe(
      'This sign-off is already waiting for them to confirm it.'
    )
    expect(mocks.signoff).not.toHaveBeenCalled()
  })

  it('refuses once the learner has confirmed it, while the record catches up', async () => {
    awaitingSignoff({ status: 'completed', expires_at: '2026-12-01T12:00:00.000Z' })
    expect((await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })).error).toBe(
      'They have already confirmed this sign-off, so it does not need recording again. Refresh the page.'
    )
    expect(mocks.signoff).not.toHaveBeenCalled()
  })

  it.each([
    ['withdrawn on the Signing tab', { status: 'voided', expires_at: '2026-12-01T12:00:00.000Z' }],
    ['marked expired by the sweep', { status: 'expired', expires_at: '2026-11-01T12:00:00.000Z' }],
    ['past its expiry before the sweep has run', { status: 'sent', expires_at: '2026-11-10T11:00:00.000Z' }],
    ['missing', null],
  ])('records it again on the same item when the document was %s', async (_label, document) => {
    awaitingSignoff(document)
    mocks.signoff.mockResolvedValue(IN_PERSON)
    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })
    expect(result).toEqual({ success: true, data: { assignmentId: A1, documentId: 'doc-2', inPersonUrl: '/sign/in-person/xyz' } })
    expect(mocks.signoff).toHaveBeenCalledWith({ assignmentId: A1, tasks: BOTH, observedOn: TODAY, actor: { id: STAFF.id, name: STAFF.name } })
    expect(assignments()).toHaveLength(1)
  })

  it('checks the ticked tasks against the version the item is pinned to, not the current one', async () => {
    const V2 = 'd3333333-3333-4333-8333-333333333334'
    seed({
      training_assignments: [
        assignmentRow({ course_id: PRACTICAL, status: 'declined', version_id: PRACTICAL_V1, signing_document_id: 'doc-1', due_on: null }),
      ],
    })
    const v1 = db.rows('training_course_versions')[0]
    db.rows('training_course_versions').push({
      ...v1,
      id: V2,
      minor: 1,
      content: practicalContent([...PRACTICAL_TASKS, { key: 'check-gas', text: 'Checks the gas is off first.' }]),
      published_at: '2026-11-05T09:00:00.000Z',
    })
    db.rows('training_courses').find((row) => row.id === PRACTICAL)!.current_version_id = V2
    mocks.signoff.mockResolvedValue(IN_PERSON)

    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })
    expect(result.success).toBe(true)
    expect(mocks.signoff).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: A1, tasks: BOTH }))

    // A task only in the newer version is not part of what this item is signed off against.
    mocks.signoff.mockClear()
    const extra = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: [...BOTH, 'check-gas'], observedOn: TODAY })
    expect(extra.error).toBe('One of those tasks is not part of this course. Refresh and try again.')
    expect(mocks.signoff).not.toHaveBeenCalled()
  })

  it('writes one sign-off log line, and still reports success when that line cannot be written', async () => {
    seed({ training_assignments: [assignmentRow({ course_id: PRACTICAL, status: 'assigned', due_on: null })] })
    mocks.signoff.mockResolvedValue(IN_PERSON)
    db.failNext({ table: 'training_events', operation: 'insert', message: 'connection reset', times: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })
    spy.mockRestore()
    expect(result).toEqual({ success: true, data: { assignmentId: A1, documentId: 'doc-2', inPersonUrl: '/sign/in-person/xyz' } })
    expect(events('signoff_recorded')).toEqual([])
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'signoff', resource_id: A1 }))
  })

  it('says the sign-off is recorded, not that nothing was signed, when signing could not start here', async () => {
    seed({ training_assignments: [assignmentRow({ course_id: PRACTICAL, status: 'assigned', due_on: null })] })
    // The item has moved and points at a new open document, then the in-person link fails.
    mocks.signoff.mockImplementation(async () => {
      const row = assignments()[0]
      row.status = 'awaiting_confirmation'
      row.signing_document_id = 'doc-2'
      db.rows('signing_documents').push({ id: 'doc-2', kind: 'training_signoff', status: 'part_signed', expires_at: '2026-12-10T12:00:00.000Z' })
      throw new Error('in-person session insert failed')
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY, note: 'Watched at close' })
    spy.mockRestore()
    expect(result.error).toBe(
      'The sign-off is recorded, but signing could not be started on this device. Open their Signing tab and choose Sign in person.'
    )
    expect(events('signoff_recorded')).toEqual([
      expect.objectContaining({
        assignment_id: A1,
        note: 'Watched at close',
        meta: { tasks: BOTH, observedOn: TODAY, documentId: 'doc-2', supervisedOnly: false },
      }),
    ])
  })

  it('still reports success with the in-person link when the audit row fails after the sign-off is saved', async () => {
    seed({ training_assignments: [assignmentRow({ course_id: PRACTICAL, status: 'assigned', due_on: null })] })
    mocks.signoff.mockResolvedValue(IN_PERSON)
    mocks.audit.mockRejectedValue(new Error('audit insert failed'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY, note: 'Watched at close' })
    spy.mockRestore()
    expect(result).toEqual({ success: true, data: { assignmentId: A1, documentId: 'doc-2', inPersonUrl: '/sign/in-person/xyz' } })
    // One log line only: the failure is not mistaken for a sign-off that needs recording again.
    expect(events('signoff_recorded')).toEqual([
      expect.objectContaining({ note: 'Watched at close', meta: { tasks: BOTH, observedOn: TODAY, documentId: 'doc-2', supervisedOnly: false } }),
    ])
    expect(mocks.signoff).toHaveBeenCalledTimes(1)
  })

  it('says the same when the sign-off came back recorded without an in-person link', async () => {
    seed({ training_assignments: [assignmentRow({ course_id: PRACTICAL, status: 'assigned', due_on: null })] })
    mocks.signoff.mockResolvedValue({ ...IN_PERSON, inPersonUrl: null })
    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })
    expect(result.error).toBe(
      'The sign-off is recorded, but signing could not be started on this device. Open their Signing tab and choose Sign in person.'
    )
    expect(events('signoff_recorded')).toHaveLength(1)
  })

  it('keeps "nothing has been signed" for a failure before anything was saved', async () => {
    seed({ training_assignments: [assignmentRow({ course_id: PRACTICAL, status: 'assigned', due_on: null })] })
    mocks.signoff.mockRejectedValue(new Error('pdf render failed'))
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await recordPracticalSignoff({ employeeId: SAM, courseId: PRACTICAL, tasks: BOTH, observedOn: TODAY })
    spy.mockRestore()
    expect(result.error).toBe('The sign-off could not be recorded. Nothing has been signed; please try again.')
    expect(events('signoff_recorded')).toEqual([])
  })
})

describe('recordExternalQualification', () => {
  function form(overrides: Record<string, string> = {}): FormData {
    const data = new FormData()
    const fields = { employeeId: SAM, courseId: EXTERNAL, issuer: 'Highfield', reference: 'HF-123', issuedOn: '2026-10-01', expiresOn: '', ...overrides }
    for (const [key, value] of Object.entries(fields)) data.set(key, value)
    data.set('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'cert.pdf')
    return data
  }

  it('stores the file, then records a completed cycle with the expiry worked out from the refresher months', async () => {
    mocks.upload.mockResolvedValue({ path: `external/${SAM}/f.pdf`, sha256: 'b'.repeat(64), contentType: 'application/pdf', bytes: 4 })
    const result = await recordExternalQualification(form())
    expect(result.success).toBe(true)
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ employeeId: SAM, contentType: 'application/pdf' }))
    expect(assignments()[0]).toMatchObject({
      employee_id: SAM,
      course_id: EXTERNAL,
      reason: 'manual',
      status: 'completed',
      completed_on: '2026-10-01',
      expires_on: '2029-10-01',
      window_opens_on: '2029-08-02',
      external_issuer: 'Highfield',
      external_reference: 'HF-123',
      external_issued_on: '2026-10-01',
      external_file_path: `external/${SAM}/f.pdf`,
    })
    expect(events('external_recorded')).toHaveLength(1)
  })

  it('completes the open renewal cycle instead of opening another', async () => {
    seed({ training_assignments: [assignmentRow({ course_id: EXTERNAL, reason: 'renewal', cycle: 2 })] })
    mocks.upload.mockResolvedValue({ path: `external/${SAM}/g.pdf`, sha256: 'c'.repeat(64), contentType: 'application/pdf', bytes: 4 })
    const result = await recordExternalQualification(form({ expiresOn: '2027-10-01' }))
    expect(result).toEqual({ success: true, data: { assignmentId: A1 } })
    expect(assignments()).toHaveLength(1)
    expect(assignments()[0]).toMatchObject({ status: 'completed', expires_on: '2027-10-01', window_opens_on: '2027-08-02' })
  })

  it('reports success when the qualification saved but its log line could not be written, so it is never recorded twice', async () => {
    mocks.upload.mockResolvedValue({ path: `external/${SAM}/f.pdf`, sha256: 'b'.repeat(64), contentType: 'application/pdf', bytes: 4 })
    db.failNext({ table: 'training_events', operation: 'insert', message: 'connection reset', times: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await recordExternalQualification(form())
    spy.mockRestore()
    expect(result).toEqual({ success: true, data: { assignmentId: assignments()[0].id } })
    expect(assignments()).toHaveLength(1)
    expect(assignments()[0]).toMatchObject({ status: 'completed', external_file_path: `external/${SAM}/f.pdf` })
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'record_external' }))
  })

  it('refuses a certificate over 4 MB, which the platform could not take in one request, before storing anything', async () => {
    const data = form()
    data.set('file', new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'application/pdf' }), 'big.pdf')
    expect((await recordExternalQualification(data)).error).toBe('The certificate file is 5.0 MB; the most it can be is 4.0 MB.')
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(assignments()).toEqual([])
  })

  it('refuses an expiry on or before the issue date, and a course that is not external', async () => {
    expect((await recordExternalQualification(form({ expiresOn: '2026-10-01' }))).error).toBe('The expiry date must be after the issue date.')
    expect((await recordExternalQualification(form({ courseId: ONLINE }))).error).toBe('Allergen awareness is not an external qualification.')
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})

describe('reads', () => {
  it('shows the employee record even when the sync before it fails', async () => {
    db.failNext({ table: 'training_assignments', operation: 'select', message: 'timeout', times: 1 })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await getEmployeeTraining(SAM)
    expect(spy).toHaveBeenCalledWith('Training sync before the employee record failed:', expect.any(Error))
    spy.mockRestore()
    expect(result.success).toBe(true)
    expect(result.data?.employee).toMatchObject({ employeeId: SAM, name: 'Sam', hasLogin: true })
  })

  it('reports an unknown employee plainly', async () => {
    expect((await getEmployeeTraining('77777777-7777-4777-8777-777777777777')).error).toBe('That employee could not be found.')
  })

  it('syncTrainingNow runs as the manager and records it', async () => {
    const result = await syncTrainingNow()
    expect(result.success).toBe(true)
    expect(events('assigned').every((event) => event.actor_id === STAFF.id)).toBe(true)
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'sync', resource_type: 'training' }))
  })
})
