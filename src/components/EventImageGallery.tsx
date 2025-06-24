'use client'

import { useState, useEffect } from 'react'
import { getEventImages, deleteEventImage, updateImageMetadata } from '@/app/actions/event-images'
import { EventImageUpload } from './EventImageUpload'
import { TrashIcon, PencilIcon, XMarkIcon, CheckIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface EventImage {
  id: string
  storage_path: string
  file_name: string
  image_type: string
  alt_text?: string
  caption?: string
  display_order: number
  url: string
}

interface EventImageGalleryProps {
  eventId: string
  onImagesChange?: () => void
}

export function EventImageGallery({ eventId, onImagesChange }: EventImageGalleryProps) {
  const [images, setImages] = useState<EventImage[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ alt_text: '', caption: '' })

  // Load images
  const loadImages = async () => {
    const result = await getEventImages(eventId)
    if (result.data) {
      setImages(result.data.filter(img => img.image_type === 'gallery'))
    }
    setLoading(false)
  }

  useEffect(() => {
    loadImages()
  }, [eventId])

  // Handle delete
  const handleDelete = async (imageId: string) => {
    if (!window.confirm('Are you sure you want to delete this image?')) {
      return
    }

    const result = await deleteEventImage(imageId, eventId)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Image deleted successfully')
      loadImages()
      onImagesChange?.()
    }
  }

  // Handle edit
  const startEdit = (image: EventImage) => {
    setEditingId(image.id)
    setEditForm({
      alt_text: image.alt_text || '',
      caption: image.caption || ''
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({ alt_text: '', caption: '' })
  }

  const saveEdit = async () => {
    if (!editingId) return

    const result = await updateImageMetadata(editingId, editForm)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success('Image updated successfully')
      setEditingId(null)
      loadImages()
    }
  }

  if (loading) {
    return <div className="text-center py-4">Loading images...</div>
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-gray-900 mb-4">Gallery Images</h3>
        
        {/* Upload new gallery image */}
        <EventImageUpload
          eventId={eventId}
          imageType="gallery"
          label="Add Gallery Image"
          helpText="Upload additional images for the event gallery"
          onImageUploaded={() => {
            loadImages()
            onImagesChange?.()
          }}
        />
      </div>

      {/* Gallery grid */}
      {images.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {images.map((image) => (
            <div key={image.id} className="relative group">
              <img
                src={image.url}
                alt={image.alt_text || image.file_name}
                className="w-full h-48 object-cover rounded-lg"
              />
              
              {/* Overlay with actions */}
              <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all duration-200 rounded-lg">
                <div className="absolute top-2 right-2 flex space-x-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => startEdit(image)}
                    className="p-2 bg-white text-gray-700 rounded-full hover:bg-gray-100"
                    title="Edit details"
                  >
                    <PencilIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(image.id)}
                    className="p-2 bg-red-600 text-white rounded-full hover:bg-red-700"
                    title="Delete image"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Edit form */}
              {editingId === image.id && (
                <div className="absolute inset-0 bg-white bg-opacity-95 p-4 rounded-lg">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Alt Text</label>
                      <input
                        type="text"
                        value={editForm.alt_text}
                        onChange={(e) => setEditForm({ ...editForm, alt_text: e.target.value })}
                        className="mt-1 block w-full text-sm rounded-md border-gray-300 shadow-sm"
                        placeholder="Describe the image"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700">Caption</label>
                      <input
                        type="text"
                        value={editForm.caption}
                        onChange={(e) => setEditForm({ ...editForm, caption: e.target.value })}
                        className="mt-1 block w-full text-sm rounded-md border-gray-300 shadow-sm"
                        placeholder="Optional caption"
                      />
                    </div>
                    <div className="flex justify-end space-x-2">
                      <button
                        onClick={cancelEdit}
                        className="p-1 text-gray-600 hover:text-gray-800"
                      >
                        <XMarkIcon className="h-5 w-5" />
                      </button>
                      <button
                        onClick={saveEdit}
                        className="p-1 text-green-600 hover:text-green-800"
                      >
                        <CheckIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Caption display */}
              {image.caption && !editingId && (
                <p className="mt-2 text-sm text-gray-600">{image.caption}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}