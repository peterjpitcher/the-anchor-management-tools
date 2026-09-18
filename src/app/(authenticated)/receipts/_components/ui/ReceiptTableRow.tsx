'use client'

import { useState, useTransition, useRef, ChangeEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Badge, Button, ConfirmDialog, IconButton, Input, Select, Spinner } from '@/ds'
import {
  markReceiptTransaction,
  deleteReceiptFile,
  getReceiptSignedUrl,
  updateReceiptClassification,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import type { ReceiptTransaction, ReceiptFile, ReceiptExpenseCategory, ReceiptClassificationSource } from '@/types/database'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import {
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  PencilSquareIcon,
  SparklesIcon,
  ArrowUpTrayIcon,
  ArrowUturnLeftIcon,
  CheckIcon,
  ForwardIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatCurrency, formatDate, statusLabels, statusTone } from '@/app/(authenticated)/receipts/utils'
import { RECEIPT_UPLOAD_ACCEPT, receiptUploadErrorMessage, uploadReceiptFile } from './receiptUploadClient'

// Re-defined here or imported? Imported `ReceiptWorkspaceData` in parent, but here we just need the type.
// We can use ReceiptTransaction & { files: ReceiptFile[], autoRule?: ... }
type WorkspaceTransaction = ReceiptTransaction & {
  files: ReceiptFile[]
  autoRule?: { id: string; name: string } | null
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options

export function SourceBadge({ sourceType }: { sourceType: ReceiptTransaction['source_type'] }) {
  const isAmex = sourceType === 'amex'
  return (
    <Badge tone={isAmex ? 'info' : 'neutral'} size="sm">
      {isAmex ? 'Amex' : 'Bank'}
    </Badge>
  )
}

function ClassificationBadge({ source }: { source?: ReceiptClassificationSource | null }) {
  if (!source || source === 'manual') return null
  const labels: Record<string, string> = {
    ai: 'AI',
    rule: 'Rule',
  }
  // AI suggestions share the info tone with the sparkle icon beside them; a rule is an
  // automation the team set up, so it takes the primary tone.
  const tones: Record<string, 'info' | 'primary'> = {
    ai: 'info',
    rule: 'primary',
  }
  return (
    <Badge tone={tones[source] ?? 'neutral'} size="sm">
      {labels[source] ?? source}
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
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null)

  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const noteInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!canManageReceipts) return
    const file = event.target.files?.[0]
    event.target.value = ''
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
      setClassificationDraft(transaction.expense_category ?? '')
    }
  }

  async function saveClassification() {
    if (!canManageReceipts) return
    const draft = classificationDraft.trim()
    const payload: any = { transactionId: transaction.id }

    if (editingField === 'vendor') {
      payload.vendorName = draft.length ? draft : null
    } else {
      payload.expenseCategory = draft.length ? draft : null
    }

    startTransition(async () => {
      const result = await updateReceiptClassification(payload)
      if (result?.error) {
        toast.error(result.error)
        return
      }
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
    const timestamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const formatted = trimmed.length ? `${timestamp} — ${trimmed}` : ''

    if ((transaction.notes ?? '') === formatted) {
      setIsEditingNote(false)
      return
    }

    startTransition(async () => {
      const result = await markReceiptTransaction({
        transactionId: transaction.id,
        status: transaction.status,
        note: formatted.length ? formatted : undefined,
        receiptRequired: transaction.receipt_required
      })
      if (result?.error || !result?.transaction) {
        toast.error(result?.error ?? 'Failed')
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
        <p className="text-xs text-text-muted">{transaction.transaction_type ?? '—'}</p>
        {transaction.source_type === 'amex' && transaction.card_member && (
          <p className="text-xs text-text-muted">{transaction.card_member}</p>
        )}
        {transaction.rule_applied_id && (
          <Badge tone="primary" icon={<ArrowPathIcon />} className="mt-1">
            Auto rule
          </Badge>
        )}
      </td>

      {/* Vendor */}
      <td className="px-4 py-2">
        {editingField === 'vendor' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            {isCustomVendor ? (
              <div className="space-y-2">
                <Input autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} placeholder="Vendor name" disabled={isPending} />
                <Button type="button" variant="ghost" size="sm" onClick={() => { setIsCustomVendor(false); setClassificationDraft('') }} disabled={isPending}>⟵ Pick existing</Button>
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
              <Button size="sm" onClick={saveClassification} disabled={isPending}>{isPending && <Spinner className="mr-1 h-3 w-3" />}Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* `||` not `??`: a blank vendor string still needs the prompt, and
                those are exactly the rows the "Missing vendor" filter surfaces. */}
            <button type="button" className="rounded-sm text-left text-sm font-medium text-text-strong hover:text-primary focus-visible:outline-hidden focus-visible:shadow-ring" onClick={() => startEditing('vendor')} disabled={!canManageReceipts}>
              {transaction.vendor_name || <span className="text-text-subtle font-normal">Add vendor</span>}
            </button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.vendor_source} />
              {transaction.vendor_source === 'ai' && <SparklesIcon className="h-3 w-3 text-info" />}
            </div>
          </div>
        )}
      </td>

      {/* Expense */}
      <td className="px-4 py-2">
        {editingField === 'expense' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            <Select autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} disabled={isPending} options={[
              { value: '', label: 'Clear' },
              ...expenseCategoryOptions.map(o => ({ value: o, label: o })),
            ]} />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveClassification} disabled={isPending}>{isPending && <Spinner className="mr-1 h-3 w-3" />}Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <button type="button" className="rounded-sm text-left text-sm font-medium text-text-strong hover:text-primary focus-visible:outline-hidden focus-visible:shadow-ring" onClick={() => startEditing('expense')} disabled={!canManageReceipts}>
              {transaction.expense_category || <span className="text-text-subtle font-normal">Add category</span>}
            </button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.expense_category_source} />
              {transaction.expense_category_source === 'ai' && <SparklesIcon className="h-3 w-3 text-info" />}
            </div>
          </div>
        )}
      </td>

      <td className="px-4 py-2 text-right">{formatCurrency(transaction.amount_in)}</td>
      <td className="px-4 py-2 text-right">{formatCurrency(transaction.amount_out)}</td>

      <td className="px-4 py-2">
        <Badge
          tone={statusTone[transaction.status]}
          icon={
            transaction.status === 'completed' ? <CheckCircleIcon /> : transaction.status === 'pending' ? <XCircleIcon /> : undefined
          }
          className="whitespace-nowrap"
        >
          {statusLabels[transaction.status]}
        </Badge>
      </td>

      <td className="px-4 py-2">
        {transaction.files.map(f => (
          <div key={f.id} className="flex items-center gap-2 mb-1">
            <button type="button" onClick={() => handleReceiptDownload(f.id)} className="rounded-sm text-primary hover:underline text-xs truncate max-w-[100px] focus-visible:outline-hidden focus-visible:shadow-ring">{f.file_name || 'View'}</button>
            <button type="button" onClick={() => setDeleteFileId(f.id)} className="text-danger text-xs px-1 hover:bg-danger-soft rounded-sm focus-visible:outline-hidden focus-visible:shadow-ring" disabled={isPending}>×</button>
          </div>
        ))}
        {transaction.files.length > 0 && (
          <p className="mt-1 text-2xs text-text-soft">Links expire after 5 min. Refresh if a link stops working.</p>
        )}
        <ConfirmDialog
          open={Boolean(deleteFileId)}
          onClose={() => setDeleteFileId(null)}
          onConfirm={() => deleteFileId ? handleReceiptDelete(deleteFileId) : undefined}
          title="Delete receipt file"
          message="Remove this receipt file from the transaction?"
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
              <Button size="sm" onClick={saveNote} disabled={isPending}>Save</Button>
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
              <span className="text-xs text-text-subtle italic">No notes</span>
            )}
            {/* Always visible: this table is used on an iPad, where there is no
                hover and a hover-only control is simply unreachable. */}
            <button type="button" onClick={startNoteEdit} className="rounded-sm text-xs text-text-muted flex items-center gap-1 hover:text-primary focus-visible:outline-hidden focus-visible:shadow-ring" disabled={!canManageReceipts}>
              <PencilSquareIcon className="h-3 w-3" /> Edit
            </button>
          </div>
        )}
      </td>

      <td className="px-4 py-2">
        {/* Default IconButton size (31px square), not sm (25px): this table is used on an iPad,
            and the buttons these replaced were 36px wide, so sm would shrink every target. */}
        <div className="flex flex-row items-center gap-1">
          <IconButton
            variant="secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || !canManageReceipts}
            title="Upload receipt"
            label="Upload receipt"
            icon={<ArrowUpTrayIcon className="h-4 w-4" />}
          />
          <input type="file" className="hidden" ref={fileInputRef} accept={RECEIPT_UPLOAD_ACCEPT} onChange={handleUpload} />

          {transaction.status !== 'completed' && (
            <IconButton
              variant="primary"
              onClick={() => handleStatusUpdate('completed')}
              disabled={isPending || !canManageReceipts}
              title="Mark as done"
              label="Mark as done"
              icon={<CheckIcon className="h-4 w-4" />}
            />
          )}

          {transaction.status !== 'no_receipt_required' && (
            <IconButton
              variant="secondary"
              onClick={() => handleStatusUpdate('no_receipt_required')}
              disabled={isPending || !canManageReceipts}
              title="Skip (no receipt needed)"
              label="Skip (no receipt needed)"
              icon={<ForwardIcon className="h-4 w-4" />}
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
              icon={<QuestionMarkCircleIcon className="h-4 w-4" />}
            />
          )}

          {transaction.status !== 'pending' && (
            <IconButton
              variant="ghost"
              onClick={() => handleStatusUpdate('pending')}
              disabled={isPending || !canManageReceipts}
              title="Reopen"
              label="Reopen"
              icon={<ArrowUturnLeftIcon className="h-4 w-4" />}
            />
          )}
        </div>
      </td>
    </tr>
  )
}
