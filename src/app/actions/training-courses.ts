'use server'

import JSZip from 'jszip'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAuditEvent } from '@/app/actions/audit'
import { checkUserPermission } from '@/app/actions/rbac'
import { getTrainingEmailsSwitch, setTrainingEmailsSwitch } from '@/app/actions/training-settings'
import { getSigningStaffUser, type SigningStaffUser } from '@/lib/signing/staff'
import { COURSE_IMAGE_EXTENSIONS, COURSE_KEY_PATTERN, defaultWindowDaysFor, listCourseImageSrcs, validateCourse } from '@/lib/training/course-schema'
import { drawQuestions, toCheckQuestionViews } from '@/lib/training/draw'
import { scoreAttempt, toCheckResultItems } from '@/lib/training/scoring'
import {
  COURSE_IMAGE_MAX_BYTES,
  courseImageProblem,
  formatMegabytes,
  sha256Hex,
  uploadCourseImage,
} from '@/lib/training/storage'
import { COURSE_UPLOAD_MAX_BYTES } from '@/lib/training/upload-limits'
import { TrainingService } from '@/services/training'
import {
  PUBLISH_CHANGES,
  TRAINING_GROUPS,
  TrainingError,
  type Actor,
  type CheckResultView,
  type CourseContent,
  type CourseDetailView,
  type CourseListItem,
  type CourseSection,
  type PlayerCourseView,
  type PreviewDrawView,
  type PublishChange,
  type PublishCourseResult,
  type ServedQuestion,
  type SyncResult,
  type TrainingActionResult,
  type TrainingCourse,
  type TrainingCourseVersionMeta,
  type TrainingGroup,
  type UploadCourseDraftResult,
  type VersionImage,
} from '@/lib/training/types'

/**
 * Course actions (build contract section 5.3). Listing and reading need `training:view`;
 * uploading, previewing, publishing and retiring need `training:publish`. Each change writes a
 * `training_events` row and `logAuditEvent`, and revalidates `/employees/training`.
 *
 * Permission failures throw (`Unauthorized`, `Insufficient permissions`), as the rest of the
 * app does; anything else comes back as `{ error }` in words for the manager.
 *
 * Course files hold the answers, so they are uploaded here and kept in the database, never in
 * this repository (it is public).
 */

/**
 * The most one upload can be as sent: the platform refuses a bigger request body before this
 * action runs (src/lib/training/upload-limits.ts). The browser form checks the same number.
 */
const MAX_UPLOAD_BYTES = COURSE_UPLOAD_MAX_BYTES
/** The most a zip may unpack to, so a small zip cannot expand without limit. */
const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024
/** A whole course is tens of kilobytes; this leaves plenty of room and stops a runaway file. */
const MAX_COURSE_JSON_BYTES = 2 * 1024 * 1024
/** Files in one upload or zip. */
const MAX_UPLOAD_FILES = 200
/** Errors listed in a refusal message before "and N more". */
const ERRORS_IN_MESSAGE = 5

const LONG_DASH = String.fromCharCode(0x2014)

const UuidSchema = z.string().uuid()
const SlugSchema = z.string().regex(COURSE_KEY_PATTERN)

const PublishSchema = z.object({
  courseId: UuidSchema,
  change: z.enum(PUBLISH_CHANGES),
  changeNote: z.string().trim().max(500, 'Keep the change note under 500 characters').default(''),
  draftUploadedAt: z.string().min(1).max(64).optional(),
})

const ExternalCourseSchema = z.object({
  title: z.string().trim().min(2, 'Give the qualification a name').max(120, 'Keep the name under 120 characters'),
  refresherMonths: z.number().int().min(1).max(120).nullable(),
  groups: z.array(z.enum(TRAINING_GROUPS)).max(TRAINING_GROUPS.length),
  required: z.boolean(),
})

const ServedSchema = z
  .array(
    z
      .object({
        questionId: z.string().min(1).max(60),
        optionOrder: z.array(z.number().int().min(0).max(2)).length(3),
      })
      .refine((item) => new Set(item.optionOrder).size === item.optionOrder.length, 'Each option must be shown once')
  )
  .min(1)
  .max(12)

const PreviewDrawSchema = z.object({
  versionId: UuidSchema,
  sectionKey: SlugSchema,
  previousQuestionIds: z.array(z.string().max(60)).max(50).default([]),
})

const PreviewScoreSchema = z.object({
  versionId: UuidSchema,
  sectionKey: SlugSchema,
  served: ServedSchema,
  answers: z.record(z.number().int().min(0).max(2)),
})

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** The signed-in member of staff, after the permission check. Throws as the rest of the app does. */
async function requireTrainingUser(action: 'view' | 'publish'): Promise<SigningStaffUser> {
  const user = await getSigningStaffUser()
  if (!user) throw new Error('Unauthorized')
  if (!(await checkUserPermission('training', action, user.id))) throw new Error('Insufficient permissions')
  return user
}

function actorOf(user: SigningStaffUser): Actor {
  return { id: user.id, name: user.name }
}

function failure(error: unknown, what: string): { error: string } {
  // A TrainingError carries words written for the manager. Anything else is ours and is not shown raw.
  if (error instanceof TrainingError) return { error: error.message }
  console.error(`Training course action failed (${what}):`, error)
  return { error: 'Something went wrong. Please try again.' }
}

function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message && error.issues[0].message !== 'Required' ? error.issues[0].message : fallback
}

function revalidateCourse(slug: string | null): void {
  revalidatePath('/employees/training')
  if (slug) revalidatePath(`/employees/training/courses/${slug}`)
}

function versionLabel(version: { major: number | null; minor: number | null }): string {
  return version.major === null || version.minor === null ? 'draft' : `${version.major}.${version.minor}`
}

/** A list of problems in one message: the first few, then how many more. */
function summariseErrors(lead: string, errors: readonly string[]): string {
  const shown = errors.slice(0, ERRORS_IN_MESSAGE).join('. ')
  const more = errors.length > ERRORS_IN_MESSAGE ? ` And ${errors.length - ERRORS_IN_MESSAGE} more.` : ''
  return `${lead} ${shown}.${more}`
}

/** The course row's copy of a course file's metadata (contract 5.3: copied at publish). */
function courseRowFields(content: CourseContent, prerequisiteCourseId: string | null) {
  return {
    title: content.title,
    kind: content.kind,
    audienceGroups: [...content.audience.groups],
    audienceAge: content.audience.age,
    isEssentials: content.essentials,
    prerequisiteCourseId,
    newStarterDueDays: content.deadline.newStarterDays,
    existingStaffDueDays: content.deadline.existingStaffDays,
    refresherMonths: content.refresherMonths,
    windowDays: content.windowDays,
    supervisedOnlyUnder18: content.supervisedOnlyUnder18,
    summary: content.summary,
  }
}

/** The fingerprint stored with a version: SHA-256 of the validated content as stored. */
function contentFingerprint(content: CourseContent): string {
  return sha256Hex(new TextEncoder().encode(JSON.stringify(content)))
}

/** The newest published version: the highest major, then the highest minor. */
function latestPublished(versions: readonly TrainingCourseVersionMeta[]): TrainingCourseVersionMeta | null {
  let latest: TrainingCourseVersionMeta | null = null
  for (const version of versions) {
    if (version.state !== 'published' || version.major === null || version.minor === null) continue
    if (
      !latest ||
      version.major > (latest.major as number) ||
      (version.major === latest.major && version.minor > (latest.minor as number))
    ) {
      latest = version
    }
  }
  return latest
}

/**
 * What is wrong with a course's prerequisite, if anything: it must exist, be live, and not lead
 * back to this course. Upload reports these as warnings; publish refuses on them.
 */
async function checkPrerequisite(
  content: CourseContent,
  courseId: string | null
): Promise<{ prerequisite: TrainingCourse | null; problem: string | null; loops: boolean }> {
  if (!content.prerequisite) return { prerequisite: null, problem: null, loops: false }
  const prerequisite = await TrainingService.getCourseBySlug(content.prerequisite)
  if (!prerequisite) {
    return {
      prerequisite: null,
      problem: `The course it needs first ("${content.prerequisite}") does not exist yet. Upload and publish it before this one`,
      loops: false,
    }
  }
  // Walk the chain: a course that, step by step, needs this one first would leave everyone waiting.
  const seen = new Set<string>()
  let step: TrainingCourse | null = prerequisite
  while (step && !seen.has(step.id) && seen.size < 25) {
    if (step.slug === content.slug || (courseId !== null && step.id === courseId)) {
      return {
        prerequisite,
        problem: `"${content.prerequisite}" already needs this course first, so neither could ever start. Change "prerequisite" in one of them`,
        loops: true,
      }
    }
    seen.add(step.id)
    step = step.prerequisiteCourseId ? await TrainingService.getCourseById(step.prerequisiteCourseId) : null
  }
  if (prerequisite.status === 'retired') {
    return {
      prerequisite,
      problem: `The course it needs first ("${content.prerequisite}") is retired. Choose another or set "prerequisite" to null`,
      loops: false,
    }
  }
  if (prerequisite.status !== 'live') {
    return {
      prerequisite,
      problem: `The course it needs first ("${content.prerequisite}") is not published yet. Publish it before this one`,
      loops: false,
    }
  }
  return { prerequisite, problem: null, loops: false }
}

// ---------------------------------------------------------------------------------------------
// Reading an upload: course.json plus images as separate files, or one zip
// ---------------------------------------------------------------------------------------------

interface UploadEntry {
  /** Path inside the upload, relative to course.json's folder. */
  path: string
  bytes: Uint8Array
  /** The browser's claim, for loose files only; zips carry no type. */
  claimedType: string | null
}

interface UnpackedUpload {
  courseJson: UploadEntry | null
  files: Map<string, UploadEntry>
  /** Separate files lose their folders in most browsers, so images are also matched by name. */
  loose: boolean
  errors: string[]
  warnings: string[]
}

interface UploadedFile {
  name: string
  size: number
  type: string
  arrayBuffer(): Promise<ArrayBuffer>
}

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as UploadedFile).arrayBuffer === 'function' &&
    typeof (value as UploadedFile).name === 'string' &&
    typeof (value as UploadedFile).size === 'number'
  )
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path
}

function extensionOf(path: string): string {
  const name = baseName(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function isImagePath(path: string): boolean {
  return (COURSE_IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(path))
}

/** Folder clutter from macOS, Windows and editors, skipped without comment. */
function isClutter(path: string): boolean {
  const segments = path.split('/')
  return segments.some((segment) => segment === '__MACOSX' || segment.startsWith('.')) || /^(thumbs\.db|desktop\.ini)$/i.test(baseName(path))
}

/** A path written the same way whatever sent it; null for one that tries to leave the upload. */
function cleanPath(raw: string): string | null {
  const path = raw.replace(/\\/g, '/').replace(/^(\.\/)+/, '')
  if (!path || path.startsWith('/') || path.split('/').some((segment) => segment === '..')) return null
  return path
}

function isZipFile(file: UploadedFile): boolean {
  return extensionOf(file.name) === 'zip' || /zip/i.test(file.type)
}

/** The size a zip entry says it unzips to (from the zip's own directory), or null when unknown. */
function declaredSize(entry: JSZip.JSZipObject): number | null {
  const data = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data
  return typeof data?.uncompressedSize === 'number' ? data.uncompressedSize : null
}

class EntryTooLargeError extends Error {}

/**
 * Unzips one entry, stopping as soon as it passes `limit` bytes, so a zip that unpacks to far
 * more than it says cannot fill the server's memory.
 */
function readZipEntry(entry: JSZip.JSZipObject, limit: number): Promise<Uint8Array> {
  const stream = (entry as unknown as { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream(
    'uint8array'
  )
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    let total = 0
    let settled = false
    stream.on('data', (chunk) => {
      if (settled) return
      total += chunk.length
      if (total > limit) {
        settled = true
        stream.pause()
        reject(new EntryTooLargeError(`${entry.name} is over ${limit} bytes`))
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    stream.on('end', () => {
      if (settled) return
      settled = true
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      resolve(bytes)
    })
    stream.resume()
  })
}

async function unpackZip(file: UploadedFile, errors: string[], warnings: string[]): Promise<UploadEntry[]> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    errors.push(`"${file.name}" could not be opened as a zip file`)
    return []
  }

  const objects = Object.values(zip.files).filter((entry) => !entry.dir)
  if (objects.length > MAX_UPLOAD_FILES) {
    errors.push(`The zip holds ${objects.length} files; the most one upload can hold is ${MAX_UPLOAD_FILES}`)
    return []
  }

  const entries: UploadEntry[] = []
  let budget = MAX_UNZIPPED_BYTES
  for (const object of objects) {
    const path = cleanPath(object.name)
    if (!path || (object.unsafeOriginalName && !cleanPath(object.unsafeOriginalName))) {
      warnings.push(`"${object.unsafeOriginalName ?? object.name}" in the zip was ignored: its path leads outside the zip`)
      continue
    }
    if (isClutter(path)) continue
    const isJson = baseName(path) === 'course.json'
    if (!isJson && !isImagePath(path)) {
      warnings.push(`"${path}" was ignored: only course.json and jpg, png, webp or gif images are used`)
      continue
    }

    const limit = isJson ? MAX_COURSE_JSON_BYTES : COURSE_IMAGE_MAX_BYTES
    const what = isJson ? path : `Image "${path}"`
    const declared = declaredSize(object)
    if (declared !== null && declared > limit) {
      errors.push(`${what} is ${formatMegabytes(declared)}; the most it can be is ${formatMegabytes(limit)}`)
      continue
    }
    if (declared !== null && declared > budget) {
      errors.push(`The zip unpacks to more than ${formatMegabytes(MAX_UNZIPPED_BYTES)}; make the images smaller`)
      return entries
    }
    try {
      const bytes = await readZipEntry(object, Math.min(limit, budget))
      budget -= bytes.byteLength
      entries.push({ path, bytes, claimedType: null })
    } catch (error) {
      if (error instanceof EntryTooLargeError) {
        errors.push(
          budget < limit
            ? `The zip unpacks to more than ${formatMegabytes(MAX_UNZIPPED_BYTES)}; make the images smaller`
            : `${what} is bigger than ${formatMegabytes(limit)}`
        )
        if (budget < limit) return entries
        continue
      }
      errors.push(`"${path}" in the zip could not be read`)
    }
  }
  return entries
}

/**
 * The upload's files with their paths, relative to the folder course.json is in. Errors here
 * stop the upload before anything is read as a course.
 */
async function readUpload(formData: FormData): Promise<UnpackedUpload> {
  const errors: string[] = []
  const warnings: string[] = []
  const files: UploadedFile[] = []
  for (const value of [...formData.getAll('files'), ...formData.getAll('file')] as unknown[]) {
    if (isUploadedFile(value)) files.push(value)
  }
  const empty: UnpackedUpload = { courseJson: null, files: new Map(), loose: true, errors, warnings }

  if (files.length === 0) {
    errors.push('Choose course.json and its images, or one zip file')
    return empty
  }
  if (files.length > MAX_UPLOAD_FILES) {
    errors.push(`That is ${files.length} files; the most one upload can hold is ${MAX_UPLOAD_FILES}`)
    return empty
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_UPLOAD_BYTES) {
    errors.push(`The upload is ${formatMegabytes(totalBytes)}; the most one upload can be is ${formatMegabytes(MAX_UPLOAD_BYTES)}`)
    return empty
  }

  const zips = files.filter(isZipFile)
  if (zips.length > 0 && files.length > 1) {
    errors.push('Upload one zip on its own, or course.json with its images, but not both')
    return empty
  }

  let entries: UploadEntry[]
  const loose = zips.length === 0
  if (!loose) {
    entries = await unpackZip(zips[0], errors, warnings)
    if (errors.length > 0) return { ...empty, loose }
  } else {
    entries = []
    for (const file of files) {
      const path = cleanPath(file.name)
      if (!path) {
        warnings.push(`"${file.name}" was ignored: its name is not a plain file name`)
        continue
      }
      if (isClutter(path)) continue
      if (baseName(path) === 'course.json' && file.size > MAX_COURSE_JSON_BYTES) {
        errors.push(`course.json is ${formatMegabytes(file.size)}; the most it can be is ${formatMegabytes(MAX_COURSE_JSON_BYTES)}`)
        continue
      }
      if (baseName(path) !== 'course.json' && !isImagePath(path)) {
        warnings.push(`"${path}" was ignored: only course.json and jpg, png, webp or gif images are used`)
        continue
      }
      entries.push({ path, bytes: new Uint8Array(await file.arrayBuffer()), claimedType: file.type || null })
    }
    if (errors.length > 0) return empty
  }

  const jsonEntries = entries.filter((entry) => baseName(entry.path) === 'course.json')
  if (jsonEntries.length === 0) {
    errors.push('The upload has no course.json')
    return { ...empty, loose }
  }
  if (jsonEntries.length > 1) {
    errors.push('The upload has more than one course.json. Upload one course at a time')
    return { ...empty, loose }
  }

  const courseJson = jsonEntries[0]
  // Image paths in course.json are relative to its own folder, so a zip of the course folder works.
  const root = courseJson.path.slice(0, courseJson.path.length - 'course.json'.length)
  const filesByPath = new Map<string, UploadEntry>()
  for (const entry of entries) {
    if (entry === courseJson) continue
    if (!entry.path.startsWith(root)) {
      warnings.push(`"${entry.path}" was ignored: it is not in the folder course.json is in`)
      continue
    }
    const relative = entry.path.slice(root.length)
    if (filesByPath.has(relative)) {
      errors.push(`Two files in the upload are called "${relative}". Keep one`)
      continue
    }
    filesByPath.set(relative, { ...entry, path: relative })
  }
  if (errors.length > 0) return { ...empty, loose }
  return { courseJson: { ...courseJson, path: 'course.json' }, files: filesByPath, loose, errors, warnings }
}

/**
 * Finds the file for each image the course uses: by its exact path, or (separate files only,
 * whose folders the browser drops) by its file name when only one file has that name.
 */
function resolveImages(
  content: CourseContent,
  upload: UnpackedUpload
): { images: Map<string, UploadEntry>; errors: string[]; warnings: string[] } {
  const images = new Map<string, UploadEntry>()
  const errors: string[] = []
  const warnings: string[] = []
  const used = new Set<UploadEntry>()
  const srcs = listCourseImageSrcs(content)
  const byName = new Map<string, UploadEntry[]>()
  for (const entry of upload.files.values()) {
    const name = baseName(entry.path)
    byName.set(name, [...(byName.get(name) ?? []), entry])
  }

  const nameClaims = new Map<string, string[]>()
  for (const src of srcs) {
    const exact = upload.files.get(src)
    if (exact) {
      images.set(src, exact)
      used.add(exact)
      continue
    }
    if (!upload.loose) continue
    const matches = byName.get(baseName(src)) ?? []
    if (matches.length === 1) {
      images.set(src, matches[0])
      used.add(matches[0])
      nameClaims.set(baseName(src), [...(nameClaims.get(baseName(src)) ?? []), src])
    } else if (matches.length > 1) {
      errors.push(`Image "${src}" matches more than one file called "${baseName(src)}". Upload the course folder as a zip so the folders are kept`)
    }
  }
  for (const [name, claimedBy] of nameClaims) {
    if (claimedBy.length > 1) {
      errors.push(
        `${claimedBy.map((src) => `"${src}"`).join(' and ')} would all use the one file "${name}". Upload the course folder as a zip so the folders are kept`
      )
    }
  }
  for (const entry of upload.files.values()) {
    if (!used.has(entry)) warnings.push(`"${entry.path}" is not used by any card, so it was not saved`)
  }
  return { images, errors, warnings }
}

/** The slug a file names, when it can be read at all, so a failed upload can still say which course. */
function readSlug(text: string): string | null {
  try {
    const raw = JSON.parse(text) as { slug?: unknown }
    return typeof raw?.slug === 'string' && COURSE_KEY_PATTERN.test(raw.slug) ? raw.slug : null
  } catch {
    return null
  }
}

function decodeCourseJson(bytes: Uint8Array): string | null {
  try {
    // TextDecoder drops a leading byte order mark itself (ignoreBOM is false by default).
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** Refusals that need the database: the course this file is for, and whether it can take a draft. */
function existingCourseProblems(content: CourseContent, existing: TrainingCourse | null, formCourseId: string | null): string[] {
  const problems: string[] = []
  if (formCourseId && (!existing || existing.id !== formCourseId)) {
    problems.push(
      `This file is for the course "${content.slug}", not the course you are uploading to. A course's slug never changes: check "slug" in course.json`
    )
  }
  if (!existing) return problems
  if (existing.kind === 'external') {
    problems.push(`"${content.slug}" is an external qualification type, which has no course file. Use another slug`)
  }
  if (existing.status === 'retired') {
    problems.push(`"${content.slug}" is retired, so it cannot take a new draft. Use a new slug for a new course`)
  }
  if (existing.currentVersionId && existing.kind !== 'external' && existing.kind !== content.kind) {
    problems.push(
      `"${content.slug}" is published as a ${existing.kind} course and cannot change to ${content.kind}. Use a new slug for a new course`
    )
  }
  return problems
}

// ---------------------------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------------------------

/** training:view. Every course with its status, current version and counts. */
export async function listTrainingCourses(): Promise<TrainingActionResult<CourseListItem[]>> {
  await requireTrainingUser('view')
  try {
    return { success: true, data: await TrainingService.listCourseItems() }
  } catch (error) {
    return failure(error, 'list courses')
  }
}

/** training:view. One course: versions, the current one, the draft with what blocks publishing, and counts. */
export async function getTrainingCourse(slug: string): Promise<TrainingActionResult<CourseDetailView>> {
  await requireTrainingUser('view')
  if (!SlugSchema.safeParse(slug).success) return { error: 'Course not found.' }
  try {
    const detail = await TrainingService.getCourseDetail(slug)
    if (!detail) return { error: 'Course not found.' }
    return { success: true, data: detail }
  } catch (error) {
    return failure(error, 'read course')
  }
}

// ---------------------------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------------------------

/**
 * training:publish. Uploads a draft: `course.json` plus its images, or one `.zip` (jszip) holding
 * them. Validates in draft mode with the upload's image paths; creates the course (status
 * `draft`) on first upload; replaces the existing draft; stores images in the `training` bucket.
 * Any error means nothing was saved. Form fields: `files` (one or more), and optionally
 * `courseId` when uploading from a course's own page, so a file for another course is refused.
 *
 * `success` is true only when the draft was saved; otherwise `data.errors` says why.
 */
export async function uploadCourseDraft(formData: FormData): Promise<TrainingActionResult<UploadCourseDraftResult>> {
  const user = await requireTrainingUser('publish')
  const actor = actorOf(user)

  const notSaved = (fields: Partial<UploadCourseDraftResult> & { errors: string[] }): TrainingActionResult<UploadCourseDraftResult> => ({
    success: false,
    data: { slug: null, courseId: null, versionId: null, warnings: [], gaps: [], ...fields, saved: false },
  })

  try {
    const rawCourseId = formData.get('courseId')
    const formCourseId = typeof rawCourseId === 'string' && rawCourseId.trim() ? rawCourseId.trim() : null
    if (formCourseId && !UuidSchema.safeParse(formCourseId).success) return { error: 'Course not found.' }

    const upload = await readUpload(formData)
    if (upload.errors.length > 0 || !upload.courseJson) {
      return notSaved({ errors: upload.errors, warnings: upload.warnings })
    }

    const text = decodeCourseJson(upload.courseJson.bytes)
    if (text === null) return notSaved({ errors: ['course.json is not plain text (save it as UTF-8)'], warnings: upload.warnings })

    // First pass: is it a course at all? Its image list is only known once it is.
    const firstPass = validateCourse(text, { mode: 'draft' })
    if (!firstPass.ok || !firstPass.course) {
      return notSaved({
        slug: readSlug(text),
        errors: firstPass.errors,
        warnings: [...upload.warnings, ...firstPass.warnings],
        gaps: firstPass.gaps,
      })
    }
    const content = firstPass.course

    // Second pass with the images actually in the upload, then each image's own checks.
    const resolved = resolveImages(content, upload)
    const validation = validateCourse(text, { mode: 'draft', availableImages: [...resolved.images.keys()] })
    const errors = [...validation.errors, ...resolved.errors]
    const warnings = [...upload.warnings, ...resolved.warnings, ...validation.warnings]
    for (const [src, entry] of resolved.images) {
      const problem = courseImageProblem({ src, bytes: entry.bytes, contentType: entry.claimedType })
      if (problem) errors.push(problem)
    }

    const existing = await TrainingService.getCourseBySlug(content.slug)
    errors.push(...existingCourseProblems(content, existing, formCourseId))
    const prerequisiteCheck = await checkPrerequisite(content, existing?.id ?? null)
    if (prerequisiteCheck.problem) warnings.push(prerequisiteCheck.problem)

    if (errors.length > 0) {
      return notSaved({ slug: content.slug, courseId: existing?.id ?? null, errors, warnings, gaps: validation.gaps })
    }

    // A prerequisite is linked on the row only when it exists and does not loop back.
    const prerequisiteCourseId = prerequisiteCheck.loops ? null : (prerequisiteCheck.prerequisite?.id ?? null)

    let course = existing
    let created = false
    if (!course) {
      try {
        course = await TrainingService.createCourse({ slug: content.slug, ...courseRowFields(content, prerequisiteCourseId), status: 'draft', actor })
        created = true
      } catch (error) {
        // Two uploads of a new course at once: the other one made the row, so use it.
        if (!(error instanceof TrainingError && error.code === 'conflict')) throw error
        course = await TrainingService.getCourseBySlug(content.slug)
        if (!course) throw error
        const raced = existingCourseProblems(content, course, formCourseId)
        if (raced.length > 0) return notSaved({ slug: content.slug, courseId: course.id, errors: raced, warnings, gaps: validation.gaps })
      }
    } else if (course.status === 'draft' && !course.currentVersionId) {
      // Never published: keep the course list in step with the latest draft. A published
      // course's details change only when a version is published.
      course = await TrainingService.updateCourse(course.id, courseRowFields(content, prerequisiteCourseId))
    }

    const images: VersionImage[] = []
    for (const [src, entry] of [...resolved.images].sort(([a], [b]) => a.localeCompare(b))) {
      images.push(
        await uploadCourseImage({
          courseId: course.id,
          src,
          bytes: entry.bytes,
          contentType: entry.claimedType ?? '',
        })
      )
    }

    const contentSha256 = contentFingerprint(content)
    const version = await TrainingService.saveDraftVersion({ courseId: course.id, content, contentSha256, images, actor })

    await TrainingService.writeEvent({
      eventType: 'course_draft_uploaded',
      courseId: course.id,
      actor,
      meta: {
        versionId: version.id,
        slug: content.slug,
        contentSha256,
        images: images.length,
        gaps: validation.gaps.length,
        warnings: warnings.length,
        created,
      },
    })
    await logAuditEvent({
      user_id: user.id,
      ...(user.email ? { user_email: user.email } : {}),
      operation_type: 'upload',
      resource_type: 'training_course',
      resource_id: course.id,
      operation_status: 'success',
      additional_info: {
        slug: content.slug,
        version_id: version.id,
        content_sha256: contentSha256,
        images: images.length,
        gaps: validation.gaps.length,
        created,
      },
    })
    revalidateCourse(content.slug)

    return {
      success: true,
      data: {
        slug: content.slug,
        courseId: course.id,
        versionId: version.id,
        saved: true,
        errors: [],
        warnings,
        gaps: validation.gaps,
      },
    }
  } catch (error) {
    return failure(error, 'upload course draft')
  }
}

// ---------------------------------------------------------------------------------------------
// Publish and retire
// ---------------------------------------------------------------------------------------------

/**
 * After a version is frozen: the course row takes its details, the course goes live if this is
 * its first version, the events and audit are written, and everyone's training is brought in
 * line. A sync that fails is left to the daily sweep; the publish itself has happened.
 */
async function finishPublish(input: {
  course: TrainingCourse
  version: TrainingCourseVersionMeta
  content: CourseContent
  prerequisiteCourseId: string | null
  change: PublishChange
  user: SigningStaffUser
}): Promise<PublishCourseResult> {
  const { course, version, content, prerequisiteCourseId, change, user } = input
  const actor = actorOf(user)
  const goesLive = course.status === 'draft'

  await TrainingService.updateCourse(course.id, {
    ...courseRowFields(content, prerequisiteCourseId),
    currentVersionId: version.id,
    ...(goesLive ? { status: 'live' as const } : {}),
  })

  const label = versionLabel(version)
  await TrainingService.writeEvent({
    eventType: 'course_published',
    courseId: course.id,
    actor,
    note: version.changeNote,
    meta: {
      versionId: version.id,
      version: label,
      major: version.major,
      minor: version.minor,
      change,
      redoRequired: version.redoRequired,
      contentSha256: version.contentSha256,
      wentLive: goesLive,
    },
  })
  if (version.redoRequired) {
    await TrainingService.writeEvent({
      eventType: 'redo_requested',
      courseId: course.id,
      actor,
      note: version.changeNote,
      meta: { versionId: version.id, version: label },
    })
  }
  await logAuditEvent({
    user_id: user.id,
    ...(user.email ? { user_email: user.email } : {}),
    operation_type: 'publish',
    resource_type: 'training_course',
    resource_id: course.id,
    operation_status: 'success',
    additional_info: {
      slug: course.slug,
      version_id: version.id,
      version: label,
      change,
      redo_required: version.redoRequired,
      went_live: goesLive,
    },
  })

  let sync: SyncResult | null = null
  try {
    sync = await TrainingService.syncAssignments({ actor })
  } catch (error) {
    console.error('Training sync after publishing failed; the daily sweep will catch up:', error)
  }

  revalidateCourse(course.slug)
  return { versionId: version.id, major: version.major as number, minor: version.minor as number, sync }
}

/**
 * Whether the latest published version's publish stopped part way: it was frozen, but the course
 * row does not point at it yet (or the course never went live), or its `course_published` event
 * was never written. `publishDraftVersion` leaves the course row alone, so every failure after
 * the freeze shows up here.
 */
async function isUnfinishedPublish(course: TrainingCourse, latest: TrainingCourseVersionMeta): Promise<boolean> {
  if (course.status === 'draft' || course.currentVersionId !== latest.id) return true
  return !(await TrainingService.hasCoursePublishedEvent(course.id, latest.id))
}

/**
 * training:publish. Validates the draft in publish mode (every gap filled), freezes it, copies
 * the course metadata to the course row and sets `current_version_id`. `first`: 1.0, status
 * `live`. `minor`: the next minor number, nobody redoes anything. `redo`: the next major number
 * with `redo_required`. Every publish then syncs, so a change of audience applies at once.
 * `changeNote` is required after the first publish.
 *
 * Only the draft that was checked is published. `draftUploadedAt` (optional) is the draft the
 * manager previewed: when it is given and the draft has been replaced since, nothing is published.
 * The freeze itself is also tied to the draft read here, so a draft replaced while this runs is
 * refused rather than published unchecked.
 *
 * Safe to press again: if a version was frozen but the rest of the publish did not happen (the
 * course row, the events), pressing Publish with no draft finishes that publish.
 */
export async function publishCourseDraft(input: {
  courseId: string
  change: PublishChange
  changeNote: string
  draftUploadedAt?: string
}): Promise<TrainingActionResult<PublishCourseResult>> {
  const user = await requireTrainingUser('publish')
  const parsed = PublishSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'That publish request was not valid.') }
  const { courseId, change, draftUploadedAt } = parsed.data
  const changeNote = parsed.data.changeNote || null

  try {
    const course = await TrainingService.getCourseById(courseId)
    if (!course) return { error: 'Course not found.' }
    if (course.kind === 'external') return { error: 'An external qualification type has no course to publish.' }
    if (course.status === 'retired') return { error: 'This course is retired, so it cannot be published again.' }

    const versions = await TrainingService.listVersions(course.id)
    const latest = latestPublished(versions)
    const draft = await TrainingService.getDraftVersion(course.id)

    if (!draft) {
      // A publish that froze its version but stopped before the rest of it was done.
      if (latest && (await isUnfinishedPublish(course, latest))) {
        const frozen = await TrainingService.getVersion(latest.id)
        if (frozen) {
          const prerequisiteCheck = await checkPrerequisite(frozen.content, course.id)
          const result = await finishPublish({
            course,
            version: frozen,
            content: frozen.content,
            prerequisiteCourseId: prerequisiteCheck.loops ? null : (prerequisiteCheck.prerequisite?.id ?? null),
            // The change is the one that was frozen (1.0 is only ever a first publish), whichever
            // button is pressed to finish it.
            change: course.status === 'draft' || (frozen.major === 1 && frozen.minor === 0) ? 'first' : frozen.redoRequired ? 'redo' : 'minor',
            user,
          })
          return { success: true, data: result }
        }
      }
      return { error: 'There is no draft to publish. Upload the course first.' }
    }

    if (draftUploadedAt !== undefined && draftUploadedAt !== draft.uploadedAt) {
      return { error: 'The draft was replaced since you opened this page. Refresh, check the new draft, then publish it.' }
    }

    if (change === 'first' && latest) {
      return { error: `This course is already published (version ${versionLabel(latest)}). Choose a small change, or ask everyone to redo it.` }
    }
    if (change !== 'first' && !latest) return { error: 'This course has not been published yet. Publish it as the first version.' }
    if (change !== 'first' && !changeNote) return { error: 'Say what changed. The note is kept with the version.' }
    if (changeNote?.includes(LONG_DASH)) return { error: 'The change note contains a long dash. Use a comma, colon or brackets instead.' }

    const content = draft.content
    if (content.slug !== course.slug) {
      return {
        error: `The draft is for "${content.slug}" but this course is "${course.slug}". A course's slug never changes; upload it as a new course instead.`,
      }
    }
    if (latest && content.kind !== course.kind) {
      return { error: `This course is published as a ${course.kind} course and cannot change to ${content.kind}.` }
    }

    const validation = validateCourse(content, { mode: 'publish', availableImages: draft.images.map((image) => image.src) })
    if (!validation.ok) return { error: summariseErrors('This draft cannot be published yet.', validation.errors) }

    const prerequisiteCheck = await checkPrerequisite(content, course.id)
    if (prerequisiteCheck.problem) return { error: `This draft cannot be published yet. ${prerequisiteCheck.problem}.` }

    const number =
      change === 'first' || !latest
        ? { major: 1, minor: 0 }
        : change === 'minor'
          ? { major: latest.major as number, minor: (latest.minor as number) + 1 }
          : { major: (latest.major as number) + 1, minor: 0 }

    const version = await TrainingService.publishDraftVersion({
      courseId: course.id,
      draftVersionId: draft.id,
      major: number.major,
      minor: number.minor,
      changeNote,
      redoRequired: change === 'redo',
      // The draft that was checked above, so a draft replaced since is refused, not published.
      expectedUploadedAt: draft.uploadedAt,
      actor: actorOf(user),
    })

    const result = await finishPublish({
      course,
      version,
      content,
      prerequisiteCourseId: prerequisiteCheck.prerequisite?.id ?? null,
      change,
      user,
    })
    return { success: true, data: result }
  } catch (error) {
    return failure(error, 'publish course')
  }
}

/** training:publish. Retires a course and cancels its open cycles (`course_retired`); completed records stay. */
export async function retireTrainingCourse(input: { courseId: string }): Promise<TrainingActionResult<{ cancelled: number }>> {
  const user = await requireTrainingUser('publish')
  const parsed = z.object({ courseId: UuidSchema }).safeParse(input)
  if (!parsed.success) return { error: 'Course not found.' }
  const actor = actorOf(user)

  try {
    const course = await TrainingService.getCourseById(parsed.data.courseId)
    if (!course) return { error: 'Course not found.' }
    if (course.status === 'retired') return { success: true, data: { cancelled: 0 } }

    // Retiring a course another one needs first would leave that one waiting for ever.
    const dependants = (await TrainingService.listCourses()).filter(
      (other) => other.prerequisiteCourseId === course.id && other.id !== course.id && other.status !== 'retired'
    )
    if (dependants.length > 0) {
      return {
        error: `${dependants.map((other) => `"${other.title}"`).join(', ')} ${dependants.length === 1 ? 'needs' : 'need'} this course first. Change or retire ${dependants.length === 1 ? 'it' : 'them'} first.`,
      }
    }

    await TrainingService.updateCourse(course.id, { status: 'retired' })
    await TrainingService.writeEvent({
      eventType: 'course_retired',
      courseId: course.id,
      actor,
      meta: { slug: course.slug, previousStatus: course.status },
    })
    await logAuditEvent({
      user_id: user.id,
      ...(user.email ? { user_email: user.email } : {}),
      operation_type: 'retire',
      resource_type: 'training_course',
      resource_id: course.id,
      operation_status: 'success',
      additional_info: { slug: course.slug, previous_status: course.status },
    })
    revalidateCourse(course.slug)

    let sync: SyncResult
    try {
      sync = await TrainingService.syncAssignments({ actor })
    } catch (error) {
      console.error('Training sync after retiring a course failed:', error)
      return {
        error: 'The course is retired, but its open training could not be cancelled just now. Press Sync now, or the daily check will do it.',
      }
    }
    return { success: true, data: { cancelled: sync.cancelled } }
  } catch (error) {
    return failure(error, 'retire course')
  }
}

// ---------------------------------------------------------------------------------------------
// External qualification types
// ---------------------------------------------------------------------------------------------

/** `external-<name>`, in the slug alphabet, at most 60 characters. */
function externalSlugBase(title: string): string {
  const words = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = `external-${words || 'qualification'}`.slice(0, 60).replace(/-+$/g, '')
  return base
}

function withSuffix(base: string, n: number): string {
  if (n === 1) return base
  const suffix = `-${n}`
  return `${base.slice(0, 60 - suffix.length).replace(/-+$/g, '')}${suffix}`
}

/**
 * The due-day rule an external qualification type is created with. There is no column for the
 * `required` choice, so the service reads it from these (`courseAssignsAutomatically` in
 * src/services/training.ts): a required type carries the spec 4.3 rule for courses other than
 * essentials (14 days for a new starter, 28 for someone already working), so managers have that
 * long to record it; a type recorded by hand only has no rule at all.
 */
function externalDueDays(required: boolean): { newStarterDueDays: number | null; existingStaffDueDays: number | null } {
  return required ? { newStarterDueDays: 14, existingStaffDueDays: 28 } : { newStarterDueDays: null, existingStaffDueDays: null }
}

/**
 * training:publish. Adds an external qualification type (live straight away). `required: true`
 * assigns it to its groups for managers to record; `false` means it is recorded by hand only.
 */
export async function createExternalCourse(input: {
  title: string
  refresherMonths: number | null
  groups: TrainingGroup[]
  required: boolean
}): Promise<TrainingActionResult<{ courseId: string; slug: string }>> {
  const user = await requireTrainingUser('publish')
  const parsed = ExternalCourseSchema.safeParse(input)
  if (!parsed.success) return { error: firstIssue(parsed.error, 'Check the qualification details.') }
  const { title, refresherMonths, required } = parsed.data
  if (title.includes(LONG_DASH)) return { error: 'The name contains a long dash. Use a comma, colon or brackets instead.' }
  if (/\{\{|\}\}|\[\[|\]\]/.test(title)) return { error: 'The name cannot contain {{, }}, [[ or ]].' }
  const groups = TRAINING_GROUPS.filter((group) => parsed.data.groups.includes(group))
  const actor = actorOf(user)

  try {
    const base = externalSlugBase(title)
    let course: TrainingCourse | null = null
    for (let n = 1; n <= 50 && !course; n += 1) {
      const slug = withSuffix(base, n)
      if (await TrainingService.getCourseBySlug(slug)) continue
      try {
        course = await TrainingService.createCourse({
          slug,
          title,
          kind: 'external',
          audienceGroups: groups,
          audienceAge: 'all',
          isEssentials: false,
          prerequisiteCourseId: null,
          ...externalDueDays(required),
          refresherMonths,
          // 27 days for a one-month qualification (the window must end before the refresher is
          // due), 30 for anything longer.
          windowDays: defaultWindowDaysFor(refresherMonths),
          supervisedOnlyUnder18: false,
          status: 'live',
          summary: null,
          actor,
        })
      } catch (error) {
        // Someone took the slug between the check and the insert: try the next one.
        if (!(error instanceof TrainingError && error.code === 'conflict')) throw error
      }
    }
    if (!course) return { error: 'There are already too many qualification types with that name.' }

    await TrainingService.writeEvent({
      eventType: 'course_published',
      courseId: course.id,
      actor,
      meta: { slug: course.slug, kind: 'external', required, refresherMonths, groups: [...groups] },
    })
    await logAuditEvent({
      user_id: user.id,
      ...(user.email ? { user_email: user.email } : {}),
      operation_type: 'create',
      resource_type: 'training_course',
      resource_id: course.id,
      operation_status: 'success',
      additional_info: { slug: course.slug, kind: 'external', required, refresher_months: refresherMonths, groups },
    })

    if (required) {
      try {
        await TrainingService.syncAssignments({ actor })
      } catch (error) {
        console.error('Training sync after adding an external qualification type failed:', error)
      }
    }
    revalidateCourse(course.slug)
    return { success: true, data: { courseId: course.id, slug: course.slug } }
  } catch (error) {
    return failure(error, 'create external course')
  }
}

// ---------------------------------------------------------------------------------------------
// Download and preview (nothing is recorded)
// ---------------------------------------------------------------------------------------------

/** training:publish. A version's frozen `course.json` for download. */
export async function getCourseVersionJson(versionId: string): Promise<TrainingActionResult<{ fileName: string; json: string }>> {
  const user = await requireTrainingUser('publish')
  if (!UuidSchema.safeParse(versionId).success) return { error: 'Version not found.' }
  try {
    const version = await TrainingService.getVersion(versionId)
    if (!version) return { error: 'Version not found.' }
    const label = versionLabel(version)
    await logAuditEvent({
      user_id: user.id,
      ...(user.email ? { user_email: user.email } : {}),
      operation_type: 'export',
      resource_type: 'training_course',
      resource_id: version.courseId,
      operation_status: 'success',
      additional_info: { version_id: version.id, version: label, slug: version.content.slug },
    })
    return {
      success: true,
      data: { fileName: `${version.content.slug}-${label}.json`, json: `${JSON.stringify(version.content, null, 2)}\n` },
    }
  } catch (error) {
    return failure(error, 'download course json')
  }
}

/** training:publish. A version (draft or published) for the preview player. Nothing is recorded. */
export async function getCoursePreview(versionId: string): Promise<TrainingActionResult<PlayerCourseView>> {
  await requireTrainingUser('publish')
  if (!UuidSchema.safeParse(versionId).success) return { error: 'Version not found.' }
  try {
    const view = await TrainingService.getPlayerCourse(versionId)
    if (!view) return { error: 'Version not found.' }
    return { success: true, data: view }
  } catch (error) {
    return failure(error, 'preview course')
  }
}

async function loadPreviewSection(versionId: string, sectionKey: string): Promise<{ content: CourseContent; section: CourseSection } | { error: string }> {
  const version = await TrainingService.getVersion(versionId)
  if (!version) return { error: 'Version not found.' }
  const section = version.content.sections.find((candidate) => candidate.key === sectionKey)
  if (!section) return { error: 'That section is not in this version.' }
  return { content: version.content, section }
}

/** training:publish. Draws a check exactly as staff would get it. Nothing is recorded. */
export async function previewDraw(input: {
  versionId: string
  sectionKey: string
  previousQuestionIds: string[]
}): Promise<TrainingActionResult<PreviewDrawView>> {
  await requireTrainingUser('publish')
  const parsed = PreviewDrawSchema.safeParse(input)
  if (!parsed.success) return { error: 'That preview request was not valid.' }
  try {
    const loaded = await loadPreviewSection(parsed.data.versionId, parsed.data.sectionKey)
    if ('error' in loaded) return loaded
    const served = drawQuestions({ section: loaded.section, previousQuestionIds: parsed.data.previousQuestionIds })
    return { success: true, data: { served, questions: toCheckQuestionViews(loaded.section, served) } }
  } catch (error) {
    return failure(error, 'preview draw')
  }
}

/** training:publish. Marks a previewed check exactly as staff would be marked. Nothing is recorded. */
export async function previewScore(input: {
  versionId: string
  sectionKey: string
  served: ServedQuestion[]
  answers: Record<string, number>
}): Promise<TrainingActionResult<CheckResultView>> {
  await requireTrainingUser('publish')
  const parsed = PreviewScoreSchema.safeParse(input)
  if (!parsed.success) return { error: 'That preview answer was not valid.' }
  try {
    const loaded = await loadPreviewSection(parsed.data.versionId, parsed.data.sectionKey)
    if ('error' in loaded) return loaded
    const { section, content } = loaded
    const served: ServedQuestion[] = parsed.data.served
    const outcome = scoreAttempt({ section, served, answers: parsed.data.answers })
    const isLast = content.sections[content.sections.length - 1]?.key === section.key
    return {
      success: true,
      data: {
        passed: outcome.passed,
        wrongCount: outcome.wrongCount,
        criticalMissed: outcome.criticalMissed,
        maxWrong: section.check.maxWrong,
        results: toCheckResultItems(section, served, outcome),
        // A preview never locks: the person checking the course can try as often as they like.
        next: outcome.passed ? (isLast ? 'confirm' : 'next_section') : 'retry',
      },
    }
  } catch (error) {
    return failure(error, 'preview score')
  }
}

// ---------------------------------------------------------------------------------------------
// The training emails switch
// ---------------------------------------------------------------------------------------------

// The switch itself lives in src/app/actions/training-settings.ts and src/lib/training/settings.ts
// (stage B6). These two keep the names this file has always offered and hand straight over, so
// there is one implementation.

/** training:view. Whether staff reminder emails and the manager training email are switched on (default off). */
export async function getTrainingEmailsEnabled(): Promise<TrainingActionResult<{ enabled: boolean }>> {
  const result = await getTrainingEmailsSwitch()
  if (!result.data) return { error: result.error ?? 'The training emails setting could not be read. Please try again.' }
  return { success: true, data: { enabled: result.data.enabled } }
}

/** training:publish. Switches staff reminder emails and the manager training email on or off. */
export async function setTrainingEmailsEnabled(input: { enabled: boolean }): Promise<TrainingActionResult<{ enabled: boolean }>> {
  return setTrainingEmailsSwitch(input)
}
