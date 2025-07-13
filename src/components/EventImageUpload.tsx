'use client'

import { useState, useRef } from 'react'
import { useFormState } from 'react-dom'
import { uploadEventImage, deleteEventImage, type ImageUploadState } from '@/app/actions/event-images'
import { Button } from '@/components/ui/Button'
import { TrashIcon, PhotoIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface EventImageUploadProps {
  eventId: string
  imageType: 'hero' | 'thumbnail' | 'poster' | 'gallery'
  currentImageUrl?: string | null
  label: string
  helpText?: string
  onImageUploaded?: (imageUrl: string) => void
  onImageDeleted?: () => void
}

const initialState: ImageUploadState = { type: 'idle' }

export function EventImageUpload({
  eventId,
  imageType,
  currentImageUrl,
  label,
  helpText,
  onImageUploaded,
  onImageDeleted
}: EventImageUploadProps) {
  const [state, formAction] = useFormState(uploadEventImage, initialState)
  const [isDeleting, setIsDeleting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // Handle file selection and preview
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
      if (!allowedTypes.includes(file.type)) {
        toast.error('Please select a valid image file (JPEG, PNG, WebP, or GIF)')
        e.target.value = ''
        return
      }

      // Validate file size (10MB)
      if (file.size > 10 * 1024 * 1024) {
        toast.error('File size must be less than 10MB')
        e.target.value = ''
        return
      }

      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!currentImageUrl || !window.confirm('Are you sure you want to delete this image?')) {
      return
    }

    setIsDeleting(true)
    try {
      // Extract image ID from the current setup if needed
      // For now, we'll handle deletion through the image URL
      const result = await deleteEventImage(currentImageUrl, eventId)
      
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Image deleted successfully')
        setPreviewUrl(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onImageDeleted?.()
      }
    } catch (error) {
      toast.error('Failed to delete image')
    } finally {
      setIsDeleting(false)
    }
  }

  // Handle form submission result
  if (state.type === 'success' && state.imageUrl) {
    if (previewUrl !== state.imageUrl) {
      setPreviewUrl(state.imageUrl)
      onImageUploaded?.(state.imageUrl)
      toast.success(state.message || 'Image uploaded successfully')
      
      // Reset form
      if (formRef.current) {
        formRef.current.reset()
      }
    }
  } else if (state.type === 'error') {
    toast.error(state.message || 'Failed to upload image')
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm sm:text-base font-medium text-gray-700 mb-1">
          {label}
        </label>
        {helpText && (
          <p className="text-sm sm:text-base text-gray-500 mb-2">{helpText}</p>
        )}
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt={`${imageType} preview`}
            className="w-full max-w-[200px] sm:max-w-xs max-h-[200px] sm:max-h-48 rounded-lg object-cover border border-gray-300"
          />
          {currentImageUrl && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="absolute top-2 right-2 p-2 sm:p-1.5 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50 touch-manipulation min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
              title="Delete image"
            >
              <TrashIcon className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          )}
        </div>
      )}

      {/* Upload form */}
      <form ref={formRef} action={formAction} className="space-y-4">
        <input type="hidden" name="event_id" value={eventId} />
        <input type="hidden" name="image_type" value={imageType} />
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-0 sm:space-x-4">
          <label className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500">
            <span className="inline-flex items-center px-4 py-3 sm:py-2 border border-gray-300 rounded-md shadow-sm text-base sm:text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 active:bg-gray-100 min-h-[44px] touch-manipulation">
              <PhotoIcon className="h-5 w-5 mr-2" />
              Choose Image
            </span>
            <input
              ref={fileInputRef}
              type="file"
              name="image_file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              onChange={handleFileSelect}
              className="sr-only"
              required={!currentImageUrl}
            />
          </label>

          {fileInputRef.current?.files?.[0] && (
            <Button type="submit" size="sm" className="w-full sm:w-auto">
              Upload
            </Button>
          )}
        </div>

        {/* Optional fields for gallery images */}
        {imageType === 'gallery' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`alt_text_${imageType}`} className="block text-sm sm:text-base font-medium text-gray-700">
                Alt Text
              </label>
              <input
                type="text"
                id={`alt_text_${imageType}`}
                name="alt_text"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 min-h-[44px]"
                placeholder="Describe the image for accessibility"
              />
            </div>
            <div>
              <label htmlFor={`caption_${imageType}`} className="block text-sm sm:text-base font-medium text-gray-700">
                Caption
              </label>
              <input
                type="text"
                id={`caption_${imageType}`}
                name="caption"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-3 sm:py-2 text-base sm:text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 min-h-[44px]"
                placeholder="Optional caption"
              />
            </div>
          </div>
        )}
      </form>
    </div>
  )
}