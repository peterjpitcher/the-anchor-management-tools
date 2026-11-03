// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseContentSchema } from '@/lib/training/course-schema'
import {
  TrainingError,
  type CourseContent,
  type CourseSection,
  type MyAssignmentView,
  type MyTrainingView,
  type NewTrainingEvent,
  type TrainingAssignment,
  type TrainingAssignmentPatch,
  type TrainingAttempt,
  type TrainingCourse,
  type TrainingCourseVersion,
  type TrainingProfile,
} from '@/lib/training/types'

/**
 * The staff portal training actions, run against an in-memory TrainingService. The pure rules
 * (draw, scoring, states, dates) are the real ones, so the draw is random: the tests read what
 * was served from the store rather than predicting it. Signing and the portal identity are mocked.
 */

// ---------------------------------------------------------------------------------------------
// The portal identity, signing and the service
// ---------------------------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  worker: vi.fn(),
  prepare: vi.fn(),
  revalidate: vi.fn(),
  logError: vi.fn(),
}))

vi.mock('@/lib/portal/worker', () => ({
  getPortalWorker: mocks.worker,
  getPortalWorkerName: async () => 'Jo Bloggs',
}))
vi.mock('@/lib/training/signing', () => ({ prepareTrainingCertificate: mocks.prepare }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }))
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.logError, warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

interface Store {
  courses: TrainingCourse[]
  versions: TrainingCourseVersion[]
  assignments: TrainingAssignment[]
  attempts: TrainingAttempt[]
  profiles: TrainingProfile[]
  events: NewTrainingEvent[]
  syncCalls: Array<{ employeeId?: string }>
  failSync: boolean
  /** Simulates a buggy service that leaks whole sections (questions included) into the player view. */
  leakQuestions: boolean
  clock: number
}

const store: Store = {
  courses: [],
  versions: [],
  assignments: [],
  attempts: [],
  profiles: [],
  events: [],
  syncCalls: [],
  failSync: false,
  leakQuestions: true,
  clock: 0,
}

function tick(): string {
  store.clock += 1
  return new Date(Date.UTC(2026, 10, 1, 12, 0, 0, store.clock)).toISOString()
}

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, '0')}`
}

vi.mock('@/services/training', () => ({
  TrainingService: {
    async syncAssignments(opts: { employeeId?: string }) {
      store.syncCalls.push(opts)
      if (store.failSync) throw new Error('database unreachable')
      return { created: 0, cancelled: 0, updated: 0 }
    },
    async getMyTraining(employeeId: string): Promise<MyTrainingView> {
      const mine = store.assignments.filter((assignment) => assignment.employeeId === employeeId)
      return {
        today: '2026-11-03',
        due: mine.map((assignment) => ({
          assignmentId: assignment.id,
          course: { id: assignment.courseId, slug: 'essentials', title: 'Essentials', kind: 'online', isEssentials: true, summary: null, estimatedMinutes: 25 },
          state: 'not_started',
          dueOn: assignment.dueOn,
          completedOn: null,
          expiresOn: null,
          sectionsPassed: 0,
          sectionsTotal: 2,
          action: 'start',
          waitingReason: null,
          supervisedOnly: false,
          certificatePartyId: null,
        })),
        waiting: [],
        done: [],
      }
    },
    async getMyAssignment(employeeId: string, assignmentId: string): Promise<MyAssignmentView | null> {
      const assignment = store.assignments.find((row) => row.id === assignmentId && row.employeeId === employeeId)
      if (!assignment) return null
      const version = store.versions.find((row) => row.id === (assignment.versionId ?? VERSION_ID))!
      const sections = version.content.sections.map((section) => ({
        ...(store.leakQuestions ? section : {}),
        key: section.key,
        title: section.title,
        objectives: section.objectives,
        cards: section.cards,
        resitNote: section.resitNote ?? null,
        questionsPerAttempt: section.check.questionsPerAttempt,
        maxWrong: section.check.maxWrong,
      }))
      return {
        assignmentId,
        courseId: assignment.courseId,
        status: assignment.status,
        state: 'not_started',
        dueOn: assignment.dueOn,
        course: {
          versionId: version.id,
          versionLabel: '1.0',
          slug: version.content.slug,
          title: version.content.title,
          summary: version.content.summary,
          kind: version.content.kind,
          estimatedMinutes: version.content.estimatedMinutes,
          intro: version.content.intro,
          sections,
          closing: version.content.closing,
          imageBaseUrl: `/api/training/images/${version.id}/`,
          ...(store.leakQuestions ? { legalBasis: version.content.legalBasis } : {}),
        },
        progress: assignment.progress,
        sectionStates: {},
        lockedSection: assignment.lockedSection,
        confirmation: { state: 'not_ready', confirmUrl: null },
      }
    },
    async getAssignment(id: string) {
      const row = store.assignments.find((assignment) => assignment.id === id)
      return row ? structuredClone(row) : null
    },
    async listAssignmentsForEmployee(employeeId: string) {
      return store.assignments.filter((row) => row.employeeId === employeeId).map((row) => structuredClone(row))
    },
    async updateAssignment(
      id: string,
      patch: TrainingAssignmentPatch,
      guard?: { expectedStatuses?: readonly string[]; expectedUpdatedAt?: string }
    ) {
      const row = store.assignments.find((assignment) => assignment.id === id)
      if (!row) throw new TrainingError('not_found', 'missing')
      if (guard?.expectedStatuses && !guard.expectedStatuses.includes(row.status)) throw new TrainingError('conflict', 'status moved')
      if (guard?.expectedUpdatedAt && guard.expectedUpdatedAt !== row.updatedAt) throw new TrainingError('conflict', 'row moved')
      Object.assign(row, structuredClone(patch), { updatedAt: tick() })
      return structuredClone(row)
    },
    async getCourseById(id: string) {
      return store.courses.find((course) => course.id === id) ?? null
    },
    async getCurrentVersion(courseId: string) {
      const course = store.courses.find((row) => row.id === courseId)
      return store.versions.find((row) => row.id === course?.currentVersionId) ?? null
    },
    async getPublishedVersion(id: string) {
      return store.versions.find((row) => row.id === id && row.state === 'published') ?? null
    },
    async getProfile(employeeId: string) {
      return store.profiles.find((profile) => profile.employeeId === employeeId) ?? null
    },
    async getOpenAttempt(assignmentId: string, sectionKey: string) {
      const row = store.attempts.find((attempt) => attempt.assignmentId === assignmentId && attempt.sectionKey === sectionKey && !attempt.submittedAt)
      return row ? structuredClone(row) : null
    },
    async listAttempts(assignmentId: string) {
      return store.attempts.filter((attempt) => attempt.assignmentId === assignmentId).map((row) => structuredClone(row))
    },
    async getAttempt(id: string) {
      const row = store.attempts.find((attempt) => attempt.id === id)
      return row ? structuredClone(row) : null
    },
    async createAttempt(input: Omit<TrainingAttempt, 'id' | 'startedAt' | 'submittedAt' | 'answers' | 'results' | 'wrongCount' | 'criticalMissed' | 'passed'>) {
      const clash = store.attempts.some(
        (attempt) =>
          attempt.assignmentId === input.assignmentId &&
          attempt.sectionKey === input.sectionKey &&
          (!attempt.submittedAt || attempt.attemptNo === input.attemptNo)
      )
      if (clash) throw new TrainingError('conflict', 'open attempt exists')
      const row: TrainingAttempt = {
        ...structuredClone(input),
        id: newId(),
        startedAt: tick(),
        submittedAt: null,
        answers: null,
        results: null,
        wrongCount: null,
        criticalMissed: null,
        passed: null,
      }
      store.attempts.push(row)
      return structuredClone(row)
    },
    async submitAttempt(id: string, input: Pick<TrainingAttempt, 'answers' | 'results' | 'wrongCount' | 'criticalMissed' | 'passed'> & { submittedAt: string }) {
      const row = store.attempts.find((attempt) => attempt.id === id)
      if (!row) throw new TrainingError('not_found', 'missing')
      if (row.submittedAt) throw new TrainingError('conflict', 'already submitted')
      Object.assign(row, structuredClone(input))
      return structuredClone(row)
    },
    async writeEvent(event: NewTrainingEvent) {
      store.events.push(structuredClone(event))
      return { id: newId(), ...event }
    },
  },
}))

import {
  getMyAssignment,
  getMyTraining,
  prepareMyConfirmation,
  saveTrainingProgress,
  startTrainingCheck,
  submitTrainingCheck,
} from '@/app/actions/training-portal'
import { CERTIFICATE_NUMBER_PATTERN } from '@/lib/training/certificate-number'

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

const ME = { userId: 'user-me', employeeId: 'emp-me' }
const COURSE_ID = '10000000-0000-4000-8000-000000000001'
const VERSION_ID = '20000000-0000-4000-8000-000000000001'
const MINE = '30000000-0000-4000-8000-000000000001'
const THEIRS = '30000000-0000-4000-8000-000000000002'
const UNKNOWN = '30000000-0000-4000-8000-000000000099'

function section(key: string, title: string): object {
  // Two objectives with four questions each (three critical), so a resit can always avoid the
  // previous draw of two per objective and still include a critical one.
  const questions = ['a', 'b'].flatMap((objective) =>
    [1, 2, 3, 4].map((n) => ({
      id: `${key}-${objective}${n}`,
      objective: `${key}-${objective}`,
      critical: n <= 3,
      prompt: `${title}: question ${objective}${n}?`,
      options: [`Right ${objective}${n}`, `Wrong one ${objective}${n}`, `Wrong two ${objective}${n}`],
      answer: 0,
      explanation: `SECRET explanation for ${key}-${objective}${n}.`,
    }))
  )
  return {
    key,
    title,
    objectives: [
      { key: `${key}-a`, text: 'First objective' },
      { key: `${key}-b`, text: 'Second objective' },
    ],
    cards: [
      { type: 'paragraph', text: 'Card one' },
      { type: 'paragraph', text: 'Card two' },
      { type: 'paragraph', text: 'Card three' },
    ],
    questions,
  }
}

const CONTENT: CourseContent = CourseContentSchema.parse({
  schemaVersion: 1,
  slug: 'essentials',
  title: 'Essentials',
  summary: 'The basics for everyone.',
  kind: 'online',
  audience: { groups: [], age: 'all' },
  essentials: true,
  deadline: { newStarterDays: 0, existingStaffDays: 14 },
  refresherMonths: 12,
  legalBasis: 'Health and safety at work.',
  estimatedMinutes: 25,
  intro: [{ type: 'paragraph', text: 'Welcome' }],
  sections: [section('fire', 'Fire'), section('allergens', 'Allergens')],
})

function makeAssignment(overrides: Partial<TrainingAssignment>): TrainingAssignment {
  return {
    id: MINE,
    employeeId: ME.employeeId,
    courseId: COURSE_ID,
    cycle: 1,
    reason: 'existing_staff',
    status: 'assigned',
    assignedOn: '2026-11-01',
    dueOn: '2026-11-15',
    windowOpensOn: null,
    versionId: null,
    progress: { sections: {}, current: null, introSeen: false },
    startedAt: null,
    lastSectionPassedAt: null,
    completedOn: null,
    expiresOn: null,
    certificateNumber: null,
    signingDocumentId: null,
    confirmedAt: null,
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
    signoffTasks: null,
    signedOffBy: null,
    signedOffByName: null,
    signedOffOn: null,
    supervisedOnly: false,
    trainedInPerson: false,
    inPersonRecordedBy: null,
    inPersonRecordedByName: null,
    dueChangeReason: null,
    createdAt: '2026-11-01T09:00:00.000Z',
    updatedAt: '2026-11-01T09:00:00.000Z',
    ...overrides,
  }
}

function mine(): TrainingAssignment {
  return store.assignments.find((row) => row.id === MINE)!
}

beforeEach(() => {
  store.courses = [
    {
      id: COURSE_ID,
      slug: 'essentials',
      title: 'Essentials',
      kind: 'online',
      audienceGroups: [],
      audienceAge: 'all',
      isEssentials: true,
      prerequisiteCourseId: null,
      newStarterDueDays: 0,
      existingStaffDueDays: 14,
      refresherMonths: 12,
      windowDays: 30,
      supervisedOnlyUnder18: false,
      displayOrder: 1,
      status: 'live',
      currentVersionId: VERSION_ID,
      summary: null,
      createdBy: null,
      createdByName: null,
      createdAt: '2026-11-01T09:00:00.000Z',
      updatedAt: '2026-11-01T09:00:00.000Z',
    },
  ]
  store.versions = [
    {
      id: VERSION_ID,
      courseId: COURSE_ID,
      state: 'published',
      major: 1,
      minor: 0,
      content: CONTENT,
      contentSha256: 'a'.repeat(64),
      images: [],
      changeNote: null,
      redoRequired: false,
      uploadedBy: null,
      uploadedByName: null,
      uploadedAt: '2026-11-01T09:00:00.000Z',
      publishedBy: null,
      publishedByName: null,
      publishedAt: '2026-11-01T09:00:00.000Z',
    },
  ]
  store.assignments = [makeAssignment({}), makeAssignment({ id: THEIRS, employeeId: 'emp-other' })]
  store.attempts = []
  store.profiles = []
  store.events = []
  store.syncCalls = []
  store.failSync = false
  store.leakQuestions = true
  mocks.worker.mockReset().mockResolvedValue(ME)
  mocks.prepare.mockReset().mockResolvedValue({ documentId: 'doc-1', partyId: 'party-1' })
  mocks.revalidate.mockReset()
  mocks.logError.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------------------------
// Helpers that drive the actions as the player would
// ---------------------------------------------------------------------------------------------

async function readCards(sectionKey: string, assignmentId = MINE): Promise<void> {
  for (let card = 0; card < 3; card += 1) {
    const saved = await saveTrainingProgress({ assignmentId, sectionKey, card })
    expect(saved).toEqual({ success: true })
  }
}

function sectionOf(key: string): CourseSection {
  return CONTENT.sections.find((candidate) => candidate.key === key)!
}

/** Displayed answers for the open attempt: right ones, or `wrongCount` wrong ones (critical first). */
function answersFor(attemptId: string, wrong = 0): Record<string, number> {
  const attempt = store.attempts.find((row) => row.id === attemptId)!
  const answers: Record<string, number> = {}
  let wrongLeft = wrong
  for (const item of attempt.served) {
    const question = sectionOf(attempt.sectionKey).questions.find((candidate) => candidate.id === item.questionId)!
    const right = item.optionOrder.indexOf(question.answer)
    answers[item.questionId] = wrongLeft > 0 ? (right + 1) % 3 : right
    if (wrongLeft > 0) wrongLeft -= 1
  }
  return answers
}

async function startCheck(sectionKey: string) {
  const started = await startTrainingCheck({ assignmentId: MINE, sectionKey })
  expect(started.error).toBeUndefined()
  return started.data!
}

async function passSection(sectionKey: string) {
  await readCards(sectionKey)
  const check = await startCheck(sectionKey)
  return submitTrainingCheck({ attemptId: check.attemptId, answers: answersFor(check.attemptId) })
}

async function failSection(sectionKey: string) {
  await readCards(sectionKey)
  const check = await startCheck(sectionKey)
  return submitTrainingCheck({ attemptId: check.attemptId, answers: answersFor(check.attemptId, 2) })
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

describe('portal training: identity', () => {
  it('refuses every action when nobody is signed in, and writes nothing', async () => {
    mocks.worker.mockResolvedValue(null)
    const results = await Promise.all([
      getMyTraining(),
      getMyAssignment(MINE),
      saveTrainingProgress({ assignmentId: MINE, sectionKey: 'fire', card: 0 }),
      startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' }),
      submitTrainingCheck({ attemptId: UNKNOWN, answers: {} }),
      prepareMyConfirmation({ assignmentId: MINE }),
    ])
    for (const result of results) {
      expect(result).toEqual({ error: 'Please sign in with your own staff login to see your training.' })
    }
    expect(store.syncCalls).toEqual([])
    expect(store.events).toEqual([])
    expect(mine().startedAt).toBeNull()
  })

  it('fails closed when the employee record cannot be read', async () => {
    mocks.worker.mockRejectedValue(new Error('connection reset'))
    expect(await getMyTraining()).toEqual({ error: 'We could not check who you are just now. Please try again in a minute.' })
    expect(store.syncCalls).toEqual([])
    expect(mocks.logError).toHaveBeenCalled()
  })

  it('answers another person’s assignment exactly like an unknown one', async () => {
    const notFound = { error: 'We could not find this training.' }
    expect(await getMyAssignment(THEIRS)).toEqual(notFound)
    expect(await getMyAssignment(UNKNOWN)).toEqual(notFound)
    expect(await getMyAssignment('not-a-uuid')).toEqual(notFound)
    expect(await saveTrainingProgress({ assignmentId: THEIRS, sectionKey: 'fire', card: 0 })).toEqual(notFound)
    expect(await startTrainingCheck({ assignmentId: THEIRS, sectionKey: 'fire' })).toEqual(notFound)
    expect(await prepareMyConfirmation({ assignmentId: THEIRS })).toEqual(notFound)
    expect(store.assignments.find((row) => row.id === THEIRS)!.startedAt).toBeNull()
    expect(mocks.prepare).not.toHaveBeenCalled()
  })

  it('refuses to mark someone else’s check', async () => {
    store.assignments.find((row) => row.id === THEIRS)!.versionId = VERSION_ID
    store.attempts.push({
      id: UNKNOWN,
      assignmentId: THEIRS,
      employeeId: 'emp-other',
      versionId: VERSION_ID,
      sectionKey: 'fire',
      attemptNo: 1,
      served: [{ questionId: 'fire-a1', optionOrder: [0, 1, 2] }],
      startedAt: '2026-11-01T10:00:00.000Z',
      submittedAt: null,
      answers: null,
      results: null,
      wrongCount: null,
      criticalMissed: null,
      passed: null,
    })
    expect(await submitTrainingCheck({ attemptId: UNKNOWN, answers: { 'fire-a1': 0 } })).toEqual({ error: 'We could not find this training.' })
    expect(store.attempts[0].submittedAt).toBeNull()
  })
})

describe('portal training: My Training', () => {
  it('syncs my own assignments first, then lists mine only', async () => {
    const result = await getMyTraining()
    expect(store.syncCalls).toEqual([{ employeeId: ME.employeeId }])
    expect(result.success).toBe(true)
    expect(result.data!.due.map((item) => item.assignmentId)).toEqual([MINE])
  })

  it('shows an error, not an empty list, when the sync fails', async () => {
    store.failSync = true
    expect(await getMyTraining()).toEqual({ error: 'Sorry, we could not load your training just now. Please try again in a minute.' })
  })
})

describe('portal training: answers stay on the server', () => {
  it('never returns questions or answers in the player view, even if the service leaks them', async () => {
    const result = await getMyAssignment(MINE)
    expect(result.success).toBe(true)
    const json = JSON.stringify(result.data)
    expect(json).not.toContain('SECRET explanation')
    expect(json).not.toContain('question a1')
    expect(json).not.toContain('legalBasis')
    for (const playerSection of result.data!.course.sections) {
      expect(Object.keys(playerSection).sort()).toEqual(['cards', 'key', 'maxWrong', 'objectives', 'questionsPerAttempt', 'resitNote', 'title'])
    }
  })

  it('serves a check with prompts and options only, in displayed order', async () => {
    await readCards('fire')
    const check = await startCheck('fire')
    expect(check.attemptNo).toBe(1)
    expect(check.questions).toHaveLength(4)
    for (const question of check.questions) {
      expect(Object.keys(question).sort()).toEqual(['id', 'options', 'prompt'])
      const served = store.attempts[0].served.find((item) => item.questionId === question.id)!
      const original = sectionOf('fire').questions.find((candidate) => candidate.id === question.id)!
      expect(question.options).toEqual(served.optionOrder.map((index) => original.options[index]))
    }
    expect(JSON.stringify(check)).not.toContain('SECRET explanation')
  })
})

describe('portal training: practical notes', () => {
  const PRACTICAL_COURSE_ID = '10000000-0000-4000-8000-000000000002'
  const PRACTICAL_VERSION_ID = '20000000-0000-4000-8000-000000000002'
  const PRACTICAL_ITEM = '30000000-0000-4000-8000-000000000003'

  beforeEach(() => {
    const practical = CourseContentSchema.parse({
      schemaVersion: 1,
      slug: 'kegs',
      title: 'Changing a keg',
      summary: 'A manager watches you change a keg safely.',
      kind: 'practical',
      audience: { groups: [], age: 'all' },
      deadline: { newStarterDays: null, existingStaffDays: null },
      refresherMonths: 12,
      legalBasis: 'MHOR 1992.',
      estimatedMinutes: 15,
      intro: [{ type: 'paragraph', text: 'Read this before your sign-off.' }],
      tasks: [{ key: 'change-keg', text: 'Changes a keg safely.' }],
    })
    store.courses.push({ ...store.courses[0], id: PRACTICAL_COURSE_ID, slug: 'kegs', title: 'Changing a keg', kind: 'practical', currentVersionId: PRACTICAL_VERSION_ID })
    store.versions.push({ ...store.versions[0], id: PRACTICAL_VERSION_ID, courseId: PRACTICAL_COURSE_ID, content: practical })
    store.assignments.push(makeAssignment({ id: PRACTICAL_ITEM, courseId: PRACTICAL_COURSE_ID, versionId: PRACTICAL_VERSION_ID, dueOn: null }))
  })

  it('opens a practical course read only, so its notes can be read', async () => {
    const result = await getMyAssignment(PRACTICAL_ITEM)
    expect(result.error).toBeUndefined()
    expect(result.data!.course).toMatchObject({
      kind: 'practical',
      intro: [{ type: 'paragraph', text: 'Read this before your sign-off.' }],
      sections: [],
    })
  })

  it('still records nothing for it: saving progress is refused', async () => {
    expect(await saveTrainingProgress({ assignmentId: PRACTICAL_ITEM, sectionKey: '_intro', card: 0 })).toEqual({
      error: 'This training is done in person with a manager, not on your phone.',
    })
    expect(store.events).toEqual([])
    expect(store.assignments.find((row) => row.id === PRACTICAL_ITEM)!.startedAt).toBeNull()
  })

  it('refuses an external qualification, which has no notes', async () => {
    store.courses.find((course) => course.id === PRACTICAL_COURSE_ID)!.kind = 'external'
    expect(await getMyAssignment(PRACTICAL_ITEM)).toEqual({ error: 'This training is done in person with a manager, not on your phone.' })
  })
})

describe('portal training: progress and starting', () => {
  it('pins the version and writes one started event on the first save', async () => {
    await saveTrainingProgress({ assignmentId: MINE, sectionKey: '_intro', card: 0 })
    expect(mine()).toMatchObject({ status: 'in_progress', versionId: VERSION_ID })
    expect(mine().startedAt).not.toBeNull()
    expect(mine().progress.introSeen).toBe(true)
    await readCards('fire')
    expect(store.events.filter((event) => event.eventType === 'started')).toEqual([
      expect.objectContaining({ employeeId: ME.employeeId, assignmentId: MINE, actor: { id: ME.userId, name: 'Jo Bloggs' } }),
    ])
    expect(mine().progress.sections.fire.card).toBe(2)
  })

  it('refuses a check before the cards are read, or for a section that is not the current one', async () => {
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({
      error: 'Read every card in this section before you start the check.',
    })
    await saveTrainingProgress({ assignmentId: MINE, sectionKey: 'fire', card: 1 })
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({
      error: 'Read every card in this section before you start the check.',
    })
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'allergens' })).toEqual({ error: 'Finish the earlier sections first.' })
    expect(store.attempts).toEqual([])
  })

  it.each([
    ['locked', 'This section is locked. A manager will go through it with you and then unlock it.'],
    ['completed', 'You have already finished this training.'],
    ['waived', 'You do not need to do this training any more.'],
    ['cancelled', 'You do not need to do this training any more.'],
    ['declined', 'A manager needs to talk this through with you before you can carry on.'],
    ['waiting', 'This training opens when you have finished the course before it.'],
  ] as const)('refuses to start a check while the item is %s', async (status, message) => {
    await readCards('fire')
    mine().status = status
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({ error: message })
    expect(store.attempts).toEqual([])
  })

  it('refuses to start a check while training is paused', async () => {
    await readCards('fire')
    store.profiles = [
      {
        employeeId: ME.employeeId,
        groups: [],
        groupsConfirmedAt: null,
        groupsConfirmedBy: null,
        groupsConfirmedByName: null,
        pausedFrom: '2026-01-01',
        pausedUntil: null,
        pauseReason: 'other',
        adjustmentNote: null,
        createdAt: '2026-11-01T09:00:00.000Z',
        updatedAt: '2026-11-01T09:00:00.000Z',
      },
    ]
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({
      error: 'Your training is paused at the moment. A manager will tell you when it starts again.',
    })
  })

  it('returns the open attempt again on reload, never a second draw', async () => {
    await readCards('fire')
    const first = await startCheck('fire')
    const again = await startCheck('fire')
    expect(again).toEqual(first)
    expect(store.attempts).toHaveLength(1)
  })
})

describe('portal training: marking', () => {
  it('passes a section, records the attempt once and moves on', async () => {
    const result = await passSection('fire')
    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ passed: true, wrongCount: 0, criticalMissed: 0, maxWrong: 1, next: 'next_section' })
    expect(result.data!.confirmUrl).toBeUndefined()
    for (const item of result.data!.results) {
      expect(item.correct).toBe(true)
      expect(item.chosen).toBe(item.correctIndex)
      expect(item.explanation).toContain('SECRET explanation')
    }
    const attempt = store.attempts[0]
    expect(attempt).toMatchObject({ passed: true, wrongCount: 0 })
    expect(Object.values(attempt.answers!)).toEqual([0, 0, 0, 0])
    expect(mine().progress.sections.fire.passedAt).not.toBeNull()
    expect(mine().status).toBe('in_progress')
    expect(store.events.map((event) => event.eventType)).toEqual(['started', 'section_passed'])

    const again = await submitTrainingCheck({ attemptId: attempt.id, answers: answersFor(attempt.id) })
    expect(again).toEqual({ error: 'This check has already been marked. Reload the page to see where you are.' })
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({ error: 'You have already passed this section.' })
  })

  it('fails a section back to card 0 and draws different questions next time', async () => {
    const result = await failSection('fire')
    expect(result.data).toMatchObject({ passed: false, wrongCount: 2, next: 'retry' })
    expect(mine().progress.sections.fire).toMatchObject({ card: 0, fails: 1, passedAt: null })
    expect(mine().status).toBe('in_progress')
    expect(store.events.at(-1)).toMatchObject({ eventType: 'section_failed', meta: expect.objectContaining({ fails: 1 }) })

    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({
      error: 'Read every card in this section before you start the check.',
    })
    await readCards('fire')
    const second = await startCheck('fire')
    expect(second.attemptNo).toBe(2)
    const firstIds = store.attempts[0].served.map((item) => item.questionId)
    expect(second.questions.map((question) => question.id).filter((id) => firstIds.includes(id))).toEqual([])
  })

  it('fails on one critical wrong answer even when only one is wrong', async () => {
    await readCards('fire')
    const check = await startCheck('fire')
    const attempt = store.attempts[0]
    const criticalId = attempt.served.find((item) => sectionOf('fire').questions.find((q) => q.id === item.questionId)!.critical)!.questionId
    const answers = answersFor(check.attemptId)
    answers[criticalId] = (answers[criticalId] + 1) % 3
    const result = await submitTrainingCheck({ attemptId: check.attemptId, answers })
    expect(result.data).toMatchObject({ passed: false, wrongCount: 1, criticalMissed: 1, next: 'retry' })
  })

  it('locks the item on the third fail', async () => {
    await failSection('fire')
    await failSection('fire')
    const third = await failSection('fire')
    expect(third.data!.next).toBe('locked')
    expect(mine()).toMatchObject({ status: 'locked', lockedSection: 'fire' })
    expect(mine().lockedAt).not.toBeNull()
    expect(store.events.map((event) => event.eventType).slice(-2)).toEqual(['section_failed', 'locked'])
    expect(await startTrainingCheck({ assignmentId: MINE, sectionKey: 'fire' })).toEqual({
      error: 'This section is locked. A manager will go through it with you and then unlock it.',
    })
  })
})

describe('portal training: finishing', () => {
  function setUpRefresherCycle(): void {
    // Cycle 1 completed and expiring 20 July 2027; this is the refresher, finished early.
    store.assignments = [
      makeAssignment({ id: UNKNOWN, cycle: 1, status: 'completed', completedOn: '2026-07-20', expiresOn: '2027-07-20' }),
      makeAssignment({ cycle: 2, reason: 'refresher' }),
    ]
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-06-30T23:30:00.000Z') })
  }

  it('stores completion before preparing the certificate, and offers a retry when preparing fails', async () => {
    setUpRefresherCycle()
    mocks.prepare.mockRejectedValue(new Error('Chromium cold start timed out'))
    await passSection('fire')
    const last = await passSection('allergens')

    expect(last.success).toBe(true)
    expect(last.data).toMatchObject({ passed: true, next: 'confirm_retry' })
    expect(last.data!.confirmUrl).toBeUndefined()
    // 23:30 UTC on 30 June is 00:30 on 1 July in London (BST).
    expect(mine()).toMatchObject({
      status: 'awaiting_confirmation',
      completedOn: '2027-07-01',
      // Finished before the old expiry, so the new one extends from it.
      expiresOn: '2028-07-20',
      windowOpensOn: '2028-06-20',
    })
    expect(mine().certificateNumber).toMatch(CERTIFICATE_NUMBER_PATTERN)
    expect(mocks.prepare).toHaveBeenCalledWith(MINE)
    expect(mocks.logError).toHaveBeenCalled()
    expect(store.events.at(-1)).toMatchObject({ eventType: 'section_passed', meta: expect.objectContaining({ finished: true }) })
  })

  it('extends a refresher done after a waived one from the expiry the waiver ran to', async () => {
    // Completed to 20 July 2026, the 2026 refresher waived (one period, to 20 July 2027), and this
    // refresher finished early in its window: the new expiry runs on from 20 July 2027.
    store.assignments = [
      makeAssignment({ id: UNKNOWN, cycle: 1, status: 'completed', completedOn: '2025-07-20', expiresOn: '2026-07-20' }),
      makeAssignment({ id: 'a7777777-7777-4777-8777-777777777777', cycle: 2, reason: 'refresher', status: 'waived' }),
      makeAssignment({ cycle: 3, reason: 'refresher' }),
    ]
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-06-30T23:30:00.000Z') })
    await passSection('fire')
    await passSection('allergens')
    expect(mine()).toMatchObject({ status: 'awaiting_confirmation', completedOn: '2027-07-01', expiresOn: '2028-07-20', windowOpensOn: '2028-06-20' })
  })

  it('returns the confirmation link when the certificate is ready', async () => {
    setUpRefresherCycle()
    await passSection('fire')
    const last = await passSection('allergens')
    expect(last.data).toMatchObject({ next: 'confirm', confirmUrl: '/portal/documents/party-1' })
    expect(mine().status).toBe('awaiting_confirmation')
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
  })

  it('lets the person ask again for the confirmation once every section is passed', async () => {
    expect(await prepareMyConfirmation({ assignmentId: MINE })).toEqual({ error: 'Pass every section first, then you can confirm your training.' })
    mine().status = 'awaiting_confirmation'
    mocks.prepare.mockRejectedValueOnce(new Error('still cold'))
    expect(await prepareMyConfirmation({ assignmentId: MINE })).toEqual({
      error: 'We could not prepare your certificate just now. Please try again in a minute.',
    })
    expect(await prepareMyConfirmation({ assignmentId: MINE })).toEqual({ success: true, data: { confirmUrl: '/portal/documents/party-1' } })
    mine().status = 'completed'
    expect(await prepareMyConfirmation({ assignmentId: MINE })).toEqual({ error: 'You have already confirmed this training.' })
  })
})
