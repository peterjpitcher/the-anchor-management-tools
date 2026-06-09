import crypto from 'crypto'
import type { RecruitmentCvUpload } from '@/types/recruitment'

const PDF_MIME = 'application/pdf'
const DOC_MIME = 'application/msword'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx'])
const ALLOWED_MIME_TYPES = new Set([PDF_MIME, DOC_MIME, DOCX_MIME, 'application/octet-stream'])

export const RECRUITMENT_CV_BUCKET = 'recruitment-cvs'

export type RecruitmentFileValidationOptions = {
  maxBytes?: number
}

export type RecruitmentParsedCv =
  | { status: 'done'; text: string }
  | { status: 'unsupported' | 'failed'; text: null; error: string }

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

export function getRecruitmentCvMaxBytes(kind: 'public' | 'admin'): number {
  const envKey = kind === 'public' ? 'RECRUITMENT_CV_MAX_BYTES_PUBLIC' : 'RECRUITMENT_CV_MAX_BYTES_ADMIN'
  const fallback = kind === 'public' ? 5 * 1024 * 1024 : 10 * 1024 * 1024
  const parsed = Number.parseInt(process.env[envKey] ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function validateRecruitmentCvUpload(
  upload: RecruitmentCvUpload,
  options: RecruitmentFileValidationOptions = {}
): string | null {
  const maxBytes = options.maxBytes ?? getRecruitmentCvMaxBytes('admin')
  const extension = getExtension(upload.fileName)

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return 'Please upload a PDF, DOC or DOCX CV.'
  }

  if (!ALLOWED_MIME_TYPES.has(upload.mimeType || 'application/octet-stream')) {
    return 'Please upload a PDF, DOC or DOCX CV.'
  }

  if (upload.sizeBytes <= 0) {
    return 'The uploaded CV is empty.'
  }

  if (upload.sizeBytes > maxBytes) {
    return `Please upload a CV smaller than ${Math.round(maxBytes / 1024 / 1024)}MB.`
  }

  return null
}

export function buildRecruitmentCvStoragePath(candidateId: string, upload: RecruitmentCvUpload): string {
  const extension = getExtension(upload.fileName) || '.bin'
  const fileHash = crypto.createHash('sha256').update(upload.buffer).digest('hex').slice(0, 16)
  return `candidates/${candidateId}/${Date.now()}-${fileHash}${extension}`
}

// Postgres text/jsonb columns cannot store NUL bytes and reject them with error
// 22P05 ("unsupported Unicode escape sequence"). Extracted PDF/DOCX text can
// contain NUL and other C0 control characters, so strip them before they reach
// the database, while preserving tab (charCode 9) and newline (charCode 10).
function stripDisallowedControlChars(value: string): string {
  let result = ''
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code > 31 || code === 9 || code === 10) {
      result += value[i]
    }
  }
  return result
}

function normaliseExtractedText(value: string): string {
  return stripDisallowedControlChars(value.replace(/\r/g, '\n'))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function parsePdf(buffer: Buffer): Promise<RecruitmentParsedCv> {
  try {
    const mod = await import('pdf2json') as any
    const PDFParser = mod.default ?? mod
    const parser = new PDFParser(null, true)

    const text = await new Promise<string>((resolve, reject) => {
      parser.on('pdfParser_dataError', (error: { parserError?: unknown }) => {
        reject(error.parserError ?? new Error('PDF parsing failed'))
      })
      parser.on('pdfParser_dataReady', (pdfData: unknown) => {
        try {
          const rawText = parser.getRawTextContent?.() ?? ''
          resolve(rawText || extractPdf2JsonPageText(pdfData))
        } catch (error) {
          reject(error)
        }
      })
      parser.parseBuffer(buffer)
    })

    const normalised = normaliseExtractedText(text)
    if (!normalised) {
      return { status: 'unsupported', text: null, error: 'No extractable text found in PDF' }
    }

    return { status: 'done', text: normalised }
  } catch (error) {
    return {
      status: 'failed',
      text: null,
      error: error instanceof Error ? error.message : 'PDF parsing failed',
    }
  }
}

function extractPdf2JsonPageText(pdfData: unknown): string {
  const root = pdfData as {
    Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }>
    formImage?: { Pages?: Array<{ Texts?: Array<{ R?: Array<{ T?: string }> }> }> }
  } | null
  const pages = root?.Pages ?? root?.formImage?.Pages ?? []

  return pages
    .flatMap(page => page.Texts ?? [])
    .map(text => (text.R ?? [])
      .map(run => {
        try {
          return decodeURIComponent(run.T ?? '')
        } catch {
          return run.T ?? ''
        }
      })
      .join('')
    )
    .join('\n')
}

async function parseDocx(buffer: Buffer): Promise<RecruitmentParsedCv> {
  try {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    const text = normaliseExtractedText(result.value || '')

    if (!text) {
      return { status: 'unsupported', text: null, error: 'No extractable text found in DOCX' }
    }

    return { status: 'done', text }
  } catch (error) {
    return {
      status: 'failed',
      text: null,
      error: error instanceof Error ? error.message : 'DOCX parsing failed',
    }
  }
}

export async function parseRecruitmentCv(upload: RecruitmentCvUpload): Promise<RecruitmentParsedCv> {
  const extension = getExtension(upload.fileName)

  if (extension === '.pdf' || upload.mimeType === PDF_MIME) {
    return parsePdf(upload.buffer)
  }

  if (extension === '.docx' || upload.mimeType === DOCX_MIME) {
    return parseDocx(upload.buffer)
  }

  return {
    status: 'unsupported',
    text: null,
    error: 'DOC parsing is not supported yet; file stored for manual review.',
  }
}
