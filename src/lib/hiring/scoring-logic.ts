
import type { ScreeningEvidenceItem, ScreeningResult, ScreeningEligibilityItem } from './screening'

export type RubricItem = {
    key: string
    label: string
    essential: boolean
    weight: number
    evidence_question?: string
}

export type RubricConfig = {
    items: RubricItem[]
    thresholds: { invite: number; clarify: number }
    notes?: string
}

export const DEFAULT_SCORE_THRESHOLDS = {
    invite: 8,
    clarify: 6,
}

const UNCLEAR_WEIGHT_FACTOR = 0.5
const NO_PENALTY_FACTOR = 1.5

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

function normalizeRubricItem(input: any, index: number, defaults: { essential: boolean; weight: number }): RubricItem {
    if (typeof input === 'string') {
        const label = input.trim()
        return {
            key: slugify(label || `item_${index}`),
            label: label || `Requirement ${index + 1}`,
            essential: defaults.essential,
            weight: defaults.weight,
            evidence_question: label || undefined,
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

    return {
        key,
        label: label || key,
        essential: Boolean(essentialRaw),
        weight,
        evidence_question: (input?.evidence_question || input?.question || input?.prompt || label || '').toString() || undefined,
    }
}

function parseRubricItems(raw: any, defaults: { essential: boolean; weight: number }): RubricItem[] {
    if (!raw) return []
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

        const ignoredKeys = new Set(['score_thresholds', 'thresholds', 'notes'])
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
    const resolvedRubric = resolveRubric(jobSnapshot.screening_rubric) || {}
    const rubricItems = parseRubricItems(resolvedRubric, { essential: false, weight: 1 })
    const prereqItems = parseRubricItems(jobSnapshot.prerequisites, { essential: true, weight: 2 })
    const items = mergeRubricItems(prereqItems, rubricItems)
    const thresholds = getScoreThresholds(resolvedRubric)
    const notes = typeof resolvedRubric?.notes === 'string' ? resolvedRubric.notes : undefined

    return {
        items,
        thresholds,
        notes,
    }
}

export function buildEligibilityFromEvidence(items: ScreeningEvidenceItem[]): ScreeningEligibilityItem[] {
    return items.map((item) => ({
        key: item.key ?? null,
        label: item.label ?? null,
        status: item.status,
        justification: item.evidence,
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
}): { score: number; recommendation: ScreeningResult['recommendation']; confidence: number; evidence: ScreeningEvidenceItem[] } {
    const rubricItems = input.rubric.items
    const evidenceByKey = new Map(
        input.evidence
            .filter((item) => item.key)
            .map((item) => [String(item.key), item])
    )

    const normalizedEvidence: ScreeningEvidenceItem[] = rubricItems.length
        ? rubricItems.map((item) => {
            const matched = evidenceByKey.get(item.key)
            if (matched) return { ...matched, label: matched.label ?? item.label }
            return {
                key: item.key,
                label: item.label,
                status: 'unclear',
                evidence: 'No evidence provided.',
                confidence: 'low',
            }
        })
        : input.evidence

    const weights = rubricItems.length
        ? rubricItems.map((item) => item.weight || 1)
        : normalizedEvidence.map(() => 1)

    const totalWeight = weights.reduce((sum, value) => sum + value, 0)
    let yesWeight = 0
    let noWeight = 0
    let unclearWeight = 0
    let essentialFailed = false

    normalizedEvidence.forEach((item, index) => {
        const weight = weights[index] || 1
        if (item.status === 'yes') yesWeight += weight
        if (item.status === 'no') noWeight += weight
        if (item.status === 'unclear') unclearWeight += weight
    })

    if (rubricItems.length) {
        rubricItems.forEach((item) => {
            if (!item.essential) return
            const matched = normalizedEvidence.find((entry) => entry.key === item.key)
            if (matched?.status === 'no') {
                essentialFailed = true
            }
        })
    }

    const baseScore = totalWeight > 0
        ? ((yesWeight + unclearWeight * UNCLEAR_WEIGHT_FACTOR) / totalWeight) * 10
        : 0
    const penalty = totalWeight > 0 ? (noWeight / totalWeight) * NO_PENALTY_FACTOR : 0
    const score = clampScore(baseScore - penalty)

    const totalItems = normalizedEvidence.length
    const clearItems = normalizedEvidence.filter((item) => item.status !== 'unclear').length
    const confidence = totalItems > 0 ? Number((clearItems / totalItems).toFixed(2)) : 0

    let recommendation = deriveRecommendation(score, input.rubric.thresholds)

    if (essentialFailed) {
        recommendation = score >= input.rubric.thresholds.clarify ? 'clarify' : 'reject'
    }

    if (confidence < 0.5) {
        if (recommendation === 'invite' || recommendation === 'reject') {
            recommendation = 'clarify'
        }
    }

    if (!input.resumeText && recommendation === 'invite') {
        recommendation = 'clarify'
    }

    return { score, recommendation, confidence, evidence: normalizedEvidence }
}

