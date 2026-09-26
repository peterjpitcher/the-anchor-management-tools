'use client'

import { useState, useTransition } from 'react'
import { Badge, Button, Card, ConfirmDialog, FileButton, IconButton, Input, Select, SubHeading, toast, Icon } from '@/ds'
import {
  markReceiptTransaction,
  deleteReceiptFile,
  getReceiptSignedUrl,
  updateReceiptClassification,
  type ClassificationRuleSuggestion,
} from '@/app/actions/receipts'
import { useSupabase } from '@/components/providers/SupabaseProvider'
import type { ReceiptTransaction, ReceiptFile, ReceiptClassificationSource } from '@/types/database'
import { receiptExpenseCategorySchema } from '@/lib/validation'
import { usePermissions } from '@/contexts/PermissionContext'
import { formatCurrency, formatDate } from '@/app/(authenticated)/receipts/utils'
import { RECEIPT_FLOW_TONE, RECEIPT_STATUS_LABEL, RECEIPT_STATUS_TONE } from '@/app/(authenticated)/receipts/_shared/status-ui'
import { RECEIPT_UPLOAD_ACCEPT, receiptUploadErrorMessage, uploadReceiptFile } from './receiptUploadClient'
import { SourceBadge } from './ReceiptTableRow'
import { formatDateTimeInLondon } from '@/lib/dateUtils'

type WorkspaceTransaction = ReceiptTransaction & {
  files: ReceiptFile[]
  autoRule?: { id: string; name: string } | null
}

const expenseCategoryOptions = receiptExpenseCategorySchema.options

interface ReceiptMobileCardProps {
  transaction: WorkspaceTransaction
  vendorOptions: string[]
  heatColour?: string
  onUpdate: (transaction: WorkspaceTransaction, previousStatus: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

export function ReceiptMobileCard({
  transaction,
  vendorOptions,
  heatColour,
  onUpdate,
  onRuleSuggestion,
}: ReceiptMobileCardProps) {
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
      const timestamp = formatDateTimeInLondon(new Date(), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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

  // A heat-coloured card (grouped by vendor) paints the colour on a wrapper and lets the Card show
  // through, because the colour is worked out per row and cannot be a class.
  const card = (
    <Card padding="sm" className={heatColour ? 'bg-transparent' : undefined}>
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
            <div className="min-w-0 space-y-0.5">
                <p className="text-meta text-text-muted">
                {formatDate(transaction.transaction_date)}
                {transaction.transaction_type ? ` \u00b7 ${transaction.transaction_type}` : ''}
                </p>
                <div className="flex items-center gap-2">
                    <SubHeading className="leading-snug">{transaction.details}</SubHeading>
                    <SourceBadge sourceType={transaction.source_type} />
                </div>
                {transaction.source_type === 'amex' && transaction.card_member && (
                <p className="text-meta text-text-muted">{transaction.card_member}</p>
                )}
                {transaction.rule_applied_id && (
                <Badge tone="primary" size="sm" icon={<Icon name="refresh" size={12} />}>
                    Auto rule
                </Badge>
                )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-0.5 text-right text-meta">
                {transaction.amount_out != null && (
                <Badge tone={RECEIPT_FLOW_TONE.spend} size="sm">
                    Out
                    <span className="font-semibold text-text-strong">{formatCurrency(transaction.amount_out)}</span>
                </Badge>
                )}
                {transaction.amount_in != null && (
                <Badge tone={RECEIPT_FLOW_TONE.income} size="sm">
                    In
                    <span className="font-semibold text-text-strong">{formatCurrency(transaction.amount_in)}</span>
                </Badge>
                )}
                <Badge tone={RECEIPT_STATUS_TONE[transaction.status]} size="sm">
                {RECEIPT_STATUS_LABEL[transaction.status]}
                </Badge>
            </div>
        </div>
        
        <div className="mt-1.5 grid w-full grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2 text-xs text-text-muted">
            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Vendor</span>
            <div className="text-sm leading-tight text-text-strong">
                {editingField === 'vendor' ? (
                    <div className="flex flex-col gap-2 mt-1">
                        {isCustomVendor ? (
                            <Input autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} placeholder="Vendor" disabled={isPending} />
                        ) : (
                            <Select autoFocus value={classificationDraft} onChange={e => {
                                if (e.target.value === '__custom__') { setIsCustomVendor(true); setClassificationDraft(''); }
                                else setClassificationDraft(e.target.value)
                            }} disabled={isPending} options={[
                                { value: '', label: 'Clear' },
                                ...vendorOptions.map(v => ({ value: v, label: v })),
                                { value: '__custom__', label: '+ New' },
                            ]} />
                        )}
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={saveClassification} loading={isPending}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <Button variant="link" size="sm" onClick={() => startEditing('vendor')} className="justify-start whitespace-normal text-left font-normal text-text-strong hover:text-primary" disabled={!canManageReceipts}>
                        {transaction.vendor_name || <span className="text-text-soft">Add vendor</span>}
                        {transaction.vendor_source === 'ai' && <Icon name="sparkles" size={12} className="inline text-info" />}
                    </Button>
                )}
            </div>

            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Expense</span>
            <div className="text-sm leading-tight text-text-strong">
                 {editingField === 'expense' ? (
                    <div className="flex flex-col gap-2 mt-1">
                        <Select autoFocus value={classificationDraft} onChange={e => setClassificationDraft(e.target.value)} disabled={isPending} options={[
                            { value: '', label: 'Clear' },
                            ...expenseCategoryOptions.map(o => ({ value: o, label: o })),
                        ]} />
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={saveClassification} loading={isPending}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingField(null)} disabled={isPending}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <Button variant="link" size="sm" onClick={() => startEditing('expense')} className="justify-start whitespace-normal text-left font-normal text-text-strong hover:text-primary" disabled={!canManageReceipts}>
                        {transaction.expense_category || <span className="text-text-soft">Add category</span>}
                        {transaction.expense_category_source === 'ai' && <Icon name="sparkles" size={12} className="inline text-info" />}
                    </Button>
                )}
            </div>

            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Notes</span>
            <div className="text-sm leading-tight text-text-strong">
                 {isEditingNote ? (
                    <div className="flex flex-col gap-2 mt-1">
                        <Input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Note" disabled={isPending} />
                        <div className="flex gap-2">
                            <Button size="sm" variant="primary" onClick={saveNote} loading={isPending}>Save</Button>
                            <Button size="sm" variant="ghost" onClick={() => setIsEditingNote(false)} disabled={isPending}>Cancel</Button>
                        </div>
                    </div>
                ) : (
                    <Button variant="link" size="sm" onClick={startNoteEdit} className="w-full justify-start whitespace-normal text-left font-normal text-text-strong hover:text-primary" disabled={!canManageReceipts}>
                        {transaction.notes ? transaction.notes.split(' — ').slice(1).join(' — ') || transaction.notes : <span className="text-text-soft italic">Add note</span>}
                        <Icon name="edit" size={12} className="inline text-text-subtle" />
                    </Button>
                )}
            </div>
        </div>
        
        <div className="mt-2 border-t border-border pt-2 flex flex-wrap gap-2">
             {/* FileButton, not the FileUpload drop zone, which is too big for a card. */}
             <FileButton variant="secondary" size="sm" accept={RECEIPT_UPLOAD_ACCEPT} onFiles={handleUpload} disabled={isPending || !canManageReceipts}>Upload</FileButton>

             {transaction.files.map(f => (
                 <span key={f.id} className="inline-flex items-center gap-1">
                     <Button variant="link" size="xs" onClick={() => handleReceiptDownload(f.id)} className="max-w-[80px]">
                       <span className="truncate">{f.file_name || 'Receipt'}</span>
                     </Button>
                     <IconButton
                       size="sm"
                       label={`Delete ${f.file_name || 'receipt file'}`}
                       icon={<Icon name="x" size={14} className="text-danger" />}
                       onClick={() => setDeleteFileId(f.id)}
                     />
                 </span>
             ))}

             <div className="ml-auto flex gap-1">
                 {/* Gate on "not already this status", matching the desktop row.
                     Gating on `=== 'pending'` meant a completed row could be
                     skipped on desktop but not here. */}
                 {transaction.status !== 'completed' && <Button variant="primary" size="sm" onClick={() => handleStatusUpdate('completed')} disabled={isPending || !canManageReceipts}>Done</Button>}
                 {transaction.status !== 'no_receipt_required' && <Button variant="secondary" size="sm" onClick={() => handleStatusUpdate('no_receipt_required')} disabled={isPending || !canManageReceipts}>Skip</Button>}
                 {transaction.status !== 'cant_find' && <Button variant="secondary" size="sm" onClick={() => handleStatusUpdate('cant_find')} className="border-danger-border text-danger-fg hover:bg-danger-soft" disabled={isPending || !canManageReceipts}>Missing</Button>}
                 {transaction.status !== 'pending' && <Button variant="ghost" size="sm" onClick={() => handleStatusUpdate('pending')} disabled={isPending || !canManageReceipts}>Reopen</Button>}
             </div>
        </div>
        <ConfirmDialog
          open={Boolean(deleteFileId)}
          onClose={() => setDeleteFileId(null)}
          onConfirm={() => deleteFileId ? handleReceiptDelete(deleteFileId) : undefined}
          title="Delete Receipt File"
          message="Delete this receipt file from the transaction? This cannot be undone."
          confirmLabel="Delete"
          tone="danger"
        />
    </Card>
  )

  if (!heatColour) return card

  return (
    <div
      className="rounded-lg [&_.text-text-muted]:!text-text-strong [&_.text-text-soft]:!text-text"
      style={{ backgroundColor: heatColour }}
    >
      {card}
    </div>
  )
}
