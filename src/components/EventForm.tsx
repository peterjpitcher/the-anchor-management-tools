'use client'

import { Event } from '@/types/database'
import { useState } from 'react'

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
        <label htmlFor="name" className="block text-sm font-medium text-black mb-2">
          Event Name
        </label>
        <input
          type="text"
          id="name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2"
        />
      </div>

      <div>
        <label htmlFor="date" className="block text-sm font-medium text-black mb-2">
          Date
        </label>
        <input
          type="date"
          id="date"
          name="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          required
          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2"
        />
      </div>

      <div>
        <label htmlFor="time" className="block text-sm font-medium text-black mb-2">
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
            className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2"
          />
        </div>
        <p className="mt-2 text-sm text-black">
          Enter time in 24-hour format (e.g., 19:30)
        </p>
      </div>

      <div>
        <label htmlFor="capacity" className="block text-sm font-medium text-black mb-2">
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
          className="block w-full rounded-lg border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 text-base md:text-sm py-3 md:py-2"
        />
        <p className="mt-2 text-sm text-black">
          Leave empty for unlimited capacity
        </p>
      </div>

      <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 sm:justify-end mt-8">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex justify-center items-center rounded-lg border border-gray-300 bg-white px-6 py-3 md:py-2 text-base md:text-sm font-medium text-black shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px]"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex justify-center items-center rounded-lg border border-transparent bg-indigo-600 px-6 py-3 md:py-2 text-base md:text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 w-full sm:w-auto min-h-[44px]"
        >
          {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
        </button>
      </div>
    </form>
  )
} 