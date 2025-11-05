'use client'

import { useEffect, useState } from 'react'
import { getSpecialHours, createSpecialHours, updateSpecialHours, deleteSpecialHours, getBusinessHoursByDay } from '@/app/actions/business-hours'
import { SpecialHours } from '@/types/business-hours'
import { Button, IconButton } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { Card } from '@/components/ui-v2/layout/Card'
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface SpecialHoursManagerProps {
  canManage: boolean
  initialSpecialHours: SpecialHours[]
}

interface SpecialHoursFormState {
  date: string
  end_date: string
  opens: string
  closes: string
  kitchen_opens: string
  kitchen_closes: string
  is_closed: boolean
  is_kitchen_closed: boolean
  note: string
  isRange: boolean
}

const INITIAL_FORM_STATE: SpecialHoursFormState = {
  date: '',
  end_date: '',
  opens: '',
  closes: '',
  kitchen_opens: '',
  kitchen_closes: '',
  is_closed: false,
  is_kitchen_closed: false,
  note: '',
  isRange: false,
}

const normalizeSpecialHours = (items: SpecialHours[]) =>
  items.map((item) => ({
    ...item,
    is_kitchen_closed: Boolean(item.is_kitchen_closed),
  }))

export function SpecialHoursManager({ canManage, initialSpecialHours }: SpecialHoursManagerProps) {
  const [specialHours, setSpecialHours] = useState<SpecialHours[]>(() => normalizeSpecialHours(initialSpecialHours))
  const [isLoading, setIsLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<SpecialHoursFormState>(INITIAL_FORM_STATE)

  useEffect(() => {
    setSpecialHours(normalizeSpecialHours(initialSpecialHours))
  }, [initialSpecialHours])

  const notifySpecialHoursUpdated = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('special-hours-updated'))
    }
  }

  const refreshSpecialHours = async () => {
    setIsLoading(true)
    const result = await getSpecialHours()
    if (result.data) {
      setSpecialHours(normalizeSpecialHours(result.data))
    } else if (result.error) {
      toast.error(result.error)
    }
    setIsLoading(false)
  }

  const resetForm = () => {
    setFormData(INITIAL_FORM_STATE)
    setEditingId(null)
    setShowForm(false)
  }

  const handleEdit = (hours: SpecialHours) => {
    if (!canManage) {
      toast.error('You do not have permission to edit special hours.')
      return
    }

    setFormData({
      date: hours.date,
      end_date: hours.date,
      opens: hours.opens || '',
      closes: hours.closes || '',
      kitchen_opens: hours.kitchen_opens || '',
      kitchen_closes: hours.kitchen_closes || '',
      is_closed: hours.is_closed,
      is_kitchen_closed: hours.is_kitchen_closed || false,
      note: hours.note || '',
      isRange: false
    })
    setEditingId(hours.id)
    setShowForm(true)
  }

  const handleDelete = async (id: string) => {
    if (!canManage) {
      toast.error('You do not have permission to delete special hours.')
      return
    }

    if (!confirm('Are you sure you want to delete these special hours?')) {
      return
    }

    const result = await deleteSpecialHours(id)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Special hours deleted successfully')
      await refreshSpecialHours()
      notifySpecialHoursUpdated()
    }
  }

  const handleStartDateChange = async (date: string) => {
    if (!canManage) {
      return
    }

    setFormData(prev => {
      const shouldSyncEndDate =
        !prev.isRange || !prev.end_date || (prev.isRange && prev.end_date < date)

      return {
        ...prev,
        date,
        end_date: shouldSyncEndDate ? date : prev.end_date
      }
    })

    if (!date) {
      return
    }
    
    // Get day of week from date (0 = Sunday, 6 = Saturday)
    const selectedDate = new Date(date + 'T00:00:00')
    const dayOfWeek = selectedDate.getDay()
    
    // Fetch regular hours for this day
    const result = await getBusinessHoursByDay(dayOfWeek)
    if (result.data && !result.data.is_closed) {
      const businessHours = result.data
      setFormData(prev => ({
        ...prev,
        opens: businessHours.opens || '',
        closes: businessHours.closes || '',
        kitchen_opens: businessHours.kitchen_opens || '',
        kitchen_closes: businessHours.kitchen_closes || '',
        is_closed: false,
        is_kitchen_closed: businessHours.is_kitchen_closed || false
      }))
      toast.success(`Pre-filled with ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dayOfWeek]} hours`)
    }
  }

  const handleEndDateChange = (date: string) => {
    if (!canManage) {
      return
    }

    if (!formData.date) {
      toast.error('Please select a start date first.')
      return
    }

    if (date < formData.date) {
      toast.error('End date cannot be before start date.')
      return
    }

    setFormData(prev => ({
      ...prev,
      end_date: date
    }))
  }

  const handleRangeToggle = (checked: boolean) => {
    if (!canManage || editingId) {
      return
    }

    if (checked && !formData.date) {
      toast.error('Please select a start date before applying a date range.')
      return
    }

    setFormData(prev => ({
      ...prev,
      isRange: checked,
      end_date: checked
        ? (prev.end_date && prev.end_date >= prev.date ? prev.end_date : prev.date)
        : prev.date
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!canManage) {
      toast.error('You do not have permission to manage special hours.')
      return
    }

    if (!formData.date) {
      toast.error('Please select a start date.')
      return
    }

    if (formData.isRange) {
      if (!formData.end_date) {
        toast.error('Please select an end date.')
        return
      }

      if (formData.end_date < formData.date) {
        toast.error('End date cannot be before start date.')
        return
      }
    }
    
    const formDataToSend = new FormData()
    const endDateToSend = formData.isRange ? (formData.end_date || formData.date) : formData.date
    const isRangeSubmission = formData.isRange

    formDataToSend.append('date', formData.date)
    formDataToSend.append('end_date', endDateToSend)
    formDataToSend.append('opens', formData.opens || '')
    formDataToSend.append('closes', formData.closes || '')
    formDataToSend.append('kitchen_opens', formData.kitchen_opens || '')
    formDataToSend.append('kitchen_closes', formData.kitchen_closes || '')
    formDataToSend.append('is_closed', String(formData.is_closed))
    formDataToSend.append('is_kitchen_closed', String(formData.is_kitchen_closed))
    formDataToSend.append('note', formData.note || '')

    const result = editingId
      ? await updateSpecialHours(editingId, formDataToSend)
      : await createSpecialHours(formDataToSend)
    
    if (result.error) {
      toast.error(result.error)
    } else {
      const successMessage = editingId
        ? 'Special hours updated successfully'
        : isRangeSubmission
          ? 'Special hours created for the selected date range'
          : 'Special hours created successfully'

      toast.success(successMessage)
      resetForm()
      await refreshSpecialHours()
      notifySpecialHoursUpdated()
    }
  }

  if (isLoading) {
    return <div className="text-center py-4">Loading special hours...</div>
  }

  return (
    <div className="space-y-4">
      {!showForm && (
        <div className="flex justify-end">
          <Button
            onClick={() => setShowForm(true)}
            leftIcon={<PlusIcon className="h-5 w-5" />}
            disabled={!canManage}
          >
            Add Special Hours
          </Button>
        </div>
      )}

      {showForm && (
        <Card variant="default" padding="sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Start Date
                </label>
                <Input
                  type="date"
                  required
                  value={formData.date}
                  onChange={(e) => handleStartDateChange(e.target.value)}
                  disabled={!canManage}
                  fullWidth
                />
              </div>

              {formData.isRange && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    End Date
                  </label>
                  <Input
                    type="date"
                    required
                    value={formData.end_date}
                    min={formData.date || undefined}
                    onChange={(e) => handleEndDateChange(e.target.value)}
                    disabled={!canManage}
                    fullWidth
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <Checkbox
                  label="Apply to a date range"
                  checked={formData.isRange}
                  onChange={(e) => handleRangeToggle(e.target.checked)}
                  disabled={!canManage || !!editingId}
                />
              </div>

              <div className="space-y-2">
                <Checkbox
                  label="Closed all day"
                  checked={formData.is_closed}
                  onChange={(e) => setFormData({ ...formData, is_closed: e.target.checked })}
                  disabled={!canManage}
                />
                <Checkbox
                  label="Kitchen closed"
                  checked={formData.is_kitchen_closed}
                  onChange={(e) => setFormData({ ...formData, is_kitchen_closed: e.target.checked })}
                  disabled={!canManage || formData.is_closed}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Opens
                </label>
                <Input
                  type="time"
                  value={formData.opens}
                  onChange={(e) => setFormData({ ...formData, opens: e.target.value })}
                  disabled={!canManage || formData.is_closed}
                  fullWidth
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Closes
                </label>
                <Input
                  type="time"
                  value={formData.closes}
                  onChange={(e) => setFormData({ ...formData, closes: e.target.value })}
                  disabled={!canManage || formData.is_closed}
                  fullWidth
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Kitchen Opens
                </label>
                <Input
                  type="time"
                  value={formData.kitchen_opens}
                  onChange={(e) => setFormData({ ...formData, kitchen_opens: e.target.value })}
                  disabled={!canManage || formData.is_closed || formData.is_kitchen_closed}
                  fullWidth
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Kitchen Closes
                </label>
                <Input
                  type="time"
                  value={formData.kitchen_closes}
                  onChange={(e) => setFormData({ ...formData, kitchen_closes: e.target.value })}
                  disabled={!canManage || formData.is_closed || formData.is_kitchen_closed}
                  fullWidth
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">
                  Note (Optional)
                </label>
                <Input
                  type="text"
                  value={formData.note}
                  onChange={(e) => setFormData({ ...formData, note: e.target.value })}
                  placeholder="e.g., Christmas Day, Bank Holiday"
                  disabled={!canManage}
                  fullWidth
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <Button type="button" variant="secondary" onClick={resetForm}>
                Cancel
              </Button>
              <Button type="submit" disabled={!canManage}>
                {editingId ? 'Update' : 'Add'} Special Hours
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-2">
        {specialHours.length === 0 ? (
          <p className="text-center py-8 text-gray-500">
            No special hours configured
          </p>
        ) : (
          specialHours.map((hours) => (
            <Card
              key={hours.id}
              variant="bordered"
              padding="sm"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-4">
                    <p className="font-medium text-gray-900">
                      {new Date(hours.date + 'T00:00:00').toLocaleDateString('en-GB', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })}
                    </p>
                    {hours.note && (
                      <span className="text-sm text-gray-500">({hours.note})</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-gray-600">
                    {hours.is_closed ? (
                      <span className="text-red-600">Closed all day</span>
                    ) : (
                      <>
                        <span>Open: {hours.opens || 'Not set'} - {hours.closes || 'Not set'}</span>
                        {hours.is_kitchen_closed ? (
                          <span className="ml-4 text-orange-600">Kitchen closed</span>
                        ) : hours.kitchen_opens && hours.kitchen_closes ? (
                          <span className="ml-4">
                            Kitchen: {hours.kitchen_opens} - {hours.kitchen_closes}
                          </span>
                        ) : null}
                      </>
                    )}
                  </p>
                </div>
                
                <div className="flex items-center space-x-2">
                  <IconButton
                    onClick={() => handleEdit(hours)}
                    variant="secondary"
                    title="Edit"
                    disabled={!canManage}
                  >
                    <PencilIcon className="h-5 w-5" />
                  </IconButton>
                  <IconButton
                    onClick={() => handleDelete(hours.id)}
                    variant="secondary"
                    className="text-red-600 hover:text-red-900"
                    title="Delete"
                    disabled={!canManage}
                  >
                    <TrashIcon className="h-5 w-5" />
                  </IconButton>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
