'use client'

import { Event, EventFAQ } from '@/types/database'
import { EventCategory } from '@/types/event-categories'
import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/Button'
import toast from 'react-hot-toast'
import { getActiveEventCategories } from '@/app/actions/event-categories'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { EventImageUpload } from './EventImageUpload'
import { EventImageGallery } from './EventImageGallery'

interface EventFormProps {
  event?: Event
  eventFAQs?: EventFAQ[]
  onSubmit: (data: Omit<Event, 'id' | 'created_at'>, faqs: Omit<EventFAQ, 'id' | 'event_id' | 'created_at' | 'updated_at'>[]) => Promise<void>
  onCancel: () => void
}

export function EventFormEnhanced({ event, eventFAQs = [], onSubmit, onCancel }: EventFormProps) {
  // Helper function to format time to HH:MM
  const formatTimeToHHMM = (timeStr: string) => {
    if (!timeStr) return ''
    return timeStr.substring(0, 5)
  }

  // Generate slug from name and date
  const generateSlug = (name: string, date: string) => {
    const monthYear = date ? new Date(date).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }).toLowerCase() : ''
    const baseSlug = `${name}-${monthYear}`.toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()
    return baseSlug
  }

  // Basic fields
  const [name, setName] = useState(event?.name ?? '')
  const [date, setDate] = useState(event?.date ?? '')
  const [time, setTime] = useState(formatTimeToHHMM(event?.time ?? ''))
  const [capacity, setCapacity] = useState(event?.capacity?.toString() ?? '')
  const [categoryId, setCategoryId] = useState(event?.category_id ?? '')
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Existing additional fields
  const [description, setDescription] = useState(event?.description ?? '')
  const [endTime, setEndTime] = useState(formatTimeToHHMM(event?.end_time ?? ''))
  const [eventStatus, setEventStatus] = useState(event?.event_status ?? 'scheduled')
  const [performerName, setPerformerName] = useState(event?.performer_name ?? '')
  const [performerType, setPerformerType] = useState(event?.performer_type ?? '')
  const [price, setPrice] = useState(event?.price?.toString() ?? '0')
  const [isFree, setIsFree] = useState(event?.is_free !== undefined ? event.is_free : (event?.price === 0 || event?.price === undefined))
  const [bookingUrl, setBookingUrl] = useState(event?.booking_url ?? '')
  const [imageUrls, setImageUrls] = useState<string[]>(event?.image_urls ?? [])

  // Phase 1 SEO fields
  const [slug, setSlug] = useState(event?.slug ?? '')
  const [shortDescription, setShortDescription] = useState(event?.short_description ?? '')
  const [longDescription, setLongDescription] = useState(event?.long_description ?? '')
  const [highlights, setHighlights] = useState<string[]>(event?.highlights ?? [])
  const [metaTitle, setMetaTitle] = useState(event?.meta_title ?? '')
  const [metaDescription, setMetaDescription] = useState(event?.meta_description ?? '')
  const [keywords, setKeywords] = useState<string[]>(event?.keywords ?? [])
  const [heroImageUrl, setHeroImageUrl] = useState(event?.hero_image_url ?? '')
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>(event?.gallery_image_urls ?? [])
  const [posterImageUrl, setPosterImageUrl] = useState(event?.poster_image_url ?? '')
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState(event?.thumbnail_image_url ?? '')
  const [promoVideoUrl, setPromoVideoUrl] = useState(event?.promo_video_url ?? '')
  const [highlightVideoUrls, setHighlightVideoUrls] = useState<string[]>(event?.highlight_video_urls ?? [])
  const [doorsTime, setDoorsTime] = useState(formatTimeToHHMM(event?.doors_time ?? ''))
  const [durationMinutes, setDurationMinutes] = useState(event?.duration_minutes?.toString() ?? '')
  const [lastEntryTime, setLastEntryTime] = useState(formatTimeToHHMM(event?.last_entry_time ?? ''))

  // FAQ management
  const [faqs, setFaqs] = useState<Array<{question: string, answer: string, sort_order: number}>>(
    eventFAQs.map(faq => ({ question: faq.question, answer: faq.answer, sort_order: faq.sort_order }))
  )

  // State for new items being added
  const [newHighlight, setNewHighlight] = useState('')
  const [newKeyword, setNewKeyword] = useState('')
  const [newGalleryImage, setNewGalleryImage] = useState('')
  const [newVideoUrl, setNewVideoUrl] = useState('')

  // Calculate date constraints
  const today = new Date()
  const oneYearFromNow = new Date()
  oneYearFromNow.setFullYear(today.getFullYear() + 1)
  
  const eventDate = event?.date ? new Date(event.date) : null
  const isPastEvent = eventDate && eventDate < today
  const minDate = isPastEvent && event ? event.date : today.toISOString().split('T')[0]
  const maxDate = oneYearFromNow.toISOString().split('T')[0]

  // Auto-generate slug when name or date changes
  useEffect(() => {
    if (!event && name && date) {
      setSlug(generateSlug(name, date))
    }
  }, [name, date, event])

  // Handle category selection
  const handleCategoryChange = (newCategoryId: string) => {
    setCategoryId(newCategoryId)
    
    if (newCategoryId) {
      const selectedCategory = categories.find(c => c.id === newCategoryId)
      if (selectedCategory) {
        // Only update fields if they're currently empty (for new events) or if it's a category change
        if (!event || event.category_id !== newCategoryId) {
          // Basic event settings
          if (!time && selectedCategory.default_start_time) {
            setTime(formatTimeToHHMM(selectedCategory.default_start_time))
          }
          if (!endTime && selectedCategory.default_end_time) {
            setEndTime(formatTimeToHHMM(selectedCategory.default_end_time))
          }
          if (!capacity && selectedCategory.default_capacity) {
            setCapacity(selectedCategory.default_capacity.toString())
          }
          if (!price && selectedCategory.default_price !== undefined) {
            setPrice(selectedCategory.default_price.toString())
            setIsFree(selectedCategory.default_is_free || selectedCategory.default_price === 0)
          }
          if (!performerType && selectedCategory.default_performer_type) {
            setPerformerType(selectedCategory.default_performer_type)
          }
          if (!eventStatus && selectedCategory.default_event_status) {
            setEventStatus(selectedCategory.default_event_status)
          }
          if (!bookingUrl && selectedCategory.default_booking_url) {
            setBookingUrl(selectedCategory.default_booking_url)
          }
          
          // SEO and content fields
          if (!shortDescription && selectedCategory.short_description) {
            setShortDescription(selectedCategory.short_description)
          }
          if (!longDescription && selectedCategory.long_description) {
            setLongDescription(selectedCategory.long_description)
          }
          if (!metaTitle && selectedCategory.meta_title) {
            setMetaTitle(selectedCategory.meta_title)
          }
          if (!metaDescription && selectedCategory.meta_description) {
            setMetaDescription(selectedCategory.meta_description)
          }
          
          // Arrays - only set if current is empty
          if (highlights.length === 0 && selectedCategory.highlights) {
            setHighlights(selectedCategory.highlights)
          }
          if (keywords.length === 0 && selectedCategory.keywords) {
            setKeywords(selectedCategory.keywords)
          }
          if (galleryImageUrls.length === 0 && selectedCategory.gallery_image_urls) {
            setGalleryImageUrls(selectedCategory.gallery_image_urls)
          }
          if (highlightVideoUrls.length === 0 && selectedCategory.highlight_video_urls) {
            setHighlightVideoUrls(selectedCategory.highlight_video_urls)
          }
          if (faqs.length === 0 && selectedCategory.faqs) {
            setFaqs(selectedCategory.faqs)
          }
          
          // Media fields
          if (!heroImageUrl && selectedCategory.default_image_url) {
            setHeroImageUrl(selectedCategory.default_image_url)
          }
          if (!thumbnailImageUrl && selectedCategory.thumbnail_image_url) {
            setThumbnailImageUrl(selectedCategory.thumbnail_image_url)
          }
          if (!posterImageUrl && selectedCategory.poster_image_url) {
            setPosterImageUrl(selectedCategory.poster_image_url)
          }
          if (!promoVideoUrl && selectedCategory.promo_video_url) {
            setPromoVideoUrl(selectedCategory.promo_video_url)
          }
          
          // Timing fields
          if (!durationMinutes && selectedCategory.default_duration_minutes) {
            setDurationMinutes(selectedCategory.default_duration_minutes.toString())
          }
          if (!doorsTime && selectedCategory.default_doors_time) {
            setDoorsTime(selectedCategory.default_doors_time)
          }
          if (!lastEntryTime && selectedCategory.default_last_entry_time) {
            setLastEntryTime(formatTimeToHHMM(selectedCategory.default_last_entry_time))
          }
        }
      }
    }
  }

  // Load categories
  useEffect(() => {
    const loadCategories = async () => {
      const result = await getActiveEventCategories()
      if (result.data) {
        setCategories(result.data)
        
        if (!event && !categoryId) {
          const defaultCategory = result.data.find(c => 'is_default' in c && c.is_default)
          if (defaultCategory) {
            setCategoryId(defaultCategory.id)
            if (!time && defaultCategory.default_start_time) {
              setTime(formatTimeToHHMM(defaultCategory.default_start_time))
            }
            if (!capacity && defaultCategory.default_capacity) {
              setCapacity(defaultCategory.default_capacity.toString())
            }
          }
        }
      }
    }
    
    loadCategories()
  }, [])

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
      const eventData: Omit<Event, 'id' | 'created_at'> = {
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
        parent_event_id: null,
        // SEO fields
        slug: slug || generateSlug(name, date),
        short_description: shortDescription || null,
        long_description: longDescription || null,
        highlights: highlights.length > 0 ? highlights : [],
        meta_title: metaTitle || null,
        meta_description: metaDescription || null,
        keywords: keywords.length > 0 ? keywords : [],
        hero_image_url: heroImageUrl || null,
        gallery_image_urls: galleryImageUrls.length > 0 ? galleryImageUrls : [],
        poster_image_url: posterImageUrl || null,
        thumbnail_image_url: thumbnailImageUrl || null,
        promo_video_url: promoVideoUrl || null,
        highlight_video_urls: highlightVideoUrls.length > 0 ? highlightVideoUrls : [],
        doors_time: doorsTime || null,
        duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
        last_entry_time: lastEntryTime || null,
      }

      await onSubmit(eventData, faqs)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Helper functions for managing arrays
  const addHighlight = () => {
    if (newHighlight.trim()) {
      setHighlights([...highlights, newHighlight.trim()])
      setNewHighlight('')
    }
  }

  const removeHighlight = (index: number) => {
    setHighlights(highlights.filter((_, i) => i !== index))
  }

  const addKeyword = () => {
    if (newKeyword.trim()) {
      setKeywords([...keywords, newKeyword.trim()])
      setNewKeyword('')
    }
  }

  const removeKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index))
  }

  const addGalleryImage = () => {
    if (newGalleryImage.trim()) {
      setGalleryImageUrls([...galleryImageUrls, newGalleryImage.trim()])
      setNewGalleryImage('')
    }
  }

  const removeGalleryImage = (index: number) => {
    setGalleryImageUrls(galleryImageUrls.filter((_, i) => i !== index))
  }

  const addVideoUrl = () => {
    if (newVideoUrl.trim()) {
      setHighlightVideoUrls([...highlightVideoUrls, newVideoUrl.trim()])
      setNewVideoUrl('')
    }
  }

  const removeVideoUrl = (index: number) => {
    setHighlightVideoUrls(highlightVideoUrls.filter((_, i) => i !== index))
  }

  const addFAQ = () => {
    setFaqs([...faqs, { question: '', answer: '', sort_order: faqs.length * 10 }])
  }

  const updateFAQ = (index: number, field: 'question' | 'answer', value: string) => {
    const newFaqs = [...faqs]
    newFaqs[index][field] = value
    setFaqs(newFaqs)
  }

  const removeFAQ = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Information Section */}
      <div className="bg-white shadow sm:rounded-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Basic Information
        </h2>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="name" className="block text-sm font-medium text-gray-900 mb-2">
              Event Name *
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
            <label htmlFor="slug" className="block text-sm font-medium text-gray-900 mb-2">
              URL Slug *
            </label>
            <input
              type="text"
              id="slug"
              name="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              required
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="event-name-month-year"
            />
            <p className="mt-1 text-xs text-gray-500">URL-friendly version of the event name</p>
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
          </div>

          <div>
            <label htmlFor="date" className="block text-sm font-medium text-gray-900 mb-2">
              Date *
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
          </div>

          <div>
            <label htmlFor="time" className="block text-sm font-medium text-gray-900 mb-2">
              Start Time *
            </label>
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

          <div>
            <label htmlFor="doors_time" className="block text-sm font-medium text-gray-900 mb-2">
              Doors Open Time
            </label>
            <input
              type="time"
              id="doors_time"
              name="doors_time"
              value={doorsTime}
              onChange={(e) => setDoorsTime(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">If different from start time</p>
          </div>

          <div>
            <label htmlFor="end_time" className="block text-sm font-medium text-gray-900 mb-2">
              End Time
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
            <label htmlFor="duration_minutes" className="block text-sm font-medium text-gray-900 mb-2">
              Duration (minutes)
            </label>
            <input
              type="number"
              id="duration_minutes"
              name="duration_minutes"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              min="1"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="120"
            />
          </div>

          <div>
            <label htmlFor="last_entry_time" className="block text-sm font-medium text-gray-900 mb-2">
              Last Entry Time
            </label>
            <input
              type="time"
              id="last_entry_time"
              name="last_entry_time"
              value={lastEntryTime}
              onChange={(e) => setLastEntryTime(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
            />
          </div>

          <div>
            <label htmlFor="capacity" className="block text-sm font-medium text-gray-900 mb-2">
              Capacity
            </label>
            <input
              type="number"
              id="capacity"
              name="capacity"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              min="1"
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="Leave empty for unlimited"
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
        </div>
      </div>

      {/* Content & SEO Section */}
      <div className="bg-white shadow sm:rounded-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Content & SEO
        </h2>
        
        <div className="space-y-6">
          <div>
            <label htmlFor="short_description" className="block text-sm font-medium text-gray-900 mb-2">
              Short Description (50-150 characters)
            </label>
            <textarea
              id="short_description"
              name="short_description"
              value={shortDescription}
              onChange={(e) => setShortDescription(e.target.value)}
              rows={2}
              maxLength={150}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="Brief description for list views and search results"
            />
            <p className="mt-1 text-xs text-gray-500">{shortDescription.length}/150 characters</p>
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-900 mb-2">
              Standard Description
            </label>
            <textarea
              id="description"
              name="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="Standard event description"
            />
          </div>

          <div>
            <label htmlFor="long_description" className="block text-sm font-medium text-gray-900 mb-2">
              Full Description (HTML/Markdown)
            </label>
            <textarea
              id="long_description"
              name="long_description"
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              rows={6}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm font-mono text-xs"
              placeholder="<p>Full HTML content for the event page...</p>"
            />
            <p className="mt-1 text-xs text-gray-500">Supports HTML and Markdown for rich content</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Event Highlights
            </label>
            <div className="space-y-2">
              {highlights.map((highlight, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={highlight}
                    readOnly
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-gray-50"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeHighlight(index)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={newHighlight}
                  onChange={(e) => setNewHighlight(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addHighlight())}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  placeholder="Add a highlight (e.g., 'Award-winning performer')"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addHighlight}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <label htmlFor="meta_title" className="block text-sm font-medium text-gray-900 mb-2">
                SEO Page Title
              </label>
              <input
                type="text"
                id="meta_title"
                name="meta_title"
                value={metaTitle}
                onChange={(e) => setMetaTitle(e.target.value)}
                maxLength={60}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                placeholder="Custom page title (defaults to event name)"
              />
              <p className="mt-1 text-xs text-gray-500">{metaTitle.length}/60 characters</p>
            </div>

            <div>
              <label htmlFor="meta_description" className="block text-sm font-medium text-gray-900 mb-2">
                SEO Meta Description
              </label>
              <textarea
                id="meta_description"
                name="meta_description"
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                rows={2}
                maxLength={160}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                placeholder="Custom meta description for search engines"
              />
              <p className="mt-1 text-xs text-gray-500">{metaDescription.length}/160 characters</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              SEO Keywords
            </label>
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {keywords.map((keyword, index) => (
                  <span key={index} className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-800">
                    {keyword}
                    <button
                      type="button"
                      onClick={() => removeKeyword(index)}
                      className="ml-2 text-gray-600 hover:text-gray-900"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  placeholder="Add a keyword (e.g., 'drag show stanwell moor')"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addKeyword}
                >
                  Add
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Media Section */}
      <div className="bg-white shadow sm:rounded-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Media & Images
        </h2>
        
        <div className="space-y-6">
          {/* Image Upload Section */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div>
              <EventImageUpload
                eventId={event?.id || 'temp-id'}
                imageType="hero"
                currentImageUrl={heroImageUrl}
                label="Hero Image"
                helpText="Main image (1200x630 minimum for Open Graph)"
                onImageUploaded={(url) => setHeroImageUrl(url)}
                onImageDeleted={() => setHeroImageUrl('')}
              />
            </div>

            <div>
              <EventImageUpload
                eventId={event?.id || 'temp-id'}
                imageType="thumbnail"
                currentImageUrl={thumbnailImageUrl}
                label="Thumbnail Image"
                helpText="Square image for list views (400x400)"
                onImageUploaded={(url) => setThumbnailImageUrl(url)}
                onImageDeleted={() => setThumbnailImageUrl('')}
              />
            </div>

            <div>
              <EventImageUpload
                eventId={event?.id || 'temp-id'}
                imageType="poster"
                currentImageUrl={posterImageUrl}
                label="Poster/Flyer"
                helpText="Event poster or flyer image"
                onImageUploaded={(url) => setPosterImageUrl(url)}
                onImageDeleted={() => setPosterImageUrl('')}
              />
            </div>
          </div>

          {/* Manual URL Input Options */}
          <details className="border rounded-lg p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              Or enter image URLs manually
            </summary>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="hero_image_url" className="block text-sm font-medium text-gray-700">
                  Hero Image URL
                </label>
                <input
                  type="url"
                  id="hero_image_url"
                  value={heroImageUrl}
                  onChange={(e) => setHeroImageUrl(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="https://example.com/hero.jpg"
                />
              </div>
              <div>
                <label htmlFor="thumbnail_image_url" className="block text-sm font-medium text-gray-700">
                  Thumbnail Image URL
                </label>
                <input
                  type="url"
                  id="thumbnail_image_url"
                  value={thumbnailImageUrl}
                  onChange={(e) => setThumbnailImageUrl(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="https://example.com/thumbnail.jpg"
                />
              </div>
              <div>
                <label htmlFor="poster_image_url" className="block text-sm font-medium text-gray-700">
                  Poster Image URL
                </label>
                <input
                  type="url"
                  id="poster_image_url"
                  value={posterImageUrl}
                  onChange={(e) => setPosterImageUrl(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  placeholder="https://example.com/poster.jpg"
                />
              </div>
            </div>
          </details>

          {/* Video URLs */}
          <div>
            <label htmlFor="promo_video_url" className="block text-sm font-medium text-gray-900 mb-2">
              Promo Video URL
            </label>
            <input
              type="url"
              id="promo_video_url"
              name="promo_video_url"
              value={promoVideoUrl}
              onChange={(e) => setPromoVideoUrl(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              placeholder="https://youtube.com/watch?v=..."
            />
          </div>

          {/* Gallery Images */}
          {event?.id && (
            <EventImageGallery
              eventId={event.id}
              onImagesChange={() => {
                // Optionally refresh gallery URLs
              }}
            />
          )}
          
          {/* Manual Gallery URL Input */}
          <details className="border rounded-lg p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-700">
              Add gallery images via URL
            </summary>
            <div className="mt-4 space-y-2">
              {galleryImageUrls.map((url, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="url"
                    value={url}
                    readOnly
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-gray-50"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeGalleryImage(index)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center space-x-2">
                <input
                  type="url"
                  value={newGalleryImage}
                  onChange={(e) => setNewGalleryImage(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  placeholder="Add gallery image URL"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addGalleryImage}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </details>

          <div>
            <label className="block text-sm font-medium text-gray-900 mb-2">
              Highlight Videos
            </label>
            <div className="space-y-2">
              {highlightVideoUrls.map((url, index) => (
                <div key={index} className="flex items-center space-x-2">
                  <input
                    type="url"
                    value={url}
                    readOnly
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 bg-gray-50"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeVideoUrl(index)}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex items-center space-x-2">
                <input
                  type="url"
                  value={newVideoUrl}
                  onChange={(e) => setNewVideoUrl(e.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                  placeholder="Add highlight video URL"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={addVideoUrl}
                >
                  <PlusIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Performer Section */}
      <div className="bg-white shadow sm:rounded-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Performer Information
        </h2>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="performer_name" className="block text-sm font-medium text-gray-900 mb-2">
              Performer Name
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
              Performer Type
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
      </div>

      {/* Pricing & Booking Section */}
      <div className="bg-white shadow sm:rounded-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Pricing & Booking
        </h2>
        
        <div className="space-y-4">
          <div>
            <div className="flex items-center mb-4">
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
              External Booking URL
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
            <p className="mt-1 text-xs text-gray-500">External URL for ticket booking if not using internal system</p>
          </div>
        </div>
      </div>

      {/* FAQ Section */}
      <div className="bg-white shadow sm:rounded-lg p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-6">
          Frequently Asked Questions
        </h2>
        
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="p-4 border border-gray-200 rounded-lg">
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Question {index + 1}
                  </label>
                  <input
                    type="text"
                    value={faq.question}
                    onChange={(e) => updateFAQ(index, 'question', e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                    placeholder="e.g., Is this event suitable for children?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1">
                    Answer
                  </label>
                  <textarea
                    value={faq.answer}
                    onChange={(e) => updateFAQ(index, 'answer', e.target.value)}
                    rows={2}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
                    placeholder="Provide a helpful answer..."
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => removeFAQ(index)}
                  >
                    <TrashIcon className="h-4 w-4 mr-1" />
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ))}
          
          <Button
            type="button"
            variant="secondary"
            onClick={addFAQ}
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Add FAQ
          </Button>
        </div>
      </div>

      {/* Submit Buttons */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:space-y-0 sm:space-x-3 sm:justify-end">
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