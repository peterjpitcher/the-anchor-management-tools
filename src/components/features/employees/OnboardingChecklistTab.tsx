'use client'

import { useEffect, useState } from 'react'
import { updateOnboardingChecklist, getOnboardingProgress } from '@/app/actions/employeeActions'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui-v2/feedback/Toast'

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
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Onboarding Checklist</h3>
        <p className="text-gray-500">{error}</p>
      </div>
    )
  }

  if (!progress || !progress.items || progress.items.length === 0) {
    return (
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Onboarding Checklist</h3>
        <p className="text-gray-500">No onboarding tasks found. The checklist will appear here once configured.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <div className="bg-white shadow rounded-lg p-6">
        <h3 className="text-lg font-medium text-gray-900 mb-4">Onboarding Progress</h3>
        
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Overall Progress</span>
            <span className="text-sm font-medium text-gray-900">{progress.percentage}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-green-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          <p className="mt-2 text-sm text-gray-600">
            {progress.completed} of {progress.total} tasks completed
          </p>
        </div>
      </div>

      {/* Checklist Items */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="text-lg font-medium text-gray-900">Onboarding Tasks</h3>
          <p className="mt-1 text-sm text-gray-500">
            Check off each task as it&apos;s completed. Dates will be automatically recorded.
          </p>
        </div>
        
        <ul className="divide-y divide-gray-200">
          {progress.items.map((item) => {
            const date = item.date
            const isUpdating = updating === item.field
            
            return (
              <li key={item.field} className="px-6 py-4">
                <div className="flex items-start">
                  <button
                    onClick={() => handleToggle(item.field, item.completed)}
                    disabled={isUpdating || !canEdit}
                    className="flex-shrink-0 mt-0.5"
                  >
                    {isUpdating ? (
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    ) : item.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <Circle className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                    )}
                  </button>
                  
                  <div className="ml-3 flex-1">
                    <label
                      htmlFor={item.field}
                      className={`text-sm font-medium ${
                        item.completed ? 'text-gray-900 line-through' : 'text-gray-900'
                      }`}
                    >
                      {item.label}
                    </label>
                    {item.completed && date && (
                      <p className="text-sm text-gray-500">
                        Completed on {new Date(date).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </div>

      {/* Additional Information */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-900 mb-2">Important Notes</h4>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Ensure WhenIWork invite is accepted before first shift</li>
          <li>• WhatsApp groups are for shift coordination and team communication</li>
          <li>• Till system access requires manager approval</li>
          <li>• Flow training must be completed within probation period</li>
          <li>• Employment agreement must be signed before first shift</li>
        </ul>
      </div>

      {/* Special handling for Prospective employees */}
      {progress.completed === progress.total && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex">
            <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0" />
            <div className="ml-3">
              <h4 className="text-sm font-medium text-green-900">Onboarding Complete!</h4>
              <p className="text-sm text-green-800 mt-1">
                All onboarding tasks have been completed. This employee is ready to start work.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
