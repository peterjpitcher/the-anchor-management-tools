'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
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
  const [categoryId, setCategoryId] = useState(event?.category_id ?? '')
  const [eventStatus, setEventStatus] = useState(event?.event_status ?? 'scheduled')
  const [performerName, setPerformerName] = useState(event?.performer_name ?? '')
  const [performerType, setPerformerType] = useState(event?.performer_type ?? '')
  const [price, setPrice] = useState(event?.price?.toString() ?? '0')
  const [isFree, setIsFree] = useState(event?.is_free ?? true)
  const [imageUrl, setImageUrl] = useState(event?.hero_image_url ?? '')
  
  // SEO and content fields
  const [slug, setSlug] = useState(event?.slug ?? '')
  const [shortDescription, setShortDescription] = useState(event?.short_description ?? '')
  const [longDescription, setLongDescription] = useState(event?.long_description ?? '')
  const [highlights, setHighlights] = useState(event?.highlights?.join(', ') ?? '')
  const [metaTitle, setMetaTitle] = useState(event?.meta_title ?? '')
  const [metaDescription, setMetaDescription] = useState(event?.meta_description ?? '')
  const [keywords, setKeywords] = useState(event?.keywords?.join(', ') ?? '')
  
  // Additional timing and booking fields
  const [bookingUrl, setBookingUrl] = useState(event?.booking_url ?? '')
  const [doorsTime, setDoorsTime] = useState(event?.doors_time ?? '')
  const [durationMinutes, setDurationMinutes] = useState(event?.duration_minutes?.toString() ?? '')
  const [lastEntryTime, setLastEntryTime] = useState(event?.last_entry_time ?? '')
  
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
        // SEO and content fields
        slug: slug.trim() || undefined,
        short_description: shortDescription.trim() || undefined,
        long_description: longDescription.trim() || undefined,
        highlights: highlights ? highlights.split(',').map(h => h.trim()).filter(h => h) : [],
        meta_title: metaTitle.trim() || undefined,
        meta_description: metaDescription.trim() || undefined,
        keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(k => k) : [],
        // Additional timing and booking fields
        booking_url: bookingUrl.trim() || undefined,
        doors_time: doorsTime || null,
        duration_minutes: durationMinutes ? parseInt(durationMinutes) : null,
        last_entry_time: lastEntryTime || null,
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
              <h3 className="text-base sm:text-lg font-medium leading-6 text-gray-900">Basic Information</h3>
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                  onChange={(e) => {
                    const selectedCategoryId = e.target.value
                    setCategoryId(selectedCategoryId)
                    
                    // Find the selected category
                    const selectedCategory = categories.find(cat => cat.id === selectedCategoryId)
                    
                    if (selectedCategory) {
                      // Auto-populate fields from category defaults
                      if (!name && selectedCategory.name) {
                        setName(selectedCategory.name)
                      }
                      if (selectedCategory.default_start_time) {
                        setTime(selectedCategory.default_start_time)
                      }
                      if (selectedCategory.default_end_time) {
                        setEndTime(selectedCategory.default_end_time)
                      }
                      if (selectedCategory.default_capacity) {
                        setCapacity(selectedCategory.default_capacity.toString())
                      }
                      if (selectedCategory.default_price !== null && selectedCategory.default_price !== undefined) {
                        setPrice(selectedCategory.default_price.toString())
                        setIsFree(selectedCategory.default_is_free)
                      }
                      if (selectedCategory.default_performer_name) {
                        setPerformerName(selectedCategory.default_performer_name)
                      }
                      if (selectedCategory.default_performer_type) {
                        setPerformerType(selectedCategory.default_performer_type)
                      }
                      if (selectedCategory.default_event_status) {
                        setEventStatus(selectedCategory.default_event_status)
                      }
                      if (selectedCategory.default_image_url) {
                        setImageUrl(selectedCategory.default_image_url)
                      }
                      // Auto-populate SEO and content fields
                      // Generate a slug for the event based on name and date
                      if (selectedCategory.name && date) {
                        setSlug(selectedCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date)
                      }
                      if (selectedCategory.short_description) {
                        setShortDescription(selectedCategory.short_description)
                      }
                      if (selectedCategory.long_description) {
                        setLongDescription(selectedCategory.long_description)
                      }
                      if (selectedCategory.highlights) {
                        setHighlights(selectedCategory.highlights.join(', '))
                      }
                      if (selectedCategory.meta_title) {
                        setMetaTitle(selectedCategory.meta_title)
                      }
                      if (selectedCategory.meta_description) {
                        setMetaDescription(selectedCategory.meta_description)
                      }
                      if (selectedCategory.keywords) {
                        setKeywords(selectedCategory.keywords.join(', '))
                      }
                      // Auto-populate additional timing fields
                      if (selectedCategory.default_duration_minutes) {
                        setDurationMinutes(selectedCategory.default_duration_minutes.toString())
                      }
                      if (selectedCategory.default_doors_time) {
                        setDoorsTime(selectedCategory.default_doors_time)
                      }
                      if (selectedCategory.default_last_entry_time) {
                        setLastEntryTime(selectedCategory.default_last_entry_time)
                      }
                      if (selectedCategory.default_booking_url) {
                        setBookingUrl(selectedCategory.default_booking_url)
                      }
                    }
                  }}
                  className="block w-full rounded-lg px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px] bg-white"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>


            {/* Event Details */}
            <div className="col-span-full">
              <h3 className="text-base sm:text-lg font-medium leading-6 text-gray-900">Event Details</h3>
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                  className="block w-full rounded-lg px-3 py-3 sm:py-2 text-base sm:text-sm border border-gray-300 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px] bg-white"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
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
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="performer_type" className="block text-sm font-medium leading-6 text-gray-900">
                Performer Type
              </label>
              <div className="mt-2">
                <select
                  id="performer_type"
                  value={performerType}
                  onChange={(e) => setPerformerType(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                >
                  <option value="">Select type...</option>
                  <option value="MusicGroup">Music Group / Band</option>
                  <option value="Person">Solo Performer</option>
                  <option value="TheaterGroup">Theater Group</option>
                  <option value="DanceGroup">Dance Group</option>
                  <option value="ComedyGroup">Comedy Group</option>
                  <option value="Organization">Organization</option>
                </select>
              </div>
            </div>

            {/* Additional Timing Information */}
            <div className="col-span-full">
              <h3 className="text-base sm:text-lg font-medium leading-6 text-gray-900">Additional Timing</h3>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="duration_minutes" className="block text-sm font-medium leading-6 text-gray-900">
                Duration (minutes)
              </label>
              <div className="mt-2">
                <input
                  type="number"
                  id="duration_minutes"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  min="1"
                  placeholder="e.g., 180"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="doors_time" className="block text-sm font-medium leading-6 text-gray-900">
                Doors Time
              </label>
              <div className="mt-2">
                <input
                  type="time"
                  id="doors_time"
                  value={doorsTime}
                  onChange={(e) => setDoorsTime(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="last_entry_time" className="block text-sm font-medium leading-6 text-gray-900">
                Last Entry Time
              </label>
              <div className="mt-2">
                <input
                  type="time"
                  id="last_entry_time"
                  value={lastEntryTime}
                  onChange={(e) => setLastEntryTime(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="booking_url" className="block text-sm font-medium leading-6 text-gray-900">
                External Booking URL
              </label>
              <div className="mt-2">
                <input
                  type="url"
                  id="booking_url"
                  value={bookingUrl}
                  onChange={(e) => setBookingUrl(e.target.value)}
                  placeholder="https://example.com/book"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            {/* SEO & Content */}
            <div className="col-span-full">
              <h3 className="text-base sm:text-lg font-medium leading-6 text-gray-900">SEO & Content</h3>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="slug" className="block text-sm font-medium leading-6 text-gray-900">
                URL Slug
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                  placeholder="event-name-2024-01-01"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="meta_title" className="block text-sm font-medium leading-6 text-gray-900">
                Meta Title
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="meta_title"
                  value={metaTitle}
                  onChange={(e) => setMetaTitle(e.target.value)}
                  maxLength={60}
                  placeholder="SEO page title"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="meta_description" className="block text-sm font-medium leading-6 text-gray-900">
                Meta Description
              </label>
              <div className="mt-2">
                <textarea
                  id="meta_description"
                  rows={2}
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  maxLength={160}
                  placeholder="SEO page description"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="short_description" className="block text-sm font-medium leading-6 text-gray-900">
                Short Description
              </label>
              <div className="mt-2">
                <textarea
                  id="short_description"
                  rows={2}
                  value={shortDescription}
                  onChange={(e) => setShortDescription(e.target.value)}
                  maxLength={500}
                  placeholder="Brief description for event listings"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="long_description" className="block text-sm font-medium leading-6 text-gray-900">
                Long Description
              </label>
              <div className="mt-2">
                <textarea
                  id="long_description"
                  rows={6}
                  value={longDescription}
                  onChange={(e) => setLongDescription(e.target.value)}
                  placeholder="Detailed description for the event page"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="highlights" className="block text-sm font-medium leading-6 text-gray-900">
                Highlights (comma-separated)
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="highlights"
                  value={highlights}
                  onChange={(e) => setHighlights(e.target.value)}
                  placeholder="Great prizes, Fun atmosphere, Live music"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="keywords" className="block text-sm font-medium leading-6 text-gray-900">
                Keywords (comma-separated)
              </label>
              <div className="mt-2">
                <input
                  type="text"
                  id="keywords"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="music, live band, entertainment, pub"
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 min-h-[44px]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 -mx-4 sm:mx-0 bg-white border-t border-gray-900/10 px-4 py-4 sm:px-8">
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <Button type="button" variant="secondary" onClick={onCancel} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="w-full sm:w-auto">
              {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
            </Button>
          </div>
        </div>
      </div>
    </form>
  )
}