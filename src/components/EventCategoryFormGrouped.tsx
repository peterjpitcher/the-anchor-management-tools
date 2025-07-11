'use client'

import { useState } from 'react'
import { EventCategory } from '@/types/event-categories'
import { Button } from '@/components/ui/Button'
import { SquareImageUpload } from './SquareImageUpload'
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/types/event-categories'
import toast from 'react-hot-toast'
import { 
  ChevronDownIcon, 
  ChevronUpIcon,
  InformationCircleIcon,
  CalendarIcon,
  MegaphoneIcon,
  PhotoIcon,
  CogIcon
} from '@heroicons/react/24/outline'

interface EventCategoryFormGroupedProps {
  category?: EventCategory | null
  onSubmit: (data: Partial<EventCategory>) => Promise<void>
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

export function EventCategoryFormGrouped({ category, onSubmit, onCancel }: EventCategoryFormGroupedProps) {
  // Basic fields
  const [name, setName] = useState(category?.name ?? '')
  const [description, setDescription] = useState(category?.description ?? '')
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0].value)
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICONS[0].value)
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [sortOrder, setSortOrder] = useState(category?.sort_order?.toString() ?? '0')
  const [imageUrl, setImageUrl] = useState(category?.default_image_url ?? '')
  
  // Default event settings
  const [defaultStartTime, setDefaultStartTime] = useState(category?.default_start_time?.substring(0, 5) ?? '')
  const [defaultEndTime, setDefaultEndTime] = useState(category?.default_end_time?.substring(0, 5) ?? '')
  const [defaultCapacity, setDefaultCapacity] = useState(category?.default_capacity?.toString() ?? '')
  const [defaultPrice, setDefaultPrice] = useState(category?.default_price?.toString() ?? '0')
  const [defaultIsFree, setDefaultIsFree] = useState(category?.default_is_free ?? true)
  const [defaultPerformerName, setDefaultPerformerName] = useState(category?.default_performer_name ?? '')
  const [defaultPerformerType, setDefaultPerformerType] = useState(category?.default_performer_type ?? '')
  const [defaultReminderHours, setDefaultReminderHours] = useState(category?.default_reminder_hours?.toString() ?? '24')
  
  // SEO and content fields
  const [slug, setSlug] = useState(category?.slug ?? '')
  const [metaTitle, setMetaTitle] = useState(category?.meta_title ?? '')
  const [metaDescription, setMetaDescription] = useState(category?.meta_description ?? '')
  const [shortDescription, setShortDescription] = useState(category?.short_description ?? '')
  const [longDescription, setLongDescription] = useState(category?.long_description ?? '')
  const [highlights, setHighlights] = useState(category?.highlights?.join(', ') ?? '')
  const [keywords, setKeywords] = useState(category?.keywords?.join(', ') ?? '')
  
  // Additional timing fields
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(category?.default_duration_minutes?.toString() ?? '')
  const [defaultDoorsTime, setDefaultDoorsTime] = useState(category?.default_doors_time ?? '')
  const [defaultLastEntryTime, setDefaultLastEntryTime] = useState(category?.default_last_entry_time?.substring(0, 5) ?? '')
  const [defaultBookingUrl, setDefaultBookingUrl] = useState(category?.default_booking_url ?? '')
  
  // Media fields
  const [galleryImageUrls, setGalleryImageUrls] = useState(category?.gallery_image_urls?.join(', ') ?? '')
  const [posterImageUrl, setPosterImageUrl] = useState(category?.poster_image_url ?? '')
  const [thumbnailImageUrl, setThumbnailImageUrl] = useState(category?.thumbnail_image_url ?? '')
  const [promoVideoUrl, setPromoVideoUrl] = useState(category?.promo_video_url ?? '')
  const [highlightVideoUrls, setHighlightVideoUrls] = useState(category?.highlight_video_urls?.join(', ') ?? '')
  
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      toast.error('Please enter a category name')
      return
    }

    setIsSubmitting(true)
    try {
      const categoryData: Partial<EventCategory> = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon,
        is_active: isActive,
        sort_order: parseInt(sortOrder) || 0,
        default_image_url: imageUrl || null,
        thumbnail_image_url: thumbnailImageUrl || imageUrl || null,
        poster_image_url: posterImageUrl || imageUrl || null,
        default_start_time: defaultStartTime || null,
        default_end_time: defaultEndTime || null,
        default_capacity: defaultCapacity ? parseInt(defaultCapacity) : null,
        default_price: parseFloat(defaultPrice) || 0,
        default_is_free: defaultIsFree,
        default_performer_name: defaultPerformerName.trim() || undefined,
        default_performer_type: defaultPerformerType || undefined,
        default_reminder_hours: parseInt(defaultReminderHours) || 24,
        // SEO and content fields
        slug: slug.trim() || undefined,
        meta_title: metaTitle.trim() || undefined,
        meta_description: metaDescription.trim() || undefined,
        short_description: shortDescription.trim() || undefined,
        long_description: longDescription.trim() || undefined,
        highlights: highlights ? highlights.split(',').map(h => h.trim()).filter(h => h) : [],
        keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(k => k) : [],
        // Media fields
        gallery_image_urls: galleryImageUrls ? galleryImageUrls.split(',').map(url => url.trim()).filter(url => url) : [],
        promo_video_url: promoVideoUrl.trim() || undefined,
        highlight_video_urls: highlightVideoUrls ? highlightVideoUrls.split(',').map(url => url.trim()).filter(url => url) : [],
        // Additional timing fields
        default_duration_minutes: defaultDurationMinutes ? parseInt(defaultDurationMinutes) : null,
        default_doors_time: defaultDoorsTime.trim() || undefined,
        default_last_entry_time: defaultLastEntryTime || undefined,
        default_booking_url: defaultBookingUrl.trim() || undefined,
      }

      await onSubmit(categoryData)
    } catch (error) {
      console.error('Error submitting form:', error)
      toast.error('Failed to save category')
    } finally {
      setIsSubmitting(false)
    }
  }

  const IconComponent = CATEGORY_ICONS.find(i => i.value === icon)?.icon || CATEGORY_ICONS[0].icon

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic Information Section */}
      <CollapsibleSection 
        title="Basic Information" 
        description="Essential details about this event category"
        icon={InformationCircleIcon}
        defaultOpen={true}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          {/* Category Image */}
          <div className="col-span-full">
            <SquareImageUpload
              entityId={category?.id || 'new'}
              entityType="category"
              currentImageUrl={imageUrl}
              label="Category Image"
              helpText="Upload a square image for this category (recommended: 1080x1080px)"
              onImageUploaded={(url) => setImageUrl(url)}
              onImageDeleted={() => setImageUrl('')}
            />
          </div>

          <div className="sm:col-span-4">
            <label htmlFor="name" className="block text-sm font-medium leading-6 text-gray-900">
              Category Name *
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
            <label htmlFor="sort_order" className="block text-sm font-medium leading-6 text-gray-900">
              Sort Order
            </label>
            <div className="mt-2">
              <input
                type="number"
                id="sort_order"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
                min="0"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
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
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          {/* Appearance */}
          <div className="sm:col-span-3">
            <label className="block text-sm font-medium leading-6 text-gray-900">
              Color
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((colorOption) => (
                <button
                  key={colorOption.value}
                  type="button"
                  onClick={() => setColor(colorOption.value)}
                  className={`w-8 h-8 rounded-full ring-2 ring-offset-2 ${
                    color === colorOption.value ? 'ring-gray-900' : 'ring-transparent'
                  }`}
                  style={{ backgroundColor: colorOption.value }}
                  title={colorOption.label}
                />
              ))}
            </div>
          </div>

          <div className="sm:col-span-3">
            <label className="block text-sm font-medium leading-6 text-gray-900">
              Icon
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORY_ICONS.map((iconOption) => {
                const Icon = iconOption.icon
                return (
                  <button
                    key={iconOption.value}
                    type="button"
                    onClick={() => setIcon(iconOption.value)}
                    className={`p-2 rounded-md border-2 ${
                      icon === iconOption.value 
                        ? 'border-indigo-600 bg-indigo-50' 
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                    title={iconOption.label}
                  >
                    <Icon className="h-5 w-5" style={{ color }} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className="sm:col-span-4">
            <div className="relative flex items-start">
              <div className="flex h-6 items-center">
                <input
                  id="is_active"
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
                />
              </div>
              <div className="ml-3 text-sm leading-6">
                <label htmlFor="is_active" className="font-medium text-gray-900">
                  Active
                </label>
                <p className="text-gray-500">This category will be available when creating events</p>
              </div>
            </div>
          </div>

          {/* Preview */}
          <div className="col-span-full">
            <h4 className="text-sm font-medium text-gray-900 mb-2">Preview</h4>
            <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-lg">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: `${color}20` }}
              >
                <IconComponent className="h-6 w-6" style={{ color }} />
              </div>
              <div>
                <p className="font-medium text-gray-900">{name || 'Category Name'}</p>
                <p className="text-sm text-gray-500">{description || 'Category description'}</p>
              </div>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Event Defaults Section */}
      <CollapsibleSection 
        title="Event Defaults" 
        description="Default settings for events in this category"
        icon={CalendarIcon}
        defaultOpen={false}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          <div className="col-span-full">
            <h4 className="text-sm font-medium text-gray-900 mb-4">Time & Capacity</h4>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_start_time" className="block text-sm font-medium leading-6 text-gray-900">
              Default Start Time
            </label>
            <div className="mt-2">
              <input
                type="time"
                id="default_start_time"
                value={defaultStartTime}
                onChange={(e) => setDefaultStartTime(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_end_time" className="block text-sm font-medium leading-6 text-gray-900">
              Default End Time
            </label>
            <div className="mt-2">
              <input
                type="time"
                id="default_end_time"
                value={defaultEndTime}
                onChange={(e) => setDefaultEndTime(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_capacity" className="block text-sm font-medium leading-6 text-gray-900">
              Default Capacity
            </label>
            <div className="mt-2">
              <input
                type="number"
                id="default_capacity"
                value={defaultCapacity}
                onChange={(e) => setDefaultCapacity(e.target.value)}
                min="1"
                placeholder="Unlimited"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_duration_minutes" className="block text-sm font-medium leading-6 text-gray-900">
              Duration (minutes)
            </label>
            <div className="mt-2">
              <input
                type="number"
                id="default_duration_minutes"
                value={defaultDurationMinutes}
                onChange={(e) => setDefaultDurationMinutes(e.target.value)}
                min="1"
                max="1440"
                placeholder="e.g., 180"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_doors_time" className="block text-sm font-medium leading-6 text-gray-900">
              Doors Time
            </label>
            <div className="mt-2">
              <input
                type="text"
                id="default_doors_time"
                value={defaultDoorsTime}
                onChange={(e) => setDefaultDoorsTime(e.target.value)}
                placeholder="e.g., 30 mins before"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_last_entry_time" className="block text-sm font-medium leading-6 text-gray-900">
              Last Entry Time
            </label>
            <div className="mt-2">
              <input
                type="time"
                id="default_last_entry_time"
                value={defaultLastEntryTime}
                onChange={(e) => setDefaultLastEntryTime(e.target.value)}
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="col-span-full">
            <h4 className="text-sm font-medium text-gray-900 mb-4 mt-6">Pricing & Booking</h4>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="default_price" className="block text-sm font-medium leading-6 text-gray-900">
              Default Price (£)
            </label>
            <div className="mt-2">
              <input
                type="number"
                id="default_price"
                value={defaultPrice}
                onChange={(e) => {
                  setDefaultPrice(e.target.value)
                  setDefaultIsFree(parseFloat(e.target.value) === 0)
                }}
                min="0"
                step="0.01"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-4">
            <label htmlFor="default_booking_url" className="block text-sm font-medium leading-6 text-gray-900">
              Default Booking URL
            </label>
            <div className="mt-2">
              <input
                type="url"
                id="default_booking_url"
                value={defaultBookingUrl}
                onChange={(e) => setDefaultBookingUrl(e.target.value)}
                placeholder="https://example.com/book"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="col-span-full">
            <h4 className="text-sm font-medium text-gray-900 mb-4 mt-6">Performers & Reminders</h4>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="default_performer_name" className="block text-sm font-medium leading-6 text-gray-900">
              Default Performer Name
            </label>
            <div className="mt-2">
              <input
                type="text"
                id="default_performer_name"
                value={defaultPerformerName}
                onChange={(e) => setDefaultPerformerName(e.target.value)}
                placeholder="e.g., DJ John, The Blues Band"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
            </div>
          </div>

          <div className="sm:col-span-3">
            <label htmlFor="default_performer_type" className="block text-sm font-medium leading-6 text-gray-900">
              Default Performer Type
            </label>
            <div className="mt-2">
              <select
                id="default_performer_type"
                value={defaultPerformerType}
                onChange={(e) => setDefaultPerformerType(e.target.value)}
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

          <div className="sm:col-span-2">
            <label htmlFor="default_reminder_hours" className="block text-sm font-medium leading-6 text-gray-900">
              Reminder Hours Before
            </label>
            <div className="mt-2">
              <input
                type="number"
                id="default_reminder_hours"
                value={defaultReminderHours}
                onChange={(e) => setDefaultReminderHours(e.target.value)}
                min="1"
                max="168"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
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
                placeholder="quiz-night"
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
                maxLength={150}
                placeholder="Brief description for listings"
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900 shadow-sm focus:border-green-500 focus:ring-green-500 sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">{shortDescription.length}/150 characters</p>
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
                placeholder="Detailed description for the category page"
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
                placeholder="Great prizes, Fun atmosphere, Weekly event"
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
                placeholder="quiz, trivia, pub quiz, entertainment"
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
        description="Additional images and videos for this category"
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
          {isSubmitting ? 'Saving...' : category ? 'Update Category' : 'Create Category'}
        </Button>
      </div>
    </form>
  )
}