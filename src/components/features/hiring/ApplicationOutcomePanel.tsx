'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { FormGroup } from '@/components/ui-v2/forms/FormGroup'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { updateApplicationOutcomeAction } from '@/actions/hiring'

const OUTCOME_OPTIONS = [
    { value: '', label: 'No outcome recorded' },
    { value: 'hired', label: 'Hired' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'withdrawn', label: 'Withdrawn' },
    { value: 'offer_declined', label: 'Offer declined' },
    { value: 'no_show', label: 'No show' },
]

const OUTCOME_REASON_OPTIONS = [
    { value: '', label: 'No reason selected' },
    { value: 'experience', label: 'Experience level' },
    { value: 'skills', label: 'Role skills fit' },
    { value: 'availability', label: 'Availability/rota' },
    { value: 'right_to_work', label: 'Right to work' },
    { value: 'culture_fit', label: 'Culture fit' },
    { value: 'communication', label: 'Communication' },
    { value: 'compensation', label: 'Compensation expectations' },
    { value: 'role_closed', label: 'Role closed' },
    { value: 'other', label: 'Other' },
]

interface ApplicationOutcomePanelProps {
    applicationId: string
    canEdit: boolean
    initialStatus?: string | null
    initialReasonCategory?: string | null
    initialReason?: string | null
    initialNotes?: string | null
    recordedAt?: string | null
    reviewedAt?: string | null
}

export function ApplicationOutcomePanel({
    applicationId,
    canEdit,
    initialStatus,
    initialReasonCategory,
    initialReason,
    initialNotes,
    recordedAt,
    reviewedAt,
}: ApplicationOutcomePanelProps) {
    const router = useRouter()
    const [status, setStatus] = useState(initialStatus || '')
    const [reasonCategory, setReasonCategory] = useState(initialReasonCategory || '')
    const [reason, setReason] = useState(initialReason || '')
    const [notes, setNotes] = useState(initialNotes || '')
    const [reviewed, setReviewed] = useState(Boolean(reviewedAt))
    const [saving, setSaving] = useState(false)
    const requiresReview = ['rejected', 'withdrawn', 'offer_declined', 'no_show'].includes(status)

    const handleSave = async () => {
        if (requiresReview && !reviewed) {
            toast.error('Confirm manual review before saving a negative outcome')
            return
        }
        setSaving(true)
        const result = await updateApplicationOutcomeAction({
            applicationId,
            outcomeStatus: status || null,
            outcomeReasonCategory: reasonCategory || null,
            outcomeReason: reason,
            outcomeNotes: notes,
            reviewed,
        })
        setSaving(false)

        if (!result.success) {
            toast.error(result.error || 'Failed to update outcome')
            return
        }

        toast.success('Outcome saved')
        router.refresh()
    }

    return (
        <div className="bg-white shadow rounded-lg p-6 space-y-4">
            <div>
                <h3 className="text-base font-medium text-gray-900">Interview Outcome</h3>
                <p className="text-sm text-gray-500">Internal notes only. Use Messages to draft feedback emails.</p>
                {recordedAt && (
                    <p className="text-xs text-gray-400 mt-1">Recorded {new Date(recordedAt).toLocaleString()}</p>
                )}
            </div>

            <FormGroup label="Outcome Status">
                <Select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                    disabled={!canEdit}
                >
                    {OUTCOME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </Select>
            </FormGroup>

            <FormGroup label="Outcome Reason Category">
                <Select
                    value={reasonCategory}
                    onChange={(event) => setReasonCategory(event.target.value)}
                    disabled={!canEdit}
                >
                    {OUTCOME_REASON_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </Select>
            </FormGroup>

            <FormGroup label="Outcome Reason">
                <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    disabled={!canEdit}
                />
            </FormGroup>

            <FormGroup label="Outcome Notes (Private)">
                <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    rows={4}
                    disabled={!canEdit}
                />
            </FormGroup>

            {requiresReview && (
                <Checkbox
                    checked={reviewed}
                    onChange={(event) => setReviewed(event.target.checked)}
                    label="I have reviewed this outcome manually"
                    disabled={!canEdit}
                />
            )}

            <div className="flex justify-end">
                <Button type="button" onClick={handleSave} loading={saving} disabled={!canEdit}>
                    Save Outcome
                </Button>
            </div>
        </div>
    )
}
