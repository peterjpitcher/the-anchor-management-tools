'use client'

import { useEffect, useMemo, useState } from 'react'
import { updateBusinessHours } from '@/app/actions/business-hours'
import { BusinessHours, DAY_NAMES } from '@/types/business-hours'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import { Modal } from '@/components/ui-v2/overlay/Modal'
import { ScheduleConfigEditor } from './ScheduleConfigEditor'
import { Settings } from 'lucide-react'
import toast from 'react-hot-toast'

interface BusinessHoursManagerProps {
  canManage: boolean
  initialHours: BusinessHours[]
}

export function BusinessHoursManager({ canManage, initialHours }: BusinessHoursManagerProps) {
  const sanitizedInitialHours = useMemo(
    () =>
      initialHours.map((hour) => ({
        ...hour,
        is_kitchen_closed: Boolean(hour.is_kitchen_closed),
      })),
    [initialHours]
  )

  const [hours, setHours] = useState<BusinessHours[]>(sanitizedInitialHours)
  const [isSaving, setIsSaving] = useState(false)
  const [editingConfigDay, setEditingConfigDay] = useState<number | null>(null)

  useEffect(() => {
    setHours(sanitizedInitialHours)
  }, [sanitizedInitialHours])

  const handleConfigChange = (dayOfWeek: number, newConfig: any[]) => {
    if (!canManage) return
    setHours(prev => prev.map(h => 
      h.day_of_week === dayOfWeek ? { ...h, schedule_config: newConfig } : h
    ))
  }

  const handleTimeChange = (dayOfWeek: number, field: keyof BusinessHours, value: string | boolean) => {
    if (!canManage) return

    setHours(prevHours =>
      prevHours.map((h) => {
        if (h.day_of_week !== dayOfWeek) {
          return h
        }

        if (field === 'is_closed' && typeof value === 'boolean') {
          return {
            ...h,
            is_closed: value,
            opens: value ? null : h.opens,
            closes: value ? null : h.closes,
            kitchen_opens: value ? null : h.kitchen_opens,
            kitchen_closes: value ? null : h.kitchen_closes,
            is_kitchen_closed: h.is_kitchen_closed,
          }
        }

        if (field === 'is_kitchen_closed' && typeof value === 'boolean') {
          return {
            ...h,
            is_kitchen_closed: value,
            kitchen_opens: value ? null : h.kitchen_opens,
            kitchen_closes: value ? null : h.kitchen_closes,
          }
        }

        return {
          ...h,
          [field]: value === '' ? null : value,
        }
      })
    )
  }

  const handleKitchenTimeChange = (dayOfWeek: number, field: keyof BusinessHours, value: string) => {
    if (!canManage) return

    setHours((prev) =>
      prev.map((h) =>
        h.day_of_week === dayOfWeek
          ? {
              ...h,
              [field]: value === '' ? null : value,
              is_kitchen_closed: value === '' ? h.is_kitchen_closed : false,
            }
          : h
      )
    )
  }

  const handleSundayLunchTimeChange = (field: 'starts_at' | 'ends_at', value: string) => {
    if (!canManage) return
    const sundayIndex = 0 // Sunday is 0
    
    setHours(prev => prev.map(h => {
      if (h.day_of_week !== sundayIndex) return h
      
      const config = [...(h.schedule_config || [])]
      const lunchIndex = config.findIndex(c => c.booking_type === 'sunday_lunch')
      
      if (value === '') {
        // If clearing value, do nothing or remove? For now, just update if exists
        if (lunchIndex !== -1) {
           config[lunchIndex] = { ...config[lunchIndex], [field]: '' }
        }
      } else {
        if (lunchIndex !== -1) {
          config[lunchIndex] = { ...config[lunchIndex], [field]: value }
        } else {
          // Create default Sunday Lunch entry if it doesn't exist
          config.push({
            name: 'Sunday Lunch',
            starts_at: field === 'starts_at' ? value : '12:00',
            ends_at: field === 'ends_at' ? value : '16:00',
            capacity: 50,
            booking_type: 'sunday_lunch'
          })
        }
      }
      
      return { ...h, schedule_config: config }
    }))
  }

  const getSundayLunchTime = (h: BusinessHours, field: 'starts_at' | 'ends_at') => {
    const item = h.schedule_config?.find(c => c.booking_type === 'sunday_lunch')
    return item ? item[field] : ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!canManage) {
      toast.error('You do not have permission to update business hours.')
      return
    }

    setIsSaving(true)

    const formData = new FormData()
    
    hours.forEach(dayHours => {
      formData.append(`opens_${dayHours.day_of_week}`, dayHours.opens || '')
      formData.append(`closes_${dayHours.day_of_week}`, dayHours.closes || '')
      formData.append(`kitchen_opens_${dayHours.day_of_week}`, dayHours.kitchen_opens || '')
      formData.append(`kitchen_closes_${dayHours.day_of_week}`, dayHours.kitchen_closes || '')
      formData.append(`is_closed_${dayHours.day_of_week}`, dayHours.is_closed.toString())
      formData.append(`is_kitchen_closed_${dayHours.day_of_week}`, dayHours.is_kitchen_closed?.toString() || 'false')
      formData.append(`schedule_config_${dayHours.day_of_week}`, JSON.stringify(dayHours.schedule_config || []))
    })

    const result = await updateBusinessHours(formData)
    
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Business hours updated successfully')
    }
    
    setIsSaving(false)
  }

  // Reorder days to start with Monday (1) through Sunday (0)
  const reorderedHours = useMemo(
    () => [
      ...hours.filter((h) => h.day_of_week >= 1 && h.day_of_week <= 6),
      ...hours.filter((h) => h.day_of_week === 0),
    ],
    [hours]
  )

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DataTable
        data={reorderedHours}
        getRowKey={(h) => h.day_of_week}
        columns={[
          { key: 'day', header: 'Day', cell: (h: any) => <span className="text-sm font-medium text-gray-900">{DAY_NAMES[h.day_of_week]}</span> },
          { key: 'closed', header: 'Closed', cell: (h: any) => (
            <Checkbox
              checked={h.is_closed}
              onChange={(e) => handleTimeChange(h.day_of_week, 'is_closed', e.target.checked)}
              disabled={!canManage}
            />
          ) },
          { key: 'kclosed', header: 'Kitchen Closed', cell: (h: any) => (
            h.day_of_week !== 0 && (
            <Checkbox
              checked={h.is_kitchen_closed || h.is_closed}
              onChange={(e) => handleTimeChange(h.day_of_week, 'is_kitchen_closed', e.target.checked)}
              disabled={!canManage}
            />
            )
          ) },
          { key: 'opens', header: 'Opens', cell: (h: any) => (
            <Input
              type="time"
              value={h.opens || ''}
              onChange={(e) => handleTimeChange(h.day_of_week, 'opens', e.target.value)}
              disabled={!canManage || h.is_closed}
              fullWidth
            />
          ) },
          { key: 'closes', header: 'Closes', cell: (h: any) => (
            <Input
              type="time"
              value={h.closes || ''}
              onChange={(e) => handleTimeChange(h.day_of_week, 'closes', e.target.value)}
              disabled={!canManage || h.is_closed}
              fullWidth
            />
          ) },
          { key: 'kopens', header: 'Kitchen Opens', cell: (h: any) => (
            <Input
              type="time"
              value={h.kitchen_opens || ''}
              onChange={(e) => handleKitchenTimeChange(h.day_of_week, 'kitchen_opens', e.target.value)}
              disabled={!canManage || h.is_closed || h.is_kitchen_closed}
              fullWidth
            />
          ) },
          { key: 'kcloses', header: 'Kitchen Closes', cell: (h: any) => (
            <Input
              type="time"
              value={h.kitchen_closes || ''}
              onChange={(e) => handleKitchenTimeChange(h.day_of_week, 'kitchen_closes', e.target.value)}
              disabled={!canManage || h.is_closed || h.is_kitchen_closed}
              fullWidth
            />
          ) },
          { key: 'slopens', header: 'Sun Lunch Start', cell: (h: any) => (
            h.day_of_week === 0 ? (
              <Input
                type="time"
                value={getSundayLunchTime(h, 'starts_at')}
                onChange={(e) => handleSundayLunchTimeChange('starts_at', e.target.value)}
                disabled={!canManage || h.is_closed}
                fullWidth
                placeholder="-"
              />
            ) : <span className="text-gray-300 text-center block">-</span>
          ) },
          { key: 'slcloses', header: 'Sun Lunch End', cell: (h: any) => (
             h.day_of_week === 0 ? (
              <Input
                type="time"
                value={getSundayLunchTime(h, 'ends_at')}
                onChange={(e) => handleSundayLunchTimeChange('ends_at', e.target.value)}
                disabled={!canManage || h.is_closed}
                fullWidth
                placeholder="-"
              />
            ) : <span className="text-gray-300 text-center block">-</span>
          ) },
          { key: 'config', header: 'Slots', cell: (h: any) => (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditingConfigDay(h.day_of_week)}
              disabled={!canManage || h.is_closed}
              title="Configure Service Slots"
            >
              <Settings className="w-4 h-4" />
            </Button>
          ) },
        ]}
        renderMobileCard={(h: any) => (
          <Card variant="bordered" padding="sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">{DAY_NAMES[h.day_of_week]}</h3>
              <Checkbox
                label="Closed"
                checked={h.is_closed}
                onChange={(e) => handleTimeChange(h.day_of_week, 'is_closed', e.target.checked)}
                disabled={!canManage}
              />
            </div>
            <div className="mb-3">
              <Checkbox
                label="Kitchen closed"
                checked={h.is_kitchen_closed || h.is_closed}
                onChange={(e) => handleTimeChange(h.day_of_week, 'is_kitchen_closed', e.target.checked)}
                disabled={!canManage}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Opens</label>
                <Input
                  type="time"
                  value={h.opens || ''}
                  onChange={(e) => handleTimeChange(h.day_of_week, 'opens', e.target.value)}
                  disabled={!canManage || h.is_closed}
                  fullWidth
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Closes</label>
                <Input
                  type="time"
                  value={h.closes || ''}
                  onChange={(e) => handleTimeChange(h.day_of_week, 'closes', e.target.value)}
                  disabled={!canManage || h.is_closed}
                  fullWidth
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Kitchen Opens</label>
                <Input
                  type="time"
                  value={h.kitchen_opens || ''}
                  onChange={(e) => handleKitchenTimeChange(h.day_of_week, 'kitchen_opens', e.target.value)}
                  disabled={!canManage || h.is_closed || h.is_kitchen_closed}
                  fullWidth
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Kitchen Closes</label>
                <Input
                  type="time"
                  value={h.kitchen_closes || ''}
                  onChange={(e) => handleKitchenTimeChange(h.day_of_week, 'kitchen_closes', e.target.value)}
                  disabled={!canManage || h.is_closed || h.is_kitchen_closed}
                  fullWidth
                />
              </div>
            </div>
          </Card>
        )}
      />

      {editingConfigDay !== null && (
        <Modal
          open={true}
          onClose={() => setEditingConfigDay(null)}
          title={`Edit Service Slots for ${DAY_NAMES[editingConfigDay]}`}
          size="lg"
        >
          <div className="p-6">
            <ScheduleConfigEditor
              config={hours.find(h => h.day_of_week === editingConfigDay)?.schedule_config || []}
              onChange={(newConfig) => handleConfigChange(editingConfigDay, newConfig)}
            />
            <div className="mt-6 flex justify-end">
              <Button onClick={() => setEditingConfigDay(null)}>Done</Button>
            </div>
          </div>
        </Modal>
      )}

      <div className="flex justify-end pt-4">
        <Button type="submit" loading={isSaving} fullWidth={false} disabled={!canManage || isSaving}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
