'use client'

import { useState, useEffect } from 'react'
import { EventCategory, CategoryFormData, CATEGORY_COLORS, CATEGORY_ICONS } from '@/types/event-categories'
import { Button } from '@/components/ui/Button'
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'
import { generateSlug } from '@/lib/utils'
import { createEventCategory, updateEventCategory } from '@/app/actions/event-categories'

interface EventCategoryFormEnhancedProps {
  category?: EventCategory | null
  onSuccess: () => void
  onCancel: () => void
}

export function EventCategoryFormEnhanced({ category, onSuccess, onCancel }: EventCategoryFormEnhancedProps) {
  // Basic fields
  const [name, setName] = useState(category?.name ?? '')
  const [slug, setSlug] = useState(category?.slug ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0].value)
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICONS[0].value)
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [sortOrder, setSortOrder] = useState(category?.sort_order?.toString() ?? '0')
  
  // Default event settings
  const [defaultStartTime, setDefaultStartTime] = useState(category?.default_start_time ?? '19:00')
  const [defaultEndTime, setDefaultEndTime] = useState(category?.default_end_time ?? '22:00')
  const [defaultCapacity, setDefaultCapacity] = useState(category?.default_capacity?.toString() ?? '')
  const [defaultReminderHours, setDefaultReminderHours] = useState(category?.default_reminder_hours?.toString() ?? '24')
  const [defaultPrice, setDefaultPrice] = useState(category?.default_price?.toString() ?? '0')
  const [defaultIsFree, setDefaultIsFree] = useState(category?.default_is_free ?? true)
  const [defaultPerformerType, setDefaultPerformerType] = useState(category?.default_performer_type ?? '')
  const [defaultEventStatus, setDefaultEventStatus] = useState(category?.default_event_status ?? 'scheduled')
  const [defaultBookingUrl, setDefaultBookingUrl] = useState(category?.default_booking_url ?? '')
  
  // SEO fields
  const [shortDescription, setShortDescription] = useState(category?.short_description ?? '')
  const [longDescription, setLongDescription] = useState(category?.long_description ?? '')
  const [metaTitle, setMetaTitle] = useState(category?.meta_title ?? '')
  const [metaDescription, setMetaDescription] = useState(category?.meta_description ?? '')
  
  // Media fields
  const [defaultImageUrl, setDefaultImageUrl] = useState(category?.default_image_url ?? '')
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState(category?.thumbnail_image_url ?? '')
  const [posterImageUrl, setPosterImageUrl] = useState(category?.poster_image_url ?? '')
  const [promoVideoUrl, setPromoVideoUrl] = useState(category?.promo_video_url ?? '')
  
  // Arrays
  const [highlights, setHighlights] = useState<string[]>(category?.highlights ?? [])
  const [keywords, setKeywords] = useState<string[]>(category?.keywords ?? [])
  const [galleryImageUrls, setGalleryImageUrls] = useState<string[]>(category?.gallery_image_urls ?? [])
  const [highlightVideoUrls, setHighlightVideoUrls] = useState<string[]>(category?.highlight_video_urls ?? [])
  const [faqs, setFaqs] = useState<Array<{ question: string; answer: string; sort_order: number }>>(
    category?.faqs ?? []
  )
  
  // Timing fields
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    category?.default_duration_minutes?.toString() ?? ''
  )
  const [defaultDoorsTime, setDefaultDoorsTime] = useState(category?.default_doors_time ?? '')
  const [defaultLastEntryTime, setDefaultLastEntryTime] = useState(category?.default_last_entry_time ?? '')
  
  // Form state
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Input helpers
  const [newHighlight, setNewHighlight] = useState('')
  const [newKeyword, setNewKeyword] = useState('')
  const [newGalleryUrl, setNewGalleryUrl] = useState('')
  const [newVideoUrl, setNewVideoUrl] = useState('')

  // Auto-generate slug from name
  useEffect(() => {
    if (!category && name) {
      setSlug(generateSlug(name))
    }
  }, [name, category])

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
    if (newGalleryUrl.trim()) {
      setGalleryImageUrls([...galleryImageUrls, newGalleryUrl.trim()])
      setNewGalleryUrl('')
    }
  }

  const removeGalleryImage = (index: number) => {
    setGalleryImageUrls(galleryImageUrls.filter((_, i) => i !== index))
  }

  const addHighlightVideo = () => {
    if (newVideoUrl.trim()) {
      setHighlightVideoUrls([...highlightVideoUrls, newVideoUrl.trim()])
      setNewVideoUrl('')
    }
  }

  const removeHighlightVideo = (index: number) => {
    setHighlightVideoUrls(highlightVideoUrls.filter((_, i) => i !== index))
  }

  const addFaq = () => {
    setFaqs([...faqs, { question: '', answer: '', sort_order: faqs.length }])
  }

  const updateFaq = (index: number, field: 'question' | 'answer', value: string) => {
    const updatedFaqs = [...faqs]
    updatedFaqs[index][field] = value
    setFaqs(updatedFaqs)
  }

  const removeFaq = (index: number) => {
    setFaqs(faqs.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      toast.error('Category name is required')
      return
    }

    setIsSubmitting(true)
    try {
      const formData: CategoryFormData = {
        name: name.trim(),
        slug: slug.trim(),
        description: description.trim() || undefined,
        color,
        icon,
        is_active: isActive,
        sort_order: parseInt(sortOrder, 10),
        default_start_time: defaultStartTime || undefined,
        default_end_time: defaultEndTime || undefined,
        default_capacity: defaultCapacity ? parseInt(defaultCapacity, 10) : undefined,
        default_reminder_hours: parseInt(defaultReminderHours, 10),
        default_price: defaultPrice ? parseFloat(defaultPrice) : 0,
        default_is_free: defaultIsFree,
        default_performer_type: defaultPerformerType || undefined,
        default_event_status: defaultEventStatus,
        default_booking_url: defaultBookingUrl || undefined,
        default_image_url: defaultImageUrl || undefined,
        short_description: shortDescription || undefined,
        long_description: longDescription || undefined,
        meta_title: metaTitle || undefined,
        meta_description: metaDescription || undefined,
        highlights: highlights.length > 0 ? highlights : undefined,
        keywords: keywords.length > 0 ? keywords : undefined,
        gallery_image_urls: galleryImageUrls.length > 0 ? galleryImageUrls : undefined,
        poster_image_url: posterImageUrl || undefined,
        thumbnail_image_url: thumbnailImageUrl || undefined,
        promo_video_url: promoVideoUrl || undefined,
        highlight_video_urls: highlightVideoUrls.length > 0 ? highlightVideoUrls : undefined,
        default_duration_minutes: defaultDurationMinutes ? parseInt(defaultDurationMinutes, 10) : undefined,
        default_doors_time: defaultDoorsTime || undefined,
        default_last_entry_time: defaultLastEntryTime || undefined,
        faqs: faqs.filter(f => f.question && f.answer).length > 0 ? 
          faqs.filter(f => f.question && f.answer) : undefined
      }

      const result = category 
        ? await updateEventCategory(category.id, formData)
        : await createEventCategory(formData)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(category ? 'Category updated successfully' : 'Category created successfully')
        onSuccess()
      }
    } catch (error) {
      console.error('Error saving category:', error)
      toast.error('Failed to save category')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* Basic Information */}
      <div className="space-y-6">
        <h3 className="text-lg font-medium text-gray-900">Basic Information</h3>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Category Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">URL Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Color</label>
            <select
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              {CATEGORY_COLORS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Icon</label>
            <select
              value={icon}
              onChange={(e) => setIcon(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              {CATEGORY_ICONS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Sort Order</label>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-sm text-gray-700">Active</span>
            </label>
          </div>
        </div>
      </div>

      {/* Content & SEO */}
      <div className="space-y-6">
        <h3 className="text-lg font-medium text-gray-900">Content & SEO</h3>
        
        <div>
          <label className="block text-sm font-medium text-gray-700">Short Description</label>
          <input
            type="text"
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            placeholder="Brief description (50-150 characters)"
            maxLength={150}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
          <p className="mt-1 text-sm text-gray-500">{shortDescription.length}/150 characters</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">Long Description</label>
          <textarea
            value={longDescription}
            onChange={(e) => setLongDescription(e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Meta Title</label>
            <input
              type="text"
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              placeholder="SEO page title"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Meta Description</label>
            <textarea
              value={metaDescription}
              onChange={(e) => setMetaDescription(e.target.value)}
              placeholder="SEO page description"
              rows={2}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>

        {/* Highlights */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Highlights</label>
          <div className="space-y-2">
            {highlights.map((highlight, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="flex-1 px-3 py-2 bg-gray-100 rounded-md text-sm">{highlight}</span>
                <button
                  type="button"
                  onClick={() => removeHighlight(index)}
                  className="text-red-600 hover:text-red-800"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="text"
                value={newHighlight}
                onChange={(e) => setNewHighlight(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHighlight())}
                placeholder="Add a highlight"
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={addHighlight}
                className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Keywords */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">SEO Keywords</label>
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              {keywords.map((keyword, index) => (
                <span
                  key={index}
                  className="inline-flex items-center gap-1 px-3 py-1 bg-gray-100 rounded-full text-sm"
                >
                  {keyword}
                  <button
                    type="button"
                    onClick={() => removeKeyword(index)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <TrashIcon className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
                placeholder="Add a keyword"
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={addKeyword}
                className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Default Event Settings */}
      <div className="space-y-6">
        <h3 className="text-lg font-medium text-gray-900">Default Event Settings</h3>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Default Start Time</label>
            <input
              type="time"
              value={defaultStartTime}
              onChange={(e) => setDefaultStartTime(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default End Time</label>
            <input
              type="time"
              value={defaultEndTime}
              onChange={(e) => setDefaultEndTime(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Duration (minutes)</label>
            <input
              type="number"
              value={defaultDurationMinutes}
              onChange={(e) => setDefaultDurationMinutes(e.target.value)}
              placeholder="e.g., 120"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Capacity</label>
            <input
              type="number"
              value={defaultCapacity}
              onChange={(e) => setDefaultCapacity(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Doors Open Time</label>
            <input
              type="text"
              value={defaultDoorsTime}
              onChange={(e) => setDefaultDoorsTime(e.target.value)}
              placeholder="e.g., 30 minutes before"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Last Entry Time</label>
            <input
              type="time"
              value={defaultLastEntryTime}
              onChange={(e) => setDefaultLastEntryTime(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Price (£)</label>
            <input
              type="number"
              step="0.01"
              value={defaultPrice}
              onChange={(e) => setDefaultPrice(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={defaultIsFree}
                onChange={(e) => setDefaultIsFree(e.target.checked)}
                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
              />
              <span className="ml-2 text-sm text-gray-700">Events are typically free</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Performer Type</label>
            <select
              value={defaultPerformerType}
              onChange={(e) => setDefaultPerformerType(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="">None</option>
              <option value="Person">Person</option>
              <option value="MusicGroup">Music Group</option>
              <option value="Organization">Organization</option>
              <option value="PerformingGroup">Performing Group</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Status</label>
            <select
              value={defaultEventStatus}
              onChange={(e) => setDefaultEventStatus(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="scheduled">Scheduled</option>
              <option value="cancelled">Cancelled</option>
              <option value="postponed">Postponed</option>
              <option value="rescheduled">Rescheduled</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Reminder (hours)</label>
            <select
              value={defaultReminderHours}
              onChange={(e) => setDefaultReminderHours(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              <option value="1">1 hour</option>
              <option value="12">12 hours</option>
              <option value="24">24 hours</option>
              <option value="168">7 days</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Default Booking URL</label>
            <input
              type="url"
              value={defaultBookingUrl}
              onChange={(e) => setDefaultBookingUrl(e.target.value)}
              placeholder="External booking link"
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>
      </div>

      {/* Media */}
      <div className="space-y-6">
        <h3 className="text-lg font-medium text-gray-900">Media</h3>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">Default Hero Image URL</label>
            <input
              type="url"
              value={defaultImageUrl}
              onChange={(e) => setDefaultImageUrl(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Thumbnail Image URL</label>
            <input
              type="url"
              value={thumbnailImageUrl}
              onChange={(e) => setThumbnailImageUrl(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Poster Image URL</label>
            <input
              type="url"
              value={posterImageUrl}
              onChange={(e) => setPosterImageUrl(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Promo Video URL</label>
            <input
              type="url"
              value={promoVideoUrl}
              onChange={(e) => setPromoVideoUrl(e.target.value)}
              className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            />
          </div>
        </div>

        {/* Gallery Images */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Gallery Images</label>
          <div className="space-y-2">
            {galleryImageUrls.map((url, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="flex-1 px-3 py-2 bg-gray-100 rounded-md text-sm truncate">{url}</span>
                <button
                  type="button"
                  onClick={() => removeGalleryImage(index)}
                  className="text-red-600 hover:text-red-800"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="url"
                value={newGalleryUrl}
                onChange={(e) => setNewGalleryUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addGalleryImage())}
                placeholder="Add gallery image URL"
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={addGalleryImage}
                className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Highlight Videos */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Highlight Videos</label>
          <div className="space-y-2">
            {highlightVideoUrls.map((url, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="flex-1 px-3 py-2 bg-gray-100 rounded-md text-sm truncate">{url}</span>
                <button
                  type="button"
                  onClick={() => removeHighlightVideo(index)}
                  className="text-red-600 hover:text-red-800"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
            <div className="flex gap-2">
              <input
                type="url"
                value={newVideoUrl}
                onChange={(e) => setNewVideoUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addHighlightVideo())}
                placeholder="Add video URL"
                className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
              />
              <button
                type="button"
                onClick={addHighlightVideo}
                className="px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <PlusIcon className="h-5 w-5" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* FAQs */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium text-gray-900">Default FAQs</h3>
          <button
            type="button"
            onClick={addFaq}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <PlusIcon className="h-4 w-4 mr-1" />
            Add FAQ
          </button>
        </div>
        
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div key={index} className="bg-gray-50 p-4 rounded-lg space-y-3">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-3">
                  <input
                    type="text"
                    value={faq.question}
                    onChange={(e) => updateFaq(index, 'question', e.target.value)}
                    placeholder="Question"
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                  <textarea
                    value={faq.answer}
                    onChange={(e) => updateFaq(index, 'answer', e.target.value)}
                    placeholder="Answer"
                    rows={2}
                    className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeFaq(index)}
                  className="text-red-600 hover:text-red-800"
                >
                  <TrashIcon className="h-5 w-5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Form Actions */}
      <div className="flex justify-end gap-3 pt-6 border-t">
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : category ? 'Update Category' : 'Create Category'}
        </Button>
      </div>
    </form>
  )
}