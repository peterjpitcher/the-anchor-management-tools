'use client'

import { useState, useTransition, useRef, ChangeEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import {
  markReceiptTransaction,
  deleteReceiptFile,
  getReceiptSignedUrl,
  updateReceiptClassification,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
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
import { formatCurrency, formatDate, statusLabels, statusToneClasses } from '@/app/(authenticated)/receipts/utils'

// Re-defined here or imported? Imported `ReceiptWorkspaceData` in parent, but here we just need the type.
// We can use ReceiptTransaction & { files: ReceiptFile[], autoRule?: ... }
type WorkspaceTransaction = ReceiptTransaction & {
  files: ReceiptFile[]
  autoRule?: { id: string; name: string } | null
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options

function ClassificationBadge({ source }: { source?: ReceiptClassificationSource | null }) {
  if (!source || source === 'manual') return null
  const labels: Record<string, string> = {
    ai: 'AI',
    rule: 'Rule',
  }
  const colors: Record<string, string> = {
    ai: 'bg-blue-50 text-blue-700 border-blue-100',
    rule: 'bg-purple-50 text-purple-700 border-purple-100',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${colors[source] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[source] ?? source}
    </span>
  )
}

interface ReceiptTableRowProps {
  transaction: WorkspaceTransaction
  vendorOptions: string[]
  onUpdate: (transaction: WorkspaceTransaction, previousStatus: ReceiptTransaction['status']) => void
  onRemove: (id: string, previousStatus: ReceiptTransaction['status'], nextStatus?: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

export function ReceiptTableRow({
  transaction,
  vendorOptions,
  onUpdate,
  onRemove,
  onRuleSuggestion,
}: ReceiptTableRowProps) {
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')

  const [isPending, startTransition] = useTransition()
  const [editingField, setEditingField] = useState<'vendor' | 'expense' | null>(null)
  const [classificationDraft, setClassificationDraft] = useState('')
  const [isCustomVendor, setIsCustomVendor] = useState(false)

  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
  const noteInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleStatusUpdate(status: ReceiptTransaction['status']) {
    if (!canManageReceipts) return
    startTransition(async () => {
      const result = await markReceiptTransaction({
        transactionId: transaction.id,
        status,
        note: transaction.notes ?? undefined,
        receiptRequired: transaction.receipt_required,
      })

      if (result?.error || !result?.transaction) {
        toast.error(result?.error ?? 'Update failed')
        return
      }

      // Determine if we should remove it (logic handled by parent based on filters? 
      // Actually parent needs to decide if it stays. 
      // But here we just notify update. Parent `onUpdate` handles the "keep or remove" logic?
      // No, parent `onUpdate` just updates state. Parent needs to filter?
      // In ReceiptList, we had logic to remove if it doesn't match filters.
      // We'll assume the parent handles filtering or we pass the check.
      // For now, just notify update.
      onUpdate({
        ...transaction,
        ...result.transaction as ReceiptTransaction,
        files: transaction.files,
        autoRule: transaction.autoRule
      }, transaction.status)

      toast.success('Status updated')
    })
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    if (!canManageReceipts) return
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const formData = new FormData()
    formData.append('transactionId', transaction.id)
    formData.append('receipt', file)

    startTransition(async () => {
      try {
        const response = await fetch('/api/receipts/upload', {
          method: 'POST',
          body: formData,
        })
        const result = await response.json().catch(() => ({}))

        if (!response.ok || result?.error || !result?.receipt) {
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
        const message = error instanceof Error ? error.message.toLowerCase() : ''
        const tooLarge = (message.includes('body') && message.includes('limit')) || message.includes('too large')
        toast.error(tooLarge ? 'File is too large. Please keep receipts under 15MB.' : 'Upload failed')
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
    <tr className="align-top hover:bg-gray-50/50">
      <td className="px-4 py-3 text-gray-600">{formatDate(transaction.transaction_date)}</td>
      <td className="px-4 py-3">
        <p className="font-medium text-gray-900">{transaction.details}</p>
        <p className="text-xs text-gray-500">{transaction.transaction_type ?? '—'}</p>
        {transaction.rule_applied_id && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
            <ArrowPathIcon className="h-4 w-4" /> Auto rule
          </p>
        )}
      </td>

      {/* Vendor */}
      <td className="px-4 py-3">
        {editingField === 'vendor' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            {isCustomVendor ? (
              <div className="space-y-2">
                <Input autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} placeholder="Vendor name" disabled={isPending} />
                <Button type="button" variant="ghost" size="xs" onClick={() => { setIsCustomVendor(false); setClassificationDraft('') }} disabled={isPending}>⟵ Pick existing</Button>
              </div>
            ) : (
              <Select autoFocus value={classificationDraft} onChange={e => {
                if (e.target.value === '__custom__') { setIsCustomVendor(true); setClassificationDraft(''); }
                else setClassificationDraft(e.target.value)
              }} disabled={isPending}>
                <option value="">Clear</option>
                {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                <option value="__custom__">+ New vendor</option>
              </Select>
            )}
            <div className="flex gap-2">
              <Button size="xs" onClick={saveClassification} disabled={isPending}>{isPending && <Spinner className="mr-1 h-3 w-3" />}Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <button className="text-left text-sm font-medium text-gray-900 hover:text-emerald-600" onClick={() => startEditing('vendor')} disabled={!canManageReceipts}>
              {transaction.vendor_name ?? <span className="text-gray-400 font-normal">Add vendor</span>}
            </button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.vendor_source} />
              {transaction.vendor_source === 'ai' && <SparklesIcon className="h-3 w-3 text-blue-500" />}
            </div>
          </div>
        )}
      </td>

      {/* Expense */}
      <td className="px-4 py-3">
        {editingField === 'expense' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            <Select autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} disabled={isPending}>
              <option value="">Clear</option>
              {expenseCategoryOptions.map(o => <option key={o} value={o}>{o}</option>)}
            </Select>
            <div className="flex gap-2">
              <Button size="xs" onClick={saveClassification} disabled={isPending}>{isPending && <Spinner className="mr-1 h-3 w-3" />}Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <button className="text-left text-sm font-medium text-gray-900 hover:text-emerald-600" onClick={() => startEditing('expense')} disabled={!canManageReceipts}>
              {transaction.expense_category ?? <span className="text-gray-400 font-normal">Add category</span>}
            </button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.expense_category_source} />
              {transaction.expense_category_source === 'ai' && <SparklesIcon className="h-3 w-3 text-blue-500" />}
            </div>
          </div>
        )}
      </td>

      <td className="px-4 py-3 text-right">{formatCurrency(transaction.amount_in)}</td>
      <td className="px-4 py-3 text-right">{formatCurrency(transaction.amount_out)}</td>

      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap ${statusToneClasses[transaction.status]}`}>
          {transaction.status === 'completed' && <CheckCircleIcon className="h-4 w-4" />}
          {transaction.status === 'pending' && <XCircleIcon className="h-4 w-4" />}
          {statusLabels[transaction.status]}
        </span>
      </td>

      <td className="px-4 py-3">
        {transaction.files.map(f => (
          <div key={f.id} className="flex items-center gap-2 mb-1">
            <button onClick={() => handleReceiptDownload(f.id)} className="text-emerald-700 hover:underline text-xs truncate max-w-[100px]">{f.file_name || 'View'}</button>
            <button onClick={() => handleReceiptDelete(f.id)} className="text-red-500 text-xs px-1 hover:bg-red-50 rounded" disabled={isPending}>×</button>
          </div>
        ))}
      </td>

      <td className="px-4 py-3 min-w-[200px]">
        {isEditingNote ? (
          <div className="space-y-2">
            <input
              ref={noteInputRef}
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveNote()}
              className="w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
              disabled={isPending}
            />
            <div className="flex gap-1">
              <Button size="xs" onClick={saveNote} disabled={isPending}>Save</Button>
              <Button size="xs" variant="ghost" onClick={() => setIsEditingNote(false)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 group">
            {transaction.notes ? (
              <>
                <p className="text-[11px] text-gray-500 uppercase">{transaction.notes.split(' — ')[0]}</p>
                <p className="text-sm text-gray-700 break-words">{transaction.notes.split(' — ').slice(1).join(' — ') || transaction.notes}</p>
              </>
            ) : (
              <span className="text-xs text-gray-400 italic">No notes</span>
            )}
            <button onClick={startNoteEdit} className="invisible group-hover:visible text-xs text-gray-500 flex items-center gap-1 hover:text-emerald-600" disabled={!canManageReceipts}>
              <PencilSquareIcon className="h-3 w-3" /> Edit
            </button>
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        <div className="flex flex-row items-center gap-1">
          <Button
            variant="secondary"
            size="xs"
            onClick={() => fileInputRef.current?.click()}
            disabled={isPending || !canManageReceipts}
            title="Upload receipt"
          >
            <ArrowUpTrayIcon className="h-4 w-4" />
          </Button>
          <input type="file" className="hidden" ref={fileInputRef} onChange={handleUpload} />

          {transaction.status !== 'completed' && (
            <Button
              variant="success"
              size="xs"
              onClick={() => handleStatusUpdate('completed')}
              disabled={isPending || !canManageReceipts}
              title="Mark as done"
            >
              <CheckIcon className="h-4 w-4" />
            </Button>
          )}

          {transaction.status !== 'no_receipt_required' && (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => handleStatusUpdate('no_receipt_required')}
              disabled={isPending || !canManageReceipts}
              title="Skip (no receipt needed)"
            >
              <ForwardIcon className="h-4 w-4" />
            </Button>
          )}

          {transaction.status !== 'cant_find' && (
            <Button
              variant="secondary"
              size="xs"
              onClick={() => handleStatusUpdate('cant_find')}
              className="border border-rose-200 text-rose-700 hover:bg-rose-50"
              disabled={isPending || !canManageReceipts}
              title="Mark as missing"
            >
              <QuestionMarkCircleIcon className="h-4 w-4" />
            </Button>
          )}

          {transaction.status !== 'pending' && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => handleStatusUpdate('pending')}
              disabled={isPending || !canManageReceipts}
              title="Reopen"
            >
              <ArrowUturnLeftIcon className="h-4 w-4" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
