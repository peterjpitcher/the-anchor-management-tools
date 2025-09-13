'use client'

import { useEffect, useState } from 'react'
import { getBusinessHours, updateBusinessHours } from '@/app/actions/business-hours'
import { BusinessHours, DAY_NAMES } from '@/types/business-hours'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Card } from '@/components/ui-v2/layout/Card'
import { DataTable } from '@/components/ui-v2/display/DataTable'
import toast from 'react-hot-toast'

export function BusinessHoursManager() {
  const [hours, setHours] = useState<BusinessHours[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    loadBusinessHours()
  }, [])

  const loadBusinessHours = async () => {
    const result = await getBusinessHours()
    if (result.data) {
      setHours(result.data)
    } else if (result.error) {
      toast.error(result.error)
    }
    setIsLoading(false)
  }

  const handleTimeChange = (dayOfWeek: number, field: keyof BusinessHours, value: string | boolean) => {
    setHours(prevHours => 
      prevHours.map(h => 
        h.day_of_week === dayOfWeek 
          ? { ...h, [field]: value === '' ? null : value }
          : h
      )
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    const formData = new FormData()
    
    hours.forEach(dayHours => {
      formData.append(`opens_${dayHours.day_of_week}`, dayHours.opens || '')
      formData.append(`closes_${dayHours.day_of_week}`, dayHours.closes || '')
      formData.append(`kitchen_opens_${dayHours.day_of_week}`, dayHours.kitchen_opens || '')
      formData.append(`kitchen_closes_${dayHours.day_of_week}`, dayHours.kitchen_closes || '')
      formData.append(`is_closed_${dayHours.day_of_week}`, dayHours.is_closed.toString())
    })

    const result = await updateBusinessHours(formData)
    
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Business hours updated successfully')
    }
    
    setIsSaving(false)
  }

  if (isLoading) {
    return <div className="text-center py-4">Loading business hours...</div>
  }

  // Reorder days to start with Monday (1) through Sunday (0)
  const reorderedHours = [
    ...hours.filter(h => h.day_of_week >= 1 && h.day_of_week <= 6),
    ...hours.filter(h => h.day_of_week === 0)
  ]

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DataTable
        data={reorderedHours}
        getRowKey={(h) => h.day_of_week}
        columns={[
          { key: 'day', header: 'Day', cell: (h: any) => <span className="text-sm font-medium text-gray-900">{DAY_NAMES[h.day_of_week]}</span> },
          { key: 'closed', header: 'Closed', cell: (h: any) => (
            <Checkbox checked={h.is_closed} onChange={(e) => handleTimeChange(h.day_of_week, 'is_closed', e.target.checked)} />
          ) },
          { key: 'opens', header: 'Opens', cell: (h: any) => (
            <Input type="time" value={h.opens || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'opens', e.target.value)} disabled={h.is_closed} fullWidth />
          ) },
          { key: 'closes', header: 'Closes', cell: (h: any) => (
            <Input type="time" value={h.closes || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'closes', e.target.value)} disabled={h.is_closed} fullWidth />
          ) },
          { key: 'kopens', header: 'Kitchen Opens', cell: (h: any) => (
            <Input type="time" value={h.kitchen_opens || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'kitchen_opens', e.target.value)} disabled={h.is_closed} fullWidth />
          ) },
          { key: 'kcloses', header: 'Kitchen Closes', cell: (h: any) => (
            <Input type="time" value={h.kitchen_closes || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'kitchen_closes', e.target.value)} disabled={h.is_closed} fullWidth />
          ) },
        ]}
        renderMobileCard={(h: any) => (
          <Card variant="bordered" padding="sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">{DAY_NAMES[h.day_of_week]}</h3>
              <Checkbox label="Closed" checked={h.is_closed} onChange={(e) => handleTimeChange(h.day_of_week, 'is_closed', e.target.checked)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">Opens</label>
                <Input type="time" value={h.opens || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'opens', e.target.value)} disabled={h.is_closed} fullWidth />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Closes</label>
                <Input type="time" value={h.closes || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'closes', e.target.value)} disabled={h.is_closed} fullWidth />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Kitchen Opens</label>
                <Input type="time" value={h.kitchen_opens || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'kitchen_opens', e.target.value)} disabled={h.is_closed} fullWidth />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">Kitchen Closes</label>
                <Input type="time" value={h.kitchen_closes || ''} onChange={(e) => handleTimeChange(h.day_of_week, 'kitchen_closes', e.target.value)} disabled={h.is_closed} fullWidth />
              </div>
            </div>
          </Card>
        )}
      />

      <div className="flex justify-end pt-4">
        <Button type="submit" loading={isSaving} fullWidth={false}>
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </form>
  )
}
