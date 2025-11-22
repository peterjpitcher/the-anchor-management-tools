'use client'

import { useState, useEffect } from 'react'
import { Modal, ModalActions } from '@/components/ui-v2/overlay/Modal'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'
import { ScheduleConfigEditor } from './ScheduleConfigEditor'
import { createSpecialHours, updateSpecialHours, deleteSpecialHours, getBusinessHoursByDay } from '@/app/actions/business-hours'
import { SpecialHours, ScheduleConfigItem } from '@/types/business-hours'
import { format } from 'date-fns'
import toast from 'react-hot-toast'
import { TrashIcon } from '@heroicons/react/24/outline'

interface SpecialHoursModalProps {
  isOpen: boolean
  onClose: () => void
  date: Date
  initialData?: SpecialHours | null
  canManage: boolean
  onSave: () => void
}

export function SpecialHoursModal({ 
  isOpen, 
  onClose, 
  date, 
  initialData, 
  canManage,
  onSave 
}: SpecialHoursModalProps) {
  const [loading, setLoading] = useState(false)
  const [fetchingDefaults, setFetchingDefaults] = useState(false)
  
  // Form State
  const [isClosed, setIsClosed] = useState(false)
  const [isKitchenClosed, setIsKitchenClosed] = useState(false)
  const [isLunchClosed, setIsLunchClosed] = useState(false)
  const [opens, setOpens] = useState('')
  const [closes, setCloses] = useState('')
  const [kitchenOpens, setKitchenOpens] = useState('')
  const [kitchenCloses, setKitchenCloses] = useState('')
  const [sundayLunchOpens, setSundayLunchOpens] = useState('')
  const [sundayLunchCloses, setSundayLunchCloses] = useState('')
  const [note, setNote] = useState('')
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfigItem[]>([])

  // Initialize state when modal opens or date changes
  useEffect(() => {
    if (initialData) {
      setIsClosed(initialData.is_closed)
      setIsKitchenClosed(initialData.is_kitchen_closed || false)
      setOpens(initialData.opens || '')
      setCloses(initialData.closes || '')
      setKitchenOpens(initialData.kitchen_opens || '')
      setKitchenCloses(initialData.kitchen_closes || '')
      setNote(initialData.note || '')
      setScheduleConfig(initialData.schedule_config || [])
      
      // Extract Sunday Lunch from config
      const lunch = initialData.schedule_config?.find(c => c.booking_type === 'sunday_lunch')
      if (lunch) {
        setSundayLunchOpens(lunch.starts_at)
        setSundayLunchCloses(lunch.ends_at)
        setIsLunchClosed(false)
      } else {
        setSundayLunchOpens('')
        setSundayLunchCloses('')
        setIsLunchClosed(true) // If it's Sunday and no config, assume closed? Or just empty.
      }
      
    } else {
      // Reset to defaults or fetch regular hours
      setIsClosed(false)
      setIsKitchenClosed(false)
      setIsLunchClosed(false)
      setOpens('')
      setCloses('')
      setKitchenOpens('')
      setKitchenCloses('')
      setSundayLunchOpens('')
      setSundayLunchCloses('')
      setNote('')
      setScheduleConfig([])
      
      // Auto-fetch default hours for this day to pre-fill
      if (isOpen) {
        fetchDefaults(date)
      }
    }
  }, [initialData, date, isOpen])

  const fetchDefaults = async (dateObj: Date) => {
    setFetchingDefaults(true)
    const dayOfWeek = dateObj.getDay()
    const result = await getBusinessHoursByDay(dayOfWeek)
    
    if (result.data) {
      const regular = result.data
      // Only pre-fill if we are not explicitly closed
      if (!regular.is_closed) {
        setOpens(regular.opens || '')
        setCloses(regular.closes || '')
        setKitchenOpens(regular.kitchen_opens || '')
        setKitchenCloses(regular.kitchen_closes || '')
        setScheduleConfig(regular.schedule_config || [])
        setIsKitchenClosed(regular.is_kitchen_closed || false)
        
        const lunch = regular.schedule_config?.find(c => c.booking_type === 'sunday_lunch')
        if (lunch) {
            setSundayLunchOpens(lunch.starts_at)
            setSundayLunchCloses(lunch.ends_at)
            setIsLunchClosed(false)
        } else {
            setIsLunchClosed(true)
        }
      }
    }
    setFetchingDefaults(false)
  }

  const handleLunchTimeChange = (field: 'start' | 'end', value: string) => {
    if (field === 'start') setSundayLunchOpens(value)
    if (field === 'end') setSundayLunchCloses(value)
    
    // Update scheduleConfig in real-time for correct JSON submission
    // Note: Ideally we do this on submit, but if we want the "Slots" UI to be in sync, we should do it here.
    // However, for simplicity in this modal, we merge it on submit.
  }

  const handleDelete = async () => {
    if (!initialData?.id) return
    if (!confirm('Remove this exception and revert to regular hours?')) return

    setLoading(true)
    const result = await deleteSpecialHours(initialData.id)
    setLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Exception removed')
      onSave()
      onClose()
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const formData = new FormData()
    const dateStr = format(date, 'yyyy-MM-dd')
    
    // Merge Sunday Lunch into scheduleConfig
    const finalConfig = [...scheduleConfig]
    const dayOfWeek = date.getDay()
    
    if (dayOfWeek === 0) { // Only process for Sunday
        const lunchIndex = finalConfig.findIndex(c => c.booking_type === 'sunday_lunch')
        
        if (isLunchClosed) {
            // Remove if exists
            if (lunchIndex !== -1) {
                finalConfig.splice(lunchIndex, 1)
            }
        } else {
            // Update or Create
            if (lunchIndex !== -1) {
                finalConfig[lunchIndex] = {
                    ...finalConfig[lunchIndex],
                    starts_at: sundayLunchOpens,
                    ends_at: sundayLunchCloses
                }
            } else {
                // Only add if we actually have times
                if (sundayLunchOpens && sundayLunchCloses) {
                    finalConfig.push({
                        name: 'Sunday Lunch',
                        starts_at: sundayLunchOpens,
                        ends_at: sundayLunchCloses,
                        capacity: 50, // Default capacity
                        booking_type: 'sunday_lunch'
                    })
                }
            }
        }
    }
    
    formData.append('date', dateStr)
    // For single day edit, end_date is same as date
    formData.append('end_date', dateStr)
    
    formData.append('is_closed', String(isClosed))
    formData.append('is_kitchen_closed', String(isKitchenClosed))
    formData.append('opens', opens)
    formData.append('closes', closes)
    formData.append('kitchen_opens', kitchenOpens)
    formData.append('kitchen_closes', kitchenCloses)
    formData.append('note', note)
    formData.append('schedule_config', JSON.stringify(finalConfig))

    let result
    if (initialData?.id) {
      result = await updateSpecialHours(initialData.id, formData)
    } else {
      result = await createSpecialHours(formData)
    }

    setLoading(false)

    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(initialData ? 'Hours updated' : 'Exception created')
      onSave()
      onClose()
    }
  }
  
  const isSunday = date.getDay() === 0

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={`Edit Hours: ${format(date, 'EEEE, d MMMM yyyy')}`}
      size="lg"
      footer={
        <ModalActions align="between">
          <div>
            {initialData && (
              <Button
                type="button"
                variant="danger"
                onClick={handleDelete}
                disabled={loading || !canManage}
              >
                <TrashIcon className="w-4 h-4 mr-2" />
                Revert to Regular
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" onClick={handleSubmit} disabled={loading || !canManage} loading={loading}>
              Save Changes
            </Button>
          </div>
        </ModalActions>
      }
    >
      <div className="space-y-6">
        {/* Main Status Toggles */}
        <div className="flex flex-wrap gap-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
          <Checkbox
            label="Venue Closed"
            checked={isClosed}
            onChange={(e) => {
              setIsClosed(e.target.checked)
              if (e.target.checked) {
                setIsKitchenClosed(true)
                setIsLunchClosed(true)
              }
            }}
            disabled={!canManage}
          />
          <Checkbox
            label="Kitchen Closed"
            checked={isKitchenClosed}
            onChange={(e) => setIsKitchenClosed(e.target.checked)}
            disabled={!canManage || isClosed}
          />
          {isSunday && (
             <Checkbox
               label="Sunday Lunch Closed"
               checked={isLunchClosed}
               onChange={(e) => setIsLunchClosed(e.target.checked)}
               disabled={!canManage || isClosed}
             />
          )}
        </div>

        {/* Venue Hours */}
        {!isClosed && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
             <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Venue Hours</h4>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Opens</label>
                    <Input 
                      type="time" 
                      value={opens} 
                      onChange={e => setOpens(e.target.value)} 
                      disabled={!canManage}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Closes</label>
                    <Input 
                      type="time" 
                      value={closes} 
                      onChange={e => setCloses(e.target.value)} 
                      disabled={!canManage}
                    />
                  </div>
                </div>
             </div>

             <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">Kitchen Hours</h4>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Opens</label>
                    <Input 
                      type="time" 
                      value={kitchenOpens} 
                      onChange={e => setKitchenOpens(e.target.value)} 
                      disabled={!canManage || isKitchenClosed}
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-gray-500">Closes</label>
                    <Input 
                      type="time" 
                      value={kitchenCloses} 
                      onChange={e => setKitchenCloses(e.target.value)} 
                      disabled={!canManage || isKitchenClosed}
                    />
                  </div>
                </div>
             </div>
          </div>
        )}

        {/* Sunday Lunch Hours (Only show if Sunday) */}
        {!isClosed && isSunday && (
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-100">
             <h4 className="text-sm font-medium text-orange-900 mb-2">Sunday Lunch Service</h4>
             <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-xs text-orange-700">Starts</label>
                  <Input 
                    type="time" 
                    value={sundayLunchOpens} 
                    onChange={e => handleLunchTimeChange('start', e.target.value)} 
                    disabled={!canManage || isLunchClosed}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-orange-700">Ends</label>
                  <Input 
                    type="time" 
                    value={sundayLunchCloses} 
                    onChange={e => handleLunchTimeChange('end', e.target.value)} 
                    disabled={!canManage || isLunchClosed}
                  />
                </div>
             </div>
             <p className="text-xs text-orange-600 mt-2">
               Controls the &quot;Sunday Lunch&quot; booking slot availability.
             </p>
          </div>
        )}

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reason / Note</label>
          <Input
            placeholder="e.g. Bank Holiday, Private Event"
            value={note}
            onChange={e => setNote(e.target.value)}
            disabled={!canManage}
          />
        </div>

        {/* Service Slots */}
        {!isClosed && (
          <div className="pt-4 border-t border-gray-200">
            <ScheduleConfigEditor
              config={scheduleConfig}
              onChange={setScheduleConfig}
            />
            <p className="text-xs text-gray-500 mt-2">
              These slots determine customer booking availability for this specific date.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}
