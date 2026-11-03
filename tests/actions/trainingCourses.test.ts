// @vitest-environment node
import JSZip from 'jszip'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The service is replaced by a small in-memory store so the upload and publish rules can be
// played end to end; storage is the real module over a mocked bucket.
const mocks = vi.hoisted(() => {
  const upload = vi.fn()
  const download = vi.fn()
  const service = {
    getCourseBySlug: vi.fn(),
    getCourseById: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    listCourses: vi.fn(),
    listCourseItems: vi.fn(),
    getCourseDetail: vi.fn(),
    getDraftVersion: vi.fn(),
    saveDraftVersion: vi.fn(),
    listVersions: vi.fn(),
    publishDraftVersion: vi.fn(),
    hasCoursePublishedEvent: vi.fn(),
    getVersion: vi.fn(),
    getPlayerCourse: vi.fn(),
    writeEvent: vi.fn(),
    syncAssignments: vi.fn(),
    createAttempt: vi.fn(),
    submitAttempt: vi.fn(),
    createAssignment: vi.fn(),
    updateAssignment: vi.fn(),
  }
  return { upload, download, storageFrom: vi.fn(() => ({ upload, download })), service }
})

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn() }))
vi.mock('@/lib/signing/staff', () => ({ getSigningStaffUser: vi.fn() }))
vi.mock('@/app/actions/training-settings', () => ({ getTrainingEmailsSwitch: vi.fn(), setTrainingEmailsSwitch: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn(() => ({ storage: { from: mocks.storageFrom } })) }))
vi.mock('@/lib/training/draw', () => ({ drawQuestions: vi.fn(), toCheckQuestionViews: vi.fn() }))
vi.mock('@/lib/training/scoring', () => ({ scoreAttempt: vi.fn(), toCheckResultItems: vi.fn() }))
vi.mock('@/services/training', () => ({ TrainingService: mocks.service }))

import { revalidatePath } from 'next/cache'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import {
  createExternalCourse,
  getCourseVersionJson,
  listTrainingCourses,
  previewDraw,
  previewScore,
  publishCourseDraft,
  retireTrainingCourse,
  uploadCourseDraft,
} from '@/app/actions/training-courses'
import { getSigningStaffUser } from '@/lib/signing/staff'
import { drawQuestions, toCheckQuestionViews } from '@/lib/training/draw'
import { scoreAttempt, toCheckResultItems } from '@/lib/training/scoring'
import { sha256Hex } from '@/lib/training/storage'
import {
  TrainingError,
  type CourseContent,
  type TrainingCourse,
  type TrainingCourseVersion,
} from '@/lib/training/types'

const LONG_DASH = String.fromCharCode(0x2014)
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'manager@example.com', name: 'Mia Manager', position: 'Manager' }

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 7, 7, 7, 7])

type Json = Record<string, unknown>

function question(id: string, objective: string, critical = false): Json {
  return {
    id,
    objective,
    critical,
    prompt: `A customer asks about ${id}. What do you do?`,
    options: ['Tell them to wait', 'Help them straight away', 'Ignore it'],
    answer: 1,
    explanation: 'Help them straight away. It is quicker and safer.',
  }
}

function section(key: string, extraCards: Json[] = []): Json {
  return {
    key,
    title: `Section ${key}`,
    objectives: [
      { key: 'first-aim', text: 'Do the first thing well' },
      { key: 'second-aim', text: 'Do the second thing well' },
    ],
    cards: [{ type: 'paragraph', text: 'One idea on this card.' }, { type: 'bullets', items: ['One', 'Two'] }, ...extraCards],
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

function course(overrides: Json = {}): Json {
  return {
    schemaVersion: 1,
    slug: 'essentials',
    title: 'Essentials',
    summary: 'The things everyone needs on their first shift.',
    kind: 'online',
    audience: { groups: [], age: 'all' },
    essentials: true,
    deadline: { newStarterDays: 0, existingStaffDays: 14 },
    refresherMonths: 12,
    windowDays: 30,
    prerequisite: null,
    legalBasis: 'MHSWR 1999 reg 13.',
    estimatedMinutes: 25,
    sections: [section('fire', [{ type: 'image', src: 'images/cover.png', alt: 'The fire exit by the bar' }]), section('allergens')],
    ...overrides,
  }
}

function file(bytes: Uint8Array | string, name: string, type = ''): File {
  return new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name, { type })
}

function looseUpload(json: Json | string, images: Array<[string, Uint8Array]> = [['cover.png', PNG]], courseId?: string): FormData {
  const form = new FormData()
  form.append('files', file(typeof json === 'string' ? json : JSON.stringify(json), 'course.json', 'application/json'))
  for (const [name, bytes] of images) form.append('files', file(bytes, name, 'image/png'))
  if (courseId) form.append('courseId', courseId)
  return form
}

async function zipUpload(entries: Record<string, Uint8Array | string>): Promise<FormData> {
  const zip = new JSZip()
  for (const [name, data] of Object.entries(entries)) zip.file(name, data)
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
  const form = new FormData()
  form.append('files', file(bytes, 'essentials.zip', 'application/zip'))
  return form
}

// ---------------------------------------------------------------------------------------------
// The in-memory service
// ---------------------------------------------------------------------------------------------

let courses: Map<string, TrainingCourse>
let versions: Map<string, TrainingCourseVersion>
let events: Json[]
let clock: number

function now(): string {
  clock += 1000
  return new Date(Date.UTC(2026, 10, 3, 9, 0, 0) + clock).toISOString()
}

function meta(version: TrainingCourseVersion) {
  const { content: _content, ...rest } = version
  return rest
}

function installService(): void {
  const s = mocks.service
  s.getCourseBySlug.mockImplementation(async (slug: string) => [...courses.values()].find((c) => c.slug === slug) ?? null)
  s.getCourseById.mockImplementation(async (id: string) => courses.get(id) ?? null)
  s.listCourses.mockImplementation(async () => [...courses.values()].filter((c) => c.status !== 'retired'))
  s.createCourse.mockImplementation(async (input: Json & { actor: { id: string | null; name: string } }) => {
    if ([...courses.values()].some((c) => c.slug === input.slug)) throw new TrainingError('conflict', 'taken')
    const { actor, ...fields } = input
    const row = {
      id: crypto.randomUUID(),
      displayOrder: 100,
      status: 'draft',
      currentVersionId: null,
      createdBy: actor.id,
      createdByName: actor.name,
      createdAt: now(),
      updatedAt: now(),
      ...fields,
    } as unknown as TrainingCourse
    courses.set(row.id, row)
    return row
  })
  s.updateCourse.mockImplementation(async (id: string, patch: Partial<TrainingCourse>) => {
    const row = courses.get(id)
    if (!row) throw new TrainingError('not_found', 'no course')
    const next = { ...row, ...patch, updatedAt: now() }
    courses.set(id, next)
    return next
  })
  s.getDraftVersion.mockImplementation(async (courseId: string) => [...versions.values()].find((v) => v.courseId === courseId && v.state === 'draft') ?? null)
  s.saveDraftVersion.mockImplementation(async (input: { courseId: string; content: CourseContent; contentSha256: string; images: TrainingCourseVersion['images']; actor: { id: string | null; name: string } }) => {
    for (const [id, v] of versions) if (v.courseId === input.courseId && v.state === 'draft') versions.delete(id)
    const version: TrainingCourseVersion = {
      id: crypto.randomUUID(),
      courseId: input.courseId,
      state: 'draft',
      major: null,
      minor: null,
      content: input.content,
      contentSha256: input.contentSha256,
      images: input.images,
      changeNote: null,
      redoRequired: false,
      uploadedBy: input.actor.id,
      uploadedByName: input.actor.name,
      uploadedAt: now(),
      publishedBy: null,
      publishedByName: null,
      publishedAt: null,
    }
    versions.set(version.id, version)
    return version
  })
  s.listVersions.mockImplementation(async (courseId: string) => [...versions.values()].filter((v) => v.courseId === courseId).map(meta))
  s.publishDraftVersion.mockImplementation(async (input: { courseId: string; draftVersionId: string; major: number; minor: number; changeNote: string | null; redoRequired: boolean; expectedUploadedAt: string; actor: { id: string | null; name: string } }) => {
    const draft = versions.get(input.draftVersionId)
    // As the real write: only the draft as it was read (state and uploaded_at) is frozen.
    if (!draft || draft.state !== 'draft' || draft.uploadedAt !== input.expectedUploadedAt) {
      throw new TrainingError('conflict', 'The draft was replaced or published while you were looking at it. Refresh and try again.')
    }
    if ([...versions.values()].some((v) => v.courseId === input.courseId && v.major === input.major && v.minor === input.minor)) {
      throw new TrainingError('conflict', 'number taken')
    }
    const published: TrainingCourseVersion = {
      ...draft,
      state: 'published',
      major: input.major,
      minor: input.minor,
      changeNote: input.changeNote,
      redoRequired: input.redoRequired,
      publishedBy: input.actor.id,
      publishedByName: input.actor.name,
      publishedAt: now(),
    }
    versions.set(published.id, published)
    // As the real service: the course row is the publish action's job, not this one's.
    return published
  })
  s.hasCoursePublishedEvent.mockImplementation(
    async (courseId: string, versionId: string) =>
      events.some((event) => event.eventType === 'course_published' && event.courseId === courseId && (event.meta as Json)?.versionId === versionId)
  )
  s.getVersion.mockImplementation(async (id: string) => versions.get(id) ?? null)
  s.writeEvent.mockImplementation(async (event: Json) => {
    const saved = { id: crypto.randomUUID(), ...event }
    events.push(saved)
    return saved
  })
  s.syncAssignments.mockResolvedValue({ created: 3, cancelled: 1, updated: 0 })
}

function onlyCourse(): TrainingCourse {
  expect(courses.size).toBe(1)
  return [...courses.values()][0]
}

async function uploadAndPublishFirst(json: Json = course()): Promise<TrainingCourse> {
  const uploaded = await uploadCourseDraft(looseUpload(json))
  expect(uploaded.data?.saved).toBe(true)
  const published = await publishCourseDraft({ courseId: uploaded.data!.courseId!, change: 'first', changeNote: '' })
  expect(published.error).toBeUndefined()
  return courses.get(uploaded.data!.courseId!)!
}

beforeEach(() => {
  vi.clearAllMocks()
  courses = new Map()
  versions = new Map()
  events = []
  clock = 0
  installService()
  vi.mocked(getSigningStaffUser).mockResolvedValue(USER)
  vi.mocked(checkUserPermission).mockResolvedValue(true)
  mocks.upload.mockResolvedValue({ data: { path: 'stored' }, error: null })
})

// ---------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------

describe('uploadCourseDraft', () => {
  it('saves a valid course and its image as a new draft course', async () => {
    const result = await uploadCourseDraft(looseUpload(course()))

    expect(result.success).toBe(true)
    expect(result.data).toMatchObject({ slug: 'essentials', saved: true, errors: [], gaps: [] })
    const row = onlyCourse()
    expect(row).toMatchObject({ slug: 'essentials', title: 'Essentials', kind: 'online', status: 'draft', isEssentials: true, existingStaffDueDays: 14 })
    expect(result.data?.courseId).toBe(row.id)

    const sha = sha256Hex(PNG)
    expect(mocks.storageFrom).toHaveBeenCalledWith('training')
    expect(mocks.upload).toHaveBeenCalledWith(`courses/${row.id}/${sha}.png`, PNG, { contentType: 'image/png', upsert: false })

    const draft = [...versions.values()][0]
    expect(draft.state).toBe('draft')
    expect(draft.images).toEqual([{ src: 'images/cover.png', path: `courses/${row.id}/${sha}.png`, sha256: sha, contentType: 'image/png', bytes: PNG.byteLength }])
    // The fingerprint is of the validated content as stored, so it can be checked again later.
    expect(draft.contentSha256).toBe(sha256Hex(new TextEncoder().encode(JSON.stringify(draft.content))))
    expect(result.data?.versionId).toBe(draft.id)

    expect(mocks.service.writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'course_draft_uploaded', courseId: row.id }))
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ operation_type: 'upload', resource_type: 'training_course', resource_id: row.id, user_id: USER.id })
    )
    expect(revalidatePath).toHaveBeenCalledWith('/employees/training')
  })

  it('saves nothing when the file has errors, and says what they are', async () => {
    const broken = course({ title: `Essentials ${LONG_DASH} the basics`, sections: [{ ...section('fire'), questions: [question('fire-01', 'first-aim')] }] })
    const result = await uploadCourseDraft(looseUpload(broken, []))

    expect(result.success).toBe(false)
    expect(result.data?.saved).toBe(false)
    expect(result.data?.slug).toBe('essentials')
    expect(result.data?.errors.join('\n')).toMatch(/long dash/)
    expect(result.data?.errors.join('\n')).toMatch(/needs at least 4 questions/)
    expect(mocks.service.createCourse).not.toHaveBeenCalled()
    expect(mocks.service.saveDraftVersion).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
    expect(mocks.service.writeEvent).not.toHaveBeenCalled()
  })

  it('refuses a course whose image card has no file in the upload', async () => {
    const result = await uploadCourseDraft(looseUpload(course(), []))
    expect(result.data?.saved).toBe(false)
    expect(result.data?.errors).toContain('Image "images/cover.png" is used by a card but is not in the upload')
    expect(courses.size).toBe(0)
  })

  it('refuses an SVG passed off as a png, and an image over 4 MB, before anything is saved', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const svgResult = await uploadCourseDraft(looseUpload(course(), [['cover.png', svg]]))
    expect(svgResult.data?.errors.join('\n')).toMatch(/not a png, jpg, webp or gif picture \(SVG is not allowed\)/)

    const big = new Uint8Array(4 * 1024 * 1024 + 1)
    big.set(PNG)
    const bigResult = await uploadCourseDraft(looseUpload(course(), [['cover.png', big]]))
    // Loose, a picture that big is over the whole upload's limit (the per-picture limit is met in a zip).
    expect(bigResult.data?.errors.join('\n')).toMatch(/the most one upload can be is 4\.0 MB/)

    expect(courses.size).toBe(0)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('refuses an upload over 4 MB in all, the most the platform takes in one request', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    chunk.set(PNG)
    const images: Array<[string, Uint8Array]> = [1, 2, 3, 4, 5].map((n) => [`photo-${n}.png`, chunk])
    const result = await uploadCourseDraft(looseUpload(course(), images))
    expect(result.data?.errors.join('\n')).toMatch(/the most one upload can be is 4\.0 MB/)
    expect(courses.size).toBe(0)
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('lists [[TO CONFIRM]] gaps on a draft and still saves it', async () => {
    const withGap = course({ summary: 'Call [[TO CONFIRM: the duty manager phone number]] if unsure.' })
    const result = await uploadCourseDraft(looseUpload(withGap))
    expect(result.data?.saved).toBe(true)
    expect(result.data?.gaps).toEqual(['Summary: [[TO CONFIRM: the duty manager phone number]]'])
  })

  it('reads a zip of the course folder, ignoring clutter and files it does not use', async () => {
    const form = await zipUpload({
      'essentials/course.json': JSON.stringify(course()),
      'essentials/images/cover.png': PNG,
      'essentials/images/spare.png': PNG,
      'essentials/notes.txt': 'not part of the course',
      '__MACOSX/essentials/._course.json': 'junk',
      'essentials/.DS_Store': 'junk',
    })
    const result = await uploadCourseDraft(form)

    expect(result.data?.errors).toEqual([])
    expect(result.data?.saved).toBe(true)
    expect(result.data?.warnings).toEqual(
      expect.arrayContaining([
        '"essentials/notes.txt" was ignored: only course.json and jpg, png, webp or gif images are used',
        '"images/spare.png" is not used by any card, so it was not saved',
      ])
    )
    expect(mocks.upload).toHaveBeenCalledTimes(1)
    expect([...versions.values()][0].images.map((image) => image.src)).toEqual(['images/cover.png'])
  })

  it('refuses a zip entry that unzips past the image limit without saving anything', async () => {
    const big = new Uint8Array(6 * 1024 * 1024)
    big.set(PNG)
    const form = await zipUpload({ 'course.json': JSON.stringify(course()), 'images/cover.png': big })
    const result = await uploadCourseDraft(form)
    expect(result.data?.saved).toBe(false)
    expect(result.data?.errors.join('\n')).toMatch(/Image "images\/cover.png" is 6\.0 MB; the most it can be is 4\.0 MB/)
    expect(courses.size).toBe(0)
  })

  it('refuses a zip with no course.json, or a zip sent with other files', async () => {
    const noJson = await uploadCourseDraft(await zipUpload({ 'images/cover.png': PNG }))
    expect(noJson.data?.errors).toEqual(['The upload has no course.json'])

    const mixed = await zipUpload({ 'course.json': JSON.stringify(course()) })
    mixed.append('files', file(PNG, 'cover.png', 'image/png'))
    const mixedResult = await uploadCourseDraft(mixed)
    expect(mixedResult.data?.errors).toEqual(['Upload one zip on its own, or course.json with its images, but not both'])
  })

  it('replaces the draft on a second upload without making a second course', async () => {
    await uploadCourseDraft(looseUpload(course()))
    const second = await uploadCourseDraft(looseUpload(course({ title: 'Essentials for everyone' })))
    expect(second.data?.saved).toBe(true)
    expect(mocks.service.createCourse).toHaveBeenCalledTimes(1)
    expect([...versions.values()].filter((v) => v.state === 'draft')).toHaveLength(1)
    // Never published, so the course list follows the latest draft.
    expect(onlyCourse().title).toBe('Essentials for everyone')
  })

  it('refuses a file for another course when uploading from a course page', async () => {
    const first = await uploadCourseDraft(looseUpload(course()))
    const other = await uploadCourseDraft(looseUpload(course({ slug: 'team-training', title: 'Team training' }), undefined, first.data!.courseId!))
    expect(other.data?.saved).toBe(false)
    expect(other.data?.errors.join('\n')).toMatch(/This file is for the course "team-training"/)
    expect(courses.size).toBe(1)
  })

  it('refuses two files with the same name, and an image matched to two cards by name alone', async () => {
    const twice = await uploadCourseDraft(looseUpload(course(), [['cover.png', PNG], ['cover.png', PNG]]))
    expect(twice.data?.errors).toEqual(['Two files in the upload are called "cover.png". Keep one'])

    const shared = course({
      sections: [
        section('fire', [{ type: 'image', src: 'images/a/cover.png', alt: 'One' }]),
        section('allergens', [{ type: 'image', src: 'images/b/cover.png', alt: 'Two' }]),
      ],
    })
    const ambiguous = await uploadCourseDraft(looseUpload(shared))
    expect(ambiguous.data?.errors.join('\n')).toMatch(/would all use the one file "cover.png"\. Upload the course folder as a zip/)
    expect(courses.size).toBe(0)
  })

  it('warns, but saves, when the course it needs first is not published yet', async () => {
    const result = await uploadCourseDraft(looseUpload(course({ slug: 'walkthrough', title: 'Walkthrough', essentials: false, prerequisite: 'essentials' })))
    expect(result.data?.saved).toBe(true)
    expect(result.data?.warnings.join('\n')).toMatch(/\("essentials"\) does not exist yet/)
  })
})

// ---------------------------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------------------------

describe('publishCourseDraft', () => {
  it('refuses to publish while a [[TO CONFIRM]] gap remains', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course({ summary: 'Ring [[TO CONFIRM: number]] first.' })))
    const result = await publishCourseDraft({ courseId: uploaded.data!.courseId!, change: 'first', changeNote: '' })
    expect(result.error).toMatch(/cannot be published yet/)
    expect(result.error).toMatch(/fill in \[\[TO CONFIRM: number\]\] before publishing/)
    expect(mocks.service.publishDraftVersion).not.toHaveBeenCalled()
    expect(onlyCourse().status).toBe('draft')
  })

  it('numbers versions 1.0, then 1.1 for a small change, then 2.0 with a redo', async () => {
    const live = await uploadAndPublishFirst()
    expect(live.status).toBe('live')
    const first = versions.get(live.currentVersionId!)!
    expect(first).toMatchObject({ state: 'published', major: 1, minor: 0, redoRequired: false })
    expect(mocks.service.syncAssignments).toHaveBeenCalledTimes(1)

    await uploadCourseDraft(looseUpload(course({ summary: 'A clearer summary for everyone.' })))
    const minor = await publishCourseDraft({ courseId: live.id, change: 'minor', changeNote: 'Clearer summary' })
    expect(minor.data).toMatchObject({ major: 1, minor: 1 })
    expect(courses.get(live.id)).toMatchObject({ summary: 'A clearer summary for everyone.', currentVersionId: minor.data!.versionId })

    await uploadCourseDraft(looseUpload(course()))
    const redo = await publishCourseDraft({ courseId: live.id, change: 'redo', changeNote: 'New fire assembly point' })
    expect(redo.data).toMatchObject({ major: 2, minor: 0, sync: { created: 3, cancelled: 1, updated: 0 } })
    expect(versions.get(redo.data!.versionId)).toMatchObject({ redoRequired: true, changeNote: 'New fire assembly point' })
    expect(mocks.service.writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'redo_requested', courseId: live.id }))
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'publish', resource_id: live.id }))
  })

  it('copies the course details from the file onto the course row at publish', async () => {
    const live = await uploadAndPublishFirst()
    await uploadCourseDraft(looseUpload(course({ title: 'Essentials 2026', deadline: { newStarterDays: 3, existingStaffDays: 21 }, refresherMonths: 24, windowDays: 45 })))
    // The live row keeps its details until the new version is published.
    expect(courses.get(live.id)?.title).toBe('Essentials')
    await publishCourseDraft({ courseId: live.id, change: 'minor', changeNote: 'New deadlines' })
    expect(courses.get(live.id)).toMatchObject({ title: 'Essentials 2026', newStarterDueDays: 3, existingStaffDueDays: 21, refresherMonths: 24, windowDays: 45 })
  })

  it('refuses the wrong kind of publish', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const courseId = uploaded.data!.courseId!
    expect((await publishCourseDraft({ courseId, change: 'minor', changeNote: 'x' })).error).toMatch(/has not been published yet/)

    await publishCourseDraft({ courseId, change: 'first', changeNote: '' })
    await uploadCourseDraft(looseUpload(course()))
    expect((await publishCourseDraft({ courseId, change: 'first', changeNote: '' })).error).toMatch(/already published \(version 1\.0\)/)
    expect((await publishCourseDraft({ courseId, change: 'minor', changeNote: '  ' })).error).toMatch(/Say what changed/)
  })

  it('refuses a draft whose slug no longer matches the course', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const draft = [...versions.values()][0]
    versions.set(draft.id, { ...draft, content: { ...draft.content, slug: 'essentials-two' } })

    const result = await publishCourseDraft({ courseId: uploaded.data!.courseId!, change: 'first', changeNote: '' })
    expect(result.error).toMatch(/The draft is for "essentials-two" but this course is "essentials"\. A course's slug never changes/)
    expect(mocks.service.publishDraftVersion).not.toHaveBeenCalled()
  })

  it('refuses to publish before the course it needs first is live', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course({ slug: 'walkthrough', title: 'Walkthrough', essentials: false, prerequisite: 'essentials' })))
    const result = await publishCourseDraft({ courseId: uploaded.data!.courseId!, change: 'first', changeNote: '' })
    expect(result.error).toMatch(/\("essentials"\) does not exist yet/)

    const essentials = await uploadAndPublishFirst()
    const ok = await publishCourseDraft({ courseId: uploaded.data!.courseId!, change: 'first', changeNote: '' })
    expect(ok.success).toBe(true)
    expect(courses.get(uploaded.data!.courseId!)?.prerequisiteCourseId).toBe(essentials.id)
  })

  it('finishes a publish that froze its version but stopped before the course went live', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const courseId = uploaded.data!.courseId!
    mocks.service.updateCourse.mockRejectedValueOnce(new Error('connection reset'))
    const failed = await publishCourseDraft({ courseId, change: 'first', changeNote: '' })
    expect(failed.error).toBe('Something went wrong. Please try again.')
    expect(courses.get(courseId)?.status).toBe('draft')

    const retried = await publishCourseDraft({ courseId, change: 'first', changeNote: '' })
    expect(retried.success).toBe(true)
    expect(retried.data).toMatchObject({ major: 1, minor: 0 })
    expect(courses.get(courseId)?.status).toBe('live')
  })

  it('finishes a later publish that froze its version but could not update the course row', async () => {
    const live = await uploadAndPublishFirst()
    const first = live.currentVersionId
    await uploadCourseDraft(looseUpload(course({ title: 'Essentials 2026', refresherMonths: 24 })))
    mocks.service.updateCourse.mockRejectedValueOnce(new Error('connection reset'))
    const failed = await publishCourseDraft({ courseId: live.id, change: 'redo', changeNote: 'New fire assembly point' })
    expect(failed.error).toBe('Something went wrong. Please try again.')
    // Frozen, but the course row still has the old version and the old details.
    expect(courses.get(live.id)).toMatchObject({ title: 'Essentials', refresherMonths: 12, currentVersionId: first })

    // Pressing Publish again (whichever change is chosen) finishes the publish that was frozen.
    const retried = await publishCourseDraft({ courseId: live.id, change: 'minor', changeNote: 'Trying again' })
    expect(retried.success).toBe(true)
    expect(retried.data).toMatchObject({ major: 2, minor: 0 })
    expect(courses.get(live.id)).toMatchObject({ title: 'Essentials 2026', refresherMonths: 24, currentVersionId: retried.data!.versionId })
    const published = events.filter((event) => event.eventType === 'course_published' && (event.meta as Json).versionId === retried.data!.versionId)
    expect(published).toHaveLength(1)
    expect(published[0].meta).toMatchObject({ change: 'redo', redoRequired: true })
    expect(events.filter((event) => event.eventType === 'redo_requested')).toHaveLength(1)
  })

  it('finishes a publish whose log line was never written after the course row was updated', async () => {
    const live = await uploadAndPublishFirst()
    await uploadCourseDraft(looseUpload(course({ summary: 'A clearer summary for everyone.' })))
    mocks.service.writeEvent.mockRejectedValueOnce(new Error('timeout'))
    const failed = await publishCourseDraft({ courseId: live.id, change: 'minor', changeNote: 'Clearer summary' })
    expect(failed.error).toBe('Something went wrong. Please try again.')
    const frozen = [...versions.values()].find((version) => version.major === 1 && version.minor === 1)!
    expect(courses.get(live.id)?.currentVersionId).toBe(frozen.id)
    expect(events.some((event) => event.eventType === 'course_published' && (event.meta as Json).versionId === frozen.id)).toBe(false)

    vi.mocked(logAuditEvent).mockClear()
    const retried = await publishCourseDraft({ courseId: live.id, change: 'minor', changeNote: 'Clearer summary' })
    expect(retried.data).toMatchObject({ versionId: frozen.id, major: 1, minor: 1 })
    expect(events.filter((event) => event.eventType === 'course_published' && (event.meta as Json).versionId === frozen.id)).toHaveLength(1)
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'publish', resource_id: live.id }))

    // Once it is finished there is nothing left to do.
    expect((await publishCourseDraft({ courseId: live.id, change: 'minor', changeNote: 'Again' })).error).toBe(
      'There is no draft to publish. Upload the course first.'
    )
  })

  it('freezes only the draft it checked: a draft replaced while publishing is refused, not published unchecked', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const courseId = uploaded.data!.courseId!
    const draft = [...versions.values()][0]
    // Read for checking, then replaced in place (same id, new upload time) with a gap in it.
    mocks.service.getDraftVersion.mockImplementationOnce(async () => {
      const read = { ...draft }
      versions.set(draft.id, { ...draft, uploadedAt: now(), content: { ...draft.content, summary: 'Ring [[TO CONFIRM: number]] first.' } })
      return read
    })
    const result = await publishCourseDraft({ courseId, change: 'first', changeNote: '' })
    expect(result.error).toBe('The draft was replaced or published while you were looking at it. Refresh and try again.')
    expect(mocks.service.publishDraftVersion).toHaveBeenCalledWith(expect.objectContaining({ draftVersionId: draft.id, expectedUploadedAt: draft.uploadedAt }))
    expect(versions.get(draft.id)?.state).toBe('draft')
    expect(courses.get(courseId)?.status).toBe('draft')
  })

  it('refuses when the draft was replaced since the manager opened the page', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const courseId = uploaded.data!.courseId!
    const seen = [...versions.values()][0].uploadedAt
    await uploadCourseDraft(looseUpload(course({ summary: 'Someone else changed this.' })))
    const result = await publishCourseDraft({ courseId, change: 'first', changeNote: '', draftUploadedAt: seen })
    expect(result.error).toBe('The draft was replaced since you opened this page. Refresh, check the new draft, then publish it.')
    expect(mocks.service.publishDraftVersion).not.toHaveBeenCalled()

    const current = [...versions.values()].find((version) => version.state === 'draft')!.uploadedAt
    expect((await publishCourseDraft({ courseId, change: 'first', changeNote: '', draftUploadedAt: current })).success).toBe(true)
  })

  it('still publishes when the sync afterwards fails, leaving it to the daily sweep', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    mocks.service.syncAssignments.mockRejectedValueOnce(new Error('timeout'))
    const result = await publishCourseDraft({ courseId: uploaded.data!.courseId!, change: 'first', changeNote: '' })
    expect(result.success).toBe(true)
    expect(result.data?.sync).toBeNull()
    expect(courses.get(uploaded.data!.courseId!)?.status).toBe('live')
  })
})

// ---------------------------------------------------------------------------------------------
// Retire, external types, download
// ---------------------------------------------------------------------------------------------

describe('retireTrainingCourse', () => {
  it('retires a course and reports the cycles the sync cancelled', async () => {
    const live = await uploadAndPublishFirst()
    const result = await retireTrainingCourse({ courseId: live.id })
    expect(result).toEqual({ success: true, data: { cancelled: 1 } })
    expect(courses.get(live.id)?.status).toBe('retired')
    expect(mocks.service.writeEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'course_retired', courseId: live.id }))
  })

  it('refuses to retire a course another live course needs first', async () => {
    const essentials = await uploadAndPublishFirst()
    await uploadAndPublishFirst(course({ slug: 'walkthrough', title: 'Walkthrough', essentials: false, prerequisite: 'essentials' }))
    const result = await retireTrainingCourse({ courseId: essentials.id })
    expect(result.error).toMatch(/"Walkthrough" needs this course first/)
    expect(courses.get(essentials.id)?.status).toBe('live')
  })
})

describe('createExternalCourse', () => {
  it('adds a live external type with no content version', async () => {
    const result = await createExternalCourse({ title: 'Level 2 Food Hygiene', refresherMonths: 36, groups: ['kitchen', 'kitchen'], required: true })
    expect(result.success).toBe(true)
    expect(result.data?.slug).toBe('external-level-2-food-hygiene')
    expect(onlyCourse()).toMatchObject({
      kind: 'external',
      status: 'live',
      title: 'Level 2 Food Hygiene',
      refresherMonths: 36,
      audienceGroups: ['kitchen'],
      currentVersionId: null,
      // Required: the due-day rule is how the service knows to assign it (courseAssignsAutomatically).
      newStarterDueDays: 14,
      existingStaffDueDays: 28,
    })
    expect(mocks.service.syncAssignments).toHaveBeenCalledTimes(1)
    expect(mocks.service.saveDraftVersion).not.toHaveBeenCalled()
    expect(mocks.service.publishDraftVersion).not.toHaveBeenCalled()
    expect(logAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ operation_type: 'create', additional_info: expect.objectContaining({ required: true }) }))
  })

  it('gives a one-month qualification a 27-day refresher window, and anything longer 30 days', async () => {
    const monthly = await createExternalCourse({ title: 'Cellar gas check', refresherMonths: 1, groups: [], required: false })
    expect(courses.get(monthly.data!.courseId)).toMatchObject({ refresherMonths: 1, windowDays: 27 })
    const yearly = await createExternalCourse({ title: 'Fire marshal', refresherMonths: 12, groups: [], required: false })
    expect(courses.get(yearly.data!.courseId)).toMatchObject({ refresherMonths: 12, windowDays: 30 })
    const never = await createExternalCourse({ title: 'Personal licence', refresherMonths: null, groups: [], required: false })
    expect(courses.get(never.data!.courseId)).toMatchObject({ refresherMonths: null, windowDays: 30 })
  })

  it('finds a free slug when the name is taken, and refuses a long dash', async () => {
    await createExternalCourse({ title: 'First aid', refresherMonths: 36, groups: [], required: false })
    const second = await createExternalCourse({ title: 'First Aid', refresherMonths: null, groups: [], required: false })
    expect(second.data?.slug).toBe('external-first-aid-2')
    // Recorded by hand only: no due-day rule, so sync never assigns it.
    expect(courses.get(second.data!.courseId)).toMatchObject({ newStarterDueDays: null, existingStaffDueDays: null })
    expect(mocks.service.syncAssignments).not.toHaveBeenCalled()

    const dashed = await createExternalCourse({ title: `First aid ${LONG_DASH} work`, refresherMonths: null, groups: [], required: false })
    expect(dashed.error).toMatch(/long dash/)
  })

  it('refuses an upload that reuses an external type slug', async () => {
    await createExternalCourse({ title: 'Personal licence', refresherMonths: null, groups: ['management'], required: false })
    const result = await uploadCourseDraft(looseUpload(course({ slug: 'external-personal-licence' })))
    expect(result.data?.saved).toBe(false)
    expect(result.data?.errors.join('\n')).toMatch(/is an external qualification type/)
  })
})

describe('getCourseVersionJson', () => {
  it('returns the frozen course file with its version in the name', async () => {
    const live = await uploadAndPublishFirst()
    const result = await getCourseVersionJson(live.currentVersionId!)
    expect(result.data?.fileName).toBe('essentials-1.0.json')
    expect(JSON.parse(result.data!.json).slug).toBe('essentials')
  })
})

// ---------------------------------------------------------------------------------------------
// Preview records nothing
// ---------------------------------------------------------------------------------------------

describe('preview', () => {
  it('draws and marks a draft check without writing anything', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    vi.clearAllMocks()
    installService()
    vi.mocked(getSigningStaffUser).mockResolvedValue(USER)
    vi.mocked(checkUserPermission).mockResolvedValue(true)

    const served = [
      { questionId: 'fire-01', optionOrder: [2, 0, 1] },
      { questionId: 'fire-03', optionOrder: [0, 1, 2] },
    ]
    vi.mocked(drawQuestions).mockReturnValue(served)
    vi.mocked(toCheckQuestionViews).mockReturnValue([
      { id: 'fire-01', prompt: 'p1', options: ['c', 'a', 'b'] },
      { id: 'fire-03', prompt: 'p3', options: ['a', 'b', 'c'] },
    ])
    vi.mocked(scoreAttempt).mockReturnValue({ passed: true, wrongCount: 0, criticalMissed: 0, answers: { 'fire-01': 1, 'fire-03': 1 }, results: [] })
    vi.mocked(toCheckResultItems).mockReturnValue([])

    const versionId = uploaded.data!.versionId!
    const draw = await previewDraw({ versionId, sectionKey: 'fire', previousQuestionIds: ['fire-02'] })
    expect(draw.data?.served).toEqual(served)
    expect(vi.mocked(drawQuestions).mock.calls[0][0]).toMatchObject({ section: { key: 'fire' }, previousQuestionIds: ['fire-02'] })

    const score = await previewScore({ versionId, sectionKey: 'fire', served, answers: { 'fire-01': 2, 'fire-03': 1 } })
    expect(score.data).toMatchObject({ passed: true, next: 'next_section', maxWrong: 1 })

    vi.mocked(scoreAttempt).mockReturnValue({ passed: false, wrongCount: 2, criticalMissed: 1, answers: {}, results: [] })
    const failed = await previewScore({ versionId, sectionKey: 'allergens', served, answers: {} })
    expect(failed.data?.next).toBe('retry')

    for (const write of [
      mocks.service.writeEvent,
      mocks.service.createAttempt,
      mocks.service.submitAttempt,
      mocks.service.createAssignment,
      mocks.service.updateAssignment,
      mocks.service.saveDraftVersion,
      mocks.service.publishDraftVersion,
      mocks.service.updateCourse,
      mocks.service.syncAssignments,
      mocks.upload,
      logAuditEvent,
      revalidatePath,
    ]) {
      expect(write).not.toHaveBeenCalled()
    }
  })

  it('refuses a served list that shows an option twice', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const result = await previewScore({
      versionId: uploaded.data!.versionId!,
      sectionKey: 'fire',
      served: [{ questionId: 'fire-01', optionOrder: [1, 1, 2] }],
      answers: { 'fire-01': 0 },
    })
    expect(result.error).toBe('That preview answer was not valid.')
    expect(scoreAttempt).not.toHaveBeenCalled()
  })

  it('says so when the section is not in the version', async () => {
    const uploaded = await uploadCourseDraft(looseUpload(course()))
    const result = await previewDraw({ versionId: uploaded.data!.versionId!, sectionKey: 'nope', previousQuestionIds: [] })
    expect(result.error).toBe('That section is not in this version.')
  })
})

// ---------------------------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------------------------

describe('permissions', () => {
  it('refuses every course change without training:publish, before touching anything', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    const id = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890'

    await expect(uploadCourseDraft(looseUpload(course()))).rejects.toThrow('Insufficient permissions')
    await expect(publishCourseDraft({ courseId: id, change: 'first', changeNote: '' })).rejects.toThrow('Insufficient permissions')
    await expect(retireTrainingCourse({ courseId: id })).rejects.toThrow('Insufficient permissions')
    await expect(createExternalCourse({ title: 'First aid', refresherMonths: null, groups: [], required: false })).rejects.toThrow(
      'Insufficient permissions'
    )
    await expect(previewDraw({ versionId: id, sectionKey: 'fire', previousQuestionIds: [] })).rejects.toThrow('Insufficient permissions')
    await expect(listTrainingCourses()).rejects.toThrow('Insufficient permissions')

    expect(vi.mocked(checkUserPermission).mock.calls.map((call) => call.slice(0, 2))).toContainEqual(['training', 'publish'])
    expect(vi.mocked(checkUserPermission).mock.calls.map((call) => call.slice(0, 2))).toContainEqual(['training', 'view'])
    for (const fn of Object.values(mocks.service)) expect(fn).not.toHaveBeenCalled()
    expect(mocks.upload).not.toHaveBeenCalled()
  })

  it('refuses anyone not signed in', async () => {
    vi.mocked(getSigningStaffUser).mockResolvedValue(null)
    await expect(uploadCourseDraft(looseUpload(course()))).rejects.toThrow('Unauthorized')
    expect(checkUserPermission).not.toHaveBeenCalled()
  })
})
