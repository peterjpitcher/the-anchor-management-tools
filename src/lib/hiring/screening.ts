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

export type ScreeningUsage = {
    model: string
    promptTokens: number
    completionTokens: number
    totalTokens: number
    cost: number
}

export type ScreeningEligibilityItem = {
    key?: string | null
    label?: string | null
    status: 'yes' | 'no' | 'unclear'
    justification: string
}

export type ScreeningResult = {
    eligibility: ScreeningEligibilityItem[]
    score: number
    recommendation: 'invite' | 'clarify' | 'hold' | 'reject'
    rationale: string
    strengths?: string[]
    concerns?: string[]
    experience_analysis?: string
    draft_replies?: {
        invite?: string
        clarify?: string
        reject?: string
    }
}

type ScreeningOutcome = {
    result: ScreeningResult
    usage?: ScreeningUsage
    model: string
}

const MAX_PROMPT_CHARS = 12000
const DEFAULT_SCORE_THRESHOLDS = {
    invite: 8,
    clarify: 6,
}

function calculateOpenAICost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING_PER_1K_TOKENS[model] ?? MODEL_PRICING_PER_1K_TOKENS['gpt-4o-mini']
    const promptCost = (promptTokens / 1000) * pricing.prompt
    const completionCost = (completionTokens / 1000) * pricing.completion
    return Number((promptCost + completionCost).toFixed(6))
}

function truncateText(value: string, max: number) {
    if (value.length <= max) return value
    return value.slice(0, max)
}

function safeStringify(value: unknown, maxChars: number) {
    const raw = JSON.stringify(value ?? {}, null, 2)
    return truncateText(raw, maxChars)
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

function normalizeRecommendation(value: string | null | undefined): ScreeningResult['recommendation'] {
    const normalized = (value || '').trim().toLowerCase()
    if (normalized === 'invite') return 'invite'
    if (normalized === 'clarify') return 'clarify'
    if (normalized === 'hold') return 'hold'
    if (normalized === 'reject') return 'reject'
    return 'clarify'
}

function normalizeEligibility(items: ScreeningEligibilityItem[] | null | undefined): ScreeningEligibilityItem[] {
    if (!Array.isArray(items)) return []
    return items
        .map((item) => {
            const statusRaw = (item?.status || '').toString().toLowerCase()
            const status: ScreeningEligibilityItem['status'] =
                statusRaw === 'yes' ? 'yes' : statusRaw === 'no' ? 'no' : 'unclear'
            return {
                key: item?.key ?? null,
                label: item?.label ?? null,
                status,
                justification: (item?.justification || '').toString().slice(0, 400) || 'Not enough detail provided.',
            }
        })
        .filter((item) => item.justification.length > 0)
}

function normalizeScreeningResult(raw: ScreeningResult): ScreeningResult {
    const scoreRaw = Number(raw?.score)
    const score = Number.isFinite(scoreRaw) ? Math.min(10, Math.max(0, Math.round(scoreRaw))) : 0
    const draftReplies = raw?.draft_replies && typeof raw.draft_replies === 'object'
        ? {
            invite: (raw.draft_replies as any)?.invite?.toString().slice(0, 1200) || undefined,
            clarify: (raw.draft_replies as any)?.clarify?.toString().slice(0, 1200) || undefined,
            reject: (raw.draft_replies as any)?.reject?.toString().slice(0, 1200) || undefined,
        }
        : undefined
    return {
        eligibility: normalizeEligibility(raw?.eligibility),
        score,
        recommendation: normalizeRecommendation(raw?.recommendation),
        rationale: (raw?.rationale || '').toString().slice(0, 1200) || 'No rationale provided.',
        strengths: Array.isArray(raw?.strengths)
            ? raw.strengths.map((item) => item.toString().slice(0, 200)).filter(Boolean).slice(0, 6)
            : [],
        concerns: Array.isArray(raw?.concerns)
            ? raw.concerns.map((item) => item.toString().slice(0, 200)).filter(Boolean).slice(0, 6)
            : [],
        experience_analysis: (raw?.experience_analysis || '').toString().slice(0, 1200) || undefined,
        draft_replies: draftReplies,
    }
}

function clampScore(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(10, Math.round(value)))
}

function resolveRubric(value: unknown): Record<string, unknown> | null {
    if (!value) return null
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value)
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as Record<string, unknown>
            }
        } catch {
            return null
        }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
    }
    return null
}

function parseThreshold(value: unknown, fallback: number) {
    if (typeof value === 'number') return clampScore(value)
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return clampScore(parsed)
    }
    return fallback
}

function getScoreThresholds(rubric: unknown) {
    const resolved = resolveRubric(rubric)
    const thresholds = resolved?.score_thresholds as Record<string, unknown> | undefined
    const inviteRaw = parseThreshold(thresholds?.invite, DEFAULT_SCORE_THRESHOLDS.invite)
    const clarifyRaw = parseThreshold(thresholds?.clarify, DEFAULT_SCORE_THRESHOLDS.clarify)
    const invite = Math.max(inviteRaw, clarifyRaw)
    const clarify = Math.min(inviteRaw, clarifyRaw)
    return { invite, clarify }
}

function alignScoreWithRecommendation(result: ScreeningResult, rubric: unknown): ScreeningResult {
    const { invite, clarify } = getScoreThresholds(rubric)
    const rejectMax = Math.max(0, clarify - 1)
    const maxClarify = Math.max(clarify, invite - 1)
    let score = result.score

    // Clamp the score into the band implied by the recommendation.
    if (result.recommendation === 'invite') {
        if (score < invite) score = invite
    } else if (result.recommendation === 'clarify' || result.recommendation === 'hold') {
        if (score < clarify) score = clarify
        if (score > maxClarify) score = maxClarify
    } else if (result.recommendation === 'reject') {
        if (score > rejectMax) score = rejectMax
    }

    score = clampScore(score)
    if (score === result.score) return result
    return { ...result, score }
}

export async function screenApplicationWithAI(input: {
    job: HiringJob
    candidate: HiringCandidate
    application: HiringApplication
}): Promise<ScreeningOutcome> {
    const { apiKey, baseUrl, eventsModel } = await getOpenAIConfig()

    if (!apiKey) {
        throw new Error('OpenAI API key not configured')
    }

    const model = process.env.OPENAI_HIRING_MODEL ?? eventsModel ?? 'gpt-4o-mini'

    const template = (input.job as any)?.template as Record<string, any> | undefined

    const pickConfig = (jobValue: unknown, templateValue: unknown, fallback: unknown) => {
        if (Array.isArray(jobValue)) {
            return jobValue.length ? jobValue : (Array.isArray(templateValue) ? templateValue : fallback)
        }
        if (jobValue && typeof jobValue === 'object') {
            return Object.keys(jobValue as Record<string, unknown>).length
                ? jobValue
                : (templateValue && typeof templateValue === 'object' ? templateValue : fallback)
        }
        return templateValue ?? fallback
    }

    const jobSnapshot = {
        id: input.job.id,
        title: input.job.title,
        location: input.job.location,
        employment_type: input.job.employment_type,
        salary_range: input.job.salary_range,
        description: input.job.description,
        requirements: input.job.requirements,
        prerequisites: pickConfig(input.job.prerequisites, template?.prerequisites, []),
        screening_rubric: pickConfig(input.job.screening_rubric, template?.screening_rubric, {}),
        screening_questions: pickConfig(input.job.screening_questions, template?.screening_questions, []),
        template_id: input.job.template_id,
        template_title: template?.title,
    }

    const candidateSnapshot = {
        id: input.candidate.id,
        first_name: input.candidate.first_name,
        last_name: input.candidate.last_name,
        email: input.candidate.email,
        secondary_emails: input.candidate.secondary_emails,
        phone: input.candidate.phone,
        location: input.candidate.location,
        parsed_data: input.candidate.parsed_data,
    }

    const screenerAnswers = input.application.screener_answers ?? {}

    const systemPrompt = `You are a hiring screener for a hospitality business.
Score candidates fairly using the job requirements and any screening rubric provided.
Return JSON that matches the schema. Use "unclear" when evidence is missing.
Include a short experience analysis and draft reply suggestions for invite, clarify, and reject.
Keep the rationale concise and manager-friendly.`

    const userPrompt = [
        'Job details:',
        safeStringify(jobSnapshot, 5000),
        '',
        'Candidate profile (parsed from CV when available):',
        safeStringify(candidateSnapshot, 4000),
        '',
        'Candidate screening answers:',
        safeStringify(screenerAnswers, 2000),
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
                temperature: 0.2,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: truncateText(userPrompt, MAX_PROMPT_CHARS) },
                ],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'hiring_screening',
                        schema: {
                            type: 'object',
                            properties: {
                                eligibility: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            key: { type: ['string', 'null'] },
                                            label: { type: ['string', 'null'] },
                                            status: { type: 'string', enum: ['yes', 'no', 'unclear'] },
                                            justification: { type: 'string' },
                                        },
                                        required: ['status', 'justification'],
                                        additionalProperties: false,
                                    },
                                },
                                score: { type: 'integer', minimum: 0, maximum: 10 },
                                recommendation: { type: 'string', enum: ['invite', 'clarify', 'hold', 'reject'] },
                                rationale: { type: 'string' },
                                strengths: { type: 'array', items: { type: 'string' } },
                                concerns: { type: 'array', items: { type: 'string' } },
                                experience_analysis: { type: 'string' },
                                draft_replies: {
                                    type: 'object',
                                    properties: {
                                        invite: { type: 'string' },
                                        clarify: { type: 'string' },
                                        reject: { type: 'string' },
                                    },
                                    required: ['invite', 'clarify', 'reject'],
                                    additionalProperties: false,
                                },
                            },
                            required: ['eligibility', 'score', 'recommendation', 'rationale', 'experience_analysis', 'draft_replies'],
                            additionalProperties: false,
                        },
                    },
                },
                max_tokens: 800,
            }),
        }),
        RetryConfigs.api
    )

    if (!response.ok) {
        console.error('OpenAI screening request failed', await response.text())
        throw new Error('OpenAI screening request failed')
    }

    const payload = await response.json()
    const choice = payload?.choices?.[0]
    const content = extractContent(choice?.message?.content)
    if (!content) {
        throw new Error('OpenAI screening returned empty content')
    }

    let parsed: ScreeningResult
    try {
        parsed = JSON.parse(content)
    } catch (error) {
        console.error('Failed to parse OpenAI screening response', error)
        throw new Error('Failed to parse OpenAI screening response')
    }

    const normalized = normalizeScreeningResult(parsed)
    const result = alignScoreWithRecommendation(normalized, jobSnapshot.screening_rubric)
    const usagePayload = payload?.usage
    const usage: ScreeningUsage | undefined = usagePayload
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

    return { result, usage, model: payload?.model ?? model }
}
