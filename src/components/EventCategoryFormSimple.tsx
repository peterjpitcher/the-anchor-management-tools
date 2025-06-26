'use client'

import { useState } from 'react'
import { EventCategory } from '@/types/event-categories'
import { Button } from '@/components/ui/Button'
import { SquareImageUpload } from './SquareImageUpload'
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/types/event-categories'
import toast from 'react-hot-toast'

interface EventCategoryFormSimpleProps {
  category?: EventCategory | null
  onSubmit: (data: Partial<EventCategory>) => Promise<void>
  onCancel: () => void
}

export function EventCategoryFormSimple({ category, onSubmit, onCancel }: EventCategoryFormSimpleProps) {
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
        // Set other image URLs to match the single image
        thumbnail_image_url: imageUrl || null,
        poster_image_url: imageUrl || null,
        default_start_time: defaultStartTime || null,
        default_end_time: defaultEndTime || null,
        default_capacity: defaultCapacity ? parseInt(defaultCapacity) : null,
        default_price: parseFloat(defaultPrice) || 0,
        default_is_free: defaultIsFree,
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
      <div className="bg-white shadow-sm ring-1 ring-gray-900/5 sm:rounded-xl md:col-span-2">
        <div className="px-4 py-6 sm:p-8">
          <div className="grid max-w-2xl grid-cols-1 gap-x-6 gap-y-8 sm:grid-cols-6">
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

            {/* Basic Information */}
            <div className="col-span-full">
              <h3 className="text-lg font-medium leading-6 text-gray-900">Basic Information</h3>
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
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

            {/* Default Event Settings */}
            <div className="col-span-full">
              <h3 className="text-lg font-medium leading-6 text-gray-900">Default Event Settings</h3>
              <p className="mt-1 text-sm text-gray-500">These will be used as defaults when creating events in this category</p>
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
              </div>
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
                  className="block w-full rounded-md border-0 py-1.5 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 placeholder:text-gray-400 focus:ring-2 focus:ring-inset focus:ring-indigo-600 sm:text-sm sm:leading-6"
                />
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
              <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">Preview</h3>
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
        </div>

        <div className="flex items-center justify-end gap-x-6 border-t border-gray-900/10 px-4 py-4 sm:px-8">
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : category ? 'Update Category' : 'Create Category'}
          </Button>
        </div>
      </div>
    </form>
  )
}