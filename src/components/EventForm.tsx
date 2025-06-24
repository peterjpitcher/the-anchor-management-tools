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
  
  // New fields
  const [description, setDescription] = useState(event?.description ?? '')
  const [endTime, setEndTime] = useState(event?.end_time ?? '')
  const [eventStatus, setEventStatus] = useState(event?.event_status ?? 'scheduled')
  const [performerName, setPerformerName] = useState(event?.performer_name ?? '')
  const [performerType, setPerformerType] = useState(event?.performer_type ?? '')
  const [price, setPrice] = useState(event?.price?.toString() ?? '0')
  const [isFree, setIsFree] = useState(event?.is_free ?? (event?.price === 0))
  const [bookingUrl, setBookingUrl] = useState(event?.booking_url ?? '')
  const [imageUrls, setImageUrls] = useState<string[]>(event?.image_urls ?? [])
  const [newImageUrl, setNewImageUrl] = useState('')

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
  const handleCategoryChange = (newCategoryId: string) => {
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
  }

  // Load categories once on mount
  useEffect(() => {
    const loadCategories = async () => {
      const result = await getActiveEventCategories()
      if (result.data) {
        setCategories(result.data)
        
        // If creating a new event and no category is selected, set the default
        if (!event && !categoryId) {
          const defaultCategory = result.data.find(c => 'is_default' in c && c.is_default)
          if (defaultCategory) {
            setCategoryId(defaultCategory.id)
            // Auto-fill defaults if empty
            if (!time && defaultCategory.default_start_time) {
              setTime(defaultCategory.default_start_time)
            }
            if (!capacity && defaultCategory.default_capacity) {
              setCapacity(defaultCategory.default_capacity.toString())
            }
          }
        }
      }
    }
    
    loadCategories()
  }, []) // Empty dependency array - load only once

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
        category_id: categoryId || null,
        description: description || null,
        end_time: endTime || null,
        event_status: eventStatus,
        performer_name: performerName || null,
        performer_type: performerType || null,
        price: price ? parseFloat(price) : 0,
        price_currency: 'GBP',
        is_free: isFree,
        booking_url: bookingUrl || null,
        image_urls: imageUrls.length > 0 ? imageUrls : [],
        is_recurring: false,
        recurrence_rule: null,
        parent_event_id: null
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

      <div>
        <label htmlFor="end_time" className="block text-sm font-medium text-gray-900 mb-2">
          End Time (Optional)
        </label>
        <input
          type="time"
          id="end_time"
          name="end_time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-900 mb-2">
          Description (Optional)
        </label>
        <textarea
          id="description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          placeholder="Event description for website and SEO..."
        />
      </div>

      <div>
        <label htmlFor="event_status" className="block text-sm font-medium text-gray-900 mb-2">
          Event Status
        </label>
        <select
          id="event_status"
          name="event_status"
          value={eventStatus}
          onChange={(e) => setEventStatus(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
        >
          <option value="scheduled">Scheduled</option>
          <option value="cancelled">Cancelled</option>
          <option value="postponed">Postponed</option>
          <option value="rescheduled">Rescheduled</option>
        </select>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="performer_name" className="block text-sm font-medium text-gray-900 mb-2">
            Performer Name (Optional)
          </label>
          <input
            type="text"
            id="performer_name"
            name="performer_name"
            value={performerName}
            onChange={(e) => setPerformerName(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
            placeholder="e.g., The Beatles Tribute Band"
          />
        </div>

        <div>
          <label htmlFor="performer_type" className="block text-sm font-medium text-gray-900 mb-2">
            Performer Type (Optional)
          </label>
          <select
            id="performer_type"
            name="performer_type"
            value={performerType}
            onChange={(e) => setPerformerType(e.target.value)}
            className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          >
            <option value="">Select type...</option>
            <option value="MusicGroup">Music Group/Band</option>
            <option value="Person">Solo Artist</option>
            <option value="TheaterGroup">Theater Group</option>
            <option value="DanceGroup">Dance Group</option>
            <option value="ComedyGroup">Comedy Group</option>
            <option value="Organization">Organization</option>
          </select>
        </div>
      </div>

      <div>
        <div className="flex items-center mb-2">
          <input
            type="checkbox"
            id="is_free"
            name="is_free"
            checked={isFree}
            onChange={(e) => {
              setIsFree(e.target.checked)
              if (e.target.checked) {
                setPrice('0')
              }
            }}
            className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
          />
          <label htmlFor="is_free" className="ml-2 block text-sm font-medium text-gray-900">
            Free Event
          </label>
        </div>
        
        {!isFree && (
          <div>
            <label htmlFor="price" className="block text-sm font-medium text-gray-900 mb-2">
              Ticket Price (£)
            </label>
            <input
              type="number"
              id="price"
              name="price"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              min="0"
              step="0.01"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="0.00"
            />
          </div>
        )}
      </div>

      <div>
        <label htmlFor="booking_url" className="block text-sm font-medium text-gray-900 mb-2">
          External Booking URL (Optional)
        </label>
        <input
          type="url"
          id="booking_url"
          name="booking_url"
          value={bookingUrl}
          onChange={(e) => setBookingUrl(e.target.value)}
          className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
          placeholder="https://example.com/book-tickets"
        />
        <p className="mt-2 text-sm text-gray-500">
          External URL for ticket booking if not using internal system
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900 mb-2">
          Event Images (Optional)
        </label>
        <div className="space-y-2">
          {imageUrls.map((url, index) => (
            <div key={index} className="flex items-center space-x-2">
              <input
                type="url"
                value={url}
                onChange={(e) => {
                  const newUrls = [...imageUrls]
                  newUrls[index] = e.target.value
                  setImageUrls(newUrls)
                }}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                placeholder="https://example.com/image.jpg"
              />
              <button
                type="button"
                onClick={() => {
                  const newUrls = imageUrls.filter((_, i) => i !== index)
                  setImageUrls(newUrls)
                }}
                className="text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            </div>
          ))}
          <div className="flex items-center space-x-2">
            <input
              type="url"
              value={newImageUrl}
              onChange={(e) => setNewImageUrl(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="Add new image URL"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (newImageUrl) {
                  setImageUrls([...imageUrls, newImageUrl])
                  setNewImageUrl('')
                }
              }}
            >
              Add
            </Button>
          </div>
        </div>
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