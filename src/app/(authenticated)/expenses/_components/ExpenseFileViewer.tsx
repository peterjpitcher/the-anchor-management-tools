'use client'

import { useState, useEffect, useCallback } from 'react'
import { Alert, Button, LinkButton, Modal } from '@/ds'

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
 * Lightbox viewer for expense receipt images and PDFs, built on the DS Modal, which traps
 * focus, locks the page scroll and closes on Escape or a click on the backdrop.
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

  // Arrow keys step through the files. Escape is handled by the Modal.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        setCurrentIndex((i) => i - 1)
      } else if (e.key === 'ArrowRight' && currentIndex < files.length - 1) {
        setCurrentIndex((i) => i + 1)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [currentIndex, files.length])

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
    <Modal
      open
      onClose={onClose}
      title={currentFile.file_name}
      width="xl"
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          {files.length > 1 && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCurrentIndex((i) => i - 1)}
                disabled={currentIndex === 0}
                aria-label="Previous file"
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setCurrentIndex((i) => i + 1)}
                disabled={currentIndex === files.length - 1}
                aria-label="Next file"
              >
                Next
              </Button>
              <span className="text-xs text-text-muted">
                {currentIndex + 1} of {files.length}
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            {onDelete && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
                className="text-danger hover:bg-danger-soft"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            )}
            {currentFile.signed_url && (
              <LinkButton
                href={currentFile.signed_url}
                target="_blank"
                rel="noopener noreferrer"
                variant="ghost"
                size="sm"
                className="text-primary hover:bg-primary-soft"
              >
                Open
              </LinkButton>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={onClose} aria-label="Close viewer">
              Close
            </Button>
          </div>
        </div>
      }
    >
      {deleteError && (
        <Alert tone="danger" size="sm" className="mb-3">
          {deleteError}
        </Alert>
      )}

      {isImage && currentFile.signed_url && (
        <img
          src={currentFile.signed_url}
          alt={currentFile.file_name}
          className="mx-auto max-h-[70vh] max-w-full rounded-sm object-contain"
        />
      )}
      {isPdf && currentFile.signed_url && (
        <iframe
          src={currentFile.signed_url}
          title={currentFile.file_name}
          className="h-[70vh] w-full rounded-sm border-0"
        />
      )}
      {!currentFile.signed_url && (
        <p className="text-center text-sm text-text-muted">
          Unable to load file preview. The signed URL may have expired.
        </p>
      )}
    </Modal>
  )
}
