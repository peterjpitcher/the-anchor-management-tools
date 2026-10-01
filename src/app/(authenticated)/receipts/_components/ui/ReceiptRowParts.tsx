'use client'

import { Alert, Badge, Button, ConfirmDialog, Icon, IconButton, Modal, Textarea } from '@/ds'
import { formatDateTimeInLondon } from '@/lib/dateUtils'
import type { ReceiptFile } from '@/types/database'
import { formatCurrency, formatDate } from '@/app/(authenticated)/receipts/utils'
import { RECEIPT_STATUS_LABEL } from '@/app/(authenticated)/receipts/_shared/status-ui'
import type { WorkspaceTransaction } from './expenseChoice'
import type { ReceiptRowState } from './useReceiptRow'

/**
 * The parts of a payment in the list that the table row and the phone card both show: its files,
 * and the dialogs a payment can open. One component each, so the two layouts cannot drift.
 */

const COMPLETED_REASON_MAX = 500

/** What each kind of history entry is called. Anything not listed is shown by its own name. */
const HISTORY_ACTION_LABEL: Record<string, string> = {
  import: 'Imported',
  manual_update: 'Status changed by hand',
  manual_classification: 'Classified by hand',
  note_update: 'Note changed',
  receipt_upload: 'Receipt attached',
  receipt_deleted: 'Receipt removed',
  rule_auto_mark: 'Status set by a rule',
  rule_classification: 'Classified by a rule',
  rule_run: 'Changed by a rule run',
  rule_run_undone: 'Rule run undone',
  bulk_classification: 'Classified in bulk',
  bulk_apply: 'Classified in bulk',
  invoice_reconciliation: 'Matched to an invoice',
  invoice_classification: 'Vendor set from an invoice',
  invoice_attached: 'Invoice attached',
  invoice_copy_refreshed: 'Invoice copy refreshed',
  ai_vendor: 'Vendor set by the AI',
  ai_category: 'Category set by the AI',
  ai_category_accepted: 'Suggested category accepted',
  ai_category_edited: 'Suggested category changed',
  payroll_local: 'Recognised as wages',
  vendor_merge: 'Vendor merged',
  vendor_merge_undone: 'Vendor merge undone',
  vendor_rename: 'Vendor renamed',
  vendor_rename_undone: 'Vendor rename undone',
}

export function historyActionLabel(action: string): string {
  const known = HISTORY_ACTION_LABEL[action]
  if (known) return known
  const words = action.replace(/_/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Change'
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function isInvoiceCopy(file: Pick<ReceiptFile, 'source' | 'invoice_id'>): boolean {
  return file.source === 'invoice' || Boolean(file.invoice_id)
}

interface ReceiptFilesProps {
  transaction: WorkspaceTransaction
  row: ReceiptRowState
  /** Narrow columns cut the name short. */
  compact?: boolean
}

/** The files on a payment. Each opens in a new tab; an invoice copy can also be refreshed. */
export function ReceiptFiles({ transaction, row, compact = false }: ReceiptFilesProps) {
  if (transaction.files.length === 0) return null

  return (
    <ul className="flex flex-col gap-1">
      {transaction.files.map((file) => {
        const name = file.file_name || 'Receipt'
        const invoice = isInvoiceCopy(file)
        return (
          <li key={file.id} className="flex flex-wrap items-center gap-1">
            <Button
              variant="link"
              size="xs"
              onClick={() => row.openFile(file.id)}
              className={compact ? 'max-w-[140px]' : 'max-w-[220px]'}
              title={name}
            >
              <span className="truncate">{name}</span>
            </Button>
            {invoice && (
              <Badge tone="info" size="sm">
                Invoice
              </Badge>
            )}
            {(file.shared_with ?? 0) > 0 && (
              <Badge tone="warning" size="sm" title="The same file is attached to other transactions">
                Also on {file.shared_with} other{file.shared_with === 1 ? '' : 's'}
              </Badge>
            )}
            <IconButton
              size="sm"
              label={`Download ${name}`}
              title="Download"
              icon={<Icon name="download" size={14} />}
              onClick={() => row.openFile(file.id, { download: true })}
            />
            {invoice && row.canManage && (
              <IconButton
                size="sm"
                label={`Refresh the copy of ${name}`}
                title="Refresh invoice copy"
                icon={<Icon name="refresh" size={14} />}
                onClick={() => row.refreshInvoiceCopy(file.id)}
                disabled={row.isPending}
              />
            )}
            {row.canManage && (
              <IconButton
                size="sm"
                label={`Delete ${name}`}
                title="Delete"
                icon={<Icon name="x" size={14} className="text-danger" />}
                onClick={() => row.setDeleteFileId(file.id)}
                disabled={row.isPending}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Why a completed payment has no receipt, shown under its status. */
export function CompletedReason({ transaction }: { transaction: WorkspaceTransaction }) {
  if (transaction.status !== 'completed' || !transaction.completed_reason) return null
  return (
    <p className="text-xs text-text-muted">
      <span className="font-medium">No receipt:</span> {transaction.completed_reason}
    </p>
  )
}

interface ReceiptRowDialogsProps {
  transaction: WorkspaceTransaction
  row: ReceiptRowState
}

/** The dialogs one payment can open. Nothing is mounted until one of them is. */
export function ReceiptRowDialogs({ transaction, row }: ReceiptRowDialogsProps) {
  const deleting = row.deleteFileId ? transaction.files.find((file) => file.id === row.deleteFileId) : undefined
  const deletingLast = Boolean(deleting) && transaction.files.length === 1
  const duplicate = row.duplicatePrompt?.warning

  return (
    <>
      {row.deleteFileId && (
        <ConfirmDialog
          open
          onClose={() => row.setDeleteFileId(null)}
          onConfirm={() => (row.deleteFileId ? row.deleteFile(row.deleteFileId) : undefined)}
          title="Delete Receipt File"
          message={
            deletingLast && transaction.status === 'completed' && !transaction.completed_reason
              ? 'Delete this file from the transaction? It is the only file, so the transaction will no longer be completed. This cannot be undone.'
              : 'Delete this file from the transaction? This cannot be undone.'
          }
          confirmLabel="Delete"
          tone="danger"
        />
      )}

      {row.reasonPromptOpen && (
        <Modal
          open
          onClose={row.isPending ? () => undefined : row.cancelReason}
          title="Complete without a receipt"
          description="This transaction has no receipt attached. Say why, so the accountant is not left wondering."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={row.cancelReason} disabled={row.isPending}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={row.submitReason} loading={row.isPending}>
                Mark as Done
              </Button>
            </>
          }
        >
          <Textarea
            label="Reason"
            value={row.reasonDraft}
            onChange={(event) => row.setReasonDraft(event.target.value)}
            maxLength={COMPLETED_REASON_MAX}
            rows={3}
            placeholder="For example: parking meter, no receipt issued"
            disabled={row.isPending}
            autoFocus
          />
        </Modal>
      )}

      {duplicate && (
        <Modal
          open
          onClose={row.isPending ? () => undefined : row.cancelDuplicate}
          title="This file is already on another transaction"
          description="Nothing has been attached yet. Check it is the right file for this transaction."
          footer={
            <>
              <Button type="button" variant="secondary" onClick={row.cancelDuplicate} disabled={row.isPending}>
                Do Not Attach
              </Button>
              <Button type="button" variant="primary" onClick={row.confirmDuplicate} loading={row.isPending}>
                Attach Anyway
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p>
              The same file is attached to {plural(duplicate.count, 'other transaction', 'other transactions')}
              {duplicate.count > duplicate.payments.length ? `. The ${duplicate.payments.length} most recent are shown` : ''}:
            </p>
            <ul className="space-y-2">
              {duplicate.payments.map((payment) => (
                <li key={payment.transactionId} className="rounded-lg border border-border px-3 py-2">
                  <p className="font-medium text-text-strong">{payment.details}</p>
                  <p className="text-sm text-text-muted">
                    {formatDate(payment.transactionDate)}
                    {payment.amount !== null ? `, ${formatCurrency(payment.amount)}` : ''}
                    {payment.fileName ? `, ${payment.fileName}` : ''}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-sm text-text-muted">
              One document can cover several transactions, such as a statement paid in parts. If that is the case here,
              attach it anyway.
            </p>
          </div>
        </Modal>
      )}

      {row.historyOpen && (
        <Modal open onClose={row.closeHistory} title="History" description={transaction.details} width="lg">
          {row.historyError ? (
            <Alert tone="danger" title="The history could not be loaded">
              {row.historyError}
            </Alert>
          ) : row.history === null ? (
            <p role="status">Loading the history.</p>
          ) : row.history.length === 0 ? (
            <p>Nothing has been recorded for this transaction yet.</p>
          ) : (
            <ol className="space-y-3">
              {row.history.map((entry) => (
                <li key={entry.id} className="border-b border-border pb-3 last:border-b-0 last:pb-0">
                  <p className="font-medium text-text-strong">{historyActionLabel(entry.action)}</p>
                  <p className="text-sm text-text-muted">
                    {formatDateTimeInLondon(entry.at, {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {', '}
                    {entry.by ?? 'automatic'}
                  </p>
                  {entry.previousStatus && entry.newStatus && entry.previousStatus !== entry.newStatus && (
                    <p className="text-sm">
                      {RECEIPT_STATUS_LABEL[entry.previousStatus]} to {RECEIPT_STATUS_LABEL[entry.newStatus]}
                    </p>
                  )}
                  {entry.note && <p className="text-sm break-words">{entry.note}</p>}
                </li>
              ))}
            </ol>
          )}
        </Modal>
      )}
    </>
  )
}
