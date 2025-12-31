import 'server-only'
import { getOpenAIConfig } from '@/lib/openai/config'
import { retry, RetryConfigs } from '@/lib/retry'
import type { HiringApplication, HiringCandidate, HiringJob } from '@/types/database'

const MODEL_PRICING_PER_1K_TOKENS: Record<string, { prompt: number; completion: number }> = {
    'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4o-mini-2024-07-18': { prompt: 0.00015, completion: 0.0006 },
    'gpt-4o': { prompt: 0.0025, completion: 0.01 },
    'gpt-4.1-mini': { prompt: 0.00015, completion: 0.0006 },
}

export type HiringMessageType = 'invite' | 'clarify' | 'reject' | 'feedback'

export type HiringMessageUsage = {
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost: number
}

export type HiringMessageDraft = {
    subject: string
    body: string
    complianceLines: string[]
    generator: 'ai' | 'template' | 'fallback'
    usage?: HiringMessageUsage
    model?: string
}

const MAX_PROMPT_CHARS = 12000

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
    const promptCost = (promptTokens / 1000) * pricing.prompt
    const completionCost = (completionTokens / 1000) * pricing.completion
    return Number((promptCost + completionCost).toFixed(6))
}

function extractContent(content: unknown): string | null {
    if (typeof content === 'string') return content
    if (Array.isArray(content)) {
        const parts = content
            .map((part) => {
                if (typeof part === 'string') return part
                if (part && typeof part === 'object' && 'text' in part && typeof (part as Record<string, unknown>).text === 'string') {
                    return (part as Record<string, string>).text
                }
                return ''
            })
            .filter(Boolean)
        return parts.join('').trim() || null
    }
    return null
}

function truncateText(value: string, max: number) {
    if (value.length <= max) return value
    return value.slice(0, max)
}

function normalizeLines(lines: unknown): string[] {
    if (!Array.isArray(lines)) return []
    return lines.map((line) => String(line).trim()).filter(Boolean)
}

function getComplianceLines(job: HiringJob, template?: Record<string, any>): string[] {
    const jobLines = normalizeLines((job as any)?.compliance_lines)
    if (jobLines.length > 0) return jobLines
    return normalizeLines(template?.compliance_lines)
}

function resolveTemplateEntry(template: unknown): { subject?: string; body?: string } | null {
    if (!template) return null
    if (typeof template === 'string') {
        return { body: template }
    }
    if (typeof template === 'object') {
        const record = template as Record<string, unknown>
        const subject =
            typeof record.subject === 'string'
                ? record.subject
                : typeof record.title === 'string'
                    ? record.title
                    : undefined
        const body =
            typeof record.body === 'string'
                ? record.body
                : typeof record.content === 'string'
                    ? record.content
                    : typeof record.message === 'string'
                        ? record.message
                        : undefined
        if (subject || body) {
            return { subject, body }
        }
    }
    return null
}

function getMessageTemplate(job: HiringJob, messageType: HiringMessageType) {
    const template = (job as any)?.template as Record<string, any> | undefined
    const jobTemplates = (job as any)?.message_templates as Record<string, unknown> | undefined
    const baseTemplates = template?.message_templates as Record<string, unknown> | undefined

    const entry = resolveTemplateEntry(jobTemplates?.[messageType])
        ?? resolveTemplateEntry(baseTemplates?.[messageType])

    return { entry, template }
}

function applyTemplateVariables(value: string, input: { candidate: HiringCandidate; job: HiringJob }) {
    const replacements: Record<string, string> = {
        first_name: input.candidate.first_name,
        last_name: input.candidate.last_name,
        full_name: `${input.candidate.first_name} ${input.candidate.last_name}`.trim(),
        job_title: input.job.title,
        location: input.job.location || '',
        company: 'The Anchor',
    }

    return value.replace(/\{\{\s?([a-z0-9_]+)\s?\}\}|\{\s?([a-z0-9_]+)\s?\}/gi, (_, key1, key2) => {
        const key = (key1 || key2 || '').toLowerCase()
        return replacements[key] || ''
    })
}

function defaultSubject(jobTitle: string, messageType: HiringMessageType) {
    if (messageType === 'invite') {
        return `Next steps for your ${jobTitle} application`
    }
    if (messageType === 'clarify') {
        return `A few questions about your ${jobTitle} application`
    }
    if (messageType === 'feedback') {
        return `Thanks for meeting us about the ${jobTitle} role`
    }
    return `Update on your ${jobTitle} application`
}

function appendComplianceLines(body: string, complianceLines: string[]) {
    if (complianceLines.length === 0) return body
    const missing = complianceLines.filter((line) => !body.includes(line))
    if (missing.length === 0) return body
    return `${body.trim()}\n\n${missing.join('\n')}`.trim()
}

function outcomeCategoryLine(category?: string | null) {
    switch (category) {
        case 'experience':
            return 'We are prioritising candidates with more direct hospitality experience for this role.'
        case 'skills':
            return 'We need someone whose skill set is a closer match for the role right now.'
        case 'availability':
            return 'We need availability that aligns more closely with the rota we are covering.'
        case 'right_to_work':
            return 'We need to move forward with candidates who can provide right to work documentation sooner.'
        case 'culture_fit':
            return 'We are focusing on candidates who are the best fit for the team at this time.'
        case 'communication':
            return 'We are prioritising candidates who are more responsive to scheduling needs.'
        case 'compensation':
            return 'We have moved ahead with candidates whose expectations align more closely with this role.'
        case 'role_closed':
            return 'The role is now filled, but we would be happy to consider you for future openings.'
        default:
            return 'We have decided to move forward with other candidates for now.'
    }
}

function buildFallbackBody(input: {
    messageType: HiringMessageType
    candidate: HiringCandidate
    job: HiringJob
    concerns: string[]
    outcomeCategory?: string | null
}) {
    const firstName = input.candidate.first_name || 'there'
    const jobTitle = input.job.title
    const greeting = `Hi ${firstName},`
    const signoff = 'Best,\nPeter at The Anchor'

    if (input.messageType === 'invite') {
        return `${greeting}\n\nThanks for applying for the ${jobTitle} role. We'd love to invite you for a quick chat to learn more and share details about the role. Could you let us know your availability over the next few days?\n\n${signoff}`
    }

    if (input.messageType === 'clarify') {
        const questions = input.concerns.slice(0, 2)
        const questionBlock = questions.length
            ? `Before we proceed, could you clarify:\n- ${questions.join('\n- ')}\n`
            : 'Before we proceed, could you confirm your availability and travel time to the pub?\n'
        return `${greeting}\n\nThanks for applying for the ${jobTitle} role. ${questionBlock}\n\n${signoff}`
    }

    if (input.messageType === 'feedback') {
        const reasonLine = outcomeCategoryLine(input.outcomeCategory)
        return `${greeting}\n\nThanks again for coming in to chat with us about the ${jobTitle} role. We appreciated the time you took to meet the team.\n\n${reasonLine} We hope the feedback is helpful, and we would be happy to keep your details on file for future opportunities.\n\n${signoff}`
    }

    return `${greeting}\n\nThanks again for applying for the ${jobTitle} role and taking the time to share your experience. We've decided to move forward with other candidates for now, but we appreciate your interest and would be happy to keep your details on file for future roles.\n\n${signoff}`
}

function defaultOutreachSubject(jobTitle: string) {
    return `New ${jobTitle} role at The Anchor`
}

function buildOutreachFallbackBody(input: { candidate: HiringCandidate; job: HiringJob; lastApplication?: HiringApplication | null }) {
    const firstName = input.candidate.first_name || 'there'
    const jobTitle = input.job.title
    const lastJobTitle = (input.lastApplication as any)?.job?.title as string | undefined
    const previousRoleLine = lastJobTitle
        ? `You applied for the ${lastJobTitle} role with us earlier.`
        : 'You applied with us previously and we wanted to follow up.'
    const greeting = `Hi ${firstName},`
    const signoff = 'Best,\nPeter at The Anchor'

    return `${greeting}\n\n${previousRoleLine} We have opened a new ${jobTitle} role and thought you might be interested. If you would like to chat or apply, just reply to this email and we can share next steps.\n\n${signoff}`
}

function getOutreachTemplate(job: HiringJob) {
    const template = (job as any)?.template as Record<string, any> | undefined
    const jobTemplates = (job as any)?.message_templates as Record<string, unknown> | undefined
    const baseTemplates = template?.message_templates as Record<string, unknown> | undefined

    const entry = resolveTemplateEntry(jobTemplates?.reengage)
        ?? resolveTemplateEntry(jobTemplates?.outreach)
        ?? resolveTemplateEntry(baseTemplates?.reengage)
        ?? resolveTemplateEntry(baseTemplates?.outreach)

    return { entry, template }
}

export async function generateHiringMessageDraft(input: {
    messageType: HiringMessageType
    job: HiringJob
    candidate: HiringCandidate
    application: HiringApplication
}): Promise<HiringMessageDraft> {
    const { entry, template } = getMessageTemplate(input.job, input.messageType)
    const complianceLines = getComplianceLines(input.job, template)
    const screening = (input.application.ai_screening_result || {}) as Record<string, any>
    const concerns = Array.isArray(screening.concerns) ? screening.concerns.map((item) => String(item)) : []
    const strengths = Array.isArray(screening.strengths) ? screening.strengths.map((item) => String(item)) : []
    const outcomeCategory = input.application.outcome_reason_category || null
    const outcomeStatus = input.application.outcome_status || null

    const { apiKey, baseUrl, eventsModel } = await getOpenAIConfig()
    const model = process.env.OPENAI_HIRING_MODEL ?? eventsModel ?? 'gpt-4o-mini'

    if (!apiKey) {
        if (entry?.body || entry?.subject) {
            const subject = entry?.subject
                ? applyTemplateVariables(entry.subject, input)
                : defaultSubject(input.job.title, input.messageType)
            const bodyRaw = entry?.body
                ? applyTemplateVariables(entry.body, input)
                : buildFallbackBody({ ...input, concerns, outcomeCategory })
            return {
                subject,
                body: appendComplianceLines(bodyRaw, complianceLines),
                complianceLines,
                generator: 'template',
            }
        }

        const fallbackBody = buildFallbackBody({ ...input, concerns, outcomeCategory })
        return {
            subject: defaultSubject(input.job.title, input.messageType),
            body: appendComplianceLines(fallbackBody, complianceLines),
            complianceLines,
            generator: 'fallback',
        }
    }

    const systemPrompt = `You write warm, respectful hiring emails from Peter at The Anchor.
Use British English, keep it concise (roughly 120-180 words), and keep the tone friendly and professional.
If the message type is feedback, provide supportive post-interview feedback without quoting internal notes.
Include the compliance lines exactly as provided, at the end of the message.`

    const templateContext = entry?.body
        ? `Template (use as a starting point if helpful):\n${entry.body}`
        : 'Template: none provided.'

    const userPrompt = [
        `Message type: ${input.messageType}`,
        `Job title: ${input.job.title}`,
        `Candidate name: ${input.candidate.first_name} ${input.candidate.last_name}`,
        `Outcome status: ${outcomeStatus ?? 'n/a'}`,
        `Outcome reason category: ${outcomeCategory ?? 'n/a'}`,
        `Screening score: ${input.application.ai_score ?? 'N/A'}`,
        `Recommendation: ${input.application.ai_recommendation ?? 'N/A'}`,
        strengths.length ? `Strengths: ${strengths.join('; ')}` : 'Strengths: none provided.',
        concerns.length ? `Concerns: ${concerns.join('; ')}` : 'Concerns: none provided.',
        `Screener answers: ${JSON.stringify(input.application.screener_answers ?? {})}`,
        templateContext,
        complianceLines.length ? `Compliance lines (must include verbatim):\n${complianceLines.join('\n')}` : 'Compliance lines: none.',
    ].join('\n')

    const response = await retry(
        async () => fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: truncateText(userPrompt, MAX_PROMPT_CHARS) },
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'hiring_message',
                        schema: {
                            type: 'object',
                            properties: {
                                subject: { type: 'string' },
                                body: { type: 'string' },
                            },
                            required: ['subject', 'body'],
                            additionalProperties: false,
                        },
                    },
                },
                max_tokens: 500,
            }),
        }),
        RetryConfigs.api
    )

    if (!response.ok) {
        throw new Error('OpenAI message request failed')
    }

    const payload = await response.json()
    const choice = payload?.choices?.[0]
    const content = extractContent(choice?.message?.content)
    if (!content) {
        throw new Error('OpenAI message returned empty content')
    }

    let parsed: { subject?: string; body?: string }
    try {
        parsed = JSON.parse(content)
    } catch (error) {
        throw new Error('Failed to parse OpenAI message response')
    }

    const subject = parsed.subject?.trim() || defaultSubject(input.job.title, input.messageType)
    const bodyRaw = parsed.body?.trim() || buildFallbackBody({ ...input, concerns, outcomeCategory })

    const usagePayload = payload?.usage
    const usage: HiringMessageUsage | undefined = usagePayload
        ? {
            model: payload?.model ?? model,
            promptTokens: usagePayload.prompt_tokens ?? 0,
            completionTokens: usagePayload.completion_tokens ?? 0,
            totalTokens: usagePayload.total_tokens ?? ((usagePayload.prompt_tokens ?? 0) + (usagePayload.completion_tokens ?? 0)),
            cost: calculateOpenAICost(
                payload?.model ?? model,
                usagePayload.prompt_tokens ?? 0,
                usagePayload.completion_tokens ?? 0
            ),
        }
        : undefined

    return {
        subject,
        body: appendComplianceLines(bodyRaw, complianceLines),
        complianceLines,
        generator: 'ai',
        usage,
        model: payload?.model ?? model,
    }
}

export async function generateHiringOutreachDraft(input: {
    job: HiringJob
    candidate: HiringCandidate
    lastApplication?: HiringApplication | null
}): Promise<HiringMessageDraft> {
    const { entry, template } = getOutreachTemplate(input.job)
    const complianceLines = getComplianceLines(input.job, template)

    const { apiKey, baseUrl, eventsModel } = await getOpenAIConfig()
    const model = process.env.OPENAI_HIRING_MODEL ?? eventsModel ?? 'gpt-4o-mini'

    if (!apiKey) {
        if (entry?.body || entry?.subject) {
            const subject = entry?.subject
                ? applyTemplateVariables(entry.subject, input)
                : defaultOutreachSubject(input.job.title)
            const bodyRaw = entry?.body
                ? applyTemplateVariables(entry.body, input)
                : buildOutreachFallbackBody(input)
            return {
                subject,
                body: appendComplianceLines(bodyRaw, complianceLines),
                complianceLines,
                generator: 'template',
            }
        }

        const fallbackBody = buildOutreachFallbackBody(input)
        return {
            subject: defaultOutreachSubject(input.job.title),
            body: appendComplianceLines(fallbackBody, complianceLines),
            complianceLines,
            generator: 'fallback',
        }
    }

    const systemPrompt = `You write warm, respectful hiring outreach emails from Peter at The Anchor.\nUse British English, keep it concise (roughly 120-180 words), and keep the tone friendly and professional.\nThe goal is to invite the candidate to reply or apply for the new role.\nInclude the compliance lines exactly as provided, at the end of the message.`

    const lastJobTitle = (input.lastApplication as any)?.job?.title as string | undefined
    const templateContext = entry?.body
        ? `Template (use as a starting point if helpful):\n${entry.body}`
        : 'Template: none provided.'

    const userPrompt = [
        `Job title: ${input.job.title}`,
        `Candidate name: ${input.candidate.first_name} ${input.candidate.last_name}`,
        lastJobTitle ? `Previous role applied for: ${lastJobTitle}` : 'Previous role: not provided.',
        `Previous outcome: ${(input.lastApplication as any)?.outcome_status ?? 'unknown'}`,
        templateContext,
        complianceLines.length ? `Compliance lines (must include verbatim):\n${complianceLines.join('\n')}` : 'Compliance lines: none.',
    ].join('\n')

    const response = await retry(
        async () => fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                temperature: 0.3,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: truncateText(userPrompt, MAX_PROMPT_CHARS) },
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'hiring_outreach_message',
                        schema: {
                            type: 'object',
                            properties: {
                                subject: { type: 'string' },
                                body: { type: 'string' },
                            },
                            required: ['subject', 'body'],
                            additionalProperties: false,
                        },
                    },
                },
                max_tokens: 500,
            }),
        }),
        RetryConfigs.api
    )

    if (!response.ok) {
        throw new Error('OpenAI outreach request failed')
    }

    const payload = await response.json()
    const choice = payload?.choices?.[0]
    const content = extractContent(choice?.message?.content)
    if (!content) {
        throw new Error('OpenAI outreach returned empty content')
    }

    let parsed: { subject?: string; body?: string }
    try {
        parsed = JSON.parse(content)
    } catch (error) {
        throw new Error('Failed to parse OpenAI outreach response')
    }

    const subject = parsed.subject?.trim() || defaultOutreachSubject(input.job.title)
    const bodyRaw = parsed.body?.trim() || buildOutreachFallbackBody(input)

    const usagePayload = payload?.usage
    const usage: HiringMessageUsage | undefined = usagePayload
        ? {
            model: payload?.model ?? model,
            promptTokens: usagePayload.prompt_tokens ?? 0,
            completionTokens: usagePayload.completion_tokens ?? 0,
            totalTokens: usagePayload.total_tokens ?? ((usagePayload.prompt_tokens ?? 0) + (usagePayload.completion_tokens ?? 0)),
            cost: calculateOpenAICost(
                payload?.model ?? model,
                usagePayload.prompt_tokens ?? 0,
                usagePayload.completion_tokens ?? 0
            ),
        }
        : undefined

    return {
        subject,
        body: appendComplianceLines(bodyRaw, complianceLines),
        complianceLines,
        generator: 'ai',
        usage,
        model: payload?.model ?? model,
    }
}
