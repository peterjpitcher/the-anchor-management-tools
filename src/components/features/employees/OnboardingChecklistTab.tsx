'use client'

import { useEffect, useState } from 'react'
import { updateOnboardingChecklist, getOnboardingProgress } from '@/app/actions/employeeActions'
import { Alert, Card, CardBody, CardHeader, Checkbox, Empty, PageLoading, ProgressBar, Spinner, toast } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'

interface OnboardingChecklistTabProps {
  employeeId: string
  canEdit: boolean
}

interface ChecklistItem {
  field: string
  label: string
  completed: boolean
  date?: string | null
}

export default function OnboardingChecklistTab({ employeeId, canEdit }: OnboardingChecklistTabProps) {
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    completed: number
    total: number
    percentage: number
    items: ChecklistItem[]
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadProgress()
  }, [employeeId])

  async function loadProgress() {
    setLoading(true)
    setError(null)

    try {
      const result = await getOnboardingProgress(employeeId)
      if (result.error) {
        setError(result.error)
      }
      setProgress(result.data ?? null)
    } catch {
      setError('Failed to load onboarding checklist.')
      setProgress(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleToggle(field: string, currentValue: boolean) {
    if (!canEdit) {
      return
    }

    setUpdating(field)
    
    const result = await updateOnboardingChecklist(employeeId, field, !currentValue)
    
    if (result.success) {
      // Reload progress
      await loadProgress()
    } else {
      // Show error
      toast.error(result.error || 'Failed to update checklist')
    }
    
    setUpdating(null)
  }

  if (loading) {
    return (
      <Card>
        <CardHeader title="Onboarding Checklist" />
        <PageLoading inline label="Loading onboarding checklist" />
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardHeader title="Onboarding Checklist" />
        <CardBody>
          <Alert tone="danger" size="sm">{error}</Alert>
        </CardBody>
      </Card>
    )
  }

  if (!progress || !progress.items || progress.items.length === 0) {
    return (
      <Card>
        <CardHeader title="Onboarding Checklist" />
        <Empty
          size="sm"
          title="No onboarding tasks yet"
          description="The checklist appears here once it is set up."
        />
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Onboarding Progress" />
        <CardBody className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text">Overall Progress</span>
            <span className="text-sm font-medium text-text">{progress.percentage}%</span>
          </div>
          <ProgressBar value={progress.percentage} tone="success" size="md" label="Onboarding progress" />
          <p className="text-sm text-text-muted">
            {progress.completed} of {progress.total} tasks completed
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Onboarding Tasks"
          subtitle="Check off each task as it's completed; the date is recorded automatically"
        />
        <ul className="divide-y divide-border">
          {progress.items.map((item) => {
            const date = item.date
            const isUpdating = updating === item.field

            return (
              <li key={item.field} className="flex items-start gap-2 px-pad-card py-4">
                <Checkbox
                  id={item.field}
                  checked={item.completed}
                  onChange={() => handleToggle(item.field, item.completed)}
                  disabled={isUpdating || !canEdit}
                  label={item.label}
                  description={item.completed && date ? `Completed on ${formatDateInLondon(date)}` : undefined}
                  className="flex-1"
                />
                {isUpdating && <Spinner size="sm" />}
              </li>
            )
          })}
        </ul>
      </Card>

      <Alert tone="info" title="Important Notes">
        <ul className="list-disc space-y-1 pl-5">
          <li>WhatsApp groups are for shift coordination and team communication</li>
          <li>Till system access requires manager approval</li>
          <li>Flow training must be completed within probation period</li>
          <li>Employment agreement must be signed before first shift</li>
        </ul>
      </Alert>

      {progress.completed === progress.total && (
        <Alert tone="success" role="status" title="Onboarding Complete!">
          All onboarding tasks have been completed. This employee is ready to start work.
        </Alert>
      )}
    </div>
  )
}
