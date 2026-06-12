import crypto from 'crypto'
import type { RecruitmentCvUpload } from '@/types/recruitment'

const PDF_MIME = 'application/pdf'
const DOC_MIME = 'application/msword'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TXT_MIME = 'text/plain'
const RTF_MIME_TYPES = new Set(['application/rtf', 'application/x-rtf', 'text/rtf', 'text/richtext'])
const ODT_MIME = 'application/vnd.oasis.opendocument.text'
const GENERIC_MIME_TYPES = new Set(['application/octet-stream', 'binary/octet-stream'])
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt'])
const ALLOWED_MIME_TYPES = new Set([PDF_MIME, DOC_MIME, DOCX_MIME, TXT_MIME, ODT_MIME, ...RTF_MIME_TYPES, ...GENERIC_MIME_TYPES])
const ALLOWED_FORMAT_LABEL = 'PDF, DOC, DOCX, TXT, RTF or ODT'

export const RECRUITMENT_CV_BUCKET = 'recruitment-cvs'

export type RecruitmentFileValidationOptions = {
  maxBytes?: number
}

export type RecruitmentParseOptions = {
  ocr?: boolean
}

export type RecruitmentParsedCv =
  | { status: 'done'; text: string }
  | { status: 'unsupported' | 'failed'; text: null; error: string }

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : ''
}

function hasBytes(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false
  return bytes.every((byte, index) => buffer[index] === byte)
}

function hasPdfSignature(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-'
}

function hasOleSignature(buffer: Buffer): boolean {
  return hasBytes(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
}

function hasZipSignature(buffer: Buffer): boolean {
  return hasBytes(buffer, [0x50, 0x4b, 0x03, 0x04])
    || hasBytes(buffer, [0x50, 0x4b, 0x05, 0x06])
    || hasBytes(buffer, [0x50, 0x4b, 0x07, 0x08])
}

function hasRtfSignature(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 64).toString('utf8').replace(/^\uFEFF/, '').trimStart()
  return sample.startsWith('{\\rtf')
}

function isLikelyText(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096))
  if (sample.includes(0)) return false
  return !sample.toString('utf8').includes('\uFFFD')
}

function contentMatchesExtension(extension: string, buffer: Buffer): boolean {
  if (extension === '.pdf') return hasPdfSignature(buffer)
  if (extension === '.doc') return hasOleSignature(buffer)
  if (extension === '.docx' || extension === '.odt') return hasZipSignature(buffer)
  if (extension === '.rtf') return hasRtfSignature(buffer)
  if (extension === '.txt') return isLikelyText(buffer)
  return false
}

export function getRecruitmentCvSha256(upload: RecruitmentCvUpload): string {
  return crypto.createHash('sha256').update(upload.buffer).digest('hex')
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
    return `Please upload a ${ALLOWED_FORMAT_LABEL} CV.`
  }

  const mimeType = upload.mimeType || 'application/octet-stream'
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `Please upload a ${ALLOWED_FORMAT_LABEL} CV.`
  }

  if (upload.sizeBytes <= 0) {
    return 'The uploaded CV is empty.'
  }

  if (upload.sizeBytes > maxBytes) {
    return `Please upload a CV smaller than ${Math.round(maxBytes / 1024 / 1024)}MB.`
  }

  if (!contentMatchesExtension(extension, upload.buffer)) {
    return 'The uploaded CV content does not match its file type.'
  }

  return null
}

export function buildRecruitmentCvStoragePath(candidateId: string, upload: RecruitmentCvUpload): string {
  const extension = getExtension(upload.fileName) || '.bin'
  const fileHash = crypto.createHash('sha256').update(upload.buffer).digest('hex').slice(0, 16)
  return `candidates/${candidateId}/${Date.now()}-${fileHash}${extension}`
}

// Postgres text/jsonb columns cannot store NUL bytes and reject them with error
// 22P05 ("unsupported Unicode escape sequence"). Extracted CV text can
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
  return stripDisallowedControlChars(value.replace(/\r\n?/g, '\n'))
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

async function parseOfficeText(
  buffer: Buffer,
  fileType: 'pdf' | 'rtf' | 'odt',
  options: { ocr?: boolean } = {}
): Promise<RecruitmentParsedCv> {
  try {
    const { OfficeParser, terminateOcr } = await import('officeparser')
    const ast = await OfficeParser.parseOffice(buffer, {
      fileType,
      newlineDelimiter: '\n',
      extractAttachments: options.ocr === true,
      ocr: options.ocr === true,
      ocrConfig: options.ocr === true
        ? {
            timeout: {
              workerLoad: 15_000,
              recognition: 15_000,
              autoTerminate: 5_000,
            },
          }
        : undefined,
    })
    const output = await ast.to('text', {
      textConfig: {
        newlineDelimiter: '\n',
        preserveLayout: false,
      },
    })
    const text = typeof output.value === 'string' ? normaliseExtractedText(output.value) : ''
    if (options.ocr === true) {
      await terminateOcr().catch(() => undefined)
    }

    if (!text) {
      return { status: 'unsupported', text: null, error: `No extractable text found in ${fileType.toUpperCase()}` }
    }

    return { status: 'done', text }
  } catch (error) {
    return {
      status: 'failed',
      text: null,
      error: error instanceof Error ? error.message : `${fileType.toUpperCase()} parsing failed`,
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

function parseTxt(buffer: Buffer): RecruitmentParsedCv {
  const text = normaliseExtractedText(buffer.toString('utf8').replace(/^\uFEFF/, ''))

  if (!text) {
    return { status: 'unsupported', text: null, error: 'No extractable text found in TXT' }
  }

  return { status: 'done', text }
}

type WordExtractorDocument = {
  getBody(): string
  getHeaders?(options?: { includeFooters?: boolean }): string
  getFooters?(): string
  getFootnotes?(): string
  getEndnotes?(): string
  getAnnotations?(): string
  getTextboxes?(options?: { includeHeadersAndFooters?: boolean; includeBody?: boolean }): string
}

function callDocumentPart(document: WordExtractorDocument, methodName: keyof WordExtractorDocument): string {
  const method = document[methodName]
  if (typeof method !== 'function') return ''

  try {
    const value = method.call(document)
    return typeof value === 'string' ? value : ''
  } catch {
    return ''
  }
}

async function parseDoc(buffer: Buffer): Promise<RecruitmentParsedCv> {
  try {
    const mod = await import('word-extractor')
    const WordExtractor = (mod.default ?? mod) as {
      new (): { extract(input: Buffer): Promise<WordExtractorDocument> }
    }
    const extractor = new WordExtractor()
    const document = await extractor.extract(buffer)
    const text = normaliseExtractedText([
      document.getBody(),
      callDocumentPart(document, 'getHeaders'),
      callDocumentPart(document, 'getFooters'),
      callDocumentPart(document, 'getFootnotes'),
      callDocumentPart(document, 'getEndnotes'),
      callDocumentPart(document, 'getAnnotations'),
      callDocumentPart(document, 'getTextboxes'),
    ].filter(Boolean).join('\n'))

    if (!text) {
      return { status: 'unsupported', text: null, error: 'No extractable text found in DOC' }
    }

    return { status: 'done', text }
  } catch (error) {
    return {
      status: 'failed',
      text: null,
      error: error instanceof Error ? error.message : 'DOC parsing failed',
    }
  }
}

export async function parseRecruitmentCv(
  upload: RecruitmentCvUpload,
  options: RecruitmentParseOptions = {}
): Promise<RecruitmentParsedCv> {
  const extension = getExtension(upload.fileName)

  if (extension === '.pdf' || upload.mimeType === PDF_MIME) {
    const parsed = await parsePdf(upload.buffer)
    if (parsed.status === 'unsupported' && options.ocr) {
      const ocrParsed = await parseOfficeText(upload.buffer, 'pdf', { ocr: true })
      if (ocrParsed.status === 'done') return ocrParsed
      return {
        status: ocrParsed.status,
        text: null,
        error: `No extractable PDF text found; OCR also failed: ${ocrParsed.error}`,
      }
    }
    return parsed
  }

  if (extension === '.docx' || upload.mimeType === DOCX_MIME) {
    return parseDocx(upload.buffer)
  }

  if (extension === '.doc' || upload.mimeType === DOC_MIME) {
    return parseDoc(upload.buffer)
  }

  if (extension === '.txt' || upload.mimeType === TXT_MIME) {
    return parseTxt(upload.buffer)
  }

  if (extension === '.rtf' || RTF_MIME_TYPES.has(upload.mimeType)) {
    return parseOfficeText(upload.buffer, 'rtf')
  }

  if (extension === '.odt' || upload.mimeType === ODT_MIME) {
    return parseOfficeText(upload.buffer, 'odt')
  }

  return {
    status: 'unsupported',
    text: null,
    error: 'Unsupported CV file type',
  }
}
