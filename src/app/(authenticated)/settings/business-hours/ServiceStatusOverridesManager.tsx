'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  getServiceStatusOverrides,
  createServiceStatusOverride,
  deleteServiceStatusOverride,
} from '@/app/actions/business-hours'
import type { ServiceStatusOverride } from '@/types/business-hours'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { TrashIcon } from '@heroicons/react/24/outline'

interface ServiceStatusOverridesManagerProps {
  serviceCode: string
  canManage: boolean
  initialOverrides?: ServiceStatusOverride[]
}

interface OverrideFormState {
  startDate: string
  endDate: string
  message: string
}

const INITIAL_FORM: OverrideFormState = {
  startDate: '',
  endDate: '',
  message: '',
}

export function ServiceStatusOverridesManager({
  serviceCode,
  canManage,
  initialOverrides = [],
}: ServiceStatusOverridesManagerProps) {
  const [overrides, setOverrides] = useState<ServiceStatusOverride[]>(initialOverrides)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [formState, setFormState] = useState<OverrideFormState>(INITIAL_FORM)
  const [, startTransition] = useTransition()

  useEffect(() => {
    setOverrides(initialOverrides)
  }, [initialOverrides])

  useEffect(() => {
    void loadOverrides()
  }, [])

  const loadOverrides = async () => {
    setIsLoading(true)
    const result = await getServiceStatusOverrides(serviceCode)
    if (result.data) {
      setOverrides(result.data)
    } else if (result.error) {
      toast.error(result.error)
    }
    setIsLoading(false)
  }

  const handleInputChange = (field: keyof OverrideFormState) => (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    setFormState((prev) => ({
      ...prev,
      [field]: event.target.value,
    }))
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!canManage || pendingId) return

    if (!formState.startDate) {
      toast.error('Please choose a start date')
      return
    }

    const formData = new FormData()
    formData.append('start_date', formState.startDate)
    if (formState.endDate) {
      formData.append('end_date', formState.endDate)
    }
    formData.append('is_enabled', 'false')
    formData.append('message', formState.message)

    setPendingId('create')

    startTransition(async () => {
      const result = await createServiceStatusOverride(serviceCode, formData)

      if (result?.error) {
        toast.error(result.error)
        setPendingId(null)
        return
      }

      toast.success('Sunday lunch blocked for the selected dates')
      setFormState(INITIAL_FORM)
      await loadOverrides()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('service-status-overrides-updated'))
      }
      setPendingId(null)
    })
  }

  const handleDelete = (overrideId: string) => {
    if (!canManage || pendingId) return

    setPendingId(overrideId)

    startTransition(async () => {
      const result = await deleteServiceStatusOverride(overrideId)

      if (result?.error) {
        toast.error(result.error)
        setPendingId(null)
        return
      }

      toast.success('Override removed')
      await loadOverrides()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('service-status-overrides-updated'))
      }
      setPendingId(null)
    })
  }

  const formatDateRange = (start: string, end: string) => {
    const startLabel = format(new Date(start + 'T00:00:00Z'), 'EEE d MMM yyyy')
    if (start === end) {
      return startLabel
    }
    const endLabel = format(new Date(end + 'T00:00:00Z'), 'EEE d MMM yyyy')
    return `${startLabel} → ${endLabel}`
  }

  return (
    <Section
      title="Sunday Lunch Exceptions"
      description="Block specific Sundays (or ranges) for Sunday lunch bookings while keeping regular reservations available."
    >
      <Card padding="lg" className="space-y-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Start date
              </label>
              <Input
                type="date"
                value={formState.startDate}
                onChange={handleInputChange('startDate')}
                required
                disabled={!canManage || pendingId !== null}
                fullWidth
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">
                End date <span className="text-gray-400">(optional)</span>
              </label>
              <Input
                type="date"
                value={formState.endDate}
                min={formState.startDate || undefined}
                onChange={handleInputChange('endDate')}
                disabled={!canManage || pendingId !== null}
                fullWidth
              />
            </div>
            <div className="md:pt-6">
              <Button
                type="submit"
                fullWidth
                disabled={!canManage || pendingId !== null}
                loading={pendingId === 'create'}
              >
                Add closure
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Guest message (shown on the website)
            </label>
            <Input
              type="text"
              value={formState.message}
              placeholder="e.g. Sunday lunch is unavailable on 12 May due to a private event."
              onChange={handleInputChange('message')}
              disabled={!canManage || pendingId !== null}
              fullWidth
            />
          </div>
        </form>

        <div className="border-t border-gray-200 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Upcoming overrides
          </h3>

          {isLoading ? (
            <div className="text-sm text-gray-600">Loading overrides…</div>
          ) : overrides.length === 0 ? (
            <Alert variant="info">
              No Sunday lunch closures are scheduled.
            </Alert>
          ) : (
            <div className="space-y-3">
              {overrides.map((override) => (
                <div
                  key={override.id}
                  className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 border border-gray-200 rounded-lg p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {formatDateRange(override.start_date, override.end_date)}
                    </p>
                    {override.message && (
                      <p className="text-sm text-gray-600 mt-1">
                        {override.message}
                      </p>
                    )}
                  </div>
                  <IconButton
                    type="button"
                    variant="ghost"
                    aria-label="Remove override"
                    onClick={() => handleDelete(override.id)}
                    disabled={!canManage || pendingId !== null}
                    loading={pendingId === override.id}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </IconButton>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </Section>
  )
}
