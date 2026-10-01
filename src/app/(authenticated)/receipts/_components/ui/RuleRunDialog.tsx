'use client'

import { Button, Modal, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ds'
import { formatDateInLondon } from '@/lib/dateUtils'
import type { RuleRunPreview } from '@/services/receipts/receiptRuleRuns'
import { RECEIPT_STATUS_LABEL } from '../../_shared/status-ui'

interface RuleRunDialogProps {
  /** The stored preview waiting for a yes. Null closes the dialog. */
  preview: RuleRunPreview | null
  running?: boolean
  onRun: () => void
  onClose: () => void
}

const currency = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' })

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function Change({ from, to }: { from: string; to: string }) {
  if (from === to) return <span className="text-text-muted">{to}</span>
  return (
    <span>
      <span className="text-text-muted line-through">{from}</span> <span aria-hidden="true">→</span>{' '}
      <span className="font-medium text-text-strong">{to}</span>
      <span className="sr-only"> (was {from})</span>
    </span>
  )
}

/**
 * What a rule run would change, before it changes anything. The run that follows writes exactly
 * this list: a transaction edited in the meantime is skipped, and the run stops if a rule or the
 * lock date has changed since.
 */
export function RuleRunDialog({ preview, running = false, onRun, onClose }: RuleRunDialogProps) {
  const scopeLabel = preview?.scope === 'all' ? 'transactions' : 'pending transactions'

  return (
    <Modal
      open={Boolean(preview)}
      onClose={running ? () => undefined : onClose}
      title={preview ? `Run “${preview.ruleName}”` : 'Run rule'}
      description={
        preview
          ? `Checked ${preview.reviewed} ${scopeLabel}. The rule matches ${preview.matched} and would change ${preview.planned}.`
          : undefined
      }
      width="xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose} disabled={running}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={onRun} loading={running}>
            Run Rule
          </Button>
        </>
      }
    >
      {preview && (
        <div className="space-y-4">
          <ul className="list-disc space-y-1 pl-5">
            <li>set the vendor on {preview.vendorChanges}</li>
            <li>set the expense category on {preview.expenseChanges}</li>
            <li>change the status of {plural(preview.statusChanges, 'pending transaction', 'pending transactions')}</li>
          </ul>

          {preview.protectedCount > 0 && (
            <p>
              {plural(preview.protectedCount, 'matching transaction was', 'matching transactions were')} set by a person,
              the import or invoice matching and will be left as they are.
            </p>
          )}
          {preview.locked > 0 && preview.lockDate && (
            <p>
              {plural(preview.locked, 'matching transaction is', 'matching transactions are')} dated on or before the
              lock date ({formatDateInLondon(preview.lockDate)}) and will be left alone.
            </p>
          )}
          {preview.outranked > 0 && (
            <p>
              {plural(preview.outranked, 'matching transaction is', 'matching transactions are')} decided by another
              rule that ranks higher, so this rule changes nothing on them.
            </p>
          )}
          {preview.scope === 'all' && (
            <p>Closed transactions keep their status. Only their vendor and category can change.</p>
          )}

          <div>
            <p className="font-medium text-text-strong">
              {preview.planned > preview.samples.length
                ? `The first ${preview.samples.length} of ${preview.planned} changes`
                : plural(preview.planned, 'change', 'changes')}
            </p>
            <div className="mt-2 max-h-80 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.samples.map((sample) => (
                    <TableRow key={sample.transactionId}>
                      <TableCell>
                        <span className="block break-words text-text-strong">{sample.details}</span>
                        <span className="text-text-muted">
                          {formatDateInLondon(sample.transactionDate)} · {currency.format(sample.amount)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Change from={sample.before.vendor ?? 'None'} to={sample.after.vendor ?? 'None'} />
                      </TableCell>
                      <TableCell>
                        <Change from={sample.before.category ?? 'None'} to={sample.after.category ?? 'None'} />
                      </TableCell>
                      <TableCell>
                        <Change
                          from={RECEIPT_STATUS_LABEL[sample.before.status]}
                          to={RECEIPT_STATUS_LABEL[sample.after.status]}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <p className="text-text-muted">
            Only these transactions are changed. Any that someone edits before you press Run is skipped. The run can
            be undone afterwards from Recent runs.
          </p>
        </div>
      )}
    </Modal>
  )
}
