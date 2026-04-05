'use client'

import { useState, useRef, useCallback, type FormEvent, type DragEvent } from 'react'
import { formatDateInLondon } from '@/lib/dateUtils'

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
      {error && (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Date + Company */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="expense_date" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Date <span className="text-red-500">*</span>
          </label>
          <input
            id="expense_date"
            type="date"
            required
            value={expenseDate}
            onChange={(e) => setExpenseDate(e.target.value)}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div>
          <label htmlFor="company_ref" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Company / Ref <span className="text-red-500">*</span>
          </label>
          <input
            id="company_ref"
            type="text"
            required
            maxLength={200}
            value={companyRef}
            onChange={(e) => setCompanyRef(e.target.value)}
            placeholder="e.g. Costco, B&Q"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      {/* Justification */}
      <div>
        <label htmlFor="justification" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Justification <span className="text-red-500">*</span>
        </label>
        <input
          id="justification"
          type="text"
          required
          maxLength={500}
          value={justification}
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Why was this expense incurred?"
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {/* Amount + VAT */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Amount (£) <span className="text-red-500">*</span>
          </label>
          <input
            id="amount"
            type="number"
            required
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={vatApplicable}
              onChange={(e) => {
                setVatApplicable(e.target.checked)
                if (!e.target.checked) setVatAmount('0')
              }}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            VAT Applicable
          </label>
        </div>
        {vatApplicable && (
          <div>
            <label htmlFor="vat_amount" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              VAT Amount (£)
            </label>
            <input
              id="vat_amount"
              type="number"
              min="0"
              step="0.01"
              value={vatAmount}
              onChange={(e) => setVatAmount(e.target.value)}
              placeholder="0.00"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional notes..."
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </div>

      {/* Receipt upload */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Receipt Images
        </label>

        {/* Existing files (edit mode) */}
        {existingFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {existingFiles.map((file) => (
              <div
                key={file.id}
                className="group relative flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800"
              >
                {file.mime_type.startsWith('image/') && file.signed_url ? (
                  <img
                    src={file.signed_url}
                    alt={file.file_name}
                    className="h-10 w-10 rounded object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded bg-gray-200 text-xs font-medium text-gray-500 dark:bg-gray-700 dark:text-gray-400">
                    PDF
                  </span>
                )}
                <span className="max-w-[120px] truncate">{file.file_name}</span>
                {onDeleteFile && (
                  <button
                    type="button"
                    disabled={deletingFileId === file.id}
                    onClick={() => handleDeleteExistingFile(file.id)}
                    className="ml-1 text-red-500 hover:text-red-700 disabled:opacity-50"
                    aria-label={`Delete ${file.file_name}`}
                  >
                    {deletingFileId === file.id ? '...' : '\u00d7'}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Drop zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
            isDragging
              ? 'border-blue-400 bg-blue-50 dark:border-blue-500 dark:bg-blue-900/20'
              : 'border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500'
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
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Drag and drop receipt images here, or click to browse
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
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
                className="flex items-center justify-between rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-800"
              >
                <span className="truncate">{file.name}</span>
                <button
                  type="button"
                  onClick={() => removePendingFile(idx)}
                  className="ml-2 text-red-500 hover:text-red-700"
                  aria-label={`Remove ${file.name}`}
                >
                  {'\u00d7'}
                </button>
              </div>
            ))}
          </div>
        )}

        {fileError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">{fileError}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-4 dark:border-gray-700">
        <button
          type="button"
          onClick={onCancel}
          disabled={isLoading}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isLoading
            ? uploading
              ? 'Uploading files...'
              : 'Saving...'
            : isEditing
              ? 'Update Expense'
              : 'Create Expense'}
        </button>
      </div>
    </form>
  )
}
