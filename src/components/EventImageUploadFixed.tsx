'use client'

import { useState, useRef } from 'react'
import { uploadEventImage, deleteEventImage } from '@/app/actions/event-images'
import { Button } from '@/components/ui-v2/forms/Button'
import { TrashIcon, PhotoIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface EventImageUploadFixedProps {
  eventId: string
  imageType: 'hero' | 'thumbnail' | 'poster' | 'gallery'
  currentImageUrl?: string | null
  label: string
  helpText?: string
  onImageUploaded?: (imageUrl: string) => void
  onImageDeleted?: () => void
}

export function EventImageUploadFixed({
  eventId,
  imageType,
  currentImageUrl,
  label,
  helpText,
  onImageUploaded,
  onImageDeleted
}: EventImageUploadFixedProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

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

      setSelectedFile(file)

      // Create preview
      const reader = new FileReader()
      reader.onloadend = () => {
        setPreviewUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile) return

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append('event_id', eventId)
      formData.append('image_type', imageType)
      formData.append('image_file', selectedFile)

      const result = await uploadEventImage({ type: 'idle' }, formData)
      
      if (result.type === 'error') {
        toast.error(result.message || 'Failed to upload image')
      } else if (result.type === 'success' && result.imageUrl) {
        toast.success('Image uploaded successfully')
        setPreviewUrl(result.imageUrl)
        onImageUploaded?.(result.imageUrl)
        setSelectedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    } catch (error) {
      toast.error('Failed to upload image')
    } finally {
      setIsUploading(false)
    }
  }

  // Handle delete
  const handleDelete = async () => {
    if (!currentImageUrl || !window.confirm('Are you sure you want to delete this image?')) {
      return
    }

    setIsDeleting(true)
    try {
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

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
        {helpText && (
          <p className="text-sm text-gray-500 mb-2">{helpText}</p>
        )}
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="relative inline-block">
          <img
            src={previewUrl}
            alt={`${imageType} preview`}
            className="max-w-xs max-h-48 rounded-lg object-cover border border-gray-300"
          />
          {currentImageUrl && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="absolute top-2 right-2 p-1 bg-red-600 text-white rounded-full hover:bg-red-700 disabled:opacity-50"
              title="Delete image"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      {/* Upload controls - no form! */}
      <div className="space-y-4">
        <div className="flex items-center space-x-4">
          <label className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500">
            <span className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
              <PhotoIcon className="h-5 w-5 mr-2" />
              Choose Image
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
              onChange={handleFileSelect}
              className="sr-only"
            />
          </label>

          {selectedFile && (
            <Button 
              type="button" 
              size="sm"
              onClick={handleUpload}
              disabled={isUploading}
            >
              {isUploading ? 'Uploading...' : 'Upload'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}