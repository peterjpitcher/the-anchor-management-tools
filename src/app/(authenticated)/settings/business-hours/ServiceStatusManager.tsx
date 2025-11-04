'use client'

import { useEffect, useState, useTransition } from 'react'
import { getServiceStatuses, updateServiceStatus } from '@/app/actions/business-hours'
import type { ServiceStatus } from '@/types/business-hours'
import { Card } from '@/components/ui-v2/layout/Card'
import { Section } from '@/components/ui-v2/layout/Section'
import { Toggle } from '@/components/ui-v2/forms/Toggle'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Button } from '@/components/ui-v2/forms/Button'
import { Alert } from '@/components/ui-v2/feedback/Alert'
import toast from 'react-hot-toast'
import { ServiceStatusOverridesManager } from './ServiceStatusOverridesManager'

interface ServiceStatusManagerProps {
  canManage: boolean
}

const TARGET_SERVICES = ['sunday_lunch']

export function ServiceStatusManager({ canManage }: ServiceStatusManagerProps) {
  const [statuses, setStatuses] = useState<ServiceStatus[]>([])
  const [messageDrafts, setMessageDrafts] = useState<Record<string, string>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  useEffect(() => {
    void loadStatuses()
  }, [])

  const loadStatuses = async () => {
    setIsLoading(true)
    const result = await getServiceStatuses(TARGET_SERVICES)
    if (result.data) {
      setStatuses(result.data)
      const draftMap: Record<string, string> = {}
      result.data.forEach((status) => {
        draftMap[status.service_code] = status.message || ''
      })
      setMessageDrafts(draftMap)
    } else if (result.error) {
      toast.error(result.error)
    }
    setIsLoading(false)
  }

  const handleToggle = (service: ServiceStatus, nextValue: boolean) => {
    if (!canManage || pendingCode) return
    setPendingCode(service.service_code)

    startTransition(async () => {
      const result = await updateServiceStatus(service.service_code, {
        is_enabled: nextValue,
        message: messageDrafts[service.service_code] ?? service.message,
      })

      if (result?.error) {
        toast.error(result.error)
        setPendingCode(null)
        return
      }

      toast.success(
        nextValue
          ? `${service.display_name} enabled`
          : `${service.display_name} disabled`
      )
      await loadStatuses()
      setPendingCode(null)
    })
  }

  const handleMessageSave = (service: ServiceStatus) => {
    if (!canManage || pendingCode) return
    setPendingCode(service.service_code)

    const message = messageDrafts[service.service_code] ?? ''

    startTransition(async () => {
      const result = await updateServiceStatus(service.service_code, {
        is_enabled: service.is_enabled,
        message,
      })

      if (result?.error) {
        toast.error(result.error)
        setPendingCode(null)
        return
      }

      toast.success('Status message updated')
      await loadStatuses()
      setPendingCode(null)
    })
  }

  if (isLoading) {
    return (
      <Section title="Service Availability">
        <Card>
          <div className="py-6 text-sm text-gray-600 text-center">
            Loading service status...
          </div>
        </Card>
      </Section>
    )
  }

  return (
    <div className="space-y-6">
      <Section
        title="Service Availability"
        description="Control whether specific services accept bookings while keeping the kitchen open for regular diners."
      >
        <Card padding="lg" className="space-y-6">
        {statuses.length === 0 && (
          <Alert variant="info">
            No managed services found. Contact an administrator if this is unexpected.
          </Alert>
        )}

        {statuses.map((status) => {
          const isDisabled = !status.is_enabled
          const pending = pendingCode === status.service_code

          return (
            <div key={status.service_code} className="border border-gray-200 rounded-lg p-4 md:p-6 space-y-4">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {status.display_name}
                  </h3>
                  <p className="text-sm text-gray-600 mt-1">
                    Toggle Sunday lunch bookings while keeping the kitchen open for regular reservations.
                  </p>
                </div>
                <Toggle
                  checked={status.is_enabled}
                  onChange={(event) => handleToggle(status, event.target.checked)}
                  disabled={!canManage || pending}
                  label={status.is_enabled ? 'Accepting Sunday lunch bookings' : 'Sunday lunch bookings paused'}
                  labelPosition="left"
                  showLabels
                  onLabel="On"
                  offLabel="Off"
                  variant={status.is_enabled ? 'primary' : 'danger'}
                />
              </div>

              {isDisabled && (
                <Alert variant="warning">
                  Sunday lunch bookings are currently paused. Regular menu bookings remain open.
                </Alert>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Message shown to guests when bookings are unavailable
                </label>
                <Textarea
                  value={messageDrafts[status.service_code] ?? ''}
                  onChange={(event) =>
                    setMessageDrafts((prev) => ({
                      ...prev,
                      [status.service_code]: event.target.value,
                    }))
                  }
                  placeholder="e.g. Sunday lunch is taking a short break this week, but our regular menu is ready for you."
                  minRows={3}
                  maxRows={6}
                  disabled={!canManage || pending}
                />
                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => handleMessageSave(status)}
                    disabled={!canManage || pending}
                    loading={pending}
                  >
                    Save message
                  </Button>
                </div>
              </div>
            </div>
          )
        })}
        </Card>
      </Section>
      <ServiceStatusOverridesManager
        serviceCode="sunday_lunch"
        canManage={canManage}
      />
    </div>
  )
}
