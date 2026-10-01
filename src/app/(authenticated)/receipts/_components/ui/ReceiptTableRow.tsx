'use client'

import { useState, useTransition, useRef } from 'react'
import { NewVendorDialog, type VendorConfirmationPrompt } from './NewVendorDialog'
import { Badge, Button, ConfirmDialog, FileButton, IconButton, Input, Select, toast, Icon } from '@/ds'
import {
  markReceiptTransaction,
  updateReceiptNote,
  deleteReceiptFile,
  getReceiptSignedUrl,
  updateReceiptClassification,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import type { ReceiptTransaction, ReceiptFile, ReceiptClassificationSource } from '@/types/database'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatCurrency, formatDate } from '@/app/(authenticated)/receipts/utils'
import {
  RECEIPT_CLASSIFICATION_SOURCE_LABEL,
  RECEIPT_CLASSIFICATION_SOURCE_TONE,
  RECEIPT_SOURCE_LABEL,
  RECEIPT_SOURCE_TONE,
  RECEIPT_STATUS_LABEL,
  RECEIPT_STATUS_TONE,
} from '@/app/(authenticated)/receipts/_shared/status-ui'
import { RECEIPT_UPLOAD_ACCEPT, receiptUploadErrorMessage, uploadReceiptFile } from './receiptUploadClient'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import { AiCategorySuggestion } from './AiCategorySuggestion'
import {
  EXPENSE_CHOICE_OPTIONS,
  expenseChoiceLabel,
  expenseChoiceValue,
  saveExpenseChoice,
  suggestionChoiceValue,
  type WorkspaceTransaction,
} from './expenseChoice'

export function SourceBadge({ sourceType }: { sourceType: ReceiptTransaction['source_type'] }) {
  const source = sourceType === 'amex' ? 'amex' : 'bank'
  return (
    <Badge tone={RECEIPT_SOURCE_TONE[source]} size="sm">
      {RECEIPT_SOURCE_LABEL[source]}
    </Badge>
  )
}

function ClassificationBadge({ source }: { source?: ReceiptClassificationSource | null }) {
  if (!source || source === 'manual') return null
  return (
    <Badge tone={RECEIPT_CLASSIFICATION_SOURCE_TONE[source] ?? 'neutral'} size="sm">
      {RECEIPT_CLASSIFICATION_SOURCE_LABEL[source] ?? source}
    </Badge>
  )
}

interface ReceiptTableRowProps {
  transaction: WorkspaceTransaction
  vendorOptions: string[]
  heatColour?: string
  onUpdate: (transaction: WorkspaceTransaction, previousStatus: ReceiptTransaction['status']) => void
  onRemove: (id: string, previousStatus: ReceiptTransaction['status'], nextStatus?: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

export function ReceiptTableRow({
  transaction,
  vendorOptions,
  heatColour,
  onUpdate,
  onRemove,
  onRuleSuggestion,
}: ReceiptTableRowProps) {
  const { hasPermission } = usePermissions()
  const supabase = useSupabase()
  const canManageReceipts = hasPermission('receipts', 'manage')

  const [isPending, startTransition] = useTransition()
  const [editingField, setEditingField] = useState<'vendor' | 'expense' | null>(null)
  const [classificationDraft, setClassificationDraft] = useState('')
  const [isCustomVendor, setIsCustomVendor] = useState(false)
  const [vendorPrompt, setVendorPrompt] = useState<VendorConfirmationPrompt | null>(null)
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)

  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const noteInputRef = useRef<HTMLInputElement>(null)

  async function handleStatusUpdate(status: ReceiptTransaction['status']) {
    if (!canManageReceipts) return
    const previousStatus = transaction.status
    onUpdate({
      ...transaction,
      status,
      files: transaction.files,
      autoRule: transaction.autoRule,
    }, previousStatus)
    startTransition(async () => {
      const result = await markReceiptTransaction({
        transactionId: transaction.id,
        status,
        note: transaction.notes ?? undefined,
        receiptRequired: transaction.receipt_required,
      })

      if (result?.error || !result?.transaction) {
        onUpdate({
          ...transaction,
          status: previousStatus,
          files: transaction.files,
          autoRule: transaction.autoRule,
        }, status)
        toast.error(result?.error ?? 'Update failed')
        return
      }

      onUpdate({
        ...transaction,
        ...result.transaction as ReceiptTransaction,
        files: transaction.files,
        autoRule: transaction.autoRule
      }, previousStatus)
    })
  }

  async function handleUpload(files: File[]) {
    if (!canManageReceipts) return
    const file = files[0]
    if (!file) return

    startTransition(async () => {
      try {
        const result = await uploadReceiptFile({
          supabase,
          transactionId: transaction.id,
          file,
        })

        if (result?.error || !result?.receipt) {
          toast.error(result?.error ?? 'Upload failed')
          return
        }

        onUpdate({
          ...transaction,
          status: 'completed',
          receipt_required: false,
          files: [...transaction.files, result.receipt as ReceiptFile]
        }, transaction.status)

        toast.success('Receipt uploaded')
      } catch (error) {
        console.error('Receipt upload failed', error)
        toast.error(receiptUploadErrorMessage(error))
      }
    })
  }

  async function handleReceiptDelete(fileId: string) {
    if (!canManageReceipts) return
    startTransition(async () => {
      const result = await deleteReceiptFile(fileId)
      if (result?.error) {
        toast.error(result.error)
        return
      }
      const remaining = transaction.files.filter(f => f.id !== fileId)
      const newStatus = (remaining.length === 0 && transaction.status === 'completed') ? 'pending' : transaction.status

      onUpdate({
        ...transaction,
        status: newStatus,
        files: remaining
      }, transaction.status)
      setDeleteFileId(null)
      toast.success('Receipt removed')
    })
  }

  async function handleReceiptDownload(fileId: string) {
    const result = await getReceiptSignedUrl(fileId)
    if (result?.url) window.open(result.url, '_blank', 'noopener')
  }

  // Classification
  function startEditing(field: 'vendor' | 'expense') {
    if (!canManageReceipts) return
    setEditingField(field)
    if (field === 'vendor') {
      const val = transaction.vendor_name ?? ''
      setClassificationDraft(val)
      setIsCustomVendor(val.length > 0 && !vendorOptions.includes(val))
    } else {
      setClassificationDraft(expenseChoiceValue(transaction))
    }
  }

  /** "Change" on a suggestion: the category picker, starting on what was suggested. */
  function startChangingSuggestion() {
    if (!canManageReceipts || !transaction.aiSuggestion) return
    setEditingField('expense')
    setClassificationDraft(suggestionChoiceValue(transaction.aiSuggestion))
  }

  function saveExpense() {
    if (!canManageReceipts) return
    startTransition(async () => {
      const result = await saveExpenseChoice(transaction, classificationDraft)
      if (result.transaction || result.suggestionClosed) {
        onUpdate({
          ...transaction,
          ...(result.transaction ?? {}),
          files: transaction.files,
          autoRule: transaction.autoRule,
          aiSuggestion: result.suggestionClosed ? null : transaction.aiSuggestion,
        }, transaction.status)
      }
      if (result.error) {
        toast.error(result.error)
        if (result.suggestionClosed) setEditingField(null)
        return
      }
      if (result.ruleSuggestion) {
        onRuleSuggestion(result.ruleSuggestion)
      }
      setEditingField(null)
      toast.success('Updated')
    })
  }

  // `vendorName` and `createVendor` come from the new-vendor dialog: use an existing vendor
  // instead of the typed name, or confirm that the typed name is a new vendor.
  async function saveClassification(options: { vendorName?: string; createVendor?: boolean } = {}) {
    if (!canManageReceipts) return
    if (editingField === 'expense') {
      saveExpense()
      return
    }
    const draft = (options.vendorName ?? classificationDraft).trim()
    const payload: any = { transactionId: transaction.id }
    payload.vendorName = draft.length ? draft : null
    if (options.createVendor) payload.createVendor = true

    startTransition(async () => {
      const result = await updateReceiptClassification(payload)
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
      if (result?.transaction) {
        onUpdate({
          ...transaction,
          ...result.transaction,
          files: transaction.files,
          autoRule: transaction.autoRule
        }, transaction.status)
      }
      if (result?.ruleSuggestion) {
        onRuleSuggestion(result.ruleSuggestion)
      }
      setEditingField(null)
      toast.success('Updated')
    })
  }

  // Notes
  function startNoteEdit() {
    if (!canManageReceipts) return
    const raw = transaction.notes ?? ''
    const [, ...rest] = raw.split(' — ')
    setNoteDraft(rest.length ? rest.join(' — ').trim() : raw)
    setIsEditingNote(true)
    setTimeout(() => noteInputRef.current?.focus(), 10)
  }

  async function saveNote() {
    if (!canManageReceipts) return
    const trimmed = noteDraft.trim()
    const timestamp = formatDateTimeInLondon(new Date(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const formatted = trimmed.length ? `${timestamp} — ${trimmed}` : ''

    if ((transaction.notes ?? '') === formatted) {
      setIsEditingNote(false)
      return
    }

    startTransition(async () => {
      const result = await updateReceiptNote({
        transactionId: transaction.id,
        note: formatted.length ? formatted : null,
      })
      if (result?.error || !result?.transaction) {
        toast.error(result?.error ?? 'Failed to save the note')
        return
      }
      onUpdate({
        ...transaction,
        ...result.transaction as ReceiptTransaction,
        files: transaction.files,
        autoRule: transaction.autoRule
      }, transaction.status)
      setIsEditingNote(false)
      toast.success('Note saved')
    })
  }

  return (
    <tr
      className={`align-top transition-[filter] hover:brightness-95 ${
        heatColour
          ? '[&_.text-text-muted]:!text-text-strong [&_.text-text-soft]:!text-text [&_.text-text-subtle]:!text-text'
          : ''
      }`}
      style={heatColour ? { backgroundColor: heatColour } : undefined}
    >
      <td className="px-4 py-2 text-text-muted">{formatDate(transaction.transaction_date)}</td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <p className="font-medium text-text-strong">{transaction.details}</p>
          <SourceBadge sourceType={transaction.source_type} />
        </div>
        <p className="text-xs text-text-muted">{transaction.transaction_type ?? '-'}</p>
        {transaction.source_type === 'amex' && transaction.card_member && (
          <p className="text-xs text-text-muted">{transaction.card_member}</p>
        )}
        {transaction.rule_applied_id && (
          <Badge tone="primary" icon={<Icon name="refresh" size={12} />} className="mt-1">
            Auto rule
          </Badge>
        )}
        {transaction.aiNote && (
          <p className="mt-1 text-xs text-warning-fg">{transaction.aiNote}</p>
        )}
      </td>

      {/* Vendor */}
      <td className="px-4 py-2">
        {editingField === 'vendor' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            {isCustomVendor ? (
              <div className="space-y-2">
                <Input autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} placeholder="Vendor name" disabled={isPending} />
                <Button type="button" variant="ghost" size="sm" onClick={() => { setIsCustomVendor(false); setClassificationDraft('') }} disabled={isPending}>⟵ Pick Existing</Button>
              </div>
            ) : (
              <Select autoFocus value={classificationDraft} onChange={e => {
                if (e.target.value === '__custom__') { setIsCustomVendor(true); setClassificationDraft(''); }
                else setClassificationDraft(e.target.value)
              }} disabled={isPending} options={[
                { value: '', label: 'Clear' },
                ...vendorOptions.map(v => ({ value: v, label: v })),
                { value: '__custom__', label: '+ New vendor' },
              ]} />
            )}
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => saveClassification()} loading={isPending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
            </div>
            <NewVendorDialog
              prompt={vendorPrompt}
              pending={isPending}
              onUseExisting={(vendorName) => saveClassification({ vendorName })}
              onCreate={() => saveClassification({ createVendor: true })}
              onClose={() => setVendorPrompt(null)}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* `||` not `??`: a blank vendor string still needs the prompt, and
                those are exactly the rows the Needs Vendor tab surfaces. */}
            <Button variant="link" size="sm" className="justify-start whitespace-normal text-left text-text-strong hover:text-primary" onClick={() => startEditing('vendor')} disabled={!canManageReceipts}>
              {transaction.vendor_name || <span className="font-normal text-text-soft">Add vendor</span>}
            </Button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.vendor_source} />
              {transaction.vendor_source === 'ai' && <Icon name="sparkles" size={12} className="text-info" />}
            </div>
          </div>
        )}
      </td>

      {/* Expense */}
      <td className="px-4 py-2">
        {editingField === 'expense' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            <Select autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} disabled={isPending} options={EXPENSE_CHOICE_OPTIONS} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={() => saveClassification()} loading={isPending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <Button variant="link" size="sm" className="justify-start whitespace-normal text-left text-text-strong hover:text-primary" onClick={() => startEditing('expense')} disabled={!canManageReceipts}>
              {expenseChoiceLabel(transaction) || <span className="font-normal text-text-soft">Add category</span>}
            </Button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.expense_category_source} />
              {transaction.expense_category_source === 'ai' && <Icon name="sparkles" size={12} className="text-info" />}
            </div>
            <AiCategorySuggestion
              transaction={transaction}
              canManage={canManageReceipts}
              disabled={isPending}
              onChange={startChangingSuggestion}
              onClosed={(updated) => onUpdate({
                ...transaction,
                ...(updated ?? {}),
                files: transaction.files,
                autoRule: transaction.autoRule,
                aiSuggestion: null,
              }, transaction.status)}
            />
          </div>
        )}
      </td>

      <td className="px-4 py-2 text-right">{formatCurrency(transaction.amount_in)}</td>
      <td className="px-4 py-2 text-right">{formatCurrency(transaction.amount_out)}</td>

      <td className="px-4 py-2">
        <Badge
          tone={RECEIPT_STATUS_TONE[transaction.status]}
          icon={
            transaction.status === 'completed' ? <Icon name="checkCircle" size={12} /> : transaction.status === 'pending' ? <Icon name="xCircle" size={12} /> : undefined
          }
          className="whitespace-nowrap"
        >
          {RECEIPT_STATUS_LABEL[transaction.status]}
        </Badge>
      </td>

      <td className="px-4 py-2">
        {transaction.files.map(f => (
          <div key={f.id} className="flex items-center gap-2 mb-1">
            <Button variant="link" size="xs" onClick={() => handleReceiptDownload(f.id)} className="max-w-[100px]">
              <span className="truncate">{f.file_name || 'View'}</span>
            </Button>
            <IconButton
              size="sm"
              label={`Delete ${f.file_name || 'receipt file'}`}
              icon={<Icon name="x" size={14} className="text-danger" />}
              onClick={() => setDeleteFileId(f.id)}
              disabled={isPending}
            />
          </div>
        ))}
        {transaction.files.length > 0 && (
          <p className="mt-1 text-2xs text-text-soft">Links expire after 5 min. Refresh if a link stops working.</p>
        )}
        <ConfirmDialog
          open={Boolean(deleteFileId)}
          onClose={() => setDeleteFileId(null)}
          onConfirm={() => deleteFileId ? handleReceiptDelete(deleteFileId) : undefined}
          title="Delete Receipt File"
          message="Delete this receipt file from the transaction? This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
        />
      </td>

      <td className="px-4 py-2 min-w-[200px]">
        {isEditingNote ? (
          <div className="space-y-2">
            <Input
              ref={noteInputRef}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveNote()}
              aria-label="Note"
              disabled={isPending}
            />
            <div className="flex gap-1">
              <Button size="sm" variant="primary" onClick={saveNote} loading={isPending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setIsEditingNote(false)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 group">
            {transaction.notes ? (
              <>
                <p className="text-meta text-text-muted uppercase">{transaction.notes.split(' — ')[0]}</p>
                <p className="text-sm text-text break-words">{transaction.notes.split(' — ').slice(1).join(' — ') || transaction.notes}</p>
              </>
            ) : (
              <span className="text-xs text-text-soft italic">No notes</span>
            )}
            {/* Always visible: this table is used on an iPad, where there is no
                hover and a hover-only control is simply unreachable. */}
            <Button variant="ghost" size="xs" icon={<Icon name="edit" size={12} />} onClick={startNoteEdit} disabled={!canManageReceipts}>
              Edit
            </Button>
          </div>
        )}
      </td>

      <td className="px-4 py-2">
        {/* Default IconButton size (31px square), not sm (25px): this table is used on an iPad,
            and the buttons these replaced were 36px wide, so sm would shrink every target. */}
        <div className="flex flex-row items-center gap-1">
          {/* FileButton, not the FileUpload drop zone, which is too big for a table row. */}
          <FileButton
            variant="secondary"
            accept={RECEIPT_UPLOAD_ACCEPT}
            onFiles={handleUpload}
            disabled={isPending || !canManageReceipts}
            aria-label="Upload receipt"
            title="Upload receipt"
            icon={<Icon name="upload" size={16} />}
          />

          {transaction.status !== 'completed' && (
            <IconButton
              variant="primary"
              onClick={() => handleStatusUpdate('completed')}
              disabled={isPending || !canManageReceipts}
              title="Mark as done"
              label="Mark as done"
              icon={<Icon name="check" size={16} />}
            />
          )}

          {transaction.status !== 'no_receipt_required' && (
            <IconButton
              variant="secondary"
              onClick={() => handleStatusUpdate('no_receipt_required')}
              disabled={isPending || !canManageReceipts}
              title="Skip (no receipt needed)"
              label="Skip (no receipt needed)"
              icon={<Icon name="fastForward" size={16} />}
            />
          )}

          {transaction.status !== 'cant_find' && (
            <IconButton
              variant="secondary"
              onClick={() => handleStatusUpdate('cant_find')}
              className="border-danger-border text-danger-fg hover:bg-danger-soft"
              disabled={isPending || !canManageReceipts}
              title="Mark as missing"
              label="Mark as missing"
              icon={<Icon name="helpCircle" size={16} />}
            />
          )}

          {transaction.status !== 'pending' && (
            <IconButton
              variant="ghost"
              onClick={() => handleStatusUpdate('pending')}
              disabled={isPending || !canManageReceipts}
              title="Reopen"
              label="Reopen"
              icon={<Icon name="undo" size={16} />}
            />
          )}
        </div>
      </td>
    </tr>
  )
}
