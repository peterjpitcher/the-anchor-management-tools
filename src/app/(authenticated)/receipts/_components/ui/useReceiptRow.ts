'use client'

import { useState, useTransition } from 'react'
import { toast } from '@/ds'
import {
  deleteReceiptFile,
  getReceiptSignedUrl,
  getReceiptTransactionHistory,
  markReceiptTransaction,
  refreshReceiptInvoiceCopy,
  updateReceiptClassification,
  updateReceiptNote,
  type ClassificationRuleSuggestion,
  type ReceiptHistoryEntry,
} from '@/app/actions/receipts'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import { usePermissions } from '@/contexts/PermissionContext'
import { composeReceiptNote, splitReceiptNote } from '@/lib/receipts/note-format'
import type { ReceiptFile, ReceiptTransaction } from '@/types/database'
import {
  expenseChoiceValue,
  saveExpenseChoice,
  suggestionChoiceValue,
  type WorkspaceTransaction,
} from './expenseChoice'
import type { VendorConfirmationPrompt } from './NewVendorDialog'
import {
  cancelDuplicateReceiptUpload,
  confirmDuplicateReceiptUpload,
  receiptUploadErrorMessage,
  uploadReceiptFile,
  type DuplicateReceiptWarning,
  type PendingReceiptUpload,
  type UploadReceiptResult,
} from './receiptUploadClient'

type Status = ReceiptTransaction['status']

interface UseReceiptRowInput {
  transaction: WorkspaceTransaction
  vendorOptions: string[]
  /** The payment as it now stands. `previousStatus` is what the summary tiles count it away from. */
  onUpdate: (transaction: WorkspaceTransaction, previousStatus: Status) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

/**
 * Everything one payment in the list can do, for the table row and the phone card alike. The two
 * used to carry their own copies of these handlers and had drifted: the card could not undo a
 * failed status change, and the row could.
 */
export function useReceiptRow({ transaction, vendorOptions, onUpdate, onRuleSuggestion }: UseReceiptRowInput) {
  const { hasPermission } = usePermissions()
  const supabase = useSupabase()
  const canManage = hasPermission('receipts', 'manage')

  const [isPending, startTransition] = useTransition()

  const [editingField, setEditingField] = useState<'vendor' | 'expense' | null>(null)
  const [classificationDraft, setClassificationDraft] = useState('')
  const [isCustomVendor, setIsCustomVendor] = useState(false)
  const [vendorPrompt, setVendorPrompt] = useState<VendorConfirmationPrompt | null>(null)

  const [reasonPromptOpen, setReasonPromptOpen] = useState(false)
  const [reasonDraft, setReasonDraft] = useState('')

  const [duplicatePrompt, setDuplicatePrompt] = useState<{
    warning: DuplicateReceiptWarning
    pending: PendingReceiptUpload
  } | null>(null)
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)

  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')

  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ReceiptHistoryEntry[] | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)

  /** A change from the server laid over the row, keeping what only the list knows. */
  function merged(changes: Partial<WorkspaceTransaction>): WorkspaceTransaction {
    return {
      ...transaction,
      ...changes,
      files: changes.files ?? transaction.files,
      autoRule: transaction.autoRule,
      aiSuggestion: 'aiSuggestion' in changes ? changes.aiSuggestion : transaction.aiSuggestion,
      aiNote: 'aiNote' in changes ? changes.aiNote : transaction.aiNote,
    }
  }

  // ---- status ---------------------------------------------------------------------------------

  function runStatusUpdate(status: Status, reason?: string) {
    const snapshot = transaction
    // Shown at once, and put back exactly as it was if the server says no.
    onUpdate(merged({ status }), snapshot.status)

    startTransition(async () => {
      const result = await markReceiptTransaction({ transactionId: snapshot.id, status, reason: reason ?? null })

      if (result?.error || !result?.transaction) {
        onUpdate(snapshot, status)
        if (result && 'reasonRequired' in result && result.reasonRequired) {
          // Its file went while this was on screen: ask for the reason after all.
          setReasonPromptOpen(true)
          return
        }
        toast.error(result?.error ?? 'Update failed')
        return
      }

      setReasonPromptOpen(false)
      setReasonDraft('')
      // Counted from the status already shown, not from the one before it: the tiles were moved
      // when the change was shown, and counting from the old status again moved them twice.
      onUpdate(merged(result.transaction as ReceiptTransaction), status)
    })
  }

  /** Completed means a file, or a written reason. With no file, the reason is asked for first. */
  function updateStatus(status: Status) {
    if (!canManage) return
    if (status === 'completed' && transaction.files.length === 0) {
      setReasonDraft(transaction.completed_reason ?? '')
      setReasonPromptOpen(true)
      return
    }
    runStatusUpdate(status)
  }

  function submitReason() {
    if (!canManage) return
    const reason = reasonDraft.trim()
    if (!reason) {
      toast.error('Say why there is no receipt, or attach one.')
      return
    }
    runStatusUpdate('completed', reason)
  }

  function cancelReason() {
    setReasonPromptOpen(false)
    setReasonDraft('')
  }

  // ---- files ----------------------------------------------------------------------------------

  function settleUpload(result: UploadReceiptResult) {
    if (result.duplicate && result.pending) {
      setDuplicatePrompt({ warning: result.duplicate, pending: result.pending })
      return
    }
    if (result.error || !result.receipt) {
      toast.error(result.error ?? 'Upload failed')
      return
    }
    setDuplicatePrompt(null)
    onUpdate(
      merged({ status: 'completed', receipt_required: false, files: [...transaction.files, result.receipt as ReceiptFile] }),
      transaction.status
    )
    toast.success('Receipt uploaded')
  }

  function upload(files: File[]) {
    if (!canManage) return
    const file = files[0]
    if (!file) return

    startTransition(async () => {
      try {
        settleUpload(await uploadReceiptFile({ supabase, transactionId: transaction.id, file }))
      } catch (error) {
        console.error('Receipt upload failed', error)
        toast.error(receiptUploadErrorMessage(error))
      }
    })
  }

  /** The person has read the warning and wants the file on this payment too. */
  function confirmDuplicate() {
    if (!canManage || !duplicatePrompt) return
    const { pending } = duplicatePrompt
    startTransition(async () => {
      try {
        const result = await confirmDuplicateReceiptUpload(pending)
        if (result.duplicate) {
          // Still reported after confirming: treat it as a failure, never a loop.
          setDuplicatePrompt(null)
          toast.error('The file could not be attached. Please upload it again.')
          return
        }
        settleUpload(result)
        if (result.error) setDuplicatePrompt(null)
      } catch (error) {
        console.error('Confirming a duplicate receipt failed', error)
        toast.error(receiptUploadErrorMessage(error))
      }
    })
  }

  function cancelDuplicate() {
    if (!duplicatePrompt) return
    const { pending } = duplicatePrompt
    setDuplicatePrompt(null)
    startTransition(async () => {
      try {
        await cancelDuplicateReceiptUpload(pending)
        toast.success('Nothing was attached')
      } catch (error) {
        // The stored file is swept up later if this did not remove it.
        console.error('Cancelling a duplicate receipt upload failed', error)
      }
    })
  }

  function deleteFile(fileId: string) {
    if (!canManage) return
    startTransition(async () => {
      const result = await deleteReceiptFile(fileId)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      const remaining = transaction.files.filter((file) => file.id !== fileId)
      onUpdate(
        merged({
          // The server decides where the payment goes when its last file is removed.
          status: (result && 'newStatus' in result && result.newStatus) || transaction.status,
          files: remaining,
        }),
        transaction.status
      )
      setDeleteFileId(null)
      toast.success('Receipt removed')
    })
  }

  async function openFile(fileId: string, options: { download?: boolean } = {}) {
    try {
      const result = await getReceiptSignedUrl(fileId, options)
      if (result?.url) {
        window.open(result.url, '_blank', 'noopener')
        return
      }
      toast.error(result?.error ?? 'The file could not be opened.')
    } catch (error) {
      console.error('Opening a receipt file failed', error)
      toast.error('The file could not be opened.')
    }
  }

  function refreshInvoiceCopy(fileId: string) {
    if (!canManage) return
    startTransition(async () => {
      const result = await refreshReceiptInvoiceCopy(fileId)
      if (result?.error || !result?.receipt) {
        toast.error(result?.error ?? 'The copy could not be refreshed.')
        return
      }
      const refreshed = result.receipt as ReceiptFile
      onUpdate(
        merged({ files: transaction.files.map((file) => (file.id === refreshed.id ? refreshed : file)) }),
        transaction.status
      )
      toast.success('Invoice copy refreshed')
    })
  }

  // ---- vendor and category ----------------------------------------------------------------------

  function startEditing(field: 'vendor' | 'expense') {
    if (!canManage) return
    setEditingField(field)
    if (field === 'vendor') {
      const value = transaction.vendor_name ?? ''
      setClassificationDraft(value)
      setIsCustomVendor(value.length > 0 && !vendorOptions.includes(value))
    } else {
      setClassificationDraft(expenseChoiceValue(transaction))
    }
  }

  function cancelEditing() {
    setEditingField(null)
    setVendorPrompt(null)
  }

  /** "Change" on a suggestion: the category picker, starting on what was suggested. */
  function startChangingSuggestion() {
    if (!canManage || !transaction.aiSuggestion) return
    setEditingField('expense')
    setClassificationDraft(suggestionChoiceValue(transaction.aiSuggestion))
  }

  /** The suggestion has been accepted or dismissed. */
  function closeSuggestion(updated?: ReceiptTransaction) {
    onUpdate(merged({ ...(updated ?? {}), aiSuggestion: null }), transaction.status)
  }

  function saveExpense() {
    startTransition(async () => {
      const result = await saveExpenseChoice(transaction, classificationDraft)
      if (result.transaction || result.suggestionClosed) {
        onUpdate(
          merged({
            ...(result.transaction ?? {}),
            aiSuggestion: result.suggestionClosed ? null : transaction.aiSuggestion,
          }),
          transaction.status
        )
      }
      if (result.error) {
        toast.error(result.error)
        if (result.suggestionClosed) setEditingField(null)
        return
      }
      if (result.ruleSuggestion) onRuleSuggestion(result.ruleSuggestion)
      setEditingField(null)
      toast.success('Updated')
    })
  }

  /**
   * `vendorName` and `createVendor` come from the new-vendor dialog: use an existing vendor
   * instead of the typed name, or confirm that the typed name is a new vendor.
   */
  function saveClassification(options: { vendorName?: string; createVendor?: boolean } = {}) {
    if (!canManage) return
    if (editingField === 'expense') {
      saveExpense()
      return
    }

    const draft = (options.vendorName ?? classificationDraft).trim()
    startTransition(async () => {
      const result = await updateReceiptClassification({
        transactionId: transaction.id,
        vendorName: draft.length ? draft : null,
        ...(options.createVendor ? { createVendor: true } : {}),
      })
      if (result?.error) {
        toast.error(result.error)
        return
      }
      // The name is not on the vendor list. Nothing was saved: ask before adding a vendor.
      if (result?.vendorConfirmation) {
        setVendorPrompt(result.vendorConfirmation)
        return
      }
      setVendorPrompt(null)
      if (result?.transaction) onUpdate(merged(result.transaction), transaction.status)
      if (result?.ruleSuggestion) onRuleSuggestion(result.ruleSuggestion)
      setEditingField(null)
      toast.success('Updated')
    })
  }

  // ---- note -------------------------------------------------------------------------------------

  const note = splitReceiptNote(transaction.notes)

  function startNoteEdit() {
    if (!canManage) return
    setNoteDraft(note.text)
    setIsEditingNote(true)
  }

  function saveNote() {
    if (!canManage) return
    if (noteDraft.trim() === note.text) {
      setIsEditingNote(false)
      return
    }
    const stored = composeReceiptNote(noteDraft)

    startTransition(async () => {
      const result = await updateReceiptNote({ transactionId: transaction.id, note: stored.length ? stored : null })
      if (result?.error || !result?.transaction) {
        toast.error(result?.error ?? 'Failed to save the note')
        return
      }
      onUpdate(merged(result.transaction as ReceiptTransaction), transaction.status)
      setIsEditingNote(false)
      toast.success('Note saved')
    })
  }

  // ---- history ----------------------------------------------------------------------------------

  function openHistory() {
    setHistoryOpen(true)
    setHistory(null)
    setHistoryError(null)
    void getReceiptTransactionHistory(transaction.id)
      .then((result) => {
        if (result.error || !result.entries) {
          setHistoryError(result.error ?? 'The history could not be loaded.')
          return
        }
        setHistory(result.entries)
      })
      .catch((error) => {
        console.error('Loading a transaction history failed', error)
        setHistoryError('The history could not be loaded.')
      })
  }

  return {
    canManage,
    isPending,
    // status
    updateStatus,
    reasonPromptOpen,
    reasonDraft,
    setReasonDraft,
    submitReason,
    cancelReason,
    // files
    upload,
    duplicatePrompt,
    confirmDuplicate,
    cancelDuplicate,
    deleteFileId,
    setDeleteFileId,
    deleteFile,
    openFile,
    refreshInvoiceCopy,
    // vendor and category
    editingField,
    classificationDraft,
    setClassificationDraft,
    isCustomVendor,
    setIsCustomVendor,
    vendorPrompt,
    setVendorPrompt,
    startEditing,
    cancelEditing,
    startChangingSuggestion,
    closeSuggestion,
    saveClassification,
    // note
    note,
    isEditingNote,
    setIsEditingNote,
    noteDraft,
    setNoteDraft,
    startNoteEdit,
    saveNote,
    // history
    historyOpen,
    closeHistory: () => setHistoryOpen(false),
    openHistory,
    history,
    historyError,
  }
}

export type ReceiptRowState = ReturnType<typeof useReceiptRow>
