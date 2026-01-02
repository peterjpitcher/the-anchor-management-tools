import OpenAI from 'openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import mammoth from 'mammoth'
import { splitTextIntoChunks } from '@/lib/hiring/chunking'
import { extractResumeFacts, type ResumeFacts } from '@/lib/hiring/fact-extraction'

if (typeof window !== 'undefined') {
    throw new Error('Resume parsing must run on the server.')
}

export type ResumeTextPage = {
    page: number
    text: string
    source: 'pdf_text' | 'vision_ocr' | 'docx' | 'image' | 'text' | 'manual'
}

export type TimelineEvidenceQuote = {
    quote: string
    anchor: string
}

export type EmploymentTimelineEntry = {
    employer?: string
    titles: string[]
    start_date?: string
    end_date?: string
    is_hospitality?: boolean
    is_bar_role?: boolean
    bullets?: string[]
    evidence_quotes: TimelineEvidenceQuote[]
}

export type ResumeTextMeta = {
    total_pages: number
    ocr_pages: number[]
    quality_threshold: number
    quality_scores?: Array<{
        page: number
        score: number
        metrics: {
            char_count: number
            line_count: number
            median_line_length: number
            short_line_ratio: number
            weird_char_ratio: number
            repeat_line_ratio: number
        }
    }>
}

export interface ParsedCandidateData {
    first_name: string
    last_name: string
    email: string
    secondary_emails?: string[]
    phone?: string
    location?: string
    summary?: string
    skills?: string[]
    education?: string[]
    experience?: Array<{
        company: string
        role: string
        start_date?: string
        end_date?: string
        description?: string
    }>
    postcodes?: string[]
    postcode?: string
    distance_to_anchor_miles?: number
    commute_status?: 'yes' | 'no' | 'unclear'
    language?: string
    language_confidence?: number
    is_english?: boolean
    resume_text_anchored?: string
    resume_text_pages?: ResumeTextPage[]
    resume_text_meta?: ResumeTextMeta
    employment_timeline?: EmploymentTimelineEntry[]
}

export type ParsingUsage = {
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost: number
}

export type ParsingUsageBreakdown = ParsingUsage & {
    label: string
}

export type ResumeParseResult = {
    parsedData: ParsedCandidateData
    resumeText: string
    resumeTextAnchored?: string
    resumeTextPages?: ResumeTextPage[]
    resumeTextMeta?: ResumeTextMeta
    usage?: ParsingUsage
    usageBreakdown?: ParsingUsageBreakdown[]
    model: string
    extractionSource: 'text' | 'vision' | 'image' | 'manual'
}

const MODEL_PRICING_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4o-mini-2024-07-18': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4o': { prompt: 0.0025, completion: 0.01 },
    'gpt-4.1-mini': { prompt: 0.00015, completion: 0.0006 },
}

const MIN_PDF_TEXT_CHARS = 50
const MAX_PDF_IMAGE_PAGES = Number(process.env.OPENAI_HIRING_PARSER_VISION_MAX_PAGES || 0)
const VISION_MAX_TOKENS = Number(process.env.OPENAI_HIRING_PARSER_VISION_MAX_TOKENS || 2000)
const PDF_OCR_QUALITY_THRESHOLD = Number(process.env.OPENAI_HIRING_PARSER_OCR_QUALITY_THRESHOLD || 0.5)
const TIMELINE_MAX_TOKENS = Number(process.env.OPENAI_HIRING_TIMELINE_MAX_TOKENS || 1200)

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
    const promptCost = (promptTokens / 1000) * pricing.prompt
    const completionCost = (completionTokens / 1000) * pricing.completion
    return Number((promptCost + completionCost).toFixed(6))
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase()
}

function normalizeLine(value: string) {
    return value.trim().replace(/\s+/g, ' ')
}

function computeMedian(values: number[]) {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    if (sorted.length % 2 === 0) {
        return Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    }
    return sorted[mid]
}

function computeTextQuality(lines: string[], repeatedLineSet: Set<string>) {
    const normalizedLines = lines.map((line) => normalizeLine(line)).filter(Boolean)
    const lineCount = normalizedLines.length
    const lineLengths = normalizedLines.map((line) => line.length)
    const medianLineLength = computeMedian(lineLengths)
    const shortLines = normalizedLines.filter((line) => line.split(' ').length <= 3).length
    const shortLineRatio = lineCount > 0 ? shortLines / lineCount : 0
    const text = normalizedLines.join(' ')
    const charCount = text.length
    const weirdChars = (text.match(/[^\x00-\x7F]/g) || []).length
    const weirdCharRatio = charCount > 0 ? weirdChars / charCount : 0
    const repeatLines = normalizedLines.filter((line) => repeatedLineSet.has(line)).length
    const repeatLineRatio = lineCount > 0 ? repeatLines / lineCount : 0

    let score = 1
    if (charCount < 200) score -= 0.4
    if (medianLineLength < 20) score -= 0.2
    if (shortLineRatio > 0.4) score -= 0.2
    if (weirdCharRatio > 0.08) score -= 0.2
    if (repeatLineRatio > 0.5) score -= 0.2

    return {
        score: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
        metrics: {
            char_count: charCount,
            line_count: lineCount,
            median_line_length: medianLineLength,
            short_line_ratio: Number(shortLineRatio.toFixed(2)),
            weird_char_ratio: Number(weirdCharRatio.toFixed(2)),
            repeat_line_ratio: Number(repeatLineRatio.toFixed(2)),
        }
    }
}

async function extractPdfTextPages(buffer: Buffer): Promise<{ pages: Array<{ page: number; text: string; lines: string[] }>; quality: ResumeTextMeta['quality_scores'] }> {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true } as any)
    const pdf = await loadingTask.promise
    const pages: Array<{ page: number; text: string; lines: string[] }> = []

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum)
        const textContent = await page.getTextContent()
        const lineMap = new Map<number, string[]>()
        for (const item of textContent.items as any[]) {
            const str = (item?.str || '').toString()
            const y = Math.round(item?.transform?.[5] ?? 0)
            if (!lineMap.has(y)) {
                lineMap.set(y, [])
            }
            lineMap.get(y)?.push(str)
        }
        const lines = Array.from(lineMap.entries())
            .sort((a, b) => b[0] - a[0])
            .map(([, parts]) => normalizeLine(parts.join(' ')))
            .filter(Boolean)
        const text = lines.join('\n')
        pages.push({ page: pageNum, text, lines })
        page.cleanup()
    }

    const allLines = pages.flatMap((page) => page.lines.map((line) => normalizeLine(line))).filter(Boolean)
    const lineCounts = new Map<string, number>()
    allLines.forEach((line) => {
        lineCounts.set(line, (lineCounts.get(line) || 0) + 1)
    })
    const repeatedLineSet = new Set<string>()
    Array.from(lineCounts.entries()).forEach(([line, count]) => {
        if (count > 1) repeatedLineSet.add(line)
    })

    const quality = pages.map((page) => ({
        page: page.page,
        ...computeTextQuality(page.lines, repeatedLineSet),
    }))

    return { pages, quality }
}

async function renderPdfPagesToImages(buffer: Buffer, maxPages = MAX_PDF_IMAGE_PAGES): Promise<string[]> {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('@napi-rs/canvas')

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true } as any)
    const pdf = await loadingTask.promise
    const totalPages = maxPages > 0 ? Math.min(pdf.numPages, maxPages) : pdf.numPages
    const images: string[] = []

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
        const context = canvas.getContext('2d')
        await page.render({ canvasContext: context as any, viewport } as any).promise
        const pngBuffer = canvas.toBuffer('image/png')
        images.push(pngBuffer.toString('base64'))
        page.cleanup()
    }

    return images
}

async function renderPdfPageToImage(buffer: Buffer, pageNumber: number): Promise<string> {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('@napi-rs/canvas')
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true } as any)
    const pdf = await loadingTask.promise
    const page = await pdf.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1.5 })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const context = canvas.getContext('2d')
    await page.render({ canvasContext: context as any, viewport } as any).promise
    const pngBuffer = canvas.toBuffer('image/png')
    page.cleanup()
    return pngBuffer.toString('base64')
}

async function extractResumeTextWithVision(input: {
    openai: OpenAI
    images: string[]
    mimeType?: string
    model: string
}): Promise<{ text: string; usage?: ParsingUsage; model: string }> {
    if (input.images.length === 0) {
        throw new Error('No images provided for vision extraction')
    }

    const response = await input.openai.chat.completions.create({
        model: input.model,
        messages: [
            {
                role: 'system',
                content: `You extract plain resume text from images.
Return a JSON object with a single key "text" containing the resume text.
Do not add commentary or markdown.`
            },
            {
                role: 'user',
                content: buildUserContent(null, input.images, input.mimeType)
            }
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: VISION_MAX_TOKENS,
    })

    const rawContent = response.choices?.[0]?.message?.content
    if (!rawContent) {
        throw new Error('Vision extraction returned empty content')
    }

    let parsed: { text?: string }
    try {
        parsed = JSON.parse(rawContent)
    } catch (error) {
        console.error('Failed to parse vision extraction JSON payload:', error)
        throw new Error('Vision extraction returned invalid JSON')
    }

    const text = (parsed.text || '').toString()
    if (!text.trim()) {
        throw new Error('Vision extraction produced empty text')
    }

    const usagePayload = response.usage
    const promptTokens = usagePayload?.prompt_tokens ?? 0
    const completionTokens = usagePayload?.completion_tokens ?? 0
    const totalTokens = usagePayload?.total_tokens ?? (promptTokens + completionTokens)
    const usage = usagePayload
        ? {
            model: response.model || input.model,
            promptTokens,
            completionTokens,
            totalTokens,
            cost: calculateOpenAICost(response.model || input.model, promptTokens, completionTokens),
        }
        : undefined

    return {
        text,
        usage,
        model: response.model || input.model,
    }
}

async function extractResumeTextFromImages(input: {
    openai: OpenAI
    images: string[]
    mimeType?: string
    model: string
    labelPrefix?: string
}): Promise<{ texts: string[]; usageBreakdown?: ParsingUsageBreakdown[]; model: string }> {
    const texts: string[] = []
    const usageBreakdown: ParsingUsageBreakdown[] = []
    let resolvedModel = input.model

    for (let index = 0; index < input.images.length; index += 1) {
        const image = input.images[index]
        const result = await extractResumeTextWithVision({
            openai: input.openai,
            images: [image],
            mimeType: input.mimeType,
            model: input.model,
        })
        resolvedModel = result.model || resolvedModel
        texts.push(result.text)
        if (result.usage) {
            const label = input.labelPrefix
                ? `${input.labelPrefix}_${index + 1}`
                : `vision_text_page_${index + 1}`
            usageBreakdown.push({ label, ...result.usage })
        }
    }

    return {
        texts,
        usageBreakdown: usageBreakdown.length ? usageBreakdown : undefined,
        model: resolvedModel,
    }
}

function buildUserContent(text: string | null, images: string[], mimeType?: string) {
    const content: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []

    if (text) {
        content.push({
            type: 'text',
            text: `Resume text:\n${text}`
        })
    }

    if (images.length > 0) {
        content.push({
            type: 'text',
            text: 'Resume images:'
        })

        images.forEach((image) => {
            content.push({
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType || 'image/png'};base64,${image}`
                }
            })
        })
    }

    return content
}

function buildAnchoredResumeText(pages: ResumeTextPage[]): string {
    if (!pages.length) return ''

    return pages
        .map((page) => {
            const lines = (page.text || '').split(/\r?\n/)
            let lineNumber = 1
            const numbered = lines
                .map((line) => line.trim())
                .filter((line) => line.length > 0)
                .map((line) => {
                    const label = String(lineNumber).padStart(3, '0')
                    lineNumber += 1
                    return `${label}: ${line}`
                })

            return [`=== Page ${page.page} ===`, ...numbered].join('\n')
        })
        .filter(Boolean)
        .join('\n\n')
}

function normalizeParsedData(parsed: ParsedCandidateData): ParsedCandidateData {
    const primaryEmail = parsed.email ? normalizeEmail(parsed.email) : ''
    const secondaryEmails = Array.isArray(parsed.secondary_emails)
        ? parsed.secondary_emails
            .map((email) => email?.trim())
            .filter(Boolean)
            .map((email) => normalizeEmail(email as string))
            .filter((email) => email && email !== primaryEmail)
        : []

    return {
        ...parsed,
        email: primaryEmail,
        secondary_emails: Array.from(new Set(secondaryEmails))
    }
}

function isPlaceholderEmail(value: string) {
    return value.startsWith('pending-') || value.endsWith('@hiring.temp')
}

function isRelayEmail(value: string) {
    const normalized = value.toLowerCase()
    return normalized.includes('@indeed') || normalized.includes('@linkedin') || normalized.includes('no-reply')
}

function pickPrimaryEmail(emails: string[]): string {
    const normalized = Array.from(new Set(emails.map((value) => value.trim().toLowerCase()).filter(Boolean)))
    if (!normalized.length) return ''

    const nonPlaceholder = normalized.filter((email) => !isPlaceholderEmail(email))
    const nonRelay = nonPlaceholder.filter((email) => !isRelayEmail(email))

    if (nonRelay.length) return nonRelay[0]
    if (nonPlaceholder.length) return nonPlaceholder[0]
    return normalized[0]
}

function normalizeList(values: unknown): string[] {
    if (!Array.isArray(values)) return []
    return values
        .map((item) => (typeof item === 'string' ? item.trim() : String(item ?? '').trim()))
        .filter(Boolean)
}

function mergeExperienceEntries(entries: ParsedCandidateData['experience'] = []): ParsedCandidateData['experience'] {
    const merged: ParsedCandidateData['experience'] = []
    const seen = new Map<string, number>()
    const safeEntries = Array.isArray(entries) ? entries : []

    const normalizeKey = (value: string) => value.trim().toLowerCase()

    safeEntries.forEach((entry) => {
        if (!entry) return
        const company = normalizeKey(entry.company || '')
        const role = normalizeKey(entry.role || '')
        const start = normalizeKey(entry.start_date || '')
        const end = normalizeKey(entry.end_date || '')
        const key = [company, role, start, end].join('|')

        if (!key || key === '|||') {
            merged.push({ ...entry })
            return
        }

        if (!seen.has(key)) {
            seen.set(key, merged.length)
            merged.push({ ...entry })
            return
        }

        const index = seen.get(key) as number
        const current = merged[index]
        merged[index] = {
            company: current.company || entry.company,
            role: current.role || entry.role,
            start_date: current.start_date || entry.start_date,
            end_date: current.end_date || entry.end_date,
            description: current.description || entry.description,
        }
    })

    return merged
}

function mergeParsedCandidateData(parts: ParsedCandidateData[]): ParsedCandidateData {
    const nameCounts = new Map<string, { first: string; last: string; count: number }>()
    const primaryEmails: string[] = []
    const secondaryEmails: string[] = []
    let phone = ''
    let location = ''
    const skills = new Map<string, string>()
    const education = new Map<string, string>()
    const experienceEntries: ParsedCandidateData['experience'] = []

    parts.forEach((part) => {
        if (!part) return
        const firstName = (part.first_name || '').trim()
        const lastName = (part.last_name || '').trim()
        const fullNameKey = `${firstName} ${lastName}`.trim().toLowerCase()
        if (fullNameKey) {
            const existing = nameCounts.get(fullNameKey)
            if (existing) {
                existing.count += 1
            } else {
                nameCounts.set(fullNameKey, { first: firstName, last: lastName, count: 1 })
            }
        }

        if (part.email) primaryEmails.push(part.email)
        secondaryEmails.push(...normalizeList(part.secondary_emails))

        if (!phone && part.phone) phone = part.phone.trim()
        if (!location && part.location) location = part.location.trim()

        normalizeList(part.skills).forEach((value) => {
            const key = value.toLowerCase()
            if (!skills.has(key)) skills.set(key, value)
        })

        normalizeList(part.education).forEach((value) => {
            const key = value.toLowerCase()
            if (!education.has(key)) education.set(key, value)
        })

        if (Array.isArray(part.experience)) {
            part.experience.forEach((item) => {
                if (!item) return
                experienceEntries.push({
                    company: item.company || '',
                    role: item.role || '',
                    start_date: item.start_date,
                    end_date: item.end_date,
                    description: item.description,
                })
            })
        }
    })

    const sortedNames = Array.from(nameCounts.values()).sort((a, b) => b.count - a.count)
    const topName = sortedNames[0]

    const allEmails = [...primaryEmails, ...secondaryEmails]
    const primaryEmail = pickPrimaryEmail(allEmails)
    const remainingEmails = allEmails
        .map((value) => value.trim())
        .filter((value) => value && value.toLowerCase() !== primaryEmail.toLowerCase())

    return {
        first_name: topName?.first || '',
        last_name: topName?.last || '',
        email: primaryEmail,
        secondary_emails: Array.from(new Set(remainingEmails)),
        phone: phone || undefined,
        location: location || undefined,
        summary: undefined,
        skills: Array.from(skills.values()),
        education: Array.from(education.values()),
        experience: mergeExperienceEntries(experienceEntries),
    }
}

async function loadResumeFacts(text: string): Promise<ResumeFacts | null> {
    if (!text.trim()) return null
    try {
        return await extractResumeFacts(text)
    } catch (error) {
        console.warn('Failed to extract deterministic resume facts', error)
        return null
    }
}

function enrichParsedData(
    parsed: ParsedCandidateData,
    facts: ResumeFacts | null,
    pages: ResumeTextPage[],
    meta?: ResumeTextMeta,
    anchoredText?: string,
    timeline?: EmploymentTimelineEntry[]
): ParsedCandidateData {
    const enriched: ParsedCandidateData = {
        ...parsed,
        ...(facts || {}),
    }

    if (pages.length > 0) {
        enriched.resume_text_pages = pages
    }
    if (meta) {
        enriched.resume_text_meta = meta
    }
    if (anchoredText) {
        enriched.resume_text_anchored = anchoredText
    }
    if (timeline && timeline.length) {
        enriched.employment_timeline = timeline
    }

    return enriched
}

async function extractCandidateProfile(openai: OpenAI, content: any, model: string) {
    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: `You are an AI assistant that extracts structured data from resumes for a hospitality venue (The Anchor).
Extract the following fields and return them as a JSON object:
- first_name
- last_name
- email
- secondary_emails (array of strings)
- phone
- location
- summary (CRITICAL: Do NOT copy the candidate's own summary. You must GENERATE a completely new 2-3 sentence summary that strictly highlights ONLY their hospitality, bar, customer service, or event experience. If they have none, state "No explicit hospitality experience listed." Ignore all other industries like music, tech, or administration.)
- skills (array of strings, prioritize hospitality skills)
- experience (array of objects with company, role, start_date, end_date, description)
- education (array of strings)

Pick the most likely personal email as "email" and place all other emails in "secondary_emails".
Be precise. If you cannot find a field, leave it null or omit it.
Normalize dates to YYYY-MM format if possible.
Return ONLY the JSON. Do not include markdown formatting.`
            },
            {
                role: 'user',
                content
            }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
    })

    const message = response.choices[0]?.message
    const rawContent = message?.content
    if (!rawContent) {
        throw new Error('Model failed to generate structured data')
    }
    let parsed: ParsedCandidateData
    try {
        parsed = JSON.parse(rawContent) as ParsedCandidateData
    } catch (error) {
        console.error('Failed to parse resume JSON payload:', error)
        throw new Error('Model returned invalid JSON')
    }

    return {
        parsed,
        usage: response.usage ?? null,
        model: response.model || model,
    }
}

async function extractCandidateProfileChunk(openai: OpenAI, chunk: string, model: string) {
    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: `You extract partial structured data from a resume CHUNK for a hospitality venue (The Anchor).
Only include fields that are explicitly present in this chunk. If a field is missing in this chunk, omit it.
Do NOT generate a summary in chunk extraction.
Return a JSON object with any of these fields when present:
- first_name
- last_name
- email
- secondary_emails (array of strings)
- phone
- location
- skills (array of strings)
- experience (array of objects with company, role, start_date, end_date, description)
- education (array of strings)

Pick the most likely personal email as "email" and place all other emails in "secondary_emails".
Be precise. Normalize dates to YYYY-MM format if possible.
Return ONLY the JSON. Do not include markdown formatting.`
            },
            {
                role: 'user',
                content: buildUserContent(chunk, [], undefined)
            }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
    })

    const message = response.choices[0]?.message
    const rawContent = message?.content
    if (!rawContent) {
        throw new Error('Model failed to generate structured data')
    }
    let parsed: ParsedCandidateData
    try {
        parsed = JSON.parse(rawContent) as ParsedCandidateData
    } catch (error) {
        console.error('Failed to parse resume JSON payload:', error)
        throw new Error('Model returned invalid JSON')
    }

    return {
        parsed,
        usage: response.usage ?? null,
        model: response.model || model,
    }
}

async function generateHospitalitySummary(openai: OpenAI, model: string, parsed: ParsedCandidateData) {
    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: `You generate a 2-3 sentence summary for hiring managers.
Focus ONLY on hospitality, bar, customer service, or event experience.
If no explicit hospitality experience is listed, return "No explicit hospitality experience listed."
Return JSON with a single key "summary".`
            },
            {
                role: 'user',
                content: JSON.stringify({
                    skills: parsed.skills ?? [],
                    experience: parsed.experience ?? [],
                    education: parsed.education ?? [],
                })
            }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 200,
    })

    const rawContent = response.choices?.[0]?.message?.content
    if (!rawContent) {
        throw new Error('Model failed to generate summary')
    }

    let summaryPayload: { summary?: string }
    try {
        summaryPayload = JSON.parse(rawContent)
    } catch (error) {
        console.error('Failed to parse summary JSON payload:', error)
        throw new Error('Summary model returned invalid JSON')
    }

    const summary = summaryPayload.summary?.toString().trim()
    return {
        summary: summary || 'No explicit hospitality experience listed.',
        usage: response.usage ?? null,
        model: response.model || model,
    }
}

async function extractEmploymentTimeline(openai: OpenAI, anchoredText: string, model: string) {
    const trimmed = anchoredText.trim()
    if (!trimmed) {
        return { timeline: [] as EmploymentTimelineEntry[], usage: null, model }
    }

    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: `You extract employment timeline facts from anchored resume text for a hospitality venue.
Use the page/line numbers to reference evidence anchors like "Page 2, lines 14-20".
Group multiple titles under the same employer when the CV shows role progression (e.g., "Assistant Manager... previous roles include Bartender...").
Quotes must be exact phrases from the resume text (do not include line numbers in quotes).
Only include information supported by the resume text.
Return JSON matching the schema.`
            },
            {
                role: 'user',
                content: trimmed,
            }
        ],
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'employment_timeline',
                schema: {
                    type: 'object',
                    properties: {
                        timeline: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    employer: { type: ['string', 'null'] },
                                    titles: { type: 'array', items: { type: 'string' } },
                                    start_date: { type: ['string', 'null'] },
                                    end_date: { type: ['string', 'null'] },
                                    is_hospitality: { type: ['boolean', 'null'] },
                                    is_bar_role: { type: ['boolean', 'null'] },
                                    bullets: { type: 'array', items: { type: 'string' } },
                                    evidence_quotes: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            properties: {
                                                quote: { type: 'string' },
                                                anchor: { type: 'string' },
                                            },
                                            required: ['quote', 'anchor'],
                                            additionalProperties: false,
                                        }
                                    },
                                },
                                required: ['titles', 'evidence_quotes'],
                                additionalProperties: false,
                            }
                        }
                    },
                    required: ['timeline'],
                    additionalProperties: false,
                }
            }
        },
        temperature: 0.1,
        max_tokens: TIMELINE_MAX_TOKENS,
    })

    const rawContent = response.choices?.[0]?.message?.content
    if (!rawContent) {
        throw new Error('Timeline extraction returned empty content')
    }

    let parsed: { timeline?: EmploymentTimelineEntry[] }
    try {
        parsed = JSON.parse(rawContent)
    } catch (error) {
        console.error('Failed to parse timeline JSON payload:', error)
        throw new Error('Timeline extraction returned invalid JSON')
    }

    const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : []
    return {
        timeline,
        usage: response.usage ?? null,
        model: response.model || model,
    }
}

async function extractCandidateProfileFromChunks(input: {
    openai: OpenAI
    chunks: string[]
    model: string
}): Promise<{ parsed: ParsedCandidateData; usageBreakdown: ParsingUsageBreakdown[]; model: string }> {
    const parts: ParsedCandidateData[] = []
    const usageBreakdown: ParsingUsageBreakdown[] = []
    let resolvedModel = input.model

    for (let index = 0; index < input.chunks.length; index += 1) {
        const chunk = input.chunks[index]
        const result = await extractCandidateProfileChunk(input.openai, chunk, input.model)
        resolvedModel = result.model || resolvedModel
        parts.push(result.parsed)
        if (result.usage) {
            const usage = buildUsageFromPayload(result.usage, result.model || input.model)
            if (usage) {
                usageBreakdown.push({ label: `structured_parse_chunk_${index + 1}`, ...usage })
            }
        }
    }

    const merged = mergeParsedCandidateData(parts)
    const summaryResult = await generateHospitalitySummary(input.openai, resolvedModel, merged)
    merged.summary = summaryResult.summary
    if (summaryResult.usage) {
        const usage = buildUsageFromPayload(summaryResult.usage, summaryResult.model)
        if (usage) {
            usageBreakdown.push({ label: 'summary', ...usage })
        }
    }

    return {
        parsed: merged,
        usageBreakdown,
        model: resolvedModel,
    }
}

function buildUsageFromPayload(payload: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null | undefined, model: string) {
    if (!payload) return undefined
    const promptTokens = payload.prompt_tokens ?? 0
    const completionTokens = payload.completion_tokens ?? 0
    const totalTokens = payload.total_tokens ?? (promptTokens + completionTokens)
    return {
        model,
        promptTokens,
        completionTokens,
        totalTokens,
        cost: calculateOpenAICost(model, promptTokens, completionTokens),
    }
}

function mergeUsage(entries: ParsingUsage[]): ParsingUsage {
    const total = entries.reduce(
        (acc, entry) => {
            acc.promptTokens += entry.promptTokens
            acc.completionTokens += entry.completionTokens
            acc.totalTokens += entry.totalTokens
            acc.cost += entry.cost
            return acc
        },
        { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0 }
    )

    return {
        model: entries.map((entry) => entry.model).join(' + '),
        promptTokens: total.promptTokens,
        completionTokens: total.completionTokens,
        totalTokens: total.totalTokens,
        cost: Number(total.cost.toFixed(6)),
    }
}

export async function parseResumeWithUsage(buffer: Buffer, mimeType: string): Promise<ResumeParseResult> {
    let text = ''
    let images: string[] = []
    let imageMimeType: string | undefined
    let extractionSource: ResumeParseResult['extractionSource'] = 'text'
    const usageBreakdown: ParsingUsageBreakdown[] = []
    let resumeTextPages: ResumeTextPage[] = []
    let resumeTextMeta: ResumeTextMeta | undefined
    let resumeTextAnchored = ''

    try {
        const baseMimeType = mimeType.split(';')[0].trim().toLowerCase()
        imageMimeType = baseMimeType.startsWith('image/') ? baseMimeType : undefined

        if (baseMimeType === 'application/pdf') {
            const { pages, quality } = await extractPdfTextPages(buffer)
            const qualityScores = quality ?? []
            const combinedText = pages.map((page) => page.text).join('\n\n')
            const baseTextLength = combinedText.trim().length
            const lowQualityPages = qualityScores
                .filter((item) => item.score < PDF_OCR_QUALITY_THRESHOLD)
                .map((item) => item.page)
            const ocrCandidates = new Set<number>(lowQualityPages)
            ocrCandidates.add(1)
            if (baseTextLength < MIN_PDF_TEXT_CHARS) {
                pages.forEach((page) => ocrCandidates.add(page.page))
            }

            let ocrPages = Array.from(ocrCandidates.values())
            if (MAX_PDF_IMAGE_PAGES > 0 && ocrPages.length > MAX_PDF_IMAGE_PAGES) {
                const ranked = [...qualityScores].sort((a, b) => a.score - b.score).map((item) => item.page)
                const nextPages = ranked.filter((page) => page !== 1)
                const limited = [1, ...nextPages].slice(0, MAX_PDF_IMAGE_PAGES)
                ocrPages = Array.from(new Set(limited))
            }

            const ocrTextByPage = new Map<number, string>()
            if (ocrPages.length) {
                extractionSource = 'vision'
                const { apiKey, baseUrl } = await getOpenAIConfig()
                if (!apiKey) {
                    throw new Error('OpenAI API key not configured')
                }
                const openai = new OpenAI({ apiKey, baseURL: baseUrl })
                const visionModel = process.env.OPENAI_HIRING_PARSER_VISION_MODEL || 'gpt-4o'
                const imagesForOcr: string[] = []
                for (const pageNumber of ocrPages) {
                    imagesForOcr.push(await renderPdfPageToImage(buffer, pageNumber))
                }
                try {
                    const visionResult = await extractResumeTextFromImages({
                        openai,
                        images: imagesForOcr,
                        mimeType: 'image/png',
                        model: visionModel,
                        labelPrefix: 'vision_text_page',
                    })
                    visionResult.texts.forEach((pageText, index) => {
                        const pageNumber = ocrPages[index]
                        if (pageNumber != null) {
                            ocrTextByPage.set(pageNumber, pageText)
                        }
                    })
                    if (visionResult.usageBreakdown?.length) {
                        usageBreakdown.push(...visionResult.usageBreakdown)
                    }
                } catch (error) {
                    console.warn('Vision extraction failed, falling back to PDF text', error)
                }
            }

            resumeTextPages = pages.map((page) => {
                const ocrText = ocrTextByPage.get(page.page)
                return {
                    page: page.page,
                    text: (ocrText || page.text || '').trim(),
                    source: ocrText ? 'vision_ocr' : 'pdf_text',
                }
            })
            text = resumeTextPages.map((page) => page.text).filter(Boolean).join('\n\n')
            resumeTextMeta = {
                total_pages: pages.length,
                ocr_pages: ocrPages,
                quality_threshold: PDF_OCR_QUALITY_THRESHOLD,
                quality_scores: qualityScores,
            }
        } else if (
            baseMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            baseMimeType === 'application/msword'
        ) {
            const result = await mammoth.extractRawText({ buffer })
            text = result.value
            resumeTextPages = [
                {
                    page: 1,
                    text: text.trim(),
                    source: 'docx',
                },
            ]
            resumeTextMeta = {
                total_pages: 1,
                ocr_pages: [],
                quality_threshold: PDF_OCR_QUALITY_THRESHOLD,
            }
        } else if (baseMimeType.startsWith('image/')) {
            extractionSource = 'image'
            const { apiKey, baseUrl } = await getOpenAIConfig()
            if (!apiKey) {
                throw new Error('OpenAI API key not configured')
            }
            const openai = new OpenAI({ apiKey, baseURL: baseUrl })
            const visionModel = process.env.OPENAI_HIRING_PARSER_VISION_MODEL || 'gpt-4o'
            try {
                const visionResult = await extractResumeTextFromImages({
                    openai,
                    images: [buffer.toString('base64')],
                    mimeType: baseMimeType,
                    model: visionModel,
                    labelPrefix: 'vision_text_image',
                })
                const imageText = visionResult.texts[0] || ''
                text = imageText
                resumeTextPages = [
                    {
                        page: 1,
                        text: imageText.trim(),
                        source: 'image',
                    }
                ]
                resumeTextMeta = {
                    total_pages: 1,
                    ocr_pages: [1],
                    quality_threshold: PDF_OCR_QUALITY_THRESHOLD,
                }
                if (visionResult.usageBreakdown?.length) {
                    usageBreakdown.push(...visionResult.usageBreakdown)
                }
            } catch (error) {
                console.warn('Vision extraction failed, falling back to direct parsing when possible', error)
                images = [buffer.toString('base64')]
            }
        } else if (baseMimeType.startsWith('text/')) {
            text = buffer.toString('utf-8')
            resumeTextPages = [
                {
                    page: 1,
                    text: text.trim(),
                    source: 'text',
                },
            ]
            resumeTextMeta = {
                total_pages: 1,
                ocr_pages: [],
                quality_threshold: PDF_OCR_QUALITY_THRESHOLD,
            }
        } else {
            throw new Error(`Unsupported file type: ${mimeType}`)
        }
    } catch (err) {
        console.error('Error extracting text from file:', err)
        throw new Error('Failed to extract text from file')
    }

    const trimmedText = text?.trim() || ''
    if (!resumeTextPages.length && trimmedText) {
        resumeTextPages = [
            {
                page: 1,
                text: trimmedText,
                source: 'text',
            }
        ]
    }
    resumeTextAnchored = buildAnchoredResumeText(resumeTextPages)
    const textChunks = splitTextIntoChunks(trimmedText)

    if (!trimmedText && images.length === 0) {
        throw new Error('Extracted content is empty')
    }

    const { apiKey, baseUrl } = await getOpenAIConfig()

    if (!apiKey) {
        console.warn('OpenAI parsing skipped: No API Key')
        throw new Error('OpenAI API key not configured')
    }

    const openai = new OpenAI({ apiKey, baseURL: baseUrl })
    const model = process.env.OPENAI_HIRING_PARSER_MODEL || 'gpt-4o'
    const facts = await loadResumeFacts(trimmedText)
    let timeline: EmploymentTimelineEntry[] = []

    try {
        const timelineModel = process.env.OPENAI_HIRING_TIMELINE_MODEL || model
        const timelineResult = await extractEmploymentTimeline(openai, resumeTextAnchored, timelineModel)
        timeline = timelineResult.timeline ?? []
        const timelineUsage = buildUsageFromPayload(timelineResult.usage, timelineResult.model)
        if (timelineUsage) {
            usageBreakdown.push({ label: 'timeline', ...timelineUsage })
        }
    } catch (error) {
        console.warn('Timeline extraction failed', error)
    }

    try {
        if (textChunks.length > 1) {
            const chunkResult = await extractCandidateProfileFromChunks({
                openai,
                chunks: textChunks,
                model,
            })
            const normalized = normalizeParsedData(chunkResult.parsed)
            const enriched = enrichParsedData(normalized, facts, resumeTextPages, resumeTextMeta, resumeTextAnchored, timeline)

            if (chunkResult.usageBreakdown.length) {
                usageBreakdown.push(...chunkResult.usageBreakdown)
            }

            const mergedUsage = usageBreakdown.length
                ? mergeUsage(usageBreakdown.map(({ label: _label, ...rest }) => rest))
                : undefined

            return {
                parsedData: enriched,
                resumeText: trimmedText,
                resumeTextAnchored,
                resumeTextPages,
                resumeTextMeta,
                usage: mergedUsage,
                usageBreakdown: usageBreakdown.length ? usageBreakdown : undefined,
                model: chunkResult.model,
                extractionSource,
            }
        }

        const content = buildUserContent(trimmedText || null, images, imageMimeType)
        const parsedResponse = await extractCandidateProfile(openai, content, model)
        const normalized = normalizeParsedData(parsedResponse.parsed)
        const enriched = enrichParsedData(normalized, facts, resumeTextPages, resumeTextMeta, resumeTextAnchored, timeline)
        const usage = buildUsageFromPayload(parsedResponse.usage, parsedResponse.model)

        if (usage) {
            usageBreakdown.push({ label: 'structured_parse', ...usage })
        }

        const mergedUsage = usageBreakdown.length
            ? mergeUsage(usageBreakdown.map(({ label: _label, ...rest }) => rest))
            : usage

        return {
            parsedData: enriched,
            resumeText: trimmedText,
            resumeTextAnchored,
            resumeTextPages,
            resumeTextMeta,
            usage: mergedUsage,
            usageBreakdown: usageBreakdown.length ? usageBreakdown : undefined,
            model: parsedResponse.model,
            extractionSource,
        }
    } catch (error) {
        console.error('OpenAI parsing error:', error)
        throw new Error('Failed to parse resume with AI')
    }
}

export async function parseResumeTextWithUsage(text: string): Promise<ResumeParseResult> {
    const trimmedText = text.trim()
    const textChunks = splitTextIntoChunks(trimmedText)

    if (!trimmedText) {
        throw new Error('Resume text is empty')
    }

    const resumeTextPages: ResumeTextPage[] = [
        {
            page: 1,
            text: trimmedText,
            source: 'manual',
        },
    ]
    const resumeTextAnchored = buildAnchoredResumeText(resumeTextPages)
    const resumeTextMeta: ResumeTextMeta = {
        total_pages: 1,
        ocr_pages: [],
        quality_threshold: PDF_OCR_QUALITY_THRESHOLD,
    }

    const { apiKey, baseUrl } = await getOpenAIConfig()
    if (!apiKey) {
        console.warn('OpenAI parsing skipped: No API Key')
        throw new Error('OpenAI API key not configured')
    }

    const openai = new OpenAI({ apiKey, baseURL: baseUrl })
    const model = process.env.OPENAI_HIRING_PARSER_MODEL || 'gpt-4o'
    const facts = await loadResumeFacts(trimmedText)
    let timeline: EmploymentTimelineEntry[] = []
    let timelineUsage: ParsingUsage | undefined

    try {
        const timelineModel = process.env.OPENAI_HIRING_TIMELINE_MODEL || model
        const timelineResult = await extractEmploymentTimeline(openai, resumeTextAnchored, timelineModel)
        timeline = timelineResult.timeline ?? []
        timelineUsage = buildUsageFromPayload(timelineResult.usage, timelineResult.model)
    } catch (error) {
        console.warn('Timeline extraction failed', error)
    }

    try {
        if (textChunks.length > 1) {
            const chunkResult = await extractCandidateProfileFromChunks({
                openai,
                chunks: textChunks,
                model,
            })
            const normalized = normalizeParsedData(chunkResult.parsed)
            const enriched = enrichParsedData(normalized, facts, resumeTextPages, resumeTextMeta, resumeTextAnchored, timeline)

            const usageEntries = chunkResult.usageBreakdown.map(({ label: _label, ...rest }) => rest)
            if (timelineUsage) {
                usageEntries.push(timelineUsage)
            }

            return {
                parsedData: enriched,
                resumeText: trimmedText,
                resumeTextAnchored,
                resumeTextPages,
                resumeTextMeta,
                usage: usageEntries.length ? mergeUsage(usageEntries) : undefined,
                usageBreakdown: [
                    ...(chunkResult.usageBreakdown.length ? chunkResult.usageBreakdown : []),
                    ...(timelineUsage ? [{ label: 'timeline', ...timelineUsage }] : []),
                ],
                model: chunkResult.model,
                extractionSource: 'manual',
            }
        }

        const content = buildUserContent(trimmedText, [], undefined)
        const parsedResponse = await extractCandidateProfile(openai, content, model)
        const normalized = normalizeParsedData(parsedResponse.parsed)
        const enriched = enrichParsedData(normalized, facts, resumeTextPages, resumeTextMeta, resumeTextAnchored, timeline)
        const usage = buildUsageFromPayload(parsedResponse.usage, parsedResponse.model)

        const combinedUsage = timelineUsage
            ? usage
                ? mergeUsage([usage, timelineUsage])
                : timelineUsage
            : usage

        return {
            parsedData: enriched,
            resumeText: trimmedText,
            resumeTextAnchored,
            resumeTextPages,
            resumeTextMeta,
            usage: combinedUsage,
            usageBreakdown: [
                ...(usage ? [{ label: 'manual_parse', ...usage }] : []),
                ...(timelineUsage ? [{ label: 'timeline', ...timelineUsage }] : []),
            ],
            model: parsedResponse.model,
            extractionSource: 'manual',
        }
    } catch (error) {
        console.error('OpenAI parsing error:', error)
        throw new Error('Failed to parse resume text with AI')
    }
}

export async function parseResume(buffer: Buffer, mimeType: string): Promise<ParsedCandidateData> {
    const result = await parseResumeWithUsage(buffer, mimeType)
    return result.parsedData
}
