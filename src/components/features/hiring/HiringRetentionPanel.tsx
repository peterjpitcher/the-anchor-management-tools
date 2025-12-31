'use client'

import { useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Toggle } from '@/components/ui-v2/forms/Toggle'
import { Card } from '@/components/ui-v2/layout/Card'
import { EmptyState } from '@/components/ui-v2/display/EmptyState'
import { Badge } from '@/components/ui-v2/display/Badge'
import { formatDate } from '@/lib/utils'
import {
  anonymizeHiringCandidateAction,
  deleteHiringCandidateAction,
  previewHiringRetentionCandidatesAction,
  runHiringRetentionAction,
  updateHiringRetentionPolicyAction,
} from '@/actions/hiring-retention'
import type { HiringRetentionAction, RetentionCandidateSummary } from '@/lib/hiring/retention'

type RetentionPolicy = {
  retentionDays: number
  action: HiringRetentionAction
  enabled: boolean
}

interface HiringRetentionPanelProps {
  initialPolicy: RetentionPolicy
  initialCandidates: RetentionCandidateSummary[]
}

export function HiringRetentionPanel({ initialPolicy, initialCandidates }: HiringRetentionPanelProps) {
  const [policy, setPolicy] = useState<RetentionPolicy>(initialPolicy)
  const [candidates, setCandidates] = useState<RetentionCandidateSummary[]>(initialCandidates)
  const [isSaving, setIsSaving] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null)

  const candidateCountLabel = useMemo(() => {
    if (candidates.length === 0) return 'None'
    return String(candidates.length)
  }, [candidates.length])

  const refreshCandidates = async (overrideDays?: number) => {
    const result = await previewHiringRetentionCandidatesAction({ retentionDays: overrideDays })
    if (!result.success) {
      toast.error(result.error || 'Failed to refresh retention candidates')
      return
    }

    setCandidates(result.data || [])
    if (result.policy) {
      setPolicy(result.policy as RetentionPolicy)
    }
  }

  const handleSavePolicy = async () => {
    setIsSaving(true)
    try {
      const result = await updateHiringRetentionPolicyAction(policy)
      if (!result.success) {
        toast.error(result.error || 'Failed to update retention policy')
        return
      }
      toast.success('Retention policy updated')
      await refreshCandidates(result.data?.retentionDays)
    } finally {
      setIsSaving(false)
    }
  }

  const handleRunRetention = async () => {
    if (!policy.enabled) {
      toast.error('Retention policy is disabled')
      return
    }
    const confirm = window.confirm(`Run retention now using ${policy.action} mode?`)
    if (!confirm) return

    setIsRunning(true)
    try {
      const result = await runHiringRetentionAction()
      if (!result.success) {
        toast.error(result.error || 'Failed to run retention')
        return
      }
      toast.success(`Processed ${result.processed ?? 0} candidate(s)`) 
      await refreshCandidates()
    } finally {
      setIsRunning(false)
    }
  }

  const handleCandidateAction = async (candidateId: string, action: HiringRetentionAction) => {
    const confirmLabel = action === 'delete'
      ? 'Permanently delete this candidate and all related records?'
      : 'Anonymize this candidate and remove personal data?'
    const confirm = window.confirm(confirmLabel)
    if (!confirm) return

    setBusyCandidateId(candidateId)
    try {
      const result = action === 'delete'
        ? await deleteHiringCandidateAction(candidateId)
        : await anonymizeHiringCandidateAction(candidateId)

      if (!result.success) {
        toast.error(result.error || 'Retention action failed')
        return
      }
      toast.success(action === 'delete' ? 'Candidate deleted' : 'Candidate anonymized')
      setCandidates((prev) => prev.filter((candidate) => candidate.id !== candidateId))
    } finally {
      setBusyCandidateId(null)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">Retention policy</h3>
              <p className="text-sm text-gray-500">Configure how long hiring records are kept before cleanup.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <label className="text-sm font-medium text-gray-700">Retention window (days)</label>
                <Input
                  type="number"
                  min={1}
                  value={policy.retentionDays}
                  onChange={(event) =>
                    setPolicy((prev) => ({
                      ...prev,
                      retentionDays: Number(event.target.value || prev.retentionDays),
                    }))
                  }
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-gray-700">Default action</label>
                <Select
                  value={policy.action}
                  onChange={(event) =>
                    setPolicy((prev) => ({
                      ...prev,
                      action: event.target.value === 'delete' ? 'delete' : 'anonymize',
                    }))
                  }
                  className="mt-1"
                >
                  <option value="anonymize">Anonymize</option>
                  <option value="delete">Delete</option>
                </Select>
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Toggle
                  checked={policy.enabled}
                  onChange={() => setPolicy((prev) => ({ ...prev, enabled: !prev.enabled }))}
                />
                <span className="text-sm font-medium text-gray-700">Retention enabled</span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="secondary" onClick={() => refreshCandidates()}>
              Refresh list
            </Button>
            <Button variant="primary" loading={isSaving} onClick={handleSavePolicy}>
              Save policy
            </Button>
            <Button variant="danger" loading={isRunning} onClick={handleRunRetention}>
              Run retention
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Candidates eligible for retention</h3>
            <p className="text-sm text-gray-500">Candidates with no activity in the last {policy.retentionDays} days.</p>
          </div>
          <Badge variant={candidates.length > 0 ? 'warning' : 'success'}>{candidateCountLabel}</Badge>
        </div>

        {candidates.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No candidates to process"
              description="All hiring records are within the retention window."
              icon="inbox"
            />
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Candidate</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Last activity</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Applications</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">Last outcome</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {candidates.map((candidate) => (
                  <tr key={candidate.id}>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">
                        {candidate.firstName} {candidate.lastName}
                      </div>
                      <div className="text-xs text-gray-500">{candidate.email}</div>
                      {candidate.lastJobTitle && (
                        <div className="text-xs text-gray-400">Last role: {candidate.lastJobTitle}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {formatDate(candidate.lastActivityAt)}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {candidate.applicationCount}
                      {candidate.lastAppliedAt ? ` (last ${formatDate(candidate.lastAppliedAt)})` : ''}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {candidate.lastOutcome || candidate.lastStage || 'Unknown'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant={policy.action === 'delete' ? 'danger' : 'secondary'}
                        size="sm"
                        loading={busyCandidateId === candidate.id}
                        onClick={() => handleCandidateAction(candidate.id, policy.action)}
                      >
                        {policy.action === 'delete' ? 'Delete' : 'Anonymize'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
