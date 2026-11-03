// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeDb, type FakeDb } from '../../helpers/fakeSupabaseDb'
import type {
  NewTrainingEvent,
  TrainingAssignment,
  TrainingAssignmentPatch,
  TrainingAttempt,
  TrainingCourse,
  TrainingCourseVersion,
} from '@/lib/training/types'

/**
 * Training through the shared signing feature (src/lib/training/signing.ts). The signing service
 * and the training service are stood in for here (each has its own tests); what is tested is the
 * training side: which document is made, when one is reused, and how the item moves.
 */

type Row = Record<string, unknown>
type AnyMock = import('vitest').Mock<(...args: any[]) => any>

const state = vi.hoisted(() => ({
  client: null as unknown,
  assignments: new Map<string, unknown>(),
  courses: new Map<string, unknown>(),
  versions: new Map<string, unknown>(),
  attempts: [] as unknown[],
  events: [] as unknown[],
  createRequest: null as unknown as AnyMock,
  prepare: null as unknown as AnyMock,
  inPerson: null as unknown as AnyMock,
  voidDocument: null as unknown as AnyMock,
  writeEvent: null as unknown as AnyMock,
  loggerError: null as unknown as AnyMock,
  tick: 0,
}))

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: (...args: unknown[]) => state.loggerError(...args) },
}))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => state.client }))
vi.mock('@/lib/signing/prepare', () => ({ prepareSigningDocument: (...args: unknown[]) => state.prepare(...args) }))
vi.mock('@/lib/signing/service', () => ({
  createSigningRequest: (...args: unknown[]) => state.createRequest(...args),
  startInPersonSigning: (...args: unknown[]) => state.inPerson(...args),
  voidSigningDocument: (...args: unknown[]) => state.voidDocument(...args),
}))
vi.mock('@/services/training', async () => {
  const { TrainingError } = await import('@/lib/training/types')
  const get = (id: string) => (state.assignments.get(id) as TrainingAssignment | undefined) ?? null
  return {
    TrainingService: {
      getAssignment: async (id: string) => (get(id) ? { ...(get(id) as TrainingAssignment) } : null),
      findAssignmentBySigningDocument: async (documentId: string) => {
        const found = [...state.assignments.values()].find((row) => (row as TrainingAssignment).signingDocumentId === documentId)
        return found ? { ...(found as TrainingAssignment) } : null
      },
      updateAssignment: async (
        id: string,
        patch: TrainingAssignmentPatch,
        guard?: { expectedStatuses?: readonly string[]; expectedUpdatedAt?: string }
      ) => {
        const current = get(id)
        if (!current) throw new TrainingError('not_found', 'That training item could not be found.')
        if (guard?.expectedStatuses?.length && !guard.expectedStatuses.includes(current.status)) {
          throw new TrainingError('conflict', 'changed')
        }
        if (guard?.expectedUpdatedAt && guard.expectedUpdatedAt !== current.updatedAt) throw new TrainingError('conflict', 'changed')
        state.tick += 1
        const next = { ...current, ...patch, updatedAt: `t${state.tick}` }
        state.assignments.set(id, next)
        return { ...next }
      },
      writeEvent: (...args: unknown[]) => state.writeEvent(...args),
      getCourseById: async (id: string) => (state.courses.get(id) as TrainingCourse | undefined) ?? null,
      getPublishedVersion: async (id: string) => (state.versions.get(id) as TrainingCourseVersion | undefined) ?? null,
      getCurrentVersion: async (courseId: string) => {
        const course = state.courses.get(courseId) as TrainingCourse | undefined
        return course?.currentVersionId ? ((state.versions.get(course.currentVersionId) as TrainingCourseVersion | undefined) ?? null) : null
      },
      listAttempts: async (assignmentId: string) =>
        (state.attempts as TrainingAttempt[]).filter((attempt) => attempt.assignmentId === assignmentId),
      listAssignmentsForEmployee: async (employeeId: string) =>
        [...state.assignments.values()].filter((row) => (row as TrainingAssignment).employeeId === employeeId),
    },
  }
})

import {
  createPracticalSignoff,
  onTrainingSigningCompleted,
  onTrainingSigningDeclined,
  prepareTrainingCertificate,
} from '@/lib/training/signing'
import { CERTIFICATE_NUMBER_PATTERN } from '@/lib/training/certificate-number'
import { TrainingError } from '@/lib/training/types'

const NOW = new Date('2026-11-02T10:00:00.000Z')
const IN_A_MONTH = '2026-12-02T10:00:00.000Z'
const MANAGER = { id: '33333333-3333-4333-8333-333333333333', name: 'Billy Manager' }

const ONLINE: Partial<TrainingCourse> = {
  id: 'course-1',
  slug: 'essentials',
  title: 'Essentials',
  kind: 'online',
  refresherMonths: 12,
  windowDays: 30,
  supervisedOnlyUnder18: false,
  currentVersionId: 'v1',
}
const PRACTICAL: Partial<TrainingCourse> = {
  id: 'course-2',
  slug: 'cellar',
  title: 'Cellar and lines',
  kind: 'practical',
  refresherMonths: 24,
  windowDays: 30,
  supervisedOnlyUnder18: true,
  currentVersionId: 'v2',
}
const ONLINE_VERSION = {
  id: 'v1',
  courseId: 'course-1',
  state: 'published',
  major: 1,
  minor: 0,
  contentSha256: 'a'.repeat(64),
  content: {
    sections: [
      { key: 's1', title: 'Serving alcohol' },
      { key: 's2', title: 'Food allergies' },
    ],
    tasks: [],
  },
}
const PRACTICAL_VERSION = {
  id: 'v2',
  courseId: 'course-2',
  state: 'published',
  major: 1,
  minor: 2,
  contentSha256: 'b'.repeat(64),
  content: {
    sections: [],
    tasks: [
      { key: 'change-keg', text: 'Change a keg safely' },
      { key: 'clean-lines', text: 'Clean the beer lines' },
      { key: 'gas', text: 'Change a gas bottle' },
    ],
  },
}

function assignment(overrides: Partial<TrainingAssignment> = {}): TrainingAssignment {
  return {
    id: 'a1',
    employeeId: 'emp-1',
    courseId: 'course-1',
    cycle: 1,
    reason: 'new_starter',
    status: 'awaiting_confirmation',
    assignedOn: '2026-10-20',
    dueOn: '2026-11-03',
    windowOpensOn: '2027-09-30',
    versionId: 'v1',
    progress: {
      sections: {
        s1: { card: 0, fails: 0, passedAt: '2026-10-29T11:00:00.000Z', lastAttemptQuestionIds: [] },
        s2: { card: 0, fails: 0, passedAt: '2026-10-30T09:00:00.000Z', lastAttemptQuestionIds: [] },
      },
      current: null,
      introSeen: true,
    },
    startedAt: '2026-10-29T10:00:00.000Z',
    lastSectionPassedAt: '2026-10-30T09:00:00.000Z',
    completedOn: '2026-10-30',
    expiresOn: '2027-10-30',
    certificateNumber: 'AT-0123456789',
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
    dueChangeReason: null,
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: 't0',
    ...overrides,
  }
}

function practicalAssignment(overrides: Partial<TrainingAssignment> = {}): TrainingAssignment {
  return assignment({
    id: 'a2',
    courseId: 'course-2',
    status: 'assigned',
    versionId: null,
    progress: { sections: {}, current: null, introSeen: false },
    startedAt: null,
    lastSectionPassedAt: null,
    completedOn: null,
    expiresOn: null,
    windowOpensOn: null,
    certificateNumber: null,
    ...overrides,
  })
}

let db: FakeDb
let documentCount: number

function current(id = 'a1'): TrainingAssignment {
  return state.assignments.get(id) as TrainingAssignment
}

function events(type?: string): NewTrainingEvent[] {
  return (state.events as NewTrainingEvent[]).filter((event) => !type || event.eventType === type)
}

/** A signing document as createSigningRequest leaves it, with its learner. */
function seedDocument(input: {
  id: string
  kind?: string
  status?: string
  seriesKey?: string
  assignmentId?: string
  expiresAt?: string
  completedAt?: string | null
  partyStatus?: string
  declinedAt?: string | null
}): void {
  db.rows('signing_documents').push({
    id: input.id,
    kind: input.kind ?? 'training_completion',
    status: input.status ?? 'sent',
    subject_type: 'employee',
    subject_id: 'emp-1',
    series_key: input.seriesKey ?? 'training:essentials',
    version: db.rows('signing_documents').length + 1,
    expires_at: input.expiresAt ?? IN_A_MONTH,
    completed_at: input.completedAt ?? null,
    context: { training: { assignment_id: input.assignmentId ?? 'a1', course_title: 'Essentials', learner_name: 'Sam Example' } },
  })
  db.rows('signing_parties').push({
    id: `party-${input.id}`,
    document_id: input.id,
    role: 'worker',
    status: input.partyStatus ?? 'pending',
    declined_at: input.declinedAt ?? null,
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  db = createFakeDb({
    employees: [
      {
        employee_id: 'emp-1',
        first_name: 'Sam',
        last_name: 'Example',
        email_address: 'sam@example.com',
        // 17 in October 2026.
        date_of_birth: '2009-06-01',
        status: 'Active',
      },
    ],
    signing_documents: [],
    signing_parties: [],
  })
  state.client = db.client
  state.assignments = new Map([['a1', assignment()]])
  state.courses = new Map<string, unknown>([
    ['course-1', ONLINE],
    ['course-2', PRACTICAL],
  ])
  state.versions = new Map<string, unknown>([
    ['v1', ONLINE_VERSION],
    ['v2', PRACTICAL_VERSION],
  ])
  state.attempts = [
    { id: 't1', assignmentId: 'a1', sectionKey: 's1', attemptNo: 1, submittedAt: '2026-10-29T11:00:00.000Z', passed: true },
    { id: 't2', assignmentId: 'a1', sectionKey: 's2', attemptNo: 1, submittedAt: '2026-10-30T08:00:00.000Z', passed: false },
    { id: 't3', assignmentId: 'a1', sectionKey: 's2', attemptNo: 2, submittedAt: '2026-10-30T09:00:00.000Z', passed: true },
    // Started and never submitted: not a check taken.
    { id: 't4', assignmentId: 'a1', sectionKey: 's2', attemptNo: 3, submittedAt: null, passed: null },
  ]
  state.events = []
  state.tick = 0
  documentCount = 0
  state.writeEvent = vi.fn(async (event: NewTrainingEvent) => {
    state.events.push(event)
    return event
  })
  state.loggerError = vi.fn()
  state.prepare = vi.fn(async (input: { source: { html: string } }) => ({ pdf: Buffer.from('%PDF'), render: { html: input.source.html } }))
  state.createRequest = vi.fn(async (input: Row) => {
    documentCount += 1
    const id = `doc-${documentCount}`
    // Earlier unsigned versions in the series are voided, as the real service does.
    for (const row of db.rows('signing_documents')) {
      if (row.series_key === input.seriesKey && ['sent', 'part_signed'].includes(row.status as string)) row.status = 'voided'
    }
    db.rows('signing_documents').push({
      id,
      kind: input.kind,
      status: input.kind === 'training_signoff' ? 'part_signed' : 'sent',
      subject_type: 'employee',
      subject_id: input.subjectId,
      series_key: input.seriesKey,
      version: documentCount,
      expires_at: IN_A_MONTH,
      completed_at: null,
      context: input.context,
    })
    db.rows('signing_parties').push({ id: `party-${id}`, document_id: id, role: 'worker', status: 'pending', declined_at: null })
    return { documentId: id, version: documentCount, deliveries: [{ partyId: `party-${id}`, name: 'Sam Example', email: 'sam@example.com', email_status: 'caller_sends' }] }
  })
  state.inPerson = vi.fn(async (input: { partyId: string }) => ({ url: `https://management.example.test/sign/token-for-${input.partyId}` }))
  state.voidDocument = vi.fn(async () => undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('preparing the certificate pack', () => {
  it('makes one confirmation the app sends by itself, and points the item at it', async () => {
    const prepared = await prepareTrainingCertificate('a1')

    expect(prepared).toEqual({ documentId: 'doc-1', partyId: 'party-doc-1' })
    expect(state.createRequest).toHaveBeenCalledTimes(1)
    const request = state.createRequest.mock.calls[0][0] as Row
    expect(request).toMatchObject({
      kind: 'training_completion',
      subjectId: 'emp-1',
      title: 'Essentials training, version 1.0',
      createdBy: null,
      seriesKey: 'training:essentials',
      sendLinkEmails: false,
      parties: [{ role: 'worker', name: 'Sam Example', email: 'sam@example.com', employeeId: 'emp-1', identityCheck: 'date_of_birth' }],
      context: {
        training: {
          assignment_id: 'a1',
          course_id: 'course-1',
          course_slug: 'essentials',
          course_title: 'Essentials',
          version_label: '1.0',
          certificate_number: 'AT-0123456789',
          cycle: 1,
          learner_name: 'Sam Example',
        },
      },
    })
    expect(current()).toMatchObject({ signingDocumentId: 'doc-1', status: 'awaiting_confirmation' })
    expect(events().map((event) => event.eventType)).toEqual(['confirmation_prepared'])
    expect(events()[0]).toMatchObject({ assignmentId: 'a1', courseId: 'course-1', employeeId: 'emp-1', meta: { documentId: 'doc-1' } })
  })

  it('prints the stored result: dates, number, and each section with the checks taken', async () => {
    await prepareTrainingCertificate('a1')
    const prepare = state.prepare.mock.calls[0][0] as { source: { html: string; profile: string }; mode: string; sender: unknown }
    expect(prepare.mode).toBe('acknowledge')
    expect(prepare.sender).toBeNull()
    expect(prepare.source.profile).toBe('a4_margins')
    const html = prepare.source.html.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, 'LOGO')
    expect(html).toContain('All sections passed on 30 October 2026')
    expect(html).toContain('<th>Refresher</th><td>Due by 30 October 2027</td>')
    expect(html).toContain('AT-0123456789')
    expect(html).toContain('<td>Serving alcohol</td><td>1</td><td>Yes</td><td>29 October 2026</td>')
    expect(html).toContain('<td>Food allergies</td><td>2</td><td>No</td><td>30 October 2026</td>')
    expect(html).not.toMatch(/undefined|Invalid Date|NaN/)
  })

  it('is idempotent: a second call returns the same document and makes nothing', async () => {
    const first = await prepareTrainingCertificate('a1')
    const second = await prepareTrainingCertificate('a1')
    expect(second).toEqual(first)
    expect(state.createRequest).toHaveBeenCalledTimes(1)
    expect(events('confirmation_prepared')).toHaveLength(1)
  })

  it('picks up a document the item lost its link to, instead of making another', async () => {
    seedDocument({ id: 'orphan' })
    expect(await prepareTrainingCertificate('a1')).toEqual({ documentId: 'orphan', partyId: 'party-orphan' })
    expect(state.createRequest).not.toHaveBeenCalled()
    expect(current().signingDocumentId).toBe('orphan')
  })

  it('does not pick up a document made for another item in the same series', async () => {
    seedDocument({ id: 'other-cycle', assignmentId: 'a-older' })
    expect((await prepareTrainingCertificate('a1')).documentId).toBe('doc-1')
  })

  it('makes a new document when the last one has run out of time', async () => {
    seedDocument({ id: 'old', expiresAt: '2026-11-01T10:00:00.000Z' })
    state.assignments.set('a1', assignment({ signingDocumentId: 'old' }))
    expect((await prepareTrainingCertificate('a1')).documentId).toBe('doc-1')
    expect(current().signingDocumentId).toBe('doc-1')
  })

  it('completes the item, and asks nothing more, when a confirmed document is found for it', async () => {
    seedDocument({ id: 'done', status: 'completed', completedAt: '2026-10-31T12:00:00.000Z', partyStatus: 'signed' })
    expect(await prepareTrainingCertificate('a1')).toEqual({ documentId: 'done', partyId: 'party-done' })
    expect(state.createRequest).not.toHaveBeenCalled()
    expect(current()).toMatchObject({ status: 'completed', confirmedAt: '2026-10-31T12:00:00.000Z', signingDocumentId: 'done' })
  })

  it('takes a declined item back to awaiting confirmation with a new document', async () => {
    seedDocument({ id: 'refused', status: 'declined', partyStatus: 'declined', declinedAt: '2026-10-31T12:00:00.000Z' })
    state.assignments.set('a1', assignment({ status: 'declined', declinedAt: '2026-10-31T12:00:00.000Z', signingDocumentId: 'refused' }))
    const prepared = await prepareTrainingCertificate('a1')
    expect(prepared.documentId).toBe('doc-1')
    expect(current()).toMatchObject({ status: 'awaiting_confirmation', declinedAt: null, signingDocumentId: 'doc-1' })
  })

  it('records the failure and leaves the item as it was, so the daily job tries again', async () => {
    state.createRequest = vi.fn(async () => {
      throw new Error('storage unavailable')
    })
    await expect(prepareTrainingCertificate('a1')).rejects.toThrow('storage unavailable')
    expect(current()).toMatchObject({ status: 'awaiting_confirmation', signingDocumentId: null, updatedAt: 't0' })
    expect(events().map((event) => [event.eventType, event.meta])).toEqual([['confirmation_failed', { stage: 'create', code: 'error' }]])
  })

  it('records a failed render the same way', async () => {
    state.prepare = vi.fn(async () => {
      throw new Error('Chromium did not start')
    })
    await expect(prepareTrainingCertificate('a1')).rejects.toThrow('Chromium did not start')
    expect(events('confirmation_failed')[0].meta).toEqual({ stage: 'render', code: 'error' })
  })

  it('refuses an item that is not waiting for its confirmation', async () => {
    state.assignments.set('a1', assignment({ status: 'completed' }))
    await expect(prepareTrainingCertificate('a1')).rejects.toMatchObject({ code: 'not_allowed' })
    state.assignments.set('a1', assignment({ status: 'in_progress' }))
    await expect(prepareTrainingCertificate('a1')).rejects.toMatchObject({ code: 'not_ready' })
    await expect(prepareTrainingCertificate('nope')).rejects.toMatchObject({ code: 'not_found' })
    expect(state.createRequest).not.toHaveBeenCalled()
  })

  it('refuses a practical course, and an item whose result is not fully stored', async () => {
    state.assignments.set('a1', assignment({ courseId: 'course-2' }))
    await expect(prepareTrainingCertificate('a1')).rejects.toMatchObject({ code: 'invalid' })
    state.assignments.set('a1', assignment({ certificateNumber: null }))
    await expect(prepareTrainingCertificate('a1')).rejects.toMatchObject({ code: 'not_ready' })
    expect(state.createRequest).not.toHaveBeenCalled()
    expect(events('confirmation_failed')).toHaveLength(2)
  })

  it('still returns the certificate when the log line cannot be written', async () => {
    state.writeEvent = vi.fn(async () => {
      throw new Error('log unavailable')
    })
    expect((await prepareTrainingCertificate('a1')).documentId).toBe('doc-1')
    expect(state.loggerError).toHaveBeenCalled()
  })
})

describe('when two preparations of the same certificate overlap', () => {
  function documentStatus(id: string): unknown {
    return (db.rows('signing_documents').find((row) => row.id === id) as Row).status
  }

  it('uses the document another preparation linked while this one was rendering, instead of withdrawing it', async () => {
    // A reload and Try again finishes first, while this call waits on a cold Chromium start.
    const render = state.prepare.getMockImplementation() as (...args: unknown[]) => unknown
    state.prepare = vi.fn(async (...args: unknown[]) => {
      seedDocument({ id: 'quicker' })
      state.assignments.set('a1', { ...current(), signingDocumentId: 'quicker', updatedAt: 'other-run' })
      return render(...args)
    })

    expect(await prepareTrainingCertificate('a1')).toEqual({ documentId: 'quicker', partyId: 'party-quicker' })
    expect(state.createRequest).not.toHaveBeenCalled()
    // The link already on the learner's screen still works.
    expect(documentStatus('quicker')).toBe('sent')
    expect(current().signingDocumentId).toBe('quicker')
    // The quicker call writes its own line; this one adds none.
    expect(events('confirmation_prepared')).toHaveLength(0)
  })

  it('uses a document another preparation made but had not linked yet, even when linking it loses a race', async () => {
    const render = state.prepare.getMockImplementation() as (...args: unknown[]) => unknown
    state.prepare = vi.fn(async (...args: unknown[]) => {
      seedDocument({ id: 'quicker' })
      // The call that made it links it a moment after this one reads the item again: this
      // call's own link loses, and it must read again rather than go on to make a competing one.
      const realGet = state.assignments.get.bind(state.assignments)
      let armed = true
      state.assignments.get = ((id: string) => {
        if (armed && id === 'a1') {
          armed = false
          queueMicrotask(() => {
            state.assignments.set('a1', { ...current(), signingDocumentId: 'quicker', updatedAt: 'other-run' })
          })
        }
        return realGet(id)
      }) as typeof state.assignments.get
      return render(...args)
    })

    expect(await prepareTrainingCertificate('a1')).toEqual({ documentId: 'quicker', partyId: 'party-quicker' })
    expect(state.createRequest).not.toHaveBeenCalled()
    expect(documentStatus('quicker')).toBe('sent')
    expect(current()).toMatchObject({ signingDocumentId: 'quicker', updatedAt: 'other-run' })
  })

  it('hands back the newer document when an overlapping preparation withdraws ours just after we linked it', async () => {
    const realSet = state.assignments.set.bind(state.assignments)
    let overtaken = false
    state.assignments.set = ((id: string, value: unknown) => {
      realSet(id, value)
      if (!overtaken && (value as TrainingAssignment).signingDocumentId === 'doc-1') {
        overtaken = true
        // The slower call makes its document now; the series rule withdraws ours.
        ;(db.rows('signing_documents').find((row) => row.id === 'doc-1') as Row).status = 'voided'
        seedDocument({ id: 'slower' })
      }
      return state.assignments
    }) as typeof state.assignments.set

    expect(await prepareTrainingCertificate('a1')).toEqual({ documentId: 'slower', partyId: 'party-slower' })
    expect(current()).toMatchObject({ status: 'awaiting_confirmation', signingDocumentId: 'slower' })
    // No line for a document that was withdrawn before anyone could use it.
    expect(events('confirmation_prepared')).toHaveLength(0)
    expect(events('confirmation_failed')).toHaveLength(0)
  })

  it('keeps its own document when it lost the link to one its own document replaced', async () => {
    // The other call made and linked its document first; making ours withdrew it.
    const make = state.createRequest.getMockImplementation() as (input: Row) => Promise<unknown>
    state.createRequest = vi.fn(async (input: Row) => {
      seedDocument({ id: 'earlier' })
      state.assignments.set('a1', { ...current(), signingDocumentId: 'earlier', updatedAt: 'other-run' })
      return make(input)
    })

    expect(await prepareTrainingCertificate('a1')).toEqual({ documentId: 'doc-1', partyId: 'party-doc-1' })
    expect(documentStatus('earlier')).toBe('voided')
    expect(current().signingDocumentId).toBe('doc-1')
    expect(events('confirmation_prepared')).toHaveLength(1)
    expect(events('confirmation_prepared')[0].meta).toMatchObject({ documentId: 'doc-1' })
  })

  it('makes no document when the item was closed while it rendered', async () => {
    const render = state.prepare.getMockImplementation() as (...args: unknown[]) => unknown
    state.prepare = vi.fn(async (...args: unknown[]) => {
      state.assignments.set('a1', { ...current(), status: 'waived', updatedAt: 'waived-meanwhile' })
      return render(...args)
    })
    await expect(prepareTrainingCertificate('a1')).rejects.toMatchObject({ code: 'conflict' })
    expect(state.createRequest).not.toHaveBeenCalled()
    expect(events('confirmation_failed')[0].meta).toEqual({ stage: 'recheck', code: 'conflict' })
  })
})

describe('when the learner confirms', () => {
  it('marks the item completed once, with the time they confirmed', async () => {
    const { documentId } = await prepareTrainingCertificate('a1')
    Object.assign(db.rows('signing_documents').find((row) => row.id === documentId) as Row, {
      status: 'completed',
      completed_at: '2026-11-02T09:59:00.000Z',
    })

    await onTrainingSigningCompleted(documentId)
    await onTrainingSigningCompleted(documentId)

    expect(current()).toMatchObject({ status: 'completed', confirmedAt: '2026-11-02T09:59:00.000Z', completedOn: '2026-10-30' })
    expect(events('completed')).toHaveLength(1)
    expect(events('completed')[0]).toMatchObject({ assignmentId: 'a1', meta: { documentId, kind: 'training_completion' } })
  })

  it('does nothing for a document that is not confirmed, or that no item stands behind', async () => {
    const { documentId } = await prepareTrainingCertificate('a1')
    await onTrainingSigningCompleted(documentId)
    expect(current().status).toBe('awaiting_confirmation')

    // The item named in its context now points at a newer document.
    seedDocument({ id: 'stale', status: 'completed', completedAt: '2026-11-01T09:00:00.000Z', partyStatus: 'signed' })
    await onTrainingSigningCompleted('stale')
    await onTrainingSigningCompleted('missing')
    expect(current().status).toBe('awaiting_confirmation')
    expect(events('completed')).toHaveLength(0)
  })

  it('completes the item a document names when the item lost its link to it', async () => {
    seedDocument({ id: 'orphan', status: 'completed', completedAt: '2026-11-01T09:00:00.000Z', partyStatus: 'signed' })
    await onTrainingSigningCompleted('orphan')
    expect(current()).toMatchObject({ status: 'completed', signingDocumentId: 'orphan', confirmedAt: '2026-11-01T09:00:00.000Z' })
  })

  it('leaves a waived item alone, and says so', async () => {
    seedDocument({ id: 'late', status: 'completed', completedAt: '2026-11-01T09:00:00.000Z', partyStatus: 'signed' })
    state.assignments.set('a1', assignment({ status: 'waived', signingDocumentId: 'late' }))
    await onTrainingSigningCompleted('late')
    expect(current().status).toBe('waived')
    expect(state.loggerError).toHaveBeenCalled()
  })

  it('completes the item even when the log line cannot be written, and raises it', async () => {
    seedDocument({ id: 'done', status: 'completed', completedAt: '2026-11-01T09:00:00.000Z', partyStatus: 'signed' })
    state.assignments.set('a1', assignment({ signingDocumentId: 'done' }))
    state.writeEvent = vi.fn(async () => {
      throw new Error('log unavailable')
    })
    await expect(onTrainingSigningCompleted('done')).resolves.toBeUndefined()
    expect(current().status).toBe('completed')
    expect(state.loggerError).toHaveBeenCalled()
  })

  it('treats a confirmation another run recorded first as done', async () => {
    seedDocument({ id: 'done', status: 'completed', completedAt: '2026-11-01T09:00:00.000Z', partyStatus: 'signed' })
    state.assignments.set('a1', assignment({ signingDocumentId: 'done' }))
    // The item is read, then another run completes it before this write lands.
    const realGet = state.courses.get.bind(state.courses)
    state.courses.get = ((id: string) => {
      state.assignments.set('a1', { ...current(), status: 'completed', updatedAt: 'other-run' })
      return realGet(id)
    }) as typeof state.courses.get
    await expect(onTrainingSigningCompleted('done')).resolves.toBeUndefined()
    expect(current()).toMatchObject({ status: 'completed', updatedAt: 'other-run' })
    expect(events('completed')).toHaveLength(0)
  })
})

describe('when the learner declines', () => {
  it('marks the item declined once, with the time they declined', async () => {
    const { documentId } = await prepareTrainingCertificate('a1')
    ;(db.rows('signing_documents').find((row) => row.id === documentId) as Row).status = 'declined'
    Object.assign(db.rows('signing_parties').find((row) => row.document_id === documentId) as Row, {
      status: 'declined',
      declined_at: '2026-11-02T09:58:00.000Z',
    })

    await onTrainingSigningDeclined(documentId)
    await onTrainingSigningDeclined(documentId)

    expect(current()).toMatchObject({ status: 'declined', declinedAt: '2026-11-02T09:58:00.000Z' })
    expect(events('declined')).toHaveLength(1)
  })

  it('does nothing while the document is still open, or for an item already closed', async () => {
    const { documentId } = await prepareTrainingCertificate('a1')
    await onTrainingSigningDeclined(documentId)
    expect(current().status).toBe('awaiting_confirmation')

    ;(db.rows('signing_documents').find((row) => row.id === documentId) as Row).status = 'declined'
    state.assignments.set('a1', { ...current(), status: 'cancelled' })
    await onTrainingSigningDeclined(documentId)
    expect(current().status).toBe('cancelled')
    expect(events('declined')).toHaveLength(0)
  })
})

describe('recording a practical sign-off', () => {
  beforeEach(() => {
    state.assignments.set('a2', practicalAssignment())
  })

  it('has the manager sign for the business, puts the item waiting for the learner, and opens the in-person handover', async () => {
    const result = await createPracticalSignoff({
      assignmentId: 'a2',
      tasks: ['clean-lines', 'change-keg'],
      observedOn: '2026-10-25',
      actor: MANAGER,
    })

    expect(result).toEqual({
      documentId: 'doc-1',
      partyId: 'party-doc-1',
      inPersonUrl: 'https://management.example.test/sign/token-for-party-doc-1',
      // 17 on the day, on a course that limits under 18s to supervised work.
      supervisedOnly: true,
    })
    const request = state.createRequest.mock.calls[0][0] as Row
    expect(request).toMatchObject({
      kind: 'training_signoff',
      subjectId: 'emp-1',
      title: 'Cellar and lines sign-off',
      createdBy: MANAGER.id,
      createdByName: MANAGER.name,
      seriesKey: 'training-signoff:cellar',
      sendLinkEmails: false,
      parties: [{ role: 'worker', name: 'Sam Example', email: 'sam@example.com', employeeId: 'emp-1', identityCheck: 'none' }],
      context: { training: { assignment_id: 'a2', manager_name: 'Billy Manager', observed_on: '2026-10-25', version_label: '1.2' } },
    })
    expect((state.prepare.mock.calls[0][0] as { sender: unknown; mode: string }).sender).toEqual({ name: 'Billy Manager' })

    const item = current('a2')
    expect(item).toMatchObject({
      status: 'awaiting_confirmation',
      signingDocumentId: 'doc-1',
      versionId: 'v2',
      // In the course's own order, with their wording at the time.
      signoffTasks: [
        { key: 'change-keg', text: 'Change a keg safely' },
        { key: 'clean-lines', text: 'Clean the beer lines' },
      ],
      signedOffBy: MANAGER.id,
      signedOffByName: MANAGER.name,
      signedOffOn: '2026-10-25',
      // 17 on the day, on a course that limits under 18s to supervised work.
      supervisedOnly: true,
      expiresOn: '2028-10-25',
      windowOpensOn: '2028-09-25',
    })
    expect(item.certificateNumber).toMatch(CERTIFICATE_NUMBER_PATTERN)
    expect(state.inPerson).toHaveBeenCalledWith({ partyId: 'party-doc-1', userId: MANAGER.id })
    // recordPracticalSignoff writes the one sign-off line, with the manager's note: nothing here.
    expect(events()).toEqual([])

    const html = (state.prepare.mock.calls[0][0] as { source: { html: string } }).source.html
    expect(html).toContain('Supervised only')
    expect(html).not.toContain('Change a gas bottle')
  })

  it('completes the item on the date the manager watched, once the learner signs', async () => {
    const { documentId } = await createPracticalSignoff({ assignmentId: 'a2', tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    Object.assign(db.rows('signing_documents').find((row) => row.id === documentId) as Row, {
      status: 'completed',
      completed_at: '2026-11-02T09:59:00.000Z',
    })
    await onTrainingSigningCompleted(documentId)
    expect(current('a2')).toMatchObject({ status: 'completed', completedOn: '2026-10-25', confirmedAt: '2026-11-02T09:59:00.000Z' })
  })

  it('is not supervised only for an adult', async () => {
    db.rows('employees')[0].date_of_birth = '1990-01-01'
    const result = await createPracticalSignoff({ assignmentId: 'a2', tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    expect(current('a2').supervisedOnly).toBe(false)
    expect(result.supervisedOnly).toBe(false)
  })

  it('refuses when it cannot tell whether they must be supervised', async () => {
    db.rows('employees')[0].date_of_birth = null
    await expect(
      createPracticalSignoff({ assignmentId: 'a2', tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    ).rejects.toMatchObject({ code: 'not_ready', message: expect.stringContaining('date of birth') })
    expect(state.createRequest).not.toHaveBeenCalled()
  })

  it('refuses a bad list of tasks or a bad date before anything is made', async () => {
    const attempt = (tasks: string[], observedOn = '2026-10-25') =>
      createPracticalSignoff({ assignmentId: 'a2', tasks, observedOn, actor: MANAGER })
    await expect(attempt([])).rejects.toMatchObject({ code: 'invalid' })
    await expect(attempt(['gas', 'gas'])).rejects.toMatchObject({ code: 'invalid' })
    await expect(attempt(['not-a-task'])).rejects.toMatchObject({ code: 'invalid' })
    await expect(attempt(['gas'], '2026-11-03')).rejects.toMatchObject({ code: 'invalid' })
    await expect(attempt(['gas'], '2026-02-30')).rejects.toMatchObject({ code: 'invalid' })
    expect(state.createRequest).not.toHaveBeenCalled()
  })

  it('refuses an online course, a closed item and one still waiting for its prerequisite', async () => {
    const attempt = (assignmentId: string) =>
      createPracticalSignoff({ assignmentId, tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    await expect(attempt('a1')).rejects.toMatchObject({ code: 'invalid' })
    state.assignments.set('a2', practicalAssignment({ status: 'completed' }))
    await expect(attempt('a2')).rejects.toMatchObject({ code: 'not_allowed' })
    state.assignments.set('a2', practicalAssignment({ status: 'waiting' }))
    await expect(attempt('a2')).rejects.toMatchObject({ code: 'not_ready' })
    expect(state.createRequest).not.toHaveBeenCalled()
  })

  it('withdraws the new document when the item cannot be updated, so no signature is collected for nothing', async () => {
    state.assignments.set('a2', practicalAssignment({ updatedAt: 'read-earlier' }))
    const realSet = state.assignments.set.bind(state.assignments)
    // Someone else changes the item between the read and the write.
    state.createRequest.mockImplementationOnce(async (input: Row) => {
      realSet('a2', { ...current('a2'), updatedAt: 'changed-meanwhile' })
      return { documentId: 'doc-x', version: 1, deliveries: [{ partyId: 'party-doc-x' }], input }
    })
    await expect(
      createPracticalSignoff({ assignmentId: 'a2', tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    ).rejects.toBeInstanceOf(TrainingError)
    // The handover link was made first, but withdrawing the document makes it worthless, and it
    // never reaches the manager.
    expect(state.voidDocument).toHaveBeenCalledWith({ documentId: 'doc-x', userId: MANAGER.id, reason: 'The sign-off could not be recorded' })
    expect(events('signoff_recorded')).toHaveLength(0)
  })

  it('records nothing when the in-person handover cannot be opened, so the manager can simply try again', async () => {
    state.inPerson = vi.fn(async () => {
      expect(current('a2')).toMatchObject({ status: 'assigned', signingDocumentId: null })
      throw new Error('Could not start in-person signing: connection reset')
    })
    await expect(
      createPracticalSignoff({ assignmentId: 'a2', tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    ).rejects.toThrow('Could not start in-person signing')
    expect(state.voidDocument).toHaveBeenCalledWith({ documentId: 'doc-1', userId: MANAGER.id, reason: 'The sign-off could not be recorded' })
    // The item is exactly as it was: not waiting for a confirmation nobody can give.
    expect(current('a2')).toMatchObject({ status: 'assigned', signingDocumentId: null, signedOffOn: null, updatedAt: 't0' })
    expect(events()).toEqual([])

    // Trying again works.
    state.inPerson = vi.fn(async (input: { partyId: string }) => ({ url: `https://management.example.test/sign/token-for-${input.partyId}` }))
    const retried = await createPracticalSignoff({ assignmentId: 'a2', tasks: ['gas'], observedOn: '2026-10-25', actor: MANAGER })
    expect(retried.documentId).toBe('doc-2')
    expect(current('a2')).toMatchObject({ status: 'awaiting_confirmation', signingDocumentId: 'doc-2' })
  })
})
