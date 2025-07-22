'use client'

/**
 * FileUpload Component
 * 
 * Used on 22/107 pages (21%)
 * 
 * Comprehensive file upload with drag & drop, progress tracking, and preview.
 * Critical for document management, employee files, and media uploads.
 */

import { useState, useRef, useCallback, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { 
  CloudArrowUpIcon, 
  DocumentIcon, 
  PhotoIcon,
  XMarkIcon,
  CheckCircleIcon,
  ExclamationCircleIcon
} from '@heroicons/react/24/outline'
import { formatBytes } from '../utils/format'
import { ProgressBar } from '../feedback/ProgressBar'
import { Spinner } from '../feedback/Spinner'

export interface FileUploadProps {
  /**
   * Accepted file types (MIME types or extensions)
   */
  accept?: string
  
  /**
   * Whether to allow multiple files
   * @default false
   */
  multiple?: boolean
  
  /**
   * Maximum file size in bytes
   */
  maxSize?: number
  
  /**
   * Maximum number of files (when multiple is true)
   */
  maxFiles?: number
  
  /**
   * Callback when files are selected
   */
  onFilesChange: (files: File[]) => void
  
  /**
   * Callback for file upload
   */
  onUpload?: (file: File) => Promise<void>
  
  /**
   * Current files (for controlled mode)
   */
  files?: File[]
  
  /**
   * Whether the upload is disabled
   * @default false
   */
  disabled?: boolean
  
  /**
   * Whether to show file preview
   * @default true
   */
  showPreview?: boolean
  
  /**
   * Whether to show upload progress
   * @default true
   */
  showProgress?: boolean
  
  /**
   * Custom upload text
   */
  uploadText?: string
  
  /**
   * Custom upload description
   */
  uploadDescription?: string
  
  /**
   * Variant of the upload area
   * @default 'default'
   */
  variant?: 'default' | 'compact' | 'button'
  
  /**
   * Additional class names
   */
  className?: string
  
  /**
   * Whether to enable camera access on mobile
   * @default false
   */
  enableCamera?: boolean
  
  /**
   * Custom validation function
   */
  validate?: (file: File) => string | null
}

interface FileItem {
  file: File
  preview?: string
  progress?: number
  error?: string
  uploading?: boolean
  uploaded?: boolean
}

export function FileUpload({
  accept,
  multiple = false,
  maxSize,
  maxFiles,
  onFilesChange,
  onUpload,
  files: controlledFiles,
  disabled = false,
  showPreview = true,
  showProgress = true,
  uploadText = 'Click to upload or drag and drop',
  uploadDescription,
  variant = 'default',
  className,
  enableCamera = false,
  validate,
}: FileUploadProps) {
  const [fileItems, setFileItems] = useState<FileItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Generate upload description if not provided
  const getUploadDescription = () => {
    if (uploadDescription) return uploadDescription
    
    const parts = []
    if (accept) {
      const types = accept.split(',').map(t => t.trim())
      parts.push(types.join(', '))
    }
    if (maxSize) {
      parts.push(`Max ${formatBytes(maxSize)}`)
    }
    if (multiple && maxFiles) {
      parts.push(`Max ${maxFiles} files`)
    }
    
    return parts.join(' • ')
  }
  
  // Validate file
  const validateFile = (file: File): string | null => {
    // Custom validation
    if (validate) {
      const error = validate(file)
      if (error) return error
    }
    
    // Size validation
    if (maxSize && file.size > maxSize) {
      return `File size exceeds ${formatBytes(maxSize)}`
    }
    
    // Type validation
    if (accept) {
      const acceptedTypes = accept.split(',').map(t => t.trim())
      const fileType = file.type
      const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase()
      
      const isAccepted = acceptedTypes.some(type => {
        if (type.startsWith('.')) {
          return fileExtension === type.toLowerCase()
        }
        if (type.endsWith('/*')) {
          return fileType.startsWith(type.replace('/*', '/'))
        }
        return fileType === type
      })
      
      if (!isAccepted) {
        return `File type not accepted. Allowed: ${accept}`
      }
    }
    
    return null
  }
  
  // Handle file selection
  const handleFiles = useCallback(async (selectedFiles: FileList | File[]) => {
    const filesArray = Array.from(selectedFiles)
    
    // Check max files
    if (multiple && maxFiles && filesArray.length > maxFiles) {
      filesArray.splice(maxFiles)
    }
    
    // Create file items with validation
    const newFileItems: FileItem[] = filesArray.map(file => {
      const error = validateFile(file)
      const item: FileItem = { file, error: error || undefined }
      
      // Generate preview for images
      if (showPreview && file.type.startsWith('image/')) {
        item.preview = URL.createObjectURL(file)
      }
      
      return item
    })
    
    // Update state
    if (multiple) {
      setFileItems(prev => [...prev, ...newFileItems])
    } else {
      setFileItems(newFileItems)
    }
    
    // Notify parent
    const validFiles = newFileItems
      .filter(item => !item.error)
      .map(item => item.file)
    onFilesChange(validFiles)
    
    // Auto-upload if handler provided
    if (onUpload) {
      for (const item of newFileItems) {
        if (!item.error) {
          uploadFile(item)
        }
      }
    }
  }, [multiple, maxFiles, showPreview, onFilesChange, onUpload])
  
  // Upload file
  const uploadFile = async (item: FileItem) => {
    if (!onUpload) return
    
    setFileItems(prev => prev.map(fi => 
      fi.file === item.file 
        ? { ...fi, uploading: true, progress: 0 }
        : fi
    ))
    
    try {
      // Simulate progress (real implementation would track actual progress)
      const progressInterval = setInterval(() => {
        setFileItems(prev => prev.map(fi => {
          if (fi.file === item.file && fi.uploading && (fi.progress || 0) < 90) {
            return { ...fi, progress: (fi.progress || 0) + 10 }
          }
          return fi
        }))
      }, 200)
      
      await onUpload(item.file)
      
      clearInterval(progressInterval)
      
      setFileItems(prev => prev.map(fi => 
        fi.file === item.file 
          ? { ...fi, uploading: false, uploaded: true, progress: 100 }
          : fi
      ))
    } catch (error) {
      setFileItems(prev => prev.map(fi => 
        fi.file === item.file 
          ? { ...fi, uploading: false, error: 'Upload failed' }
          : fi
      ))
    }
  }
  
  // Remove file
  const removeFile = (file: File) => {
    setFileItems(prev => prev.filter(item => item.file !== file))
    
    // Clean up preview URL
    const item = fileItems.find(i => i.file === file)
    if (item?.preview) {
      URL.revokeObjectURL(item.preview)
    }
    
    // Notify parent
    const remainingFiles = fileItems
      .filter(item => item.file !== file && !item.error)
      .map(item => item.file)
    onFilesChange(remainingFiles)
  }
  
  // Handle drag events
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!disabled) setIsDragging(true)
  }
  
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }
  
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    
    if (!disabled) {
      handleFiles(e.dataTransfer.files)
    }
  }
  
  // Handle click
  const handleClick = () => {
    if (!disabled) {
      fileInputRef.current?.click()
    }
  }
  
  // Get file icon
  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) {
      return <PhotoIcon className="h-5 w-5" />
    }
    return <DocumentIcon className="h-5 w-5" />
  }
  
  // Render upload area based on variant
  const renderUploadArea = () => {
    if (variant === 'button') {
      return (
        <button
          type="button"
          onClick={handleClick}
          disabled={disabled}
          className={cn(
            'inline-flex items-center px-4 py-2 border border-transparent',
            'text-sm font-medium rounded-md shadow-sm',
            'text-white bg-green-600 hover:bg-green-700',
            'focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500',
            'disabled:opacity-50 disabled:cursor-not-allowed',
            className
          )}
        >
          <CloudArrowUpIcon className="h-5 w-5 mr-2" />
          Upload Files
        </button>
      )
    }
    
    if (variant === 'compact') {
      return (
        <div
          onClick={handleClick}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={cn(
            'flex items-center justify-center px-6 py-4',
            'border-2 border-dashed rounded-lg cursor-pointer',
            'transition-colors',
            isDragging
              ? 'border-green-400 bg-green-50'
              : 'border-gray-300 hover:border-gray-400',
            disabled && 'opacity-50 cursor-not-allowed',
            className
          )}
        >
          <div className="text-center">
            <CloudArrowUpIcon className="mx-auto h-8 w-8 text-gray-400" />
            <p className="mt-1 text-sm text-gray-600">{uploadText}</p>
          </div>
        </div>
      )
    }
    
    // Default variant
    return (
      <div
        onClick={handleClick}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'flex justify-center px-6 pt-5 pb-6',
          'border-2 border-dashed rounded-lg cursor-pointer',
          'transition-colors',
          isDragging
            ? 'border-green-400 bg-green-50'
            : 'border-gray-300 hover:border-gray-400',
          disabled && 'opacity-50 cursor-not-allowed',
          className
        )}
      >
        <div className="space-y-1 text-center">
          <CloudArrowUpIcon className="mx-auto h-12 w-12 text-gray-400" />
          <div className="text-sm text-gray-600">
            <p className="font-medium">{uploadText}</p>
            {getUploadDescription() && (
              <p className="text-xs text-gray-500 mt-1">
                {getUploadDescription()}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="space-y-4">
      {/* Upload area */}
      {renderUploadArea()}
      
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
        className="sr-only"
        disabled={disabled}
        capture={enableCamera ? 'environment' : undefined}
      />
      
      {/* File list */}
      {fileItems.length > 0 && (
        <ul className="space-y-2">
          {fileItems.map((item, index) => (
            <li
              key={index}
              className={cn(
                'flex items-center p-3 rounded-lg border',
                item.error
                  ? 'border-red-300 bg-red-50'
                  : item.uploaded
                  ? 'border-green-300 bg-green-50'
                  : 'border-gray-200 bg-white'
              )}
            >
              {/* Preview/Icon */}
              {showPreview && item.preview ? (
                <img
                  src={item.preview}
                  alt={item.file.name}
                  className="h-10 w-10 rounded object-cover"
                />
              ) : (
                <div className={cn(
                  'flex items-center justify-center h-10 w-10 rounded',
                  item.error ? 'bg-red-100' : 'bg-gray-100'
                )}>
                  {getFileIcon(item.file)}
                </div>
              )}
              
              {/* File info */}
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {item.file.name}
                </p>
                <p className="text-xs text-gray-500">
                  {formatBytes(item.file.size)}
                  {item.error && (
                    <span className="text-red-600 ml-2">{item.error}</span>
                  )}
                </p>
                
                {/* Progress bar */}
                {showProgress && item.uploading && (
                  <ProgressBar
                    value={item.progress}
                    size="sm"
                    className="mt-1"
                  />
                )}
              </div>
              
              {/* Status/Actions */}
              <div className="ml-3">
                {item.uploading ? (
                  <Spinner size="sm" />
                ) : item.uploaded ? (
                  <CheckCircleIcon className="h-5 w-5 text-green-600" />
                ) : item.error ? (
                  <ExclamationCircleIcon className="h-5 w-5 text-red-600" />
                ) : (
                  <button
                    type="button"
                    onClick={() => removeFile(item.file)}
                    className="text-gray-400 hover:text-gray-500"
                  >
                    <XMarkIcon className="h-5 w-5" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * ImageUpload - Specialized component for image uploads with preview
 */
export function ImageUpload({
  onImageChange,
  currentImage,
  className,
  ...props
}: {
  onImageChange: (file: File | null) => void
  currentImage?: string | null
} & Omit<FileUploadProps, 'onFilesChange' | 'multiple' | 'accept'>) {
  const [preview, setPreview] = useState<string | null>(currentImage || null)
  
  const handleFilesChange = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0]
      const url = URL.createObjectURL(file)
      setPreview(url)
      onImageChange(file)
    }
  }
  
  const handleRemove = () => {
    if (preview && preview !== currentImage) {
      URL.revokeObjectURL(preview)
    }
    setPreview(null)
    onImageChange(null)
  }
  
  if (preview) {
    return (
      <div className={cn('relative inline-block', className)}>
        <img
          src={preview}
          alt="Upload preview"
          className="h-32 w-32 rounded-lg object-cover"
        />
        <button
          type="button"
          onClick={handleRemove}
          className="absolute -top-2 -right-2 p-1 bg-white rounded-full shadow-md hover:bg-gray-100"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      </div>
    )
  }
  
  return (
    <FileUpload
      {...props}
      accept="image/*"
      multiple={false}
      onFilesChange={handleFilesChange}
      variant="compact"
      uploadText="Upload Image"
      className={className}
    />
  )
}