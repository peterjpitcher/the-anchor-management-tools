import { describe, expect, it, vi } from 'vitest'
import {
  getRecruitmentCvMaxBytes,
  parseRecruitmentCv,
  validateRecruitmentCvUpload,
} from '@/lib/recruitment/files'
import type { RecruitmentCvUpload } from '@/types/recruitment'

vi.mock('word-extractor', () => ({
  default: class MockWordExtractor {
    async extract(buffer: Buffer) {
      if (buffer.toString() === 'empty doc') {
        return {
          getBody: () => '',
        }
      }

      return {
        getBody: () => 'David Applicant\r\n7 years bar work',
        getHeaders: () => 'david@example.com',
        getFooters: () => '',
        getFootnotes: () => '',
        getEndnotes: () => '',
        getAnnotations: () => '',
        getTextboxes: () => '07700 900123',
      }
    }
  },
}))

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

async function odtBuffer(text: string[]): Promise<Buffer> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  zip.file('mimetype', 'application/vnd.oasis.opendocument.text', { compression: 'STORE' })
  zip.file(
    'content.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
    <office:document-content
      xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
      <office:body><office:text>${text.map(line => `<text:p>${line}</text:p>`).join('')}</office:text></office:body>
    </office:document-content>`
  )
  zip.file('META-INF/manifest.xml', '')
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/vnd.oasis.opendocument.text' })
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

    expect(result).toBe('Please upload a PDF, DOC, DOCX, TXT, RTF or ODT CV.')
  })

  it('rejects files whose content does not match their extension', () => {
    const result = validateRecruitmentCvUpload(upload({
      fileName: 'candidate.pdf',
      mimeType: 'application/pdf',
    }))

    expect(result).toBe('The uploaded CV content does not match its file type.')
  })

  it('rejects public uploads larger than the configured limit', () => {
    const result = validateRecruitmentCvUpload(upload({
      sizeBytes: 5 * 1024 * 1024 + 1,
    }), {
      maxBytes: 5 * 1024 * 1024,
    })

    expect(result).toBe('Please upload a CV smaller than 5MB.')
  })

  it('extracts text from legacy DOC files', async () => {
    const result = await parseRecruitmentCv(upload({
      fileName: 'candidate.doc',
      mimeType: 'application/msword',
    }))

    expect(result).toEqual({
      status: 'done',
      text: 'David Applicant\n7 years bar work\ndavid@example.com\n07700 900123',
    })
  })

  it('flags legacy DOC files with no extractable text', async () => {
    const buffer = Buffer.from('empty doc')
    const result = await parseRecruitmentCv(upload({
      buffer,
      fileName: 'candidate.doc',
      mimeType: 'application/msword',
      sizeBytes: buffer.byteLength,
    }))

    expect(result).toEqual({
      status: 'unsupported',
      text: null,
      error: 'No extractable text found in DOC',
    })
  })

  it('extracts plain text CVs', async () => {
    const buffer = Buffer.from('David Applicant\r\nBar staff')
    const result = await parseRecruitmentCv(upload({
      buffer,
      fileName: 'candidate.txt',
      mimeType: 'text/plain',
      sizeBytes: buffer.byteLength,
    }))

    expect(result).toEqual({
      status: 'done',
      text: 'David Applicant\nBar staff',
    })
  })

  it('extracts RTF CVs', async () => {
    const buffer = Buffer.from('{\\rtf1\\ansi David Applicant\\par Bar staff}')
    const result = await parseRecruitmentCv(upload({
      buffer,
      fileName: 'candidate.rtf',
      mimeType: 'application/rtf',
      sizeBytes: buffer.byteLength,
    }))

    expect(result).toEqual({
      status: 'done',
      text: 'David Applicant\nBar staff',
    })
  })

  it('extracts ODT CVs', async () => {
    const buffer = await odtBuffer(['David Applicant', 'Bar staff'])
    const result = await parseRecruitmentCv(upload({
      buffer,
      fileName: 'candidate.odt',
      mimeType: 'application/vnd.oasis.opendocument.text',
      sizeBytes: buffer.byteLength,
    }))

    expect(result).toEqual({
      status: 'done',
      text: 'David Applicant\nBar staff',
    })
  })
})
