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
    default_capacity: category?.default_capacity || undefined,
    default_reminder_hours: category?.default_reminder_hours || 24,
    is_active: category?.is_active ?? true,
    is_default: category?.is_default ?? false
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