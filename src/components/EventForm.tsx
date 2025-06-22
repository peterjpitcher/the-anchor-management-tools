'use client'

import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'
import { getActiveEventCategories } from '@/app/actions/event-categories'

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
  const [categoryId, setCategoryId] = useState(event?.category_id ?? '')
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Calculate date constraints
  const today = new Date()
  const oneYearFromNow = new Date()
  oneYearFromNow.setFullYear(today.getFullYear() + 1)
  
  // For new events, minimum date is today
  // For existing events that are in the past, allow the existing date
  const eventDate = event?.date ? new Date(event.date) : null
  const isPastEvent = eventDate && eventDate < today
  const minDate = isPastEvent && event ? event.date : today.toISOString().split('T')[0]
  const maxDate = oneYearFromNow.toISOString().split('T')[0]

  // Handle category selection to auto-fill defaults
  const handleCategoryChange = useCallback((newCategoryId: string) => {
    setCategoryId(newCategoryId)
    
    if (newCategoryId) {
      const selectedCategory = categories.find(c => c.id === newCategoryId)
      if (selectedCategory) {
        // Only update fields if they're currently empty
        if (!time && selectedCategory.default_start_time) {
          setTime(selectedCategory.default_start_time)
        }
        if (!capacity && selectedCategory.default_capacity) {
          setCapacity(selectedCategory.default_capacity.toString())
        }
      }
    }
  }, [categories, time, capacity])

  const loadCategories = useCallback(async () => {
    const result = await getActiveEventCategories()
    if (result.data) {
      setCategories(result.data)
      
      // If creating a new event and no category is selected, set the default
      if (!event && !categoryId) {
        const defaultCategory = result.data.find(c => 'is_default' in c && c.is_default)
        if (defaultCategory) {
          handleCategoryChange(defaultCategory.id)
        }
      }
    }
  }, [event, categoryId, handleCategoryChange])

  // Load categories
  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate date constraints
    const newEventDate = new Date(date)
    if (!event && newEventDate < today) {
      toast.error('Cannot create events with dates in the past')
      return
    }
    if (newEventDate > oneYearFromNow) {
      toast.error('Event date cannot be more than 1 year in the future')
      return
    }
    
    setIsSubmitting(true)
    try {
      await onSubmit({ 
        name, 
        date, 
        time,
        capacity: capacity ? parseInt(capacity, 10) : null,
        category_id: categoryId || null
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
        <label htmlFor="category" className="block text-sm font-medium text-gray-900 mb-2">
          Category (Optional)
        </label>
        <select
          id="category"
          name="category"
          value={categoryId}
          onChange={(e) => handleCategoryChange(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        >
          <option value="">No category</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <p className="mt-2 text-sm text-gray-500">
          Selecting a category will auto-fill default values
        </p>
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
          min={minDate}
          max={maxDate}
          required
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        />
        <p className="mt-2 text-sm text-gray-500">
          {isPastEvent 
            ? 'Past event dates cannot be changed to future dates'
            : 'Event date must be today or within the next year'}
        </p>
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