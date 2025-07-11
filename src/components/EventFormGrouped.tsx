'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { Button } from '@/components/ui/Button'
import { SquareImageUpload } from './SquareImageUpload'
import toast from 'react-hot-toast'
import { 
  ChevronDownIcon, 
  ChevronUpIcon,
  InformationCircleIcon,
  CalendarIcon,
  MegaphoneIcon,
  PhotoIcon,
  ClockIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'

interface EventFormGroupedProps {
  event?: Event | null
  categories: EventCategory[]
  onSubmit: (data: Partial<Event>) => Promise<void>
  onCancel: () => void
}

interface SectionProps {
  title: string
  description?: string
  icon?: React.ComponentType<{ className?: string }>
  children: React.ReactNode
  defaultOpen?: boolean
}

function CollapsibleSection({ title, description, icon: Icon, children, defaultOpen = true }: SectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  
  return (
    <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-6 sm:p-8 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center space-x-3">
          {Icon && <Icon className="h-5 w-5 text-gray-400" />}
          <div className="text-left">
            <h3 className="text-lg font-medium leading-6 text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
        </div>
        {isOpen ? (
          <ChevronUpIcon className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDownIcon className="h-5 w-5 text-gray-400" />
        )}
      </button>
      {isOpen && (
        <div className="border-t border-gray-200 px-4 py-6 sm:p-8">
          {children}
        </div>
      )}
    </div>
  )
}

export function EventFormGrouped({ event, categories, onSubmit, onCancel }: EventFormGroupedProps) {
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
  
  // Media fields
  const [galleryImageUrls, setGalleryImageUrls] = useState(event?.gallery_image_urls?.join(', ') ?? '')
  const [posterImageUrl, setPosterImageUrl] = useState(event?.poster_image_url ?? '')
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState(event?.thumbnail_image_url ?? '')
  const [promoVideoUrl, setPromoVideoUrl] = useState(event?.promo_video_url ?? '')
  const [highlightVideoUrls, setHighlightVideoUrls] = useState(event?.highlight_video_urls?.join(', ') ?? '')
  
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
        thumbnail_image_url: thumbnailImageUrl || imageUrl || null,
        poster_image_url: posterImageUrl || imageUrl || null,
        // SEO and content fields
        slug: slug.trim() || undefined,
        short_description: shortDescription.trim() || undefined,
        long_description: longDescription.trim() || undefined,
        highlights: highlights ? highlights.split(',').map(h => h.trim()).filter(h => h) : [],
        meta_title: metaTitle.trim() || undefined,
        meta_description: metaDescription.trim() || undefined,
        keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(k => k) : [],
        // Media fields
        gallery_image_urls: galleryImageUrls ? galleryImageUrls.split(',').map(url => url.trim()).filter(url => url) : [],
        promo_video_url: promoVideoUrl.trim() || undefined,
        highlight_video_urls: highlightVideoUrls ? highlightVideoUrls.split(',').map(url => url.trim()).filter(url => url) : [],
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

  // Auto-populate fields when category is selected
  const handleCategoryChange = (selectedCategoryId: string) => {
    setCategoryId(selectedCategoryId)
    
    // Find the selected category
    const selectedCategory = categories.find(cat => cat.id === selectedCategoryId)
    
    if (selectedCategory) {
      // Auto-populate fields from category defaults only if they're empty
      if (!name && selectedCategory.name) {
        setName(selectedCategory.name)
      }
      if (!time && selectedCategory.default_start_time) {
        setTime(selectedCategory.default_start_time)
      }
      if (!endTime && selectedCategory.default_end_time) {
        setEndTime(selectedCategory.default_end_time)
      }
      if (!capacity && selectedCategory.default_capacity) {
        setCapacity(selectedCategory.default_capacity.toString())
      }
      if (selectedCategory.default_price !== null && selectedCategory.default_price !== undefined) {
        setPrice(selectedCategory.default_price.toString())
        setIsFree(selectedCategory.default_is_free)
      }
      if (!performerName && selectedCategory.default_performer_name) {
        setPerformerName(selectedCategory.default_performer_name)
      }
      if (!performerType && selectedCategory.default_performer_type) {
        setPerformerType(selectedCategory.default_performer_type)
      }
      if (!imageUrl && selectedCategory.default_image_url) {
        setImageUrl(selectedCategory.default_image_url)
      }
      // Auto-populate SEO and content fields
      if (!shortDescription && selectedCategory.short_description) {
        setShortDescription(selectedCategory.short_description)
      }
      if (!longDescription && selectedCategory.long_description) {
        setLongDescription(selectedCategory.long_description)
      }
      if (!highlights && selectedCategory.highlights) {
        setHighlights(selectedCategory.highlights.join(', '))
      }
      if (!metaTitle && selectedCategory.meta_title) {
        setMetaTitle(selectedCategory.meta_title)
      }
      if (!metaDescription && selectedCategory.meta_description) {
        setMetaDescription(selectedCategory.meta_description)
      }
      if (!keywords && selectedCategory.keywords) {
        setKeywords(selectedCategory.keywords.join(', '))
      }
      // Auto-populate additional timing fields
      if (!durationMinutes && selectedCategory.default_duration_minutes) {
        setDurationMinutes(selectedCategory.default_duration_minutes.toString())
      }
      if (!doorsTime && selectedCategory.default_doors_time) {
        setDoorsTime(selectedCategory.default_doors_time)
      }
      if (!lastEntryTime && selectedCategory.default_last_entry_time) {
        setLastEntryTime(selectedCategory.default_last_entry_time)
      }
      if (!bookingUrl && selectedCategory.default_booking_url) {
        setBookingUrl(selectedCategory.default_booking_url)
      }
      // Generate a slug for the event if not already set
      if (!slug && selectedCategory.name && date) {
        setSlug(selectedCategory.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date)
      }
    }
  }

  // Update slug when name or date changes
  useEffect(() => {
    if (name && date && !event) { // Only auto-generate for new events
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date)
    }
  }, [name, date, event])

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information Section */}
      <CollapsibleSection 
        title="Basic Information" 
        description="Essential details about your event"
        icon={InformationCircleIcon}
        defaultOpen={true}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                onChange={(e) => handleCategoryChange(e.target.value)}
                className="block w-full rounded-lg px-3 py-2 border border-gray-300 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg px-3 py-2 border border-gray-300 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              >
                <option value="scheduled">Scheduled</option>
                <option value="cancelled">Cancelled</option>
                <option value="postponed">Postponed</option>
                <option value="sold_out">Sold Out</option>
              </select>
            </div>
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Time & Schedule Section */}
      <CollapsibleSection 
        title="Time & Schedule" 
        description="When your event takes place"
        icon={ClockIcon}
        defaultOpen={true}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Pricing & Booking Section */}
      <CollapsibleSection 
        title="Pricing & Booking" 
        description="Ticket prices and booking information"
        icon={CalendarIcon}
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-4">
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Performers Section */}
      <CollapsibleSection 
        title="Performers" 
        description="Information about who's performing"
        icon={UserGroupIcon}
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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
                placeholder="e.g., DJ John, The Blues Band"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
        </div>
      </CollapsibleSection>

      {/* SEO & Content Section */}
      <CollapsibleSection 
        title="SEO & Content" 
        description="Search engine optimization and content details"
        icon={MegaphoneIcon}
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">{metaTitle.length}/60 characters</p>
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">{metaDescription.length}/160 characters</p>
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">{shortDescription.length}/500 characters</p>
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="highlights" className="block text-sm font-medium leading-6 text-gray-900">
              Highlights
            </label>
            <div className="mt-2">
              <input
                type="text"
                id="highlights"
                value={highlights}
                onChange={(e) => setHighlights(e.target.value)}
                placeholder="Great prizes, Fun atmosphere, Live music"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Separate multiple highlights with commas</p>
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="keywords" className="block text-sm font-medium leading-6 text-gray-900">
              Keywords
            </label>
            <div className="mt-2">
              <input
                type="text"
                id="keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="music, live band, entertainment, pub"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Separate keywords with commas for better SEO</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Media Section */}
      <CollapsibleSection 
        title="Media & Gallery" 
        description="Additional images and videos for this event"
        icon={PhotoIcon}
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          <div className="col-span-full">
            <label htmlFor="gallery_image_urls" className="block text-sm font-medium leading-6 text-gray-900">
              Gallery Images
            </label>
            <div className="mt-2">
              <textarea
                id="gallery_image_urls"
                rows={3}
                value={galleryImageUrls}
                onChange={(e) => setGalleryImageUrls(e.target.value)}
                placeholder="https://example.com/image1.jpg, https://example.com/image2.jpg"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Separate multiple image URLs with commas</p>
            </div>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="poster_image_url" className="block text-sm font-medium leading-6 text-gray-900">
              Poster Image URL
            </label>
            <div className="mt-2">
              <input
                type="url"
                id="poster_image_url"
                value={posterImageUrl}
                onChange={(e) => setPosterImageUrl(e.target.value)}
                placeholder="https://example.com/poster.jpg"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="thumbnail_image_url" className="block text-sm font-medium leading-6 text-gray-900">
              Thumbnail Image URL
            </label>
            <div className="mt-2">
              <input
                type="url"
                id="thumbnail_image_url"
                value={thumbnailImageUrl}
                onChange={(e) => setThumbnailImageUrl(e.target.value)}
                placeholder="https://example.com/thumbnail.jpg"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="promo_video_url" className="block text-sm font-medium leading-6 text-gray-900">
              Promo Video URL
            </label>
            <div className="mt-2">
              <input
                type="url"
                id="promo_video_url"
                value={promoVideoUrl}
                onChange={(e) => setPromoVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="highlight_video_urls" className="block text-sm font-medium leading-6 text-gray-900">
              Highlight Videos
            </label>
            <div className="mt-2">
              <textarea
                id="highlight_video_urls"
                rows={2}
                value={highlightVideoUrls}
                onChange={(e) => setHighlightVideoUrls(e.target.value)}
                placeholder="https://youtube.com/watch?v=..., https://vimeo.com/..."
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">Separate multiple video URLs with commas</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Form Actions */}
      <div className="flex items-center justify-end gap-x-6">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
        </Button>
      </div>
    </form>
  )
}