import OpenAI from 'openai'
import { getOpenAIConfig } from '@/lib/openai/config'
import mammoth from 'mammoth'
import PDFParser from 'pdf2json'

if (typeof window !== 'undefined') {
    throw new Error('Resume parsing must run on the server.')
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

const MAX_TEXT_CHARS = 30000
const MIN_PDF_TEXT_CHARS = 50
const MAX_PDF_IMAGE_PAGES = 2

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
    const promptCost = (promptTokens / 1000) * pricing.prompt
    const completionCost = (completionTokens / 1000) * pricing.completion
    return Number((promptCost + completionCost).toFixed(6))
}

function normalizeEmail(value: string) {
    return value.trim().toLowerCase()
}

async function extractPdfText(buffer: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
        const pdfParser = new PDFParser(null, true)

        pdfParser.on('pdfParser_dataError', (errData: unknown) => {
            if (errData && typeof errData === 'object' && 'parserError' in errData) {
                const typedError = (errData as { parserError?: unknown }).parserError
                reject(typedError instanceof Error ? typedError : new Error('Failed to parse PDF'))
            } else {
                reject(new Error('Failed to parse PDF'))
            }
        })

        pdfParser.on('pdfParser_dataReady', () => {
            resolve(pdfParser.getRawTextContent() || '')
        })

        pdfParser.parseBuffer(buffer, 0)
    })
}

async function renderPdfPagesToImages(buffer: Buffer, maxPages = MAX_PDF_IMAGE_PAGES): Promise<string[]> {
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { createCanvas } = await import('@napi-rs/canvas')

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer), disableWorker: true } as any)
    const pdf = await loadingTask.promise
    const totalPages = Math.min(pdf.numPages, maxPages)
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
        max_tokens: 2000,
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

    try {
        const baseMimeType = mimeType.split(';')[0].trim().toLowerCase()
        imageMimeType = baseMimeType.startsWith('image/') ? baseMimeType : undefined

        if (baseMimeType === 'application/pdf') {
            try {
                text = await extractPdfText(buffer)
            } catch (error) {
                console.warn('PDF text extraction failed, will attempt vision fallback', error)
                text = ''
            }

            if (text.trim().length < MIN_PDF_TEXT_CHARS) {
                const { apiKey, baseUrl } = await getOpenAIConfig()
                if (!apiKey) {
                    throw new Error('OpenAI API key not configured')
                }
                const openai = new OpenAI({ apiKey, baseURL: baseUrl })
                const visionModel = process.env.OPENAI_HIRING_PARSER_VISION_MODEL || 'gpt-4o'
                const pageImages = await renderPdfPagesToImages(buffer)
                const visionResult = await extractResumeTextWithVision({
                    openai,
                    images: pageImages,
                    mimeType: 'image/png',
                    model: visionModel,
                })
                text = visionResult.text
                extractionSource = 'vision'
                if (visionResult.usage) {
                    usageBreakdown.push({ label: 'vision_text', ...visionResult.usage })
                }
            }
        } else if (
            baseMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            baseMimeType === 'application/msword'
        ) {
            const result = await mammoth.extractRawText({ buffer })
            text = result.value
        } else if (baseMimeType.startsWith('image/')) {
            images = [buffer.toString('base64')]
            extractionSource = 'image'
        } else if (baseMimeType.startsWith('text/')) {
            text = buffer.toString('utf-8')
        } else {
            throw new Error(`Unsupported file type: ${mimeType}`)
        }
    } catch (err) {
        console.error('Error extracting text from file:', err)
        throw new Error('Failed to extract text from file')
    }

    const trimmedText = text?.trim() || ''
    const textForModel = trimmedText ? trimmedText.slice(0, MAX_TEXT_CHARS) : ''

    if (!textForModel && images.length === 0) {
        throw new Error('Extracted content is empty')
    }

    const { apiKey, baseUrl } = await getOpenAIConfig()

    if (!apiKey) {
        console.warn('OpenAI parsing skipped: No API Key')
        throw new Error('OpenAI API key not configured')
    }

    const openai = new OpenAI({ apiKey, baseURL: baseUrl })
    const model = process.env.OPENAI_HIRING_PARSER_MODEL || 'gpt-4o'

    try {
        const content = buildUserContent(textForModel || null, images, imageMimeType)
        const parsedResponse = await extractCandidateProfile(openai, content, model)
        const normalized = normalizeParsedData(parsedResponse.parsed)
        const usage = buildUsageFromPayload(parsedResponse.usage, parsedResponse.model)

        if (usage) {
            usageBreakdown.push({ label: 'structured_parse', ...usage })
        }

        const mergedUsage = usageBreakdown.length
            ? mergeUsage(usageBreakdown.map(({ label: _label, ...rest }) => rest))
            : usage

        return {
            parsedData: normalized,
            resumeText: textForModel,
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
    const textForModel = trimmedText ? trimmedText.slice(0, MAX_TEXT_CHARS) : ''

    if (!textForModel) {
        throw new Error('Resume text is empty')
    }

    const { apiKey, baseUrl } = await getOpenAIConfig()
    if (!apiKey) {
        console.warn('OpenAI parsing skipped: No API Key')
        throw new Error('OpenAI API key not configured')
    }

    const openai = new OpenAI({ apiKey, baseURL: baseUrl })
    const model = process.env.OPENAI_HIRING_PARSER_MODEL || 'gpt-4o'

    try {
        const content = buildUserContent(textForModel, [], undefined)
        const parsedResponse = await extractCandidateProfile(openai, content, model)
        const normalized = normalizeParsedData(parsedResponse.parsed)
        const usage = buildUsageFromPayload(parsedResponse.usage, parsedResponse.model)

        return {
            parsedData: normalized,
            resumeText: textForModel,
            usage,
            usageBreakdown: usage ? [{ label: 'manual_parse', ...usage }] : undefined,
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
