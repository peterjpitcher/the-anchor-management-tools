'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { DebouncedTextarea } from '@/components/ui-v2/forms/DebouncedTextarea'
import { SquareImageUpload } from '@/components/features/shared/SquareImageUpload'
import toast from 'react-hot-toast'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  InformationCircleIcon,
  CalendarIcon,
  MegaphoneIcon,
  ClockIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline'
import { getTodayIsoDate, getLocalIsoDateDaysAhead } from '@/lib/dateUtils'
import { generateEventSeoContent } from '@/app/actions/event-content'

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
        className="w-full px-4 py-5 sm:p-8 flex items-center justify-between hover:bg-gray-50 active:bg-gray-100 transition-colors touch-manipulation min-h-[60px]"
      >
        <div className="flex items-center space-x-3">
          {Icon && <Icon className="h-5 w-5 text-gray-400" />}
          <div className="text-left">
            <h3 className="text-base sm:text-lg font-medium leading-6 text-gray-900">{title}</h3>
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
  const [categoryId, setCategoryId] = useState(event?.category_id ?? '')
  const [eventStatus, setEventStatus] = useState(event?.event_status ?? 'scheduled')
  const [performerName, setPerformerName] = useState(event?.performer_name ?? '')
  const [performerType, setPerformerType] = useState(event?.performer_type ?? '')
  const [price, setPrice] = useState(event?.price?.toString() ?? '0')
  const [isFree, setIsFree] = useState(event?.is_free ?? true)
  const [imageUrl, setImageUrl] = useState(event?.hero_image_url ?? '')
  const [brief, setBrief] = useState(event?.brief ?? '')

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

  const [isGeneratingSeo, setIsGeneratingSeo] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Date constraints
  const minDate = getTodayIsoDate()
  // Server validation allows scheduling up to one year ahead; keep client aligned.
  const maxDate = getLocalIsoDateDaysAhead(365)

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
        category_id: categoryId || null,
        event_status: eventStatus,
        performer_name: performerName.trim() || null,
        performer_type: performerType.trim() || null,
        price: price && price !== '' ? parseFloat(price) : 0,
        is_free: isFree,
        hero_image_url: imageUrl || null,
        // Set other image URLs to match the single image (for backwards compatibility)
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
        duration_minutes: durationMinutes && durationMinutes !== '' ? parseInt(durationMinutes) : null,
        last_entry_time: lastEntryTime || null,
        brief: brief.trim() ? brief.trim() : null,
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

  // Auto-calculate duration when start/end time changes
  useEffect(() => {
    if (time && endTime) {
      const [startHours, startMinutes] = time.split(':').map(Number)
      const [endHours, endMinutes] = endTime.split(':').map(Number)

      const startTotal = startHours * 60 + startMinutes
      let endTotal = endHours * 60 + endMinutes

      // Handle crossing midnight
      if (endTotal < startTotal) {
        endTotal += 24 * 60
      }

      const diff = endTotal - startTotal
      setDurationMinutes(diff.toString())
    }
  }, [time, endTime])

  const handleGenerateSeo = async () => {
    if (!name.trim()) {
      toast.error('Add an event name before generating content')
      return
    }

    setIsGeneratingSeo(true)
    try {
      // Generate slug if empty
      if (!slug && name && date) {
        setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date)
      }

      const selectedCategory = categoryId ? categories.find(cat => cat.id === categoryId) : undefined
      const result = await generateEventSeoContent({
        eventId: event?.id ?? null,
        name: name.trim(),
        date: date || null,
        time: time || null,
        categoryName: selectedCategory?.name ?? null,
        capacity: null,
        brief: brief.trim() ? brief.trim() : null,
        performerName: performerName.trim() || null,
        performerType: performerType.trim() || null,
        price: price ? parseFloat(price) : null,
        isFree,
        bookingUrl: bookingUrl.trim() || null,
        existingShortDescription: shortDescription || null,
        existingLongDescription: longDescription || null,
        existingMetaTitle: metaTitle || null,
        existingMetaDescription: metaDescription || null,
        existingHighlights: highlights ? highlights.split(',').map(h => h.trim()).filter(Boolean) : [],
        existingKeywords: keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : []
      })

      if (!result.success) {
        toast.error(result.error ?? 'Failed to generate SEO content')
        return
      }

      const { metaTitle: nextMetaTitle, metaDescription: nextMetaDescription, shortDescription: nextShort, longDescription: nextLong, highlights: nextHighlights, keywords: nextKeywords, slug: nextSlug } = result.data

      if (nextMetaTitle) setMetaTitle(nextMetaTitle)
      if (nextMetaDescription) setMetaDescription(nextMetaDescription)
      if (nextShort) setShortDescription(nextShort)
      if (nextLong) setLongDescription(nextLong)
      if (nextHighlights) setHighlights(nextHighlights.join(', '))
      if (nextKeywords) setKeywords(nextKeywords.join(', '))
      if (nextSlug) setSlug(nextSlug)

      toast.success('SEO content drafted')
    } catch (error) {
      console.error('Failed to generate SEO content', error)
      toast.error('Failed to generate SEO content')
    } finally {
      setIsGeneratingSeo(false)
    }
  }

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
              <Input
                type="text"
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="category" className="block text-sm font-medium leading-6 text-gray-900">
              Category
            </label>
            <div className="mt-2">
              <Select
                id="category"
                value={categoryId}
                onChange={(e) => handleCategoryChange(e.target.value)}
                fullWidth
              >
                <option value="">No category</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="date" className="block text-sm font-medium leading-6 text-gray-900">
              Date *
            </label>
            <div className="mt-2">
              <Input
                type="date"
                id="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={minDate}
                max={maxDate}
                required
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="status" className="block text-sm font-medium leading-6 text-gray-900">
              Status
            </label>
            <div className="mt-2">
              <Select
                id="status"
                value={eventStatus}
                onChange={(e) => setEventStatus(e.target.value)}
                fullWidth
              >
                <option value="scheduled">Scheduled</option>
                <option value="draft">Draft</option>
                <option value="cancelled">Cancelled</option>
                <option value="postponed">Postponed</option>
                <option value="sold_out">Sold Out</option>
              </Select>
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="brief" className="block text-sm font-medium leading-6 text-gray-900">
              Event Brief
            </label>
            <div className="mt-2">
              <DebouncedTextarea
                id="brief"
                rows={6}
                value={brief}
                onValueChange={setBrief}
                placeholder="Include positioning, audience, offers, and any must-have talking points."
                fullWidth
              />
            </div>
            <p className="mt-1 text-xs text-gray-500">
              The brief feeds into SEO, marketing copy, and future content tools—keep it up to date.
            </p>
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
              <Input
                type="time"
                id="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="end_time" className="block text-sm font-medium leading-6 text-gray-900">
              End Time
            </label>
            <div className="mt-2">
              <Input
                type="time"
                id="end_time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="duration_minutes" className="block text-sm font-medium leading-6 text-gray-900">
              Duration (minutes)
            </label>
            <div className="mt-2">
              <Input
                type="number"
                id="duration_minutes"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                min="1"
                placeholder="e.g., 180"
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="doors_time" className="block text-sm font-medium leading-6 text-gray-900">
              Doors Time
            </label>
            <div className="mt-2">
              <Input
                type="time"
                id="doors_time"
                value={doorsTime}
                onChange={(e) => setDoorsTime(e.target.value)}
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="last_entry_time" className="block text-sm font-medium leading-6 text-gray-900">
              Last Entry Time
            </label>
            <div className="mt-2">
              <Input
                type="time"
                id="last_entry_time"
                value={lastEntryTime}
                onChange={(e) => setLastEntryTime(e.target.value)}
                fullWidth
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
              <Input
                type="number"
                id="price"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value)
                  const priceValue = e.target.value && e.target.value !== '' ? parseFloat(e.target.value) : 0
                  setIsFree(priceValue === 0)
                }}
                min="0"
                step="0.01"
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-4">
            <label htmlFor="booking_url" className="block text-sm font-medium leading-6 text-gray-900">
              External Booking URL
            </label>
            <div className="mt-2">
              <Input
                type="url"
                id="booking_url"
                value={bookingUrl}
                onChange={(e) => setBookingUrl(e.target.value)}
                placeholder="https://example.com/book"
                fullWidth
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
              <Input
                type="text"
                id="performer_name"
                value={performerName}
                onChange={(e) => setPerformerName(e.target.value)}
                placeholder="e.g., DJ John, The Blues Band"
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="performer_type" className="block text-sm font-medium leading-6 text-gray-900">
              Performer Type
            </label>
            <div className="mt-2">
              <Select
                id="performer_type"
                value={performerType}
                onChange={(e) => setPerformerType(e.target.value)}
                fullWidth
              >
                <option value="">Select type...</option>
                <option value="MusicGroup">Music Group / Band</option>
                <option value="Person">Solo Performer</option>
                <option value="TheaterGroup">Theater Group</option>
                <option value="DanceGroup">Dance Group</option>
                <option value="ComedyGroup">Comedy Group</option>
                <option value="Organization">Organization</option>
              </Select>
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
        <div className="col-span-full mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-gray-500">
            Draft optimized copy using your event details and brief. Fine-tune anything after the AI pass.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleGenerateSeo}
            disabled={isGeneratingSeo}
          >
            {isGeneratingSeo ? 'Generating...' : 'Generate with AI'}
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <label htmlFor="slug" className="block text-sm font-medium leading-6 text-gray-900">
              URL Slug
            </label>
            <div className="mt-2">
              <Input
                type="text"
                id="slug"
                value={slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
                placeholder="event-name-2024-01-01"
                fullWidth
              />
            </div>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="meta_title" className="block text-sm font-medium leading-6 text-gray-900">
              Meta Title
            </label>
            <div className="mt-2">
              <Input
                type="text"
                id="meta_title"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                maxLength={60}
                placeholder="SEO page title"
                fullWidth
              />
              <p className="mt-1 text-xs text-gray-500">{metaTitle.length}/60 characters</p>
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="meta_description" className="block text-sm font-medium leading-6 text-gray-900">
              Meta Description
            </label>
            <div className="mt-2">
              <DebouncedTextarea
                id="meta_description"
                rows={2}
                value={metaDescription}
                onValueChange={setMetaDescription}
                maxLength={160}
                placeholder="SEO page description"
                fullWidth
              />
              <p className="mt-1 text-xs text-gray-500">{metaDescription.length}/160 characters</p>
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="short_description" className="block text-sm font-medium leading-6 text-gray-900">
              Short Description
            </label>
            <div className="mt-2">
              <DebouncedTextarea
                id="short_description"
                rows={2}
                value={shortDescription}
                onValueChange={setShortDescription}
                maxLength={500}
                placeholder="Brief description for event listings"
                fullWidth
              />
              <p className="mt-1 text-xs text-gray-500">{shortDescription.length}/500 characters</p>
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="long_description" className="block text-sm font-medium leading-6 text-gray-900">
              Long Description
            </label>
            <div className="mt-2">
              <DebouncedTextarea
                id="long_description"
                rows={6}
                value={longDescription}
                onValueChange={setLongDescription}
                placeholder="Detailed description for the event page"
                fullWidth
              />
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="highlights" className="block text-sm font-medium leading-6 text-gray-900">
              Highlights
            </label>
            <div className="mt-2">
              <Input
                type="text"
                id="highlights"
                value={highlights}
                onChange={(e) => setHighlights(e.target.value)}
                placeholder="Great prizes, Fun atmosphere, Live music"
                fullWidth
              />
              <p className="mt-1 text-xs text-gray-500">Separate multiple highlights with commas</p>
            </div>
          </div>

          <div className="col-span-full">
            <label htmlFor="keywords" className="block text-sm font-medium leading-6 text-gray-900">
              Keywords
            </label>
            <div className="mt-2">
              <Input
                type="text"
                id="keywords"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="music, live band, entertainment, pub"
                fullWidth
              />
              <p className="mt-1 text-xs text-gray-500">Separate keywords with commas for better SEO</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>


      {/* Form Actions */}
      <div className="sticky bottom-0 -mx-4 sm:mx-0 px-4 sm:px-0 py-4 bg-white border-t sm:border-0 sm:relative sm:py-0 z-10">
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} fullWidth className="sm:w-auto">
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting} fullWidth className="sm:w-auto">
            {isSubmitting ? 'Saving...' : event ? 'Update Event' : 'Create Event'}
          </Button>
        </div>
      </div>
    </form>
  )
}
