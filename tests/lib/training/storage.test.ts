// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => {
  const upload = vi.fn()
  const download = vi.fn()
  const from = vi.fn(() => ({ upload, download }))
  return { upload, download, from }
})

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({ storage: { from: storage.from } })),
}))

import {
  COURSE_IMAGE_MAX_BYTES,
  EXTERNAL_CERTIFICATE_MAX_BYTES,
  TRAINING_BUCKET,
  courseImagePath,
  courseImageProblem,
  detectCertificateType,
  detectImageType,
  downloadTrainingObject,
  externalCertificatePath,
  sha256Hex,
  trainingObjectResponse,
  uploadCourseImage,
  uploadExternalCertificate,
} from '@/lib/training/storage'
import { TrainingError } from '@/lib/training/types'

const COURSE_ID = '6f1c2d3e-4a5b-4c6d-8e7f-901234567890'
const EMPLOYEE_ID = '0a1b2c3d-4e5f-4a6b-8c7d-112233445566'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0])
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38])
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n')
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function sizedPng(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes)
  out.set(PNG)
  return out
}

beforeEach(() => {
  vi.clearAllMocks()
  storage.upload.mockResolvedValue({ data: { path: 'x' }, error: null })
})

describe('reading a file type from its bytes', () => {
  it('knows png, jpg, gif and webp, and nothing else', () => {
    expect(detectImageType(PNG)).toBe('image/png')
    expect(detectImageType(JPEG)).toBe('image/jpeg')
    expect(detectImageType(GIF)).toBe('image/gif')
    expect(detectImageType(WEBP)).toBe('image/webp')
    expect(detectImageType(SVG)).toBeNull()
    expect(detectImageType(PDF)).toBeNull()
    expect(detectImageType(new Uint8Array())).toBeNull()
  })

  it('takes certificates as pdf, jpg or png only', () => {
    expect(detectCertificateType(PDF)).toBe('application/pdf')
    expect(detectCertificateType(JPEG)).toBe('image/jpeg')
    expect(detectCertificateType(PNG)).toBe('image/png')
    expect(detectCertificateType(GIF)).toBeNull()
    expect(detectCertificateType(SVG)).toBeNull()
  })
})

describe('paths and fingerprints', () => {
  it('builds the two path shapes and refuses anything that could leave them', () => {
    const sha = sha256Hex(PNG)
    expect(sha).toMatch(/^[0-9a-f]{64}$/)
    expect(courseImagePath(COURSE_ID, sha, 'PNG')).toBe(`courses/${COURSE_ID}/${sha}.png`)
    expect(courseImagePath(COURSE_ID, sha, 'jpeg')).toBe(`courses/${COURSE_ID}/${sha}.jpg`)
    expect(externalCertificatePath(EMPLOYEE_ID, COURSE_ID, 'pdf')).toBe(`external/${EMPLOYEE_ID}/${COURSE_ID}.pdf`)
    expect(() => courseImagePath('../etc', sha, 'png')).toThrow(TrainingError)
    expect(() => courseImagePath(COURSE_ID, 'not-a-sha', 'png')).toThrow(TrainingError)
    expect(() => courseImagePath(COURSE_ID, sha, 'svg')).toThrow(TrainingError)
    expect(() => externalCertificatePath(EMPLOYEE_ID, 'x/../y', 'pdf')).toThrow(TrainingError)
    expect(() => externalCertificatePath(EMPLOYEE_ID, COURSE_ID, 'gif')).toThrow(TrainingError)
  })

  it('fingerprints are SHA-256 in lower-case hex', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('courseImageProblem', () => {
  it('passes a real image whose name matches its type', () => {
    expect(courseImageProblem({ src: 'images/cover.png', bytes: PNG, contentType: 'image/png' })).toBeNull()
    expect(courseImageProblem({ src: 'images/cover.jpeg', bytes: JPEG })).toBeNull()
    expect(courseImageProblem({ src: 'images/cover.jpg', bytes: JPEG, contentType: 'image/jpg' })).toBeNull()
  })

  it('refuses SVG by name and by bytes', () => {
    expect(courseImageProblem({ src: 'images/logo.svg', bytes: SVG })).toMatch(/SVG images are not allowed/)
    expect(courseImageProblem({ src: 'images/logo.png', bytes: SVG })).toMatch(/not a png, jpg, webp or gif/)
  })

  it('refuses a renamed file, a false claim, an empty file and one over 4 MB', () => {
    expect(courseImageProblem({ src: 'images/cover.png', bytes: JPEG })).toMatch(/really a jpg file/)
    expect(courseImageProblem({ src: 'images/cover.png', bytes: PNG, contentType: 'image/webp' })).toMatch(/says it is image\/webp/)
    expect(courseImageProblem({ src: 'images/cover.png', bytes: new Uint8Array() })).toMatch(/is empty/)
    expect(courseImageProblem({ src: 'images/big.png', bytes: sizedPng(COURSE_IMAGE_MAX_BYTES + 1) })).toMatch(/the most an image can be is 4\.0 MB/)
    expect(courseImageProblem({ src: 'images/ok.png', bytes: sizedPng(COURSE_IMAGE_MAX_BYTES) })).toBeNull()
  })
})

describe('uploadCourseImage', () => {
  it('stores the image under its fingerprint, never overwriting, and returns the frozen record', async () => {
    const record = await uploadCourseImage({ courseId: COURSE_ID, src: 'images/cover.png', bytes: PNG, contentType: 'image/png' })
    const sha = sha256Hex(PNG)
    expect(record).toEqual({ src: 'images/cover.png', path: `courses/${COURSE_ID}/${sha}.png`, sha256: sha, contentType: 'image/png', bytes: PNG.byteLength })
    expect(storage.from).toHaveBeenCalledWith(TRAINING_BUCKET)
    expect(storage.upload).toHaveBeenCalledWith(`courses/${COURSE_ID}/${sha}.png`, PNG, { contentType: 'image/png', upsert: false })
  })

  it('treats an image already stored under the same fingerprint as stored', async () => {
    storage.upload.mockResolvedValue({ data: null, error: { message: 'The resource already exists', statusCode: '409' } })
    await expect(uploadCourseImage({ courseId: COURSE_ID, src: 'a.png', bytes: PNG, contentType: '' })).resolves.toMatchObject({ contentType: 'image/png' })
  })

  it('throws on any other storage failure, and refuses a bad image before storage is touched', async () => {
    storage.upload.mockResolvedValue({ data: null, error: { message: 'bucket not found', statusCode: '404' } })
    await expect(uploadCourseImage({ courseId: COURSE_ID, src: 'a.png', bytes: PNG, contentType: '' })).rejects.toThrow(/Could not store/)

    storage.upload.mockClear()
    await expect(uploadCourseImage({ courseId: COURSE_ID, src: 'a.png', bytes: SVG, contentType: 'image/svg+xml' })).rejects.toBeInstanceOf(TrainingError)
    expect(storage.upload).not.toHaveBeenCalled()
  })
})

describe('uploadExternalCertificate', () => {
  it('stores a pdf under a fresh id for the person', async () => {
    const stored = await uploadExternalCertificate({ employeeId: EMPLOYEE_ID, bytes: PDF, contentType: 'application/pdf' })
    expect(stored.path).toMatch(new RegExp(`^external/${EMPLOYEE_ID}/[0-9a-f-]{36}\\.pdf$`))
    expect(stored).toMatchObject({ sha256: sha256Hex(PDF), contentType: 'application/pdf', bytes: PDF.byteLength })
    expect(storage.upload).toHaveBeenCalledWith(stored.path, PDF, { contentType: 'application/pdf', upsert: false })
  })

  it('checks the bytes, not just the claim, and the size', async () => {
    await expect(uploadExternalCertificate({ employeeId: EMPLOYEE_ID, bytes: SVG, contentType: 'application/pdf' })).rejects.toThrow(/PDF, JPG or PNG/)
    await expect(uploadExternalCertificate({ employeeId: EMPLOYEE_ID, bytes: PDF, contentType: 'image/png' })).rejects.toThrow(/not the type it says/)
    const big = new Uint8Array(EXTERNAL_CERTIFICATE_MAX_BYTES + 1)
    big.set(PDF)
    await expect(uploadExternalCertificate({ employeeId: EMPLOYEE_ID, bytes: big, contentType: 'application/pdf' })).rejects.toThrow(/the most it can be is 4\.0 MB/)
    expect(storage.upload).not.toHaveBeenCalled()
  })
})

describe('reading and serving', () => {
  const imagePath = `courses/${COURSE_ID}/${sha256Hex(PNG)}.png`

  it('refuses paths outside the two shapes without asking storage', async () => {
    await expect(downloadTrainingObject('courses/../../secrets.txt')).rejects.toMatchObject({ code: 'invalid' })
    await expect(downloadTrainingObject('signed-documents/x.pdf')).rejects.toMatchObject({ code: 'invalid' })
    expect(storage.download).not.toHaveBeenCalled()
  })

  it('says not found for a missing object and throws for anything else', async () => {
    storage.download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found', statusCode: '404' } })
    await expect(downloadTrainingObject(imagePath)).rejects.toMatchObject({ code: 'not_found' })
    storage.download.mockResolvedValueOnce({ data: null, error: { message: 'timeout', statusCode: '500' } })
    await expect(downloadTrainingObject(imagePath)).rejects.toThrow(/Could not read/)
  })

  it('serves an image privately with nosniff and a safe name', async () => {
    storage.download.mockResolvedValueOnce({ data: new Blob([PNG], { type: 'text/html' }), error: null })
    const response = await trainingObjectResponse(imagePath, { fileName: 'cover "1".png' })
    expect(response.status).toBe(200)
    // The type comes from the stored extension, never from what storage says.
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=3600')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="cover-1-.png"')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('never caches a certificate and answers 404 for a missing one', async () => {
    const certificatePath = `external/${EMPLOYEE_ID}/${COURSE_ID}.pdf`
    storage.download.mockResolvedValueOnce({ data: new Blob([PDF]), error: null })
    const response = await trainingObjectResponse(certificatePath, { disposition: 'attachment', fileName: 'Level 2.pdf' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Level-2.pdf"')

    storage.download.mockResolvedValueOnce({ data: null, error: { message: 'Object not found', statusCode: '404' } })
    const missing = await trainingObjectResponse(certificatePath)
    expect(missing.status).toBe(404)
    expect(missing.headers.get('Cache-Control')).toBe('no-store')
  })
})
