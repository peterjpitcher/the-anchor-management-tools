
import type { ScreeningEvidenceItem, ScreeningResult, ScreeningEligibilityItem } from './screening'

export type RubricItem = {
    key: string
    label: string
    essential: boolean
    weight: number
    evidence_question?: string
    category?: 'essential' | 'positive' | 'red_flag'
}

export type RubricConfig = {
    items: RubricItem[]
    thresholds: { invite: number; clarify: number }
    notes?: string
    clarifyQuestions?: string[]
}

export type ScreeningDiagnostics = {
    thresholds: { invite: number; clarify: number; hold: number; reject: number }
    score: { base: number; penalty: number; final: number }
    weights: { total: number; yes: number; no: number; unclear: number }
    evidenceCounts: { yes: number; no: number; unclear: number; not_stated: number; contradictory: number }
    essentialFailed: boolean
    essentialMissing: boolean
    essentialMissingCount: number
    redFlagHit: boolean
    confidence: number
    baseRecommendation: ScreeningResult['recommendation']
    finalRecommendation: ScreeningResult['recommendation']
    overrides: string[]
    resumeTextLength: number | null
    rubricItemCount: number
}

export const DEFAULT_SCORE_THRESHOLDS = {
    invite: 8,
    clarify: 6,
}

const UNCLEAR_WEIGHT_FACTOR = 0.5
const NO_PENALTY_FACTOR = 1.5
const NO_CONFIDENCE_THRESHOLD = Number(process.env.HIRING_NO_CONFIDENCE_THRESHOLD || 0.6)
const ESSENTIAL_NO_CONFIDENCE_THRESHOLD = Number(process.env.HIRING_ESSENTIAL_NO_CONFIDENCE_THRESHOLD || 0.75)

function clampScore(value: number) {
    if (!Number.isFinite(value)) return 0
    return Math.max(0, Math.min(10, Math.round(value)))
}

function slugify(value: string) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
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

function getScoreThresholds(rubric: Record<string, unknown> | null) {
    const thresholds = rubric?.score_thresholds as Record<string, unknown> | undefined
    const inviteRaw = parseThreshold(thresholds?.invite, DEFAULT_SCORE_THRESHOLDS.invite)
    const clarifyRaw = parseThreshold(thresholds?.clarify, DEFAULT_SCORE_THRESHOLDS.clarify)
    const invite = Math.max(inviteRaw, clarifyRaw)
    const clarify = Math.min(inviteRaw, clarifyRaw)
    return { invite, clarify }
}

function normalizeRubricItem(
    input: any,
    index: number,
    defaults: { essential: boolean; weight: number; category: 'essential' | 'positive' | 'red_flag' }
): RubricItem {
    if (typeof input === 'string') {
        const label = input.trim()
        return {
            key: slugify(label || `item_${index}`),
            label: label || `Requirement ${index + 1}`,
            essential: defaults.essential,
            weight: defaults.weight,
            evidence_question: label || undefined,
            category: defaults.category,
        }
    }

    const label =
        (input?.label || input?.question || input?.prompt || input?.title || input?.name || input?.key || '').toString().trim()
    const key =
        (input?.key || '').toString().trim()
        || slugify(label || `item_${index}`)
    const essentialRaw = input?.essential ?? input?.required ?? input?.nonnegotiable ?? defaults.essential
    const weightRaw = input?.weight ?? input?.score ?? input?.points ?? defaults.weight
    const weight = Number.isFinite(Number(weightRaw)) ? Math.max(0, Math.min(3, Number(weightRaw))) : defaults.weight
    const categoryRaw = (input?.category || input?.type || input?.signal_type || '').toString().toLowerCase()
    const category =
        categoryRaw === 'red_flag' || categoryRaw === 'red-flag' || categoryRaw === 'redflag'
            ? 'red_flag'
            : categoryRaw === 'essential'
                ? 'essential'
                : categoryRaw === 'positive'
                    ? 'positive'
                    : defaults.category

    return {
        key,
        label: label || key,
        essential: Boolean(essentialRaw),
        weight,
        evidence_question: (input?.evidence_question || input?.question || input?.prompt || label || '').toString() || undefined,
        category,
    }
}

function parseRubricItems(raw: any, defaults: { essential: boolean; weight: number; category: 'essential' | 'positive' | 'red_flag' }): RubricItem[] {
    if (!raw) return []
    if (typeof raw === 'string') {
        return raw
            .split('\n')
            .map((line) => line.trim().replace(/^[-*]\s*/, ''))
            .filter(Boolean)
            .map((line, index) => normalizeRubricItem(line, index, defaults))
    }
    if (Array.isArray(raw)) {
        return raw.map((item, index) => normalizeRubricItem(item, index, defaults))
    }

    if (typeof raw === 'object') {
        const record = raw as Record<string, unknown>
        const candidateArrays = [record.items, record.criteria, record.requirements, record.signals, record.checks]
        const arrayValue = candidateArrays.find((value) => Array.isArray(value))
        if (Array.isArray(arrayValue)) {
            return arrayValue.map((item, index) => normalizeRubricItem(item, index, defaults))
        }

        const ignoredKeys = new Set([
            'score_thresholds',
            'thresholds',
            'notes',
            'positive_signals',
            'positive_signals_text',
            'red_flags',
            'red_flags_text',
            'clarify_questions',
            'clarify_questions_text',
        ])
        return Object.entries(record)
            .filter(([key]) => !ignoredKeys.has(key))
            .map(([key, value], index) => {
                if (typeof value === 'object' && value !== null) {
                    return normalizeRubricItem({ key, ...(value as any) }, index, defaults)
                }
                if (typeof value === 'string') {
                    return normalizeRubricItem({ key, label: value }, index, defaults)
                }
                return normalizeRubricItem({ key, label: key }, index, defaults)
            })
            .filter(Boolean)
    }

    return []
}

function mergeRubricItems(primary: RubricItem[], secondary: RubricItem[]) {
    const byKey = new Map(primary.map((item) => [item.key, item]))
    for (const item of secondary) {
        if (!byKey.has(item.key)) {
            byKey.set(item.key, item)
        }
    }
    return Array.from(byKey.values())
}

export function buildRubricConfig(jobSnapshot: Record<string, any>): RubricConfig {
    const resolvedRubric = resolveRubric(jobSnapshot.screening_rubric)
    const rubricSource = resolvedRubric ?? jobSnapshot.screening_rubric ?? {}
    const rubricItems = parseRubricItems(rubricSource, { essential: false, weight: 1, category: 'positive' })
    const positiveSignalsRaw = (resolvedRubric as any)?.positive_signals_text ?? (resolvedRubric as any)?.positive_signals
    const redFlagsRaw = (resolvedRubric as any)?.red_flags_text ?? (resolvedRubric as any)?.red_flags
    const clarifyRaw = (resolvedRubric as any)?.clarify_questions_text ?? (resolvedRubric as any)?.clarify_questions
    const positiveItems = parseRubricItems(positiveSignalsRaw, { essential: false, weight: 1, category: 'positive' })
    const redFlagItems = parseRubricItems(redFlagsRaw, { essential: false, weight: 0, category: 'red_flag' })
    const prereqItems = parseRubricItems(jobSnapshot.prerequisites, { essential: true, weight: 2, category: 'essential' })
    const items = mergeRubricItems(prereqItems, mergeRubricItems(rubricItems, mergeRubricItems(positiveItems, redFlagItems)))
    const thresholds = getScoreThresholds(resolvedRubric || null)
    const notes = typeof (resolvedRubric as any)?.notes === 'string' ? (resolvedRubric as any).notes : undefined
    const clarifyQuestions = parseRubricItems(clarifyRaw, { essential: false, weight: 0, category: 'positive' })
        .map((item) => item.label)
        .filter(Boolean)

    return {
        items,
        thresholds,
        notes,
        clarifyQuestions: clarifyQuestions.length ? clarifyQuestions : undefined,
    }
}

export function buildEligibilityFromEvidence(items: ScreeningEvidenceItem[]): ScreeningEligibilityItem[] {
    return items.map((item) => ({
        key: item.key ?? null,
        label: item.label ?? null,
        status: item.status,
        justification: item.evidence_quotes?.length ? item.evidence_quotes.join(' | ') : 'No evidence provided.',
    }))
}

export function deriveRecommendation(score: number, thresholds: { invite: number; clarify: number }): ScreeningResult['recommendation'] {
    const rejectMax = Math.max(0, thresholds.clarify - 2)
    const holdMax = Math.max(0, thresholds.clarify - 1)

    if (score >= thresholds.invite) return 'invite'
    if (score >= thresholds.clarify) return 'clarify'
    if (score >= holdMax) return 'hold'
    if (score >= rejectMax) return 'reject'
    return 'reject'
}

export function computeDeterministicScore(input: {
    rubric: RubricConfig
    evidence: ScreeningEvidenceItem[]
    resumeText?: string | null
}): { score: number; recommendation: ScreeningResult['recommendation']; confidence: number; evidence: ScreeningEvidenceItem[]; diagnostics: ScreeningDiagnostics } {
    const rubricItems = input.rubric.items
    const evidenceByKey = new Map(
        input.evidence
            .filter((item) => item.key)
            .map((item) => [String(item.key), item])
    )

    const applyNoPolicy = (item: ScreeningEvidenceItem): ScreeningEvidenceItem => {
        if (item.status !== 'no') return item
        const contradiction = item.contradiction === true
        const confidence = item.confidence ?? 0
        if (!contradiction || confidence < NO_CONFIDENCE_THRESHOLD) {
            return { ...item, status: 'unclear', contradiction: false }
        }
        return item
    }

    const normalizedEvidence: ScreeningEvidenceItem[] = rubricItems.length
        ? rubricItems.map((item) => {
            const matched = evidenceByKey.get(item.key)
            const base: ScreeningEvidenceItem = matched
                ? { ...matched, label: matched.label ?? item.label }
                : {
                    key: item.key,
                    label: item.label,
                    status: 'not_stated',
                    evidence_quotes: [],
                    evidence_source: 'resume_chunk',
                    confidence: 0.1,
                    contradiction: false,
                }

            return applyNoPolicy(base)
        })
        : input.evidence.map((item) => applyNoPolicy(item))

    const weights = rubricItems.length
        ? rubricItems.map((item) => (item.category === 'red_flag' ? 0 : item.weight || 1))
        : normalizedEvidence.map(() => 1)

    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    let yesWeight = 0
    let noWeight = 0
    let unclearWeight = 0
    let yesCount = 0
    let noCount = 0
    let unclearCount = 0
    let notStatedCount = 0
    let contradictoryCount = 0
    let essentialFailed = false
    let essentialMissingCount = 0
    let redFlagHit = false

    normalizedEvidence.forEach((item, index) => {
        const weight = weights[index] || 1
        if (item.status === 'yes') {
            yesWeight += weight
            yesCount += 1
        }
        if (item.status === 'no') {
            noWeight += weight
            noCount += 1
        }
        if (item.status === 'unclear') {
            unclearWeight += weight
            unclearCount += 1
        }
        if (item.status === 'not_stated') {
            unclearWeight += weight
            notStatedCount += 1
        }
        if (item.status === 'contradictory') {
            unclearWeight += weight
            contradictoryCount += 1
        }

        if (rubricItems[index]?.category === 'red_flag' && item.status === 'yes') {
            redFlagHit = true
        }
    })

    if (rubricItems.length) {
        rubricItems.forEach((item) => {
            if (!item.essential) return
            const matched = normalizedEvidence.find((entry) => entry.key === item.key)
            if (matched?.status === 'no' && matched.contradiction === true && (matched.confidence ?? 0) >= ESSENTIAL_NO_CONFIDENCE_THRESHOLD) {
                essentialFailed = true
            }
            if (matched?.status !== 'yes') {
                essentialMissingCount += 1
            }
        })
    }

    const baseScore = totalWeight > 0
        ? ((yesWeight + unclearWeight * UNCLEAR_WEIGHT_FACTOR) / totalWeight) * 10
        : 0
    const penalty = totalWeight > 0 ? (noWeight / totalWeight) * NO_PENALTY_FACTOR : 0
    const score = clampScore(baseScore - penalty)

    const totalItems = normalizedEvidence.length
    const clearItems = normalizedEvidence.filter((item) => item.status === 'yes' || item.status === 'no').length
    const confidence = totalItems > 0 ? Number((clearItems / totalItems).toFixed(2)) : 0

    const thresholds = input.rubric.thresholds
    const holdThreshold = Math.max(0, thresholds.clarify - 1)
    const rejectThreshold = Math.max(0, thresholds.clarify - 2)
    const baseRecommendation = deriveRecommendation(score, thresholds)
    const overrides: string[] = []
    let recommendation = baseRecommendation
    const essentialMissing = essentialMissingCount > 0

    if (essentialFailed) {
        overrides.push('essential_failed')
        recommendation = 'reject'
    }

    if (!essentialFailed && essentialMissing && recommendation === 'invite') {
        overrides.push('essential_not_confirmed')
        recommendation = 'clarify'
    }

    if (redFlagHit && recommendation === 'invite') {
        overrides.push('red_flag')
        recommendation = 'clarify'
    }

    if (!essentialFailed && (recommendation === 'reject' || recommendation === 'hold')) {
        overrides.push('no_hard_reject')
        recommendation = 'clarify'
    }

    if (confidence < 0.5) {
        if (recommendation === 'invite' || recommendation === 'reject') {
            overrides.push('low_confidence')
            recommendation = 'clarify'
        }
    }

    if (!input.resumeText && recommendation === 'invite') {
        overrides.push('missing_resume_text')
        recommendation = 'clarify'
    }

    return {
        score,
        recommendation,
        confidence,
        evidence: normalizedEvidence,
        diagnostics: {
            thresholds: {
                invite: thresholds.invite,
                clarify: thresholds.clarify,
                hold: holdThreshold,
                reject: rejectThreshold,
            },
            score: {
                base: Number(baseScore.toFixed(2)),
                penalty: Number(penalty.toFixed(2)),
                final: score,
            },
            weights: {
                total: Number(totalWeight.toFixed(2)),
                yes: Number(yesWeight.toFixed(2)),
                no: Number(noWeight.toFixed(2)),
                unclear: Number(unclearWeight.toFixed(2)),
            },
            evidenceCounts: {
                yes: yesCount,
                no: noCount,
                unclear: unclearCount,
                not_stated: notStatedCount,
                contradictory: contradictoryCount,
            },
            essentialFailed,
            essentialMissing,
            essentialMissingCount,
            redFlagHit,
            confidence,
            baseRecommendation,
            finalRecommendation: recommendation,
            overrides,
            resumeTextLength: input.resumeText ? input.resumeText.length : null,
            rubricItemCount: normalizedEvidence.length,
        }
    }
}
