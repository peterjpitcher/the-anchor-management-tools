'use client'

import { useState } from 'react'
import { ScheduleConfigItem } from '@/types/business-hours'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Trash2, Plus } from 'lucide-react'

interface ScheduleConfigEditorProps {
  config: ScheduleConfigItem[]
  onChange: (newConfig: ScheduleConfigItem[]) => void
}

export function ScheduleConfigEditor({ config, onChange }: ScheduleConfigEditorProps) {
  const [items, setItems] = useState<ScheduleConfigItem[]>(config || [])

  const updateItem = (index: number, field: keyof ScheduleConfigItem, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
    onChange(newItems)
  }

  const addItem = () => {
    const newItem: ScheduleConfigItem = {
      name: 'Service',
      starts_at: '12:00',
      ends_at: '14:00',
      capacity: 50,
      booking_type: 'regular'
    }
    const newItems = [...items, newItem]
    setItems(newItems)
    onChange(newItems)
  }

  const removeItem = (index: number) => {
    const newItems = items.filter((_, i) => i !== index)
    setItems(newItems)
    onChange(newItems)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-medium text-gray-900">Service Slots Configuration</h4>
        <Button variant="secondary" size="sm" onClick={addItem}>
          <Plus className="w-4 h-4 mr-2" />
          Add Service
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="text-sm text-gray-500 italic">No services configured. Venue will be effectively closed.</div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="flex flex-wrap gap-2 items-end p-3 bg-gray-50 rounded-md border border-gray-200">
              <div className="w-32">
                <label className="text-xs font-medium text-gray-700">Name</label>
                <Input
                  value={item.name}
                  onChange={(e) => updateItem(index, 'name', e.target.value)}
                  placeholder="Lunch"
                />
              </div>
              <div className="w-24">
                <label className="text-xs font-medium text-gray-700">Start</label>
                <Input
                  type="time"
                  value={item.starts_at}
                  onChange={(e) => updateItem(index, 'starts_at', e.target.value)}
                />
              </div>
              <div className="w-24">
                <label className="text-xs font-medium text-gray-700">End</label>
                <Input
                  type="time"
                  value={item.ends_at}
                  onChange={(e) => updateItem(index, 'ends_at', e.target.value)}
                />
              </div>
              <div className="w-20">
                <label className="text-xs font-medium text-gray-700">Cap.</label>
                <Input
                  type="number"
                  value={item.capacity}
                  onChange={(e) => updateItem(index, 'capacity', parseInt(e.target.value) || 0)}
                />
              </div>
              <div className="w-32">
                <label className="text-xs font-medium text-gray-700">Type</label>
                <select 
                   className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                   value={item.booking_type}
                   onChange={(e) => updateItem(index, 'booking_type', e.target.value)}
                >
                  <option value="regular">Regular</option>
                  <option value="sunday_lunch">Sunday Lunch</option>
                  <option value="event">Event</option>
                </select>
              </div>
              <Button variant="ghost" size="sm" onClick={() => removeItem(index)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
