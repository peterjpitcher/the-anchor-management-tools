'use client'

import { useState, useRef, useCallback, type FormEvent, type DragEvent } from 'react'
import { formatDateInLondon } from '@/lib/dateUtils'
import { X } from 'lucide-react'
import { Alert, Button, Checkbox, Field, IconButton, Input, Textarea } from '@/ds'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpenseFormData {
  id?: string
  expense_date: string
  company_ref: string
  justification: string
  amount: number
  vat_applicable: boolean
  vat_amount: number
  notes: string
}

export interface ExistingFile {
  id: string
  file_name: string
  mime_type: string
  signed_url?: string
}

interface ExpenseFormProps {
  /** Initial values for editing, or undefined for create */
  initialData?: ExpenseFormData
  /** Existing files when editing */
  existingFiles?: ExistingFile[]
  /** Called when the form is submitted with field values. Returns createdId for new expenses. */
  onSubmit: (data: ExpenseFormData) => Promise<{ success?: boolean; error?: string; createdId?: string }>
  /** Called when files are selected for upload. Optional expenseId for newly created expenses. */
  onUploadFiles?: (files: File[], expenseId?: string) => Promise<{ success?: boolean; error?: string }>
  /** Called when an existing file should be deleted */
  onDeleteFile?: (fileId: string) => Promise<{ success?: boolean; error?: string }>
  /** Called when the form should close/cancel */
  onCancel: () => void
  /** Whether the form is in edit mode */
  isEditing?: boolean
}

const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf'
const ACCEPTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'])
const MAX_FILE_SIZE_MB = 20
const MAX_FILES_PER_EXPENSE = 10

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ExpenseForm({
  initialData,
  existingFiles = [],
  onSubmit,
  onUploadFiles,
  onDeleteFile,
  onCancel,
  isEditing = false,
}: ExpenseFormProps): React.JSX.Element {
  // Form state
  const [expenseDate, setExpenseDate] = useState(initialData?.expense_date ?? '')
  const [companyRef, setCompanyRef] = useState(initialData?.company_ref ?? '')
  const [justification, setJustification] = useState(initialData?.justification ?? '')
  const [amount, setAmount] = useState(initialData?.amount?.toString() ?? '')
  const [vatApplicable, setVatApplicable] = useState(initialData?.vat_applicable ?? false)
  const [vatAmount, setVatAmount] = useState(initialData?.vat_amount?.toString() ?? '0')
  const [notes, setNotes] = useState(initialData?.notes ?? '')

  // File state
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [deletingFileId, setDeletingFileId] = useState<string | null>(null)

  const handleFilesSelected = useCallback((files: FileList | File[]) => {
    const validFiles: File[] = []
    const fileArray = Array.from(files)

    // Check total count limit (existing + already pending + new)
    const currentTotal = existingFiles.length + pendingFiles.length
    if (currentTotal + fileArray.length > MAX_FILES_PER_EXPENSE) {
      setFileError(
        `Maximum ${MAX_FILES_PER_EXPENSE} files per expense. You already have ${currentTotal} — can only add ${Math.max(0, MAX_FILES_PER_EXPENSE - currentTotal)} more.`
      )
      return
    }

    for (const file of fileArray) {
      // Validate file extension
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      if (!ACCEPTED_EXTENSIONS.has(ext)) {
        setFileError(`"${file.name}" is not a supported file type. Accepted: JPEG, PNG, WebP, HEIC, PDF.`)
        return
      }

      if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        setFileError(`"${file.name}" exceeds ${MAX_FILE_SIZE_MB}MB limit`)
        return
      }
      validFiles.push(file)
    }

    setFileError(null)
    setPendingFiles((prev) => [...prev, ...validFiles])
  }, [existingFiles.length, pendingFiles.length])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        handleFilesSelected(e.dataTransfer.files)
      }
    },
    [handleFilesSelected]
  )

  const removePendingFile = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleDeleteExistingFile = useCallback(
    async (fileId: string) => {
      if (!onDeleteFile) return
      if (!confirm('Delete this receipt file?')) return

      setDeletingFileId(fileId)
      try {
        const result = await onDeleteFile(fileId)
        if (result.error) {
          setFileError(result.error)
        }
      } finally {
        setDeletingFileId(null)
      }
    },
    [onDeleteFile]
  )

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    try {
      const parsedAmount = parseFloat(amount)
      const parsedVat = parseFloat(vatAmount)

      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        setError('Amount must be greater than 0')
        return
      }
      if (vatApplicable && (isNaN(parsedVat) || parsedVat < 0)) {
        setError('VAT amount must be 0 or greater')
        return
      }

      const data: ExpenseFormData = {
        id: initialData?.id,
        expense_date: expenseDate,
        company_ref: companyRef.trim(),
        justification: justification.trim(),
        amount: parsedAmount,
        vat_applicable: vatApplicable,
        vat_amount: vatApplicable ? parsedVat : 0,
        notes: notes.trim(),
      }

      const result = await onSubmit(data)
      if (result.error) {
        setError(result.error)
        return
      }

      // Upload pending files if any — pass createdId directly to avoid stale closure
      if (pendingFiles.length > 0 && onUploadFiles) {
        setUploading(true)
        const uploadResult = await onUploadFiles(pendingFiles, result.createdId)
        if (uploadResult.error) {
          setFileError(uploadResult.error)
          // Don't return — expense was already saved
        }
        setUploading(false)
      }

      // Success — parent handles closing
    } finally {
      setSubmitting(false)
    }
  }

  const isLoading = submitting || uploading

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}

      {/* Date + Company */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Date" required>
          <Input
            id="expense_date"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
          />
        </Field>
        <Field label="Company / Ref" required>
          <Input
            id="company_ref"
            type="text"
            required
            maxLength={200}
            value={companyRef}
            onChange={(e) => setCompanyRef(e.target.value)}
            placeholder="e.g. Costco, B&Q"
          />
        </Field>
      </div>

      {/* Justification */}
      <Field label="Justification" required>
        <Input
          id="justification"
          type="text"
          required
          maxLength={500}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Why was this expense incurred?"
        />
      </Field>

      {/* Amount + VAT */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Amount (£)" required>
          <Input
            id="amount"
            type="number"
            required
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <div className="flex items-end pb-2">
          <Checkbox
            label="VAT Applicable"
            checked={vatApplicable}
            onChange={(checked) => {
              setVatApplicable(checked)
              if (!checked) setVatAmount('0')
            }}
          />
        </div>
        {vatApplicable && (
          <Field label="VAT Amount (£)">
            <Input
              id="vat_amount"
              type="number"
              min="0"
              step="0.01"
              value={vatAmount}
              onChange={(e) => setVatAmount(e.target.value)}
              placeholder="0.00"
            />
          </Field>
        )}
      </div>

      {/* Notes */}
      <Field label="Notes">
        <Textarea
          id="notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes..."
        />
      </Field>

      {/* Receipt upload */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-text-muted">
          Receipt Images
        </p>

        {/* Existing files (edit mode) */}
        {existingFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {existingFiles.map((file) => (
              <div
                key={file.id}
                className="group relative flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
              >
                {file.mime_type.startsWith('image/') && file.signed_url ? (
                  <img
                    src={file.signed_url}
                    alt={file.file_name}
                    className="h-10 w-10 rounded-sm object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-sm bg-border text-xs font-medium text-text-muted">
                    PDF
                  </span>
                )}
                <span className="max-w-[120px] truncate">{file.file_name}</span>
                {onDeleteFile && (
                  <IconButton
                    type="button"
                    size="sm"
                    disabled={deletingFileId === file.id}
                    loading={deletingFileId === file.id}
                    onClick={() => handleDeleteExistingFile(file.id)}
                    label={`Delete ${file.file_name}`}
                    icon={<X className="h-4 w-4" aria-hidden="true" />}
                    className="ml-1 text-danger hover:text-danger-fg"
                  />
                )}
              </div>
            ))}
          </div>
        )}

        {/* Drop zone: same look as the DS FileUpload. Kept local because this one reports
            rejected files and resets the input so the same file can be picked again. */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors focus-visible:outline-hidden focus-visible:shadow-ring ${
            isDragging
              ? 'border-primary bg-primary-soft'
              : 'border-border hover:border-border-strong'
          }`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileInputRef.current?.click()
            }
          }}
        >
          <p className="text-sm text-text-muted">
            Drag and drop receipt images here, or click to browse
          </p>
          <p className="mt-1 text-xs text-text-soft">
            JPEG, PNG, WebP, HEIC, PDF — max {MAX_FILE_SIZE_MB}MB each
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) {
                handleFilesSelected(e.target.files)
                e.target.value = '' // Reset so the same file can be re-selected
              }
            }}
          />
        </div>

        {/* Pending files */}
        {pendingFiles.length > 0 && (
          <div className="mt-3 space-y-1">
            {pendingFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 text-sm"
              >
                <span className="truncate">{file.name}</span>
                <IconButton
                  type="button"
                  size="sm"
                  onClick={() => removePendingFile(idx)}
                  label={`Remove ${file.name}`}
                  icon={<X className="h-4 w-4" aria-hidden="true" />}
                  className="ml-2 text-danger hover:text-danger-fg"
                />
              </div>
            ))}
          </div>
        )}

        {fileError && (
          <p className="mt-2 text-sm text-danger">{fileError}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={isLoading}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isLoading}>
          {isLoading
            ? uploading
              ? 'Uploading files...'
              : 'Saving...'
            : isEditing
              ? 'Update Expense'
              : 'Create Expense'}
        </Button>
      </div>
    </form>
  )
}
