'use client'

import { useState } from 'react'
import { createEventCategory, updateEventCategory } from '@/app/actions/event-categories'
import { EventCategory, CategoryFormData, CATEGORY_ICONS, CATEGORY_COLORS } from '@/types/event-categories'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Textarea } from '@/components/ui-v2/forms/Textarea'
import { Checkbox } from '@/components/ui-v2/forms/Checkbox'

interface EventCategoryFormProps {
  category?: EventCategory | null
  onSuccess: () => void
  onCancel: () => void
}

export function EventCategoryForm({ category, onSuccess, onCancel }: EventCategoryFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState<CategoryFormData>({
    name: category?.name || '',
    description: category?.description || '',
    color: category?.color || '#9333EA',
    icon: category?.icon || 'CalendarIcon',
    default_start_time: category?.default_start_time || '',
    default_end_time: category?.default_end_time || '',
    default_capacity: category?.default_capacity || undefined,
    default_reminder_hours: category?.default_reminder_hours || 24,
    default_price: category?.default_price || 0,
    default_is_free: category?.default_is_free ?? true,
    default_performer_type: category?.default_performer_type || '',
    default_event_status: category?.default_event_status || 'scheduled',
    default_image_url: category?.default_image_url || '',
    slug: category?.slug || '',
    meta_description: category?.meta_description || '',
    is_active: category?.is_active ?? true,
    is_default: category?.is_default ?? false,
    sort_order: category?.sort_order || 0
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    try {
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
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {/* Name */}
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Category Name
          </label>
          <Input
            type="text"
            id="name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Quiz Night"
            fullWidth
          />
        </div>

        {/* Icon */}
        <div>
          <label htmlFor="icon" className="block text-sm font-medium text-gray-700">
            Icon
          </label>
          <Select
            id="icon"
            value={formData.icon}
            onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
            fullWidth
          >
            {CATEGORY_ICONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Color */}
        <div>
          <label htmlFor="color" className="block text-sm font-medium text-gray-700">
            Color
          </label>
          <div className="mt-1 flex items-center space-x-3">
            <Select
              id="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              fullWidth
            >
              {CATEGORY_COLORS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <div
              className="h-8 w-8 rounded-full border border-gray-300"
              style={{ backgroundColor: formData.color }}
            />
          </div>
        </div>

        {/* Default Start Time */}
        <div>
          <label htmlFor="default_start_time" className="block text-sm font-medium text-gray-700">
            Default Start Time
          </label>
          <Input
            type="time"
            id="default_start_time"
            value={formData.default_start_time || ''}
            onChange={(e) => setFormData({ ...formData, default_start_time: e.target.value })}
            fullWidth
          />
        </div>

        {/* Default End Time */}
        <div>
          <label htmlFor="default_end_time" className="block text-sm font-medium text-gray-700">
            Default End Time
          </label>
          <Input
            type="time"
            id="default_end_time"
            value={formData.default_end_time || ''}
            onChange={(e) => setFormData({ ...formData, default_end_time: e.target.value })}
            fullWidth
          />
        </div>

        {/* Default Capacity */}
        <div>
          <label htmlFor="default_capacity" className="block text-sm font-medium text-gray-700">
            Default Capacity
          </label>
          <Input
            type="number"
            id="default_capacity"
            min="1"
            max="10000"
            value={formData.default_capacity || ''}
            onChange={(e) => setFormData({
              ...formData,
              default_capacity: e.target.value ? parseInt(e.target.value) : undefined
            })}
            placeholder="Leave empty for no default"
            fullWidth
          />
        </div>

        {/* Default Reminder Hours */}
        <div>
          <label htmlFor="default_reminder_hours" className="block text-sm font-medium text-gray-700">
            Default Reminder (hours before)
          </label>
          <Input
            type="number"
            id="default_reminder_hours"
            required
            min="1"
            max="168"
            value={formData.default_reminder_hours}
            onChange={(e) => setFormData({
              ...formData,
              default_reminder_hours: parseInt(e.target.value) || 24
            })}
            fullWidth
          />
        </div>
        {/* Default Price */}
        <div>
          <label htmlFor="default_price" className="block text-sm font-medium text-gray-700">
            Default Price (£)
          </label>
          <Input
            type="number"
            id="default_price"
            min="0"
            step="0.01"
            value={formData.default_price || 0}
            onChange={(e) => setFormData({
              ...formData,
              default_price: parseFloat(e.target.value) || 0
            })}
            fullWidth
          />
        </div>

        {/* Default Event Status */}
        <div>
          <label htmlFor="default_event_status" className="block text-sm font-medium text-gray-700">
            Default Event Status
          </label>
          <Select
            id="default_event_status"
            value={formData.default_event_status || 'scheduled'}
            onChange={(e) => setFormData({ ...formData, default_event_status: e.target.value })}
            fullWidth
          >
            <option value="scheduled">Scheduled</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
            <option value="postponed">Postponed</option>
            <option value="rescheduled">Rescheduled</option>
          </Select>
        </div>

        {/* Default Performer Type */}
        <div>
          <label htmlFor="default_performer_type" className="block text-sm font-medium text-gray-700">
            Default Performer Type
          </label>
          <Select
            id="default_performer_type"
            value={formData.default_performer_type || ''}
            onChange={(e) => setFormData({ ...formData, default_performer_type: e.target.value })}
            fullWidth
          >
            <option value="">No default</option>
            <option value="MusicGroup">Music Group/Band</option>
            <option value="Person">Solo Artist</option>
            <option value="TheaterGroup">Theater Group</option>
            <option value="DanceGroup">Dance Group</option>
            <option value="ComedyGroup">Comedy Group</option>
            <option value="Organization">Organization</option>
          </Select>
        </div>

        {/* URL Slug */}
        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
            URL Slug
          </label>
          <Input
            type="text"
            id="slug"
            value={formData.slug || ''}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
            placeholder="auto-generated-from-name"
            fullWidth
          />
          <p className="mt-1 text-xs text-gray-500">Used in URLs. Leave empty to auto-generate.</p>
        </div>

        {/* Sort Order */}
        <div>
          <label htmlFor="sort_order" className="block text-sm font-medium text-gray-700">
            Sort Order
          </label>
          <Input
            type="number"
            id="sort_order"
            value={formData.sort_order || 0}
            onChange={(e) => setFormData({
              ...formData,
              sort_order: parseInt(e.target.value) || 0
            })}
            placeholder="0"
            fullWidth
          />
          <p className="mt-1 text-xs text-gray-500">Lower numbers appear first</p>
        </div>
      </div>

      {/* Default Image URL */}
      <div>
        <label htmlFor="default_image_url" className="block text-sm font-medium text-gray-700">
          Default Event Image URL
        </label>
        <Input
          type="url"
          id="default_image_url"
          value={formData.default_image_url || ''}
          onChange={(e) => setFormData({ ...formData, default_image_url: e.target.value })}
          placeholder="https://example.com/default-event-image.jpg"
          fullWidth
        />
        <p className="mt-1 text-xs text-gray-500">Default image used for events in this category when they don&apos;t have their own image</p>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <Textarea
          id="description"
          rows={3}
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Optional description of this event category"
          fullWidth
        />
      </div>

      {/* Meta Description */}
      <div>
        <label htmlFor="meta_description" className="block text-sm font-medium text-gray-700">
          SEO Meta Description
        </label>
        <Textarea
          id="meta_description"
          rows={2}
          value={formData.meta_description || ''}
          onChange={(e) => setFormData({ ...formData, meta_description: e.target.value })}
          placeholder="Description for search engines (150-160 characters)"
          maxLength={160}
          fullWidth
        />
        <p className="mt-1 text-xs text-gray-500">{formData.meta_description?.length || 0}/160 characters</p>
      </div>

      {/* Default Free Event */}
      <div>
        <Checkbox
          id="default_is_free"
          checked={formData.default_is_free || false}
          onChange={(e) => setFormData({ ...formData, default_is_free: e.target.checked })}
          label="Events in this category are free by default"
        />
      </div>

      {/* Active Status */}
      <div>
        <Checkbox
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
          label="Active (visible when creating events)"
        />
      </div>

      {/* Default Category */}
      <div>
        <Checkbox
          id="is_default"
          checked={formData.is_default || false}
          onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
          label="Default category (automatically selected for new events)"
        />
      </div>

      {/* Form Actions */}
      <div className="flex justify-end space-x-3 pt-4 border-t">
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? 'Saving...' : (category ? 'Update Category' : 'Create Category')}
        </Button>
      </div>
    </form>
  )
}
