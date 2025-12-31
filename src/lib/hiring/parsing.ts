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

const MODEL_PRICING_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4o-mini-2024-07-18': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4o': { prompt: 0.0025, completion: 0.01 },
    'gpt-4.1-mini': { prompt: 0.00015, completion: 0.0006 },
}

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
    const promptCost = (promptTokens / 1000) * pricing.prompt
    const completionCost = (completionTokens / 1000) * pricing.completion
    return Number((promptCost + completionCost).toFixed(6))
}

const MAX_TEXT_CHARS = 12000

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
                content: `You are an AI assistant that extracts structured data from resumes.
Extract the following fields and return them as a JSON object:
- first_name
- last_name
- email
- secondary_emails (array of strings)
- phone
- location
- summary (a brief professional summary)
- skills (array of strings)
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

export async function parseResumeWithUsage(buffer: Buffer, mimeType: string): Promise<{
    parsedData: ParsedCandidateData
    usage?: ParsingUsage
    model: string
}> {
    let text = ''
    let images: string[] = []
    let imageMimeType: string | undefined

    try {
        const baseMimeType = mimeType.split(';')[0].trim().toLowerCase()
        imageMimeType = baseMimeType.startsWith('image/') ? baseMimeType : undefined

        if (baseMimeType === 'application/pdf') {
            text = await extractPdfText(buffer)
        } else if (
            baseMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
            baseMimeType === 'application/msword'
        ) {
            const result = await mammoth.extractRawText({ buffer })
            text = result.value
        } else if (baseMimeType.startsWith('image/')) {
            images = [buffer.toString('base64')]
        } else if (baseMimeType.startsWith('text/')) {
            text = buffer.toString('utf-8')
        } else {
            throw new Error(`Unsupported file type: ${mimeType}`)
        }
    } catch (err) {
        console.error('Error extracting text from file:', err)
        throw new Error('Failed to extract text from file')
    }

    const trimmedText = text?.trim()
    const textForModel = trimmedText
        ? trimmedText.slice(0, MAX_TEXT_CHARS)
        : ''

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
        const usagePayload = parsedResponse.usage
        const promptTokens = usagePayload?.prompt_tokens ?? 0
        const completionTokens = usagePayload?.completion_tokens ?? 0
        const totalTokens = usagePayload?.total_tokens ?? (promptTokens + completionTokens)
        const usage = usagePayload
            ? {
                model: parsedResponse.model,
                promptTokens,
                completionTokens,
                totalTokens,
                cost: calculateOpenAICost(parsedResponse.model, promptTokens, completionTokens),
            }
            : undefined

        return {
            parsedData: normalized,
            usage,
            model: parsedResponse.model,
        }
    } catch (error) {
        console.error('OpenAI parsing error:', error)
        throw new Error('Failed to parse resume with AI')
    }
}

export async function parseResume(buffer: Buffer, mimeType: string): Promise<ParsedCandidateData> {
    const result = await parseResumeWithUsage(buffer, mimeType)
    return result.parsedData
}
