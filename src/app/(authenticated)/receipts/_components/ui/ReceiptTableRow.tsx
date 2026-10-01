'use client'

import { NewVendorDialog } from './NewVendorDialog'
import { Badge, Button, FileButton, IconButton, Input, Select, Icon } from '@/ds'
import type { ClassificationRuleSuggestion } from '@/app/actions/receipts'
import type { ReceiptTransaction, ReceiptClassificationSource } from '@/types/database'
import { formatCurrency, formatDate } from '@/app/(authenticated)/receipts/utils'
import {
  RECEIPT_CLASSIFICATION_SOURCE_LABEL,
  RECEIPT_CLASSIFICATION_SOURCE_TONE,
  RECEIPT_SOURCE_LABEL,
  RECEIPT_SOURCE_TONE,
  RECEIPT_STATUS_LABEL,
  RECEIPT_STATUS_TONE,
} from '@/app/(authenticated)/receipts/_shared/status-ui'
import { RECEIPT_UPLOAD_ACCEPT } from './receiptUploadClient'
import { AiCategorySuggestion } from './AiCategorySuggestion'
import { EXPENSE_CHOICE_OPTIONS, expenseChoiceLabel, type WorkspaceTransaction } from './expenseChoice'
import { CompletedReason, ReceiptFiles, ReceiptRowDialogs } from './ReceiptRowParts'
import { useReceiptRow } from './useReceiptRow'

export function SourceBadge({ sourceType }: { sourceType: ReceiptTransaction['source_type'] }) {
  const source = sourceType === 'amex' ? 'amex' : 'bank'
  return (
    <Badge tone={RECEIPT_SOURCE_TONE[source]} size="sm">
      {RECEIPT_SOURCE_LABEL[source]}
    </Badge>
  )
}

export function ClassificationBadge({ source }: { source?: ReceiptClassificationSource | null }) {
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
  onRuleSuggestion: (suggestion: ClassificationRuleSuggestion) => void
}

export function ReceiptTableRow({ transaction, vendorOptions, heatColour, onUpdate, onRuleSuggestion }: ReceiptTableRowProps) {
  const row = useReceiptRow({ transaction, vendorOptions, onUpdate, onRuleSuggestion })
  const { canManage, isPending } = row

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
        {row.editingField === 'vendor' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
            {row.isCustomVendor ? (
              <div className="space-y-2">
                <Input
                  autoFocus
                  aria-label="Vendor name"
                  value={row.classificationDraft}
                  onChange={(event) => row.setClassificationDraft(event.target.value)}
                  placeholder="Vendor name"
                  disabled={isPending}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => { row.setIsCustomVendor(false); row.setClassificationDraft('') }}
                  disabled={isPending}
                >
                  ⟵ Pick Existing
                </Button>
              </div>
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
                  { value: '__custom__', label: '+ New vendor' },
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
          <div className="flex flex-col gap-1">
            {/* `||` not `??`: a blank vendor string still needs the prompt, and
                those are exactly the rows the Needs Vendor tab surfaces. */}
            <Button variant="link" size="sm" className="justify-start whitespace-normal text-left text-text-strong hover:text-primary" onClick={() => row.startEditing('vendor')} disabled={!canManage}>
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
        {row.editingField === 'expense' ? (
          <div className="flex flex-col gap-2 min-w-[200px]">
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
          <div className="flex flex-col gap-1">
            <Button variant="link" size="sm" className="justify-start whitespace-normal text-left text-text-strong hover:text-primary" onClick={() => row.startEditing('expense')} disabled={!canManage}>
              {expenseChoiceLabel(transaction) || <span className="font-normal text-text-soft">Add category</span>}
            </Button>
            <div className="flex items-center gap-2">
              <ClassificationBadge source={transaction.expense_category_source} />
              {transaction.expense_category_source === 'ai' && <Icon name="sparkles" size={12} className="text-info" />}
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
      </td>

      <td className="px-4 py-2 text-right">{formatCurrency(transaction.amount_in)}</td>
      <td className="px-4 py-2 text-right">{formatCurrency(transaction.amount_out)}</td>

      <td className="px-4 py-2">
        <div className="flex flex-col items-start gap-1">
          <Badge
            tone={RECEIPT_STATUS_TONE[transaction.status]}
            icon={
              transaction.status === 'completed' ? <Icon name="checkCircle" size={12} /> : transaction.status === 'pending' ? <Icon name="xCircle" size={12} /> : undefined
            }
            className="whitespace-nowrap"
          >
            {RECEIPT_STATUS_LABEL[transaction.status]}
          </Badge>
          <CompletedReason transaction={transaction} />
        </div>
      </td>

      <td className="px-4 py-2">
        <ReceiptFiles transaction={transaction} row={row} compact />
      </td>

      <td className="px-4 py-2 min-w-[200px]">
        {row.isEditingNote ? (
          <div className="space-y-2">
            <Input
              autoFocus
              value={row.noteDraft}
              onChange={(event) => row.setNoteDraft(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && row.saveNote()}
              aria-label="Note"
              disabled={isPending}
            />
            <div className="flex gap-1">
              <Button size="sm" variant="primary" onClick={row.saveNote} loading={isPending}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => row.setIsEditingNote(false)} disabled={isPending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-1 group">
            {row.note.text ? (
              <>
                {row.note.stamp && <p className="text-meta text-text-muted uppercase">{row.note.stamp}</p>}
                <p className="text-sm text-text break-words">{row.note.text}</p>
              </>
            ) : (
              <span className="text-xs text-text-soft italic">No notes</span>
            )}
            {/* Always visible: this table is used on an iPad, where there is no
                hover and a hover-only control is simply unreachable. */}
            <Button variant="ghost" size="xs" icon={<Icon name="edit" size={12} />} onClick={row.startNoteEdit} disabled={!canManage}>
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
            onFiles={row.upload}
            disabled={isPending || !canManage}
            aria-label="Upload receipt"
            title="Upload receipt"
            icon={<Icon name="upload" size={16} />}
          />

          {transaction.status !== 'completed' && (
            <IconButton
              variant="primary"
              onClick={() => row.updateStatus('completed')}
              disabled={isPending || !canManage}
              title="Mark as done"
              label="Mark as done"
              icon={<Icon name="check" size={16} />}
            />
          )}

          {transaction.status !== 'no_receipt_required' && (
            <IconButton
              variant="secondary"
              onClick={() => row.updateStatus('no_receipt_required')}
              disabled={isPending || !canManage}
              title="Skip (no receipt needed)"
              label="Skip (no receipt needed)"
              icon={<Icon name="fastForward" size={16} />}
            />
          )}

          {transaction.status !== 'cant_find' && (
            <IconButton
              variant="secondary"
              onClick={() => row.updateStatus('cant_find')}
              className="border-danger-border text-danger-fg hover:bg-danger-soft"
              disabled={isPending || !canManage}
              title="Mark as missing"
              label="Mark as missing"
              icon={<Icon name="helpCircle" size={16} />}
            />
          )}

          {transaction.status !== 'pending' && (
            <IconButton
              variant="ghost"
              onClick={() => row.updateStatus('pending')}
              disabled={isPending || !canManage}
              title="Reopen"
              label="Reopen"
              icon={<Icon name="undo" size={16} />}
            />
          )}

          <IconButton
            variant="ghost"
            onClick={row.openHistory}
            title="History"
            label={`History of ${transaction.details}`}
            icon={<Icon name="clock" size={16} />}
          />
        </div>
        <ReceiptRowDialogs transaction={transaction} row={row} />
      </td>
    </tr>
  )
}
