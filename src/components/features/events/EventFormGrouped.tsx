'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Event } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { DebouncedTextarea } from '@/components/ui-v2/forms/DebouncedTextarea'
import type { DebouncedTextareaRef } from '@/components/ui-v2/forms/DebouncedTextarea'
import { KeywordStrategyCard } from './KeywordStrategyCard'
import { FaqEditor } from './FaqEditor'
import { SeoHealthIndicator } from './SeoHealthIndicator'
import { parseKeywords, keywordsToDisplay, buildKeywordsUnion } from '@/lib/keywords'
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
  const [eventStatus, setEventStatus] = useState(event?.event_status ?? 'draft')
  const [bookingMode, setBookingMode] = useState<'table' | 'general' | 'mixed'>(
    (event?.booking_mode as 'table' | 'general' | 'mixed') ?? 'table'
  )
  const [eventType, setEventType] = useState(event?.event_type ?? '')
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

  // FAQ state — load existing FAQs from event, track whether modified
  const [faqs, setFaqs] = useState<{ question: string; answer: string; sort_order?: number }[]>(
    (event as any)?.event_faqs?.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) ?? []
  )
  const [faqsModified, setFaqsModified] = useState(false)

  // Keyword strategy (raw textarea values)
  const [primaryKeywords, setPrimaryKeywords] = useState(keywordsToDisplay((event as any)?.primary_keywords))
  const [secondaryKeywords, setSecondaryKeywords] = useState(keywordsToDisplay((event as any)?.secondary_keywords))
  const [localSeoKeywords, setLocalSeoKeywords] = useState(keywordsToDisplay((event as any)?.local_seo_keywords))

  // New SEO fields
  const [imageAltText, setImageAltText] = useState((event as any)?.image_alt_text ?? '')
  const [facebookEventName, setFacebookEventName] = useState(event?.facebook_event_name ?? '')
  const [facebookEventDescription, setFacebookEventDescription] = useState(event?.facebook_event_description ?? '')
  const [socialCopyWhatsapp, setSocialCopyWhatsapp] = useState((event as any)?.social_copy_whatsapp ?? '')
  const [previousEventSummary, setPreviousEventSummary] = useState((event as any)?.previous_event_summary ?? '')
  const [attendanceNote, setAttendanceNote] = useState((event as any)?.attendance_note ?? '')
  const [cancellationPolicy, setCancellationPolicy] = useState((event as any)?.cancellation_policy ?? '')
  const [accessibilityNotes, setAccessibilityNotes] = useState((event as any)?.accessibility_notes ?? '')

  // DebouncedTextarea refs for flushing before AI generation
  const briefRef = useRef<DebouncedTextareaRef>(null)
  const shortDescRef = useRef<DebouncedTextareaRef>(null)
  const longDescRef = useRef<DebouncedTextareaRef>(null)

  // Legacy keyword migration: if event has flat keywords but no tiers, pre-populate secondary
  const [legacyMigrated] = useState(() => {
    if (event?.keywords?.length && !(event as any)?.primary_keywords?.length && !(event as any)?.secondary_keywords?.length && !(event as any)?.local_seo_keywords?.length) {
      return keywordsToDisplay(event.keywords)
    }
    return ''
  })

  useEffect(() => {
    if (legacyMigrated) {
      setSecondaryKeywords(legacyMigrated)
    }
  }, [legacyMigrated])

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
      // Cast to allow new fields not yet in the Event type definition
      const eventData: Partial<Event> & Record<string, unknown> = {
        name: name.trim(),
        date,
        time,
        end_time: endTime || null,
        category_id: categoryId || null,
        event_status: eventStatus,
        booking_mode: bookingMode,
        event_type: eventType.trim() || null,
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
        keywords: buildKeywordsUnion(parseKeywords(primaryKeywords), parseKeywords(secondaryKeywords), parseKeywords(localSeoKeywords)),
        primary_keywords: parseKeywords(primaryKeywords),
        secondary_keywords: parseKeywords(secondaryKeywords),
        local_seo_keywords: parseKeywords(localSeoKeywords),
        image_alt_text: imageAltText || null,
        facebook_event_name: facebookEventName.trim() || null,
        facebook_event_description: facebookEventDescription.trim() || null,
        social_copy_whatsapp: socialCopyWhatsapp || null,
        previous_event_summary: previousEventSummary || null,
        attendance_note: attendanceNote || null,
        cancellation_policy: cancellationPolicy || null,
        accessibility_notes: accessibilityNotes || null,
        // Additional timing and booking fields
        booking_url: bookingUrl.trim() || undefined,
        doors_time: doorsTime || null,
        duration_minutes: durationMinutes && durationMinutes !== '' ? parseInt(durationMinutes) : null,
        last_entry_time: lastEntryTime || null,
        brief: brief.trim() ? brief.trim() : null,
        // Only include FAQs when they have been explicitly modified
        ...(faqsModified ? { faqs } : {}),
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
      // Cascade keyword tiers from category
      const cat = selectedCategory as any
      if (!primaryKeywords && cat.primary_keywords?.length) setPrimaryKeywords(keywordsToDisplay(cat.primary_keywords))
      if (!secondaryKeywords && cat.secondary_keywords?.length) setSecondaryKeywords(keywordsToDisplay(cat.secondary_keywords))
      if (!localSeoKeywords && cat.local_seo_keywords?.length) setLocalSeoKeywords(keywordsToDisplay(cat.local_seo_keywords))
      if (!cancellationPolicy && cat.cancellation_policy) setCancellationPolicy(cat.cancellation_policy)
      if (!accessibilityNotes && cat.accessibility_notes) setAccessibilityNotes(cat.accessibility_notes)
      if (!imageAltText && cat.image_alt_text) setImageAltText(cat.image_alt_text)
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
    // Flush debounced fields so latest values are available
    briefRef.current?.flush()
    shortDescRef.current?.flush()
    longDescRef.current?.flush()

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
        existingKeywords: keywords ? keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
        primaryKeywords: parseKeywords(primaryKeywords),
        secondaryKeywords: parseKeywords(secondaryKeywords),
        localSeoKeywords: parseKeywords(localSeoKeywords),
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
      if (result.data.imageAltText) setImageAltText(result.data.imageAltText)
      if (result.data.faqs?.length) {
        setFaqs(result.data.faqs.map((faq: any, i: number) => ({ ...faq, sort_order: i })))
        setFaqsModified(true)
      }
      if (result.data.facebookEventName) setFacebookEventName(result.data.facebookEventName)
      if (result.data.facebookEventDescription) setFacebookEventDescription(result.data.facebookEventDescription)
      if (result.data.socialCopyWhatsapp) setSocialCopyWhatsapp(result.data.socialCopyWhatsapp)
      if (result.data.cancellationPolicy) setCancellationPolicy(result.data.cancellationPolicy)

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
            <label htmlFor="event_type" className="block text-sm font-medium leading-6 text-gray-900">
              Event Type
            </label>
            <div className="mt-2">
              <Input
                type="text"
                id="event_type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder="e.g., open_mic, quiz_night, live_music"
                fullWidth
              />
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
                ref={briefRef}
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

          {/* Keyword Strategy */}
          <div className="col-span-full">
            <KeywordStrategyCard
              primaryKeywords={primaryKeywords}
              secondaryKeywords={secondaryKeywords}
              localSeoKeywords={localSeoKeywords}
              onPrimaryChange={setPrimaryKeywords}
              onSecondaryChange={setSecondaryKeywords}
              onLocalChange={setLocalSeoKeywords}
            />
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

          <div className="sm:col-span-2">
            <label htmlFor="booking_mode" className="block text-sm font-medium leading-6 text-gray-900">
              Booking mode
            </label>
            <div className="mt-2">
              <Select
                id="booking_mode"
                value={bookingMode}
                onChange={(e) => setBookingMode(e.target.value as 'table' | 'general' | 'mixed')}
                fullWidth
              >
                <option value="table">Table bookings (default)</option>
                <option value="general">General entry only</option>
                <option value="mixed">Mixed (table + general)</option>
              </Select>
            </div>
          </div>

          <div className="sm:col-span-2">
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
        <div className="col-span-full mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
            {isGeneratingSeo ? 'Generating...' : 'Generate All Content'}
          </Button>
        </div>

        {/* Group 1: Meta & URL */}
        <div className="mb-8">
          <h4 className="text-sm font-semibold text-gray-700 mb-4">Meta &amp; URL</h4>
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
          </div>
        </div>

        {/* Group 2: Content */}
        <div className="mb-8">
          <h4 className="text-sm font-semibold text-gray-700 mb-4">Content</h4>
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
            <div className="col-span-full">
              <label htmlFor="short_description" className="block text-sm font-medium leading-6 text-gray-900">
                Short Description
              </label>
              <div className="mt-2">
                <DebouncedTextarea
                  ref={shortDescRef}
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
                  ref={longDescRef}
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
          </div>
        </div>

        {/* Group 3: AI-Generated & E-E-A-T Content */}
        <div className="mb-8">
          <h4 className="text-sm font-semibold text-gray-700 mb-4">AI-Generated &amp; E-E-A-T Content</h4>
          <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
            <div className="col-span-full">
              <label htmlFor="image_alt_text" className="block text-sm font-medium leading-6 text-gray-900">
                Image Alt Text
              </label>
              <div className="mt-2">
                <Input
                  type="text"
                  id="image_alt_text"
                  value={imageAltText}
                  onChange={(e) => setImageAltText(e.target.value)}
                  maxLength={200}
                  placeholder="Descriptive alt text for the event image"
                  fullWidth
                />
                <p className="mt-1 text-xs text-gray-500">{imageAltText.length}/200 characters</p>
              </div>
            </div>

            <div className="col-span-full">
              <FaqEditor
                faqs={faqs}
                onChange={setFaqs}
                onModified={() => setFaqsModified(true)}
              />
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="facebook_event_name" className="block text-sm font-medium leading-6 text-gray-900">
                Facebook Event Name
              </label>
              <div className="mt-2">
                <Input
                  type="text"
                  id="facebook_event_name"
                  value={facebookEventName}
                  onChange={(e) => setFacebookEventName(e.target.value)}
                  placeholder="Event name for Facebook"
                  fullWidth
                />
              </div>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="facebook_event_description" className="block text-sm font-medium leading-6 text-gray-900">
                Facebook Event Description
              </label>
              <div className="mt-2">
                <Input
                  type="text"
                  id="facebook_event_description"
                  value={facebookEventDescription}
                  onChange={(e) => setFacebookEventDescription(e.target.value)}
                  placeholder="Description for Facebook event"
                  fullWidth
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="social_copy_whatsapp" className="block text-sm font-medium leading-6 text-gray-900">
                WhatsApp Copy
              </label>
              <div className="mt-2">
                <DebouncedTextarea
                  id="social_copy_whatsapp"
                  rows={3}
                  value={socialCopyWhatsapp}
                  onValueChange={setSocialCopyWhatsapp}
                  maxLength={300}
                  placeholder="Short, shareable message for WhatsApp groups"
                  fullWidth
                />
                <p className="mt-1 text-xs text-gray-500">{socialCopyWhatsapp.length}/300 characters</p>
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="previous_event_summary" className="block text-sm font-medium leading-6 text-gray-900">
                Previous Event Summary
              </label>
              <div className="mt-2">
                <DebouncedTextarea
                  id="previous_event_summary"
                  rows={3}
                  value={previousEventSummary}
                  onValueChange={setPreviousEventSummary}
                  placeholder="What happened last time? Crowd size, highlights, memorable moments..."
                  fullWidth
                />
              </div>
              <p className="mt-1 text-xs text-gray-500">Manual — adds E-E-A-T experience signal</p>
            </div>

            <div className="sm:col-span-3">
              <label htmlFor="attendance_note" className="block text-sm font-medium leading-6 text-gray-900">
                Attendance Note
              </label>
              <div className="mt-2">
                <Input
                  type="text"
                  id="attendance_note"
                  value={attendanceNote}
                  onChange={(e) => setAttendanceNote(e.target.value)}
                  placeholder='e.g., "Arrive early — this event regularly sells out"'
                  fullWidth
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="cancellation_policy" className="block text-sm font-medium leading-6 text-gray-900">
                Cancellation Policy
                <span className="ml-2 text-xs font-normal text-amber-600">Draft — review before publishing</span>
              </label>
              <div className="mt-2">
                <DebouncedTextarea
                  id="cancellation_policy"
                  rows={3}
                  value={cancellationPolicy}
                  onValueChange={setCancellationPolicy}
                  placeholder="Cancellation and refund policy for this event..."
                  fullWidth
                />
              </div>
            </div>

            <div className="col-span-full">
              <label htmlFor="accessibility_notes" className="block text-sm font-medium leading-6 text-gray-900">
                Accessibility Notes
              </label>
              <div className="mt-2">
                <DebouncedTextarea
                  id="accessibility_notes"
                  rows={3}
                  value={accessibilityNotes}
                  onValueChange={setAccessibilityNotes}
                  placeholder="Wheelchair access, hearing loop, accessible parking, etc."
                  fullWidth
                />
              </div>
            </div>
          </div>
        </div>

        {/* Group 4: SEO Health Indicator */}
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-4">SEO Health</h4>
          <SeoHealthIndicator
            metaTitle={metaTitle}
            metaDescription={metaDescription}
            shortDescription={shortDescription}
            longDescription={longDescription}
            slug={slug}
            highlights={highlights}
            primaryKeywords={parseKeywords(primaryKeywords)}
            imageAltText={imageAltText}
            faqCount={faqs.length}
            socialCopyPresent={!!(socialCopyWhatsapp || facebookEventDescription)}
            accessibilityNotes={accessibilityNotes}
          />
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
