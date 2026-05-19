'use client'

import { useState, useEffect, useTransition } from 'react'
import {
  Drawer, Button, Input, Select, Textarea, DateTimePicker,
  Checkbox, Spinner, toast,
} from '@/ds'
import { Icon } from '@/ds/icons'
import { createEvent, updateEvent } from '@/app/actions/events'
import { getEventChecklist, toggleEventChecklistTask } from '@/app/actions/event-checklist'
import { generateEventSeoContent, generateEventPromotionContent } from '@/app/actions/event-content'
import { getEventImages } from '@/app/actions/event-images'
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

export function EventDrawer({ open, onClose, event, categories, onSave }: EventDrawerProps) {
  const isEdit = !!event
  const [isPending, startTransition] = useTransition()

  // Form state
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [status, setStatus] = useState('scheduled')
  const [capacity, setCapacity] = useState('')
  const [price, setPrice] = useState('')
  const [description, setDescription] = useState('')

  // Checklist state
  const [checklistItems, setChecklistItems] = useState<EventChecklistItem[]>([])
  const [checklistLoading, setChecklistLoading] = useState(false)

  // AI content state
  const [seoContent, setSeoContent] = useState('')
  const [promoContent, setPromoContent] = useState('')
  const [aiLoading, setAiLoading] = useState(false)

  // Images state
  const [images, setImages] = useState<Array<{ id: string; url: string; image_type: string }>>([])

  // Initialize form when event changes
  useEffect(() => {
    if (event) {
      setName(event.name || '')
      setDate(event.date || '')
      setTime(event.time || '')
      setCategoryId(event.category_id || '')
      setStatus(event.event_status || 'scheduled')
      setCapacity(event.capacity?.toString() || '')
      setPrice(event.price?.toString() || '')
      setDescription(event.short_description || '')
    } else {
      setName('')
      setDate('')
      setTime('')
      setCategoryId('')
      setStatus('scheduled')
      setCapacity('')
      setPrice('')
      setDescription('')
    }
    setSeoContent('')
    setPromoContent('')
  }, [event])

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

  // Load images for existing events
  useEffect(() => {
    if (event?.id && open) {
      getEventImages(event.id).then((result) => {
        if (result && Array.isArray(result.data)) {
          setImages(result.data.map((img: { id: string; url?: string; storage_path?: string; image_type: string }) => ({
            id: img.id,
            url: img.url || img.storage_path || '',
            image_type: img.image_type,
          })))
        }
      })
    } else {
      setImages([])
    }
  }, [event?.id, open])

  const categoryOptions = [
    { value: '', label: 'Select category' },
    ...categories.map((c) => ({ value: c.id, label: c.name })),
  ]

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
      if (categoryId) formData.set('category_id', categoryId)
      formData.set('event_status', status)
      if (capacity) formData.set('capacity', capacity)
      if (price) formData.set('price', price)
      if (description) formData.set('short_description', description)

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
    const result = await generateEventSeoContent({
      eventId: event?.id,
      name,
      date,
      time,
      capacity: capacity ? parseInt(capacity) : null,
      price: price ? parseFloat(price) : null,
    })
    setAiLoading(false)
    if (result.success) {
      const parts = [
        result.data.metaTitle && `Meta Title: ${result.data.metaTitle}`,
        result.data.metaDescription && `Meta Description: ${result.data.metaDescription}`,
        result.data.shortDescription && `Short Description: ${result.data.shortDescription}`,
        result.data.longDescription && `Long Description: ${result.data.longDescription}`,
      ].filter(Boolean)
      setSeoContent(parts.join('\n\n'))
    } else {
      toast.error(result.error)
    }
  }

  async function handleGeneratePromo() {
    if (!event?.id) {
      toast.error('Save the event first to generate promotion content')
      return
    }
    setAiLoading(true)
    const result = await generateEventPromotionContent({
      eventId: event.id,
      contentType: 'facebook_event',
    })
    setAiLoading(false)
    if (result.success) {
      const content = result.data.content
      const text = 'name' in content
        ? `${content.name}\n\n${content.description}`
        : `${content.title}\n\n${content.description}`
      setPromoContent(text)
    } else {
      toast.error(result.error)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Event' : 'New Event'}
      width="600px"
    >
      <div className="flex flex-col gap-6">
        {/* Basic Info */}
        <section>
          <h3 className="text-sm font-semibold text-text-strong mb-3">Basic Info</h3>
          <div className="flex flex-col gap-3">
            <Input
              label="Event Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter event name"
            />
            <div className="grid grid-cols-2 gap-3">
              <DateTimePicker
                type="date"
                value={date}
                onChange={setDate}
                aria-label="Event date"
              />
              <DateTimePicker
                type="time"
                value={time}
                onChange={setTime}
                aria-label="Event time"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Select
                label="Category"
                options={categoryOptions}
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              />
              <Select
                label="Status"
                options={STATUS_OPTIONS}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Capacity"
                type="number"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                placeholder="e.g. 100"
              />
              <Input
                label="Ticket Price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>
        </section>

        {/* Description */}
        <section>
          <h3 className="text-sm font-semibold text-text-strong mb-3">Description</h3>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Event description..."
            rows={4}
          />
        </section>

        {/* Checklist — only for existing events */}
        {isEdit && (
          <section>
            <h3 className="text-sm font-semibold text-text-strong mb-3">Checklist</h3>
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
          </section>
        )}

        {/* AI Content */}
        <section>
          <h3 className="text-sm font-semibold text-text-strong mb-3">AI Content</h3>
          <div className="flex gap-2 mb-3">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGenerateSeo}
              disabled={aiLoading}
              icon={<Icon name="edit" size={14} />}
            >
              Generate SEO
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleGeneratePromo}
              disabled={aiLoading || !isEdit}
              icon={<Icon name="edit" size={14} />}
            >
              Generate Promotion
            </Button>
          </div>
          {aiLoading && (
            <div className="flex items-center gap-2 text-sm text-text-muted mb-2">
              <Spinner /> Generating...
            </div>
          )}
          {seoContent && (
            <Textarea
              value={seoContent}
              readOnly
              rows={6}
              className="mb-2"
            />
          )}
          {promoContent && (
            <Textarea
              value={promoContent}
              readOnly
              rows={4}
            />
          )}
        </section>

        {/* Images — only for existing events */}
        {isEdit && (
          <section>
            <h3 className="text-sm font-semibold text-text-strong mb-3">Images</h3>
            {images.length === 0 ? (
              <p className="text-sm text-text-muted">No images uploaded</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {images.map((img) => (
                  <div key={img.id} className="relative group aspect-square rounded-default overflow-hidden border border-border">
                    <img
                      src={img.url}
                      alt={`Event image (${img.image_type})`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Footer actions */}
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
