'use client'

import { useState, useEffect } from 'react'
import { uploadEventImage, deleteEventImage, deleteCategoryImage } from '@/app/actions/event-images'
import { Alert, ConfirmDialog, Field, FileUpload, Icon, IconButton, toast } from '@/ds'

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
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  
  // Update previewUrl when currentImageUrl prop changes
  useEffect(() => {
    if (currentImageUrl && !selectedFile) {
      setPreviewUrl(currentImageUrl)
    }
  }, [currentImageUrl, selectedFile])

  // Choosing a file uploads it. There is no second step: the old two-step flow
  // discarded the chosen file without warning if the form was closed.
  const handleFileSelect = (files: File[]) => {
    const file = files[0]
    if (!file || isUploading) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Please select a valid image file (JPEG, PNG, or WebP)')
      return
    }

    // Validate file size (10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File size must be less than 10MB')
      return
    }

    setSelectedFile(file)

    // Create preview
    const reader = new FileReader()
    reader.onloadend = () => {
      setPreviewUrl(reader.result as string)
    }
    reader.readAsDataURL(file)

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
        onImageDeleted?.()
      }
    } catch (error) {
      toast.error('Failed to delete image')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const canUpload = entityId !== 'new' && !isUploading

  return (
    <div className="space-y-4">
      <Field label={label} hint={helpText}>
        <div className="space-y-4">
          {/* Preview */}
          {previewUrl && (
            <div className="relative inline-block">
              <div className="h-32 w-32 overflow-hidden rounded-lg border border-border-strong bg-surface-hover sm:h-48 sm:w-48">
                <img src={previewUrl} alt="Preview" className="h-full w-full object-cover" />
              </div>
              {currentImageUrl && (
                <IconButton
                  variant="danger"
                  size="sm"
                  label="Delete image"
                  title="Delete Image"
                  icon={<Icon name="trash" size={16} />}
                  onClick={() => setShowDeleteConfirm(true)}
                  disabled={isDeleting}
                  className="absolute -right-2 -top-2 rounded-full shadow-default"
                />
              )}
            </div>
          )}

          {/* Upload controls */}
          {entityId === 'new' ? (
            <Alert tone="warning">Save the {entityType} first before uploading images</Alert>
          ) : canUpload ? (
            <FileUpload
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onFiles={handleFileSelect}
              hint={previewUrl ? 'Choose another image to replace this one' : 'JPEG, PNG or WebP, up to 10MB'}
            />
          ) : null}

          <p className="text-sm text-text-soft" aria-live="polite">
            {isUploading
              ? 'Uploading...'
              : 'The image uploads as soon as you choose it.'}
          </p>
        </div>
      </Field>

      <ConfirmDialog
        open={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title="Delete Image"
        message="Are you sure you want to delete this image?"
        confirmLabel="Delete"
        tone="danger"
        closeOnConfirm={false}
      />
    </div>
  )
}