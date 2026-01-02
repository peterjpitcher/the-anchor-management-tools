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

    const evidenceItems = useMemo(() => {
        if (Array.isArray(screeningResult?.evidence)) return screeningResult.evidence
        if (Array.isArray(screeningResult?.eligibility)) {
            return screeningResult.eligibility.map((item: any) => ({
                key: item.key ?? null,
                label: item.label ?? null,
                status: item.status ?? 'unclear',
                evidence: item.justification ?? '',
                confidence: 'low'
            }))
        }
        return []
    }, [screeningResult])

    const handleRerun = async () => {
        if (!canEdit) return
        setIsSubmitting(true)
        try {
            const result = await rerunApplicationScreeningAction({
                applicationId,
                reason: rerunReason.trim() || undefined,
            })
            if (!result.success) {
                toast.error(result.error || 'Failed to rerun screening')
                return
            }
            toast.success('Screening rerun queued')
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
                            <Button size="sm" variant="ghost" onClick={() => setRerunOpen(true)}>
                                Re-screen
                            </Button>
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
                                const badgeVariant = status === 'yes' ? 'success' : status === 'no' ? 'error' : 'warning'
                                return (
                                    <div key={index} className="flex items-start gap-3">
                                        <Badge variant={badgeVariant} size="sm">
                                            {status.toUpperCase()}
                                        </Badge>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">
                                                {item?.label || item?.key || 'Requirement'}
                                            </div>
                                            {item?.evidence && (
                                                <div className="text-xs text-gray-600">{item.evidence}</div>
                                            )}
                                            {item?.confidence && (
                                                <div className="text-xs text-gray-400">Confidence: {String(item.confidence)}</div>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
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
                title="Re-screen application"
                description="Optionally add a reason for re-screening."
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
                        Queue re-screen
                    </Button>
                </div>
            </Modal>
        </div>
    )
}
