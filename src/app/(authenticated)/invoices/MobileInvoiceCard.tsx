import { invoiceBalanceDue } from '@/lib/invoices/balance'
import type { InvoiceWithDetails } from '@/types/invoices'
import { Icon } from '@/ds'
import { Badge } from '@/ds'
import { IconButton } from '@/ds'
import { invoiceStatusLabel, invoiceStatusTone } from '@/lib/invoices/status-ui'

interface MobileInvoiceCardProps {
  invoice: InvoiceWithDetails
  onClick?: (invoice: InvoiceWithDetails) => void
  onDownload?: (invoice: InvoiceWithDetails) => void
  downloadDisabled?: boolean
}

const currencyFormatter = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const formatCurrency = (value: number) => currencyFormatter.format(value)

export function MobileInvoiceCard({
  invoice,
  onClick,
  onDownload,
  downloadDisabled = false,
}: MobileInvoiceCardProps) {
  const isOverdue = invoice.status === 'overdue'
  const isPaid = invoice.status === 'paid'

  return (
    // One row of the invoice list's own Card on phones, so it takes no frame of its own and the
    // list's dividers separate the rows. Not a DS Card: even a ghost Card keeps a 1px transparent
    // border, which Tailwind emits after divide-y and so hides the dividers. The role and tab stop
    // are the ones the Card gave a clickable row.
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick ? () => onClick(invoice) : undefined}
      className={
        onClick
          ? 'cursor-pointer p-pad-card transition-colors hover:bg-surface-hover'
          : 'p-pad-card'
      }
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex-1">
          <div className="font-semibold text-text">
            {invoice.invoice_number}
          </div>
          <div className="mt-1 text-sm text-text-muted">
            {invoice.vendor?.name || 'No vendor'}
          </div>
          {invoice.reference && (
            <div className="mt-1 text-xs text-text-muted">
              Ref: {invoice.reference}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton
            type="button"
            label={`Download invoice ${invoice.invoice_number}`}
            title={`Download invoice ${invoice.invoice_number}`}
            data-row-click-ignore="true"
            disabled={downloadDisabled}
            onClick={(event) => {
              event.stopPropagation()
              onDownload?.(invoice)
            }}
            icon={<Icon name="download" size={16} />}
            className="text-text-muted hover:text-text"
          />
          <Badge tone={invoiceStatusTone(invoice.status)} size="sm" dot>
            {invoiceStatusLabel(invoice.status)}
          </Badge>
        </div>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-text-muted">Invoice Date:</span>
          <span className="font-medium">
            {new Date(invoice.invoice_date).toLocaleDateString('en-GB')}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Due Date:</span>
          <span className={isOverdue ? 'font-medium text-danger-fg' : 'font-medium'}>
            {new Date(invoice.due_date).toLocaleDateString('en-GB')}
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <div>
          <div className="text-xs text-text-muted">Total Amount</div>
          <div className="text-lg font-semibold">
            {formatCurrency(invoice.total_amount)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-text-muted">Balance</div>
          {isPaid ? (
            <div className="font-semibold text-success-fg">Paid</div>
          ) : (
            <div className={isOverdue ? 'font-semibold text-danger-fg' : 'font-semibold'}>
              {formatCurrency(invoiceBalanceDue(invoice))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
