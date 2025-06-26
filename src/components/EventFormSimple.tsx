'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Event, EventCategory } from '@/types/database'
import { Button } from '@/components/ui/Button'
import { SquareImageUpload } from './SquareImageUpload'
import toast from 'react-hot-toast'

interface EventFormSimpleProps {
  event?: Event | null
  categories: EventCategory[]
  onSubmit: (data: Partial<Event>) => Promise<void>
  onCancel: () => void
}

export function EventFormSimple({ event, categories, onSubmit, onCancel }: EventFormSimpleProps) {
  const router = useRouter()
  
  // Basic fields
  const [name, setName] = useState(event?.name ?? '')
  const [date, setDate] = useState(event?.date ?? '')
  const [time, setTime] = useState(event?.time ?? '')
  const [endTime, setEndTime] = useState(event?.end_time ?? '')
  const [capacity, setCapacity] = useState(event?.capacity?.toString() ?? '')
  const [description, setDescription] = useState(event?.description ?? '')
  const [categoryId, setCategoryId] = useState(event?.category_id ?? '')
  const [eventStatus, setEventStatus] = useState(event?.event_status ?? 'scheduled')
  const [performerName, setPerformerName] = useState(event?.performer_name ?? '')
  const [performerType, setPerformerType] = useState(event?.performer_type ?? '')
  const [price, setPrice] = useState(event?.price?.toString() ?? '0')
  const [isFree, setIsFree] = useState(event?.is_free ?? true)
  const [imageUrl, setImageUrl] = useState(event?.hero_image_url ?? '')
  
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Date constraints
  const today = new Date()
  const minDate = today.toISOString().split('T')[0]
  const maxDate = new Date(today.getFullYear() + 2, today.getMonth(), today.getDate()).toISOString().split('T')[0]

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim() || !date || !time) {
      toast.error('Please fill in all required fields')
      return
    }

    setIsSubmitting(true)
    try {
      const eventData: Partial<Event> = {
        name: name.trim(),
        date,
        time,
        end_time: endTime || null,
        capacity: capacity ? parseInt(capacity) : null,
        description: description.trim() || null,
        category_id: categoryId || null,
        event_status: eventStatus,
        performer_name: performerName.trim() || null,
        performer_type: performerType.trim() || null,
        price: parseFloat(price) || 0,
        is_free: isFree,
        hero_image_url: imageUrl || null,
        // Set other image URLs to match the single image
        thumbnail_image_url: imageUrl || null,
        poster_image_url: imageUrl || null,
      }

      await onSubmit(eventData)
    } catch (error) {
      console.error('Error submitting form:', error)
      toast.error('Failed to save event')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl md:col-span-2">
        <div className="px-4 py-6 sm:p-8">
          <div className="grid max-w-2xl grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
            {/* Event Image */}
            <div className="col-span-full">
              <SquareImageUpload
                entityId={event?.id || 'new'}
                entityType="event"
                currentImageUrl={imageUrl}
                label="Event Image"
                helpText="Upload a square image for your event (recommended: 1080x1080px)"
                onImageUploaded={(url) => setImageUrl(url)}
                onImageDeleted={() => setImageUrl('')}
              />
            </div>

            {/* Basic Information */}
            <div className="col-span-full">
              <h3 className="text-lg font-medium leading-6 text-gray-900">Basic Information</h3>
            </div>

            <div className="sm:col-span-4">
              <label htmlFor="name" className="block text-sm font-medium leading-6 text-gray-900">
                Event Name *
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="category" className="block text-sm font-medium leading-6 text-gray-900">
                Category
              </label>
              <div className="mt-2">
                <select
                  id="category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                >
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="date" className="block text-sm font-medium leading-6 text-gray-900">
                Date *
              </label>
              <div className="mt-2">
                <input
                  type="date"
                  id="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={minDate}
                  max={maxDate}
                  required
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="time" className="block text-sm font-medium leading-6 text-gray-900">
                Start Time *
              </label>
              <div className="mt-2">
                <input
                  type="time"
                  id="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  required
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="end_time" className="block text-sm font-medium leading-6 text-gray-900">
                End Time
              </label>
              <div className="mt-2">
                <input
                  type="time"
                  id="end_time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="description" className="block text-sm font-medium leading-6 text-gray-900">
                Description
              </label>
              <div className="mt-2">
                <textarea
                  id="description"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            {/* Event Details */}
            <div className="col-span-full">
              <h3 className="text-lg font-medium leading-6 text-gray-900">Event Details</h3>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="capacity" className="block text-sm font-medium leading-6 text-gray-900">
                Capacity
              </label>
              <div className="mt-2">
                <input
                  type="number"
                  id="capacity"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  min="1"
                  placeholder="Unlimited"
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="status" className="block text-sm font-medium leading-6 text-gray-900">
                Status
              </label>
              <div className="mt-2">
                <select
                  id="status"
                  value={eventStatus}
                  onChange={(e) => setEventStatus(e.target.value)}
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                >
                  <option value="scheduled">Scheduled</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="postponed">Postponed</option>
                  <option value="sold_out">Sold Out</option>
                </select>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="price" className="block text-sm font-medium leading-6 text-gray-900">
                Price (£)
              </label>
              <div className="mt-2">
                <input
                  type="number"
                  id="price"
                  value={price}
                  onChange={(e) => {
                    setPrice(e.target.value)
                    setIsFree(parseFloat(e.target.value) === 0)
                  }}
                  min="0"
                  step="0.01"
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            {/* Performer Information */}
            <div className="sm:col-span-3">
              <label htmlFor="performer_name" className="block text-sm font-medium leading-6 text-gray-900">
                Performer Name
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="performer_name"
                  value={performerName}
                  onChange={(e) => setPerformerName(e.target.value)}
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="performer_type" className="block text-sm font-medium leading-6 text-gray-900">
                Performer Type
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="performer_type"
                  value={performerType}
                  onChange={(e) => setPerformerType(e.target.value)}
                  placeholder="e.g., Band, DJ, Comedian"
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-x-6 border-t border-gray-900/10 px-4 py-4 sm:px-8">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
          </Button>
        </div>
      </div>
    </form>
  )
}