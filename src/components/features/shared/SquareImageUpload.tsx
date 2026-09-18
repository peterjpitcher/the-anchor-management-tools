'use client'

import { useState, useRef, useEffect } from 'react'
import { uploadEventImage, deleteEventImage, deleteCategoryImage } from '@/app/actions/event-images'
import { Button, ConfirmDialog } from '@/ds'
import { TrashIcon, PhotoIcon } from '@heroicons/react/24/outline'
import toast from 'react-hot-toast'

interface SquareImageUploadProps {
  entityId: string
  entityType: 'event' | 'category'
  currentImageUrl?: string | null
  label?: string
  helpText?: string
  onImageUploaded?: (imageUrl: string) => void
  onImageDeleted?: () => void
}

export function SquareImageUpload({
  entityId,
  entityType,
  currentImageUrl,
  label = 'Image',
  helpText = 'Upload a square image (recommended: 1080x1080px)',
  onImageUploaded,
  onImageDeleted
}: SquareImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  
  // Update previewUrl when currentImageUrl prop changes
  useEffect(() => {
    if (currentImageUrl && !selectedFile) {
      setPreviewUrl(currentImageUrl)
    }
  }, [currentImageUrl, selectedFile])

  // Choosing a file uploads it. There is no second step: the old two-step flow
  // discarded the chosen file without warning if the form was closed.
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Please select a valid image file (JPEG, PNG, or WebP)')
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

    e.target.value = ''
    void handleUpload(file)
  }

  // Handle upload
  const handleUpload = async (file?: File) => {
    const fileToUpload = file ?? selectedFile
    if (!fileToUpload) return

    // Don't allow upload for new entities
    if (entityId === 'new') {
      toast.error(`Please save the ${entityType} first before uploading images`)
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append(entityType === 'event' ? 'event_id' : 'category_id', entityId)
      formData.append('image_type', 'hero') // Use 'hero' as the single image type
      formData.append('image_file', fileToUpload)

      const result = await uploadEventImage({ type: 'idle' }, formData)

      if (result.type === 'error') {
        // Put the tile back exactly as it was, rather than leaving a preview of
        // a file that was never stored.
        setPreviewUrl(currentImageUrl || null)
        setSelectedFile(null)
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

  // Handle delete (called from the confirmation dialog)
  const handleDelete = async () => {
    if (!currentImageUrl) {
      return
    }

    setIsDeleting(true)
    try {
      // Each entity type has its own action. Routing a category through the event
      // action always failed, because it looks the id up in `events`.
      const result = entityType === 'category'
        ? await deleteCategoryImage(currentImageUrl, entityId)
        : await deleteEventImage(currentImageUrl, entityId)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Image deleted successfully')
        setPreviewUrl(null)
        setSelectedFile(null)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        onImageDeleted?.()
      }
    } catch (error) {
      toast.error('Failed to delete image')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block mb-1 text-xs font-medium uppercase tracking-wider text-text-muted">
          {label}
        </label>
        {helpText && (
          <p className="text-sm text-text-soft mb-2">{helpText}</p>
        )}
      </div>

      {/* Preview */}
      {previewUrl && (
        <div className="relative inline-block">
          <div className="w-32 h-32 sm:w-48 sm:h-48 rounded-lg overflow-hidden bg-surface-hover border border-border-strong">
            <img
              src={previewUrl}
              alt="Preview"
              className="w-full h-full object-cover"
            />
          </div>
          {currentImageUrl && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={isDeleting}
              className="absolute -top-2 -right-2 p-2 sm:p-1.5 bg-danger text-white rounded-full hover:brightness-95 disabled:opacity-50 shadow-default touch-manipulation min-w-touch min-h-touch sm:min-w-0 sm:min-h-0 flex items-center justify-center focus-visible:outline-hidden focus-visible:shadow-ring"
              title="Delete image"
            >
              <TrashIcon className="h-5 w-5 sm:h-4 sm:w-4" />
            </button>
          )}
        </div>
      )}

      {/* Upload controls */}
      <div className="space-y-4">
        {entityId === 'new' && (
          <div className="text-sm text-warning-fg bg-warning-soft border border-warning-border p-3 rounded-md">
            Save the {entityType} first before uploading images
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-0 sm:space-x-4">
          <label className={`relative ${entityId === 'new' || isUploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'} rounded-md font-medium focus-within:shadow-ring`}>
            <span className="inline-flex items-center px-4 py-3 sm:py-2 border border-border-strong rounded-md shadow-xs text-base sm:text-sm font-medium text-text bg-surface hover:bg-surface-hover active:bg-surface-hover min-h-touch touch-manipulation">
              <PhotoIcon className="h-5 w-5 mr-2" />
              {isUploading ? 'Uploading...' : previewUrl ? 'Replace Image' : 'Choose Image'}
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleFileSelect}
              className="sr-only"
              disabled={entityId === 'new' || isUploading}
            />
          </label>
        </div>

        <p className="text-sm text-text-soft" aria-live="polite">
          {isUploading
            ? 'Uploading...'
            : 'The image uploads as soon as you choose it.'}
        </p>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete image"
        message="Are you sure you want to delete this image?"
        confirmLabel="Delete"
        tone="danger"
        closeOnConfirm={false}
      />
    </div>
  )
}