import { createHash, randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { TrainingError, type VersionImage } from './types'
import { COURSE_IMAGE_MAX_BYTES, EXTERNAL_CERTIFICATE_MAX_BYTES } from './upload-limits'

// The size limits live in ./upload-limits so the browser forms can use the same numbers.
export { COURSE_IMAGE_MAX_BYTES, EXTERNAL_CERTIFICATE_MAX_BYTES }

/**
 * The private `training` bucket (build contract section 2.1, "Storage"): course images and
 * external certificate files. No storage policies; the service role reads and writes, and app
 * routes stream files to people who may see them. Server only (uses the admin client).
 *
 * Paths: `courses/<courseId>/<sha256>.<ext>` for images, `external/<employeeId>/<uuid>.<ext>` for
 * external certificates. Uploads never overwrite (`upsert: false`); an image already stored under
 * its fingerprint is reused. There is no delete for an external certificate file.
 *
 * A file's type is read from its own first bytes, never taken on trust from the browser or the
 * file name, so an SVG (which can carry script) or a renamed file is refused.
 */

export const TRAINING_BUCKET = 'training'

/** Course image types, by content type, with the extensions each may use (matches course-schema.ts). */
const COURSE_IMAGE_CONTENT_TYPES: Record<string, readonly string[]> = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/gif': ['gif'],
}

/** External certificate types (contract 5.2: pdf, jpg, png), by content type, with the stored extension. */
const EXTERNAL_CERTIFICATE_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

/** The extension a stored image gets for its type: one per type, so one picture is one object. */
const STORED_IMAGE_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Content types by stored extension, for serving. */
const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const COURSE_IMAGE_PATH = /^courses\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{64}\.(jpg|png|webp|gif)$/
const EXTERNAL_FILE_PATH =
  /^external\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/

/** Megabytes to one decimal place, for messages. */
export function formatMegabytes(bytes: number): string {
  return `${(Math.round((bytes / (1024 * 1024)) * 10) / 10).toFixed(1)} MB`
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false
  return signature.every((value, index) => bytes[offset + index] === value)
}

/**
 * The image type the bytes really are (jpg, png, webp or gif), or null for anything else,
 * including SVG and other text formats.
 */
export function detectImageType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  // GIF87a or GIF89a.
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) {
    return 'image/gif'
  }
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

/** The external certificate type the bytes really are (pdf, jpg or png), or null. */
export function detectCertificateType(bytes: Uint8Array): string | null {
  // %PDF-
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  const image = detectImageType(bytes)
  return image === 'image/jpeg' || image === 'image/png' ? image : null
}

/** A browser's claimed type, tidied; blank and the generic binary type count as no claim. */
function normaliseClaimedType(contentType: string | null | undefined): string | null {
  const value = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (!value || value === 'application/octet-stream') return null
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg'
  return value
}

function fileExtension(name: string): string {
  const base = name.split('/').pop() ?? name
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : ''
}

/** `courses/<courseId>/<sha256>.<ext>`. */
export function courseImagePath(courseId: string, sha256: string, extension: string): string {
  const ext = extension.toLowerCase() === 'jpeg' ? 'jpg' : extension.toLowerCase()
  if (!UUID_PATTERN.test(courseId)) throw new TrainingError('invalid', 'That course id is not valid.')
  if (!SHA256_PATTERN.test(sha256)) throw new TrainingError('invalid', 'That image fingerprint is not valid.')
  if (!Object.values(STORED_IMAGE_EXTENSION).includes(ext)) {
    throw new TrainingError('invalid', `".${extension}" is not an image type a course can use.`)
  }
  return `courses/${courseId.toLowerCase()}/${sha256}.${ext}`
}

/** `external/<employeeId>/<fileId>.<ext>`. */
export function externalCertificatePath(employeeId: string, fileId: string, extension: string): string {
  const ext = extension.toLowerCase() === 'jpeg' ? 'jpg' : extension.toLowerCase()
  if (!UUID_PATTERN.test(employeeId)) throw new TrainingError('invalid', 'That employee id is not valid.')
  if (!UUID_PATTERN.test(fileId)) throw new TrainingError('invalid', 'That file id is not valid.')
  if (!Object.values(EXTERNAL_CERTIFICATE_CONTENT_TYPES).includes(ext)) {
    throw new TrainingError('invalid', `".${extension}" is not a certificate type we can keep.`)
  }
  return `external/${employeeId.toLowerCase()}/${fileId.toLowerCase()}.${ext}`
}

/** Lower-case hex SHA-256 of the bytes. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

interface StorageErrorLike {
  message?: string
  status?: number | string
  statusCode?: number | string
}

function isAlreadyExistsError(error: StorageErrorLike | null): boolean {
  if (!error) return false
  return String(error.statusCode ?? '') === '409' || String(error.status ?? '') === '409' || /already exists|duplicate/i.test(error.message ?? '')
}

function isNotFoundError(error: StorageErrorLike | null): boolean {
  if (!error) return false
  return String(error.statusCode ?? '') === '404' || String(error.status ?? '') === '404' || /not.?found/i.test(error.message ?? '')
}

/**
 * Stores bytes at a path that is unique to their content. A path already taken holds the same
 * bytes (it is named by their fingerprint, or by a fresh random id), so "already exists" is a
 * success, not a failure.
 */
async function putObject(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin.storage.from(TRAINING_BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (error && !isAlreadyExistsError(error)) {
    throw new Error(`Could not store the training file: ${error.message ?? 'unknown storage error'}`)
  }
}

/**
 * Stores one course image under its fingerprint and returns the record frozen with the version.
 * Refuses (TrainingError 'invalid') a type outside COURSE_IMAGE_CONTENT_TYPES, an extension that
 * does not match `src`, or a file over COURSE_IMAGE_MAX_BYTES.
 */
export async function uploadCourseImage(input: {
  courseId: string
  /** The path the course file uses, e.g. `images/cover.jpg`. */
  src: string
  bytes: Uint8Array
  contentType: string
}): Promise<VersionImage> {
  const { courseId, src, bytes } = input
  const problem = courseImageProblem({ src, bytes, contentType: input.contentType })
  if (problem) throw new TrainingError('invalid', problem)

  const contentType = detectImageType(bytes) as string
  const sha256 = sha256Hex(bytes)
  const path = courseImagePath(courseId, sha256, STORED_IMAGE_EXTENSION[contentType])
  await putObject(path, bytes, contentType)
  return { src, path, sha256, contentType, bytes: bytes.byteLength }
}

/**
 * Why an image cannot go in a course, in words for the person uploading, or null when it can.
 * The upload action calls this for every image before anything is saved, so one bad picture
 * stops the whole upload; `uploadCourseImage` calls it again before storing.
 */
export function courseImageProblem(input: { src: string; bytes: Uint8Array; contentType?: string | null }): string | null {
  const { src, bytes } = input
  const extension = fileExtension(src)
  if (extension === 'svg' || extension === 'svgz') {
    return `Image "${src}" is an SVG. SVG images are not allowed because they can carry script; use png, jpg, webp or gif`
  }
  if (bytes.byteLength === 0) return `Image "${src}" is empty`
  if (bytes.byteLength > COURSE_IMAGE_MAX_BYTES) {
    return `Image "${src}" is ${formatMegabytes(bytes.byteLength)}; the most an image can be is ${formatMegabytes(COURSE_IMAGE_MAX_BYTES)}`
  }
  const detected = detectImageType(bytes)
  if (!detected) return `Image "${src}" is not a png, jpg, webp or gif picture (SVG is not allowed)`
  if (!COURSE_IMAGE_CONTENT_TYPES[detected].includes(extension)) {
    return `Image "${src}" is really a ${STORED_IMAGE_EXTENSION[detected]} file; rename it to end .${STORED_IMAGE_EXTENSION[detected]} in the folder and in course.json`
  }
  const claimed = normaliseClaimedType(input.contentType)
  if (claimed && claimed !== detected) {
    return `Image "${src}" says it is ${claimed} but it is really ${detected}`
  }
  return null
}

/**
 * Stores an external certificate file and returns its bucket path and fingerprint. Refuses
 * (TrainingError 'invalid') a type outside EXTERNAL_CERTIFICATE_CONTENT_TYPES or a file over
 * EXTERNAL_CERTIFICATE_MAX_BYTES. The content type is checked against the file's own bytes, not
 * only the browser's claim.
 */
export async function uploadExternalCertificate(input: {
  employeeId: string
  bytes: Uint8Array
  contentType: string
}): Promise<{ path: string; sha256: string; contentType: string; bytes: number }> {
  const { employeeId, bytes } = input
  if (bytes.byteLength === 0) throw new TrainingError('invalid', 'The certificate file is empty.')
  if (bytes.byteLength > EXTERNAL_CERTIFICATE_MAX_BYTES) {
    throw new TrainingError(
      'invalid',
      `The certificate file is ${formatMegabytes(bytes.byteLength)}; the most it can be is ${formatMegabytes(EXTERNAL_CERTIFICATE_MAX_BYTES)}.`
    )
  }
  const detected = detectCertificateType(bytes)
  if (!detected) throw new TrainingError('invalid', 'The certificate must be a PDF, JPG or PNG file.')
  const claimed = normaliseClaimedType(input.contentType)
  if (claimed && claimed !== detected) {
    throw new TrainingError('invalid', 'The certificate file is not the type it says it is. Save it again as a PDF, JPG or PNG.')
  }

  const contentType = detected
  const path = externalCertificatePath(employeeId, randomUUID(), EXTERNAL_CERTIFICATE_CONTENT_TYPES[contentType])
  await putObject(path, bytes, contentType)
  return { path, sha256: sha256Hex(bytes), contentType, bytes: bytes.byteLength }
}

/** Throws unless `path` is one of the two shapes this bucket holds (no other path is ever read). */
function assertTrainingPath(path: string): void {
  if (!COURSE_IMAGE_PATH.test(path) && !EXTERNAL_FILE_PATH.test(path)) {
    throw new TrainingError('invalid', 'That is not a training file.')
  }
}

/** Reads one object from the bucket. Throws a TrainingError 'not_found' when it is missing. */
export async function downloadTrainingObject(path: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  assertTrainingPath(path)
  const admin = createAdminClient()
  const { data, error } = await admin.storage.from(TRAINING_BUCKET).download(path)
  if (error) {
    if (isNotFoundError(error)) throw new TrainingError('not_found', 'That training file could not be found.')
    throw new Error(`Could not read the training file: ${error.message ?? 'unknown storage error'}`)
  }
  if (!data) throw new TrainingError('not_found', 'That training file could not be found.')
  const bytes = new Uint8Array(await data.arrayBuffer())
  // The type comes from the extension this module chose when it stored the file.
  const contentType = CONTENT_TYPE_BY_EXTENSION[fileExtension(path)] ?? 'application/octet-stream'
  return { bytes, contentType }
}

/** A file name safe for a Content-Disposition header: letters, digits, dot, dash and underscore. */
function safeFileName(name: string, fallbackExtension: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 100)
  if (cleaned) return cleaned
  return fallbackExtension ? `training-file.${fallbackExtension}` : 'training-file'
}

/**
 * A response that streams one object to the browser with `Cache-Control: private` (and
 * `no-store` for certificates), `X-Content-Type-Options: nosniff`, and an inline or attachment
 * disposition with a safe file name. The route has already checked who may see it. A missing
 * object is a plain 404; any other storage failure throws.
 */
export async function trainingObjectResponse(
  path: string,
  options?: { fileName?: string; disposition?: 'inline' | 'attachment'; cache?: 'private' | 'no-store' }
): Promise<Response> {
  let object: { bytes: Uint8Array; contentType: string }
  try {
    object = await downloadTrainingObject(path)
  } catch (error) {
    if (error instanceof TrainingError && (error.code === 'not_found' || error.code === 'invalid')) {
      return new Response('Not found', {
        status: 404,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      })
    }
    throw error
  }

  const extension = fileExtension(path)
  const cache = options?.cache ?? (path.startsWith('external/') ? 'no-store' : 'private')
  const fileName = safeFileName(options?.fileName ?? (path.split('/').pop() ?? ''), extension)
  const disposition = options?.disposition ?? 'inline'
  // Copied into a fresh ArrayBuffer so the body type is exact for every runtime.
  const body = new Uint8Array(object.bytes.byteLength)
  body.set(object.bytes)

  return new Response(body.buffer, {
    status: 200,
    headers: {
      'Content-Type': object.contentType,
      'Content-Length': String(object.bytes.byteLength),
      // Images are named by their fingerprint, so a private copy can be kept for a while; a
      // certificate is personal and never kept.
      'Cache-Control': cache === 'no-store' ? 'private, no-store' : 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${disposition}; filename="${fileName}"`,
    },
  })
}
