'use client'

import { useState } from 'react'
import { createEventCategory, updateEventCategory } from '@/app/actions/event-categories'
import { EventCategory, CategoryFormData, CATEGORY_ICONS, CATEGORY_COLORS } from '@/types/event-categories'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/Button'

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
          <input
            type="text"
            id="name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="e.g., Quiz Night"
          />
        </div>

        {/* Icon */}
        <div>
          <label htmlFor="icon" className="block text-sm font-medium text-gray-700">
            Icon
          </label>
          <select
            id="icon"
            value={formData.icon}
            onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          >
            {CATEGORY_ICONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Color */}
        <div>
          <label htmlFor="color" className="block text-sm font-medium text-gray-700">
            Color
          </label>
          <div className="mt-1 flex items-center space-x-3">
            <select
              id="color"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            >
              {CATEGORY_COLORS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
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
          <input
            type="time"
            id="default_start_time"
            value={formData.default_start_time || ''}
            onChange={(e) => setFormData({ ...formData, default_start_time: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>

        {/* Default End Time */}
        <div>
          <label htmlFor="default_end_time" className="block text-sm font-medium text-gray-700">
            Default End Time
          </label>
          <input
            type="time"
            id="default_end_time"
            value={formData.default_end_time || ''}
            onChange={(e) => setFormData({ ...formData, default_end_time: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>

        {/* Default Capacity */}
        <div>
          <label htmlFor="default_capacity" className="block text-sm font-medium text-gray-700">
            Default Capacity
          </label>
          <input
            type="number"
            id="default_capacity"
            min="1"
            max="10000"
            value={formData.default_capacity || ''}
            onChange={(e) => setFormData({ 
              ...formData, 
              default_capacity: e.target.value ? parseInt(e.target.value) : undefined 
            })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="Leave empty for no default"
          />
        </div>

        {/* Default Reminder Hours */}
        <div>
          <label htmlFor="default_reminder_hours" className="block text-sm font-medium text-gray-700">
            Default Reminder (hours before)
          </label>
          <input
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
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>
        {/* Default Price */}
        <div>
          <label htmlFor="default_price" className="block text-sm font-medium text-gray-700">
            Default Price (£)
          </label>
          <input
            type="number"
            id="default_price"
            min="0"
            step="0.01"
            value={formData.default_price || 0}
            onChange={(e) => setFormData({ 
              ...formData, 
              default_price: parseFloat(e.target.value) || 0 
            })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>

        {/* Default Event Status */}
        <div>
          <label htmlFor="default_event_status" className="block text-sm font-medium text-gray-700">
            Default Event Status
          </label>
          <select
            id="default_event_status"
            value={formData.default_event_status || 'scheduled'}
            onChange={(e) => setFormData({ ...formData, default_event_status: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          >
            <option value="scheduled">Scheduled</option>
            <option value="cancelled">Cancelled</option>
            <option value="postponed">Postponed</option>
            <option value="rescheduled">Rescheduled</option>
          </select>
        </div>

        {/* Default Performer Type */}
        <div>
          <label htmlFor="default_performer_type" className="block text-sm font-medium text-gray-700">
            Default Performer Type
          </label>
          <select
            id="default_performer_type"
            value={formData.default_performer_type || ''}
            onChange={(e) => setFormData({ ...formData, default_performer_type: e.target.value })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          >
            <option value="">No default</option>
            <option value="MusicGroup">Music Group/Band</option>
            <option value="Person">Solo Artist</option>
            <option value="TheaterGroup">Theater Group</option>
            <option value="DanceGroup">Dance Group</option>
            <option value="ComedyGroup">Comedy Group</option>
            <option value="Organization">Organization</option>
          </select>
        </div>

        {/* URL Slug */}
        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-gray-700">
            URL Slug
          </label>
          <input
            type="text"
            id="slug"
            value={formData.slug || ''}
            onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="auto-generated-from-name"
          />
          <p className="mt-1 text-xs text-gray-500">Used in URLs. Leave empty to auto-generate.</p>
        </div>

        {/* Sort Order */}
        <div>
          <label htmlFor="sort_order" className="block text-sm font-medium text-gray-700">
            Sort Order
          </label>
          <input
            type="number"
            id="sort_order"
            value={formData.sort_order || 0}
            onChange={(e) => setFormData({ 
              ...formData, 
              sort_order: parseInt(e.target.value) || 0 
            })}
            className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
            placeholder="0"
          />
          <p className="mt-1 text-xs text-gray-500">Lower numbers appear first</p>
        </div>
      </div>

      {/* Default Image URL */}
      <div>
        <label htmlFor="default_image_url" className="block text-sm font-medium text-gray-700">
          Default Event Image URL
        </label>
        <input
          type="url"
          id="default_image_url"
          value={formData.default_image_url || ''}
          onChange={(e) => setFormData({ ...formData, default_image_url: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="https://example.com/default-event-image.jpg"
        />
        <p className="mt-1 text-xs text-gray-500">Default image used for events in this category when they don't have their own image</p>
      </div>

      {/* Description */}
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea
          id="description"
          rows={3}
          value={formData.description || ''}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Optional description of this event category"
        />
      </div>

      {/* Meta Description */}
      <div>
        <label htmlFor="meta_description" className="block text-sm font-medium text-gray-700">
          SEO Meta Description
        </label>
        <textarea
          id="meta_description"
          rows={2}
          value={formData.meta_description || ''}
          onChange={(e) => setFormData({ ...formData, meta_description: e.target.value })}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          placeholder="Description for search engines (150-160 characters)"
          maxLength={160}
        />
        <p className="mt-1 text-xs text-gray-500">{formData.meta_description?.length || 0}/160 characters</p>
      </div>

      {/* Default Free Event */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="default_is_free"
          checked={formData.default_is_free || false}
          onChange={(e) => setFormData({ ...formData, default_is_free: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="default_is_free" className="ml-2 block text-sm text-gray-900">
          Events in this category are free by default
        </label>
      </div>

      {/* Active Status */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="is_active"
          checked={formData.is_active}
          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
          Active (visible when creating events)
        </label>
      </div>

      {/* Default Category */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="is_default"
          checked={formData.is_default || false}
          onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
        />
        <label htmlFor="is_default" className="ml-2 block text-sm text-gray-900">
          Default category (automatically selected for new events)
        </label>
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