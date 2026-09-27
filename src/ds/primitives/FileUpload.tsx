'use client'

import { useCallback, useId, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface FileUploadProps {
  accept?: string
  maxSize?: number
  onFiles: (files: File[]) => void
  hint?: string
  className?: string
  /**
   * Goes on the drop zone, which is a real button, so a Field (or a <label htmlFor>) names
   * it and clicking that label opens the file picker.
   */
  id?: string
  /** Joins the zone's own hint, for a Field's hint or error. */
  'aria-describedby'?: string
  disabled?: boolean
}

const UploadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
  id,
  'aria-describedby': ariaDescribedBy,
  disabled = false,
}: FileUploadProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const hintId = `${useId()}-hint`

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || disabled) return
      const files = Array.from(fileList).filter(
        (f) => !maxSize || f.size <= maxSize
      )
      if (files.length > 0) onFiles(files)
    },
    [disabled, maxSize, onFiles]
  )

  // With an id, a label outside names the zone, so the zone's own hint is read as its
  // description. Without one, the zone is named by its own text, hint included.
  const describedBy = [id && hint ? hintId : null, ariaDescribedBy].filter(Boolean).join(' ') || undefined

  return (
    // The wrapper keeps the file input out of the button (a button may not contain another
    // control). The input comes first and is display: none, so it never takes a gap or the
    // spacing a parent gives its last child.
    <div>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => handleFiles(e.target.files)}
        multiple
      />
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-describedby={describedBy}
        className={cn(
          'block w-full border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
          'focus-visible:outline-hidden focus-visible:shadow-ring',
          dragging
            ? 'border-primary bg-primary-soft'
            : 'border-border hover:border-border-strong',
          disabled && 'cursor-not-allowed opacity-50 hover:border-border',
          className
        )}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          handleFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <span className="flex flex-col items-center gap-2 text-text-muted">
          <UploadIcon />
          <span className="block text-sm font-medium">Drag files here or click to browse</span>
          {hint && <span id={hintId} className="block text-xs text-text-soft">{hint}</span>}
        </span>
      </button>
    </div>
  )
}
