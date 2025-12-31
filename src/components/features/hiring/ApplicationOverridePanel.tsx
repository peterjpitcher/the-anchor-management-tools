'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { overrideApplicationScreeningAction } from '@/actions/hiring'

interface ApplicationOverridePanelProps {
  applicationId: string
  currentScore?: number | null
  currentRecommendation?: string | null
  canEdit: boolean
}

const RECOMMENDATION_OPTIONS = ['invite', 'clarify', 'hold', 'reject']

export function ApplicationOverridePanel({
  applicationId,
  currentScore,
  currentRecommendation,
  canEdit,
}: ApplicationOverridePanelProps) {
  const [scoreInput, setScoreInput] = useState(currentScore != null ? String(currentScore) : '')
  const [recommendation, setRecommendation] = useState(currentRecommendation ?? '')
  const [reason, setReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    if (!canEdit) return

    let scoreValue: number | null | undefined
    if (scoreInput.trim()) {
      const parsed = Number(scoreInput)
      if (!Number.isFinite(parsed)) {
        toast.error('Enter a valid score')
        return
      }
      scoreValue = parsed
    }

    const payload = {
      applicationId,
      score: scoreValue ?? null,
      recommendation: recommendation ? recommendation : null,
      reason: reason.trim() || undefined,
    }

    setIsSaving(true)
    try {
      const result = await overrideApplicationScreeningAction(payload)
      if (!result.success) {
        toast.error(result.error || 'Failed to save override')
        return
      }
      toast.success('Override saved')
    } finally {
      setIsSaving(false)
    }
  }

  if (!canEdit) {
    return null
  }

  return (
    <div className="bg-white shadow rounded-lg p-6 space-y-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">Override AI recommendation</h4>
        <p className="text-xs text-gray-500">Update the score or recommendation with a reason.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-gray-600">Score (0-10)</label>
          <Input
            type="number"
            min={0}
            max={10}
            value={scoreInput}
            onChange={(event) => setScoreInput(event.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Recommendation</label>
          <Select
            value={recommendation}
            onChange={(event) => setRecommendation(event.target.value)}
            className="mt-1"
          >
            <option value="">Keep current</option>
            {RECOMMENDATION_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600">Reason (optional)</label>
        <Textarea
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why are you overriding the AI recommendation?"
          className="mt-1"
        />
      </div>

      <div className="flex justify-end">
        <Button variant="primary" onClick={handleSave} loading={isSaving}>
          Save override
        </Button>
      </div>
    </div>
  )
}
