'use client'

import { NewVendorDialog } from './NewVendorDialog'
import { Badge, Button, Card, FileButton, Input, Select, SubHeading, Icon } from '@/ds'
import type { ClassificationRuleSuggestion } from '@/app/actions/receipts'
import type { ReceiptTransaction } from '@/types/database'
import { formatCurrency, formatDate } from '@/app/(authenticated)/receipts/utils'
import { RECEIPT_FLOW_TONE, RECEIPT_STATUS_LABEL, RECEIPT_STATUS_TONE } from '@/app/(authenticated)/receipts/_shared/status-ui'
import { RECEIPT_UPLOAD_ACCEPT } from './receiptUploadClient'
import { ClassificationBadge, SourceBadge } from './ReceiptTableRow'
import { AiCategorySuggestion } from './AiCategorySuggestion'
import { EXPENSE_CHOICE_OPTIONS, expenseChoiceLabel, type WorkspaceTransaction } from './expenseChoice'
import { CompletedReason, ReceiptFiles, ReceiptRowDialogs } from './ReceiptRowParts'
import { useReceiptRow } from './useReceiptRow'

interface ReceiptMobileCardProps {
  transaction: WorkspaceTransaction
  vendorOptions: string[]
  heatColour?: string
  onUpdate: (transaction: WorkspaceTransaction, previousStatus: ReceiptTransaction['status']) => void
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

/**
 * One payment on a phone or tablet. It does everything the table row does, through the same
 * hook: the two used to be separate copies, and the card had fallen behind.
 */
export function ReceiptMobileCard({ transaction, vendorOptions, heatColour, onUpdate, onRuleSuggestion }: ReceiptMobileCardProps) {
  const row = useReceiptRow({ transaction, vendorOptions, onUpdate, onRuleSuggestion })
  const { canManage, isPending } = row

  // A heat-coloured card (grouped by vendor) paints the colour on a wrapper and lets the Card show
  // through, because the colour is worked out per row and cannot be a class.
  const card = (
    <Card padding="sm" className={heatColour ? 'bg-transparent' : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <p className="text-meta text-text-muted">
            {formatDate(transaction.transaction_date)}
            {transaction.transaction_type ? ` · ${transaction.transaction_type}` : ''}
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
          {transaction.aiNote && (
            <p className="text-meta text-warning-fg">{transaction.aiNote}</p>
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
      <CompletedReason transaction={transaction} />

      <div className="mt-1.5 grid w-full grid-cols-[auto_1fr] items-center gap-x-2 gap-y-2 text-xs text-text-muted">
        <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Vendor</span>
        <div className="text-sm leading-tight text-text-strong">
          {row.editingField === 'vendor' ? (
            <div className="flex flex-col gap-2 mt-1">
              {row.isCustomVendor ? (
                <Input
                  autoFocus
                  aria-label="Vendor name"
                  value={row.classificationDraft}
                  onChange={(event) => row.setClassificationDraft(event.target.value)}
                  placeholder="Vendor"
                  disabled={isPending}
                />
              ) : (
                <Select
                  autoFocus
                  aria-label="Vendor"
                  value={row.classificationDraft}
                  onChange={(event) => {
                    if (event.target.value === '__custom__') { row.setIsCustomVendor(true); row.setClassificationDraft('') }
                    else row.setClassificationDraft(event.target.value)
                  }}
                  disabled={isPending}
                  options={[
                    { value: '', label: 'Clear' },
                    ...vendorOptions.map((vendor) => ({ value: vendor, label: vendor })),
                    { value: '__custom__', label: '+ New' },
                  ]}
                />
              )}
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => row.saveClassification()} loading={isPending}>Save</Button>
                <Button size="sm" variant="ghost" onClick={row.cancelEditing} disabled={isPending}>Cancel</Button>
              </div>
              <NewVendorDialog
                prompt={row.vendorPrompt}
                pending={isPending}
                onUseExisting={(vendorName) => row.saveClassification({ vendorName })}
                onCreate={() => row.saveClassification({ createVendor: true })}
                onClose={() => row.setVendorPrompt(null)}
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              <Button variant="link" size="sm" onClick={() => row.startEditing('vendor')} className="justify-start whitespace-normal text-left font-normal text-text-strong hover:text-primary" disabled={!canManage}>
                {transaction.vendor_name || <span className="text-text-soft">Add vendor</span>}
                {transaction.vendor_source === 'ai' && <Icon name="sparkles" size={12} className="inline text-info" />}
              </Button>
              <ClassificationBadge source={transaction.vendor_source} />
            </div>
          )}
        </div>

        <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Expense</span>
        <div className="text-sm leading-tight text-text-strong">
          {row.editingField === 'expense' ? (
            <div className="flex flex-col gap-2 mt-1">
              <Select
                autoFocus
                aria-label="Expense category"
                value={row.classificationDraft}
                onChange={(event) => row.setClassificationDraft(event.target.value)}
                disabled={isPending}
                options={EXPENSE_CHOICE_OPTIONS}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => row.saveClassification()} loading={isPending}>Save</Button>
                <Button size="sm" variant="ghost" onClick={row.cancelEditing} disabled={isPending}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1">
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="link" size="sm" onClick={() => row.startEditing('expense')} className="justify-start whitespace-normal text-left font-normal text-text-strong hover:text-primary" disabled={!canManage}>
                  {expenseChoiceLabel(transaction) || <span className="text-text-soft">Add category</span>}
                  {transaction.expense_category_source === 'ai' && <Icon name="sparkles" size={12} className="inline text-info" />}
                </Button>
                <ClassificationBadge source={transaction.expense_category_source} />
              </div>
              <AiCategorySuggestion
                transaction={transaction}
                canManage={canManage}
                disabled={isPending}
                onChange={row.startChangingSuggestion}
                onClosed={row.closeSuggestion}
              />
            </div>
          )}
        </div>

        <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Notes</span>
        <div className="text-sm leading-tight text-text-strong">
          {row.isEditingNote ? (
            <div className="flex flex-col gap-2 mt-1">
              <Input
                autoFocus
                aria-label="Note"
                value={row.noteDraft}
                onChange={(event) => row.setNoteDraft(event.target.value)}
                placeholder="Note"
                disabled={isPending}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={row.saveNote} loading={isPending}>Save</Button>
                <Button size="sm" variant="ghost" onClick={() => row.setIsEditingNote(false)} disabled={isPending}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div>
              {row.note.stamp && <p className="text-meta text-text-muted uppercase">{row.note.stamp}</p>}
              <Button variant="link" size="sm" onClick={row.startNoteEdit} className="w-full justify-start whitespace-normal text-left font-normal text-text-strong hover:text-primary" disabled={!canManage}>
                {row.note.text || <span className="text-text-soft italic">Add note</span>}
                <Icon name="edit" size={12} className="inline text-text-subtle" />
              </Button>
            </div>
          )}
        </div>

        {transaction.files.length > 0 && (
          <>
            <span className="font-semibold uppercase tracking-wide leading-none self-start mt-1">Receipts</span>
            <ReceiptFiles transaction={transaction} row={row} />
          </>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-2 flex flex-wrap gap-2">
        {/* FileButton, not the FileUpload drop zone, which is too big for a card. */}
        <FileButton variant="secondary" size="sm" accept={RECEIPT_UPLOAD_ACCEPT} onFiles={row.upload} disabled={isPending || !canManage}>Upload</FileButton>
        <Button variant="ghost" size="sm" onClick={row.openHistory} aria-label={`History of ${transaction.details}`}>History</Button>

        <div className="ml-auto flex gap-1">
          {/* Gate on "not already this status", matching the desktop row.
              Gating on `=== 'pending'` meant a completed row could be
              skipped on desktop but not here. */}
          {transaction.status !== 'completed' && <Button variant="primary" size="sm" onClick={() => row.updateStatus('completed')} disabled={isPending || !canManage}>Done</Button>}
          {transaction.status !== 'no_receipt_required' && <Button variant="secondary" size="sm" onClick={() => row.updateStatus('no_receipt_required')} disabled={isPending || !canManage}>Skip</Button>}
          {transaction.status !== 'cant_find' && <Button variant="secondary" size="sm" onClick={() => row.updateStatus('cant_find')} className="border-danger-border text-danger-fg hover:bg-danger-soft" disabled={isPending || !canManage}>Missing</Button>}
          {transaction.status !== 'pending' && <Button variant="ghost" size="sm" onClick={() => row.updateStatus('pending')} disabled={isPending || !canManage}>Reopen</Button>}
        </div>
      </div>
      <ReceiptRowDialogs transaction={transaction} row={row} />
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
