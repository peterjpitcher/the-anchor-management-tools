'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  Drawer, Button, Input, Select, Textarea, DateTimePicker,
  Checkbox, Spinner, toast, Toggle,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { createEvent, updateEvent } from '@/app/actions/events'
import { getEventChecklist, toggleEventChecklistTask } from '@/app/actions/event-checklist'
import { generateEventSeoContent } from '@/app/actions/event-content'
import { parseKeywords, keywordsToDisplay, buildKeywordsUnion } from '@/lib/keywords'
import { KeywordStrategyCard } from '@/components/features/events/KeywordStrategyCard'
import { FaqEditor } from '@/components/features/events/FaqEditor'
import { SquareImageUpload } from '@/components/features/shared/SquareImageUpload'
import type { Event } from '@/types/database'
import type { EventCategory } from '@/types/event-categories'
import type { EventChecklistItem } from '@/lib/event-checklist'

interface EventDrawerProps {
  open: boolean
  onClose: () => void
  event?: Event | null
  categories: EventCategory[]
  onSave: () => void
}

const STATUS_OPTIONS = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'postponed', label: 'Postponed' },
  { value: 'rescheduled', label: 'Rescheduled' },
  { value: 'sold_out', label: 'Sold Out' },
  { value: 'draft', label: 'Draft' },
]

const PAYMENT_MODE_OPTIONS = [
  { value: 'free', label: 'Free' },
  { value: 'cash_only', label: 'Cash on arrival' },
  { value: 'prepaid', label: 'Prepaid (online payment)' },
]

const BOOKING_MODE_OPTIONS = [
  { value: 'table', label: 'Table bookings' },
  { value: 'general', label: 'General entry only' },
  { value: 'mixed', label: 'Mixed (table + general)' },
]

const PERFORMER_TYPE_OPTIONS = [
  { value: '', label: 'Select type...' },
  { value: 'MusicGroup', label: 'Music Group / Band' },
  { value: 'Person', label: 'Solo Performer' },
  { value: 'TheaterGroup', label: 'Theatre Group' },
  { value: 'DanceGroup', label: 'Dance Group' },
  { value: 'ComedyGroup', label: 'Comedy Group' },
  { value: 'Organization', label: 'Organisation' },
]

export function EventDrawer({ open, onClose, event, categories, onSave }: EventDrawerProps) {
  const isEdit = !!event
  const [isPending, startTransition] = useTransition()

  // ── Basic info ──
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('scheduled')
  const [capacity, setCapacity] = useState('')
  const [brief, setBrief] = useState('')

  // ── Time & schedule ──
  const [doorsTime, setDoorsTime] = useState('')
  const [lastEntryTime, setLastEntryTime] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')

  // ── Performer ──
  const [performerName, setPerformerName] = useState('')
  const [performerType, setPerformerType] = useState('')

  // ── Pricing & booking ──
  const [price, setPrice] = useState('')
  const [isFree, setIsFree] = useState(true)
  const [paymentMode, setPaymentMode] = useState('free')
  const [bookingMode, setBookingMode] = useState('table')
  const [bookingUrl, setBookingUrl] = useState('')
  const [bookingsEnabled, setBookingsEnabled] = useState(true)
  const [promoSmsEnabled, setPromoSmsEnabled] = useState(true)

  // ── Image ──
  const [heroImageUrl, setHeroImageUrl] = useState('')

  // ── SEO & content ──
  const [slug, setSlug] = useState('')
  const [metaTitle, setMetaTitle] = useState('')
  const [metaDescription, setMetaDescription] = useState('')
  const [shortDescription, setShortDescription] = useState('')
  const [longDescription, setLongDescription] = useState('')
  const [highlights, setHighlights] = useState('')
  const [imageAltText, setImageAltText] = useState('')
  const [cancellationPolicy, setCancellationPolicy] = useState('')
  const [accessibilityNotes, setAccessibilityNotes] = useState('')

  // ── Keywords ──
  const [primaryKeywords, setPrimaryKeywords] = useState('')
  const [secondaryKeywords, setSecondaryKeywords] = useState('')
  const [localSeoKeywords, setLocalSeoKeywords] = useState('')

  // ── FAQs ──
  const [faqs, setFaqs] = useState<{ question: string; answer: string; sort_order?: number }[]>([])
  const [faqsModified, setFaqsModified] = useState(false)

  // ── Checklist ──
  const [checklistItems, setChecklistItems] = useState<EventChecklistItem[]>([])
  const [checklistLoading, setChecklistLoading] = useState(false)

  // ── AI content ──
  const [aiLoading, setAiLoading] = useState(false)

  // Initialize form when event changes
  useEffect(() => {
    if (event) {
      setName(event.name || '')
      setDate(event.date || '')
      setTime(event.time || '')
      setEndTime(event.end_time || '')
      setCategoryId(event.category_id || '')
      setStatus(event.event_status || 'scheduled')
      setCapacity(event.capacity?.toString() || '')
      setBrief(event.brief || '')
      setDoorsTime(event.doors_time || '')
      setLastEntryTime(event.last_entry_time || '')
      setDurationMinutes(event.duration_minutes?.toString() || '')
      setPerformerName(event.performer_name || '')
      setPerformerType(event.performer_type || '')
      setPrice(event.price?.toString() || '0')
      setIsFree(event.is_free ?? true)
      setPaymentMode(event.payment_mode || 'free')
      setBookingMode(event.booking_mode || 'table')
      setBookingUrl(event.booking_url || '')
      setBookingsEnabled(event.bookings_enabled ?? true)
      setPromoSmsEnabled(event.promo_sms_enabled ?? true)
      setHeroImageUrl(event.hero_image_url || '')
      setSlug(event.slug || '')
      setMetaTitle(event.meta_title || '')
      setMetaDescription(event.meta_description || '')
      setShortDescription(event.short_description || '')
      setLongDescription(event.long_description || '')
      setHighlights(event.highlights?.join(', ') || '')
      setImageAltText((event as any).image_alt_text ?? '')
      setCancellationPolicy((event as any).cancellation_policy ?? '')
      setAccessibilityNotes((event as any).accessibility_notes ?? '')
      setPrimaryKeywords(keywordsToDisplay((event as any).primary_keywords))
      setSecondaryKeywords(keywordsToDisplay((event as any).secondary_keywords))
      setLocalSeoKeywords(keywordsToDisplay((event as any).local_seo_keywords))
      const eventFaqs = (event as any).event_faqs as Array<{ question: string; answer: string; sort_order?: number }> | undefined
      setFaqs(eventFaqs?.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)) ?? [])
      setFaqsModified(false)
    } else {
      setName('')
      setDate('')
      setTime('')
      setEndTime('')
      setCategoryId('')
      setStatus('scheduled')
      setCapacity('')
      setBrief('')
      setDoorsTime('')
      setLastEntryTime('')
      setDurationMinutes('')
      setPerformerName('')
      setPerformerType('')
      setPrice('')
      setIsFree(true)
      setPaymentMode('free')
      setBookingMode('table')
      setBookingUrl('')
      setBookingsEnabled(true)
      setPromoSmsEnabled(true)
      setHeroImageUrl('')
      setSlug('')
      setMetaTitle('')
      setMetaDescription('')
      setShortDescription('')
      setLongDescription('')
      setHighlights('')
      setImageAltText('')
      setCancellationPolicy('')
      setAccessibilityNotes('')
      setPrimaryKeywords('')
      setSecondaryKeywords('')
      setLocalSeoKeywords('')
      setFaqs([])
      setFaqsModified(false)
    }
  }, [event])

  // Auto-calculate duration when start/end time changes
  useEffect(() => {
    if (time && endTime) {
      const [startH, startM] = time.split(':').map(Number)
      const [endH, endM] = endTime.split(':').map(Number)
      const startTotal = startH * 60 + startM
      let endTotal = endH * 60 + endM
      if (endTotal < startTotal) endTotal += 24 * 60
      setDurationMinutes((endTotal - startTotal).toString())
    }
  }, [time, endTime])

  // Load checklist for existing events
  useEffect(() => {
    if (event?.id && open) {
      setChecklistLoading(true)
      getEventChecklist(event.id).then((result) => {
        if (result.success && result.items) {
          setChecklistItems(result.items)
        }
        setChecklistLoading(false)
      })
    } else {
      setChecklistItems([])
    }
  }, [event?.id, open])

  const categoryOptions = [
    { value: '', label: 'Select category' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

  function handleCategoryChange(selectedCategoryId: string) {
    setCategoryId(selectedCategoryId)
    const cat = categories.find(c => c.id === selectedCategoryId)
    if (!cat) return

    if (!name && cat.name) setName(cat.name)
    if (!time && cat.default_start_time) setTime(cat.default_start_time)
    if (!endTime && cat.default_end_time) setEndTime(cat.default_end_time)
    if (cat.default_price !== null && cat.default_price !== undefined) {
      setPrice(cat.default_price.toString())
      setIsFree(cat.default_is_free)
    }
    if (!performerName && cat.default_performer_name) setPerformerName(cat.default_performer_name)
    if (!performerType && cat.default_performer_type) setPerformerType(cat.default_performer_type)
    if (!heroImageUrl && cat.default_image_url) setHeroImageUrl(cat.default_image_url)
    if (!shortDescription && cat.short_description) setShortDescription(cat.short_description)
    if (!longDescription && cat.long_description) setLongDescription(cat.long_description)
    if (!highlights && cat.highlights) setHighlights(cat.highlights.join(', '))
    if (!metaTitle && cat.meta_title) setMetaTitle(cat.meta_title)
    if (!metaDescription && cat.meta_description) setMetaDescription(cat.meta_description)
    const catAny = cat as any
    if (!primaryKeywords && catAny.primary_keywords?.length) setPrimaryKeywords(keywordsToDisplay(catAny.primary_keywords))
    if (!secondaryKeywords && catAny.secondary_keywords?.length) setSecondaryKeywords(keywordsToDisplay(catAny.secondary_keywords))
    if (!localSeoKeywords && catAny.local_seo_keywords?.length) setLocalSeoKeywords(keywordsToDisplay(catAny.local_seo_keywords))
    if (!cancellationPolicy && catAny.cancellation_policy) setCancellationPolicy(catAny.cancellation_policy)
    if (!accessibilityNotes && catAny.accessibility_notes) setAccessibilityNotes(catAny.accessibility_notes)
    if (!imageAltText && catAny.image_alt_text) setImageAltText(catAny.image_alt_text)
    if (!durationMinutes && cat.default_duration_minutes) setDurationMinutes(cat.default_duration_minutes.toString())
    if (!doorsTime && cat.default_doors_time) setDoorsTime(cat.default_doors_time)
    if (!lastEntryTime && cat.default_last_entry_time) setLastEntryTime(cat.default_last_entry_time)
    if (!bookingUrl && cat.default_booking_url) setBookingUrl(cat.default_booking_url)
    if (!event) {
      if (cat.default_promo_sms_enabled !== undefined) setPromoSmsEnabled(cat.default_promo_sms_enabled)
      if (cat.default_bookings_enabled !== undefined) setBookingsEnabled(cat.default_bookings_enabled)
    }
    if (!slug && cat.name && date) {
      setSlug(cat.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date)
    }
  }

  function handleSave() {
    if (!name.trim()) {
      toast.error('Event name is required')
      return
    }
    if (!date) {
      toast.error('Event date is required')
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('name', name)
      formData.set('date', date)
      formData.set('time', time)
      if (endTime) formData.set('end_time', endTime)
      if (categoryId) formData.set('category_id', categoryId)
      formData.set('event_status', status)
      if (capacity) formData.set('capacity', capacity)
      formData.set('booking_mode', bookingMode)

      // Performer
      if (performerName.trim()) formData.set('performer_name', performerName.trim())
      if (performerType) formData.set('performer_type', performerType)

      // Pricing & booking
      formData.set('price', price || '0')
      formData.set('is_free', String(isFree))
      formData.set('payment_mode', paymentMode)
      if (bookingUrl.trim()) formData.set('booking_url', bookingUrl.trim())
      formData.set('bookings_enabled', String(bookingsEnabled))
      formData.set('promo_sms_enabled', String(promoSmsEnabled))

      // Time & schedule
      if (doorsTime) formData.set('doors_time', doorsTime)
      if (lastEntryTime) formData.set('last_entry_time', lastEntryTime)
      if (durationMinutes) formData.set('duration_minutes', durationMinutes)

      // Image
      if (heroImageUrl) {
        formData.set('hero_image_url', heroImageUrl)
        formData.set('thumbnail_image_url', heroImageUrl)
        formData.set('poster_image_url', heroImageUrl)
      }

      // Brief & description
      if (brief.trim()) formData.set('brief', brief.trim())
      if (shortDescription.trim()) formData.set('short_description', shortDescription.trim())
      if (longDescription.trim()) formData.set('long_description', longDescription.trim())
      if (highlights) formData.set('highlights', JSON.stringify(highlights.split(',').map(h => h.trim()).filter(Boolean)))

      // SEO
      if (slug.trim()) formData.set('slug', slug.trim())
      if (metaTitle.trim()) formData.set('meta_title', metaTitle.trim())
      if (metaDescription.trim()) formData.set('meta_description', metaDescription.trim())
      if (imageAltText.trim()) formData.set('image_alt_text', imageAltText.trim())
      if (cancellationPolicy.trim()) formData.set('cancellation_policy', cancellationPolicy.trim())
      if (accessibilityNotes.trim()) formData.set('accessibility_notes', accessibilityNotes.trim())

      // Keywords
      const pk = parseKeywords(primaryKeywords)
      const sk = parseKeywords(secondaryKeywords)
      const lk = parseKeywords(localSeoKeywords)
      formData.set('primary_keywords', JSON.stringify(pk))
      formData.set('secondary_keywords', JSON.stringify(sk))
      formData.set('local_seo_keywords', JSON.stringify(lk))
      formData.set('keywords', JSON.stringify(buildKeywordsUnion(pk, sk, lk)))

      // FAQs
      if (faqsModified) {
        formData.set('faqs', JSON.stringify(faqs.filter(f => f.question && f.answer)))
      }

      const result = isEdit
        ? await updateEvent(event.id, formData)
        : await createEvent(formData)

      if ('error' in result && result.error) {
        toast.error(result.error)
      } else {
        toast.success(isEdit ? 'Event updated' : 'Event created')
        onSave()
      }
    })
  }

  async function handleToggleChecklist(taskKey: string, completed: boolean) {
    if (!event?.id) return
    const result = await toggleEventChecklistTask(event.id, taskKey, !completed)
    if (result.success) {
      setChecklistItems((prev) =>
        prev.map((item) =>
          item.key === taskKey ? { ...item, completed: !completed } : item
        )
      )
    }
  }

  async function handleGenerateSeo() {
    if (!name.trim()) {
      toast.error('Enter an event name first')
      return
    }
    setAiLoading(true)

    if (!slug && name && date) {
      setSlug(name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + date)
    }

    const selectedCategory = categoryId ? categories.find(c => c.id === categoryId) : undefined
    const result = await generateEventSeoContent({
      eventId: event?.id ?? null,
      name: name.trim(),
      date: date || null,
      time: time || null,
      categoryName: selectedCategory?.name ?? null,
      capacity: capacity ? parseInt(capacity) : null,
      brief: brief.trim() || null,
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
      existingKeywords: [],
      primaryKeywords: parseKeywords(primaryKeywords),
      secondaryKeywords: parseKeywords(secondaryKeywords),
      localSeoKeywords: parseKeywords(localSeoKeywords),
    })

    setAiLoading(false)
    if (!result.success) {
      toast.error(result.error ?? 'Failed to generate SEO content')
      return
    }

    const d = result.data
    if (d.metaTitle) setMetaTitle(d.metaTitle)
    if (d.metaDescription) setMetaDescription(d.metaDescription)
    if (d.shortDescription) setShortDescription(d.shortDescription)
    if (d.longDescription) setLongDescription(d.longDescription)
    if (d.highlights) setHighlights(d.highlights.join(', '))
    if (d.slug) setSlug(d.slug)
    if (d.imageAltText) setImageAltText(d.imageAltText)
    if (d.faqs?.length) {
      setFaqs(d.faqs.map((faq: { question: string; answer: string }, i: number) => ({ ...faq, sort_order: i })))
      setFaqsModified(true)
    }
    if (d.cancellationPolicy) setCancellationPolicy(d.cancellationPolicy)
    if (d.accessibilityNotes) setAccessibilityNotes(d.accessibilityNotes)
    toast.success('SEO content drafted')
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Event' : 'New Event'}
      width="640px"
    >
      <div className="flex flex-col gap-6">

        {/* ── Basic Info ── */}
        <Section title="Basic Info">
          <div className="flex flex-col gap-3">
            <Input
              label="Event Name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter event name"
            />
            <Select
              label="Category"
              options={categoryOptions}
              value={categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <DateTimePicker
                type="date"
                value={date}
                onChange={setDate}
                aria-label="Event date"
              />
              <Select
                label="Status"
                options={STATUS_OPTIONS}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            </div>
            <Input
              label="Capacity"
              type="number"
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
              placeholder="Unlimited"
            />
            <SquareImageUpload
              entityId={event?.id || 'new'}
              entityType="event"
              currentImageUrl={heroImageUrl || null}
              label="Event Image"
              helpText="Upload a square image (recommended: 1080x1080px)"
              onImageUploaded={(url) => setHeroImageUrl(url)}
              onImageDeleted={() => setHeroImageUrl('')}
            />
            <Textarea
              label="Event Brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Positioning, audience, offers, must-have talking points..."
              rows={4}
            />
          </div>
        </Section>

        {/* ── Time & Schedule ── */}
        <Section title="Time & Schedule">
          <div className="grid grid-cols-2 gap-3">
            <DateTimePicker
              type="time"
              value={time}
              onChange={setTime}
              aria-label="Start time"
            />
            <DateTimePicker
              type="time"
              value={endTime}
              onChange={setEndTime}
              aria-label="End time"
            />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3">
            <DateTimePicker
              type="time"
              value={doorsTime}
              onChange={setDoorsTime}
              aria-label="Doors time"
            />
            <DateTimePicker
              type="time"
              value={lastEntryTime}
              onChange={setLastEntryTime}
              aria-label="Last entry time"
            />
            <Input
              label="Duration (mins)"
              type="number"
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(e.target.value)}
              placeholder="e.g. 180"
            />
          </div>
          <p className="text-xs text-text-muted mt-1">
            Start · End · Doors · Last Entry · Duration
          </p>
        </Section>

        {/* ── Performer ── */}
        <Section title="Performer">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Performer Name"
              value={performerName}
              onChange={(e) => setPerformerName(e.target.value)}
              placeholder="e.g. DJ John, The Blues Band"
            />
            <Select
              label="Performer Type"
              options={PERFORMER_TYPE_OPTIONS}
              value={performerType}
              onChange={(e) => setPerformerType(e.target.value)}
            />
          </div>
        </Section>

        {/* ── Pricing & Booking ── */}
        <Section title="Pricing & Booking">
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Price (£)"
              type="number"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value)
                const v = e.target.value ? parseFloat(e.target.value) : 0
                setIsFree(v === 0)
              }}
              placeholder="0.00"
            />
            <Select
              label="Payment Mode"
              options={PAYMENT_MODE_OPTIONS}
              value={paymentMode}
              onChange={(e) => {
                const mode = e.target.value
                setPaymentMode(mode)
                if (mode === 'free') { setPrice('0'); setIsFree(true) }
                else { setIsFree(false) }
              }}
            />
            <Select
              label="Booking Mode"
              options={BOOKING_MODE_OPTIONS}
              value={bookingMode}
              onChange={(e) => setBookingMode(e.target.value)}
            />
          </div>
          <Input
            label="External Booking URL"
            value={bookingUrl}
            onChange={(e) => setBookingUrl(e.target.value)}
            placeholder="https://example.com/book"
            className="mt-3"
          />
          <div className="flex flex-col gap-3 mt-4">
            <Toggle
              label="Accept bookings"
              checked={bookingsEnabled}
              onChange={setBookingsEnabled}
            />
            <Toggle
              label="Promotional SMS"
              checked={promoSmsEnabled}
              onChange={setPromoSmsEnabled}
            />
          </div>
        </Section>

        {/* ── Checklist — only for existing events ── */}
        {isEdit && (
          <Section title="Checklist">
            {checklistLoading ? (
              <div className="flex justify-center py-4">
                <Spinner />
              </div>
            ) : checklistItems.length === 0 ? (
              <p className="text-sm text-text-muted">No checklist items</p>
            ) : (
              <div className="flex flex-col gap-2">
                {checklistItems.map((item) => (
                  <Checkbox
                    key={item.key}
                    label={item.label}
                    checked={item.completed}
                    onChange={() => handleToggleChecklist(item.key, item.completed)}
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        {/* ── Keyword Strategy ── */}
        <Section title="Keyword Strategy">
          <KeywordStrategyCard
            primaryKeywords={primaryKeywords}
            secondaryKeywords={secondaryKeywords}
            localSeoKeywords={localSeoKeywords}
            onPrimaryChange={setPrimaryKeywords}
            onSecondaryChange={setSecondaryKeywords}
            onLocalChange={setLocalSeoKeywords}
          />
        </Section>

        {/* ── SEO & Content ── */}
        <Section title="SEO & Content">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-text-muted">
              Generate optimised copy from your event details and brief.
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateSeo}
              disabled={aiLoading}
              icon={aiLoading ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="edit" size={14} />}
            >
              {aiLoading ? 'Generating...' : 'Generate All'}
            </Button>
          </div>

          {/* Meta & URL */}
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="URL Slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))}
              placeholder="event-name-2024-01-01"
            />
            <Input
              label={`Meta Title (${metaTitle.length}/40)`}
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              maxLength={40}
              placeholder="SEO page title"
            />
          </div>
          <Textarea
            label={`Meta Description (${metaDescription.length}/160)`}
            value={metaDescription}
            onChange={(e) => setMetaDescription(e.target.value)}
            rows={2}
            className="mt-3"
            placeholder="SEO page description"
          />

          {/* Content */}
          <Textarea
            label="Short Description"
            value={shortDescription}
            onChange={(e) => setShortDescription(e.target.value)}
            rows={2}
            className="mt-3"
            placeholder="Brief description for listings"
          />
          <Textarea
            label="Long Description"
            value={longDescription}
            onChange={(e) => setLongDescription(e.target.value)}
            rows={4}
            className="mt-3"
            placeholder="Detailed description for the event page"
          />
          <Input
            label="Highlights"
            value={highlights}
            onChange={(e) => setHighlights(e.target.value)}
            placeholder="Great prizes, Fun atmosphere, Live music"
            className="mt-3"
          />
          <p className="text-xs text-text-muted mt-0.5">Separate with commas</p>

          {/* Image & accessibility */}
          <Input
            label="Image Alt Text"
            value={imageAltText}
            onChange={(e) => setImageAltText(e.target.value)}
            placeholder="Descriptive alt text for the event image"
            className="mt-3"
          />
          <Textarea
            label="Cancellation Policy"
            value={cancellationPolicy}
            onChange={(e) => setCancellationPolicy(e.target.value)}
            rows={2}
            className="mt-3"
            placeholder="Cancellation and refund policy..."
          />
          <Textarea
            label="Accessibility Notes"
            value={accessibilityNotes}
            onChange={(e) => setAccessibilityNotes(e.target.value)}
            rows={2}
            className="mt-3"
            placeholder="Wheelchair access, hearing loop, accessible parking..."
          />

          {/* FAQs */}
          <div className="mt-4">
            <FaqEditor
              faqs={faqs}
              onChange={setFaqs}
              onModified={() => setFaqsModified(true)}
            />
          </div>
        </Section>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
          <Button variant="ghost" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} loading={isPending}>
            {isEdit ? 'Save Changes' : 'Create Event'}
          </Button>
        </div>
      </div>
    </Drawer>
  )
}

/* ── Section heading helper ── */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-text-strong mb-3">{title}</h3>
      {children}
    </section>
  )
}
