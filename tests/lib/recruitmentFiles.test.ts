import { describe, expect, it } from 'vitest'
import {
  getRecruitmentCvMaxBytes,
  parseRecruitmentCv,
  validateRecruitmentCvUpload,
} from '@/lib/recruitment/files'
import type { RecruitmentCvUpload } from '@/types/recruitment'

function upload(overrides: Partial<RecruitmentCvUpload> = {}): RecruitmentCvUpload {
  const buffer = Buffer.from('candidate cv')
  return {
    buffer,
    fileName: 'candidate.pdf',
    mimeType: 'application/pdf',
    sizeBytes: buffer.byteLength,
    ...overrides,
  }
}

describe('recruitment CV files', () => {
  it('uses the public and admin CV size defaults from the spec', () => {
    delete process.env.RECRUITMENT_CV_MAX_BYTES_PUBLIC
    delete process.env.RECRUITMENT_CV_MAX_BYTES_ADMIN

    expect(getRecruitmentCvMaxBytes('public')).toBe(5 * 1024 * 1024)
    expect(getRecruitmentCvMaxBytes('admin')).toBe(10 * 1024 * 1024)
  })

  it('rejects unsupported file extensions before storage or AI work', () => {
    const result = validateRecruitmentCvUpload(upload({
      fileName: 'malware.exe',
      mimeType: 'application/octet-stream',
    }))

    expect(result).toBe('Please upload a PDF, DOC or DOCX CV.')
  })

  it('rejects public uploads larger than the configured limit', () => {
    const result = validateRecruitmentCvUpload(upload({
      sizeBytes: 5 * 1024 * 1024 + 1,
    }), {
      maxBytes: 5 * 1024 * 1024,
    })

    expect(result).toBe('Please upload a CV smaller than 5MB.')
  })

  it('stores legacy DOC files for manual review instead of pretending to parse them', async () => {
    const result = await parseRecruitmentCv(upload({
      fileName: 'candidate.doc',
      mimeType: 'application/msword',
    }))

    expect(result).toEqual({
      status: 'unsupported',
      text: null,
      error: 'DOC parsing is not supported yet; file stored for manual review.',
    })
  })
})
