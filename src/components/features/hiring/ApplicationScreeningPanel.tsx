'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import { Badge } from '@/components/ui-v2/display/Badge'
import { Button } from '@/components/ui-v2/forms/Button'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { rerunApplicationScreeningAction, setActiveScreeningRunAction } from '@/actions/hiring-screening'
import type { HiringScreeningRun } from '@/types/database'

interface ApplicationScreeningPanelProps {
    applicationId: string
    screeningResult: any | null
    screeningStatus?: string | null
    screeningError?: string | null
    score?: number | null
    recommendation?: string | null
    confidence?: number | null
    latestRunId?: string | null
    runs: HiringScreeningRun[]
    canEdit: boolean
}

export function ApplicationScreeningPanel({
    applicationId,
    screeningResult,
    screeningStatus,
    screeningError,
    score,
    recommendation,
    confidence,
    latestRunId,
    runs,
    canEdit,
}: ApplicationScreeningPanelProps) {
    const router = useRouter()
    const [rerunOpen, setRerunOpen] = useState(false)
    const [rerunReason, setRerunReason] = useState('')
    const [rerunType, setRerunType] = useState<'manual' | 'second_opinion'>('manual')
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isSettingActive, setIsSettingActive] = useState<string | null>(null)

    useEffect(() => {
        if (screeningStatus === 'processing' || screeningStatus === 'pending') {
            const interval = setInterval(() => {
                router.refresh()
            }, 5000)
            return () => clearInterval(interval)
        }
    }, [screeningStatus, router])

    const recommendationLabel = recommendation
        ? recommendation.charAt(0).toUpperCase() + recommendation.slice(1)
        : 'Pending'
    const recommendationVariant =
        recommendation === 'invite'
            ? 'success'
            : recommendation === 'clarify'
                ? 'warning'
                : recommendation === 'hold'
                    ? 'info'
                    : recommendation === 'reject'
                        ? 'error'
                        : 'neutral'

    const confidenceLabel = confidence != null ? `${Math.round(confidence * 100)}%` : 'N/A'
    const showError = Boolean(screeningError) && screeningStatus !== 'success'
    const showInProgress = !showError && (screeningStatus === 'processing' || screeningStatus === 'pending')
    const diagnostics = screeningResult?.diagnostics
    const overrideLabels = Array.isArray(diagnostics?.overrides) ? diagnostics.overrides : []

    const evidenceItems = useMemo(() => {
        const raw = Array.isArray(screeningResult?.evidence)
            ? screeningResult.evidence
            : Array.isArray(screeningResult?.eligibility)
                ? screeningResult.eligibility
                : []

        return raw.map((item: any) => {
            const statusRaw = (item?.status || 'unclear').toString().toLowerCase()
            const status = ['yes', 'no', 'unclear', 'not_stated', 'contradictory'].includes(statusRaw)
                ? statusRaw
                : 'unclear'
            const quotes = Array.isArray(item?.evidence_quotes)
                ? item.evidence_quotes.map((quote: any) => quote?.toString()).filter(Boolean)
                : item?.evidence
                    ? [item.evidence.toString()]
                    : item?.justification
                        ? [item.justification.toString()]
                        : []
            const anchors = Array.isArray(item?.evidence_anchors)
                ? item.evidence_anchors.map((anchor: any) => anchor?.toString()).filter(Boolean)
                : []
            const source = item?.evidence_source?.toString() || ''
            const confidenceRaw = item?.confidence
            const confidence = typeof confidenceRaw === 'number'
                ? confidenceRaw
                : typeof confidenceRaw === 'string'
                    ? confidenceRaw.toLowerCase() === 'high'
                        ? 0.9
                        : confidenceRaw.toLowerCase() === 'medium'
                            ? 0.6
                            : 0.3
                    : null
            const pageRefs = Array.isArray(item?.page_refs)
                ? item.page_refs.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value))
                : null

            return {
                key: item?.key ?? null,
                label: item?.label ?? null,
                status,
                evidence_quotes: quotes.slice(0, 3),
                evidence_anchors: anchors.slice(0, 3),
                evidence_source: source,
                confidence,
                page_refs: pageRefs && pageRefs.length ? pageRefs : null,
            }
        })
    }, [screeningResult])

    const handleRerun = async () => {
        if (!canEdit) return
        setIsSubmitting(true)
        try {
            const result = await rerunApplicationScreeningAction({
                applicationId,
                reason: rerunReason.trim() || undefined,
                runType: rerunType,
            })
            if (!result.success) {
                toast.error(result.error || 'Failed to rerun screening')
                return
            }
            toast.success(rerunType === 'second_opinion' ? 'Second opinion queued' : 'Screening rerun queued')
            setRerunOpen(false)
            setRerunReason('')
        } finally {
            setIsSubmitting(false)
        }
    }

    const handleSetActive = async (runId: string) => {
        if (!canEdit) return
        setIsSettingActive(runId)
        try {
            const result = await setActiveScreeningRunAction({ applicationId, runId })
            if (!result.success) {
                toast.error(result.error || 'Failed to set active screening')
                return
            }
            toast.success('Active screening updated')
        } finally {
            setIsSettingActive(null)
        }
    }

    return (
        <div className="space-y-6">
            <div className="bg-white shadow rounded-lg p-6 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 className="text-lg font-medium text-gray-900">AI Screening</h3>
                        <p className="text-sm text-gray-500">Review before sending any response.</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <Badge variant="info">Score {score ?? 'N/A'}/10</Badge>
                        <Badge variant={recommendationVariant}>{recommendationLabel}</Badge>
                        <Badge variant="secondary">Confidence {confidenceLabel}</Badge>
                        {canEdit && (
                            <>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setRerunType('manual')
                                        setRerunOpen(true)
                                    }}
                                >
                                    Re-screen
                                </Button>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setRerunType('second_opinion')
                                        setRerunOpen(true)
                                    }}
                                >
                                    Second opinion
                                </Button>
                            </>
                        )}
                    </div>
                </div>

                {showError && (
                    <div className="bg-red-50 border-l-4 border-red-500 p-4 text-sm text-red-700">
                        Screening failed: {screeningError || 'Unknown error'}
                    </div>
                )}
                {showInProgress && (
                    <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 text-sm text-yellow-700">
                        Screening is in progress. Check back shortly for AI results.
                    </div>
                )}

                {screeningResult?.rationale && (
                    <div className="text-sm text-gray-700">{screeningResult.rationale}</div>
                )}

                {screeningResult?.experience_analysis && (
                    <div className="text-sm text-gray-700">
                        <h4 className="text-sm font-semibold text-gray-900 mb-1">Experience analysis</h4>
                        <p>{screeningResult.experience_analysis}</p>
                    </div>
                )}

                {evidenceItems.length > 0 && (
                    <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-gray-900">Evidence checklist</h4>
                        <div className="space-y-2">
                            {evidenceItems.map((item: any, index: number) => {
                                const status = item?.status || 'unclear'
                                const badgeVariant = status === 'yes'
                                    ? 'success'
                                    : status === 'no'
                                        ? 'error'
                                        : status === 'not_stated'
                                            ? 'neutral'
                                            : 'warning'
                                const statusLabel = status.replace('_', ' ').toUpperCase()
                                const quotes = Array.isArray(item.evidence_quotes) ? item.evidence_quotes : []
                                const anchors = Array.isArray(item.evidence_anchors) ? item.evidence_anchors : []
                                const confidenceLabel = typeof item.confidence === 'number'
                                    ? `${Math.round(item.confidence * 100)}%`
                                    : item.confidence
                                        ? String(item.confidence)
                                        : null
                                const sourceLabel = item.evidence_source
                                    ? item.evidence_source === 'resume_chunk'
                                        ? 'Resume'
                                        : item.evidence_source === 'application_answer'
                                            ? 'Answers'
                                            : 'Mixed'
                                    : null
                                return (
                                    <div key={index} className="flex items-start gap-3">
                                        <Badge variant={badgeVariant} size="sm">
                                            {statusLabel}
                                        </Badge>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {item?.label || item?.key || 'Requirement'}
                                            </div>
                                            {quotes.length > 0 && (
                                                <div className="text-xs text-gray-600 space-y-1">
                                                    {quotes.map((quote: string, quoteIndex: number) => (
                                                        <div key={quoteIndex}>
                                                            &quot;{quote}&quot;
                                                            {anchors[quoteIndex] ? ` (${anchors[quoteIndex]})` : ''}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                            {(sourceLabel || item.page_refs || confidenceLabel) && (
                                                <div className="text-xs text-gray-400">
                                                    {sourceLabel ? `Source: ${sourceLabel}` : ''}
                                                    {sourceLabel && item.page_refs ? ' • ' : ''}
                                                    {item.page_refs ? `Pages: ${item.page_refs.join(', ')}` : ''}
                                                    {(sourceLabel || item.page_refs) && confidenceLabel ? ' • ' : ''}
                                                    {confidenceLabel ? `Confidence: ${confidenceLabel}` : ''}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                )}

                {diagnostics && (
                    <div className="text-sm text-gray-700 space-y-2">
                        <h4 className="text-sm font-semibold text-gray-900">Scoring details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                                <div className="text-xs text-gray-500">Thresholds</div>
                                <div className="text-sm text-gray-700">
                                    Invite {'>='} {diagnostics.thresholds?.invite ?? 'n/a'}, Clarify {'>='} {diagnostics.thresholds?.clarify ?? 'n/a'}, Hold {'>='} {diagnostics.thresholds?.hold ?? 'n/a'}, Reject {'>='} {diagnostics.thresholds?.reject ?? 'n/a'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Base vs Final</div>
                                <div className="text-sm text-gray-700">
                                    {diagnostics.score?.base ?? 'n/a'} base - {diagnostics.score?.penalty ?? 'n/a'} penalty = {diagnostics.score?.final ?? score ?? 'n/a'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Evidence counts</div>
                                <div className="text-sm text-gray-700">
                                    Yes {diagnostics.evidenceCounts?.yes ?? 0}, No {diagnostics.evidenceCounts?.no ?? 0}, Unclear {diagnostics.evidenceCounts?.unclear ?? 0}, Not stated {diagnostics.evidenceCounts?.not_stated ?? 0}, Contradictory {diagnostics.evidenceCounts?.contradictory ?? 0}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Weights</div>
                                <div className="text-sm text-gray-700">
                                    Yes {diagnostics.weights?.yes ?? 0}, No {diagnostics.weights?.no ?? 0}, Unclear {diagnostics.weights?.unclear ?? 0} (Total {diagnostics.weights?.total ?? 0})
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Overrides</div>
                                <div className="text-sm text-gray-700">
                                    {overrideLabels.length ? overrideLabels.join(', ') : 'None'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Recommendation path</div>
                                <div className="text-sm text-gray-700">
                                    {diagnostics.baseRecommendation ?? 'n/a'} {'->'} {diagnostics.finalRecommendation ?? recommendation ?? 'n/a'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Essential failed</div>
                                <div className="text-sm text-gray-700">
                                    {diagnostics.essentialFailed ? 'Yes' : 'No'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Essentials missing</div>
                                <div className="text-sm text-gray-700">
                                    {diagnostics.essentialMissing ? 'Yes' : 'No'} ({diagnostics.essentialMissingCount ?? 0})
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Raw model</div>
                                <div className="text-sm text-gray-700">
                                    {screeningResult?.model_score ?? 'n/a'}/10, {screeningResult?.model_recommendation ?? 'n/a'}
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">Resume text length</div>
                                <div className="text-sm text-gray-700">
                                    {diagnostics.resumeTextLength ?? 'n/a'}
                                </div>
                            </div>
                            {screeningResult?.computed_signals && (
                                <div>
                                    <div className="text-xs text-gray-500">Computed signals</div>
                                    <div className="text-sm text-gray-700">
                                        Bar months {screeningResult.computed_signals.bar_experience_months ?? 'n/a'}, Bar roles {Array.isArray(screeningResult.computed_signals.bar_roles_detected) ? screeningResult.computed_signals.bar_roles_detected.join(', ') || 'n/a' : 'n/a'}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.isArray(screeningResult?.strengths) && screeningResult.strengths.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Strengths</h4>
                            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {screeningResult.strengths.map((item: string, index: number) => (
                                    <li key={index}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {Array.isArray(screeningResult?.concerns) && screeningResult.concerns.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Concerns / Missing info</h4>
                            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {screeningResult.concerns.map((item: string, index: number) => (
                                    <li key={index}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                    {Array.isArray(screeningResult?.clarify_questions) && screeningResult.clarify_questions.length > 0 && (
                        <div>
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Questions to clarify</h4>
                            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">
                                {screeningResult.clarify_questions.map((item: string, index: number) => (
                                    <li key={index}>{item}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
                <h4 className="text-sm font-semibold text-gray-900 mb-3">Screening runs</h4>
                {runs.length === 0 ? (
                    <p className="text-sm text-gray-500">No screening runs yet.</p>
                ) : (
                    <div className="space-y-3">
                        {runs.map((run) => {
                            const isActive = run.id === latestRunId
                            const runConfidence = run.confidence != null ? `${Math.round(run.confidence * 100)}%` : 'N/A'
                            return (
                                <div key={run.id} className="flex flex-wrap items-center justify-between gap-3 border border-gray-200 rounded-md p-3">
                                    <div>
                                        <div className="text-sm font-medium text-gray-900">
                                            {new Date(run.created_at).toLocaleString()}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                            {run.run_type} • {run.status}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-sm">
                                        <Badge variant="info">{run.score_calibrated ?? 'N/A'}/10</Badge>
                                        <Badge variant="secondary">{run.recommendation_calibrated ?? 'n/a'}</Badge>
                                        <Badge variant="secondary">Confidence {runConfidence}</Badge>
                                        {isActive && <Badge variant="success">Active</Badge>}
                                    </div>
                                    {canEdit && !isActive && run.status === 'success' && (
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleSetActive(run.id)}
                                            loading={isSettingActive === run.id}
                                        >
                                            Set active
                                        </Button>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <Modal
                open={rerunOpen}
                onClose={() => setRerunOpen(false)}
                title={rerunType === 'second_opinion' ? 'Run second opinion' : 'Re-screen application'}
                description={rerunType === 'second_opinion'
                    ? 'Runs a full-CV pass with the timeline context. Optionally add a reason.'
                    : 'Optionally add a reason for re-screening.'
                }
                size="md"
            >
                <FormGroup label="Reason (optional)">
                    <Textarea
                        value={rerunReason}
                        onChange={(event) => setRerunReason(event.target.value)}
                        rows={4}
                        placeholder="Explain why you're re-screening this application..."
                    />
                </FormGroup>
                <div className="mt-6 flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => setRerunOpen(false)} disabled={isSubmitting}>
                        Cancel
                    </Button>
                    <Button variant="primary" onClick={handleRerun} loading={isSubmitting}>
                        {rerunType === 'second_opinion' ? 'Queue second opinion' : 'Queue re-screen'}
                    </Button>
                </div>
            </Modal>
        </div>
    )
}
