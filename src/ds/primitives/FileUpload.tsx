'use client'

import { useState, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

interface FileUploadProps {
  accept?: string
  maxSize?: number
  onFiles: (files: File[]) => void
  hint?: string
  className?: string
}

const UploadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
)

export function FileUpload({
  accept,
  maxSize,
  onFiles,
  hint,
  className,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return
      const files = Array.from(fileList).filter(
        (f) => !maxSize || f.size <= maxSize
      )
      if (files.length > 0) onFiles(files)
    },
    [maxSize, onFiles]
  )

  return (
    <div
      className={cn(
        'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
        dragging
          ? 'border-primary bg-primary-soft'
          : 'border-border hover:border-border-strong',
        className
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
        multiple
      />
      <div className="flex flex-col items-center gap-2 text-text-muted">
        <UploadIcon />
        <p className="text-sm font-medium">Drag files here or click to browse</p>
        {hint && <p className="text-xs text-text-subtle">{hint}</p>}
      </div>
    </div>
  )
}
