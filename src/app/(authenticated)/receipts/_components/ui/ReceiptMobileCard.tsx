'use client'

import { useState, useTransition, useRef, ChangeEvent } from 'react'
import { toast } from 'react-hot-toast'
import { Button } from '@/components/ui-v2/forms/Button'
import { Input } from '@/components/ui-v2/forms/Input'
import { Select } from '@/components/ui-v2/forms/Select'
import { Spinner } from '@/components/ui-v2/feedback/Spinner'
import {
  markReceiptTransaction,
  uploadReceiptForTransaction,
  deleteReceiptFile,
  getReceiptSignedUrl,
  updateReceiptClassification,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import type { ReceiptTransaction, ReceiptFile, ReceiptClassificationSource } from '@/types/database'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import {
  ArrowPathIcon,
  SparklesIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatCurrency, formatDate, statusLabels, statusToneClasses } from '@/app/(authenticated)/receipts/utils'

type WorkspaceTransaction = ReceiptTransaction & {
  files: ReceiptFile[]
  autoRule?: { id: string; name: string } | null
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options

interface ReceiptMobileCardProps {
  transaction: WorkspaceTransaction
  vendorOptions: string[]
  onUpdate: (transaction: WorkspaceTransaction, previousStatus: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

export function ReceiptMobileCard({
  transaction,
  vendorOptions,
  onUpdate,
  onRuleSuggestion,
}: ReceiptMobileCardProps) {
  const { hasPermission } = usePermissions()
  const canManageReceipts = hasPermission('receipts', 'manage')

  const [isPending, startTransition] = useTransition()
  const [editingField, setEditingField] = useState<'vendor' | 'expense' | null>(null)
  const [classificationDraft, setClassificationDraft] = useState('')
  const [isCustomVendor, setIsCustomVendor] = useState(false)
  
  const [isEditingNote, setIsEditingNote] = useState(false)
  const [noteDraft, setNoteDraft] = useState('')
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
        const result = await uploadReceiptForTransaction(formData)
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

  function startNoteEdit() {
      if (!canManageReceipts) return
      const raw = transaction.notes ?? ''
      const [, ...rest] = raw.split(' — ')
      setNoteDraft(rest.length ? rest.join(' — ').trim() : raw)
      setIsEditingNote(true)
  }

  async function saveNote() {
      if (!canManageReceipts) return
      const trimmed = noteDraft.trim()
      const timestamp = new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      const formatted = trimmed.length ? `${timestamp} — ${trimmed}` : ''
      
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
    <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <div className="min-w-0 space-y-0.5">
                <p className="text-[11px] text-gray-500">
                {formatDate(transaction.transaction_date)}
                {transaction.transaction_type ? ` · ${transaction.transaction_type}` : ''}
                </p>
                <h3 className="text-sm font-semibold leading-snug text-gray-900">{transaction.details}</h3>
                {transaction.rule_applied_id && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                    <ArrowPathIcon className="h-3.5 w-3.5" /> Auto rule
                </span>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-0.5 text-right text-[11px]">
                {transaction.amount_out != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                    Out
                    <span className="font-semibold text-gray-900">{formatCurrency(transaction.amount_out)}</span>
                </span>
                )}
                {transaction.amount_in != null && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">
                    In
                    <span className="font-semibold text-gray-900">{formatCurrency(transaction.amount_in)}</span>
                </span>
                )}
                <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${statusToneClasses[transaction.status]}`}>
                {statusLabels[transaction.status]}
                </span>
            </div>
        </div>
        
        <div className="mt-1.5 grid w-full grid-cols-[auto,1fr] items-center gap-x-2 gap-y-2 text-xs text-gray-500">
            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Vendor</span>
            <div className="text-sm leading-tight text-gray-900">
                {editingField === 'vendor' ? (
                    <div className="flex flex-col gap-2 mt-1">
                        {isCustomVendor ? (
                            <Input autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} placeholder="Vendor" disabled={isPending} />
                        ) : (
                            <Select autoFocus value={classificationDraft} onChange={e => {
                                if (e.target.value === '__custom__') { setIsCustomVendor(true); setClassificationDraft(''); }
                                else setClassificationDraft(e.target.value)
                            }} disabled={isPending}>
                                <option value="">Clear</option>
                                {vendorOptions.map(v => <option key={v} value={v}>{v}</option>)}
                                <option value="__custom__">+ New</option>
                            </Select>
                        )}
                        <div className="flex gap-2">
                            <Button size="xs" onClick={saveClassification} disabled={isPending}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => startEditing('vendor')} className="text-left hover:text-emerald-600" disabled={!canManageReceipts}>
                        {transaction.vendor_name || <span className="text-gray-400">Add vendor</span>}
                        {transaction.vendor_source === 'ai' && <SparklesIcon className="inline h-3 w-3 ml-1 text-blue-500" />}
                    </button>
                )}
            </div>

            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Expense</span>
            <div className="text-sm leading-tight text-gray-900">
                 {editingField === 'expense' ? (
                    <div className="flex flex-col gap-2 mt-1">
                        <Select autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} disabled={isPending}>
                            <option value="">Clear</option>
                            {expenseCategoryOptions.map(o => <option key={o} value={o}>{o}</option>)}
                        </Select>
                        <div className="flex gap-2">
                            <Button size="xs" onClick={saveClassification} disabled={isPending}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <button onClick={() => startEditing('expense')} className="text-left hover:text-emerald-600" disabled={!canManageReceipts}>
                        {transaction.expense_category || <span className="text-gray-400">Add category</span>}
                         {transaction.expense_category_source === 'ai' && <SparklesIcon className="inline h-3 w-3 ml-1 text-blue-500" />}
                    </button>
                )}
            </div>

            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Notes</span>
            <div className="text-sm leading-tight text-gray-900">
                 {isEditingNote ? (
                    <div className="flex flex-col gap-2 mt-1">
                        <Input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Note" disabled={isPending} />
                        <div className="flex gap-2">
                            <Button size="xs" onClick={saveNote} disabled={isPending}>Save</Button>
                            <Button size="xs" variant="ghost" onClick={() => setIsEditingNote(false)} disabled={isPending}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <button onClick={startNoteEdit} className="text-left hover:text-emerald-600 w-full" disabled={!canManageReceipts}>
                        {transaction.notes ? transaction.notes.split(' — ').slice(1).join(' — ') || transaction.notes : <span className="text-gray-400 italic">Add note</span>}
                        <PencilSquareIcon className="inline h-3 w-3 ml-1 text-gray-400" />
                    </button>
                )}
            </div>
        </div>
        
        <div className="mt-2 border-t border-gray-100 pt-2 flex flex-wrap gap-2">
             <Button variant="secondary" size="xs" onClick={() => fileInputRef.current?.click()} disabled={isPending || !canManageReceipts}>Upload</Button>
             <input type="file" className="hidden" ref={fileInputRef} onChange={handleUpload} />
             
             {transaction.files.map(f => (
                 <div key={f.id} className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 bg-white text-[11px]">
                     <button onClick={() => handleReceiptDownload(f.id)} className="text-emerald-700 truncate max-w-[80px]">{f.file_name || 'Receipt'}</button>
                     <button onClick={() => handleReceiptDelete(f.id)} className="text-red-500 ml-1">×</button>
                 </div>
             ))}

             <div className="ml-auto flex gap-1">
                 {transaction.status !== 'completed' && <Button variant="success" size="xs" onClick={() => handleStatusUpdate('completed')} disabled={isPending || !canManageReceipts}>Done</Button>}
                 {transaction.status === 'pending' && <Button variant="secondary" size="xs" onClick={() => handleStatusUpdate('no_receipt_required')} disabled={isPending || !canManageReceipts}>Skip</Button>}
                 {transaction.status === 'pending' && <Button variant="secondary" size="xs" onClick={() => handleStatusUpdate('cant_find')} className="border border-rose-200 text-rose-700" disabled={isPending || !canManageReceipts}>Missing</Button>}
                 {transaction.status !== 'pending' && <Button variant="ghost" size="xs" onClick={() => handleStatusUpdate('pending')} disabled={isPending || !canManageReceipts}>Reopen</Button>}
             </div>
        </div>
    </div>
  )
}
