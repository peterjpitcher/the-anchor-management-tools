'use client'

import { useState, useEffect, useCallback } from 'react'

interface ExpenseFileViewerFile {
  id: string
  file_name: string
  mime_type: string
  signed_url?: string
}

interface ExpenseFileViewerProps {
  files: ExpenseFileViewerFile[]
  /** Index of the file to show initially */
  initialIndex?: number
  /** Called when the viewer should close */
  onClose: () => void
  /** Called to delete a file (returns error message or undefined) */
  onDelete?: (fileId: string) => Promise<{ error?: string }>
}

/**
 * Lightbox viewer for expense receipt images and PDFs.
 * Traps focus within the modal and closes on Escape.
 */
export function ExpenseFileViewer({
  files,
  initialIndex = 0,
  onClose,
  onDelete,
}: ExpenseFileViewerProps): React.JSX.Element | null {
  const [currentIndex, setCurrentIndex] = useState(initialIndex)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const currentFile = files[currentIndex]

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((i) => i - 1)
      } else if (e.key === 'ArrowRight' && currentIndex < files.length - 1) {
        setCurrentIndex((i) => i + 1)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, currentIndex, files.length])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const handleDelete = useCallback(async () => {
    if (!onDelete || !currentFile) return
    if (!confirm(`Delete "${currentFile.file_name}"?`)) return

    setDeleting(true)
    setDeleteError(null)
    try {
      const result = await onDelete(currentFile.id)
      if (result.error) {
        setDeleteError(result.error)
      } else {
        // If we deleted the last file, close the viewer
        if (files.length <= 1) {
          onClose()
        } else if (currentIndex >= files.length - 1) {
          setCurrentIndex((i) => Math.max(0, i - 1))
        }
      }
    } finally {
      setDeleting(false)
    }
  }, [onDelete, currentFile, currentIndex, files.length, onClose])

  if (!currentFile) return null

  const isPdf = currentFile.mime_type === 'application/pdf'
  const isImage = currentFile.mime_type.startsWith('image/')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Receipt file viewer"
    >
      <div className="relative flex max-h-[90vh] max-w-4xl flex-col rounded-lg bg-white shadow-xl dark:bg-gray-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {currentFile.file_name}
            </span>
            {files.length > 1 && (
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {currentIndex + 1} of {files.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {onDelete && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-900/20"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            )}
            {currentFile.signed_url && (
              <a
                href={currentFile.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded px-2 py-1 text-sm text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                Open
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="Close viewer"
            >
              {'\u00d7'}
            </button>
          </div>
        </div>

        {/* Error */}
        {deleteError && (
          <div className="bg-red-50 px-4 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {deleteError}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {isImage && currentFile.signed_url && (
            <img
              src={currentFile.signed_url}
              alt={currentFile.file_name}
              className="mx-auto max-h-[70vh] rounded object-contain"
            />
          )}
          {isPdf && currentFile.signed_url && (
            <iframe
              src={currentFile.signed_url}
              title={currentFile.file_name}
              className="h-[70vh] w-full rounded border-0"
            />
          )}
          {!currentFile.signed_url && (
            <p className="text-center text-sm text-gray-500 dark:text-gray-400">
              Unable to load file preview. The signed URL may have expired.
            </p>
          )}
        </div>

        {/* Navigation arrows */}
        {files.length > 1 && (
          <div className="flex items-center justify-center gap-4 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i - 1)}
              disabled={currentIndex === 0}
              className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="Previous file"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setCurrentIndex((i) => i + 1)}
              disabled={currentIndex === files.length - 1}
              className="rounded px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 disabled:opacity-30 dark:text-gray-400 dark:hover:bg-gray-800"
              aria-label="Next file"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
