'use client'

import { Event } from '@/types/database'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'

interface EventFormProps {
  event?: Event
  onSubmit: (data: Omit<Event, 'id' | 'created_at'>) => Promise<void>
  onCancel: () => void
}

export function EventForm({ event, onSubmit, onCancel }: EventFormProps) {
  const [name, setName] = useState(event?.name ?? '')
  const [date, setDate] = useState(event?.date ?? '')
  const [time, setTime] = useState(event?.time ?? '')
  const [capacity, setCapacity] = useState(event?.capacity?.toString() ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      await onSubmit({ 
        name, 
        date, 
        time,
        capacity: capacity ? parseInt(capacity, 10) : null
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
       <div>
        <h2 className="text-xl font-bold text-gray-900">
          {event ? 'Edit Event' : 'Create New Event'}
        </h2>
      </div>
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-gray-900 mb-2">
          Event Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor="date" className="block text-sm font-medium text-gray-900 mb-2">
          Date
        </label>
        <input
          type="date"
          id="date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor="time" className="block text-sm font-medium text-gray-900 mb-2">
          Time
        </label>
        <div className="relative">
          <input
            type="time"
            id="time"
            name="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            required
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          />
        </div>
        <p className="mt-2 text-sm text-gray-500">
          Enter time in 24-hour format (e.g., 19:30)
        </p>
      </div>

      <div>
        <label htmlFor="capacity" className="block text-sm font-medium text-gray-900 mb-2">
          Capacity (Optional)
        </label>
        <input
          type="number"
          id="capacity"
          name="capacity"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value)}
          min="1"
          inputMode="numeric"
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        />
        <p className="mt-2 text-sm text-gray-500">
          Leave empty for unlimited capacity
        </p>
      </div>

      <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 sm:justify-end pt-4">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
        </Button>
      </div>
    </form>
  )
}