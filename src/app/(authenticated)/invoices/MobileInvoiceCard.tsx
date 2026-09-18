import { invoiceBalanceDue } from '@/lib/invoices/balance'
import type { InvoiceWithDetails } from '@/types/invoices'
import { Card } from '@/ds'
import { Badge } from '@/ds'
import { IconButton } from '@/ds'
import { Download } from 'lucide-react'
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
    <Card
      className={`transition-shadow hover:shadow-default ${onClick ? 'cursor-pointer' : ''}`}
      onClick={() => onClick?.(invoice)}
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
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
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
          <span className={`font-medium ${isOverdue ? 'text-danger' : ''}`}>
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
            <div
              className={`font-semibold ${isOverdue ? 'text-danger' : ''}`}
            >
              {formatCurrency(invoiceBalanceDue(invoice))}
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
