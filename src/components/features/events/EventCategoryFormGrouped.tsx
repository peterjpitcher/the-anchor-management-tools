'use client'

import { useState } from 'react'
import { EventCategory } from '@/types/event-categories'
import { KeywordStrategyCard } from './KeywordStrategyCard'
import { FaqEditor } from './FaqEditor'
import { parseKeywords, keywordsToDisplay } from '@/lib/keywords'
import { Accordion, Button, Checkbox, FormFooter, Icon, Input, Select, Switch, Textarea, toast } from '@/ds'
import { cn } from '@/lib/utils'
import { SquareImageUpload } from '@/components/features/shared/SquareImageUpload'
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/types/event-categories'

const MAX_NAME_LENGTH = 100
const MAX_DESCRIPTION_LENGTH = 500
const MAX_META_TITLE_LENGTH = 60
const MAX_META_DESCRIPTION_LENGTH = 160
const MAX_SHORT_DESCRIPTION_LENGTH = 150

const clamp = (value: string, maxLength: number): string => {
  if (maxLength <= 0) return value
  return value.length > maxLength ? value.slice(0, maxLength) : value
}

interface EventCategoryFormGroupedProps {
  category?: EventCategory | null
  onSubmit: (data: Partial<EventCategory>) => Promise<void>
  onCancel: () => void
}

/** The heading of one collapsible group of the form, shown in its DS Accordion header. */
function GroupTitle({ title, description }: { title: string; description?: string }): React.JSX.Element {
  return (
    <span className="block">
      <span className="block text-base font-medium text-text">{title}</span>
      {description && <span className="mt-1 block text-sm font-normal text-text-muted">{description}</span>}
    </span>
  )
}

/** A named group of picker buttons, labelled like a DS field. */
const PICKER_LEGEND = 'mb-1.5 text-xs font-medium uppercase tracking-wider text-text-muted'
/** A caption over a run of fields inside a group. */
const SUBGROUP_LABEL = 'text-xs font-semibold uppercase tracking-wider text-text-muted'

export function EventCategoryFormGrouped({ category, onSubmit, onCancel }: EventCategoryFormGroupedProps) {
  // Basic fields
  const [name, setName] = useState(() => clamp(category?.name ?? '', MAX_NAME_LENGTH))
  const [description, setDescription] = useState(() => clamp(category?.description ?? '', MAX_DESCRIPTION_LENGTH))
  const [color, setColor] = useState(category?.color ?? CATEGORY_COLORS[0].value)
  const [icon, setIcon] = useState(category?.icon ?? CATEGORY_ICONS[0].value)
  const [isActive, setIsActive] = useState(category?.is_active ?? true)
  const [sortOrder, setSortOrder] = useState(category?.sort_order?.toString() ?? '0')
  const [imageUrl, setImageUrl] = useState(category?.default_image_url ?? '')
  
  // Default event settings
  const [defaultStartTime, setDefaultStartTime] = useState(category?.default_start_time?.substring(0, 5) ?? '')
  const [defaultEndTime, setDefaultEndTime] = useState(category?.default_end_time?.substring(0, 5) ?? '')
  const [defaultPrice, setDefaultPrice] = useState(category?.default_price?.toString() ?? '0')
  const [defaultIsFree, setDefaultIsFree] = useState(category?.default_is_free ?? true)
  const [defaultCapacity, setDefaultCapacity] = useState(category?.default_capacity?.toString() ?? '')
  const [defaultBookingMode, setDefaultBookingMode] = useState(category?.default_booking_mode ?? 'table')
  const [defaultPaymentMode, setDefaultPaymentMode] = useState(category?.default_payment_mode ?? 'free')
  const [defaultPerformerName, setDefaultPerformerName] = useState(category?.default_performer_name ?? '')
  const [defaultPerformerType, setDefaultPerformerType] = useState(category?.default_performer_type ?? '')
  const [defaultReminderHours, setDefaultReminderHours] = useState(category?.default_reminder_hours?.toString() ?? '24')
  
  // SEO and content fields
  const [slug, setSlug] = useState(category?.slug ?? '')
  const [metaTitle, setMetaTitle] = useState(() => clamp(category?.meta_title ?? '', MAX_META_TITLE_LENGTH))
  const [metaDescription, setMetaDescription] = useState(() => clamp(category?.meta_description ?? '', MAX_META_DESCRIPTION_LENGTH))
  const [shortDescription, setShortDescription] = useState(() => clamp(category?.short_description ?? '', MAX_SHORT_DESCRIPTION_LENGTH))
  const [longDescription, setLongDescription] = useState(category?.long_description ?? '')
  const [highlights, setHighlights] = useState(category?.highlights?.join(', ') ?? '')
  const [keywords, setKeywords] = useState(category?.keywords?.join(', ') ?? '')
  
  // Additional timing fields
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(category?.default_duration_minutes?.toString() ?? '')
  const [defaultDoorsTime, setDefaultDoorsTime] = useState(category?.default_doors_time?.substring(0, 5) ?? '')
  const [defaultLastEntryTime, setDefaultLastEntryTime] = useState(category?.default_last_entry_time?.substring(0, 5) ?? '')
  const [defaultBookingUrl, setDefaultBookingUrl] = useState(category?.default_booking_url ?? '')
  const [defaultPromoSmsEnabled, setDefaultPromoSmsEnabled] = useState(category?.default_promo_sms_enabled ?? true)
  const [defaultBookingsEnabled, setDefaultBookingsEnabled] = useState(category?.default_bookings_enabled ?? true)


  // Keyword strategy fields
  const [primaryKeywords, setPrimaryKeywords] = useState(keywordsToDisplay((category as any)?.primary_keywords))
  const [secondaryKeywords, setSecondaryKeywords] = useState(keywordsToDisplay((category as any)?.secondary_keywords))
  const [localSeoKeywords, setLocalSeoKeywords] = useState(keywordsToDisplay((category as any)?.local_seo_keywords))
  const [imageAltText, setImageAltText] = useState((category as any)?.image_alt_text ?? '')
  const [cancellationPolicy, setCancellationPolicy] = useState((category as any)?.cancellation_policy ?? '')
  const [accessibilityNotes, setAccessibilityNotes] = useState((category as any)?.accessibility_notes ?? '')
  const [faqs, setFaqs] = useState<Array<{ question: string; answer: string; sort_order?: number }>>(category?.faqs ?? [])

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!name.trim()) {
      toast.error('Please enter a category name')
      return
    }

    const finalMetaTitle = metaTitle.trim().length > 0 ? clamp(metaTitle.trim(), MAX_META_TITLE_LENGTH) : undefined
    const finalMetaDescription = metaDescription.trim().length > 0 ? clamp(metaDescription.trim(), MAX_META_DESCRIPTION_LENGTH) : undefined
    const finalShortDescription = shortDescription.trim().length > 0 ? clamp(shortDescription.trim(), MAX_SHORT_DESCRIPTION_LENGTH) : undefined
    const finalDescription = description.trim().length > 0 ? clamp(description.trim(), MAX_DESCRIPTION_LENGTH) : undefined
    const finalName = clamp(name.trim(), MAX_NAME_LENGTH)

    setIsSubmitting(true)
    try {
      const categoryData: Partial<EventCategory> = {
        name: finalName,
        description: finalDescription,
        color,
        icon,
        is_active: isActive,
        sort_order: parseInt(sortOrder) || 0,
        default_image_url: imageUrl || null,
        thumbnail_image_url: imageUrl || null,
        poster_image_url: imageUrl || null,
        default_start_time: defaultStartTime || null,
        default_end_time: defaultEndTime || null,
        default_price: parseFloat(defaultPrice) || 0,
        default_is_free: defaultIsFree,
        default_capacity: defaultCapacity ? parseInt(defaultCapacity) : null,
        default_booking_mode: defaultBookingMode,
        default_payment_mode: defaultPaymentMode,
        default_performer_name: defaultPerformerName.trim() || undefined,
        default_performer_type: defaultPerformerType || undefined,
        default_reminder_hours: parseInt(defaultReminderHours) || 24,
        // SEO and content fields
        slug: slug.trim() || undefined,
        meta_title: finalMetaTitle,
        meta_description: finalMetaDescription,
        short_description: finalShortDescription,
        long_description: longDescription.trim() || undefined,
        highlights: highlights ? highlights.split(',').map(h => h.trim()).filter(h => h) : [],
        keywords: keywords ? keywords.split(',').map(k => k.trim()).filter(k => k) : [],
        // Additional timing fields
        default_duration_minutes: defaultDurationMinutes ? parseInt(defaultDurationMinutes) : null,
        default_doors_time: defaultDoorsTime.trim() || undefined,
        default_last_entry_time: defaultLastEntryTime || undefined,
        default_booking_url: defaultBookingUrl.trim() || undefined,
        default_promo_sms_enabled: defaultPromoSmsEnabled,
        default_bookings_enabled: defaultBookingsEnabled,
        // Keyword strategy fields
        primary_keywords: parseKeywords(primaryKeywords),
        secondary_keywords: parseKeywords(secondaryKeywords),
        local_seo_keywords: parseKeywords(localSeoKeywords),
        image_alt_text: imageAltText || null,
        cancellation_policy: cancellationPolicy || null,
        accessibility_notes: accessibilityNotes || null,
        faqs: faqs
          .filter(faq => faq.question.trim() && faq.answer.trim())
          .map((faq, index) => ({ ...faq, sort_order: index })),
      } as Partial<EventCategory>

      await onSubmit(categoryData)
    } catch (error) {
      console.error('Error submitting form:', error)
      toast.error('Failed to save category')
    } finally {
      setIsSubmitting(false)
    }
  }

  const previewIcon = CATEGORY_ICONS.find(i => i.value === icon)?.icon || CATEGORY_ICONS[0].icon

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Three collapsible groups. Basic information starts open, as before. */}
      <Accordion
        variant="bordered"
        multiple
        iconPosition="end"
        defaultActiveKeys={['basic']}
        contentClassName="py-6 sm:px-6"
        items={[
          {
            key: 'basic',
            icon: <Icon name="info" size={20} className="text-text-subtle" />,
            title: <GroupTitle title="Basic Information" description="Essential details about this event category" />,
            content: (
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          {/* Category Image */}
          <div className="col-span-full">
            <SquareImageUpload
              entityId={category?.id || 'new'}
              entityType="category"
              currentImageUrl={imageUrl}
              label="Default Event Image"
              helpText="Upload a default square image for events in this category (recommended: 1080x1080px)"
              onImageUploaded={(url) => setImageUrl(url)}
              onImageDeleted={() => setImageUrl('')}
            />
          </div>

          <div className="sm:col-span-4">
            <Input
              label="Category Name *"
              type="text"
              id="name"
              value={name}
              onChange={(e) => setName(clamp(e.target.value, MAX_NAME_LENGTH))}
              required
              maxLength={MAX_NAME_LENGTH}
              hint={`${name.length}/${MAX_NAME_LENGTH} characters`}
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Sort Order"
              type="number"
              id="sort_order"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              min="0"
            />
          </div>

          <div className="col-span-full">
            <Textarea
              label="Description"
              id="description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(clamp(e.target.value, MAX_DESCRIPTION_LENGTH))}
              maxLength={MAX_DESCRIPTION_LENGTH}
              hint={`${description.length}/${MAX_DESCRIPTION_LENGTH} characters`}
            />
          </div>

          {/* Appearance. Each picker is a named group and each option says whether it is the
              one chosen, which the ring and border alone only showed to sighted users. */}
          <fieldset className="min-w-0 sm:col-span-3">
            <legend className={PICKER_LEGEND}>Color</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((colorOption) => (
                // A raw button: a swatch filled with the saved colour, which a DS Button cannot
                // be. The chosen one gets a primary border with a gap before the colour
                // (padding plus a content-box fill), and focus the standard ring outside it.
                <button
                  key={colorOption.value}
                  type="button"
                  aria-pressed={color === colorOption.value}
                  onClick={() => setColor(colorOption.value)}
                  className={cn(
                    'h-8 w-8 rounded-full border-2 bg-clip-content p-0.5 focus-visible:outline-hidden focus-visible:shadow-ring',
                    color === colorOption.value ? 'border-primary' : 'border-transparent'
                  )}
                  style={{ backgroundColor: colorOption.value }}
                  title={colorOption.label}
                />
              ))}
            </div>
          </fieldset>

          <fieldset className="min-w-0 sm:col-span-3">
            <legend className={PICKER_LEGEND}>Icon</legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_ICONS.map((iconOption) => {
                return (
                  // A raw button: one cell of the icon picker, drawn in the chosen colour.
                  <button
                    key={iconOption.value}
                    type="button"
                    aria-pressed={icon === iconOption.value}
                    onClick={() => setIcon(iconOption.value)}
                    className={cn(
                      'p-2 rounded-default border-2 focus-visible:outline-hidden focus-visible:shadow-ring',
                      icon === iconOption.value
                        ? 'border-primary bg-primary-soft'
                        : 'border-border-strong hover:bg-surface-hover'
                    )}
                    title={iconOption.label}
                  >
                    <Icon name={iconOption.icon} size={20} style={{ color }} className="block" />
                  </button>
                )
              })}
            </div>
          </fieldset>

          <div className="sm:col-span-4">
            <Checkbox
              id="is_active"
              label="Active"
              description="This category will be available when creating events"
              checked={isActive}
              onChange={(checked) => setIsActive(checked)}
            />
          </div>

          {/* Preview */}
          <div className="col-span-full">
            <p className={cn(SUBGROUP_LABEL, 'mb-2')}>Preview</p>
            <div className="flex items-center space-x-3 p-4 bg-surface-2 rounded-default">
              <div 
                className="p-2 rounded-lg"
                style={{ backgroundColor: `${color}20` }}
              >
                <Icon name={previewIcon} size={24} style={{ color }} className="block" />
              </div>
              <div>
                <p className="font-medium text-text">{name || 'Category Name'}</p>
                <p className="text-sm text-text-muted">{description || 'Category description'}</p>
              </div>
            </div>
          </div>
        </div>
            ),
          },
          {
            key: 'defaults',
            icon: <Icon name="calendar" size={20} className="text-text-subtle" />,
            title: <GroupTitle title="Event Defaults" description="Default settings for events in this category" />,
            content: (
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          <div className="col-span-full">
            <p className={SUBGROUP_LABEL}>Time</p>
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Default Start Time"
              type="time"
              id="default_start_time"
              value={defaultStartTime}
              onChange={(e) => setDefaultStartTime(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Default End Time"
              type="time"
              id="default_end_time"
              value={defaultEndTime}
              onChange={(e) => setDefaultEndTime(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Duration (minutes)"
              type="number"
              id="default_duration_minutes"
              value={defaultDurationMinutes}
              onChange={(e) => setDefaultDurationMinutes(e.target.value)}
              min="1"
              max="1440"
              placeholder="e.g., 180"
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Doors Time"
              type="time"
              id="default_doors_time"
              value={defaultDoorsTime}
              onChange={(e) => setDefaultDoorsTime(e.target.value)}
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Last Entry Time"
              type="time"
              id="default_last_entry_time"
              value={defaultLastEntryTime}
              onChange={(e) => setDefaultLastEntryTime(e.target.value)}
            />
          </div>

          <div className="col-span-full">
            <p className={cn(SUBGROUP_LABEL, 'mt-6')}>Pricing & Booking</p>
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Default Price (£)"
              type="number"
              id="default_price"
              value={defaultPrice}
              onChange={(e) => {
                const nextPrice = parseFloat(e.target.value) || 0
                setDefaultPrice(e.target.value)
                setDefaultIsFree(nextPrice === 0)
                if (nextPrice === 0) setDefaultPaymentMode('free')
                if (nextPrice > 0 && defaultPaymentMode === 'free') setDefaultPaymentMode('cash_only')
              }}
              min="0"
              step="0.01"
            />
          </div>

          <div className="sm:col-span-2">
            <Input
              label="Default Capacity"
              type="number"
              id="default_capacity"
              value={defaultCapacity}
              onChange={(e) => setDefaultCapacity(e.target.value)}
              min="1"
              max="10000"
              placeholder="Unlimited"
            />
          </div>

          <div className="sm:col-span-2">
            <Select
              label="Seating / Booking"
              id="default_booking_mode"
              value={defaultBookingMode}
              onChange={(e) => setDefaultBookingMode(e.target.value as EventCategory['default_booking_mode'])}
            >
              <option value="table">Table booking</option>
              <option value="communal">Communal seating</option>
              <option value="general">Individual tickets</option>
              <option value="mixed">Mixed seating</option>
            </Select>
          </div>

          <div className="sm:col-span-2">
            <Select
              label="Payment"
              id="default_payment_mode"
              value={defaultPaymentMode}
              onChange={(e) => {
                const value = e.target.value as EventCategory['default_payment_mode']
                setDefaultPaymentMode(value)
                setDefaultIsFree(value === 'free')
              }}
            >
              <option value="free">Free</option>
              <option value="cash_only">Cash on arrival</option>
              <option value="prepaid">Prepaid ticket</option>
            </Select>
          </div>

          <div className="col-span-full">
            <Input
              label="Default Booking URL"
              type="url"
              id="default_booking_url"
              value={defaultBookingUrl}
              onChange={(e) => setDefaultBookingUrl(e.target.value)}
              placeholder="https://example.com/book"
            />
          </div>

          <div className="col-span-full flex items-center justify-between gap-4 pt-4 border-t border-border">
            <div>
              <p className="text-sm font-medium text-text">Default promotional SMS</p>
              <p className="text-xs text-text-muted">New events in this category will inherit this setting</p>
            </div>
            <Switch
              aria-label="Default promotional SMS"
              checked={defaultPromoSmsEnabled}
              onChange={setDefaultPromoSmsEnabled}
            />
          </div>

          <div className="col-span-full flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-text">Default accept bookings</p>
              <p className="text-xs text-text-muted">New events in this category will inherit this setting</p>
            </div>
            <Switch
              aria-label="Default accept bookings"
              checked={defaultBookingsEnabled}
              onChange={setDefaultBookingsEnabled}
            />
          </div>

          <div className="col-span-full">
            <p className={cn(SUBGROUP_LABEL, 'mt-6')}>Performers & Reminders</p>
          </div>

          <div className="sm:col-span-3">
            <Input
              label="Default Performer Name"
              type="text"
              id="default_performer_name"
              value={defaultPerformerName}
              onChange={(e) => setDefaultPerformerName(e.target.value)}
              placeholder="e.g., DJ John, The Blues Band"
            />
          </div>

          <div className="sm:col-span-3">
            <Select
              label="Default Performer Type"
              id="default_performer_type"
              value={defaultPerformerType}
              onChange={(e) => setDefaultPerformerType(e.target.value)}
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

          <div className="sm:col-span-2">
            <Input
              label="Reminder Hours Before"
              type="number"
              id="default_reminder_hours"
              value={defaultReminderHours}
              onChange={(e) => setDefaultReminderHours(e.target.value)}
              min="1"
              max="168"
            />
          </div>
        </div>
            ),
          },
          {
            key: 'seo',
            icon: <Icon name="megaphone" size={20} className="text-text-subtle" />,
            title: <GroupTitle title="SEO & Content" description="Search engine optimization and content details" />,
            content: (
        <div className="grid grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
          <div className="sm:col-span-3">
            <Input
              label="URL Slug"
              type="text"
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="quiz-night"
            />
          </div>

          <div className="sm:col-span-3">
            <Input
              label="Meta Title"
              type="text"
              id="meta_title"
              value={metaTitle}
              onChange={(e) => setMetaTitle(clamp(e.target.value, MAX_META_TITLE_LENGTH))}
              maxLength={MAX_META_TITLE_LENGTH}
              placeholder="SEO page title"
              hint={`${metaTitle.length}/${MAX_META_TITLE_LENGTH} characters`}
            />
          </div>

          <div className="col-span-full">
            <Textarea
              label="Meta Description"
              id="meta_description"
              rows={2}
              value={metaDescription}
              onChange={(e) => setMetaDescription(clamp(e.target.value, MAX_META_DESCRIPTION_LENGTH))}
              maxLength={MAX_META_DESCRIPTION_LENGTH}
              placeholder="SEO page description"
              hint={`${metaDescription.length}/${MAX_META_DESCRIPTION_LENGTH} characters`}
            />
          </div>

          <div className="col-span-full">
            <Textarea
              label="Short Description"
              id="short_description"
              rows={2}
              value={shortDescription}
              onChange={(e) => setShortDescription(clamp(e.target.value, MAX_SHORT_DESCRIPTION_LENGTH))}
              maxLength={MAX_SHORT_DESCRIPTION_LENGTH}
              placeholder="Brief description for listings"
              hint={`${shortDescription.length}/${MAX_SHORT_DESCRIPTION_LENGTH} characters`}
            />
          </div>

          <div className="col-span-full">
            <Textarea
              label="Long Description"
              id="long_description"
              rows={6}
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              placeholder="Detailed description for the category page"
            />
          </div>

          <div className="col-span-full">
            <Input
              label="Highlights"
              type="text"
              id="highlights"
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              placeholder="Great prizes, Fun atmosphere, Weekly event"
              hint="Separate multiple highlights with commas"
            />
          </div>

          <div className="col-span-full">
            <Input
              label="Keywords"
              type="text"
              id="keywords"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="quiz, trivia, pub quiz, entertainment"
              hint="Separate keywords with commas for better SEO"
            />
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

          {/* Image Alt Text Default */}
          <div className="col-span-full">
            <Input
              label="Image Alt Text Default"
              type="text"
              id="image_alt_text"
              value={imageAltText}
              onChange={(e) => setImageAltText(e.target.value)}
              placeholder="e.g., Live music at The Anchor pub"
              hint="Default alt text for event images in this category"
            />
          </div>

          {/* Cancellation Policy Default */}
          <div className="col-span-full">
            <Textarea
              label="Cancellation Policy Default"
              id="cancellation_policy"
              rows={3}
              value={cancellationPolicy}
              onChange={(e) => setCancellationPolicy(e.target.value)}
              placeholder="e.g., Tickets are non-refundable but may be transferred to another person."
              hint="Default cancellation policy shown on event pages"
            />
          </div>

          {/* Accessibility Notes Default */}
          <div className="col-span-full">
            <Textarea
              label="Accessibility Notes Default"
              id="accessibility_notes"
              rows={3}
              value={accessibilityNotes}
              onChange={(e) => setAccessibilityNotes(e.target.value)}
              placeholder="e.g., Venue is wheelchair accessible. Hearing loop available."
              hint="Default accessibility information for events in this category"
            />
          </div>

          <div className="col-span-full">
            <FaqEditor faqs={faqs} onChange={setFaqs} onModified={() => undefined} />
          </div>
        </div>
            ),
          },
        ]}
      />

      <FormFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={isSubmitting}>
          {category ? 'Update Category' : 'Create Category'}
        </Button>
      </FormFooter>
    </form>
  )
}
